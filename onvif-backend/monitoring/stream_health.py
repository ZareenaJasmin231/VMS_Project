"""
stream_health.py
────────────────
Polls every camera node for live stream stats (bitrate, FPS, resolution,
codec, dropped frames, RTSP/ONVIF/recording status) and writes them back
to infrastructure_nodes so the frontend sidebar shows real data.

Add to your scheduler:
    from .stream_health import run_stream_health_loop
    asyncio.ensure_future(run_stream_health_loop())
"""

import asyncio
import socket
import time
import os
import re
from datetime import datetime, timezone

from pymongo import MongoClient
from .websocket_manager import manager

MONGO_URI  = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
_client    = MongoClient(MONGO_URI)
_db        = _client["mirador-vms"]
nodes_col  = _db["infrastructure_nodes"]

# ─── How often to poll each camera (seconds) ─────────────────────────────────
POLL_INTERVAL = 15

# ─── Camera credentials (override via env or extend per-camera from DB) ───────
DEFAULT_USER = os.environ.get("CAM_USER", "admin")
DEFAULT_PASS = os.environ.get("CAM_PASS", "")


# ─────────────────────────────────────────────────────────────────────────────
#  LOW-LEVEL HELPERS
# ─────────────────────────────────────────────────────────────────────────────

async def _tcp_open(ip: str, port: int, timeout: float = 1.5) -> bool:
    """Async TCP port check."""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=timeout
        )
        writer.close()
        await writer.wait_closed()
        return True
    except Exception:
        return False


async def _probe_rtsp(ip: str, port: int = 554, timeout: float = 3.0):
    """
    Send a minimal RTSP OPTIONS request and parse the response.
    Returns dict with keys: connected, bitrate_mbps, fps, resolution,
    codec, status, dropped_frames.
    All numeric fields are None if unavailable.
    """
    result = {
        "connected": False,
        "bitrate_mbps": None,
        "fps": None,
        "resolution": None,
        "codec": None,
        "status": None,
        "dropped_frames": None,
    }

    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=timeout
        )
    except Exception:
        result["status"] = "dead"
        return result

    try:
        # Send RTSP OPTIONS — works even without auth
        request = (
            f"OPTIONS rtsp://{ip}:{port}/ RTSP/1.0\r\n"
            f"CSeq: 1\r\n"
            f"User-Agent: MiradorVMS/1.0\r\n\r\n"
        )
        writer.write(request.encode())
        await writer.drain()

        raw = await asyncio.wait_for(reader.read(2048), timeout=timeout)
        response = raw.decode("utf-8", errors="ignore")

        if "RTSP/1.0 200" in response or "RTSP/1.1 200" in response:
            result["connected"] = True
            result["status"]    = "healthy"
        elif "401" in response:
            # Auth required but port/service alive — still "connected"
            result["connected"] = True
            result["status"]    = "auth_required"
        else:
            result["status"] = "degraded"

        # Try to extract codec from Public: header (Dahua/Hikvision include it)
        pub_match = re.search(r"Public:([^\r\n]+)", response, re.IGNORECASE)
        if pub_match:
            pub = pub_match.group(1)
            for codec in ("H.265", "H.264", "HEVC", "H265", "H264", "MJPEG"):
                if codec.upper() in pub.upper():
                    result["codec"] = codec.replace("HEVC", "H.265").replace("H265", "H.265").replace("H264", "H.264")
                    break

    except Exception:
        result["status"] = result["status"] or "degraded"
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass

    return result


async def _probe_onvif_stream(ip: str, port: int = 80,
                               user: str = DEFAULT_USER,
                               password: str = DEFAULT_PASS):
    """
    Try ONVIF GetStreamUri + GetVideoEncoderConfigurations to get
    resolution, fps, codec, bitrate.
    Returns a dict of stream fields, all None if ONVIF unavailable.
    """
    fields = {
        "fps": None, "resolution": None,
        "codec": None, "bitrate_mbps": None,
    }

    # Check port reachable first (fast path — avoids long zeep timeout)
    if not await _tcp_open(ip, port, timeout=1.5):
        return fields

    try:
        # onvif-zeep is optional — if not installed, skip silently
        from onvif import ONVIFCamera  # type: ignore
        import zeep                    # type: ignore

        def _blocking_onvif():
            cam = ONVIFCamera(ip, port, user, password, no_cache=True)
            media = cam.create_media_service()

            profiles = media.GetProfiles()
            if not profiles:
                return {}

            # Use the first profile
            profile = profiles[0]
            token   = profile.token

            # Video encoder config
            enc = None
            try:
                configs = media.GetVideoEncoderConfigurations()
                enc = configs[0] if configs else None
            except Exception:
                pass

            out = {}
            if enc:
                enc_type = getattr(enc, "Encoding", None)
                if enc_type:
                    out["codec"] = str(enc_type)

                res = getattr(enc, "Resolution", None)
                if res:
                    w = getattr(res, "Width",  None)
                    h = getattr(res, "Height", None)
                    if w and h:
                        out["resolution"] = f"{w}x{h}"

                rate = getattr(enc, "RateControl", None)
                if rate:
                    fps = getattr(rate, "FrameRateLimit", None)
                    bps = getattr(rate, "BitrateLimit",   None)  # kbps
                    if fps: out["fps"]          = float(fps)
                    if bps: out["bitrate_mbps"] = round(float(bps) / 1024, 2)

            return out

        # Run blocking zeep calls in thread pool to avoid blocking event loop
        loop   = asyncio.get_event_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(None, _blocking_onvif),
            timeout=8.0
        )
        fields.update(result)

    except ImportError:
        pass  # onvif-zeep not installed — skip
    except Exception as e:
        pass  # auth fail, timeout, etc. — not fatal

    return fields


async def _probe_hikvision_stream(ip: str,
                                   user: str = DEFAULT_USER,
                                   password: str = DEFAULT_PASS):
    """
    Dahua/Hikvision HTTP API fallback for stream stats.
    GET /ISAPI/Streaming/channels/101/capabilities  (Hikvision)
    GET /cgi-bin/magicBox.cgi?action=getSystemInfo  (Dahua)
    Returns partial stream dict or empty dict.
    """
    import aiohttp  # type: ignore
    fields = {}
    auth   = aiohttp.BasicAuth(user, password)

    endpoints = [
        # Hikvision ISAPI
        (f"http://{ip}/ISAPI/Streaming/channels/101/capabilities", "hik"),
        # Dahua
        (f"http://{ip}/cgi-bin/magicBox.cgi?action=getSystemInfo", "dahua"),
    ]

    try:
        async with aiohttp.ClientSession(auth=auth) as session:
            for url, brand in endpoints:
                try:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=3)) as resp:
                        if resp.status == 200:
                            text = await resp.text()
                            if brand == "hik":
                                # Extract codec from XML
                                m = re.search(r"<videoCodecType>([^<]+)</videoCodecType>", text)
                                if m: fields["codec"] = m.group(1).strip()
                                m = re.search(r"<maxFrameRate>(\d+)</maxFrameRate>", text)
                                if m: fields["fps"] = float(m.group(1)) / 100  # Hik uses 100x
                                m = re.search(r"<maxBitrate>(\d+)</maxBitrate>", text)
                                if m: fields["bitrate_mbps"] = round(int(m.group(1)) / 1024, 2)
                                m = re.search(r"<videoResolutionWidth>(\d+).*?<videoResolutionHeight>(\d+)", text, re.DOTALL)
                                if m: fields["resolution"] = f"{m.group(1)}x{m.group(2)}"
                            break
                except Exception:
                    continue
    except ImportError:
        pass  # aiohttp not installed
    except Exception:
        pass

    return fields


# ─────────────────────────────────────────────────────────────────────────────
#  PER-CAMERA PROBE
# ─────────────────────────────────────────────────────────────────────────────

async def probe_camera_stream(node: dict) -> dict:
    """
    Full stream probe for one camera node.
    Returns a dict of fields ready to $set into infrastructure_nodes.
    """
    ip       = node.get("ip", "")
    user     = node.get("username") or node.get("user") or DEFAULT_USER
    password = node.get("password") or node.get("pass") or DEFAULT_PASS

    # 1. TCP port checks (fast)
    rtsp_open, onvif_open, http_open = await asyncio.gather(
        _tcp_open(ip, 554),
        _tcp_open(ip, 8080, timeout=1.0),
        _tcp_open(ip, 80,   timeout=1.0),
    )

    # 2. RTSP probe (gives status + codec hint)
    rtsp_data = await _probe_rtsp(ip, 554) if rtsp_open else {
        "connected": False, "status": "dead",
        "bitrate_mbps": None, "fps": None,
        "resolution": None, "codec": None, "dropped_frames": None,
    }

    # 3. ONVIF probe (gives resolution/fps/bitrate/codec more reliably)
    onvif_port = 8080 if onvif_open else (80 if http_open else None)
    onvif_data = {}
    if onvif_port:
        onvif_data = await _probe_onvif_stream(ip, onvif_port, user, password)

    # 4. HTTP API fallback (Hikvision/Dahua)
    http_data = {}
    if http_open and not onvif_data.get("codec"):
        http_data = await _probe_hikvision_stream(ip, user, password)

    # ── Merge: ONVIF > HTTP API > RTSP (in that priority order) ────────────
    merged_codec      = onvif_data.get("codec")      or http_data.get("codec")      or rtsp_data.get("codec")
    merged_fps        = onvif_data.get("fps")        or http_data.get("fps")
    merged_resolution = onvif_data.get("resolution") or http_data.get("resolution")
    merged_bitrate    = onvif_data.get("bitrate_mbps") or http_data.get("bitrate_mbps") or rtsp_data.get("bitrate_mbps")

    # Determine stream_status
    if rtsp_data["connected"]:
        stream_status = "healthy"
    elif rtsp_open:
        stream_status = "degraded"
    else:
        stream_status = "dead"

    # "recording" = RTSP open AND stream healthy/auth_required
    recording = rtsp_data["connected"] or (rtsp_open and onvif_data.get("fps") is not None)

    return {
        # Stream health fields the frontend CameraStreamPanel reads
        "stream_bitrate_mbps": merged_bitrate,
        "stream_fps":          merged_fps,
        "stream_resolution":   merged_resolution,
        "stream_status":       stream_status,
        "codec":               merged_codec,
        "dropped_frames":      rtsp_data.get("dropped_frames", 0) or 0,

        # Connection flags the frontend flag pills read
        "rtsp_connected":  rtsp_data["connected"],
        "onvif_connected": onvif_open,
        "recording":       recording,

        # Metadata
        "stream_last_polled": datetime.now(timezone.utc).isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
#  BACKGROUND LOOP
# ─────────────────────────────────────────────────────────────────────────────

async def run_stream_health_loop():
    """
    Runs forever. Every POLL_INTERVAL seconds, probes all camera nodes
    and writes results back to MongoDB + broadcasts NODE_UPDATE so the
    frontend sidebar refreshes automatically without a page reload.
    """
    print(f"[STREAM_HEALTH] Starting stream poller (interval={POLL_INTERVAL}s)…")

    # ── Wait until seed_topology_from_cameras() has populated camera nodes ──
    # The seeder runs in a background thread and may take 10-30 s.
    # We poll every 5 s up to 60 s, then fall through and keep retrying normally.
    print("[STREAM_HEALTH] Waiting for camera nodes to be seeded into infrastructure_nodes…")
    for _wait in range(12):  # up to 60 s
        cam_count = nodes_col.count_documents({"type": "camera"})
        if cam_count > 0:
            print(f"[STREAM_HEALTH] Found {cam_count} camera node(s) — starting poll loop.")
            break
        await asyncio.sleep(5)
    else:
        print("[STREAM_HEALTH] ⚠ No camera nodes found after 60 s — will keep retrying in the poll loop.")

    while True:
        try:
            cameras = list(nodes_col.find(
                {"type": "camera"},
                {"_id": 0, "id": 1, "ip": 1, "username": 1, "password": 1,
                 "user": 1, "pass": 1}
            ))

            if not cameras:
                print("[STREAM_HEALTH] No camera nodes found in infrastructure_nodes — retrying in next cycle.")
            else:
                # Probe all cameras concurrently (capped to avoid flooding)
                semaphore = asyncio.Semaphore(10)

                async def probe_one(node):
                    async with semaphore:
                        try:
                            fields = await probe_camera_stream(node)
                            node_id = node["id"]

                            # Write to MongoDB
                            nodes_col.update_one(
                                {"id": node_id},
                                {"$set": fields}
                            )

                            # Broadcast to all open WebSocket clients so the
                            # sidebar refreshes live without a manual refresh
                            await manager.broadcast({
                                "type": "NODE_UPDATE",
                                "id":   node_id,
                                "data": fields,
                            })

                            print(
                                f"[STREAM_HEALTH] {node.get('ip')} → "
                                f"status={fields['stream_status']} "
                                f"fps={fields['stream_fps']} "
                                f"res={fields['stream_resolution']} "
                                f"codec={fields['codec']} "
                                f"bitrate={fields['stream_bitrate_mbps']}"
                            )
                        except Exception as e:
                            print(f"[STREAM_HEALTH] Error probing {node.get('ip')}: {e}")

                await asyncio.gather(*[probe_one(c) for c in cameras])

        except Exception as e:
            print(f"[STREAM_HEALTH] Loop error: {e}")

        await asyncio.sleep(POLL_INTERVAL)