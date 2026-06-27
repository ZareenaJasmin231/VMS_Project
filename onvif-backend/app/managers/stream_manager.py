import os
import json
import re
import sys

from pathlib import Path
env_path = Path(__file__).parent.parent.parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip().strip("'\""))

import subprocess
import asyncio
import requests as http_requests
from datetime import datetime
from app.core.database import cameras_col, db as _db
from app.services.camera.mediamtx_service import register_stream
from recorder import rtsp_recorder as recorder

DEVICES_FILE  = os.environ.get("DEVICES_FILE", os.path.join(os.path.dirname(__file__), "..", "..", "devices_data", "devices.json"))
MEDIAMTX_API = os.environ.get(
    "MEDIAMTX_API_URL",
    "http://localhost:9997"
)
WATCHDOG_INTERVAL      = 5
WATCHDOG_MAX_RETRIES   = 20
WATCHDOG_BACKOFF_RESET = 10

_watchdog_failures = {}
_watchdog_cycle = 0

def normalize_stream_name(ip: str, suffix: str = None) -> str:
    base = ip.strip().replace(".", "_")
    if suffix:
        clean_suffix = re.sub(r'[^a-zA-Z0-9]', '', suffix)
        if clean_suffix:
            return f"{base}_{clean_suffix}"
    return base

def save_camera_to_db(data: dict):
    if cameras_col is None:
        print("[MONGO] ❌ No connection")
        return False
 
    existing = cameras_col.find_one({"ome_stream": data["ome_stream"]})
    current_count = cameras_col.count_documents({"enabled": True})

    print("CURRENT:", current_count)
 
    try:
        cameras_col.update_one(
            {"ome_stream": data["ome_stream"]},
            {"$set": data},
            upsert=True
        )
        print("✅ Camera saved")
        return True
    except Exception as e:
        print("❌ Save failed:", e)
        return False

def load_devices():
    if cameras_col is not None:
        try:
            docs = list(cameras_col.find({}, {"_id": 0}))
            if docs:
                unique_cams = {}
                for d in docs:
                    stream_id = d.get("ome_stream") or normalize_stream_name(d.get("ip", "unknown"))
                    if not stream_id: continue
                    
                    if stream_id not in unique_cams:
                        unique_cams[stream_id] = d
                    else:
                        if d.get("enabled") and not unique_cams[stream_id].get("enabled"):
                            unique_cams[stream_id] = d
                
                deduped = list(unique_cams.values())
                print(f"[STARTUP] Loaded {len(docs)} cameras ({len(deduped)} unique IPs) from MongoDB")
                
                final_list = [{
                    "ome_stream":     d.get("ome_stream") or normalize_stream_name(d.get("ip")),
                    "rtsp_url":       d.get("rtsp_url"),
                    "recording_rtsp": d.get("recording_rtsp", d.get("rtsp_url")),
                    "ip":             d.get("ip"),
                    "port":           d.get("port", 80),
                    "username":       d.get("username", ""),
                    "password":       d.get("password", ""),
                    "enabled":        d.get("enabled", True),
                    "manufacturer":   d.get("manufacturer", "Unknown"),
                    "model":          d.get("model", "Unknown"),
                    "active_live_profile": d.get("active_live_profile", ""),
                    "active_rec_profile":  d.get("active_rec_profile", ""),
                    "recording_profile":   d.get("recording_profile", ""),
                    "assigned_schedule_id": d.get("assigned_schedule_id", "Always"),
                    "motion_only":          d.get("motion_only", False),
                    "live_codec":           d.get("live_codec", "H.264"),
                } for d in deduped if d.get("ip") and d.get("rtsp_url")]
                
                save_devices(final_list)
                return final_list
            else:
                print("[STARTUP] MongoDB connected successfully but contains 0 cameras. Syncing empty state to devices.json.")
                save_devices([])
                return []
        except Exception as e:
            print(f"[STARTUP] MongoDB load failed: {e} — falling back to devices.json")

    try:
        if os.path.exists(DEVICES_FILE):
            with open(DEVICES_FILE) as f:
                data = json.load(f)
                print(f"[STARTUP] Loaded {len(data)} cameras from devices.json")
                return data
    except Exception as e:
        print(f"[STARTUP] devices.json load failed: {e}")

    return []

def save_devices(devs):
    try:
        os.makedirs(os.path.dirname(DEVICES_FILE), exist_ok=True)
        from datetime import datetime

        def serialize(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            return str(obj)

        with open(DEVICES_FILE, "w") as f:
            json.dump(devs, f, default=serialize, indent=2)
        print("[DEVICES] ✅ Saved successfully")
    except Exception as e:
        print(f"[DEVICES] ⚠ Could not save devices.json: {e}")

def stream_exists_in_mediamtx(stream_name: str) -> bool:
    try:
        r = http_requests.get(
            f"{MEDIAMTX_API}/v3/config/paths/get/{stream_name}",
            timeout=3,
        )
        return r.status_code == 200
    except:
        return False

# Global list of devices
devices = load_devices()

def get_devices_by_ip(ip: str) -> list:
    return [d for d in devices if d.get("ip") == ip]

# ------------------------------------------------------------------
# Worker Subprocess Pool & Dynamic Camera Sharding
# ------------------------------------------------------------------
_worker_processes = {}
_worker_pool_lock = asyncio.Lock()
_worker_retries = {}

# Keep track of promoted standbys dynamically
_promoted_standbys = set()

def get_configured_workers():
    try:
        active_count = int(os.environ.get("VMS_WORKER_COUNT", "2"))
    except:
        active_count = 2
    try:
        standby_count = int(os.environ.get("VMS_STANDBY_COUNT", "0"))
    except:
        standby_count = 0
        
    active_workers = [f"worker-{i}" for i in range(1, active_count + 1)]
    standby_workers = [f"worker-standby-{i}" for i in range(1, standby_count + 1)]
    
    # Add promoted standbys to active list and remove from standby list
    for s_id in _promoted_standbys:
        if s_id not in active_workers:
            active_workers.append(s_id)
        if s_id in standby_workers:
            standby_workers.remove(s_id)
            
    return active_workers, standby_workers

async def rebalance_sharding():
    if cameras_col is None:
        return
    
    try:
        active_workers, standby_workers = get_configured_workers()
        # Fetch all enabled cameras
        all_cameras = list(cameras_col.find({"enabled": {"$ne": False}}))
        if not all_cameras:
            return
        
        # Filter active workers to only those that have NOT crashed persistently (> 3 retries)
        healthy_workers = []
        for w_id in active_workers:
            if _worker_retries.get(w_id, 0) > 3:
                # Check if it's marked dead in heartbeats collection as well
                try:
                    hb_doc = _db["worker_heartbeats"].find_one({"worker_id": w_id})
                    if hb_doc and hb_doc.get("status") == "dead":
                        continue
                except:
                    pass
                continue
            healthy_workers.append(w_id)
                
        if not healthy_workers:
            healthy_workers = active_workers # Fallback to all if none running
            
        print(f"[STREAM MANAGER] Sharding {len(all_cameras)} cameras across {len(healthy_workers)} healthy workers...")
        
        # Distribute cameras
        base_dir = recorder.get_recordings_dir()
        for idx, cam in enumerate(all_cameras):
            worker_id = healthy_workers[idx % len(healthy_workers)]
            
            # Determine shard path (standby workers use their own shard directories)
            if "standby" in worker_id:
                shard_path = os.path.join(base_dir, f"shard_{worker_id}")
            else:
                idx_val = worker_id.split("-")[-1]
                shard_path = os.path.join(base_dir, f"shard{idx_val}")
            
            # Check if already assigned to this worker to avoid unnecessary updates
            if cam.get("assigned_worker") != worker_id or cam.get("assigned_disk") != shard_path:
                cameras_col.update_one(
                    {"_id": cam["_id"]},
                    {
                        "$set": {
                            "assigned_worker": worker_id,
                            "assigned_disk": shard_path,
                            "assigned_at": datetime.utcnow()
                        }
                    }
                )
                print(f"[STREAM MANAGER] Assigned camera {cam.get('ome_stream')} to {worker_id} (Disk: {shard_path})")
    except Exception as e:
        print(f"[STREAM MANAGER] Error during camera sharding: {e}")

async def start_worker_pool():
    async with _worker_pool_lock:
        base_dir = recorder.get_recordings_dir()
        active_workers, standby_workers = get_configured_workers()
        
        # 1. Spawn primary / active workers
        for w_id in active_workers:
            idx_val = w_id.split("-")[-1]
            # Handle shard directory for promoted standby vs standard active worker
            if "standby" in w_id:
                shard_path = os.path.join(base_dir, f"shard_{w_id}")
            else:
                shard_path = os.path.join(base_dir, f"shard{idx_val}")
                
            os.makedirs(shard_path, exist_ok=True)
            
            if w_id not in _worker_processes or _worker_processes[w_id]["process"].poll() is not None:
                cmd = [
                    sys.executable,
                    os.path.join(os.path.dirname(__file__), "..", "..", "recorder", "recorder_worker.py"),
                    "--worker-id", w_id,
                    "--shard-path", shard_path
                ]
                print(f"[STREAM MANAGER] Spawning active worker {w_id} on path {shard_path}...")
                
                worker_env = os.environ.copy()
                worker_env["SQLITE_QUEUE_DB"] = os.path.join(shard_path, "local_metadata_queue.db")
                creation_flags = 0
                if sys.platform == "win32":
                    creation_flags = subprocess.CREATE_NO_WINDOW
                
                proc = subprocess.Popen(
                    cmd,
                    env=worker_env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    creationflags=creation_flags
                )
                
                _worker_processes[w_id] = {
                    "process": proc,
                    "shard_path": shard_path,
                    "standby": False
                }
                
                try:
                    _db["worker_heartbeats"].update_one(
                        {"worker_id": w_id},
                        {
                            "$set": {
                                "worker_id": w_id,
                                "status": "active",
                                "last_seen": datetime.utcnow(),
                                "cameras": []
                            }
                        },
                        upsert=True
                    )
                except Exception as db_err:
                    print(f"[STREAM MANAGER] DB heartbeat write failed for {w_id}: {db_err}")

        # 2. Spawn standby workers
        for s_id in standby_workers:
            shard_path = os.path.join(base_dir, f"shard_{s_id}")
            os.makedirs(shard_path, exist_ok=True)
            
            if s_id not in _worker_processes or _worker_processes[s_id]["process"].poll() is not None:
                cmd = [
                    sys.executable,
                    os.path.join(os.path.dirname(__file__), "..", "..", "recorder", "recorder_worker.py"),
                    "--worker-id", s_id,
                    "--shard-path", shard_path,
                    "--standby"
                ]
                print(f"[STREAM MANAGER] Spawning standby worker {s_id} on path {shard_path}...")
                
                worker_env = os.environ.copy()
                worker_env["SQLITE_QUEUE_DB"] = os.path.join(shard_path, "local_metadata_queue.db")
                creation_flags = 0
                if sys.platform == "win32":
                    creation_flags = subprocess.CREATE_NO_WINDOW
                
                proc = subprocess.Popen(
                    cmd,
                    env=worker_env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    creationflags=creation_flags
                )
                
                _worker_processes[s_id] = {
                    "process": proc,
                    "shard_path": shard_path,
                    "standby": True
                }
                
                try:
                    _db["worker_heartbeats"].update_one(
                        {"worker_id": s_id},
                        {
                            "$set": {
                                "worker_id": s_id,
                                "status": "standby",
                                "last_seen": datetime.utcnow(),
                                "cameras": []
                            }
                        },
                        upsert=True
                    )
                except Exception as db_err:
                    print(f"[STREAM MANAGER] DB heartbeat write failed for {s_id}: {db_err}")

async def supervise_worker_pool():
    """Background monitoring loop for spawned worker processes."""
    print("[STREAM MANAGER] Starting worker subprocess supervision loop...")
    while True:
        try:
            await start_worker_pool() # Ensure they are running
            
            # Watch for process crashes and frozen workers (missed heartbeats)
            now = datetime.utcnow()
            for w_id, info in list(_worker_processes.items()):
                proc = info["process"]
                
                # Check 1: Process exit
                exit_code = proc.poll()
                is_dead = exit_code is not None
                
                # Check 2: Missed heartbeats (for primary active workers that should be writing heartbeats)
                if not is_dead and not info.get("standby", False):
                    try:
                        hb = _db["worker_heartbeats"].find_one({"worker_id": w_id})
                        if hb and hb.get("last_seen"):
                            last_seen = hb["last_seen"]
                            elapsed = (now - last_seen).total_seconds()
                            if elapsed > 30:  # Timeout if no heartbeat for 30s (3 missed)
                                print(f"[STREAM MANAGER] 🚨 Worker subprocess {w_id} has frozen! No heartbeat for {elapsed:.1f}s. Terminating process...")
                                try:
                                    import psutil
                                    parent = psutil.Process(proc.pid)
                                    for child in parent.children(recursive=True):
                                        child.kill()
                                    parent.kill()
                                except Exception as kill_err:
                                    print(f"[STREAM MANAGER] Failed to kill frozen worker process via psutil: {kill_err}")
                                    try:
                                        proc.kill()
                                    except Exception:
                                        pass
                                is_dead = True
                    except Exception as hb_err:
                        print(f"[STREAM MANAGER] Error verifying heartbeat for {w_id}: {hb_err}")
                
                if is_dead:
                    if exit_code is not None:
                        print(f"[STREAM MANAGER] ⚠️ Worker subprocess {w_id} exited with code {exit_code}!")
                        try:
                            stderr_out = proc.stderr.read().decode(errors="replace").strip()
                            if stderr_out:
                                print(f"[STREAM MANAGER] Worker stderr: {stderr_out}")
                        except Exception:
                            pass
                    
                    # Remove from active processes list
                    _worker_processes.pop(w_id, None)
                    
                    # Check if it was a primary/active worker and handle failover
                    if not info.get("standby", False):
                        retries = _worker_retries.get(w_id, 0) + 1
                        _worker_retries[w_id] = retries
                        
                        if retries <= 3:
                            print(f"[STREAM MANAGER] Respawning primary worker {w_id} (Attempt {retries}/3)...")
                        else:
                            print(f"[STREAM MANAGER] 🚨 Primary worker {w_id} has crashed persistently! Triggering failover...")
                            
                            # Try to find a standby worker to promote
                            _, standby_workers = get_configured_workers()
                            standby_to_promote = None
                            for s_id in standby_workers:
                                if s_id in _worker_processes and _worker_processes[s_id]["process"].poll() is None:
                                    standby_to_promote = s_id
                                    break
                                    
                            if standby_to_promote:
                                print(f"[STREAM MANAGER] 🚀 Promoting standby worker {standby_to_promote} to take over {w_id} workload...")
                                
                                # Terminate standby process
                                s_proc = _worker_processes[standby_to_promote]["process"]
                                try:
                                    s_proc.terminate()
                                    s_proc.wait(timeout=2)
                                except:
                                    pass
                                
                                # Remove from registry and promote dynamically
                                standby_info = _worker_processes.pop(standby_to_promote)
                                _promoted_standbys.add(standby_to_promote)
                                
                                # Re-assign cameras in MongoDB
                                try:
                                    cameras_col.update_many(
                                        {"assigned_worker": w_id},
                                        {
                                            "$set": {
                                                "assigned_worker": standby_to_promote,
                                                "assigned_disk": standby_info["shard_path"],
                                                "assigned_at": datetime.utcnow()
                                            }
                                        }
                                    )
                                    _db["worker_heartbeats"].update_one(
                                        {"worker_id": w_id},
                                        {"$set": {"status": "dead"}}
                                    )
                                    print(f"[STREAM MANAGER] Re-assigned {w_id} workload to promoted standby {standby_to_promote}.")
                                except Exception as db_err:
                                    print(f"[STREAM MANAGER] Failover DB update failed: {db_err}")
                            else:
                                print(f"[STREAM MANAGER] ⚠️ No standby workers available! Re-sharding workload across remaining workers...")
                                # Mark as dead and trigger re-sharding across remaining workers
                                try:
                                    _db["worker_heartbeats"].update_one(
                                        {"worker_id": w_id},
                                        {"$set": {"status": "dead"}}
                                    )
                                except Exception:
                                    pass
                                await rebalance_sharding()
                    else:
                        print(f"[STREAM MANAGER] Respawning standby worker {w_id}...")
                        
        except Exception as e:
            print(f"[STREAM MANAGER] Worker pool supervision error: {e}")
            
        await asyncio.sleep(5)

def stop_worker_pool():
    print("[STREAM MANAGER] Shutting down worker process pool...")
    for w_id, info in list(_worker_processes.items()):
        proc = info["process"]
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        print(f"[STREAM MANAGER] ⏹ Stopped subprocess worker: {w_id}")
    _worker_processes.clear()

async def stream_watchdog():
    global _watchdog_cycle, _watchdog_failures, devices
    await asyncio.sleep(5)
    while True:
        _watchdog_cycle += 1
        
        # Reload devices dynamically to capture edits
        devices = load_devices()
        
        # Dynamically distribute camera workloads across worker processes
        await rebalance_sharding()
        
        for device in list(devices):
            stream_name = device.get("ome_stream")
            rtsp_url    = device.get("rtsp_url")
            if not stream_name or not rtsp_url:
                continue

            if device.get("enabled") is False:
                continue

            fail_count = _watchdog_failures.get(stream_name, 0)
            if fail_count >= WATCHDOG_MAX_RETRIES:
                if _watchdog_cycle % WATCHDOG_BACKOFF_RESET == 0:
                    print(f"[WATCHDOG] 🔄 Resetting backoff for {stream_name}")
                    _watchdog_failures[stream_name] = 0
                else:
                    continue

            if not stream_exists_in_mediamtx(stream_name):
                print(f"[WATCHDOG] ⚠️  Stream {stream_name} is down — re-registering...")
                try:
                    result      = register_stream(stream_name, rtsp_url)
                    status_code = result.get("statusCode", 0) if isinstance(result, dict) else 0
                    if status_code in (200, 201):
                        print(f"[WATCHDOG] ✅ Re-registered {stream_name}")
                        _watchdog_failures[stream_name] = 0
                    else:
                        _watchdog_failures[stream_name] = fail_count + 1
                        print(f"[WATCHDOG] ❌ Re-register failed for {stream_name}: {result}")
                except Exception as e:
                    _watchdog_failures[stream_name] = fail_count + 1
                    print(f"[WATCHDOG] ❌ Exception for {stream_name}: {e}")
            else:
                if _watchdog_failures.get(stream_name, 0) > 0:
                    print(f"[WATCHDOG] ✅ {stream_name} recovered")
                _watchdog_failures[stream_name] = 0

        await asyncio.sleep(WATCHDOG_INTERVAL)

async def main():
    print("[STREAM MANAGER] Booting standalone Stream Manager & Worker Supervisor...")
    # Run the worker pool supervisor and watchdog concurrently
    await asyncio.gather(
        supervise_worker_pool(),
        stream_watchdog()
    )

if __name__ == "__main__":
    try:
        import sys
        if sys.platform == 'win32':
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[STREAM MANAGER] Shutdown requested...")
        try:
            stop_worker_pool()
        except KeyboardInterrupt:
            pass
