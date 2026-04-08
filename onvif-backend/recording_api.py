"""
recording_api.py
----------------
FastAPI router providing recording management endpoints.
Mount this in main.py with:  app.include_router(recording_router)

Endpoints:
  GET  /api/recordings/                    - list all recordings (filterable)
  GET  /api/recordings/cameras             - list cameras with recordings
  GET  /api/recordings/status              - recorder thread status
  GET  /api/recordings/play                - decrypt + stream a recording
  GET  /api/recordings/download            - download a single video as MP4
  GET  /api/recordings/{camera_id}         - list recordings for one camera
  POST /api/recordings/decrypt-file        - decrypt uploaded .enc file
  POST /api/recordings/start/{stream_name} - start recording a camera
  POST /api/recordings/stop/{stream_name}  - stop recording a camera
  POST /api/recordings/export-zip          - export date/time range as zip

  GET  /api/storage/management             - list storage locations + disk info
  POST /api/storage/apply                  - update recording path at runtime (persisted to disk)
  POST /api/storage/collect-nonindexed     - collect non-indexed files
"""

import os
import io
import re
import json
import shutil
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

import rtsp_recorder as recorder

# ------------------------------------------------------------------
# Config
# ------------------------------------------------------------------
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")
KEY_FILE  = os.environ.get("VIDEO_KEY_FILE", "/app/data/video.key")

# Path to a small JSON file that persists the user-chosen recording directory.
# Stored alongside devices.json so it survives container restarts.
_CONFIG_FILE = os.environ.get(
    "RECORDING_CONFIG_FILE",
    "/app/data/recording_config.json"
)

# The container-side base mount point — D:\REC on the host maps here.
# Used to validate and sanitize Windows paths entered in the UI.
_CONTAINER_RECORDINGS_ROOT = os.environ.get("RECORDINGS_DIR", "/recordings")

# ------------------------------------------------------------------
# MongoDB
# ------------------------------------------------------------------
_client     = MongoClient(MONGO_URI)
_db         = _client["mirador-vms"]
_collection = _db["recordings"]

# ------------------------------------------------------------------
# Windows → container path sanitization
# ------------------------------------------------------------------

def _sanitize_path(raw: str) -> str:
    """
    Convert any path the user types into a valid Linux container path.

    Handles all these cases:
      D:\\REC              → /recordings
      D:/REC               → /recordings
      D:\\REC\\subfolder   → /recordings/subfolder
      D:/REC/subfolder     → /recordings/subfolder
      /recordings          → /recordings          (already correct)
      /recordings/subfolder→ /recordings/subfolder (already correct)
      D:\\recordings       → /recordings
      D:/recordings        → /recordings

    The rule: any Windows drive-letter path whose first folder is REC or
    recordings gets mapped to _CONTAINER_RECORDINGS_ROOT.  Everything after
    that first folder becomes a subfolder of the container root.
    """
    path = raw.strip()

    # Detect Windows path:  X:\...  or  X:/...
    win_match = re.match(r'^[A-Za-z]:[/\\](.*)$', path)
    if win_match:
        # Everything after the drive letter + separator
        rest = win_match.group(1).replace("\\", "/")

        # Strip the first component if it's the known mount folder
        # (REC, recordings, recording — whatever the host folder is called)
        parts = rest.split("/")
        first = parts[0].lower() if parts else ""
        if first in ("rec", "recordings", "recording"):
            subfolder = "/".join(parts[1:])
        else:
            # Unknown Windows path — use the whole thing as a subfolder
            subfolder = rest

        path = _CONTAINER_RECORDINGS_ROOT.rstrip("/")
        if subfolder:
            path = f"{path}/{subfolder}"
        return path

    # Already a Linux path — just normalise backslashes (shouldn't happen,
    # but be safe) and return as-is.
    return path.replace("\\", "/")


# ------------------------------------------------------------------
# Recording path persistence helpers
# ------------------------------------------------------------------

def _load_persisted_recording_path() -> str | None:
    """Read the saved recording path from disk (if any)."""
    try:
        with open(_CONFIG_FILE) as f:
            data = json.load(f)
            saved = data.get("recording_path") or None
            if saved:
                # Re-sanitize on load in case an old bad value was stored
                sanitized = _sanitize_path(saved)
                if sanitized != saved:
                    print(f"[CONFIG] 🔧 Sanitizing stored path: {saved!r} → {sanitized!r}")
                return sanitized
            return None
    except Exception:
        return None


def _save_recording_path(path: str):
    """Persist the recording path to disk so it survives restarts."""
    try:
        os.makedirs(os.path.dirname(os.path.abspath(_CONFIG_FILE)), exist_ok=True)
        existing = {}
        try:
            with open(_CONFIG_FILE) as f:
                existing = json.load(f)
        except Exception:
            pass
        existing["recording_path"] = path
        with open(_CONFIG_FILE, "w") as f:
            json.dump(existing, f, indent=2)
        print(f"[CONFIG] 💾 Recording path persisted: {path}")
    except Exception as e:
        print(f"[CONFIG] ⚠ Could not persist recording path: {e}")


def _apply_persisted_path_on_startup():
    """
    Called once at import time.
    If a recording path was previously saved, apply it to the recorder
    so recordings go to the right place immediately on startup.
    """
    saved = _load_persisted_recording_path()
    if saved:
        print(f"[CONFIG] ▶ Restoring saved recording path: {saved}")
        recorder.set_recordings_dir(saved)
    else:
        # Ensure the default container path exists
        default = recorder.get_recordings_dir()
        try:
            os.makedirs(default, exist_ok=True)
            print(f"[CONFIG] ▶ Using default recording path: {default}")
        except Exception as e:
            print(f"[CONFIG] ⚠ Could not create default recording dir: {e}")


# Apply persisted path as soon as this module is imported
_apply_persisted_path_on_startup()


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
# ------------------------------------------------------------------
_CORS_HEADERS = {
    "Access-Control-Allow-Origin":   "*",
    "Access-Control-Allow-Methods":  "GET, OPTIONS",
    "Access-Control-Allow-Headers":  "*",
    "Access-Control-Expose-Headers": "Content-Length, Content-Type, Accept-Ranges, Content-Disposition",
    "Vary":                          "Origin",
    "Cache-Control":                 "no-store",
}

# ------------------------------------------------------------------
# Routers
# ------------------------------------------------------------------
recording_router = APIRouter(prefix="/api/recordings", tags=["recordings"])
storage_router   = APIRouter(prefix="/api/storage",    tags=["storage"])

class ExportZipRequest(BaseModel):
    camera_id:  str
    start_date: str
    end_date:   str
    start_hour: int = 0
    end_hour:   int = 23

class StorageApplyRequest(BaseModel):
    location:       str | None = None
    folder:         str | None = None
    allocated:      int | None = None
    recording_path: str | None = None

def _doc_to_dict(doc: dict) -> dict:
    doc.pop("_id", None)
    if "created_at" in doc and hasattr(doc["created_at"], "isoformat"):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc

# ==================================================================
# STORAGE ROUTES
# ==================================================================

@storage_router.get("/management")
def get_storage_management():
    """
    Return real disk usage info for the current recording directory.
    Always returns the live recording path from the recorder (which includes
    any persisted override), so the UI shows the correct path after restart.
    """
    rec_dir = recorder.get_recordings_dir()

    try:
        usage    = shutil.disk_usage(rec_dir if os.path.exists(rec_dir) else "/")
        total_gb = round(usage.total / (1024 ** 3), 1)
        used_gb  = round(usage.used  / (1024 ** 3), 1)
        free_gb  = round(usage.free  / (1024 ** 3), 1)
    except Exception:
        total_gb, used_gb, free_gb = 0, 0, 0

    # Show the Windows-friendly display path in the UI
    display_path = _container_to_display_path(rec_dir)

    return [{
        "location":      display_path,
        "container_path": rec_dir,
        "type":          "Local Disk",
        "total":         total_gb,
        "used":          used_gb,
        "free":          free_gb,
        "allocated":     round(total_gb * 0.9),
        "status":        "Recording" if recorder._recorders else "OK",
        "server":        "MIRADOR",
    }]


def _container_to_display_path(container_path: str) -> str:
    """
    Convert /recordings/subfolder back to D:\\REC\\subfolder for display in the UI.
    This is purely cosmetic — the backend always stores/uses the container path.
    """
    root = _CONTAINER_RECORDINGS_ROOT.rstrip("/")
    if container_path.startswith(root):
        suffix = container_path[len(root):]
        win_suffix = suffix.replace("/", "\\")
        return f"D:\\REC{win_suffix}"
    return container_path


@storage_router.post("/apply")
def apply_storage_settings(req: StorageApplyRequest):
    """
    Update the recording path at runtime AND persist it to disk.

    Accepts both Windows paths (D:\\REC, D:/REC\\subfolder) and
    container paths (/recordings, /recordings/subfolder).

    Windows paths are automatically converted to the correct container path.
    The recorder uses the new path for all subsequent chunks.
    On next backend restart the path is automatically restored.
    """
    raw = (req.recording_path or req.folder or req.location or "").strip()

    if not raw:
        raise HTTPException(status_code=400, detail="No recording path provided.")

    # ── Sanitize: convert Windows paths → container Linux paths ──
    new_path = _sanitize_path(raw)
    print(f"[STORAGE] Apply: raw={raw!r} → sanitized={new_path!r}")

    # Validate / create the directory on the server
    try:
        os.makedirs(new_path, exist_ok=True)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot create recording directory '{new_path}': {e}"
        )

    # Tell the recorder to use this path from now on (in-memory)
    recorder.set_recordings_dir(new_path)

    # Persist the container path to disk so it survives restarts
    _save_recording_path(new_path)

    # Return both paths so the UI can show the Windows-friendly version
    return {
        "ok":             True,
        "recording_path": new_path,
        "display_path":   _container_to_display_path(new_path),
        "message":        f"Recording path updated to: {_container_to_display_path(new_path)}",
    }


@storage_router.post("/collect-nonindexed")
def collect_nonindexed():
    """
    Move files in the recording dir that are not referenced in MongoDB
    into a 'Non-indexed Files' subfolder.
    """
    rec_dir     = recorder.get_recordings_dir()
    non_idx_dir = os.path.join(rec_dir, "Non-indexed Files")
    os.makedirs(non_idx_dir, exist_ok=True)

    moved  = 0
    errors = []

    for root, dirs, files in os.walk(rec_dir):
        if os.path.abspath(root).startswith(os.path.abspath(non_idx_dir)):
            continue
        for fname in files:
            if not fname.endswith(".mp4"):
                continue
            fpath = os.path.join(root, fname)
            in_db = _collection.find_one({"file_path": fpath})
            if not in_db:
                try:
                    dest = os.path.join(non_idx_dir, fname)
                    if os.path.exists(dest):
                        base, ext = os.path.splitext(fname)
                        dest = os.path.join(non_idx_dir, f"{base}_{moved}{ext}")
                    shutil.move(fpath, dest)
                    moved += 1
                except Exception as e:
                    errors.append(str(e))

    return {
        "ok":     True,
        "moved":  moved,
        "errors": errors,
        "folder": non_idx_dir,
    }


# ==================================================================
# RECORDING GET ROUTES
# ==================================================================

@recording_router.get("/")
def list_recordings(
    camera_id: str = Query(None),
    date:      str = Query(None),
    limit:     int = Query(100, le=500),
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
    rec_dir = recorder.get_recordings_dir()
    return {
        "active_recorders": active,
        "count":            len(active),
        "recording_path":   rec_dir,
        "display_path":     _container_to_display_path(rec_dir),
    }

@recording_router.get("/play")
def play_recording(
    camera_id:  str = Query(...),
    date:       str = Query(...),
    start_time: str = Query(...),
    _cb:        str = Query(None),
):
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
            "Content-Length": str(len(data)),
            "Accept-Ranges":  "bytes",
            **_CORS_HEADERS,
        }
    )

@recording_router.get("/download")
def download_recording(
    camera_id:  str = Query(...),
    date:       str = Query(...),
    start_time: str = Query(...),
):
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
# RECORDING POST ROUTES
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