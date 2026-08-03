import os
import sys
import time
import argparse
import psutil
from datetime import datetime
from pymongo import MongoClient

# Add backend root directory to path so imports work correctly when running as script
backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_root not in sys.path:
    sys.path.insert(0, backend_root)

from transcoder import transcoder_service

def parse_args():
    parser = argparse.ArgumentParser(description="VMS Transcoder Worker Process")
    parser.add_argument("--worker-id", required=True, help="Unique identifier for this worker (e.g. transcoder-1)")
    return parser.parse_args()

def publish_heartbeat(mongo_uri: str, worker_id: str, active_cameras: list, status: str = "active"):
    mongo_db_name = os.environ.get("MONGO_DB_NAME")

    try:
        client = MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
        db = client[mongo_db_name]
        heartbeats_col = db["worker_heartbeats"]

        cpu_percent = psutil.cpu_percent()
        mem_info = psutil.virtual_memory()

        active_transcoders = [
            name for name, t in transcoder_service._transcoders.items()
            if t.is_alive() and name in transcoder_service._actively_transcoding
        ]

        heartbeats_col.update_one(
            {"worker_id": worker_id},
            {
                "$set": {
                    "worker_id": worker_id,
                    "worker_type": "transcoder",
                    "status": status,
                    "last_seen": datetime.utcnow(),
                    "cameras": active_cameras,
                    "active_transcoders": active_transcoders,
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
    status = "active"

    print(f"[WORKER-{worker_id}] Starting transcoder worker process...")

    mongo_uri = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
    mongo_db_name = os.environ.get("MONGO_DB_NAME")

    last_heartbeat_time = 0
    heartbeat_interval = 10
    last_db_poll_time = 0
    db_poll_interval = 3

    while True:
        try:
            transcoder_service.tick_all()

            now = time.time()
            if now - last_heartbeat_time >= heartbeat_interval:
                active_cameras = list(transcoder_service._transcoders.keys())
                publish_heartbeat(mongo_uri, worker_id, active_cameras, status)
                last_heartbeat_time = now

            if now - last_db_poll_time >= db_poll_interval:
                client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
                db = client[mongo_db_name]
                cameras_col = db["cameras"]

                # Fetch all cameras assigned to this transcoder and filter in Python to avoid MongoDB operator issues
                all_assigned = list(cameras_col.find({"transcoder_assigned_worker": worker_id}))
                assigned_cameras = [
                    cam for cam in all_assigned
                    if cam.get("enabled") is not False
                    and str(cam.get("codec", "")).upper() not in ["H.264", "H264", "", "NONE"]
                ]
                client.close()

                assigned_map = {}
                for cam in assigned_cameras:
                    stream_name = cam.get("stream_key")
                    rtsp_url = cam.get("rtsp_url")
                    if stream_name and rtsp_url:
                        assigned_map[stream_name] = rtsp_url

                active_running_streams = list(transcoder_service._transcoders.keys())

                # Stop transcoders no longer assigned
                for stream_name in active_running_streams:
                    if stream_name not in assigned_map:
                        print(f"[WORKER-{worker_id}] STOPPING unassigned camera transcoder: {stream_name}")
                        transcoder_service.stop_transcoder(stream_name)

                # Start or update assigned transcoders
                for stream_name, rtsp_url in assigned_map.items():
                    is_running = stream_name in transcoder_service._transcoders
                    if not is_running:
                        print(f"[WORKER-{worker_id}] STARTING assigned camera transcoder: {stream_name}")
                        transcoder_service.start_transcoder(stream_name, rtsp_url)

                last_db_poll_time = now

        except Exception as e:
            print(f"[WORKER-{worker_id}] Error in worker sync loop: {e}")

        time.sleep(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("[WORKER] KeyboardInterrupt received. Shutting down transcoders...")
        transcoder_service.stop_all()
        sys.exit(0)