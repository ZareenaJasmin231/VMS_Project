"""
rtsp_recorder.py
----------------
Records every registered RTSP camera into 5-minute MP4 chunks.
Saves files as:  <RECORDINGS_DIR>/<camera_id>/<YYYY-MM-DD>/<YYYY-MM-DD_HH-MM-SS>.mp4
Supports vf_filter for privacy masking burned into stream and recordings.

RECORDING PATH:
  Priority order for the recording directory:
    1. Runtime override set via set_recordings_dir() (called by /api/storage/apply)
    2. RECORDINGS_DIR environment variable
    3. Default: /recording
"""

import os
import subprocess
import threading
import time
import signal
from datetime import datetime
from app.core.database import mongo_client
from app.services.ai import mask_service

from app.services.camera.onvif_service import get_camera_system_time

# ── Default recordings directory (can be overridden at runtime) ──
_DEFAULT_RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "/recording")
_recordings_dir_lock    = threading.Lock()
_recordings_dir_override: str | None = None   # set by set_recordings_dir()

CHUNK_SECONDS = int(os.environ.get("CHUNK_SECONDS", "300"))
FFMPEG_BIN    = os.environ.get("FFMPEG_BIN", "ffmpeg")

_recorders:  dict[str, threading.Thread] = {}
_stop_flags: dict[str, threading.Event]  = {}
_vf_filters: dict[str, str]              = {}
_camera_data: dict[str, dict]             = {}
_motion_events: dict[str, threading.Event] = {}
_actively_recording_streams = set()

_latest_face_urls: dict[str, str] = {}
_last_trigger_log_times: dict[str, float] = {}
_last_motion_trigger_times: dict[str, float] = {}
_recording_durations: dict[str, dict[str, float]] = {}

# ── MongoDB (shared client for all recorder operations) ─────────────
MONGO_URI    = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")
_mongo       = mongo_client
_db = _mongo["mirador-vms"] if _mongo else None
_schedules = _db["schedules"] if _db is not None else None

def trigger_motion(stream_name: str, face_url: str | None = None):
    """Trigger a motion recording chunk for the given stream_name."""
    meta = _camera_data.get(stream_name, {})
    if not meta.get("motion_only", False):
        return

    _last_motion_trigger_times[stream_name] = time.time()

    if stream_name not in _motion_events:
        _motion_events[stream_name] = threading.Event()
    _motion_events[stream_name].set()
    
    local_time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[RECORDER] [{local_time_str}] 💥 Motion trigger received for {stream_name} (face_url: {face_url})")
    
    if face_url:
        _latest_face_urls[stream_name] = face_url
    else:
        _latest_face_urls.pop(stream_name, None)
        
    # Save log to ui_logs collection so it appears on the Logs page
    try:
        from datetime import timedelta
        ui_logs_col = _db["ui_logs"]
        
        now = time.time()
        last_log_time = _last_trigger_log_times.get(stream_name, 0)
        
        # If face_url is present, check if we logged a trigger in the last 15 seconds without a face_url, and update it
        if face_url:
            recent_log = ui_logs_col.find_one(
                {
                    "category": "recording",
                    "details.camera_id": stream_name,
                    "details.event": "motion_trigger",
                    "details.face_url": None,
                    "timestamp": {"$gte": (datetime.utcnow() - timedelta(seconds=15)).isoformat() + "Z"}
                },
                sort=[("timestamp", -1)]
            )
            if recent_log:
                ui_logs_col.update_one(
                    {"_id": recent_log["_id"]},
                    {"$set": {"details.face_url": face_url}}
                )
                print(f"[RECORDER] Attached face_url {face_url} to recent motion log.")
                return
        
        # Debounce writing new logs: 15 seconds per camera
        if now - last_log_time < 15:
            return
            
        _last_trigger_log_times[stream_name] = now
        
        ui_logs_col.insert_one({
            "user_email": "system",
            "user_role": "system",
            "action": f"[RECORDER] [{local_time_str}] 💥 Motion trigger received for {stream_name} (Motion is detected).",
            "category": "recording",
            "details": {
                "camera_id": stream_name, 
                "event": "motion_trigger",
                "face_url": face_url
            },
            "timestamp": datetime.utcnow().isoformat() + "Z"
        })
    except Exception as e:
        print(f"[RECORDER] Failed to log motion trigger to DB: {e}")


def is_schedule_on(schedule_id: str | int | None, now: datetime) -> bool:
    """
    Check if the current time is 'on' according to the assigned schedule.
    If no schedule is assigned, it defaults to 'Always ON'.
    """
    if not schedule_id or str(schedule_id).lower() == "always":
        return True
    
    # Try to find by ID (handling both string and numeric versions for legacy data)
    try:
        numeric_id = int(schedule_id)
        sch = _schedules.find_one({"id": {"$in": [str(schedule_id), numeric_id]}})
    except (ValueError, TypeError):
        sch = _schedules.find_one({"id": str(schedule_id)})
    
    if not sch:
        return True # Default to ON if schedule not found
    
    # 1. Check Exceptions (date-based override)
    date_iso = now.date().isoformat() # "YYYY-MM-DD"
    exceptions = sch.get("exceptions", [])
    # Check if any exception starts with our date string
    for exc in exceptions:
        if str(exc).startswith(date_iso):
            return False # Exceptions are 'Off' days
    
    # 2. Check Exact Time Ranges (if available)
    day_name = now.strftime("%A")
    ranges_data = sch.get("ranges", {})
    day_ranges = ranges_data.get(day_name)
    if day_ranges and day_ranges != "Always Off":
        # Example format: "07:20 - 07:45, 14:00 - 15:00"
        current_time_str = now.strftime("%H:%M")
        for r in day_ranges.split(", "):
            try:
                start_str, end_str = r.split(" - ")
                if start_str <= current_time_str < end_str:
                    return True
            except: continue
        return False # Within a day with ranges, but not in any active range

    # 3. Fallback to Week Schedule (5-min bitmask)
    week_data = sch.get("week", {})
    day_mask = week_data.get(day_name)
    
    if not day_mask or not isinstance(day_mask, list):
        return True # Default to ON if data missing
    
    # Calculate current 5-min slot index (0 to 287)
    minute_of_day = now.hour * 60 + now.minute
    slot_index = minute_of_day // 5
    
    if 0 <= slot_index < len(day_mask):
        status = day_mask[slot_index]
        return status
    
    return True


def update_camera_data(stream_name: str, new_data: dict):
    """Update metadata for an active camera (e.g. its assigned schedule)."""
    if stream_name not in _camera_data:
        _camera_data[stream_name] = {}
        
    old_motion_only = _camera_data[stream_name].get("motion_only")
    old_schedule = _camera_data[stream_name].get("assigned_schedule_id")
    
    _camera_data[stream_name].update(new_data)
    print(f"[RECORDER] 🔄 Metadata updated for {stream_name}: {new_data}")
    
    # If the camera is active and settings changed, force restart it to apply in real-time
    if stream_name in _recorders:
        new_motion_only = _camera_data[stream_name].get("motion_only")
        new_schedule = _camera_data[stream_name].get("assigned_schedule_id")
        
        # Check if they actually changed
        if (old_motion_only is not None and old_motion_only != new_motion_only) or \
           (old_schedule is not None and old_schedule != new_schedule):
            rtsp_url = _camera_data[stream_name].get("rtsp_url")
            if rtsp_url:
                print(f"[RECORDER] 🔄 Settings changed for active camera {stream_name}. Force restarting...")
                # We start a new thread to avoid blocking the API request during join
                def restart_target():
                    start_camera(stream_name, rtsp_url, _camera_data[stream_name], vf_filter=_vf_filters.get(stream_name, ""))
                threading.Thread(target=restart_target, daemon=True, name=f"restart-{stream_name}").start()


def get_recordings_dir() -> str:
    """Return the current effective recordings directory."""
    with _recordings_dir_lock:
        return _recordings_dir_override or _DEFAULT_RECORDINGS_DIR


def set_recordings_dir(path: str):
    """
    Override the recordings directory at runtime.
    Called by POST /api/storage/apply when the user changes the path in the UI.
    New recording chunks will immediately start writing to the new path.
    In-progress ffmpeg processes finish their current chunk at the old path,
    then the next chunk uses the new path.
    """
    global _recordings_dir_override
    path = path.strip()
    if not path:
        return
    with _recordings_dir_lock:
        _recordings_dir_override = path
    # Create the directory now so ffmpeg never fails on a missing path
    try:
        os.makedirs(path, exist_ok=True)
        print(f"[RECORDER] 📁 Recording path updated to: {path}")
    except Exception as e:
        print(f"[RECORDER] ⚠ Could not create recording directory '{path}': {e}")


def _record_loop(
    stream_name: str,
    rtsp_url: str,
    stop_event: threading.Event,
    camera_data: dict | None = None,
    vf_filter: str = "",
):
    print(f"[RECORDER] ▶ Starting recorder for {stream_name}"
          f"{' (with mask filter)' if vf_filter else ''}")

    while not stop_event.is_set():
        # Always use host system clock for proper syncage with saved time
        now = datetime.now()

        # ── Check Schedule ──────────────────────────────────────────
        # If schedule is OFF, wait and poll.
        # Re-fetch metadata from our central store so updates apply immediately
        meta = _camera_data.get(stream_name, camera_data or {})
        schedule_id = meta.get("assigned_schedule_id")
        if not is_schedule_on(schedule_id, now):
            print(f"[RECORDER] 💤 Schedule OFF for {stream_name} — sleeping 30s")
            stop_event.wait(30)
            continue

        # ── Check Motion-Only Mode ──────────────────────────────────
        motion_only = meta.get("motion_only", False)
        if motion_only:
            if stream_name not in _motion_events:
                _motion_events[stream_name] = threading.Event()
            # Clear any pending triggers before waiting
            _motion_events[stream_name].clear()
            print(f"[RECORDER] 🔍 {stream_name} is in motion-only mode. Waiting for motion trigger...")
            
            triggered = False
            while not stop_event.is_set():
                if _motion_events[stream_name].wait(timeout=1.0):
                    _motion_events[stream_name].clear()
                    triggered = True
                    break
            
            if not triggered or stop_event.is_set():
                continue
            
            # Recalculate 'now' after waiting for motion, so timestamps match the trigger
            now = datetime.now()

        date_str  = now.strftime("%Y-%m-%d")
        time_str  = now.strftime("%H-%M-%S")
        timestamp = f"{date_str}_{time_str}"
        if motion_only:
            filename = f"{timestamp}_motion_based.mp4"
        else:
            filename = f"{timestamp}.mp4"

        # ── Use the current effective recordings dir (respects runtime override) ──
        recordings_dir = get_recordings_dir()
        out_dir  = os.path.join(recordings_dir, stream_name, date_str)
        os.makedirs(out_dir, exist_ok=True)
        out_file = os.path.join(out_dir, filename)

        local_time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        if motion_only:
            face_url = _latest_face_urls.pop(stream_name, None)
            print(f"[RECORDER] [{local_time_str}] 🏃 Motion triggered for {stream_name}! Starting 5-minute recording (File: {filename}, Face: {face_url})...")
            
            # Save log to ui_logs collection
            try:
                _db["ui_logs"].insert_one({
                    "user_email": "system",
                    "user_role": "system",
                    "action": f"[RECORDER] [{local_time_str}] 🏃 Motion triggered for {stream_name}! Starting 5-minute recording (File: {filename})...",
                    "category": "recording",
                    "details": {
                        "camera_id": stream_name, 
                        "event": "recording_started", 
                        "duration": CHUNK_SECONDS,
                        "file_name": filename,
                        "face_url": face_url
                    },
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                })
            except Exception as e:
                print(f"[RECORDER] Failed to log recording start to DB: {e}")

        if motion_only:
            print(f"[RECORDER] [{local_time_str}] 💾 Recording {stream_name} -> {out_dir}")

        # ── Re-fetch mask filter each chunk so newly drawn masks apply immediately ──
        current_vf = vf_filter
        if camera_data and camera_data.get("ip"):
            fresh_vf = mask_service.build_ffmpeg_vf(camera_data["ip"]) or ""
            if fresh_vf != current_vf:
                if fresh_vf:
                    print(f"[RECORDER] 🎭 Mask filter updated for {stream_name}: {fresh_vf}")
                else:
                    print(f"[RECORDER] 🎭 Mask filter cleared for {stream_name}")
            current_vf = fresh_vf

        if current_vf:
            cmd = [
                FFMPEG_BIN,
                "-loglevel",       "error",
                "-rtsp_transport", "tcp",
                "-i",              rtsp_url,
                "-t",              str(CHUNK_SECONDS),
                "-vf",             current_vf,
                "-c:v",            "libx264",
                "-preset",         "ultrafast",
                "-crf",            "23",
                "-c:a",            "aac",
                "-map",            "0:v",
                "-map",            "0:a?",
                "-f",              "segment",
                "-segment_time",   "10",
                "-segment_format", "mpegts",
                "-movflags", "+faststart",
                "-avoid_negative_ts", "make_zero",
                "-y",
                os.path.join(out_dir, f"{time_str}_%03d.ts")
            ]
        else:
            cmd = [
                FFMPEG_BIN,
                "-loglevel",       "error",
                "-rtsp_transport", "tcp",
                "-i",              rtsp_url,
                "-t",              str(CHUNK_SECONDS),
                "-c:v",            "copy",
                "-c:a",            "aac",
                "-map",            "0:v",
                "-map",            "0:a?",
                "-f",              "segment",
                "-segment_time",   "10",
                "-segment_format", "mpegts",
                "-movflags", "+faststart",
                "-avoid_negative_ts", "make_zero",
                "-y",
                os.path.join(out_dir, f"{time_str}_%03d.ts")
            ]

        _actively_recording_streams.add(stream_name)
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            
            from app.utils.ffmpeg_utils import register_process, unregister_process
            register_process(proc)

            chunk_start = time.time()
            if motion_only and stream_name not in _last_motion_trigger_times:
                _last_motion_trigger_times[stream_name] = chunk_start

            while proc.poll() is None:
                if stop_event.is_set():
                    proc.send_signal(signal.SIGTERM)
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                    break

                if motion_only:
                    elapsed_since_motion = time.time() - _last_motion_trigger_times.get(stream_name, chunk_start)
                    total_duration = time.time() - chunk_start
                    
                    if elapsed_since_motion > 30.0:
                        local_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        print(f"[RECORDER] [{local_time}] ⏹ No motion detected for 30s buffer. Stopping recording early for {stream_name}.")
                        proc.send_signal(signal.SIGTERM)
                        try:
                            proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                        break
                        
                    if total_duration >= 300.0:
                        local_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        print(f"[RECORDER] [{local_time}] ⏹ Reached 5-minute max recording limit. Stopping recording for {stream_name}.")
                        proc.send_signal(signal.SIGTERM)
                        try:
                            proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                        break

                time.sleep(1)

            final_duration = time.time() - chunk_start
            _recording_durations.setdefault(stream_name, {})[time_str] = final_duration

            returncode = proc.returncode or 0
            if returncode not in (0, -15):
                stderr_out = proc.stderr.read().decode(errors="replace").strip()
                print(f"[RECORDER] ⚠ ffmpeg exited {returncode} for {stream_name}: {stderr_out[-200:]}")
                time.sleep(5)
            else:
                if motion_only:
                    print(f"[RECORDER] [{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ Chunk saved: {out_file}")

        except FileNotFoundError:
            print(f"[RECORDER] ❌ ffmpeg not found. Install ffmpeg and ensure it is on PATH.")
            stop_event.wait(30)
        except Exception as exc:
            print(f"[RECORDER] ❌ Unexpected error for {stream_name}: {exc}")
            time.sleep(5)
        finally:
            if 'proc' in locals():
                unregister_process(proc)
            _actively_recording_streams.discard(stream_name)

    print(f"[RECORDER] ⏹ Stopped recorder for {stream_name}")
    _camera_data.pop(stream_name, None)


# _segmenters:  dict[str, subprocess.Popen] = {}


# def start_segmenter(stream_name: str, rtsp_url: str, vf_filter: str = ""):
#     """Start background rolling segmenter for instant 10s playback clips."""
#     try:
#         temp_dir = os.path.join(get_recordings_dir(), "temp_segments", stream_name)
#         # Clear out any stale segments from previous runs to ensure fresh buffer
#         import shutil
#         if os.path.exists(temp_dir):
#             shutil.rmtree(temp_dir)
#         os.makedirs(temp_dir, exist_ok=True)

#         if vf_filter:
#             cmd = [
#                 FFMPEG_BIN, "-y",
#                 "-loglevel", "error",
#                 "-rtsp_transport", "tcp",
#                 "-i", rtsp_url,
#                 "-vf", vf_filter,
#                 "-c:v", "libx264",
#                 "-preset", "ultrafast",
#                 "-crf", "28",
#                 "-an",
#                 "-f", "segment",
#                 "-segment_time", "2",
#                 "-segment_wrap", "10",
#                 "-segment_list", os.path.join(temp_dir, "playlist.m3u8"),
#                 os.path.join(temp_dir, "seg_%03d.ts")
#             ]
#         else:
#             cmd = [
#                 FFMPEG_BIN, "-y",
#                 "-loglevel", "error",
#                 "-rtsp_transport", "tcp",
#                 "-i", rtsp_url,
#                 "-c", "copy",
#                 "-an",
#                 "-f", "segment",
#                 "-segment_time", "2",
#                 "-segment_wrap", "10",
#                 "-segment_list", os.path.join(temp_dir, "playlist.m3u8"),
#                 os.path.join(temp_dir, "seg_%03d.ts")
#             ]

#         proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
#         _segmenters[stream_name] = proc
#         print(f"[RECORDER] 🔄 Rolling segmenter started for {stream_name}")
#     except Exception as e:
#         print(f"[RECORDER] ❌ Failed to start segmenter for {stream_name}: {e}")


# def stop_segmenter(stream_name: str):
#     """Stop the background rolling segmenter."""
#     if stream_name in _segmenters:
#         proc = _segmenters.pop(stream_name)
#         try:
#             proc.terminate()
#             proc.wait(timeout=5)
#         except Exception:
#             try:
#                 proc.kill()
#             except Exception:
#                 pass
#         print(f"[RECORDER] ⏹ Stopped segmenter for {stream_name}")       


def start_camera(
    stream_name: str,
    rtsp_url: str,
    camera_data: dict | None = None,
    vf_filter: str = "",
):
    if stream_name in _recorders:
        print(f"[RECORDER] 🔄 Force restarting {stream_name}")
        stop_camera(stream_name)

    # Auto-load mask filter from mask_service if no explicit vf_filter was passed
    if not vf_filter and camera_data and camera_data.get("ip"):
        ip = camera_data.get("ip", "")
        vf_filter = mask_service.build_ffmpeg_vf(ip) or ""
        if vf_filter:
            print(f"[RECORDER] 🎭 Mask filter loaded for {stream_name}: {vf_filter}")

    _vf_filters[stream_name] = vf_filter

    stop_event = threading.Event()
    _stop_flags[stream_name] = stop_event

    t = threading.Thread(
        target=_record_loop,
        args=(stream_name, rtsp_url, stop_event, camera_data, vf_filter),
        daemon=True,
        name=f"recorder-{stream_name}",
    )
    _recorders[stream_name] = t
    _camera_data[stream_name] = camera_data or {}
    t.start()
    print(f"[RECORDER] 🎥 Started: {stream_name} → {get_recordings_dir()}")
    # # Start the parallel unencrypted rolling segmenter
    # start_segmenter(stream_name, rtsp_url, vf_filter)
def stop_camera(stream_name: str):
    """Stop recording a single camera."""
    # stop_segmenter(stream_name)
    if stream_name in _stop_flags:
        _stop_flags[stream_name].set()
        if stream_name in _recorders:
            _recorders[stream_name].join(timeout=10)
        _recorders.pop(stream_name, None)
        _stop_flags.pop(stream_name, None)
        _vf_filters.pop(stream_name, None)
        print(f"[RECORDER] ⏹ Stopped: {stream_name}")
    else:
        print(f"[RECORDER] ℹ No active recorder found for: {stream_name}")


def start_recording_all(devices: list):
    """
    Start recording all ENABLED devices that have ome_stream + rtsp_url.
    Cameras with enabled=False are skipped entirely.
    """
    for device in devices:
        if device.get("enabled") is False:
            stream_name = device.get("ome_stream", device.get("ip", "unknown"))
            print(f"[RECORDER] ⏭ Skipping disabled camera: {stream_name}")
            continue

        stream_name = device.get("ome_stream")
        rtsp_url    = device.get("rtsp_url")

        if stream_name and rtsp_url:
            # Reload mask filter fresh from mask_service on every startup
            ip = device.get("ip", "")
            vf = mask_service.build_ffmpeg_vf(ip) or "" if ip else _vf_filters.get(stream_name, "")
            start_camera(stream_name, rtsp_url, device, vf_filter=vf)


def stop_all():
    """Stop all active recorders."""
    for name in list(_stop_flags.keys()):
        stop_camera(name)


if __name__ == "__main__":
    import json

    DEVICES_FILE = os.environ.get("DEVICES_FILE", "/app/data/devices.json")

    try:
        with open(DEVICES_FILE) as f:
            devices = json.load(f)
    except Exception as e:
        print(f"[RECORDER] Could not load devices file: {e}")
        devices = []

    if not devices:
        print("[RECORDER] No devices found. Add cameras via the API first.")
    else:
        start_recording_all(devices)
        enabled_count = sum(1 for d in devices if d.get("enabled") is not False)
        print(f"[RECORDER] Running — recording {enabled_count}/{len(devices)} enabled camera(s). Ctrl+C to stop.")
        try:
            while True:
                time.sleep(10)
        except KeyboardInterrupt:
            print("\n[RECORDER] Shutting down...")
            stop_all()
