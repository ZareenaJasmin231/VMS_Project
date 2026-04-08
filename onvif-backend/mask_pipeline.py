"""
mask_pipeline.py
────────────────────────────────────────────────────────────────────────────
Manages one FFmpeg process per camera that:

  1. Pulls the raw RTSP from the camera
  2. Applies boxblur on each active zone
  3. Pushes the blurred stream to OME via RTMP as  <stream>_masked

OME then exposes the masked stream as:
  WebRTC  →  ws://host:3333/app/<stream>_masked        (live view)
  RTSP    →  rtsp://ome:554/app/<stream>_masked        (recorder reads this)

When all zones are deleted the pipeline stops and the recorder is switched
back to the raw camera RTSP.  All of that coordination happens in
mask_service.py — this file only handles the FFmpeg subprocess.
"""

import subprocess
import shlex
import logging
import os

logger = logging.getLogger(__name__)

# ── Docker-internal hostnames ─────────────────────────────────────────────
OME_RTMP_HOST = os.getenv("OME_RTMP_HOST", "ome")
OME_RTMP_PORT = os.getenv("OME_RTMP_PORT", "1935")
OME_RTSP_HOST = os.getenv("OME_RTSP_HOST", "ome")
OME_RTSP_PORT = os.getenv("OME_RTSP_PORT", "554")
OME_APP       = os.getenv("OME_APP",       "app")

# camera_id → Popen
_processes: dict[str, subprocess.Popen] = {}


# ── Public helpers ────────────────────────────────────────────────────────

def get_masked_stream_name(camera_id: str) -> str:
    return f"{camera_id}_masked"


def get_masked_rtsp_url(camera_id: str) -> str:
    """RTSP URL that OME exposes for the masked stream — used by the recorder."""
    return f"rtsp://{OME_RTSP_HOST}:{OME_RTSP_PORT}/{OME_APP}/{get_masked_stream_name(camera_id)}"


def get_masked_ws_url(camera_id: str, host_ip: str, ws_port: str = "3333") -> str:
    """WebRTC WS URL for the masked stream — used by the frontend live view."""
    return f"ws://{host_ip}:{ws_port}/{OME_APP}/{get_masked_stream_name(camera_id)}"


# ── FFmpeg command builder ────────────────────────────────────────────────

def _build_cmd(
    rtsp_url:     str,
    masked_name:  str,
    zones:        list[dict],
    width:        int = 1920,
    height:       int = 1080,
) -> list[str]:
    """
    Build the FFmpeg command.

    Each zone dict: { x, y, w, h }  — normalized 0.0–1.0, top-left origin.

    Filter chain (one iteration per zone):
      prev_out → split[baseN][workN]
      [workN]  → crop=W:H:X:Y, boxblur → [blurN]
      [baseN][blurN] → overlay=X:Y → [outN]

    Final [outN] → libx264 ultrafast → RTMP → OME
    """
    rtmp_url = f"rtmp://{OME_RTMP_HOST}:{OME_RTMP_PORT}/{OME_APP}/{masked_name}"

    base_cmd = [
        "ffmpeg", "-y",
        "-rtsp_transport", "tcp",
        "-i", rtsp_url,
    ]

    active = [z for z in zones if z.get("enabled", True)]

    if not active:
        # No zones — passthrough re-encode
        return base_cmd + [
            "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
            "-b:v", "2M", "-g", "30",
            "-c:a", "aac", "-b:a", "64k",
            "-f", "flv", rtmp_url,
        ]

    parts = []
    prev  = "[0:v]"

    for i, zone in enumerate(active):
        # Normalize → pixel, clamped to frame
        px = max(0, int(zone["x"] * width))
        py = max(0, int(zone["y"] * height))
        pw = max(4, int(zone["w"] * width))
        ph = max(4, int(zone["h"] * height))
        pw = min(pw, width  - px)
        ph = min(ph, height - py)

        base  = f"[base{i}]"
        work  = f"[work{i}]"
        blurd = f"[blur{i}]"
        out   = f"[out{i}]"

        parts.append(f"{prev}split{base}{work}")
        parts.append(f"{work}crop={pw}:{ph}:{px}:{py},boxblur=luma_radius=20:luma_power=3{blurd}")
        parts.append(f"{base}{blurd}overlay={px}:{py}{out}")
        prev = out

    return base_cmd + [
        "-filter_complex", ";".join(parts),
        "-map", prev,
        "-map", "0:a?",
        "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
        "-b:v", "2M", "-maxrate", "2M", "-bufsize", "1M", "-g", "30",
        "-c:a", "aac", "-b:a", "64k",
        "-f", "flv", rtmp_url,
    ]


# ── Lifecycle ─────────────────────────────────────────────────────────────

def start_pipeline(
    camera_id: str,
    rtsp_url:  str,
    zones:     list[dict],
    width:     int = 1920,
    height:    int = 1080,
) -> bool:
    stop_pipeline(camera_id)

    masked_name = get_masked_stream_name(camera_id)
    cmd = _build_cmd(rtsp_url, masked_name, zones, width, height)

    print(f"[pipeline] ▶ Starting for {camera_id}  zones={len(zones)}")
    print(f"[pipeline]   src : {rtsp_url}")
    print(f"[pipeline]   dst : rtmp://{OME_RTMP_HOST}:{OME_RTMP_PORT}/{OME_APP}/{masked_name}")
    logger.info(f"[pipeline] CMD: {shlex.join(cmd)}")

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            close_fds=True,
        )
        _processes[camera_id] = proc
        print(f"[pipeline] ✅ PID {proc.pid}")
        return True
    except FileNotFoundError:
        print("[pipeline] ❌ ffmpeg not found in container")
        return False
    except Exception as e:
        print(f"[pipeline] ❌ {e}")
        return False


def stop_pipeline(camera_id: str) -> bool:
    proc = _processes.pop(camera_id, None)
    if proc is None:
        return False
    try:
        proc.terminate()
        proc.wait(timeout=6)
    except subprocess.TimeoutExpired:
        proc.kill()
    except Exception:
        pass
    print(f"[pipeline] ⏹ Stopped for {camera_id}")
    return True


def pipeline_running(camera_id: str) -> bool:
    proc = _processes.get(camera_id)
    return proc is not None and proc.poll() is None


def get_stderr(camera_id: str, chars: int = 2000) -> str:
    proc = _processes.get(camera_id)
    if not proc or not proc.stderr:
        return ""
    try:
        import select
        ready, _, _ = select.select([proc.stderr], [], [], 0)
        if ready:
            return proc.stderr.read(chars).decode("utf-8", errors="replace")
    except Exception:
        pass
    return ""


def stop_all():
    for cid in list(_processes.keys()):
        stop_pipeline(cid)