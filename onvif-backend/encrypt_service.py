"""
encrypt_service.py — fixed MongoDB connection + synced recording path
"""

import os
import io
import re
import time
import secrets
import json
import threading
from datetime import datetime
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.backends import default_backend
from pymongo import MongoClient

# ── REMOVED hardcoded RECORDINGS_DIR — now always reads from rtsp_recorder ──
# RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "C:/Recording")  ← was wrong
import rtsp_recorder as recorder   # get_recordings_dir() gives the live path

MONGO_URI      = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
KEY_FILE       = os.environ.get("VIDEO_KEY_FILE", "/app/data/video.key")  # Must match recording_api.py
POLL_INTERVAL  = 5

# ------------------------------------------------------------------
# MongoDB — single persistent client created at module load time
# ------------------------------------------------------------------
print(f"[ENCRYPT] Connecting to MongoDB at {MONGO_URI}")
_mongo_client       = MongoClient(MONGO_URI, serverSelectionTimeoutMS=10000)
_db                 = _mongo_client["mirador-vms"]
metadata_collection = _db["recordings"]

def migrate_existing_recordings():
    """
    Self-healing migration: if any recording document in MongoDB has a date format
    as its camera_id (due to the old path parsing bug), fix it by parsing the
    correct camera_id from its file_path.
    """
    try:
        date_pattern = re.compile(r'^\d{4}-\d{2}-\d{2}$')
        incorrect_docs = list(metadata_collection.find({"camera_id": {"$regex": r'^\d{4}-\d{2}-\d{2}$'}}))
        if incorrect_docs:
            print(f"[ENCRYPT] 🔧 Found {len(incorrect_docs)} recordings with incorrect camera_id. Starting migration...")
            fixed_count = 0
            for doc in incorrect_docs:
                file_path = doc.get("file_path", "")
                if not file_path:
                    continue
                normalized = file_path.replace("\\", "/")
                parts = normalized.split("/")
                try:
                    for i, part in enumerate(parts):
                        if date_pattern.match(part) and i > 0:
                            correct_cam_id = parts[i - 1]
                            metadata_collection.update_one(
                                {"_id": doc["_id"]},
                                {"$set": {"camera_id": correct_cam_id}}
                            )
                            fixed_count += 1
                            break
                except Exception as ex:
                    print(f"[ENCRYPT] Migration failed for document {doc.get('_id')}: {ex}")
            print(f"[ENCRYPT] ✅ Fixed {fixed_count} existing recording documents in MongoDB.")
    except Exception as e:
        print(f"[ENCRYPT] ❌ Existing recordings migration failed: {e}")

try:
    _mongo_client.server_info()
    print("[ENCRYPT] ✅ MongoDB connected successfully")
    migrate_existing_recordings()
except Exception as e:
    print(f"[ENCRYPT] ❌ MongoDB connection FAILED: {e}")


# ------------------------------------------------------------------
# AES-256 key
# ------------------------------------------------------------------

# Old default path used before this fix — kept here ONLY for one-time migration.
# If a key exists there but not at KEY_FILE, we copy it so existing recordings
# remain decryptable after upgrading.
_OLD_KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "devices_data", "video.key")

def _migrate_key_if_needed():
    """
    One-time migration: if the key only exists at the old path, copy it to
    KEY_FILE so recording_api.py (which always uses KEY_FILE) can decrypt
    recordings that were encrypted with the old key.
    """
    if os.path.exists(KEY_FILE):
        return  # Already at the canonical location — nothing to do
    old_path = os.path.normpath(_OLD_KEY_FILE)
    if os.path.exists(old_path):
        print(f"[ENCRYPT] 🔑 Migrating key from old path: {old_path} → {KEY_FILE}")
        try:
            os.makedirs(os.path.dirname(os.path.abspath(KEY_FILE)), exist_ok=True)
            import shutil
            shutil.copy2(old_path, KEY_FILE)
            print(f"[ENCRYPT] ✅ Key migrated successfully — recordings remain decryptable")
        except Exception as e:
            print(f"[ENCRYPT] ⚠ Key migration failed: {e}")

_migrate_key_if_needed()

def load_video_key() -> bytes:
    """
    Load the AES-256 key from KEY_FILE (canonical path, shared with recording_api.py).
    IMPORTANT: read raw bytes WITHOUT .strip() — binary keys are exactly 32 bytes and
    .strip() silently removes trailing 0x0a/0x0d bytes, producing a different key than
    the one used to encrypt, causing AES to output garbage that looks valid but VLC rejects.
    """
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "rb") as f:
            key = f.read()   # ← NO .strip() — binary key must be read verbatim
        if len(key) < 1:
            raise RuntimeError(f"[ENCRYPT] video.key at {KEY_FILE} is empty!")
        padded = key[:32].ljust(32, b'\0')
        print(f"[ENCRYPT] 🔑 Loaded key from {KEY_FILE} ({len(key)} bytes raw, using first 32)")
        return padded
    print("[ENCRYPT] video.key not found — generating new AES-256 key")
    key = secrets.token_bytes(32)
    os.makedirs(os.path.dirname(os.path.abspath(KEY_FILE)), exist_ok=True)
    with open(KEY_FILE, "wb") as f:
        f.write(key)
    print(f"[ENCRYPT] Key saved to {KEY_FILE}")
    return key

MASTER_KEY = load_video_key()


def _aes_encrypt(data: bytes) -> bytes:
    iv     = secrets.token_bytes(16)
    cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CTR(iv), backend=default_backend())
    enc    = cipher.encryptor()
    # CTR mode does not require padding
    return b'CTR\x00' + iv + enc.update(data) + enc.finalize()


def _parse_path(input_path: str):
    filename = os.path.basename(input_path)
    date_dir = os.path.basename(os.path.dirname(input_path))
    
    # The parent directory of the date directory is always the camera_id (IP_FOLDER)
    camera_id = os.path.basename(os.path.dirname(os.path.dirname(input_path)))
    
    stem = filename.replace(".mp4", "").replace(".enc", "")
    
    # If the filename contains an underscore (e.g. YYYY-MM-DD_HH-MM-SS or cameraName_HH-MM-SS),
    # extract the time part from the last segment.
    if "_" in stem:
        time_part = stem.rsplit("_", 1)[1]
    else:
        time_part = stem

    return camera_id, date_dir, time_part


def _save_metadata_to_db(camera_id, date_part, time_part, output_path):
    try:
        file_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
        result = metadata_collection.insert_one({
            "camera_id":  camera_id,
            "date":       date_part,
            "start_time": time_part,
            "file_path":  output_path.replace("\\", "/"),
            "file_size":  file_size,
            "created_at": datetime.utcnow(),
        })
        print(f"[ENCRYPT] 📄 Saved to MongoDB: {camera_id} / {date_part} / {time_part} _id={result.inserted_id}")
    except Exception as e:
        print(f"[ENCRYPT] ❌ MongoDB insert FAILED: {e}")


def _save_meta_sidecar(camera_id, date_part, time_part, output_path):
    try:
        file_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
        meta = {
            "camera_id":  camera_id,
            "date":       date_part,
            "start_time": time_part,
            "file_path":  output_path.replace("\\", "/"),
            "file_size":  file_size,
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


def encrypt_file(input_path: str) -> bool:
    try:
        camera_id, date_part, time_part = _parse_path(input_path)
    except Exception as e:
        print(f"[ENCRYPT] Path parse error {input_path}: {e}")
        return False

    # ── Always write .enc alongside the .mp4 in the SAME directory ──
    # This ensures the file lands in /recordings/<camera>/<date>/ correctly
    out_dir     = os.path.dirname(input_path)
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

    print(f"[ENCRYPT] Could not delete {input_path}")
    return True


_seen_files = set()
_stop_event = threading.Event()


# ------------------------------------------------------------------
# Decrypt helpers (used by main.py /api/recordings/decrypt-upload)
# ------------------------------------------------------------------
def decrypt_bytes_to_io(raw_bytes: bytes) -> io.BytesIO:
    """
    Decrypt AES-256 encrypted bytes and return a BytesIO of the MP4 payload.
    Supports both legacy CBC and new CTR formats.
    """
    if not raw_bytes or len(raw_bytes) <= 16:
        raise ValueError("Encrypted payload must be larger than 16 bytes")
        
    is_ctr = raw_bytes.startswith(b'CTR\x00')
    
    if is_ctr:
        iv = raw_bytes[4:20]
        ciphertext = raw_bytes[20:]
        cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CTR(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        data = decryptor.update(ciphertext) + decryptor.finalize()
    else:
        # Legacy CBC
        iv         = raw_bytes[:16]
        ciphertext = raw_bytes[16:]
        cipher     = Cipher(algorithms.AES(MASTER_KEY), modes.CBC(iv), backend=default_backend())
        decryptor  = cipher.decryptor()
        padded_data = decryptor.update(ciphertext) + decryptor.finalize()
        unpadder    = padding.PKCS7(128).unpadder()
        data        = unpadder.update(padded_data) + unpadder.finalize()
        
    # Validate the output is a real MP4 (catches wrong-key silent corruption)
    if len(data) < 12 or data[4:8] not in (b'ftyp', b'moov', b'mdat', b'free', b'skip', b'wide'):
        raise ValueError(
            f"Decrypted output is not a valid MP4 (bytes[4:8]={data[4:8]!r}). "
            "Key mismatch between encrypt_service and recording_api?"
        )
    return io.BytesIO(data)

def decrypt_file(input_path: str, output_path: str) -> bool:
    """Decrypt a .enc file to an MP4 file on disk. Returns True on success."""
    try:
        with open(input_path, "rb") as f:
            encrypted_data = f.read()
        dec_stream = decrypt_bytes_to_io(encrypted_data)
        with open(output_path, "wb") as f:
            f.write(dec_stream.getbuffer())
        print(f"[DECRYPT] ✅ Decrypted: {output_path}")
        return True
    except Exception as e:
        print(f"[DECRYPT] ❌ Decryption failed {input_path}: {e}")
        return False

def decrypt_file_stream(input_path: str):
    """Generator that decrypts a file in chunks for streaming."""
    if not os.path.exists(input_path):
        return
    with open(input_path, "rb") as f:
        header = f.read(4)
        is_ctr = header == b'CTR\x00'
        
        if is_ctr:
            iv = f.read(16)
            cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CTR(iv), backend=default_backend())
        else:
            # It's CBC, the 4 bytes were part of IV. Seek back and read 16 bytes.
            f.seek(0)
            iv = f.read(16)
            if not iv or len(iv) < 16:
                return
            cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CBC(iv), backend=default_backend())
            
        dec = cipher.decryptor()
        while True:
            chunk = f.read(128 * 1024)
            if not chunk:
                break
            yield dec.update(chunk)
        try:
            yield dec.finalize()
        except:
            pass


def _scan_and_encrypt():
    # ── Always use the recorder's current live path ──
    recordings_dir = recorder.get_recordings_dir()

    for root, dirs, files in os.walk(recordings_dir):
        # Skip the Non-indexed Files folder
        if "Non-indexed Files" in root:
            continue
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
    recordings_dir = recorder.get_recordings_dir()
    print(f"[ENCRYPT] Polling {recordings_dir} every {POLL_INTERVAL}s")
    os.makedirs(recordings_dir, exist_ok=True)
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
    print(f"[ENCRYPT] Encryption service started → watching {recorder.get_recordings_dir()}")

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