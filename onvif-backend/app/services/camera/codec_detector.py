import subprocess
import asyncio
import os
from typing import Optional

from app.utils.ffmpeg_utils import FFMPEG_BIN, FFPROBE_BIN

if not os.path.exists(FFPROBE_BIN):
    print(f"[CODEC_DETECTOR] WARN: ffprobe not found at expected path: {FFPROBE_BIN}")

_codec_cache: dict[str, str] = {}

def get_cached_codec(stream_name: str) -> Optional[str]:
    return _codec_cache.get(stream_name)

def detect_codec(rtsp_url: str, stream_name: str = None) -> str:
    """
    Detects the video codec of an RTSP stream using ffprobe synchronously.
    Returns "h264", "hevc", "mjpeg", or "unknown".
    """
    safe_url = rtsp_url.replace("&transport=tcp", "")
    try:
        probe_cmd = [
            FFPROBE_BIN, "-v", "warning", "-select_streams", "v:0",
            "-show_entries", "stream=codec_name", "-of",
            "default=noprint_wrappers=1:nokey=1", safe_url
        ]
        probe_out = subprocess.check_output(probe_cmd, timeout=15, stderr=subprocess.DEVNULL)
        codec = probe_out.decode('utf-8').strip().lower()
        if codec == "h265":
            codec = "hevc"
            
        if stream_name:
            _codec_cache[stream_name] = codec
            
        return codec
    except Exception as e:
        print(f"[CODEC_DETECTOR] WARN: Could not probe codec for {safe_url}: {e}")
        return "unknown"

async def detect_codec_async(rtsp_url: str, stream_name: str = None) -> str:
    """
    Detects the video codec of an RTSP stream using ffprobe asynchronously.
    Returns "h264", "hevc", "mjpeg", or "unknown".
    """
    safe_url = rtsp_url.replace("&transport=tcp", "")
    try:
        probe_cmd = [
            FFPROBE_BIN, "-v", "warning", "-select_streams", "v:0",
            "-show_entries", "stream=codec_name", "-of",
            "default=noprint_wrappers=1:nokey=1", safe_url
        ]
        proc = await asyncio.create_subprocess_exec(
            *probe_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL
        )
        # 15s instead of 5s — WAN/cloud-relayed cameras (e.g. this "Hydra"
        # hosted stream) can take noticeably longer to respond than LAN cameras.
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15.0)
        
        if proc.returncode == 0:
            codec = stdout.decode('utf-8').strip().lower()
            if codec == "h265":
                codec = "hevc"
                
            if stream_name:
                _codec_cache[stream_name] = codec
                
            return codec
        else:
            return "unknown"
    except Exception as e:
        print(f"[CODEC_DETECTOR] WARN: Could not probe codec (async) for {safe_url}: {e}")
        return "unknown"