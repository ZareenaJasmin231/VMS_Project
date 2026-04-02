"""
recording_api.py
----------------
FastAPI router providing recording management endpoints.
Mount this in main.py with:  app.include_router(recording_router)

Endpoints:
  GET  /api/recordings/                    - list all recordings (filterable)
  GET  /api/recordings/cameras             - list cameras with recordings
  GET  /api/recordings/status              - recorder thread status
  GET  /api/recordings/play                - decrypt + stream a recording (CORS FIXED)
  GET  /api/recordings/download            - download a single video as MP4 (CORS FIXED)
  GET  /api/recordings/{camera_id}         - list recordings for one camera
  POST /api/recordings/decrypt-file        - decrypt uploaded .enc file
  POST /api/recordings/start/{stream_name} - start recording a camera
  POST /api/recordings/stop/{stream_name}  - stop recording a camera
  POST /api/recordings/export-zip          - export date/time range as zip
"""

import os
import io
import re
import tempfile
import zipfile
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, BackgroundTasks
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from pymongo import MongoClient
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.backends import default_backend

# Assuming rtsp_recorder is in your path
import rtsp_recorder as recorder

# ------------------------------------------------------------------
# Config
# ------------------------------------------------------------------
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")
KEY_FILE  = os.environ.get("VIDEO_KEY_FILE", "/app/data/video.key")

# ------------------------------------------------------------------
# MongoDB
# ------------------------------------------------------------------
_client     = MongoClient(MONGO_URI)
_db         = _client["mirador-vms"]
_collection = _db["recordings"]

# ------------------------------------------------------------------
# AES key + decrypt helpers
# ------------------------------------------------------------------
def _load_key() -> bytes:
    if not os.path.exists(KEY_FILE):
        raise RuntimeError(f"video.key not found at {KEY_FILE}.")
    with open(KEY_FILE, "rb") as f:
        key = f.read().strip()
    return key[:32].ljust(32, b'\0')

def decrypt_bytes(raw: bytes) -> io.BytesIO:
    if not raw or len(raw) <= 16:
        raise ValueError("Encrypted payload must be larger than 16 bytes")
    key = _load_key()
    iv = raw[:16]
    ciphertext = raw[16:]
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    dec = cipher.decryptor()
    padded = dec.update(ciphertext) + dec.finalize()
    unpadder = padding.PKCS7(128).unpadder()
    data = unpadder.update(padded) + unpadder.finalize()
    return io.BytesIO(data)

def _decrypt(file_path: str) -> io.BytesIO:
    with open(file_path, "rb") as f:
        raw = f.read()
    return decrypt_bytes(raw)

def _decrypt_bytes(encrypted_bytes: bytes) -> io.BytesIO:
    """Decrypt bytes directly (for user-uploaded .enc files)."""
    try:
        key = _load_key()
    except Exception as e:
        print(f"[DECRYPT] Key load failed: {e}")
        raise HTTPException(status_code=500, detail="Encryption key (video.key) not found on server.")

    if len(encrypted_bytes) < 16:
        raise HTTPException(status_code=400, detail="Invalid encrypted file (too small).")

    try:
        iv       = encrypted_bytes[:16]
        cipher   = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
        dec      = cipher.decryptor()
        padded   = dec.update(encrypted_bytes[16:]) + dec.finalize()
        unpadder = padding.PKCS7(128).unpadder()
        data     = unpadder.update(padded) + unpadder.finalize()
        return io.BytesIO(data)
    except Exception as e:
        print(f"[DECRYPT] Decryption failed: {e}")
        raise HTTPException(status_code=400, detail="Decryption failed. Check if your video.key matches.")

# ------------------------------------------------------------------
# Shared CORS headers
# Snapshot fix: Cache-Control: no-store prevents the browser from
# reusing a previously cached non-CORS response for the same URL.
# Vary: Origin tells caches to store separate copies per origin.
# ------------------------------------------------------------------
_CORS_HEADERS = {
    "Access-Control-Allow-Origin":   "*",
    "Access-Control-Allow-Methods":  "GET, OPTIONS",
    "Access-Control-Allow-Headers":  "*",
    "Access-Control-Expose-Headers": "Content-Length, Content-Type, Accept-Ranges, Content-Disposition",
    "Vary":                          "Origin",
    "Cache-Control":                 "no-store",   # Critical for snapshot fix
}

# ------------------------------------------------------------------
# Router
# ------------------------------------------------------------------
recording_router = APIRouter(prefix="/api/recordings", tags=["recordings"])

class ExportZipRequest(BaseModel):
    camera_id: str
    start_date: str
    end_date: str
    start_hour: int = 0
    end_hour: int = 23

def _doc_to_dict(doc: dict) -> dict:
    doc.pop("_id", None)
    if "created_at" in doc and hasattr(doc["created_at"], "isoformat"):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc

# ==================================================================
# GET ROUTES
# ==================================================================

@recording_router.get("/")
def list_recordings(
    camera_id: str = Query(None),
    date: str      = Query(None),
    limit: int     = Query(100, le=500),
):
    query = {}
    if camera_id:
        query["camera_id"] = camera_id
    if date:
        query["date"] = date
    docs = list(_collection.find(query).sort("created_at", -1).limit(limit))
    return [_doc_to_dict(d) for d in docs]

@recording_router.get("/cameras")
def list_recording_cameras():
    return _collection.distinct("camera_id")

@recording_router.get("/status")
def recorder_status():
    active = [
        name
        for name, thread in recorder._recorders.items()
        if thread.is_alive()
    ]
    return {"active_recorders": active, "count": len(active)}

@recording_router.get("/play")
def play_recording(
    camera_id:  str = Query(...),
    date:       str = Query(...),
    start_time: str = Query(...),
    _cb:        str = Query(None),   # cache-buster param, ignored server-side
):
    """
    Decrypt and stream a recording.

    SNAPSHOT FIX:
      - Cache-Control: no-store  → browser never serves a cached non-CORS copy
      - Vary: Origin             → CDN/proxy stores separate copies per origin
      - Access-Control-Allow-Origin: * → required for crossOrigin="anonymous"

    The frontend sets video.crossOrigin = "anonymous" imperatively BEFORE
    assigning video.src, and appends ?_cb=<timestamp> to bust any stale
    browser cache entry. Together these ensure canvas.drawImage() on the
    video element will never raise a SecurityError / tainted canvas.
    """
    doc = _collection.find_one({
        "camera_id":  camera_id,
        "date":       date,
        "start_time": start_time,
    })
    if not doc:
        raise HTTPException(status_code=404, detail="Recording not found in database")

    enc_path = doc.get("file_path", "")
    if not os.path.exists(enc_path):
        raise HTTPException(status_code=404, detail=f"Encrypted file missing: {enc_path}")

    try:
        stream = _decrypt(enc_path)
        data   = stream.getvalue()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decryption failed: {e}")

    return StreamingResponse(
        io.BytesIO(data),
        media_type="video/mp4",
        headers={
            "Content-Length":  str(len(data)),
            "Accept-Ranges":   "bytes",
            **_CORS_HEADERS,
        }
    )

@recording_router.get("/download")
def download_recording(
    camera_id:  str = Query(...),
    date:       str = Query(...),
    start_time: str = Query(...),
):
    """Download a single recording as an MP4 file."""
    doc = _collection.find_one({
        "camera_id":  camera_id,
        "date":       date,
        "start_time": start_time,
    })
    if not doc:
        raise HTTPException(status_code=404, detail="Recording not found in database")

    enc_path = doc.get("file_path", "")
    if not os.path.exists(enc_path):
        raise HTTPException(status_code=404, detail=f"Encrypted file missing: {enc_path}")

    try:
        stream = _decrypt(enc_path)
        data   = stream.getvalue()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decryption failed: {e}")

    filename = f"{camera_id}_{date}_{start_time}.mp4"

    return StreamingResponse(
        io.BytesIO(data),
        media_type="video/mp4",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Content-Length":      str(len(data)),
            "Accept-Ranges":       "bytes",
            **_CORS_HEADERS,
        }
    )

@recording_router.get("/{camera_id}")
def list_camera_recordings(camera_id: str, date: str = Query(None)):
    query = {"camera_id": camera_id}
    if date:
        query["date"] = date
    docs = list(_collection.find(query).sort("created_at", -1))
    return [_doc_to_dict(d) for d in docs]

# ==================================================================
# POST ROUTES
# ==================================================================

@recording_router.post("/decrypt-file")
async def decrypt_file(file: UploadFile = File(...)):
    try:
        encrypted_data   = await file.read()
        decrypted_stream = _decrypt_bytes(encrypted_data)

        filename = file.filename or "video.mp4"
        if filename.endswith(".enc"):
            filename = filename[:-4] + ".mp4"
        elif not filename.endswith(".mp4"):
            filename = filename + ".mp4"

        return StreamingResponse(
            decrypted_stream,
            media_type="video/mp4",
            headers={
                "Content-Disposition": f"inline; filename={filename}",
                **_CORS_HEADERS,
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decryption failed: {str(e)}")

@recording_router.post("/start/{stream_name}")
def start_recording(stream_name: str, rtsp_url: str = Query(...)):
    recorder.start_camera(stream_name, rtsp_url)
    return {"message": f"Recording started for {stream_name}"}

@recording_router.post("/stop/{stream_name}")
def stop_recording(stream_name: str):
    recorder.stop_camera(stream_name)
    return {"message": f"Recording stopped for {stream_name}"}

@recording_router.post("/export-zip")
def export_zip(request: ExportZipRequest, background_tasks: BackgroundTasks):
    try:
        start = datetime.strptime(request.start_date, "%Y-%m-%d")
        end   = datetime.strptime(request.end_date,   "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    if start > end:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date")

    def extract_hour_from_timestamp(start_time: str) -> int:
        if not start_time: return -1
        match = re.match(r'^(\d{2})', str(start_time).replace('_', '-').replace(':', '-'))
        if match:
            try: return int(match.group(1))
            except: pass
        return -1

    current_date = start
    all_docs     = []
    while current_date <= end:
        date_str = current_date.strftime("%Y-%m-%d")
        docs     = list(_collection.find({"camera_id": request.camera_id, "date": date_str}))
        for doc in docs:
            hour = extract_hour_from_timestamp(doc.get("start_time", ""))
            if request.start_hour <= hour <= request.end_hour:
                all_docs.append(doc)
        current_date += timedelta(days=1)

    if not all_docs:
        raise HTTPException(status_code=404, detail="No recordings found for the specified range")

    temp_zip = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    zip_path = temp_zip.name
    temp_zip.close()

    try:
        file_count = 0
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for doc in all_docs:
                enc_path = (doc.get("file_path", "") or "").replace("\\", "/")
                if not enc_path or not os.path.exists(enc_path): continue

                try:
                    decrypted_data = _decrypt(enc_path).getvalue()
                    if not decrypted_data or len(decrypted_data) < 32: continue
                    out_name = f"{doc.get('camera_id')}_{doc.get('date')}_{doc.get('start_time')}.mp4"
                    zf.writestr(out_name, decrypted_data)
                    file_count += 1
                except: continue

        if file_count == 0:
            if os.path.exists(zip_path): os.unlink(zip_path)
            raise HTTPException(status_code=404, detail="No recordings could be decrypted.")

        background_tasks.add_task(os.unlink, zip_path)
        return FileResponse(
            path=zip_path,
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename=recordings_{request.start_date}.zip",
                **_CORS_HEADERS,
            }
        )
    except Exception as e:
        if os.path.exists(zip_path): os.unlink(zip_path)
        raise HTTPException(status_code=500, detail=f"Failed to create zip: {e}")