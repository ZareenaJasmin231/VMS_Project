"""
stream_health.py
────────────────
Monitors RTSP stream health for every camera in the database.
Probes each camera's RTSP stream every 10 seconds using ffprobe.

Exports:
  run_stream_health_loop()   → async loop, run by scheduler
  get_all_stream_health()    → returns current snapshot list for API/frontend
"""
import asyncio
import os
import json
from datetime import datetime
from pymongo import MongoClient

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
client    = MongoClient(MONGO_URI)
db        = client["mirador-vms"]
cams_col  = db["cameras"]

# In-memory store: { ip → stream_record }
_stream_cache: dict = {}

# Health thresholds
MIN_BITRATE_KBPS  = int(os.environ.get("STREAM_MIN_BITRATE_KBPS",  "128"))   # below this = degraded
DEAD_BITRATE_KBPS = int(os.environ.get("STREAM_DEAD_BITRATE_KBPS", "0"))     # 0 = no stream at all
PROBE_TIMEOUT_SEC = int(os.environ.get("STREAM_PROBE_TIMEOUT_SEC", "8"))


# ── RTSP probe via ffprobe ────────────────────────────────────────────────

async def probe_rtsp_stream(ip: str, rtsp_url: str = None) -> dict:
    """
    Uses ffprobe to read stream metadata (bitrate, codec, resolution, fps).
    Falls back to a TCP probe on port 554 if ffprobe is unavailable.
    Returns a stream_record dict.
    """
    url = rtsp_url or f"rtsp://{ip}:554/stream"

    base = {
        "ip":           ip,
        "url":          url,
        "bitrate_kbps": 0,
        "codec":        "unknown",
        "resolution":   "unknown",
        "fps":          0,
        "health":       "dead",
        "updated_at":   datetime.utcnow().isoformat(),
    }

    # ── Try ffprobe first ─────────────────────────────────────────────────
    try:
        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-rtsp_transport", "tcp",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            "-timeout", str(PROBE_TIMEOUT_SEC * 1_000_000),  # microseconds
            url,
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=PROBE_TIMEOUT_SEC + 2)

        if proc.returncode == 0:
            data     = json.loads(stdout.decode("utf-8", errors="ignore"))
            streams  = data.get("streams", [])
            fmt      = data.get("format", {})

            # Bitrate from format (bits/s → kbps)
            raw_br = fmt.get("bit_rate")
            bitrate_kbps = round(int(raw_br) / 1000) if raw_br else 0

            # Find video stream
            codec      = "unknown"
            resolution = "unknown"
            fps        = 0
            for s in streams:
                if s.get("codec_type") == "video":
                    codec = s.get("codec_name", "unknown")
                    w     = s.get("width",  0)
                    h     = s.get("height", 0)
                    if w and h:
                        resolution = f"{w}x{h}"
                    r_str = s.get("r_frame_rate", "0/1")
                    try:
                        num, den = r_str.split("/")
                        fps = round(int(num) / max(int(den), 1), 1)
                    except Exception:
                        fps = 0
                    break

            health = _classify_health(bitrate_kbps)

            return {**base,
                    "bitrate_kbps": bitrate_kbps,
                    "codec":        codec,
                    "resolution":   resolution,
                    "fps":          fps,
                    "health":       health}

    except (FileNotFoundError, asyncio.TimeoutError):
        pass  # ffprobe not installed or stream timed out
    except Exception as e:
        print(f"[STREAM] ffprobe error for {ip}: {e}")

    # ── Fallback: TCP probe port 554 ──────────────────────────────────────
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, 554), timeout=2.0
        )
        writer.close()
        await writer.wait_closed()
        # Port is open but we can't measure bitrate without ffprobe
        return {**base,
                "bitrate_kbps": -1,   # -1 = reachable but unknown bitrate
                "health":       "degraded"}
    except Exception:
        return base   # health = "dead"


def _classify_health(bitrate_kbps: int) -> str:
    if bitrate_kbps <= DEAD_BITRATE_KBPS:
        return "dead"
    if bitrate_kbps < MIN_BITRATE_KBPS:
        return "degraded"
    return "good"


# ── Main loop ─────────────────────────────────────────────────────────────

async def run_stream_health_loop():
    """
    Probes all camera RTSP streams every 10 seconds.
    Stores results in _stream_cache for get_all_stream_health().
    """
    print("[STREAM] Starting stream health monitor...")
    while True:
        try:
            cameras = list(cams_col.find(
                {}, {"_id": 0, "ip": 1, "name": 1, "model": 1, "rtsp_url": 1}
            ))

            tasks = [
                probe_rtsp_stream(
                    c["ip"],
                    c.get("rtsp_url")
                )
                for c in cameras if c.get("ip")
            ]

            results = await asyncio.gather(*tasks, return_exceptions=True)

            for cam, result in zip(cameras, results):
                if isinstance(result, dict):
                    result["name"]  = cam.get("name") or cam.get("model") or cam["ip"]
                    result["model"] = cam.get("model", "")
                    _stream_cache[cam["ip"]] = result
                    # Update camera doc with latest stream info
                    cams_col.update_one(
                        {"ip": cam["ip"]},
                        {"$set": {
                            "stream_health":   result["health"],
                            "stream_bitrate":  result["bitrate_kbps"],
                            "stream_checked":  datetime.utcnow(),
                        }}
                    )

        except Exception as e:
            print(f"[STREAM] Loop error: {e}")

        await asyncio.sleep(10)


# ── API accessor ──────────────────────────────────────────────────────────

def get_all_stream_health() -> list:
    """
    Returns the current stream health snapshot for all cameras.
    Each entry: { ip, name, model, bitrate_kbps, codec, resolution, fps, health, updated_at }
    """
    return list(_stream_cache.values())