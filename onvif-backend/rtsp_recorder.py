"""
rtsp_recorder.py
----------------
Records every registered RTSP camera into 5-minute MP4 chunks.
Saves files as:  <RECORDINGS_DIR>/<camera_id>/<YYYY-MM-DD>/<YYYY-MM-DD_HH-MM-SS>.mp4

The encrypt_service watchdog picks them up automatically after each chunk closes.

Run standalone:   python rtsp_recorder.py
Or import and call start_recording_all(devices) from main.py startup.
"""

import os
import subprocess
import threading
import time
import signal
from datetime import datetime

# ------------------------------------------------------------------
# Config — override with env vars in docker-compose if needed
# ------------------------------------------------------------------
RECORDINGS_DIR  = os.environ.get("RECORDINGS_DIR", "/recordings")
CHUNK_SECONDS   = int(os.environ.get("CHUNK_SECONDS", "300"))   # 5 minutes
FFMPEG_BIN      = os.environ.get("FFMPEG_BIN", "ffmpeg")

# Active recorder threads keyed by stream_name
_recorders: dict[str, threading.Thread] = {}
_stop_flags: dict[str, threading.Event] = {}


# ------------------------------------------------------------------
# Single-camera recorder loop
# ------------------------------------------------------------------
def _record_loop(stream_name: str, rtsp_url: str, stop_event: threading.Event):
    """
    Continuously records a camera in CHUNK_SECONDS segments using ffmpeg.
    Each segment is saved as  RECORDINGS_DIR/stream_name/date/date_time.mp4
    A new file is started automatically when the previous chunk closes —
    encrypt_service watchdog detects the closed file and encrypts it.
    """
    print(f"[RECORDER] ▶ Starting recorder for {stream_name}")

    while not stop_event.is_set():
        now        = datetime.now()
        date_str   = now.strftime("%Y-%m-%d")
        time_str   = now.strftime("%H-%M-%S")
        timestamp  = f"{date_str}_{time_str}"

        out_dir    = os.path.join(RECORDINGS_DIR, stream_name, date_str)
        os.makedirs(out_dir, exist_ok=True)

        out_file   = os.path.join(out_dir, f"{timestamp}.mp4")

        cmd = [
            FFMPEG_BIN,
            "-loglevel",  "error",
            "-rtsp_transport", "tcp",          # more reliable over TCP
            "-i",          rtsp_url,
            "-t",          str(CHUNK_SECONDS),  # stop after N seconds
            "-c:v",        "copy",              # copy video stream as-is, no re-encode
            "-an",                              # drop audio (avoids codec compatibility issues)
            "-movflags",   "+faststart",        # MP4 moov atom at front
            "-y",                               # overwrite if exists
            out_file,
        ]

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )

            # Poll every second so we can honour stop_event quickly
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
            if returncode not in (0, -15):   # -15 = SIGTERM (our clean stop)
                stderr_out = proc.stderr.read().decode(errors="replace").strip()
                print(f"[RECORDER] ⚠ ffmpeg exited {returncode} for {stream_name}: {stderr_out[-200:]}")
                # Brief pause before retrying to avoid hammering a dead stream
                time.sleep(5)
            else:
                print(f"[RECORDER] ✅ Chunk saved: {out_file}")

        except FileNotFoundError:
            print(f"[RECORDER] ❌ ffmpeg not found. Install ffmpeg and ensure it is on PATH.")
            stop_event.wait(30)   # wait 30 s then retry (gives time to install)
        except Exception as exc:
            print(f"[RECORDER] ❌ Unexpected error for {stream_name}: {exc}")
            time.sleep(5)

    print(f"[RECORDER] ⏹ Stopped recorder for {stream_name}")


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------
def start_camera(stream_name: str, rtsp_url: str):
    """Start recording a single camera. Safe to call multiple times."""
    if stream_name in _recorders and _recorders[stream_name].is_alive():
        print(f"[RECORDER] Already recording {stream_name}, skipping.")
        return

    stop_event = threading.Event()
    _stop_flags[stream_name] = stop_event

    t = threading.Thread(
        target=_record_loop,
        args=(stream_name, rtsp_url, stop_event),
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


def start_recording_all(devices: list):
    """Start recording all devices that have ome_stream + rtsp_url."""
    for device in devices:
        stream_name = device.get("ome_stream")
        rtsp_url    = device.get("rtsp_url")
        if stream_name and rtsp_url:
            start_camera(stream_name, rtsp_url)


def stop_all():
    """Stop all active recorders."""
    for name in list(_stop_flags.keys()):
        stop_camera(name)


# ------------------------------------------------------------------
# Standalone entry point (for testing without main.py)
# ------------------------------------------------------------------
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
        print(f"[RECORDER] Running — recording {len(devices)} camera(s). Ctrl+C to stop.")
        try:
            while True:
                time.sleep(10)
        except KeyboardInterrupt:
            print("\n[RECORDER] Shutting down...")
            stop_all()