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
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, BackgroundTasks, Depends, Request
from jwt_auth import verify_token
from fastapi.responses import StreamingResponse, FileResponse, Response
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

# ── Startup sanity check: warn loudly if the key file is missing ──────────────
# Both this module and encrypt_service.py MUST use the same KEY_FILE path.
# They both default to /app/data/video.key, controlled by VIDEO_KEY_FILE env var.
if not os.path.exists(KEY_FILE):
    print(f"[DECRYPT] ⚠⚠⚠  WARNING: video.key NOT FOUND at '{KEY_FILE}'")
    print(f"[DECRYPT]          Set VIDEO_KEY_FILE env var to the correct path,")
    print(f"[DECRYPT]          or ensure it matches the path used by encrypt_service.py")
else:
    print(f"[DECRYPT] ✅ video.key found at '{KEY_FILE}'")

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
storage_collection = _db["storage_settings"]
locations_collection = _db["storage_locations"]
schedules_collection = _db["schedules"]

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


def _load_recording_path_from_db():
    try:
        doc = storage_collection.find_one({"type": "recording_path"})
        if doc:
            return doc.get("recording_path")
    except Exception as e:
        print("[CONFIG] DB load failed:", e)
    return None


def _apply_persisted_path_on_startup():

    # ✅ FIRST: try DB
    saved = _load_recording_path_from_db()

    # fallback to file
    if not saved:
        saved = _load_persisted_recording_path()

    if saved:
        print(f"[CONFIG] ▶ Loaded from DB: {saved}")
        recorder.set_recordings_dir(saved)
    else:
        default = recorder.get_recordings_dir()
        os.makedirs(default, exist_ok=True)
        print(f"[CONFIG] ▶ Using default path: {default}")


# Apply persisted path as soon as this module is imported
_apply_persisted_path_on_startup()


# ------------------------------------------------------------------
# AES key + decrypt helpers
# ------------------------------------------------------------------

# MP4 magic bytes used to validate decryption produced a real video file.
# ftyp box: bytes 4-7 == b'ftyp'  OR  starts with moov/mdat/free box type.
_MP4_SIGNATURES = (
    b'ftypisom', b'ftypmp42', b'ftypMSNV', b'ftypM4V ', b'ftypM4A ',
    b'ftypf4v ', b'ftypf4p ', b'ftypavc1', b'ftypFACE', b'ftypdash',
    b'ftypiso2', b'ftypiso5', b'ftypiso6', b'ftypmp41', b'ftyp',
)

def _validate_mp4(data: bytes, label: str = "") -> None:
    """
    Raise ValueError if `data` does not look like an MP4 file.
    Checks the standard 'ftyp' box at bytes 4–8, which every valid
    MP4/MOV produced by ffmpeg will have.
    """
    if len(data) < 12:
        raise ValueError(f"[DECRYPT]{label} Output too small ({len(data)} bytes) — decryption key mismatch?")
    # The ftyp box is: [4-byte size][4-byte 'ftyp'][4-byte brand]
    # size is big-endian and usually 0x00000018 (24) or similar
    box_type = data[4:8]
    if box_type not in (b'ftyp', b'moov', b'mdat', b'free', b'skip', b'wide'):
        raise ValueError(
            f"[DECRYPT]{label} Output is not a valid MP4 "
            f"(bytes[4:8]={box_type!r}). Wrong decryption key?"
        )

def _load_key() -> bytes:
    """
    Load the AES-256 key from KEY_FILE.
    This MUST use the same file path as encrypt_service.py → load_video_key().
    Both default to /app/data/video.key — controlled by VIDEO_KEY_FILE env var.
    NO .strip() — binary keys are read verbatim; stripping corrupts keys whose
    last byte happens to be 0x0a/0x0d, producing a silent AES key mismatch.
    """
    if not os.path.exists(KEY_FILE):
        raise RuntimeError(
            f"video.key not found at {KEY_FILE}. "
            "Set VIDEO_KEY_FILE env var to match encrypt_service.py, "
            "or ensure /app/data/video.key exists."
        )
    with open(KEY_FILE, "rb") as f:
        key = f.read()          # ← NO .strip()
    if len(key) < 1:
        raise RuntimeError(f"video.key at {KEY_FILE} is empty!")
    result = key[:32].ljust(32, b'\0')
    print(f"[DECRYPT] 🔑 Using key from {KEY_FILE} ({len(key)} bytes raw)")
    return result

def decrypt_bytes(raw: bytes) -> io.BytesIO:
    """Decrypt AES-256 encrypted bytes and return a BytesIO of the plaintext."""
    if not raw or len(raw) <= 16:
        raise ValueError("Encrypted payload must be larger than 16 bytes")
    key        = _load_key()
    
    is_ctr = raw.startswith(b'CTR\x00')
    if is_ctr:
        iv = raw[4:20]
        ciphertext = raw[20:]
        cipher = Cipher(algorithms.AES(key), modes.CTR(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        data = decryptor.update(ciphertext) + decryptor.finalize()
    else:
        iv         = raw[:16]
        ciphertext = raw[16:]
        
        # Resilient handling for truncated files (e.g. stopped mid-block or aborted transfers)
        extra = len(ciphertext) % 16
        if extra != 0:
            ciphertext = ciphertext[:-extra]

        cipher     = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
        dec        = cipher.decryptor()
        padded     = dec.update(ciphertext) + dec.finalize()
        
        try:
            unpadder   = padding.PKCS7(128).unpadder()
            data       = unpadder.update(padded) + unpadder.finalize()
        except Exception:
            # Fall back to using raw decrypted bytes if padding is invalid (common on truncated files)
            data       = padded
            
    is_ts = len(data) > 0 and data[0] == 0x47
    if not is_ts:
        _validate_mp4(data)   # ← catch wrong-key silently-corrupt output early
    return io.BytesIO(data)

def _decrypt(file_path: str) -> io.BytesIO:
    """Decrypt a .enc file on disk and return BytesIO of the MP4 payload."""
    with open(file_path, "rb") as f:
        raw = f.read()
    try:
        return decrypt_bytes(raw)
    except Exception as e:
        raise RuntimeError(f"Failed to decrypt {file_path}: {e}") from e

def remux_ts_to_mp4(ts_data: bytes) -> bytes:
    """
    Synchronously remux MPEG-TS bytes to standard MP4 bytes using ffmpeg.
    Uses copy mode (-c copy) so it's extremely fast and light.
    """
    import subprocess
    if len(ts_data) > 0 and ts_data[0] == 0x47:
        try:
            proc = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "quiet", "-i", "pipe:0", "-c", "copy", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "pipe:1"],
                input=ts_data,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=30
            )
            if proc.returncode == 0 and len(proc.stdout) > 0:
                return proc.stdout
        except Exception as e:
            print(f"[REMUX] Remuxing failed: {e}")
    return ts_data

def decrypt_stream(file_path: str):
    """
    Generator that decrypts an .enc file in chunks.
    Allows browsers to start playing immediately as data arrives.
    """
    if not os.path.exists(file_path):
        return

    key = _load_key()
    with open(file_path, "rb") as f:
        header = f.read(4)
        is_ctr = header == b'CTR\x00'
        
        if is_ctr:
            iv = f.read(16)
            cipher = Cipher(algorithms.AES(key), modes.CTR(iv), backend=default_backend())
        else:
            f.seek(0)
            iv = f.read(16)
            if not iv or len(iv) < 16:
                return
            cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
            
        dec = cipher.decryptor()
        
        while True:
            chunk = f.read(128 * 1024) # 128KB chunks
            if not chunk:
                break
            yield dec.update(chunk)
        
        try:
            yield dec.finalize()
        except:
            pass

def _decrypt_bytes(encrypted_bytes: bytes) -> io.BytesIO:
    """Decrypt raw encrypted bytes (from an uploaded file) and return BytesIO."""
    try:
        key = _load_key()
    except Exception as e:
        print(f"[DECRYPT] Key load failed: {e}")
        raise HTTPException(status_code=500, detail="Encryption key (video.key) not found on server.")

    if len(encrypted_bytes) < 16:
        raise HTTPException(status_code=400, detail="Invalid encrypted file (too small).")

    try:
        is_ctr = encrypted_bytes.startswith(b'CTR\x00')
        if is_ctr:
            iv = encrypted_bytes[4:20]
            ciphertext = encrypted_bytes[20:]
            cipher = Cipher(algorithms.AES(key), modes.CTR(iv), backend=default_backend())
            dec = cipher.decryptor()
            data = dec.update(ciphertext) + dec.finalize()
        else:
            iv         = encrypted_bytes[:16]
            ciphertext = encrypted_bytes[16:]
            cipher     = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
            dec        = cipher.decryptor()
            padded     = dec.update(ciphertext) + dec.finalize()
            unpadder   = padding.PKCS7(128).unpadder()
            data       = unpadder.update(padded) + unpadder.finalize()
            
        _validate_mp4(data)   # ← catch wrong-key silently-corrupt output early
        return io.BytesIO(data)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[DECRYPT] Decryption failed: {e}")
        raise HTTPException(status_code=400, detail=f"Decryption failed: {e}. Check if video.key matches.")

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
recording_router = APIRouter(prefix="/api/recordings", tags=["recordings"], dependencies=[Depends(verify_token)])
storage_router   = APIRouter(prefix="/api/storage",    tags=["storage"], dependencies=[Depends(verify_token)])

class ExportZipRequest(BaseModel):
    camera_id:  str
    start_date: str
    end_date:   str
    start_time: str = "00:00"
    end_time:   str = "23:59"

class StorageApplyRequest(BaseModel):
    location:       str | None = None
    folder:         str | None = None
    allocated:      int | None = None
    recording_path: str | None = None

class StorageLocation(BaseModel):
    display_path:   str
    container_path: str
    allocated:      int = 100

class Schedule(BaseModel):
    id:         str | int
    name:       str
    week:       dict[str, list[bool]]
    ranges:     dict[str, str] = {} # Human-readable strings for Compass
    exceptions: list[str] = [] # ISO dates

class AssignScheduleRequest(BaseModel):
    camera_id:   str
    schedule_id: str | int | None

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

    # Return all persisted locations
    all_locs = list(locations_collection.find())
    if not all_locs:
        # Fallback to current if none persisted
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

    results = []
    for loc in all_locs:
        c_path = loc["container_path"]
        try:
            u    = shutil.disk_usage(c_path if os.path.exists(c_path) else "/")
            t_gb = round(u.total / (1024 ** 3), 1)
            u_gb = round(u.used  / (1024 ** 3), 1)
            f_gb = round(u.free  / (1024 ** 3), 1)
        except:
            t_gb, u_gb, f_gb = 0, 0, 0
        
        results.append({
            "location":       loc["display_path"],
            "container_path": c_path,
            "type":           "Local Disk",
            "total":          t_gb,
            "used":           u_gb,
            "free":           f_gb,
            "allocated":      loc.get("allocated", 100),
            "status":         "Recording" if c_path == rec_dir else "OK",
            "server":         "MIRADOR",
        })
    return results

@storage_router.post("/locations")
def add_storage_location(loc: StorageLocation):
    sanitized = _sanitize_path(loc.container_path)
    locations_collection.update_one(
        {"container_path": sanitized},
        {"$set": {
            "display_path": loc.display_path,
            "container_path": sanitized,
            "allocated": loc.allocated,
            "updated_at": datetime.utcnow()
        }},
        upsert=True
    )
    return {"message": "Location added"}

@storage_router.delete("/locations")
def remove_storage_location(container_path: str = Query(...)):
    locations_collection.delete_one({"container_path": container_path})
    return {"message": "Location removed"}


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

    raw_path = req.recording_path or req.folder or req.location

    if not raw_path:
        raise HTTPException(status_code=400, detail="No path provided")

    # ✅ Convert Windows → container path
    sanitized = _sanitize_path(raw_path)

    # ✅ Apply to recorder (THIS IS MAIN)
    recorder.set_recordings_dir(sanitized)

    # ✅ SAVE TO MONGODB (NEW)
    storage_collection.update_one(
        {"type": "recording_path"},
        {
            "$set": {
                "recording_path": sanitized,
                "updated_at": datetime.utcnow()
            }
        },
        upsert=True
    )

    # ✅ Optional (keep your existing file backup)
    _save_recording_path(sanitized)

    # ✅ Ensure it is in locations_collection
    display_path = _container_to_display_path(sanitized)
    locations_collection.update_one(
        {"container_path": sanitized},
        {"$set": {
            "display_path": display_path,
            "container_path": sanitized,
            "allocated": req.allocated or 100,
            "updated_at": datetime.utcnow()
        }},
        upsert=True
    )

    return {
        "message": "Recording path updated successfully",
        "recording_path": sanitized,
        "display_path": display_path
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
# SCHEDULE ROUTES
# ==================================================================

@storage_router.get("/schedules")
def list_schedules():
    docs = list(schedules_collection.find())
    for d in docs:
        d["id"] = str(d.get("id", d["_id"]))
        d.pop("_id", None)
    return docs

@storage_router.post("/schedules")
def save_schedule(sch: Schedule):
    data = sch.dict()
    # Force ID to string for consistency in DB
    sch_id = str(data["id"])
    data["id"] = sch_id 
    
    schedules_collection.update_one(
        {"id": sch_id},
        {"$set": data},
        upsert=True
    )
    return {"message": "Schedule saved", "id": sch_id}

@storage_router.delete("/schedules/{sch_id}")
def delete_schedule(sch_id: str):
    # Try to delete by both string and numeric ID for legacy support
    try:
        numeric_id = int(sch_id)
        schedules_collection.delete_many({"id": {"$in": [str(sch_id), numeric_id]}})
    except (ValueError, TypeError):
        schedules_collection.delete_one({"id": str(sch_id)})
    
    # Also, find any cameras assigned to this schedule and reset them to 'always'
    _db["cameras"].update_many(
        {"assigned_schedule_id": sch_id},
        {"$set": {"assigned_schedule_id": "always"}}
    )
    # Re-sync with recorder
    for cam in _db["cameras"].find({"assigned_schedule_id": "always"}):
        recorder.update_camera_data(cam["ome_stream"], {"assigned_schedule_id": "always"})

    return {"message": "Schedule deleted and assignments reset"}

@recording_router.post("/assign-schedule")
def assign_schedule(req: AssignScheduleRequest):
    # Update camera in 'cameras' collection
    _db["cameras"].update_one(
        {"ome_stream": req.camera_id},
        {"$set": {"assigned_schedule_id": req.schedule_id}}
    )
    # Also update in recorder if active
    recorder.update_camera_data(req.camera_id, {"assigned_schedule_id": req.schedule_id})
    
    return {"message": "Schedule assigned to camera"}


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
    # Only return .enc files, not .meta or .mp4
    query["file_path"] = {"$regex": "\\.enc$"}
    docs = list(_collection.find(query).sort("created_at", -1))
    return [_doc_to_dict(d) for d in docs]

@recording_router.get("/cameras")
def list_recordings_cameras():
    """
    Return the names of folders (camera IPs/IDs) found ONLY on disk storage paths.
    This matches the "File Explorer" view requested by the user.
    """
    results = set()
    
    # Scan configured storage locations for folder names
    locs = list(locations_collection.find())
    scan_paths = [l["container_path"] for l in locs]
    rec_dir = recorder.get_recordings_dir()
    if rec_dir not in scan_paths:
        scan_paths.append(rec_dir)

    for path in scan_paths:
        if not os.path.exists(path):
            continue
        try:
            for entry in os.listdir(path):
                full_path = os.path.join(path, entry)
                if os.path.isdir(full_path):
                    if entry not in ("Non-indexed Files", "lost+found", "Config"):
                        results.add(entry)
        except:
            pass

    return sorted(list(results))

@recording_router.get("/status")
def recorder_status():
    active = [
        name
        for name, thread in recorder._recorders.items()
        if thread.is_alive() and name in getattr(recorder, '_actively_recording_streams', set())
    ]
    rec_dir = recorder.get_recordings_dir()
    return {
        "active_recorders": active,
        "count":            len(active),
        "recording_path":   rec_dir,
        "display_path":     _container_to_display_path(rec_dir),
    }

def _parse_range_header(range_header: str, file_size: int):
    if not range_header or not range_header.startswith("bytes="):
        return 0, max(0, file_size - 1)
    
    try:
        ranges = range_header.replace("bytes=", "").split("-")
        start_str = ranges[0].strip() if len(ranges) > 0 else ""
        end_str = ranges[1].strip() if len(ranges) > 1 else ""
        
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
        
        start = max(0, start)
        end = min(file_size - 1, end)
        return start, end
    except Exception:
        return 0, max(0, file_size - 1)

@recording_router.get("/play")
def play_recording(
    request: Request,
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

    # Check for empty/corrupted legacy files
    file_size_on_disk = os.path.getsize(enc_path)
    if file_size_on_disk < 100:
        raise HTTPException(status_code=415, detail="Recording is empty or corrupted")

    try:
        key = _load_key()
        
        # Determine if it's CTR or CBC
        with open(enc_path, "rb") as f:
            header = f.read(4)
            is_ctr = header == b'CTR\x00'
            
        if is_ctr:
            # Check if it is MPEG-TS (starts with 0x47 in first decrypted block)
            with open(enc_path, "rb") as f:
                f.seek(4)
                iv = f.read(16)
                f.seek(20)
                first_block = f.read(16)
                
            is_ts = False
            if len(first_block) > 0:
                cipher = Cipher(algorithms.AES(key), modes.CTR(iv), backend=default_backend())
                decryptor = cipher.decryptor()
                decrypted_block = decryptor.update(first_block) + decryptor.finalize()
                is_ts = len(decrypted_block) > 0 and decrypted_block[0] == 0x47
                
            if is_ts:
                # Dynamic TS -> MP4 remuxing stream
                def stream_ts_as_mp4():
                    import subprocess
                    import threading
                    
                    ffmpeg_cmd = [
                        "ffmpeg", "-y", "-loglevel", "quiet",
                        "-i", "pipe:0",
                        "-c", "copy",
                        "-f", "mp4",
                        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
                        "pipe:1"
                    ]
                    
                    proc = subprocess.Popen(
                        ffmpeg_cmd,
                        stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL
                    )
                    
                    def feed_input():
                        try:
                            with open(enc_path, "rb") as f_in:
                                f_in.seek(4)
                                file_iv = f_in.read(16)
                                decrypt_cipher = Cipher(algorithms.AES(key), modes.CTR(file_iv), backend=default_backend())
                                dec = decrypt_cipher.decryptor()
                                
                                f_in.seek(20)
                                while True:
                                    chunk = f_in.read(128 * 1024)
                                    if not chunk:
                                        break
                                    proc.stdin.write(dec.update(chunk))
                                proc.stdin.write(dec.finalize())
                        except Exception as feed_err:
                            print(f"[PLAY] Error feeding stdin to ffmpeg: {feed_err}")
                        finally:
                            try:
                                proc.stdin.close()
                            except:
                                pass
                                
                    threading.Thread(target=feed_input, daemon=True).start()
                    
                    while True:
                        chunk = proc.stdout.read(64 * 1024)
                        if not chunk:
                            break
                        yield chunk
                    proc.wait()
                    
                headers = {
                    "Content-Type": "video/mp4",
                    "Cache-Control": "no-store",
                    **_CORS_HEADERS
                }
                return StreamingResponse(stream_ts_as_mp4(), headers=headers)

            # For standard MP4 CTR files, serve them dynamically without reading the whole file!
            file_size_on_disk = os.path.getsize(enc_path)
            # 20 bytes is the header + iv
            real_file_size = file_size_on_disk - 20 
            
            range_header = request.headers.get("range")
            start_byte, end_byte = _parse_range_header(range_header, real_file_size)
            chunk_size = end_byte - start_byte + 1
            
            def stream_ctr():
                with open(enc_path, "rb") as f:
                    f.seek(4)
                    iv = f.read(16)
                    # For AES-CTR, calculate new IV based on block offset
                    block_index = start_byte // 16
                    new_iv_int = int.from_bytes(iv, 'big') + block_index
                    new_iv = new_iv_int.to_bytes(16, 'big')
                    cipher = Cipher(algorithms.AES(key), modes.CTR(new_iv), backend=default_backend())
                    decryptor = cipher.decryptor()
                    
                    # Read the partial block if start_byte is not aligned
                    offset_in_block = start_byte % 16
                    if offset_in_block != 0:
                        f.seek(20 + start_byte - offset_in_block)
                        discard_chunk = f.read(offset_in_block)
                        decryptor.update(discard_chunk) # push cipher state forward
                        
                    # Seek to actual start byte
                    f.seek(20 + start_byte)
                    bytes_remaining = chunk_size
                    while bytes_remaining > 0:
                        to_read = min(128 * 1024, bytes_remaining)
                        chunk = f.read(to_read)
                        if not chunk:
                            break
                        yield decryptor.update(chunk)
                        bytes_remaining -= len(chunk)
            
            headers = {
                "Content-Range": f"bytes {start_byte}-{end_byte}/{real_file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
                "Content-Type": "video/mp4",
                "Cache-Control": "no-store",
                **_CORS_HEADERS
            }
            status_code = 206 if range_header else 200
            return StreamingResponse(stream_ctr(), status_code=status_code, headers=headers)
            
        else:
            # Fallback for CBC: Decrypt the whole file into memory first, then slice
            stream = _decrypt(enc_path)
            data = stream.getvalue()
            real_file_size = len(data)
            
            range_header = request.headers.get("range")
            start_byte, end_byte = _parse_range_header(range_header, real_file_size)
            chunk_size = end_byte - start_byte + 1
            
            headers = {
                "Content-Range": f"bytes {start_byte}-{end_byte}/{real_file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
                "Content-Type": "video/mp4",
                "Cache-Control": "no-store",
                **_CORS_HEADERS
            }
            status_code = 206 if range_header else 200
            return Response(
                content=data[start_byte:end_byte + 1],
                status_code=status_code,
                headers=headers
            )
            
    except Exception as e:
        with open("/recordings/error_log.txt", "w") as f:
            import traceback
            f.write(traceback.format_exc())
        print(f"[PLAY] ❌ {enc_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Decryption failed: {e}")

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
        data   = remux_ts_to_mp4(data)
    except Exception as e:
        print(f"[DOWNLOAD] ❌ {enc_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Decryption failed: {e}")

    if not data:
        raise HTTPException(status_code=500, detail="Decryption produced empty output — key mismatch?")

    # Sanitize filename: replace colons/slashes that break VLC on Windows
    safe_time = start_time.replace(":", "-").replace("/", "-")
    safe_date = date.replace("/", "-")
    safe_cam  = re.sub(r'[^\w\-.]', '_', camera_id)
    filename  = f"{safe_cam}_{safe_date}_{safe_time}.mp4"

    return Response(
        content=data,
        media_type="video/mp4",
        headers={
            # Simple quoted filename is most compatible for downloads
            "Content-Disposition": f"attachment; filename=\"{filename}\"",
            "Content-Length":      str(len(data)),
            "Content-Type":        "video/mp4",
            "Accept-Ranges":       "bytes",
            "Cache-Control":       "no-store",
            **_CORS_HEADERS,
        }
    )

@recording_router.get("/{camera_id_or_path}")
def list_camera_recordings(camera_id_or_path: str, date: str = Query(None)):
    # Try as camera_id first
    query = {"camera_id": camera_id_or_path}
    if date:
        query["date"] = date
    docs = list(_collection.find(query).sort("created_at", -1))
    
    if not docs:
        # Try as a storage path / folder name
        # We search for recordings whose file_path contains this folder name
        # or starts with the container_path of a storage location.
        loc = locations_collection.find_one({"display_path": camera_id_or_path})
        c_path = loc["container_path"] if loc else camera_id_or_path
        
        # Regex to find the folder name anywhere in the path, surrounded by slashes or at boundaries
        # Also handle potential leading slash in the database file_path
        safe_name = re.escape(c_path.replace("\\", "/"))
        # Only return .enc files, not .meta or .mp4
        query = {
            "$and": [
                {"file_path": {"$regex": f"/{safe_name}/|^{safe_name}/"}},
                {"file_path": {"$regex": "\\.enc$"}}
            ]
        }
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


@recording_router.post("/export-zip")
def export_zip(request: ExportZipRequest, background_tasks: BackgroundTasks):
    try:
        start = datetime.strptime(request.start_date, "%Y-%m-%d")
        end   = datetime.strptime(request.end_date,   "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    if start > end:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date")

    def normalize_time(t_str: str) -> str:
        """Convert HH-MM-SS or HH:MM:SS to HH:MM for comparison."""
        if not t_str: return "00:00"
        clean = t_str.replace('_', ':').replace('-', ':')
        parts = clean.split(':')
        if len(parts) >= 2:
            return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}"
        return "00:00"

    req_start = request.start_time if ":" in request.start_time else f"{str(request.start_time).zfill(2)}:00"
    req_end   = request.end_time   if ":" in request.end_time   else f"{str(request.end_time).zfill(2)}:59"

    current_date = start
    all_docs     = []
    while current_date <= end:
        date_str = current_date.strftime("%Y-%m-%d")
        docs     = list(_collection.find({"camera_id": request.camera_id, "date": date_str}))
        for doc in docs:
            doc_time = normalize_time(doc.get("start_time", ""))
            if req_start <= doc_time <= req_end:
                all_docs.append(doc)
        current_date += timedelta(days=1)

    if not all_docs:
        raise HTTPException(status_code=404, detail="No recordings found for the specified range")

    temp_zip = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    zip_path = temp_zip.name
    temp_zip.close()

    decrypt_errors = []
    try:
        file_count = 0
        # ZIP_STORED (no compression) — MP4/H.264 is already compressed.
        # ZIP_DEFLATED wastes CPU and can corrupt the moov atom alignment
        # that some players rely on, causing VLC to reject the file.
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_STORED) as zf:
            for doc in all_docs:
                enc_path = (doc.get("file_path", "") or "").replace("\\", "/")
                if not enc_path or not os.path.exists(enc_path):
                    decrypt_errors.append(f"File missing: {enc_path}")
                    continue

                try:
                    decrypted_data = _decrypt(enc_path).getvalue()
                    decrypted_data = remux_ts_to_mp4(decrypted_data)
                except Exception as dec_err:
                    decrypt_errors.append(f"Decrypt failed for {enc_path}: {dec_err}")
                    print(f"[EXPORT-ZIP] ❌ {enc_path}: {dec_err}")
                    continue

                if not decrypted_data or len(decrypted_data) < 32:
                    decrypt_errors.append(f"Empty output for {enc_path}")
                    continue

                # Sanitize filename components so VLC/Windows can open them
                safe_cam  = re.sub(r'[^\w\-.]', '_', doc.get('camera_id', 'cam'))
                safe_date = (doc.get('date', '') or '').replace('/', '-')
                safe_time = (doc.get('start_time', '') or '').replace(':', '-').replace('/', '-')
                out_name  = f"{safe_cam}_{safe_date}_{safe_time}.mp4"

                zf.writestr(out_name, decrypted_data)
                file_count += 1
                print(f"[EXPORT-ZIP] ✅ Added {out_name} ({len(decrypted_data):,} bytes)")

        if file_count == 0:
            if os.path.exists(zip_path): os.unlink(zip_path)
            detail = "No recordings could be decrypted."
            if decrypt_errors:
                detail += " Errors: " + "; ".join(decrypt_errors[:3])
            raise HTTPException(status_code=404, detail=detail)

        if decrypt_errors:
            print(f"[EXPORT-ZIP] ⚠ {len(decrypt_errors)} file(s) skipped: {decrypt_errors}")

        background_tasks.add_task(os.unlink, zip_path)
        return FileResponse(
            path=zip_path,
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename=\"recordings_{request.start_date}_to_{request.end_date}.zip\"",
                "Cache-Control":       "no-store",
                **_CORS_HEADERS,
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(zip_path): os.unlink(zip_path)
        raise HTTPException(status_code=500, detail=f"Failed to create zip: {e}")
