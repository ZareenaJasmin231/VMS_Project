from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import MongoClient
from datetime import datetime
import asyncio
import json
import os
import re
import requests as http_requests
from ome_service import register_stream
from onvif_service import probe_camera, move_camera_ptz
import rtsp_recorder as recorder
import encrypt_service
from recording_api import recording_router
from stream_health import start_health_monitoring
import shutil
import urllib.parse


def normalize_stream_name(ip: str) -> str:
    """Always derive stream name from IP only — ensures one folder per camera."""
    return ip.strip().replace(".", "_")


app = FastAPI(title="MIRADOR ONVIF Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(recording_router)

_health_monitor_task = None

DEVICES_FILE      = os.environ.get("DEVICES_FILE", os.path.join(os.path.dirname(__file__), "..", "devices_data", "devices.json"))
OME_API           = os.environ.get("OME_URL", "http://ome:8081/v1/vhosts/default/apps/app/streams")
OME_AUTH          = "Basic bXl2bXNhY2Nlc3N0b2tlbg=="
MONGO_URI         = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")
OME_HOST_IP       = os.environ.get("OME_HOST_IP", "localhost")
OME_WS_PORT       = os.environ.get("OME_WS_PORT", "3333")

WATCHDOG_INTERVAL      = 5
WATCHDOG_MAX_RETRIES   = 20
WATCHDOG_BACKOFF_RESET = 10

# ------------------------------------------------------------------
# MongoDB
# ------------------------------------------------------------------
try:
    _mongo = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    _mongo.server_info()
    _db         = _mongo["mirador-vms"]
    cameras_col = _db["cameras"]
    print(f"[MONGO] ✅ Connected: {MONGO_URI}")
except Exception as e:
    print(f"[MONGO] ❌ FAILED to connect: {e}")
    _mongo      = None
    _db         = None
    cameras_col = None


# ------------------------------------------------------------------
# Central camera save function
# ------------------------------------------------------------------
def save_camera_to_db(data: dict):
    if cameras_col is None:
        print("[MONGO] ❌ No connection — skipping camera save")
        return False
    try:
        result = cameras_col.update_one(
            {"ip": data["ip"]},
            {"$set": data},
            upsert=True
        )
        print(f"[MONGO] ✅ Camera saved — matched:{result.matched_count} upserted:{result.upserted_id}")
        return True
    except Exception as e:
        print(f"[MONGO] ❌ Save FAILED: {e}")
        return False


# ------------------------------------------------------------------
# Devices file helpers
# ------------------------------------------------------------------
def load_devices():
    if cameras_col is not None:
        try:
            docs = list(cameras_col.find({}, {"_id": 0}))
            if docs:
                print(f"[STARTUP] Loaded {len(docs)} cameras from MongoDB")
                save_devices([{
                    "ome_stream":     d.get("ome_stream"),
                    "rtsp_url":       d.get("rtsp_url"),
                    "recording_rtsp": d.get("recording_rtsp", d.get("rtsp_url")),
                    "ip":             d.get("ip"),
                    "port":           d.get("port", 80),
                    "username":       d.get("username", ""),
                    "password":       d.get("password", ""),
                    "enabled":        d.get("enabled", True),
                } for d in docs if d.get("ome_stream") and d.get("rtsp_url")])
                return docs
        except Exception as e:
            print(f"[STARTUP] MongoDB load failed: {e} — falling back to devices.json")

    try:
        if os.path.exists(DEVICES_FILE):
            with open(DEVICES_FILE) as f:
                data = json.load(f)
                print(f"[STARTUP] Loaded {len(data)} cameras from devices.json")
                return data
    except Exception as e:
        print(f"[STARTUP] devices.json load failed: {e}")

    return []


def save_devices(devs):
    try:
        os.makedirs(os.path.dirname(DEVICES_FILE), exist_ok=True)
        with open(DEVICES_FILE, "w") as f:
            json.dump(devs, f)
    except Exception as e:
        print(f"[DEVICES] ⚠ Could not save devices.json: {e}")


def stream_exists_in_ome(stream_name: str) -> bool:
    try:
        r = http_requests.get(
            f"{OME_API}/{stream_name}",
            headers={"Authorization": OME_AUTH},
            timeout=3,
        )
        return r.status_code == 200
    except:
        return False


def get_devices_by_ip(ip: str) -> list:
    """Return every device entry whose ip matches."""
    return [d for d in devices if d.get("ip") == ip]


devices = load_devices()

_watchdog_failures: dict[str, int] = {}
_watchdog_cycle = 0


# ------------------------------------------------------------------
# OME readiness wait
# ------------------------------------------------------------------
async def _wait_for_ome(max_retries: int = 30, delay: int = 5):
    for attempt in range(1, max_retries + 1):
        try:
            r = http_requests.get(OME_API, headers={"Authorization": OME_AUTH}, timeout=3)
            if r.status_code in (200, 201, 404):
                print(f"[STARTUP] ✅ OME is ready (attempt {attempt})")
                return
        except Exception as e:
            print(f"[STARTUP] ⏳ Waiting for OME... attempt {attempt}/{max_retries}: {e}")
        await asyncio.sleep(delay)
    print("[STARTUP] ⚠ OME not ready after max retries — proceeding anyway")


# ------------------------------------------------------------------
# Stream watchdog — uses recording_rtsp for recorder, rtsp_url for OME
# ------------------------------------------------------------------
async def stream_watchdog():
    global _watchdog_cycle
    await asyncio.sleep(5)
    while True:
        _watchdog_cycle += 1
        for device in list(devices):
            stream_name  = device.get("ome_stream")
            rtsp_url     = device.get("rtsp_url")          # live / OME stream
            rec_rtsp     = device.get("recording_rtsp", rtsp_url)  # recording stream
            if not stream_name or not rtsp_url:
                continue

            if device.get("enabled") is False:
                if stream_name in recorder._recorders and recorder._recorders[stream_name].is_alive():
                    print(f"[WATCHDOG] ⏹ Stopping stray recorder for disabled camera: {stream_name}")
                    recorder.stop_camera(stream_name)
                continue

            fail_count = _watchdog_failures.get(stream_name, 0)
            if fail_count >= WATCHDOG_MAX_RETRIES:
                if _watchdog_cycle % WATCHDOG_BACKOFF_RESET == 0:
                    print(f"[WATCHDOG] 🔄 Resetting backoff for {stream_name}")
                    _watchdog_failures[stream_name] = 0
                else:
                    continue

            if not stream_exists_in_ome(stream_name):
                print(f"[WATCHDOG] ⚠️  Stream {stream_name} is down — re-registering...")
                try:
                    result      = register_stream(stream_name, rtsp_url)
                    status_code = result.get("statusCode", 0) if isinstance(result, dict) else 0
                    if status_code in (200, 201):
                        print(f"[WATCHDOG] ✅ Re-registered {stream_name}")
                        _watchdog_failures[stream_name] = 0
                        if stream_name not in recorder._recorders or \
                           not recorder._recorders[stream_name].is_alive():
                            # Restart recorder with the dedicated recording RTSP
                            recorder.start_camera(stream_name, rec_rtsp, device)
                            print(f"[WATCHDOG] 🎥 Restarted recorder for {stream_name}")
                    else:
                        _watchdog_failures[stream_name] = fail_count + 1
                        print(f"[WATCHDOG] ❌ Re-register failed for {stream_name}: {result}")
                        if _watchdog_failures[stream_name] >= WATCHDOG_MAX_RETRIES:
                            print(f"[WATCHDOG] 🚫 Giving up on {stream_name}")
                except Exception as e:
                    _watchdog_failures[stream_name] = fail_count + 1
                    print(f"[WATCHDOG] ❌ Exception for {stream_name}: {e}")
            else:
                if _watchdog_failures.get(stream_name, 0) > 0:
                    print(f"[WATCHDOG] ✅ {stream_name} recovered")
                _watchdog_failures[stream_name] = 0

        await asyncio.sleep(WATCHDOG_INTERVAL)


# ------------------------------------------------------------------
# Startup / Shutdown
# ------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    global _health_monitor_task
    print(f"[STARTUP] Starting with {len(devices)} saved devices")
    await _wait_for_ome()

    for device in devices:
        stream_name = device.get("ome_stream")
        rtsp_url    = device.get("rtsp_url")          # live RTSP → OME
        if device.get("enabled") is False:
            print(f"[STARTUP] ⏭ Skipping disabled camera: {stream_name}")
            continue
        if stream_name and rtsp_url:
            print(f"[STARTUP] Registering stream: {stream_name}")
            register_stream(stream_name, rtsp_url)

    asyncio.create_task(stream_watchdog())
    _health_monitor_task = asyncio.create_task(start_health_monitoring(devices, cameras_col))
    encrypt_service.start_watcher()

    # start_recording_all uses recording_rtsp if present, falls back to rtsp_url
    recorder.start_recording_all(devices)

    enabled_count = sum(1 for d in devices if d.get("enabled") is not False)
    print(f"[STARTUP] 🎥 Recording started for {enabled_count}/{len(devices)} enabled camera(s)")
    print(f"[STARTUP] ✓ Stream health monitoring started")


@app.on_event("shutdown")
async def shutdown():
    print("[SHUTDOWN] Stopping recorders and encryption watcher...")
    recorder.stop_all()
    encrypt_service.stop_watcher()


# ------------------------------------------------------------------
# Debug
# ------------------------------------------------------------------
@app.get("/api/debug/mongo")
def debug_mongo():
    try:
        _mongo.server_info()
        cam_count = cameras_col.count_documents({})
        rec_count = _db["recordings"].count_documents({})
        return {
            "status":       "connected",
            "uri":          MONGO_URI,
            "cameras":      cam_count,
            "recordings":   rec_count,
            "devices_json": len(devices),
        }
    except Exception as e:
        return {"status": "failed", "error": str(e), "uri": MONGO_URI}


# ------------------------------------------------------------------
# Models
# ------------------------------------------------------------------
class ProbeRequest(BaseModel):
    ip:       str
    port:     int = 80
    username: str = ""
    password: str = ""


class StreamRegisterRequest(BaseModel):
    rtsp_url:     str
    ip:           str = ""
    port:         int = 80
    username:     str = ""
    password:     str = ""
    manufacturer: str = "Unknown"
    model:        str = "Unknown"
    mac:          str = "—"
    device_name:  str = ""


class StreamAssignRequest(BaseModel):
    """Assign independent RTSP sources for live streaming and recording."""
    ip:                str
    port:              int = 80
    username:          str = ""
    manufacturer:      str = "Unknown"
    model:             str = "Unknown"
    mac:               str = "—"
    device_name:       str = ""
    live_rtsp:         str          # RTSP URL sent to OME (what viewers watch)
    recording_rtsp:    str          # RTSP URL used by the recorder thread
    live_profile:      str = ""     # human-readable profile name (for logging/DB)
    recording_profile: str = ""


class PTZMoveRequest(BaseModel):
    ip:       str
    port:     int   = 80
    username: str   = ""
    password: str   = ""
    pan:      float = 0.0
    tilt:     float = 0.0
    zoom:     float = 0.0


# ------------------------------------------------------------------
# Basic endpoints
# ------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/discover-devices")
async def discover_devices():
    try:
        from discovery_service import discover_all
        print("[DISCOVER] Starting network discovery...")
        found = await asyncio.to_thread(discover_all, 4, 150)
        print(f"[DISCOVER] Found {len(found)} device(s)")
        return {"devices": found}
    except Exception as e:
        print(f"[DISCOVER] ❌ Discovery error: {e}")
        return {"devices": [], "error": str(e)}


# ------------------------------------------------------------------
# Camera enable / disable / delete  (by IP)
# ------------------------------------------------------------------
@app.post("/api/cameras/by-ip/{ip}/enable")
async def enable_camera_by_ip(ip: str):
    global devices
    matched = get_devices_by_ip(ip)
    if not matched:
        raise HTTPException(status_code=404, detail=f"No camera found with IP {ip}")

    started = []
    for device in matched:
        stream_name = device.get("ome_stream")
        rtsp_url    = device.get("rtsp_url")
        rec_rtsp    = device.get("recording_rtsp", rtsp_url)
        if not stream_name or not rtsp_url:
            continue

        device["enabled"] = True
        try:
            register_stream(stream_name, rtsp_url)
        except Exception as e:
            print(f"[ENABLE] OME re-register failed for {stream_name}: {e}")

        recorder.start_camera(stream_name, rec_rtsp, device)
        started.append(stream_name)
        print(f"[ENABLE] ✅ {stream_name} enabled and recording started")

    save_devices(devices)
    if cameras_col is not None:
        cameras_col.update_one({"ip": ip}, {"$set": {"enabled": True}})

    return {"success": True, "ip": ip, "streams_started": started}


@app.post("/api/cameras/by-ip/{ip}/disable")
async def disable_camera_by_ip(ip: str):
    global devices
    matched = get_devices_by_ip(ip)
    if not matched:
        raise HTTPException(status_code=404, detail=f"No camera found with IP {ip}")

    stopped = []
    for device in matched:
        stream_name = device.get("ome_stream")
        if not stream_name:
            continue
        device["enabled"] = False
        recorder.stop_camera(stream_name)
        stopped.append(stream_name)
        print(f"[DISABLE] ⏹ {stream_name} disabled and recording stopped")

    save_devices(devices)
    if cameras_col is not None:
        cameras_col.update_one({"ip": ip}, {"$set": {"enabled": False}})

    return {"success": True, "ip": ip, "streams_stopped": stopped}


@app.delete("/api/cameras/by-ip/{ip}/delete")
async def delete_camera_by_ip(ip: str):
    global devices
    matched = get_devices_by_ip(ip)

    stopped = []
    for device in matched:
        stream_name = device.get("ome_stream")
        if not stream_name:
            continue
        recorder.stop_camera(stream_name)
        stopped.append(stream_name)
        print(f"[DELETE] ⏹ Stopped recorder for {stream_name}")
        try:
            r = http_requests.delete(
                f"{OME_API}/{stream_name}",
                headers={"Authorization": OME_AUTH},
                timeout=3,
            )
            print(f"[DELETE] OME unregister {stream_name}: HTTP {r.status_code}")
        except Exception as e:
            print(f"[DELETE] OME unregister failed for {stream_name} (non-fatal): {e}")
        _watchdog_failures.pop(stream_name, None)

    devices = [d for d in devices if d.get("ip") != ip]
    save_devices(devices)
    print(f"[DELETE] 🗑 Removed all streams for IP {ip} from devices list")

    if cameras_col is not None:
        result = cameras_col.delete_many({"ip": ip})
        print(f"[DELETE] 🗑 MongoDB: removed {result.deleted_count} document(s) for IP {ip}")

    return {"success": True, "ip": ip, "streams_stopped": stopped}


# ------------------------------------------------------------------
# ONVIF probe
# ------------------------------------------------------------------
@app.post("/api/onvif/probe")
async def onvif_probe(req: ProbeRequest):
    print(f"[ONVIF] Probing {req.ip}:{req.port} ...")
    result = await asyncio.to_thread(
        probe_camera, req.ip, req.port, req.username, req.password
    )

    if result["success"]:
        print(f"[ONVIF] ✅ {result['manufacturer']} {result['model']} "
              f"— {result.get('stream_count', '?')} stream(s)")
        rtsp = result["stream_uri"]
        rtsp = re.sub(r"[&?]proto=Onvif", "", rtsp)

        url_authority = rtsp.split("://", 1)[-1].split("/")[0]
        if req.username and "@" not in url_authority:
            safe_user = urllib.parse.quote(req.username, safe="")
            safe_pass = urllib.parse.quote(req.password, safe="")
            rtsp = rtsp.replace("rtsp://", f"rtsp://{safe_user}:{safe_pass}@")

        stream_name = normalize_stream_name(req.ip)
        existing    = next((d for d in devices if d.get("ome_stream") == stream_name), None)

        if not existing or not stream_exists_in_ome(stream_name):
            print(f"[ONVIF] Registering stream in OME: {stream_name}")
            ome_response = register_stream(stream_name, rtsp)
            print(f"[ONVIF] OME response: {ome_response}")

            if not existing:
                new_device = {
                    "ome_stream":     stream_name,
                    "rtsp_url":       rtsp,
                    "recording_rtsp": rtsp,   # defaults to same; user can change via /assign
                    "ip":             req.ip,
                    "port":           req.port,
                    "username":       req.username,
                    "password":       req.password,
                    "enabled":        True,
                }
                devices.append(new_device)
                save_devices(devices)
            else:
                existing["rtsp_url"]       = rtsp
                existing["recording_rtsp"] = existing.get("recording_rtsp", rtsp)
                existing["port"]           = req.port
                existing["username"]       = req.username
                existing["password"]       = req.password
                save_devices(devices)

            save_camera_to_db({
                "ip":              req.ip,
                "ome_stream":      stream_name,
                "rtsp_url":        rtsp,
                "recording_rtsp":  rtsp,
                "manufacturer":    result.get("manufacturer", ""),
                "model":           result.get("model", ""),
                "mac":             result.get("mac", ""),
                "port":            req.port,
                "username":        req.username,
                "password":        req.password,
                "added_at":        datetime.utcnow(),
                "status":          "streaming",
                "enabled":         True,
                "stream_count":    result.get("stream_count", 0),
                "stream_profiles": result.get("profiles", []),
            })

            recorder.start_camera(stream_name, rtsp, new_device if not existing else existing)
            print(f"[ONVIF] 🎥 Recording started for {stream_name}")

        else:
            print(f"[ONVIF] Stream {stream_name} already live in OME, skipping.")
            ome_response = {"message": "Already registered", "statusCode": 200}

        result["ome_stream"]   = stream_name
        result["ome_response"] = ome_response
        result["ws_url"]       = f"ws://{OME_HOST_IP}:{OME_WS_PORT}/app/{stream_name}"
        result["stream_key"]   = stream_name
        result["status"]       = "streaming"
        result["rtsp_url"]     = rtsp

    else:
        print(f"[ONVIF] ❌ {result['error']}")

    return result


# ------------------------------------------------------------------
# RTSP stream register
# ------------------------------------------------------------------
@app.post("/api/streams/register")
async def register_rtsp_stream(req: StreamRegisterRequest):
    rtsp = req.rtsp_url.strip()
    print(f"[RTSP] Registering stream: {rtsp}")

    if req.ip:
        host        = req.ip
        stream_name = normalize_stream_name(host)
    else:
        try:
            from urllib.parse import urlparse
            parsed      = urlparse(rtsp)
            host        = parsed.hostname or "unknown"
            stream_name = normalize_stream_name(host)
        except Exception:
            host        = "unknown"
            stream_name = re.sub(r"[^a-zA-Z0-9]", "_", rtsp)[:32]

    existing = next(
        (d for d in devices if d.get("ome_stream") == stream_name or d.get("ip") == host),
        None
    )

    if existing and stream_exists_in_ome(stream_name):
        print(f"[RTSP] Stream {stream_name} already live in OME, skipping.")
        existing["rtsp_url"] = rtsp
        save_devices(devices)
        return {
            "success":    True,
            "ome_stream": stream_name,
            "ws_url":     f"ws://{OME_HOST_IP}:{OME_WS_PORT}/app/{stream_name}",
            "stream_key": stream_name,
            "status":     "streaming",
            "rtsp_url":   rtsp,
        }

    try:
        ome_response = register_stream(stream_name, rtsp)
        print(f"[RTSP] OME response: {ome_response}")
    except Exception as e:
        print(f"[RTSP] ❌ OME registration failed: {e}")
        return {"success": False, "error": str(e)}

    status_code = ome_response.get("statusCode", 0) if isinstance(ome_response, dict) else 0
    if status_code not in (200, 201):
        return {
            "success": False,
            "error":   ome_response.get("message", "OME registration failed"),
            "ws_url":  None,
        }

    if not existing:
        new_device = {
            "ome_stream":     stream_name,
            "rtsp_url":       rtsp,
            "recording_rtsp": rtsp,   # defaults to same; changeable via /assign
            "ip":             host,
            "port":           req.port,
            "username":       req.username,
            "password":       req.password,
            "enabled":        True,
        }
        devices.append(new_device)
    else:
        existing["rtsp_url"]       = rtsp
        existing["recording_rtsp"] = existing.get("recording_rtsp", rtsp)
        existing["port"]           = req.port
        existing["username"]       = req.username
        existing["password"]       = req.password
        new_device = existing
    save_devices(devices)

    save_camera_to_db({
        "ip":           host,
        "ome_stream":   stream_name,
        "rtsp_url":     rtsp,
        "recording_rtsp": rtsp,
        "manufacturer": req.manufacturer,
        "model":        req.model,
        "mac":          req.mac,
        "device_name":  req.device_name or f"Camera @ {host}",
        "port":         req.port,
        "username":     req.username,
        "password":     req.password,
        "added_at":     datetime.utcnow(),
        "status":       "streaming",
        "enabled":      True,
        "source":       "rtsp",
    })

    _watchdog_failures[stream_name] = 0
    recorder.start_camera(stream_name, rtsp, new_device)
    print(f"[RTSP] 🎥 Recording started for {stream_name}")

    return {
        "success":    True,
        "ome_stream": stream_name,
        "ws_url":     f"ws://{OME_HOST_IP}:{OME_WS_PORT}/app/{stream_name}",
        "stream_key": stream_name,
        "status":     "streaming",
        "rtsp_url":   rtsp,
    }


# ------------------------------------------------------------------
# NEW: Assign independent Live + Recording streams
# ------------------------------------------------------------------
# ------------------------------------------------------------------
# PATCH: In main.py, replace the assign_streams endpoint with this.
# Key fix: treat HTTP 409 ("Stream already exists") from OME as success.
# OME returns 409 when the stream is already registered — that's fine,
# we still want to restart the recorder with the new recording_rtsp.
# ------------------------------------------------------------------


@app.post("/api/streams/assign")
async def assign_streams(req: StreamAssignRequest):
    """
    Assign independent RTSP sources for live streaming and recording.

    live_rtsp      → re-registered with OME  (what viewers watch in Live View)
    recording_rtsp → used by the recorder thread (what gets written to disk)

    Strategy for OME registration:
      1. Try to register fresh → 200/201 = done.
      2. If 409 (already exists): DELETE then re-register.
         If DELETE itself fails (502/network) → skip re-register, accept
         current OME stream as-is (recorder still restarts with new RTSP).
      3. Any other error → return failure.
    """
    host        = req.ip.strip()
    stream_name = normalize_stream_name(host)

    print(f"[ASSIGN] {host}: live={req.live_profile!r} ({req.live_rtsp})"
          f"  rec={req.recording_profile!r} ({req.recording_rtsp})")

    # ── Step 1: Try registering the live RTSP ────────────────────────────────
    ome_ok = False
    try:
        ome_response = register_stream(stream_name, req.live_rtsp)
        status_code  = ome_response.get("statusCode", 0) if isinstance(ome_response, dict) else 0

        if status_code in (200, 201):
            ome_ok = True
            print(f"[ASSIGN] ✅ OME registered {stream_name} (HTTP {status_code})")

        elif status_code == 409:
            # ── Step 2: Stream exists — try delete + re-register ─────────────
            print(f"[ASSIGN] 409 — stream exists, attempting delete+re-register for {stream_name}")
            delete_ok = False
            try:
                del_resp = http_requests.delete(
                    f"{OME_API}/{stream_name}",
                    headers={"Authorization": OME_AUTH},
                    timeout=5,
                )
                if del_resp.status_code in (200, 204):
                    delete_ok = True
                    print(f"[ASSIGN] ✅ OME deleted {stream_name} (HTTP {del_resp.status_code})")
                else:
                    print(f"[ASSIGN] ⚠ OME delete returned HTTP {del_resp.status_code} — skipping re-register")
            except Exception as del_err:
                print(f"[ASSIGN] ⚠ OME delete failed ({del_err}) — skipping re-register")

            if delete_ok:
                import time as _time
                _time.sleep(0.8)   # give OME time to tear down the old pull thread
                try:
                    ome_response2 = register_stream(stream_name, req.live_rtsp)
                    sc2           = ome_response2.get("statusCode", 0) if isinstance(ome_response2, dict) else 0
                    if sc2 in (200, 201):
                        ome_ok = True
                        print(f"[ASSIGN] ✅ OME re-registered {stream_name} (HTTP {sc2})")
                    else:
                        # Even if re-register returns unexpected code, recorder
                        # still restarts; watchdog will recover the stream
                        ome_ok = True
                        print(f"[ASSIGN] ⚠ Re-register returned HTTP {sc2} — watchdog will recover")
                except Exception as rereg_err:
                    ome_ok = True
                    print(f"[ASSIGN] ⚠ Re-register exception ({rereg_err}) — watchdog will recover")
            else:
                # DELETE failed (e.g. 502 — OME unreachable) but stream already
                # exists and is running. Recorder restarts below with new
                # recording RTSP regardless. Live stream stays on current profile
                # until the watchdog next checks; user can click Apply again to retry.
                ome_ok = True
                print(f"[ASSIGN] ℹ Keeping existing OME stream; recorder switching to new recording RTSP")

        else:
            err_msg = (
                ome_response.get("message", f"OME registration failed (HTTP {status_code})")
                if isinstance(ome_response, dict)
                else f"OME registration failed (HTTP {status_code})"
            )
            print(f"[ASSIGN] ❌ {err_msg}")
            return {"success": False, "error": err_msg}

    except Exception as e:
        print(f"[ASSIGN] ❌ OME error: {e}")
        return {"success": False, "error": str(e)}

    if not ome_ok:
        return {"success": False, "error": "OME registration failed unexpectedly"}

    # ── Step 3: Update in-memory device record ───────────────────────────────
    existing = next(
        (d for d in devices if d.get("ome_stream") == stream_name or d.get("ip") == host),
        None
    )
    if existing:
        existing["rtsp_url"]            = req.live_rtsp
        existing["recording_rtsp"]      = req.recording_rtsp
        existing["active_live_profile"] = req.live_profile
        existing["active_rec_profile"]  = req.recording_profile
        device_entry = existing
    else:
        device_entry = {
            "ome_stream":           stream_name,
            "rtsp_url":             req.live_rtsp,
            "recording_rtsp":       req.recording_rtsp,
            "ip":                   host,
            "port":                 req.port,
            "username":             req.username,
            "enabled":              True,
            "active_live_profile":  req.live_profile,
            "active_rec_profile":   req.recording_profile,
        }
        devices.append(device_entry)

    save_devices(devices)

    # ── Step 4: Persist both URLs to MongoDB ─────────────────────────────────
    save_camera_to_db({
        "ip":                   host,
        "ome_stream":           stream_name,
        "rtsp_url":             req.live_rtsp,
        "recording_rtsp":       req.recording_rtsp,
        "manufacturer":         req.manufacturer,
        "model":                req.model,
        "mac":                  req.mac,
        "device_name":          req.device_name or f"Camera @ {host}",
        "port":                 req.port,
        "username":             req.username,
        "active_live_profile":  req.live_profile,
        "active_rec_profile":   req.recording_profile,
        "updated_at":           datetime.utcnow(),
    })

    # ── Step 5: Restart recorder with the dedicated recording RTSP ───────────
    recorder.stop_camera(stream_name)
    recorder.start_camera(stream_name, req.recording_rtsp, device_entry)
    print(f"[ASSIGN] 🎥 Recorder restarted → recording profile: {req.recording_profile!r}")

    # ── Step 6: Reset watchdog so it picks up the new live RTSP on next cycle ─
    _watchdog_failures[stream_name] = 0

    return {
        "success":           True,
        "ome_stream":        stream_name,
        "ws_url":            f"ws://{OME_HOST_IP}:{OME_WS_PORT}/app/{stream_name}",
        "stream_key":        stream_name,
        "live_rtsp":         req.live_rtsp,
        "recording_rtsp":    req.recording_rtsp,
        "live_profile":      req.live_profile,
        "recording_profile": req.recording_profile,
    }


# ------------------------------------------------------------------
# Camera lookup by IP (used by frontend StreamProfilesPage)
# ------------------------------------------------------------------
@app.get("/api/cameras/by-ip/{ip}")
async def get_camera_by_ip(ip: str):
    if cameras_col is not None:
        doc = cameras_col.find_one({"ip": ip}, {"_id": 0})
        if doc:
            return doc
    # Fallback to in-memory
    dev = next((d for d in devices if d.get("ip") == ip), None)
    if dev:
        return dev
    raise HTTPException(status_code=404, detail=f"Camera {ip} not found")


@app.post("/api/devices/")
async def add_device(device: dict):
    print("DEVICE REGISTERED:", device)
    existing = next(
        (d for d in devices if d.get("ip_address") == device.get("ip_address")), None
    )
    if existing:
        devices.remove(existing)
    devices.append(device)
    save_devices(devices)
    return {"success": True, "device": device}


@app.get("/api/devices")
async def get_devices():
    devs = await _db.devices.find({}).to_list(None)
    result = []
    for d in devs:
        d["id"]  = str(d["_id"])
        d["_id"] = str(d["_id"])
        result.append(d)
    return result


@app.get("/api/cameras/")
async def get_cameras_from_db():
    if cameras_col is None:
        return []
    docs = list(cameras_col.find({}, {"_id": 0}))
    return docs


@app.get("/api/storage/management")
def storage_management():
    recordings_dir = os.environ.get("RECORDINGS_DIR", "/recordings")
    try:
        total, used, free = shutil.disk_usage(recordings_dir)
        status = "Recording"
    except Exception:
        total, used, free = 0, 0, 0
        status = "Unavailable"

    return [{
        "location":  "C:\\Recording",
        "type":      "Local Disk",
        "total":     round(total / (1024**3), 1),
        "used":      round(used  / (1024**3), 1),
        "free":      round(free  / (1024**3), 1),
        "status":    status,
        "server":    "MIRADOR",
        "allocated": 459,
    }]


@app.get("/api/storage/selection")
def storage_selection():
    if cameras_col is None:
        return []
    docs   = list(cameras_col.find({}, {"_id": 0}))
    result = []
    for cam in docs:
        stream         = cam.get("ome_stream", "")
        recordings_dir = os.environ.get("RECORDINGS_DIR", "/recordings")
        cam_dir        = os.path.join(recordings_dir, stream)

        used_bytes = 0
        oldest     = None
        if os.path.exists(cam_dir):
            for root, dirs, files in os.walk(cam_dir):
                for f in files:
                    fp = os.path.join(root, f)
                    try:
                        used_bytes += os.path.getsize(fp)
                        mtime = os.path.getmtime(fp)
                        if oldest is None or mtime < oldest:
                            oldest = mtime
                    except:
                        pass

        used_gb    = round(used_bytes / (1024**3), 2)
        oldest_str = datetime.fromtimestamp(oldest).strftime("%d-%m-%Y %H:%M:%S") if oldest else "N/A"

        result.append({
            "device":           f"{cam.get('manufacturer', '')} {cam.get('model', '')}".strip() or cam.get("ip"),
            "ip":               cam.get("ip"),
            "used_storage":     f"{used_gb} GB",
            "location":         "C:\\Recording",
            "retention":        cam.get("retention_days", 70),
            "oldest_recording": oldest_str,
            "failover":         cam.get("failover", False),
        })
    return result


@app.post("/api/storage/selection")
def update_storage_selection(payload: dict):
    if cameras_col is None:
        return {"error": "MongoDB not connected"}
    ip = payload.get("ip")
    if not ip:
        return {"error": "ip required"}
    cameras_col.update_one(
        {"ip": ip},
        {"$set": {
            "retention_days": payload.get("retention_days", 70),
            "failover":       payload.get("failover", False),
            "store_to":       payload.get("store_to", "C:\\Recording"),
        }}
    )
    return {"success": True}


@app.post("/api/onvif/ptz/move")
async def ptz_move(req: PTZMoveRequest):
    print(f"[PTZ] Moving {req.ip} to P:{req.pan} T:{req.tilt} Z:{req.zoom}")
    result = await asyncio.to_thread(
        move_camera_ptz,
        req.ip, req.port, req.username, req.password,
        req.pan, req.tilt, req.zoom
    )
    return result