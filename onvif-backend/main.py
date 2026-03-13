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
from onvif_service import probe_camera
import rtsp_recorder as recorder
import encrypt_service
from recording_api import recording_router

app = FastAPI(title="MIRADORAI ONVIF Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(recording_router)

DEVICES_FILE      = "/app/data/devices.json"
OME_API           = "http://ome:8081"
OME_AUTH          = "Basic bXl2bXNhY2Nlc3N0b2tlbg=="
WATCHDOG_INTERVAL = 10
MONGO_URI         = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")

# ------------------------------------------------------------------
# MongoDB — single DB "mirador-vms", collection "cameras"
# ------------------------------------------------------------------
_mongo      = MongoClient(MONGO_URI)
_db         = _mongo["mirador-vms"]
cameras_col = _db["cameras"]


# ------------------------------------------------------------------
# devices.json helpers (unchanged)
# ------------------------------------------------------------------
def load_devices():
    try:
        if os.path.exists(DEVICES_FILE):
            with open(DEVICES_FILE) as f:
                return json.load(f)
    except:
        pass
    return []


def save_devices(devs):
    os.makedirs(os.path.dirname(DEVICES_FILE), exist_ok=True)
    with open(DEVICES_FILE, "w") as f:
        json.dump(devs, f)


def stream_exists_in_ome(stream_name: str) -> bool:
    try:
        r = http_requests.get(
            f"{OME_API}/v1/vhosts/default/apps/app/streams/{stream_name}",
            headers={"Authorization": OME_AUTH},
            timeout=3,
        )
        return r.status_code == 200
    except:
        return False


devices = load_devices()


# ------------------------------------------------------------------
# OME stream watchdog
# ------------------------------------------------------------------
async def stream_watchdog():
    await asyncio.sleep(5)
    while True:
        for device in list(devices):
            stream_name = device.get("ome_stream")
            rtsp_url    = device.get("rtsp_url")
            if not stream_name or not rtsp_url:
                continue
            if not stream_exists_in_ome(stream_name):
                print(f"[WATCHDOG] ⚠️  Stream {stream_name} is down — re-registering...")
                try:
                    result = register_stream(stream_name, rtsp_url)
                    print(f"[WATCHDOG] ✅ Re-registered {stream_name}: {result}")
                except Exception as e:
                    print(f"[WATCHDOG] ❌ Failed: {e}")
            else:
                print(f"[WATCHDOG] ✓ {stream_name} is live")
        await asyncio.sleep(WATCHDOG_INTERVAL)


# ------------------------------------------------------------------
# Startup / shutdown
# ------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    print(f"[STARTUP] Starting with {len(devices)} saved devices")

    for device in devices:
        stream_name = device.get("ome_stream")
        rtsp_url    = device.get("rtsp_url")
        if stream_name and rtsp_url:
            print(f"[STARTUP] Registering stream: {stream_name}")
            register_stream(stream_name, rtsp_url)

    asyncio.create_task(stream_watchdog())
    encrypt_service.start_watcher()
    recorder.start_recording_all(devices)
    print(f"[STARTUP] 🎥 Recording started for {len(devices)} camera(s)")


@app.on_event("shutdown")
async def shutdown():
    print("[SHUTDOWN] Stopping recorders and encryption watcher...")
    recorder.stop_all()
    encrypt_service.stop_watcher()


# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------
class ProbeRequest(BaseModel):
    ip: str
    port: int = 80
    username: str = ""
    password: str = ""


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/onvif/probe")
async def onvif_probe(req: ProbeRequest):
    print(f"[ONVIF] Probing {req.ip}:{req.port} ...")
    result = await asyncio.to_thread(
        probe_camera, req.ip, req.port, req.username, req.password
    )

    if result["success"]:
        print(f"[ONVIF] ✅ {result['manufacturer']} {result['model']}")
        rtsp = result["stream_uri"]
        if req.username:
            rtsp = rtsp.replace("rtsp://", f"rtsp://{req.username}:{req.password}@")
        rtsp = re.sub(r"[&?]proto=Onvif", "", rtsp)

        stream_name = req.ip.replace(".", "_")

        existing = next((d for d in devices if d.get("ome_stream") == stream_name), None)
        if not existing or not stream_exists_in_ome(stream_name):
            print("REGISTERING STREAM IN OME:", stream_name)
            ome_response = register_stream(stream_name, rtsp)
            print("OME RESPONSE:", ome_response)

            if not existing:
                new_device = {"ome_stream": stream_name, "rtsp_url": rtsp, "ip": req.ip}
                devices.append(new_device)
                save_devices(devices)
            else:
                existing["rtsp_url"] = rtsp
                save_devices(devices)

            # ── Save camera details to MongoDB mirador-vms/cameras ──
            try:
                cameras_col.update_one(
                    {"ip": req.ip},
                    {"$set": {
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
                    }},
                    upsert=True   # insert if new, update if already exists
                )
                print(f"[MONGO] 📷 Camera saved: {req.ip} → mirador-vms/cameras")
            except Exception as e:
                print(f"[MONGO] ⚠ Camera save failed: {e}")

            # ── Start recording ──
            recorder.start_camera(stream_name, rtsp)
            print(f"[ONVIF] 🎥 Recording started for {stream_name}")

        else:
            print(f"[ONVIF] Stream {stream_name} already live in OME, skipping.")
            ome_response = {"message": "Already registered", "statusCode": 200}

        result["ome_stream"]   = stream_name
        result["ome_response"] = ome_response
        result["ws_url"]       = f"ws://192.168.126.100:3333/app/{stream_name}"
        result["stream_key"]   = stream_name
        result["status"]       = "streaming"
        result["rtsp_url"]     = rtsp
    else:
        print(f"[ONVIF] ❌ {result['error']}")

    return result


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


@app.get("/api/devices/")
async def get_devices():
    return devices


@app.get("/api/cameras/")
async def get_cameras_from_db():
    """Return all cameras stored in MongoDB mirador-vms/cameras."""
    docs = list(cameras_col.find({}, {"_id": 0}))
    return docs