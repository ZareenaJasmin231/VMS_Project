import os
import subprocess
import threading
import time
import sys

from pathlib import Path
# Try to load env if needed
env_path = Path(__file__).parent.parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip().strip("'\""))

from app.utils.ffmpeg_utils import FFMPEG_BIN
from app.core.database import db

# FFMPEG_BIN is now directly imported
RTSP_OUT_BASE = "rtsp://localhost:8554"

_transcoders = {}
_actively_transcoding = set()
_last_status_write = 0

class CameraTranscoder:
    def __init__(self, stream_name: str, rtsp_url: str):
        self.stream_name = stream_name
        self.rtsp_url = rtsp_url
        self.proc = None
        self.state = "IDLE"
        self.stop_event = threading.Event()
        self.use_gpu = False  # CPU-only mode (libx264)
        
    def is_alive(self):
        return self.state == "RUNNING"
        
    def tick(self):
        if self.stop_event.is_set():
            if self.state == "RUNNING":
                self._stop_ffmpeg()
            return

        if self.state == "IDLE":
            self._start_ffmpeg()
        elif self.state == "RUNNING":
            poll_code = self.proc.poll()
            if poll_code is not None:
                stderr_out = ""
                try:
                    if self.proc and self.proc.stderr:
                        stderr_out = self.proc.stderr.read().decode("utf-8", errors="replace").strip()
                except: pass
                print(f"[TRANSCODER] ERROR: FFmpeg exited for {self.stream_name} with code {poll_code}:\n{stderr_out}")
                
                # Wait before trying again to avoid rapid crash loops
                time.sleep(2)
                
                # If we failed with GPU, fallback to CPU
                if self.use_gpu:
                    print(f"[TRANSCODER] INFO: Falling back to CPU encoding for {self.stream_name}")
                    self.use_gpu = False
                self.state = "IDLE"

    def _start_ffmpeg(self):
        vcodec = "h264_nvenc -preset p2 -zerolatency 1 -delay 0 -b:v 2M" if self.use_gpu else "libx264 -preset veryfast -tune zerolatency -b:v 2M"        
        target_stream_name = f"{self.stream_name}_h264"
        cmd = [
            FFMPEG_BIN,
            "-rtsp_transport", "tcp",
            "-i", self.rtsp_url,
            "-c:v", *vcodec.split(),
            "-c:a", "copy",
            "-rtsp_transport", "tcp",
            "-f", "rtsp",
            f"{RTSP_OUT_BASE}/{target_stream_name}"
        ]
        
        try:
            self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            self.state = "RUNNING"
            print(f"[TRANSCODER] OK: Started transcoding {self.stream_name} (GPU={self.use_gpu})")
        except Exception as e:
            print(f"[TRANSCODER] ERROR: Failed to start FFmpeg: {e}")
            self.state = "IDLE"
            
    def _stop_ffmpeg(self):
        if self.proc and self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait()
        self.state = "STOPPED"

def start_transcoder(stream_name: str, rtsp_url: str):
    if stream_name in _transcoders:
        return
    transcoder = CameraTranscoder(stream_name, rtsp_url)
    _transcoders[stream_name] = transcoder
    _actively_transcoding.add(stream_name)

def stop_transcoder(stream_name: str):
    if stream_name in _transcoders:
        t = _transcoders[stream_name]
        t.stop_event.set()
        t._stop_ffmpeg()
        del _transcoders[stream_name]
        _actively_transcoding.discard(stream_name)

def stop_all():
    for name in list(_transcoders.keys()):
        stop_transcoder(name)

def tick_all():
    global _last_status_write
    for name, t in list(_transcoders.items()):
        try:
            t.tick()
        except Exception as e:
            print(f"[TRANSCODER] Error ticking {name}: {e}")

    now = time.time()
    if now - _last_status_write > 5.0:
        _last_status_write = now
        active = [name for name, t in _transcoders.items() if t.is_alive() and name in _actively_transcoding]
        try:
            if db is not None:
                db["system_status"].update_one(
                    {"type": "transcoder_status"},
                    {"$set": {"active_transcoders": active, "timestamp": now}},
                    upsert=True
                )
        except: pass
