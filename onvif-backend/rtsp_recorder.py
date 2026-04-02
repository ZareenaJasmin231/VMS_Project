"""
rtsp_recorder.py
----------------
Records every registered RTSP camera into 5-minute MP4 chunks.
Saves files as:  <RECORDINGS_DIR>/<camera_id>/<YYYY-MM-DD>/<YYYY-MM-DD_HH-MM-SS>.mp4

The encrypt_service watchdog picks them up automatically after each chunk closes.
"""

import os
import subprocess
import threading
import time
import signal
from datetime import datetime

from onvif_service import get_camera_system_time

# ------------------------------------------------------------------
# Config
# ------------------------------------------------------------------
RECORDINGS_DIR  = os.environ.get("RECORDINGS_DIR", "/recording")
CHUNK_SECONDS   = int(os.environ.get("CHUNK_SECONDS", "300"))
FFMPEG_BIN      = os.environ.get("FFMPEG_BIN", "ffmpeg")

# Active recorder threads keyed by stream_name
_recorders: dict[str, threading.Thread] = {}
_stop_flags: dict[str, threading.Event] = {}


# ------------------------------------------------------------------
# Single-camera recorder loop
# ------------------------------------------------------------------
def _record_loop(stream_name: str, rtsp_url: str, stop_event: threading.Event, camera_data: dict | None = None):
    print(f"[RECORDER] ▶ Starting recorder for {stream_name}")

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

        now       = camera_time or datetime.now()
        date_str  = now.strftime("%Y-%m-%d")
        time_str  = now.strftime("%H-%M-%S")
        timestamp = f"{date_str}_{time_str}"

        out_dir  = os.path.join(RECORDINGS_DIR, stream_name, date_str)
        os.makedirs(out_dir, exist_ok=True)
        out_file = os.path.join(out_dir, f"{timestamp}.mp4")

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
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

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


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------
def start_camera(stream_name: str, rtsp_url: str, camera_data: dict | None = None):
    """Start recording a single camera. Safe to call multiple times."""
    if stream_name in _recorders and _recorders[stream_name].is_alive():
        print(f"[RECORDER] Already recording {stream_name}, skipping.")
        return

    stop_event = threading.Event()
    _stop_flags[stream_name] = stop_event

    t = threading.Thread(
        target=_record_loop,
        args=(stream_name, rtsp_url, stop_event, camera_data),
        daemon=True,
        name=f"recorder-{stream_name}",
    )
    _recorders[stream_name] = t
    t.start()
    print(f"[RECORDER] 🎥 Started: {stream_name}")


def stop_camera(stream_name: str):
    """Stop recording a single camera."""
    if stream_name in _stop_flags:
        _stop_flags[stream_name].set()
        if stream_name in _recorders:
            _recorders[stream_name].join(timeout=10)
        _recorders.pop(stream_name, None)
        _stop_flags.pop(stream_name, None)
        print(f"[RECORDER] ⏹ Stopped: {stream_name}")
    else:
        print(f"[RECORDER] ℹ No active recorder found for: {stream_name}")


def start_recording_all(devices: list):
    """
    Start recording all ENABLED devices that have ome_stream + rtsp_url.
    Cameras with enabled=False are skipped entirely.
    """
    for device in devices:
        # ── Skip cameras explicitly marked as disabled ──
        if device.get("enabled") is False:
            stream_name = device.get("ome_stream", device.get("ip", "unknown"))
            print(f"[RECORDER] ⏭ Skipping disabled camera: {stream_name}")
            continue

        stream_name = device.get("ome_stream")
        rtsp_url    = device.get("rtsp_url")
        if stream_name and rtsp_url:
            start_camera(stream_name, rtsp_url, device)


def stop_all():
    """Stop all active recorders."""
    for name in list(_stop_flags.keys()):
        stop_camera(name)


# ------------------------------------------------------------------
# Standalone entry point
# ------------------------------------------------------------------
if __name__ == "__main__":
    import json

    DEVICES_FILE = os.environ.get(
        "DEVICES_FILE",
        os.path.join(os.path.dirname(__file__), "..", "devices_data", "devices.json")
    )

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
