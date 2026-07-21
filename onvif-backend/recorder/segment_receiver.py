import os
import io
import asyncio
from datetime import datetime
from fastapi import APIRouter, Request, Response
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

from app.utils.minio_client import upload_bytes, compose_object, object_exists, delete_object
from app.core.database import recordings_col, cameras_col
from recorder.encrypt_service import MASTER_KEY

SEGMENT_QUEUE_SIZE = int(os.environ.get("SEGMENT_QUEUE_SIZE", "5"))
MAX_CONCURRENT_UPLOADS = int(os.environ.get("MAX_CONCURRENT_UPLOADS", "16"))
QUEUE_PUT_TIMEOUT = float(os.environ.get("QUEUE_PUT_TIMEOUT", "2.0"))

segment_router = APIRouter(prefix="/_seg")

def _parse_key_parts(key: str):
    """Extract (camera_id, date_str, time_str) from the last 3 segments of a key.
    Works regardless of parent folder prefix depth.
    e.g. 'Recordings/shard1/192_168_126_235/2026-07-20/14-40-00' -> ('192_168_126_235', '2026-07-20', '14-40-00')
    e.g. 'shard1/192_168_126_235/2026-07-20/14-40-00' -> ('192_168_126_235', '2026-07-20', '14-40-00')
    """
    parts = key.split("/")
    return parts[-3], parts[-2], parts[-1]

_semaphore = asyncio.Semaphore(MAX_CONCURRENT_UPLOADS)

_recording_state: dict[str, dict] = {}
_queues: dict[str, asyncio.Queue] = {}
_workers: dict[str, asyncio.Task] = {}
_camera_shard_cache: dict[str, str] = {}

_STOP_SENTINEL = object()

def _get_shard_prefix(camera_id: str) -> str:
    if camera_id in _camera_shard_cache:
        return _camera_shard_cache[camera_id]
    
    prefix = None
    if cameras_col is not None:
        try:
            cam = cameras_col.find_one({"ome_stream": camera_id}) or {}
            prefix = cam.get("shard_prefix")
            if not prefix:
                from app.utils.minio_client import get_shard_prefix
                prefix = get_shard_prefix(cam.get("assigned_worker", "worker-1"))
        except Exception as e:
            print(f"[RECEIVER] DB query for shard prefix failed: {e}")
            
    if not prefix:
        prefix = "shard1"
        
    _camera_shard_cache[camera_id] = prefix
    return prefix

def _encrypt_segment(key: str, raw_bytes: bytes) -> bytes:
    state = _recording_state[key]
    base_iv = state["base_iv"]
    base_iv_int = int.from_bytes(base_iv, 'big')
    block_index = state["bytes_written"] // 16
    offset = state["bytes_written"] % 16
    
    chained_iv = (base_iv_int + block_index).to_bytes(16, 'big')
    cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CTR(chained_iv), backend=default_backend()).encryptor()
    
    if offset != 0:
        cipher.update(b'\x00' * offset)
        
    encrypted = cipher.update(raw_bytes) + cipher.finalize()
    
    # Prepend 20-byte AES-CTR header if this is the very first segment
    if state["bytes_written"] == 0:
        encrypted = b'CTR\x00' + base_iv + encrypted
        
    return encrypted

async def mongodb_checkpoint(key: str, state: dict):
    if recordings_col is None:
        return
    camera_id, date_str, time_str = _parse_key_parts(key)
    
    await asyncio.to_thread(
        recordings_col.update_one,
        {
            "camera_id": camera_id,
            "start_time": time_str.replace("-", ":"),
            "date": date_str
        },
        {
            "$set": {
                "status": state["status"],
                "base_iv": state["base_iv"].hex(),
                "segment_count": state["segment_count"],
                "bytes_written": state["bytes_written"],
                "last_updated": datetime.utcnow(),
                "file_size": state["bytes_written"],
                "duration_seconds": float(state["segment_count"] * 10.0)
            },
            "$setOnInsert": {
                "created_at": datetime.utcnow(),
                "end_time": time_str.replace("-", ":"),
                "file_path": f"minio:{key}"
            }
        },
        upsert=True
    )

async def _verify_all_parts(key: str) -> list[int]:
    return [] # Deprecated, handled dynamically

async def _cleanup_temp_parts(key: str, sources: list[str] = None):
    if sources is None:
        from app.utils.minio_client import list_objects
        sources = await asyncio.to_thread(list_objects, f"{key}_")
    
    from app.utils.minio_client import delete_object
    for src in sources:
        try:
            await asyncio.to_thread(delete_object, src)
        except Exception as e:
            print(f"[RECEIVER] ⚠ Cleanup failed for {src}: {e}")

async def mongodb_set_status(key: str, status: str, missing_segments=None):
    if recordings_col is None:
        return
    camera_id, date_str, time_str = _parse_key_parts(key)
    update = {"status": status, "last_updated": datetime.utcnow()}
    if missing_segments is not None:
        update["missing_segments"] = missing_segments
    await asyncio.to_thread(
        recordings_col.update_one,
        {
            "camera_id": camera_id,
            "date": date_str,
            "start_time": time_str.replace("-", ":")
        },
        {"$set": update}
    )

async def mongodb_set_complete(key: str, dest: str, duration_seconds: float = None):
    if recordings_col is None:
        return
    camera_id, date_str, time_str = _parse_key_parts(key)
    update_data = {
        "status": "COMPLETE",
        "file_path": f"minio:{dest}",
        "last_updated": datetime.utcnow()
    }
    if duration_seconds is not None:
        update_data["duration_seconds"] = duration_seconds
    await asyncio.to_thread(
        recordings_col.update_one,
        {
            "camera_id": camera_id,
            "date": date_str,
            "start_time": time_str.replace("-", ":")
        },
        {"$set": update_data}
    )

class SegmentStreamReader(io.RawIOBase):
    def __init__(self, key: str, sources: list[str]):
        self.key = key
        self.sources = sources
        self.idx = 0
        self.res = None
        from app.utils.minio_client import minio_client, MINIO_BUCKET
        self.minio_client = minio_client
        self.MINIO_BUCKET = MINIO_BUCKET
        
    def read(self, size=-1):
        if self.res is None:
            if self.idx >= len(self.sources):
                return b""
            from minio.error import S3Error
            try:
                self.res = self.minio_client.get_object(self.MINIO_BUCKET, self.sources[self.idx])
            except S3Error as e:
                print(f"[RECEIVER] ❌ Missing segment {self.sources[self.idx]}: {e}")
                self.idx += 1
                return self.read(size)
                
        chunk = self.res.read(size)
        if not chunk:
            self.res.close()
            self.res.release_conn()
            self.res = None
            self.idx += 1
            return self.read(size)
            
        return chunk

async def _compose_and_finalize(key: str):
    dest = f"{key}.enc"
    
    state = _recording_state.get(key)
    duration = float(state["segment_count"] * 10.0) if state else None

    if await asyncio.to_thread(object_exists, dest):
        print(f"[RECEIVER] ℹ {dest} already exists — skipping compose")
        await _cleanup_temp_parts(key)
        await mongodb_set_complete(key, dest, duration)
        return
        
    await mongodb_set_status(key, "COMPOSING")
    
    from app.utils.minio_client import list_objects, minio_client, MINIO_BUCKET
    sources = await asyncio.to_thread(list_objects, f"{key}_")
    sources = sorted(sources)
    
    if not sources:
        print(f"[RECEIVER] ❌ No segments found in MinIO for {key}_")
        await mongodb_set_status(key, "FAILED")
        return
        
    try:
        # Calculate actual total size directly from MinIO stat to ensure exact byte match
        total_size = 0
        for src in sources:
            stat = await asyncio.to_thread(minio_client.stat_object, MINIO_BUCKET, src)
            total_size += stat.size
            
        # Stream chunks from MinIO back to MinIO
        def _upload_stream():
            minio_client.put_object(MINIO_BUCKET, dest, SegmentStreamReader(key, sources), length=total_size)
            
        await asyncio.to_thread(_upload_stream)
        await _cleanup_temp_parts(key, sources)
        await mongodb_set_complete(key, dest, duration)
    except Exception as e:
        print(f"[RECEIVER] ❌ Compose (Stream) failed for {key}: {e}")
        await mongodb_set_status(key, "FAILED")

async def _cleanup_recording_resources(key: str):
    _recording_state.pop(key, None)
    _queues.pop(key, None)
    task = _workers.pop(key, None)
    if task and not task.done():
        task.cancel()
    print(f"[RECEIVER] 🗑 Cleaned up resources for {key}")

async def _camera_worker(key: str):
    while True:
        try:
            # If no segment arrives for 20s, assume FFmpeg disconnected
            item = await asyncio.wait_for(_queues[key].get(), timeout=20.0)
        except asyncio.TimeoutError:
            print(f"[RECEIVER] ⏱ Timeout waiting for {key}. Forcing composition.")
            state = _recording_state.get(key)
            if state and state["segment_count"] > 0 and state["segment_count"] < state["expected"]:
                state["expected"] = state["segment_count"]
                await _compose_and_finalize(key)
            break
            
        if item is _STOP_SENTINEL:
            _queues[key].task_done()
            break
            
        index, raw_bytes = item
        try:
            async with _semaphore:
                encrypted = await asyncio.to_thread(_encrypt_segment, key, raw_bytes)
                obj_name = f"{key}_{index:03d}.enc"
                await asyncio.to_thread(upload_bytes, obj_name, encrypted)
                
            state = _recording_state[key]
            state["segment_count"] += 1
            state["bytes_written"] += len(raw_bytes)
            await mongodb_checkpoint(key, state)
            
            if state["segment_count"] >= state["expected"]:
                await _compose_and_finalize(key)
                await _queues[key].put(_STOP_SENTINEL)
        except Exception as e:
            print(f"[RECEIVER] ❌ Segment {index} for {key} failed: {e}")
        finally:
            _queues[key].task_done()

async def _worker_wrapper(key: str):
    try:
        await _camera_worker(key)
    except asyncio.CancelledError:
        pass
    finally:
        await _cleanup_recording_resources(key)

def _get_or_create_queue(key: str) -> asyncio.Queue:
    if key not in _queues:
        _queues[key] = asyncio.Queue(maxsize=SEGMENT_QUEUE_SIZE)
        _workers[key] = asyncio.create_task(_worker_wrapper(key))
    return _queues[key]

@segment_router.post("/{camera_id}/{date}/{time_str}/{index}")
@segment_router.put("/{camera_id}/{date}/{time_str}/{index}")
async def receive_segment(camera_id: str, date: str, time_str: str, index: int, request: Request):
    from app.utils.minio_client import build_recording_path
    
    # Recording Session Freeze: If index > 0, look up the existing session key to keep the shard prefix fixed
    key = None
    if index > 0:
        suffix = f"/{camera_id}/{date}/{time_str}"
        for active_key in _recording_state:
            if active_key.endswith(suffix):
                key = active_key
                break
                
    if key is None:
        if index == 0:
            # Force dynamic cache invalidation at the start of a new chunk session
            _camera_shard_cache.pop(camera_id, None)
        shard = _get_shard_prefix(camera_id)
        key = build_recording_path(shard, camera_id, date, time_str)
    
    # Initialize state if first segment (and not recovered)
    if key not in _recording_state:
        _recording_state[key] = {
            "base_iv": os.urandom(16),
            "bytes_written": 0,
            "segment_count": 0,
            "expected": 30, # 5 mins at 10s segments
            "status": "UPLOADING"
        }
        
        if recordings_col is not None and index == 0:
            await asyncio.to_thread(
                recordings_col.insert_one,
                {
                    "camera_id": camera_id,
                    "date": date,
                    "start_time": time_str.replace("-", ":"),
                    "file_path": f"minio:{key}",
                    "status": "UPLOADING",
                    "base_iv": _recording_state[key]["base_iv"].hex(),
                    "segment_count": 0,
                    "bytes_written": 0,
                    "last_updated": datetime.utcnow(),
                    "expected_segments": 30,
                    "duration_seconds": 0.0,
                    "type": "segmented",
                    "created_at": datetime.utcnow()
                }
            )

    buf = bytearray()
    async for chunk in request.stream():
        buf.extend(chunk)
        
    q = _get_or_create_queue(key)
    try:
        await asyncio.wait_for(q.put((index, bytes(buf))), timeout=QUEUE_PUT_TIMEOUT)
        return {"ok": True}
    except asyncio.TimeoutError:
        print(f"[RECEIVER] ⚠ Queue full for {key} after {QUEUE_PUT_TIMEOUT}s — returning 503")
        return Response(status_code=503, content="Upstream busy")

async def recover_on_startup():
    if recordings_col is None:
        return
    stale_docs = await asyncio.to_thread(
        lambda: list(recordings_col.find({"status": {"$in": ["UPLOADING", "COMPOSING", "FAILED"]}}))
    )
    for doc in stale_docs:
        try:
            key = doc["file_path"].replace("minio:", "")
            
            # Check if composed file already exists in MinIO
            from app.utils.minio_client import object_exists
            dest = key if key.endswith(".enc") else f"{key}.enc"
            base_key = key.replace(".enc", "")
            
            if await asyncio.to_thread(object_exists, dest):
                print(f"[RECEIVER] ♻ Recovering: {dest} already exists. Setting COMPLETE.")
                await mongodb_set_complete(base_key, dest)
                continue
                
            _recording_state[key] = {
                "base_iv": bytes.fromhex(doc["base_iv"]),
                "bytes_written": doc["bytes_written"],
                "segment_count": doc["segment_count"],
                "expected": doc.get("expected_segments", 30),
                "status": doc["status"],
            }
            segment_count = doc["segment_count"]
            if segment_count > 0:
                print(f"[RECEIVER] ♻ Recovering recording {key} ({segment_count} segments)")
                # Force expected to match actual segments so verify passes
                _recording_state[key]["expected"] = segment_count
                await mongodb_set_status(key, "RECOVERING")
                asyncio.create_task(_recover_finalize(key))
            else:
                print(f"[RECEIVER] 🗑 {key} has 0 segments. Marking as failed.")
                await mongodb_set_status(key, "FAILED")
        except Exception as e:
            print(f"[RECEIVER] ❌ Failed to recover {doc.get('_id')}: {e}")

async def _recover_finalize(key: str):
    await _compose_and_finalize(key)
    await _cleanup_recording_resources(key)
