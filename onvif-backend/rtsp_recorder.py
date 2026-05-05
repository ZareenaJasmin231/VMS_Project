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
from pymongo import MongoClient
import mask_service

from onvif_service import get_camera_system_time

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

# ── MongoDB for schedules ──────────────────────────────────────────
MONGO_URI    = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")
_mongo       = MongoClient(MONGO_URI)
_db          = _mongo["mirador-vms"]
_schedules   = _db["schedules"]

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
    _camera_data[stream_name].update(new_data)
    print(f"[RECORDER] 🔄 Metadata updated for {stream_name}: {new_data}")


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
        camera_time = None
        if camera_data and camera_data.get("ip"):
            camera_time = get_camera_system_time(
                camera_data.get("ip", ""),
                int(camera_data.get("port", 80)),
                camera_data.get("username", ""),
                camera_data.get("password", ""),
            )
            if camera_time is None:
                print(f"[RECORDER] ⚠ Camera time unavailable for {stream_name} — using host clock")
            else:
                print(f"[RECORDER] ℹ Using camera time for {stream_name}: {camera_time.isoformat()}")

        now = camera_time if camera_time is not None else datetime.now()

        # ── Check Schedule ──────────────────────────────────────────
        # If schedule is OFF, wait and poll.
        # Re-fetch metadata from our central store so updates apply immediately
        meta = _camera_data.get(stream_name, camera_data or {})
        schedule_id = meta.get("assigned_schedule_id")
        if not is_schedule_on(schedule_id, now):
            print(f"[RECORDER] 💤 Schedule OFF for {stream_name} — sleeping 30s")
            stop_event.wait(30)
            continue

        date_str  = now.strftime("%Y-%m-%d")
        time_str  = now.strftime("%H-%M-%S")
        timestamp = f"{date_str}_{time_str}"

        # ── Use the current effective recordings dir (respects runtime override) ──
        recordings_dir = get_recordings_dir()
        
        # ✅ GROUP BY IP FOLDER (standardize naming)
        ip_folder = (camera_data or {}).get("ip", stream_name).replace(".", "_")
        
        out_dir  = os.path.join(recordings_dir, ip_folder, date_str)
        os.makedirs(out_dir, exist_ok=True)
        
        # ✅ PREFIX FILENAME WITH STREAM NAME (avoid collision in same IP folder)
        out_file = os.path.join(out_dir, f"{stream_name}_{timestamp}.mp4")

        print(f"[RECORDER] 💾 Saving chunk to: {out_file}")

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
                "-an",
                "-movflags",       "+faststart",
                "-y",
                out_file,
            ]
        else:
            cmd = [
                FFMPEG_BIN,
                "-loglevel",       "error",
                "-rtsp_transport", "tcp",
                "-i",              rtsp_url,
                "-t",              str(CHUNK_SECONDS),
                "-c:v",            "copy",
                "-an",
                "-movflags",       "+faststart",
                "-y",
                out_file,
            ]

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )

            while proc.poll() is None:
                if stop_event.is_set():
                    proc.send_signal(signal.SIGTERM)
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                    break
                time.sleep(1)

            returncode = proc.returncode or 0
            if returncode not in (0, -15):
                stderr_out = proc.stderr.read().decode(errors="replace").strip()
                print(f"[RECORDER] ⚠ ffmpeg exited {returncode} for {stream_name}: {stderr_out[-200:]}")
                time.sleep(5)
            else:
                print(f"[RECORDER] ✅ Chunk saved: {out_file}")

        except FileNotFoundError:
            print(f"[RECORDER] ❌ ffmpeg not found. Install ffmpeg and ensure it is on PATH.")
            stop_event.wait(30)
        except Exception as exc:
            print(f"[RECORDER] ❌ Unexpected error for {stream_name}: {exc}")
            time.sleep(5)

    print(f"[RECORDER] ⏹ Stopped recorder for {stream_name}")
    _camera_data.pop(stream_name, None)


def update_camera_data(stream_name: str, patch: dict):
    """Update metadata for an active camera without restarting it."""
    if stream_name in _camera_data:
        _camera_data[stream_name].update(patch)
        print(f"[RECORDER] 📝 Updated metadata for {stream_name}: {patch}")


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


def stop_camera(stream_name: str):
    """Stop recording a single camera."""
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