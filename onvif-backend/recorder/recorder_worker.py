import os
import sys
import time
import argparse
import threading
import psutil
from datetime import datetime
from pymongo import MongoClient

# Add backend root directory to path so imports work correctly when running as script
backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_root not in sys.path:
    sys.path.insert(0, backend_root)

# Import recorder and encrypt service
from recorder import rtsp_recorder as recorder
from recorder import encrypt_service

def parse_args():
    parser = argparse.ArgumentParser(description="VMS Sharded Recorder Worker Process")
    parser.add_argument("--worker-id", required=True, help="Unique identifier for this worker (e.g. worker-1)")
    parser.add_argument("--shard-path", required=True, help="Direct Windows drive recording path (e.g. D:\\REC\\shard1)")
    parser.add_argument("--standby", action="store_true", help="Start worker in idle standby mode")
    return parser.parse_args()

def publish_heartbeat(mongo_uri: str, worker_id: str, active_cameras: list, status: str = "active"):
    try:
        client = MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
        db = client["vms_db"]
        heartbeats_col = db["worker_heartbeats"]
        
        cpu_percent = psutil.cpu_percent()
        mem_info = psutil.virtual_memory()
        
        # Determine actively recording streams on this worker
        active_recorders = [
            name for name, rec in recorder._recorders.items()
            if rec.is_alive() and name in getattr(recorder, '_actively_recording_streams', set())
        ]
        
        heartbeats_col.update_one(
            {"worker_id": worker_id},
            {
                "$set": {
                    "worker_id": worker_id,
                    "status": status,
                    "last_seen": datetime.utcnow(),
                    "cameras": active_cameras,
                    "active_recorders": active_recorders,
                    "system_stats": {
                        "cpu_percent": cpu_percent,
                        "memory_percent": mem_info.percent
                    }
                }
            },
            upsert=True
        )
        client.close()
    except Exception as e:
        print(f"[WORKER-{worker_id}] Heartbeat update failed: {e}")

def main():
    args = parse_args()
    worker_id = args.worker_id
    shard_path = args.shard_path
    is_standby = args.standby
    status = "standby" if is_standby else "active"
    
    print(f"[WORKER-{worker_id}] Starting sharded worker process...")
    print(f"[WORKER-{worker_id}] Shard path set to: {shard_path}")
    print(f"[WORKER-{worker_id}] Mode: {'Standby' if is_standby else 'Active'}")
    
    # 1. Apply shard path to recorder process config
    recorder.set_recordings_dir(shard_path)
    
    # 2. Start encryption watcher on this shard
    encrypt_service.start_watcher()
    print(f"[WORKER-{worker_id}] Local encryption watcher started on {shard_path}")
    
    # Mongo connection URI
    mongo_uri = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
    
    # Main sync loop
    last_heartbeat_time = 0
    heartbeat_interval = 10  # Seconds
    last_db_poll_time = 0
    db_poll_interval = 3  # Seconds
    
    while True:
        try:
            # 1. Tick all active threadless recorders
            recorder.tick_all()
            
            # 2. Publish heartbeat periodically
            now = time.time()
            if now - last_heartbeat_time >= heartbeat_interval:
                active_cameras = list(recorder._recorders.keys())
                publish_heartbeat(mongo_uri, worker_id, active_cameras, status)
                last_heartbeat_time = now
                
            if is_standby:
                # Standby workers stay idle and do not pull camera configurations
                time.sleep(1)
                continue
                
            # 3. Poll camera assignments periodically
            if now - last_db_poll_time >= db_poll_interval:
                # Connect to DB and fetch camera assignments
                client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
                db = client["vms_db"]  # Replace with your database name
                cameras_col = db["cameras"]
                
                # Fetch all cameras assigned to this worker that are enabled
                assigned_cameras = list(cameras_col.find({
                    "assigned_worker": worker_id,
                    "enabled": {"$ne": False}
                }))
                client.close()
                
                # Build current assignment map
                assigned_map = {}
                for cam in assigned_cameras:
                    stream_name = cam.get("ome_stream")
                    rtsp_url = cam.get("recording_rtsp", cam.get("rtsp_url"))
                    if stream_name and rtsp_url:
                        assigned_map[stream_name] = {
                            "rtsp_url": rtsp_url,
                            "device_data": cam
                        }
                
                active_running_streams = list(recorder._recorders.keys())
                
                # Stop any recorders that are no longer assigned to us
                for stream_name in active_running_streams:
                    if stream_name not in assigned_map:
                        print(f"[WORKER-{worker_id}] ⏹ Stopping unassigned camera recorder: {stream_name}")
                        recorder.stop_camera(stream_name)
                
                # Start or update any assigned recorders
                for stream_name, cam_info in assigned_map.items():
                    is_running = stream_name in recorder._recorders and recorder._recorders[stream_name].is_alive()
                    
                    # Check if the RTSP URL of the running recorder differs from the assigned one
                    current_recorded_rtsp = recorder._camera_data.get(stream_name, {}).get("recording_rtsp") or recorder._camera_data.get(stream_name, {}).get("rtsp_url")
                    rtsp_changed = current_recorded_rtsp != cam_info["rtsp_url"]
                    
                    # Check if stream profiles changed
                    current_profiles = recorder._camera_data.get(stream_name, {}).get("stream_profiles")
                    assigned_profiles = cam_info["device_data"].get("stream_profiles")
                    profiles_changed = current_profiles != assigned_profiles
                    
                    if not is_running or rtsp_changed or profiles_changed:
                        if is_running:
                            reason = "RTSP URL changed" if rtsp_changed else "Stream profiles changed"
                            print(f"[WORKER-{worker_id}] 🔄 {reason} for {stream_name}. Restarting recorder...")
                            recorder.stop_camera(stream_name)
                            time.sleep(0.5)
                        
                        print(f"[WORKER-{worker_id}] 🎥 Starting assigned camera recorder: {stream_name}")
                        # Build mask filter if present
                        from app.services.ai import mask_service
                        ip = cam_info["device_data"].get("ip", "")
                        vf = mask_service.build_ffmpeg_vf(ip) or "" if ip else ""
                        
                        recorder.start_camera(
                            stream_name,
                            cam_info["rtsp_url"],
                            cam_info["device_data"],
                            vf_filter=vf
                        )
                last_db_poll_time = now
                
        except Exception as e:
            print(f"[WORKER-{worker_id}] Error in worker sync loop: {e}")
            
        time.sleep(1)  # Tick every 1 second

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("[WORKER] KeyboardInterrupt received. Shutting down recorders...")
        recorder.stop_all()
        encrypt_service.stop_watcher()
        sys.exit(0)
