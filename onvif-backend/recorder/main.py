import os
import time
from recorder import rtsp_recorder as recorder
from recorder import encrypt_service
from app.core.database import cameras_col

def start():
    print("[RECORDER] Starting Mirador VMS Recorder Service...")
    
    # 1. Load active cameras from MongoDB
    if cameras_col is None:
        print("[RECORDER] ❌ MongoDB cameras collection is not connected. Exiting.")
        return
        
    try:
        devices = list(cameras_col.find({"enabled": {"$ne": False}}))
        print(f"[RECORDER] Found {len(devices)} active camera(s) in database.")
    except Exception as e:
        print(f"[RECORDER] ❌ Failed to fetch cameras from database: {e}")
        return

    if not devices:
        print("[RECORDER] No active cameras found to record. Add or enable cameras in the API.")
        devices = []

    # 2. Start recording all active cameras
    recorder.start_recording_all(devices)
    
    # 3. Start encryption and appending service
    encrypt_service.start_watcher()
    
    print("[RECORDER] Recorder threadless loop active. Press Ctrl+C to stop.")
    try:
        while True:
            recorder.tick_all()
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[RECORDER] Shutting down recorder...")
        recorder.stop_all()
        encrypt_service.stop_watcher()
