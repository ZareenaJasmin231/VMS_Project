from fastapi import FastAPI
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
MONGO_URI         = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")   # ✅ mongo not localhost
OME_HOST_IP       = os.environ.get("OME_HOST_IP", "localhost")
OME_WS_PORT       = os.environ.get("OME_WS_PORT", "3333")

# ✅ Watchdog tuned — more patient, checks more often
WATCHDOG_INTERVAL      = 5    # was 10
WATCHDOG_MAX_RETRIES   = 20   # was 5
WATCHDOG_BACKOFF_RESET = 10   # was 60

# ------------------------------------------------------------------
# MongoDB — with immediate connection test
# ------------------------------------------------------------------
try:
    _mongo = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    _mongo.server_info()  # ✅ force connection test at startup
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
    """Save or update a camera in MongoDB. Returns True on success."""
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
    
    # Try background ONVIF probe to fill in missing metadata
    async def _background_probe():
        try:
            probe_result = await asyncio.to_thread(
                probe_camera, host, req.port, req.username, req.password
            )
            if probe_result.get("success"):
                save_camera_to_db({
                    "ip":             host,
                    "mac":            probe_result.get("mac", ""),
                    "manufacturer":   probe_result.get("manufacturer", req.manufacturer),
                    "model":          probe_result.get("model", req.model),
                    "firmware":       probe_result.get("firmware", ""),
                    "stream_count":   probe_result.get("stream_count", 0),
                    "stream_profiles": probe_result.get("profiles", []),
                    "ptz":            probe_result.get("ptz", "No"),
                    "serial":         probe_result.get("serial", ""),
                })
                print(f"[RTSP] ✅ Background ONVIF probe success for {host}")
            else:
                print(f"[RTSP] ℹ️ Background ONVIF probe failed for {host}: {probe_result.get('error')}")
        except Exception as e:
            print(f"[RTSP] ℹ️ Background probe exception for {host}: {e}")

    asyncio.create_task(_background_probe())


# ------------------------------------------------------------------
# Devices file helpers
# ------------------------------------------------------------------
def load_devices():
    """Load devices from MongoDB first, fallback to devices.json."""
    # ✅ Primary source — MongoDB
    if cameras_col is not None:
        try:
            docs = list(cameras_col.find({}, {"_id": 0}))
            if docs:
                print(f"[STARTUP] Loaded {len(docs)} cameras from MongoDB")
                # Keep devices.json in sync as backup
                save_devices([{
                    "ome_stream": d.get("ome_stream"),
                    "rtsp_url":   d.get("rtsp_url"),
                    "ip":         d.get("ip"),
                } for d in docs if d.get("ome_stream") and d.get("rtsp_url")])
                return docs
        except Exception as e:
            print(f"[STARTUP] MongoDB load failed: {e} — falling back to devices.json")

    # ✅ Fallback — devices.json
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


devices = load_devices()

_watchdog_failures: dict[str, int] = {}
_watchdog_cycle = 0


# ------------------------------------------------------------------
# OME readiness wait
# ------------------------------------------------------------------
async def _wait_for_ome(max_retries: int = 30, delay: int = 5):
    """Keep retrying until OME HTTP API responds."""
    for attempt in range(1, max_retries + 1):
        try:
            r = http_requests.get(
                OME_API,
                headers={"Authorization": OME_AUTH},
                timeout=3,
            )
            if r.status_code in (200, 201, 404):
                print(f"[STARTUP] ✅ OME is ready (attempt {attempt})")
                return
        except Exception as e:
            print(f"[STARTUP] ⏳ Waiting for OME... attempt {attempt}/{max_retries}: {e}")
        await asyncio.sleep(delay)
    print("[STARTUP] ⚠ OME not ready after max retries — proceeding anyway")


# ------------------------------------------------------------------
# Stream watchdog
# ------------------------------------------------------------------
async def stream_watchdog():
    global _watchdog_cycle
    await asyncio.sleep(5)
    while True:
        _watchdog_cycle += 1
        for device in list(devices):
            stream_name = device.get("ome_stream")
            rtsp_url    = device.get("rtsp_url")
            if not stream_name or not rtsp_url:
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

                        # ✅ Also restart recorder if it died
                        if stream_name not in recorder._recorders or \
                           not recorder._recorders[stream_name].is_alive():
                            recorder.start_camera(stream_name, rtsp_url)
                            print(f"[WATCHDOG] 🎥 Restarted recorder for {stream_name}")
                    else:
                        _watchdog_failures[stream_name] = fail_count + 1
                        print(f"[WATCHDOG] ❌ Re-register failed for {stream_name} "
                              f"(attempt {_watchdog_failures[stream_name]}/{WATCHDOG_MAX_RETRIES}): {result}")
                        if _watchdog_failures[stream_name] >= WATCHDOG_MAX_RETRIES:
                            print(f"[WATCHDOG] 🚫 Giving up on {stream_name} — "
                                  f"will retry in ~{WATCHDOG_BACKOFF_RESET * WATCHDOG_INTERVAL}s")
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

    # ✅ Wait for OME to be fully ready before registering streams
    await _wait_for_ome()

    for device in devices:
        stream_name = device.get("ome_stream")
        rtsp_url    = device.get("rtsp_url")
        if stream_name and rtsp_url:
            print(f"[STARTUP] Registering stream: {stream_name}")
            register_stream(stream_name, rtsp_url)

    asyncio.create_task(stream_watchdog())
    _health_monitor_task = asyncio.create_task(start_health_monitoring(devices, cameras_col))
    encrypt_service.start_watcher()
    recorder.start_recording_all(devices)
    print(f"[STARTUP] 🎥 Recording started for {len(devices)} camera(s)")
    print(f"[STARTUP] ✓ Stream health monitoring started")


@app.on_event("shutdown")
async def shutdown():
    print("[SHUTDOWN] Stopping recorders and encryption watcher...")
    recorder.stop_all()
    encrypt_service.stop_watcher()


# ------------------------------------------------------------------
# Debug endpoint
# ------------------------------------------------------------------
@app.get("/api/debug/mongo")
def debug_mongo():
    """Check MongoDB connection and counts."""
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


# ------------------------------------------------------------------
# Endpoints
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

        stream_name = req.ip.replace(".", "_")

        existing = next((d for d in devices if d.get("ome_stream") == stream_name), None)
        if not existing or not stream_exists_in_ome(stream_name):
            print(f"[ONVIF] Registering stream in OME: {stream_name}")
            ome_response = register_stream(stream_name, rtsp)
            print(f"[ONVIF] OME response: {ome_response}")

            if not existing:
                new_device = {"ome_stream": stream_name, "rtsp_url": rtsp, "ip": req.ip}
                devices.append(new_device)
                save_devices(devices)
            else:
                existing["rtsp_url"] = rtsp
                save_devices(devices)

            save_camera_to_db({
                "ip":           req.ip,
                "ome_stream":   stream_name,
                "rtsp_url":     rtsp,
                "manufacturer": result.get("manufacturer", ""),
                "model":        result.get("model", ""),
                "mac":          result.get("mac", ""),
                "port":         req.port,
                "username":     req.username,
                "added_at":     datetime.utcnow(),
                "status":       "streaming",
                # ✅ Store stream profile data
                "stream_count":   result.get("stream_count", 0),
                "stream_profiles": result.get("profiles", []),
            })

            recorder.start_camera(stream_name, rtsp)
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
        # ✅ profiles and stream_count are already in result from probe_camera

    else:
        print(f"[ONVIF] ❌ {result['error']}")

    return result

@app.post("/api/streams/register")
async def register_rtsp_stream(req: StreamRegisterRequest):
    rtsp = req.rtsp_url.strip()
    print(f"[RTSP] Registering stream: {rtsp}")

    if req.ip:
        host = req.ip
        try:
            from urllib.parse import urlparse
            parsed      = urlparse(rtsp)
            path_slug   = parsed.path.strip("/").replace("/", "_") if parsed.path.strip("/") else ""
            stream_name = host.replace(".", "_") + (f"_{path_slug}" if path_slug else "")
        except Exception:
            stream_name = host.replace(".", "_")
    else:
        try:
            from urllib.parse import urlparse
            parsed      = urlparse(rtsp)
            host        = parsed.hostname or "unknown"
            path_slug   = parsed.path.strip("/").replace("/", "_") if parsed.path.strip("/") else ""
            stream_name = host.replace(".", "_") + (f"_{path_slug}" if path_slug else "")
        except Exception:
            stream_name = re.sub(r"[^a-zA-Z0-9]", "_", rtsp)[:32]
            host        = "unknown"

    existing = next((d for d in devices if d.get("ome_stream") == stream_name), None)
    if existing and stream_exists_in_ome(stream_name):
        print(f"[RTSP] Stream {stream_name} already live in OME, skipping.")
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
        new_device = {"ome_stream": stream_name, "rtsp_url": rtsp, "ip": host}
        devices.append(new_device)
    else:
        existing["rtsp_url"] = rtsp
    save_devices(devices)

    # ✅ Use central save function
    save_camera_to_db({
        "ip":           host,
        "ome_stream":   stream_name,
        "rtsp_url":     rtsp,
        "manufacturer": req.manufacturer,
        "model":        req.model,
        "mac":          req.mac,
        "device_name":  req.device_name or f"Camera @ {host}",
        "port":         req.port,
        "username":     req.username,
        "added_at":     datetime.utcnow(),
        "status":       "streaming",
        "source":       "discovery",
    })

    _watchdog_failures[stream_name] = 0
    recorder.start_camera(stream_name, rtsp)
    print(f"[RTSP] 🎥 Recording started for {stream_name}")

    return {
        "success":    True,
        "ome_stream": stream_name,
        "ws_url":     f"ws://{OME_HOST_IP}:{OME_WS_PORT}/app/{stream_name}",
        "stream_key": stream_name,
        "status":     "streaming",
        "rtsp_url":   rtsp,
    }


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


# In your FastAPI route
@app.get("/api/devices")
async def get_devices():
    devices = await db.devices.find({}).to_list(None)
    result = []
    for d in devices:
        d["id"] = str(d["_id"])  # ← normalize _id to string "id"
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


class PTZMoveRequest(BaseModel):
    ip:       str
    port:     int   = 80
    username: str   = ""
    password: str   = ""
    pan:      float = 0.0
    tilt:     float = 0.0
    zoom:     float = 0.0


@app.post("/api/onvif/ptz/move")
async def ptz_move(req: PTZMoveRequest):
    print(f"[PTZ] Moving {req.ip} to P:{req.pan} T:{req.tilt} Z:{req.zoom}")
    result = await asyncio.to_thread(
        move_camera_ptz,
        req.ip, req.port, req.username, req.password,
        req.pan, req.tilt, req.zoom
    )
    return result