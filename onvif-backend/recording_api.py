"""
recording_api.py
----------------
FastAPI router providing recording management endpoints.
Mount this in main.py with:  app.include_router(recording_router)

Endpoints:
  GET  /api/recordings/                    – list all recordings (filterable)
  GET  /api/recordings/{camera_id}         – list recordings for one camera
  GET  /api/recordings/play                – decrypt + stream a recording
  GET  /api/recordings/status              – recorder thread status
  POST /api/recordings/start/{stream_name} – start recording a camera
  POST /api/recordings/stop/{stream_name}  – stop recording a camera
"""

import os
import io
from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from pymongo import MongoClient
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.backends import default_backend

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
# AES key
# ------------------------------------------------------------------
def _load_key() -> bytes:
    if not os.path.exists(KEY_FILE):
        raise RuntimeError(f"video.key not found at {KEY_FILE}. Run encrypt_service.py first.")
    with open(KEY_FILE, "rb") as f:
        key = f.read().strip()
    return key[:32].ljust(32, b'\0')


def _decrypt(file_path: str) -> io.BytesIO:
    with open(file_path, "rb") as f:
        raw = f.read()
    return decrypt_bytes(raw)


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
        iv             = encrypted_bytes[:16]
        cipher         = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
        dec            = cipher.decryptor()
        padded         = dec.update(encrypted_bytes[16:]) + dec.finalize()
        unpadder       = padding.PKCS7(128).unpadder()
        data           = unpadder.update(padded) + unpadder.finalize()
        return io.BytesIO(data)
    except Exception as e:
        print(f"[DECRYPT] Decryption failed (key mismatch or corrupt): {e}")
        raise HTTPException(status_code=400, detail="Decryption failed. Check if your video.key matches the one used for encryption.")


# ------------------------------------------------------------------
# Router
# ------------------------------------------------------------------
recording_router = APIRouter(prefix="/api/recordings", tags=["recordings"])


def _doc_to_dict(doc: dict) -> dict:
    doc.pop("_id", None)
    if "created_at" in doc and hasattr(doc["created_at"], "isoformat"):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc


@recording_router.get("/")
def list_recordings(
    camera_id: str = Query(None),
    date: str      = Query(None),
    limit: int     = Query(100, le=500),
):
    """List recordings. Optionally filter by camera_id and/or date."""
    query = {}
    if camera_id:
        query["camera_id"] = camera_id
    if date:
        query["date"] = date

    docs = list(
        _collection.find(query)
        .sort("created_at", -1)
        .limit(limit)
    )
    return [_doc_to_dict(d) for d in docs]


@recording_router.get("/cameras")
def list_recording_cameras():
    """Return distinct camera IDs that have recordings."""
    return _collection.distinct("camera_id")


@recording_router.get("/{camera_id}")
def list_camera_recordings(camera_id: str, date: str = Query(None)):
    """List recordings for a specific camera."""
    query = {"camera_id": camera_id}
    if date:
        query["date"] = date
    docs = list(_collection.find(query).sort("created_at", -1))
    return [_doc_to_dict(d) for d in docs]


@recording_router.get("/play")
def play_recording(
    camera_id:  str = Query(...),
    date:       str = Query(...),
    start_time: str = Query(...),
):
    """
    Decrypt and stream a recording.
    Example: /api/recordings/play?camera_id=192_168_1_1&date=2025-06-01&start_time=14-30-00
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decryption failed: {e}")

    return StreamingResponse(stream, media_type="video/mp4")


@recording_router.post("/decrypt-file")
async def decrypt_file(file: UploadFile = File(...)):
    """
    Decrypt a user-uploaded .enc file and return as MP4.
    Used for playing encrypted video files from local storage.
    """
    try:
        encrypted_data = await file.read()
        decrypted_stream = _decrypt_bytes(encrypted_data)
        
        # Extract filename without extension for download
        filename = file.filename or "video.mp4"
        if filename.endswith(".enc"):
            filename = filename[:-4] + ".mp4"
        elif not filename.endswith(".mp4"):
            filename = filename + ".mp4"
        
        return StreamingResponse(
            decrypted_stream,
            media_type="video/mp4",
            headers={"Content-Disposition": f"inline; filename={filename}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decryption failed: {str(e)}")


@recording_router.get("/status")
def recorder_status():
    """Returns which cameras are actively being recorded."""
    active = [
        name
        for name, thread in recorder._recorders.items()
        if thread.is_alive()
    ]
    return {"active_recorders": active, "count": len(active)}


@recording_router.post("/start/{stream_name}")
def start_recording(stream_name: str, rtsp_url: str = Query(...)):
    """Manually start recording a camera by stream name."""
    recorder.start_camera(stream_name, rtsp_url)
    return {"message": f"Recording started for {stream_name}"}


@recording_router.post("/stop/{stream_name}")
def stop_recording(stream_name: str):
    """Stop recording a camera."""
    recorder.stop_camera(stream_name)
    return {"message": f"Recording stopped for {stream_name}"}
