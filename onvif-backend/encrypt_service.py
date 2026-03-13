"""
encrypt_service.py
------------------
Watches RECORDINGS_DIR for completed .mp4 files written by rtsp_recorder.py.
For each completed .mp4 it:
  1. AES-256-CBC encrypts the file  ->  saves as .enc  (IV prepended)
  2. Saves metadata to MongoDB  →  database: mirador-vms / collection: recordings
  3. Saves an encrypted .meta sidecar file
  4. Deletes the original .mp4

Uses polling (every 5s) — reliable on Docker bind mounts (C:/recordings on Windows).
"""

import os
import time
import secrets
import json
import threading
from datetime import datetime
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.backends import default_backend
from pymongo import MongoClient

RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "/recordings")
MONGO_URI      = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")
KEY_FILE       = os.environ.get("VIDEO_KEY_FILE", "/app/data/video.key")
POLL_INTERVAL  = 5

# ------------------------------------------------------------------
# MongoDB — mirador-vms / recordings
# ------------------------------------------------------------------
_mongo_client       = None
metadata_collection = None

def _get_collection():
    global _mongo_client, metadata_collection
    if metadata_collection is None:
        _mongo_client       = MongoClient(MONGO_URI)
        _db                 = _mongo_client["mirador-vms"]       # ← DB name
        metadata_collection = _db["recordings"]                  # ← collection
    return metadata_collection


# ------------------------------------------------------------------
# AES-256 key
# ------------------------------------------------------------------
def load_video_key() -> bytes:
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "rb") as f:
            key = f.read().strip()
        return key[:32].ljust(32, b'\0')
    print("[ENCRYPT] video.key not found — generating new AES-256 key")
    key = secrets.token_bytes(32)
    os.makedirs(os.path.dirname(KEY_FILE), exist_ok=True)
    with open(KEY_FILE, "wb") as f:
        f.write(key)
    print(f"[ENCRYPT] Key saved to {KEY_FILE} — back this up securely!")
    return key

MASTER_KEY = load_video_key()


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
def _aes_encrypt(data: bytes) -> bytes:
    iv     = secrets.token_bytes(16)
    cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CBC(iv), backend=default_backend())
    enc    = cipher.encryptor()
    padder = padding.PKCS7(128).padder()
    padded = padder.update(data) + padder.finalize()
    return iv + enc.update(padded) + enc.finalize()


def _parse_path(input_path: str):
    """
    /recordings/192_168_1_1/2025-06-01/2025-06-01_14-30-00.mp4
    → camera_id = 192_168_1_1
    → date_part  = 2025-06-01
    → time_part  = 14-30-00
    """
    filename  = os.path.basename(input_path)
    date_dir  = os.path.basename(os.path.dirname(input_path))
    camera_id = os.path.basename(os.path.dirname(os.path.dirname(input_path)))
    stem      = filename.replace(".mp4", "")
    parts     = stem.split("_", 1)
    date_part = parts[0] if len(parts) > 1 else date_dir
    time_part = parts[1] if len(parts) > 1 else stem
    return camera_id, date_part, time_part


def _save_metadata_to_db(camera_id, date_part, time_part, output_path):
    try:
        col = _get_collection()
        col.insert_one({
            "camera_id":  camera_id,
            "date":       date_part,
            "start_time": time_part,
            "file_path":  output_path.replace("\\", "/"),
            "file_size":  os.path.getsize(output_path),
            "created_at": datetime.utcnow(),
        })
        print(f"[ENCRYPT] 📄 mirador-vms/recordings ← {camera_id} / {date_part} / {time_part}")
    except Exception as e:
        print(f"[ENCRYPT] MongoDB error: {e}")


def _save_meta_sidecar(camera_id, date_part, time_part, output_path):
    try:
        meta = {
            "camera_id":  camera_id,
            "date":       date_part,
            "start_time": time_part,
            "file_path":  output_path.replace("\\", "/"),
            "file_size":  os.path.getsize(output_path),
            "created_at": datetime.utcnow().isoformat(),
        }
        encrypted = _aes_encrypt(json.dumps(meta).encode())
        with open(output_path.replace(".enc", ".meta"), "wb") as f:
            f.write(encrypted)
    except Exception as e:
        print(f"[ENCRYPT] Meta sidecar error: {e}")


def _is_file_complete(path: str) -> bool:
    try:
        s1 = os.path.getsize(path)
        if s1 == 0:
            return False
        time.sleep(3)
        s2 = os.path.getsize(path)
        return s1 == s2
    except Exception:
        return False


# ------------------------------------------------------------------
# Core encrypt
# ------------------------------------------------------------------
def encrypt_file(input_path: str) -> bool:
    try:
        camera_id, date_part, time_part = _parse_path(input_path)
    except Exception as e:
        print(f"[ENCRYPT] Path parse error {input_path}: {e}")
        return False

    out_dir     = os.path.join(RECORDINGS_DIR, camera_id, date_part)
    os.makedirs(out_dir, exist_ok=True)
    output_path = os.path.join(out_dir, f"{time_part}.enc")

    try:
        with open(input_path, "rb") as f:
            data = f.read()
        with open(output_path, "wb") as f:
            f.write(_aes_encrypt(data))
        print(f"[ENCRYPT] ✅ Encrypted: {output_path}")
    except Exception as e:
        print(f"[ENCRYPT] ❌ Encryption failed {input_path}: {e}")
        return False

    _save_metadata_to_db(camera_id, date_part, time_part, output_path)
    _save_meta_sidecar(camera_id, date_part, time_part, output_path)

    for _ in range(10):
        try:
            os.remove(input_path)
            print(f"[ENCRYPT] 🗑  Deleted original: {input_path}")
            return True
        except Exception:
            time.sleep(2)

    print(f"[ENCRYPT] Could not delete {input_path} — encryption done anyway")
    return True


# ------------------------------------------------------------------
# Polling loop
# ------------------------------------------------------------------
_seen_files = set()
_stop_event = threading.Event()


def _scan_and_encrypt():
    for root, dirs, files in os.walk(RECORDINGS_DIR):
        for fname in files:
            if not fname.lower().endswith(".mp4"):
                continue
            full_path = os.path.join(root, fname)
            if full_path in _seen_files:
                continue
            _seen_files.add(full_path)
            if _is_file_complete(full_path):
                print(f"[ENCRYPT] 🎬 Found completed mp4: {full_path}")
                encrypt_file(full_path)
            else:
                _seen_files.discard(full_path)


def _poll_loop():
    print(f"[ENCRYPT] Polling {RECORDINGS_DIR} every {POLL_INTERVAL}s")
    os.makedirs(RECORDINGS_DIR, exist_ok=True)
    while not _stop_event.is_set():
        try:
            _scan_and_encrypt()
        except Exception as e:
            print(f"[ENCRYPT] Poll error: {e}")
        _stop_event.wait(POLL_INTERVAL)


_poll_thread = None

def start_watcher():
    global _poll_thread
    _stop_event.clear()
    _poll_thread = threading.Thread(target=_poll_loop, daemon=True, name="encrypt-poller")
    _poll_thread.start()
    print("[ENCRYPT] Encryption service started")

def stop_watcher():
    _stop_event.set()
    if _poll_thread:
        _poll_thread.join(timeout=10)

if __name__ == "__main__":
    start_watcher()
    try:
        while True:
            time.sleep(5)
    except KeyboardInterrupt:
        stop_watcher()