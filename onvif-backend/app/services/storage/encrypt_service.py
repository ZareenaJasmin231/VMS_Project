"""
encrypt_service.py — fixed MongoDB connection + synced recording path
"""

import os
import sys
import io

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except:
        pass

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
from . import rtsp_recorder as recorder   # get_recordings_dir() gives the live path

MONGO_URI      = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
KEY_FILE       = os.environ.get("VIDEO_KEY_FILE", "/app/data/video.key")  # Must match recording_api.py

# On Windows host, map default container path to the actual devices_data folder in VMS_Project
if os.name == 'nt' and KEY_FILE == "/app/data/video.key":
    sibling_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "devices_data", "video.key"))
    if os.path.exists(sibling_path):
        KEY_FILE = sibling_path
    else:
        hardcoded_path = "c:/Users/miradorwin/Documents/GitHub/VMS_Project/devices_data/video.key"
        if os.path.exists(hardcoded_path):
            KEY_FILE = hardcoded_path
        else:
            KEY_FILE = sibling_path

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

def _sync_keys_on_windows():
    if os.name != 'nt':
        return
    win_key = "C:/app/data/video.key"
    target_key = KEY_FILE
    if os.path.exists(win_key) and os.path.abspath(win_key) != os.path.abspath(target_key):
        try:
            if not os.path.exists(target_key):
                print(f"[ENCRYPT] 🔑 Syncing key: Copying {win_key} to {target_key}")
                os.makedirs(os.path.dirname(os.path.abspath(target_key)), exist_ok=True)
                import shutil
                shutil.copy2(win_key, target_key)
            else:
                with open(win_key, "rb") as f1, open(target_key, "rb") as f2:
                    k1 = f1.read()
                    k2 = f2.read()
                if k1 != k2:
                    print(f"[ENCRYPT] ⚠️ WARNING: Keys differ! Host key {win_key} vs Target key {target_key}.")
                    print(f"[ENCRYPT] Overwriting {target_key} with {win_key} to match host encryption.")
                    import shutil
                    shutil.copy2(win_key, target_key)
        except Exception as e:
            print(f"[ENCRYPT] Sync key error: {e}")

_migrate_key_if_needed()
_sync_keys_on_windows()

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
    
    stem = filename.replace(".mp4", "").replace(".enc", "").replace(".ts", "")
    if stem.endswith("_motion_based"):
        stem = stem[:-13]
    
    # If the filename contains an underscore (e.g. YYYY-MM-DD_HH-MM-SS or cameraName_HH-MM-SS),
    # extract the time part from the last segment.
    if "_" in stem:
        time_part = stem.rsplit("_", 1)[1]
    else:
        time_part = stem

    return camera_id, date_dir, time_part

import subprocess
import json

def _get_video_duration_seconds(path: str) -> float:
    try:
        probe_path = path
        temp_decrypted = None
        if path.endswith(".enc"):
            temp_decrypted = path + ".temp.mp4"
            if decrypt_file(path, temp_decrypted):
                probe_path = temp_decrypted
            else:
                probe_path = None

        if not probe_path or not os.path.exists(probe_path):
            return 0.0

        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            probe_path
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True
        )

        data = json.loads(result.stdout)
        duration = float(data["format"]["duration"])

        if temp_decrypted and os.path.exists(temp_decrypted):
            try:
                os.remove(temp_decrypted)
            except:
                pass

        return duration

    except Exception as e:
        print(f"[ENCRYPT] Failed to read duration: {e}")
        if temp_decrypted and os.path.exists(temp_decrypted):
            try:
                os.remove(temp_decrypted)
            except:
                pass
        return 0.0


def _save_metadata_to_db(camera_id, date_part, time_part, output_path, input_path=None):
    try:
        file_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0

        from datetime import timedelta

        # Look up finalized chunk duration from the recorder, defaulting to 300.0 if not found
        duration_seconds = 300.0
        durations_map = recorder._recording_durations.get(camera_id, {})
        if time_part in durations_map:
            duration_seconds = float(durations_map[time_part])

        start_dt = datetime.strptime(
            f"{date_part} {time_part}",
            "%Y-%m-%d %H-%M-%S"
        )

        end_dt = start_dt + timedelta(seconds=duration_seconds)

        end_time = end_dt.strftime("%H-%M-%S")

        minio_key = f"{camera_id}/{date_part}/{os.path.basename(output_path)}"
        metadata_collection.update_one(
            {
                "camera_id":  camera_id,
                "date":       date_part,
                "start_time": time_part,
            },
            {
                "$set": {
                    "file_path":  output_path,
                    "duration_seconds": duration_seconds,
                    "end_time": end_time,
                    "file_size":  file_size,
                    "created_at": datetime.utcnow(),
                }
            },
            upsert=True
        )
        print(f"[ENCRYPT] 📄 Saved to MongoDB (Upserted): {camera_id} / {date_part} / {time_part} file_size={file_size} duration={duration_seconds} end_time={end_time}")
    except Exception as e:
        print(f"[ENCRYPT] ❌ MongoDB upsert FAILED: {e}")


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
        fname = os.path.basename(path)
        is_segment = fname.endswith(".ts") and "_" in fname
        
        # If modified more than 15 seconds ago, it is guaranteed complete and closed
        mtime = os.path.getmtime(path)
        if time.time() - mtime > 15:
            return True
            
        if is_segment:
            stem = fname.replace(".ts", "")
            parts = stem.split("_")
            if len(parts) >= 2:
                time_part = parts[0]
                try:
                    idx = int(parts[1])
                    next_fname = f"{time_part}_{idx+1:03d}.ts"
                    next_path = os.path.join(os.path.dirname(path), next_fname)
                    if os.path.exists(next_path):
                        return True
                except:
                    pass
            return False
            
        s1 = os.path.getsize(path)
        if s1 == 0:
            return False
        time.sleep(1) # sleep only 1 second for very fresh files
        s2 = os.path.getsize(path)
        return s1 == s2
    except Exception:
        return False


def heal_mp4(input_path: str) -> str:
    """
    Attempts to heal a potentially truncated/corrupted MP4 file by remuxing it with ffmpeg.
    If successful, returns the path of the healed file. Otherwise, returns the original path.
    """
    import subprocess
    
    healed_path = input_path + ".healed.mp4"
    ffmpeg_bin = os.environ.get("FFMPEG_BIN", "ffmpeg")
    
    cmd = [
        ffmpeg_bin,
        "-y",
        "-loglevel", "error",
        "-err_detect", "ignore_err", # ignore minor errors to recover max frames
        "-i", input_path,
        "-c", "copy",
        "-movflags", "+faststart", # ensure metadata is at the beginning
        healed_path
    ]
    
    try:
        print(f"[ENCRYPT] 🩺 Attempting to heal/remux MP4: {input_path}")
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        if proc.returncode == 0 and os.path.exists(healed_path) and os.path.getsize(healed_path) > 0:
            print(f"[ENCRYPT] 🩺 Successfully healed {input_path} -> {healed_path}")
            os.remove(input_path)
            os.rename(healed_path, input_path)
            return input_path
        else:
            stderr = proc.stderr.decode(errors="replace")
            print(f"[ENCRYPT] 🩺 Healing process exited with code {proc.returncode}. Stderr: {stderr}")
    except Exception as e:
        print(f"[ENCRYPT] 🩺 Error during healing: {e}")
        
    if os.path.exists(healed_path):
        try:
            os.remove(healed_path)
        except:
            pass
            
    return input_path


def encrypt_file(input_path: str) -> bool:
    fname = os.path.basename(input_path)
    is_segment = fname.endswith(".ts") and "_" in fname
    
    if is_segment:
        # Parse segment path, e.g. 11-40-00_000.ts
        stem = fname.replace(".ts", "")
        parts = stem.split("_")
        if len(parts) >= 2:
            time_part = parts[0]
            segment_index = parts[1]
        else:
            print(f"[ENCRYPT] Invalid segment filename structure: {fname}")
            return False
            
        try:
            camera_id, date_part, _ = _parse_path(input_path)
        except Exception as e:
            print(f"[ENCRYPT] Path parse error {input_path}: {e}")
            return False
    else:
        try:
            camera_id, date_part, time_part = _parse_path(input_path)
        except Exception as e:
            print(f"[ENCRYPT] Path parse error {input_path}: {e}")
            return False

    motion_only = False
    try:
        cam_doc = _db["cameras"].find_one({"ome_stream": camera_id})
        if cam_doc and cam_doc.get("motion_only"):
            motion_only = True
    except Exception as e:
        print(f"[ENCRYPT] Error querying camera {camera_id}: {e}")

    out_dir = os.path.dirname(input_path)
    os.makedirs(out_dir, exist_ok=True)
    if motion_only:
        output_path = os.path.join(out_dir, f"{time_part}_motion_based.enc")
    else:
        output_path = os.path.join(out_dir, f"{time_part}.enc")

    # Healing step for non-segment files (segments are healthy by design and faststart is not needed until final play)
    if not is_segment:
        input_path = heal_mp4(input_path)

    try:
        if is_segment:
            # Chained segment encryption
            with open(input_path, "rb") as f:
                segment_data = f.read()
                
            current_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
            
            if current_size == 0:
                # Generate new base IV
                base_iv = secrets.token_bytes(16)
                payload_size = 0
            else:
                # Read base IV from existing file
                with open(output_path, "rb") as f_in:
                    f_in.seek(4) # skip CTR\x00
                    base_iv = f_in.read(16)
                payload_size = current_size - 20
                
            block_index = payload_size // 16
            offset_in_block = payload_size % 16
            
            iv_int = int.from_bytes(base_iv, 'big') + block_index
            chained_iv = iv_int.to_bytes(16, 'big')
            
            cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CTR(chained_iv), backend=default_backend())
            encryptor = cipher.encryptor()
            
            # If size is not aligned, process dummy bytes to align the cipher state
            if offset_in_block != 0:
                encryptor.update(b'\x00' * offset_in_block)
                
            encrypted_data = encryptor.update(segment_data) + encryptor.finalize()
            
            with open(output_path, "ab") as f_out:
                if current_size == 0:
                    f_out.write(b'CTR\x00' + base_iv)
                f_out.write(encrypted_data)
                
            print(f"[ENCRYPT] 🛠  Appended segment {segment_index} to: {output_path} (new size: {os.path.getsize(output_path)} bytes)")
        else:
            # Standard single block encryption
            with open(input_path, "rb") as f:
                data = f.read()
            with open(output_path, "wb") as f:
                f.write(_aes_encrypt(data))
            print(f"[ENCRYPT] ✅ Encrypted complete file: {output_path}")
            
    except Exception as e:
        print(f"[ENCRYPT] ❌ Encryption failed {input_path}: {e}")
        return False

    _save_metadata_to_db(camera_id, date_part, time_part, output_path, input_path)
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
    try:
        with open(output_path, "wb") as f_out:
            for chunk in decrypt_file_stream(input_path):
                f_out.write(chunk)
        return True
    except Exception as e:
        print(f"[DECRYPT] ❌ Failed {input_path}: {e}")
        return False

def decrypt_to_temp_file(enc_path: str, suffix: str = ".ts") -> str:
    import tempfile
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.close()
    if decrypt_file(enc_path, tmp.name):
        return tmp.name
    return ""

def decrypt_file_stream(input_path: str):
    """Generator that decrypts a file in chunks for streaming, supporting local and MinIO paths."""
    is_minio = input_path.startswith("minio:")
    f = None
    stream = None
    
    if is_minio:
        try:
            from app.utils import minio_client
            object_key = input_path.replace("minio:", "")
            stream = minio_client.get_file_stream(object_key)
            if not stream:
                return
            header = stream.read(4)
        except Exception as e:
            print(f"[DECRYPT] ❌ Failed to get MinIO stream for {input_path}: {e}")
            return
    else:
        if not os.path.exists(input_path):
            return
        f = open(input_path, "rb")
        header = f.read(4)

    try:
        is_ctr = header == b'CTR\x00'
        
        if is_ctr:
            iv = stream.read(16) if is_minio else f.read(16)
            cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CTR(iv), backend=default_backend())
        else:
            # It's CBC, the 4 bytes were part of IV. Seek back and read 16 bytes.
            # For MinIO streams we can't seek back. We assume new recordings are all CTR.
            # But if we must support CBC on MinIO, we'd need to handle it. 
            # Since existing aren't migrated, minio paths are only CTR.
            if is_minio:
                iv = header + stream.read(12)
            else:
                f.seek(0)
                iv = f.read(16)
                
            if not iv or len(iv) < 16:
                return
            cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CBC(iv), backend=default_backend())
            
        dec = cipher.decryptor()
        while True:
            chunk = stream.read(128 * 1024) if is_minio else f.read(128 * 1024)
            if not chunk:
                break
            yield dec.update(chunk)
        try:
            yield dec.finalize()
        except:
            pass
    finally:
        if is_minio and stream:
            stream.close()
            stream.release_conn()
        elif f:
            f.close()


def _scan_and_encrypt():
    # ── Always use the recorder's current live path ──
    recordings_dir = recorder.get_recordings_dir()

    for root, dirs, files in os.walk(recordings_dir):
        # Skip the Non-indexed Files folder
        if "Non-indexed Files" in root:
            continue
        for fname in sorted(files):
            ext = fname.lower()
            if not (ext.endswith(".mp4") or ext.endswith(".ts")):
                continue
            full_path = os.path.join(root, fname)
            if full_path in _seen_files:
                continue
            _seen_files.add(full_path)
            try:
                if _is_file_complete(full_path):
                    print(f"[ENCRYPT] 🎬 Found completed file: {full_path}")
                    success = encrypt_file(full_path)
                    if not success:
                        _seen_files.discard(full_path)
                else:
                    _seen_files.discard(full_path)
            except Exception as e:
                print(f"[ENCRYPT] ❌ Exception processing {full_path}: {e}")
                _seen_files.discard(full_path)


_uploaded_enc_files = set()

def _upload_and_cleanup_enc_files(recordings_dir):
    now = time.time()
    for root, dirs, files in os.walk(recordings_dir):
        if "Non-indexed Files" in root:
            continue
        for fname in files:
            if fname.endswith(".enc"):
                full_path = os.path.join(root, fname)
                try:
                    mtime = os.path.getmtime(full_path)
                    if full_path in _uploaded_enc_files:
                        if now - mtime > 600: # 10 minutes
                            try:
                                os.remove(full_path)
                                meta_path = full_path.replace('.enc', '.meta')
                                if os.path.exists(meta_path):
                                    os.remove(meta_path)
                                print(f"[ENCRYPT] 🧹 Cleaned up local file: {full_path}")
                                _uploaded_enc_files.discard(full_path)
                            except Exception:
                                pass
                        continue
                    
                    if now - mtime > 600:
                        camera_id, date_part, _ = _parse_path(full_path)
                        time_part = fname.replace(".enc", "").replace("_motion_based", "")
                        doc = metadata_collection.find_one({
                            "camera_id": camera_id,
                            "date": date_part,
                            "start_time": time_part
                        })
                        if doc and doc.get("file_path", "").startswith("minio:"):
                            try:
                                os.remove(full_path)
                                meta_path = full_path.replace('.enc', '.meta')
                                if os.path.exists(meta_path):
                                    os.remove(meta_path)
                                print(f"[ENCRYPT] 🧹 Fast cleanup (already in DB): {full_path}")
                            except Exception:
                                pass
                            continue
                        
                    if now - mtime > 30:
                        try:
                            from app.utils import minio_client
                            camera_id, date_part, _ = _parse_path(full_path)
                            minio_key = f"{camera_id}/{date_part}/{fname}"
                            minio_meta_key = f"{camera_id}/{date_part}/{fname.replace('.enc', '.meta')}"
                            
                            print(f"[ENCRYPT] ☁️ Uploading finished 5-min file to MinIO: {fname}")
                            minio_client.upload_file(minio_key, full_path)
                            meta_path = full_path.replace('.enc', '.meta')
                            if os.path.exists(meta_path):
                                minio_client.upload_file(minio_meta_key, meta_path)
                                
                            # Update MongoDB to point to MinIO
                            time_part = fname.replace(".enc", "").replace("_motion_based", "")
                            try:
                                metadata_collection.update_one(
                                    {
                                        "camera_id": camera_id,
                                        "date": date_part,
                                        "start_time": time_part
                                    },
                                    {
                                        "$set": {
                                            "file_path": f"minio:{minio_key}"
                                        }
                                    }
                                )
                            except Exception as db_err:
                                print(f"[ENCRYPT] DB MinIO update failed: {db_err}")
                                
                            _uploaded_enc_files.add(full_path)
                        except Exception as e:
                            print(f"[ENCRYPT] MinIO upload failed: {e}")
                except Exception:
                    pass

def _poll_loop():
    recordings_dir = recorder.get_recordings_dir()
    print(f"[ENCRYPT] Polling {recordings_dir} every {POLL_INTERVAL}s")
    os.makedirs(recordings_dir, exist_ok=True)
    while not _stop_event.is_set():
        try:
            _scan_and_encrypt()
            _upload_and_cleanup_enc_files(recordings_dir)
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