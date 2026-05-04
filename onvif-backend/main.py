from fastapi import FastAPI, HTTPException, Request, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from pymongo import MongoClient
from datetime import datetime
from passlib.context import CryptContext
from camera_analytics_router import camera_analytics_router
import asyncio
import json
import hashlib
import os
import re
import subprocess
import requests as http_requests
import httpx
import shutil
import urllib.parse
from fastapi import UploadFile, File
from fastapi.responses import StreamingResponse
from jwt_auth import create_token, verify_token, require_admin
from fastapi.responses import FileResponse
from datetime import timedelta
# from encrypt_service import decrypt_file
import os, tempfile, subprocess
from fastapi import Depends
import tempfile
from ome_service import register_stream
from maps_router import router as maps_router

from onvif_service import (
    probe_camera,
    set_imaging_setting,
    ptz_go_to_preset,
    ptz_set_preset,
    ptz_go_home,
    trigger_relay,
    move_camera_ptz,
    pull_camera_events,
)
import rtsp_recorder as recorder
import encrypt_service
import psutil
from recording_api import recording_router, storage_router
from stream_health import start_health_monitoring
from masks_router import router as masks_router
from backup_service import backup_router  # ← moved here, before app is created
from logs_router import router as logs_router
from brand_control import brand_router
from license.license_store import load_license
from license.license_validator import validate_license
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from urllib.parse import urlparse, urlunparse, quote


connected_clients = []
import sys
from utils.terminal_logger import log_terminal

class LoggerWrapper:
    def write(self, message):
        msg = message.strip()

        # ✅ FILTER ONLY IMPORTANT LOGS
        if msg and (
            "[WATCHDOG]" in msg or
            "[ENCRYPT]" in msg or
            "[RTSP]" in msg or
            "ERROR" in msg or
            "❌" in msg
        ):
            log_terminal(
                "admin@gmail.com",
                "admin",
                "system log",
                "backend",
                0,
                msg
            )

        sys.__stdout__.write(message)

    def flush(self):
        pass

sys.stdout = LoggerWrapper()

async def watch_mongo_changes():
    print("[WS] 👀 Polling MongoDB for alerts...")

    last_id = None

    while True:
        try:
            query = {}

            if last_id:
                query["_id"] = {"$gt": last_id}

            docs = list(watch_collection.find(query).sort("_id", 1))

            for doc in docs:
                last_id = doc["_id"]

                print("[WS] 🚨 New alert (polling)")

                await broadcast_event({
                    "ip": doc.get("ip"),
                    "serial": doc.get("serial"),
                    "time": doc.get("time"),
                    "scenario": doc.get("scenario"),
                    "type": doc.get("type"),
                    "status": doc.get("status", "Active"),
                    "received_at": doc.get("received_at"),
                })

        except Exception as e:
            print("[WS ERROR]", e)

        await asyncio.sleep(1) 
         # check every 1 second# ------------------------------------------------------------------
# App creation — MUST come before any .include_router() calls
# ------------------------------------------------------------------
app = FastAPI(title="MIRADOR ONVIF Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # 🔥 IMPORTANT
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------
# Features router (defined here so routes below can use it)
# ------------------------------------------------------------------
features_router = APIRouter(prefix="/api/camera", tags=["camera-features"], dependencies=[Depends(verify_token)])

# ------------------------------------------------------------------
# Register all routers — app exists at this point
# ------------------------------------------------------------------
app.include_router(recording_router)
app.include_router(storage_router)
app.include_router(masks_router)
app.include_router(backup_router)
app.include_router(brand_router)
app.include_router(logs_router)
app.include_router(camera_analytics_router)
app.include_router(maps_router)





# ------------------------------------------------------------------
# Config
# ------------------------------------------------------------------
_health_monitor_task = None

DEVICES_FILE  = os.environ.get("DEVICES_FILE", os.path.join(os.path.dirname(__file__), "..", "devices_data", "devices.json"))
OME_API       = os.environ.get("OME_URL", "http://ome:8081/v1/vhosts/default/apps/app/streams")
OME_AUTH      = "Basic bXl2bXNhY2Nlc3N0b2tlbg=="
MONGO_URI     = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")
# ✅ Mongo Watch Setup (AFTER MONGO_URI defined)
mongo_watch_client = MongoClient(MONGO_URI)
watch_collection = mongo_watch_client["mirador-vms"]["mqtt_logs"]
OME_HOST_IP   = os.environ.get("OME_HOST_IP", "localhost")
OME_WS_PORT   = os.environ.get("OME_WS_PORT", "3333")
OME_WHIP_BASE = os.environ.get("OME_WHIP_BASE", "http://192.168.126.200:3333/app")

WATCHDOG_INTERVAL      = 5
WATCHDOG_MAX_RETRIES   = 20
WATCHDOG_BACKOFF_RESET = 10

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ------------------------------------------------------------------
# MongoDB
# ------------------------------------------------------------------
try:
    _mongo = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    _mongo.server_info()
    _db                = _mongo["mirador-vms"]
    cameras_col        = _db["cameras"]
    users_col          = _db["users"]
    users_col.create_index("email", unique=True)
    analytics_col      = _db["analytics_events"]
    analytics_subs_col = _db["analytics_subscriptions"]
    print(f"[MONGO] ✅ Connected: {MONGO_URI}")
except Exception as e:
    print(f"[MONGO] ❌ FAILED to connect: {e}")
    _mongo             = None
    _db                = None
    cameras_col        = None
    users_col          = None
    analytics_col      = None
    analytics_subs_col = None

# ------------------------------------------------------------------
# Pydantic models
# ------------------------------------------------------------------
class CameraCredentials(BaseModel):
    ip:       str
    port:     int = 80
    username: str = ""
    password: str = ""


class ImagingSettingRequest(BaseModel):
    ip:       str
    port:     int   = 80
    username: str   = ""
    password: str   = ""
    setting:  str
    value:    str | float | int


class PTZPresetRequest(BaseModel):
    ip:           str
    port:         int = 80
    username:     str = ""
    password:     str = ""
    preset_token: str


class PTZSavePresetRequest(BaseModel):
    ip:           str
    port:         int = 80
    username:     str = ""
    password:     str = ""
    preset_name:  str
    preset_token: str = None


class PTZMoveRequest(BaseModel):
    ip:       str
    port:     int   = 80
    username: str   = ""
    password: str   = ""
    pan:      float = 0.0
    tilt:     float = 0.0
    zoom:     float = 0.0


class RelayRequest(BaseModel):
    ip:          str
    port:        int = 80
    username:    str = ""
    password:    str = ""
    relay_token: str
    state:       str = "Active"


class ProbeRequest(BaseModel):
    ip:       str
    port:     int = 80
    username: str = ""
    password: str = ""
    channel:  int = 0
    group_id:    str = "default"
    device_name: str = ""
 


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
    group_id:     str = "default"


class StreamAssignRequest(BaseModel):
    ip:                str
    port:              int = 80
    username:          str = ""
    manufacturer:      str = "Unknown"
    model:             str = "Unknown"
    mac:               str = "—"
    device_name:       str = ""
    live_rtsp:         str
    recording_rtsp:    str
    live_profile:      str = ""
    recording_profile: str = ""


class SignupRequest(BaseModel):
    email:    str
    password: str
    role:     str = "client"


class LoginRequest(BaseModel):
    email:    str
    password: str
    role:     str = "client"


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    email:            str
    new_password:     str
    confirm_password: str

class StoragePathRequest(BaseModel):
    path: str

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
def normalize_stream_name(ip: str, suffix: str = None) -> str:
    # Always return the IP-based name for consistent folder organization
    base = ip.strip().replace(".", "_")
    if suffix:
        # Sanitize suffix (allow only alphanumeric)
        clean_suffix = re.sub(r'[^a-zA-Z0-9]', '', suffix)
        if clean_suffix:
            return f"{base}_{clean_suffix}"
    return base


def save_camera_to_db(data: dict):
    if cameras_col is None:
        print("[MONGO] ❌ No connection")
        return False
 
    token = load_license()
    valid, license_data = validate_license(token)
 
    if not valid:
        print("❌ License invalid")
        return False
 
    existing = cameras_col.find_one({"ome_stream": data["ome_stream"]})

    # 🔐 STEP 3: Count cameras
    current_count = cameras_col.count_documents({"enabled": True})

    print("CURRENT:", current_count)
    print("MAX:", license_data["max_cameras"])

    # 🔐 STEP 4: Block if exceeded
    if not existing and current_count >= license_data["max_cameras"]:
        print("❌ Camera limit reached (new camera blocked)")
        return False

    # ✅ STEP 5: Save camera
 
    try:
        cameras_col.update_one(
            {"ome_stream": data["ome_stream"]},
            {"$set": data},
            upsert=True
        )
        print("✅ Camera saved")
        return True
    except Exception as e:
        print("❌ Save failed:", e)
        return False

def load_devices():
    if cameras_col is not None:
        try:
            docs = list(cameras_col.find({}, {"_id": 0}))
            if docs:
                # Deduplicate by IP: only keep one record per IP to avoid multiple recording folders
                # We prioritize enabled cameras and then the ones with more data
                unique_cams = {}
                for d in docs:
                    stream_id = d.get("ome_stream") or normalize_stream_name(d.get("ip", "unknown"))
                    if not stream_id: continue
                    
                    if stream_id not in unique_cams:
                        unique_cams[stream_id] = d
                    else:
                        # If we find a duplicate, prefer the one that is 'enabled'
                        if d.get("enabled") and not unique_cams[stream_id].get("enabled"):
                            unique_cams[stream_id] = d
                
                deduped = list(unique_cams.values())
                print(f"[STARTUP] Loaded {len(docs)} cameras ({len(deduped)} unique IPs) from MongoDB")
                
                final_list = [{
                    "ome_stream":     d.get("ome_stream") or normalize_stream_name(d.get("ip")),
                    "rtsp_url":       d.get("rtsp_url"),
                    "recording_rtsp": d.get("recording_rtsp", d.get("rtsp_url")),
                    "ip":             d.get("ip"),
                    "port":           d.get("port", 80),
                    "username":       d.get("username", ""),
                    "password":       d.get("password", ""),
                    "enabled":        d.get("enabled", True),
                    "manufacturer":   d.get("manufacturer", "Unknown"),
                    "model":          d.get("model", "Unknown"),
                    "active_live_profile": d.get("active_live_profile", ""),
                    "active_rec_profile":  d.get("active_rec_profile", ""),
                    "recording_profile":   d.get("recording_profile", ""),
                    "assigned_schedule_id": d.get("assigned_schedule_id", "Always"),
                } for d in deduped if d.get("ip") and d.get("rtsp_url")]
                
                save_devices(final_list)
                return final_list
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

        from datetime import datetime

        def serialize(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            return str(obj)

        with open(DEVICES_FILE, "w") as f:
            json.dump(devs, f, default=serialize, indent=2)

        print("[DEVICES] ✅ Saved successfully")

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
    return [d for d in devices if d.get("ip") == ip]


devices = load_devices()
import mask_service as _mask_service

_watchdog_failures: dict[str, int] = {}
_watchdog_cycle = 0

# ------------------------------------------------------------------
# WebRTC WHIP proxy
# ------------------------------------------------------------------
@app.post("/api/whip/{stream_key}")
async def webrtc_proxy(stream_key: str, request: Request):
    body    = await request.body()
    ome_url = f"{OME_WHIP_BASE}/{stream_key}"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                ome_url,
                content=body,
                headers={"Content-Type": "application/sdp"},
                timeout=10.0,
            )
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type="application/sdp",
            headers={"Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        print(f"[WHIP] ❌ Proxy error for {stream_key}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
@app.get("/api/event-playback", dependencies=[Depends(verify_token)])
@app.get("/api/event-playback")
def event_playback(ip: str, time: str):
    import re, tempfile, subprocess, os
    from datetime import datetime
    from fastapi.responses import StreamingResponse, Response

    try:
        print("\n========== PLAYBACK ==========")
        print("IP:", ip)
        print("TIME:", time)

        # ── 1. Normalise the ISO timestamp that arrives from the frontend ──────
        # The frontend may send "2024-01-15T16:20:54+0530" or with a space instead of +
        if " " in time:
            time = time.replace(" ", "+")
        # Fix malformed timezone: "+0530" → "+05:30"
        time = re.sub(r"([+-])(\d{2})(\d{2})$", r"\1\2:\3", time)

        try:
            alert_time = datetime.fromisoformat(time)
        except ValueError:
            # Last-resort: strip timezone entirely and parse as local naive
            time_clean = re.sub(r"[+-]\d{2}:\d{2}$", "", time).strip()
            alert_time = datetime.fromisoformat(time_clean)

        alert_date = alert_time.strftime("%Y-%m-%d")
        alert_hms  = alert_time.strftime("%H-%M-%S")   # matches DB start_time format

        print(f"Parsed alert time: {alert_time}  date={alert_date}  hms={alert_hms}")

        # ── 2. Find the recording chunk that contains (or just precedes) the alert ─
        #       We look for the chunk whose start_time <= alert HH-MM-SS.
        #       Try both the normalised stream name (dots→underscores) and the raw IP.
        stream_name = ip.replace(".", "_")  # matches how cameras are stored

        doc = _db["recordings"].find_one(
            {"camera_id": stream_name, "date": alert_date, "start_time": {"$lte": alert_hms}},
            sort=[("start_time", -1)],
        )
        if not doc:
            # Try with the raw IP in case the camera_id was stored differently
            doc = _db["recordings"].find_one(
                {"camera_id": ip, "date": alert_date, "start_time": {"$lte": alert_hms}},
                sort=[("start_time", -1)],
            )
        if not doc:
            print(f"[PLAYBACK] No chunk found for camera={stream_name} date={alert_date} before {alert_hms}")
            return Response(
                content=b'{"error":"No recording chunk found for this alert time"}',
                status_code=404,
                media_type="application/json",
                headers={"Access-Control-Allow-Origin": "*"},
            )

        enc_path = doc.get("file_path", "")
        if not enc_path or not os.path.exists(enc_path):
            return Response(
                content=b'{"error":"Encrypted file missing on disk"}',
                status_code=404,
                media_type="application/json",
                headers={"Access-Control-Allow-Origin": "*"},
            )

        # ── 3. Calculate the seek offset so the clip is alert ± 10 s ────────────
        #       chunk_start is parsed from the DB start_time field (HH-MM-SS).
        try:
            h, m, s = map(int, doc["start_time"].split("-"))
            # Build a timezone-naive datetime on the same calendar date as the alert
            chunk_start = alert_time.replace(hour=h, minute=m, second=s, microsecond=0)
            # Remove tzinfo from alert_time for arithmetic (both are now naive / same tz)
            if alert_time.tzinfo is not None:
                from datetime import timezone
                alert_naive = alert_time.astimezone(timezone.utc).replace(tzinfo=None)
                chunk_start = chunk_start.replace(tzinfo=None)
            else:
                alert_naive = alert_time

            elapsed = (alert_naive - chunk_start).total_seconds()
        except Exception as parse_err:
            print(f"[PLAYBACK] Could not parse chunk start_time '{doc['start_time']}': {parse_err}")
            elapsed = 0.0

        # Clip: 10 s before the alert → 10 s after  (20 s total)
        BEFORE = 10   # seconds before alert to include
        AFTER  = 10   # seconds after  alert to include
        offset   = max(0.0, elapsed - BEFORE)
        duration = BEFORE + AFTER   # 20 s

        print(f"[PLAYBACK] chunk={doc['start_time']}  elapsed={elapsed:.1f}s  "
              f"offset={offset:.1f}s  duration={duration}s  file={enc_path}")

        # ── 4. Decrypt the entire .enc file into memory ──────────────────────────
        #       We use encrypt_service which already has MASTER_KEY loaded.
        try:
            decrypted_bytes = b""
            for chunk in encrypt_service.decrypt_file_stream(enc_path):
                decrypted_bytes += chunk
        except Exception as dec_err:
            print(f"[PLAYBACK] Decryption failed: {dec_err}")
            return Response(
                content=b'{"error":"Decryption failed"}',
                status_code=500,
                media_type="application/json",
                headers={"Access-Control-Allow-Origin": "*"},
            )

        if not decrypted_bytes or len(decrypted_bytes) < 1000:
            return Response(
                content=b'{"error":"Decrypted file is empty or corrupt"}',
                status_code=500,
                media_type="application/json",
                headers={"Access-Control-Allow-Origin": "*"},
            )

        # ── 5. Pipe decrypted MP4 into ffmpeg, extract the ±10 s clip ───────────
        #       Use communicate() — never stream-write to stdin while also reading
        #       stdout/stderr; that causes a deadlock with large files.
        output_path = tempfile.mktemp(suffix=".mp4")
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", "pipe:0",          # read MP4 from stdin
            "-ss", str(offset),      # seek to (alert - 10 s)
            "-t",  str(duration),    # extract 20 s
            "-c:v", "libx264",       # re-encode so browsers can play it
            "-preset", "ultrafast",
            "-crf", "23",
            "-an",                   # drop audio (recordings are -an anyway)
            "-movflags", "+faststart",
            output_path,
        ]

        proc = subprocess.Popen(
            ffmpeg_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

        try:
            _, stderr_data = proc.communicate(input=decrypted_bytes, timeout=60)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()
            return Response(
                content=b'{"error":"ffmpeg timed out"}',
                status_code=500,
                media_type="application/json",
                headers={"Access-Control-Allow-Origin": "*"},
            )

        if proc.returncode != 0:
            err_text = stderr_data.decode(errors="replace")[-300:]
            print(f"[PLAYBACK] ffmpeg error (rc={proc.returncode}): {err_text}")
            # Don't abort — check if the output was still created (partial clip)

        if not os.path.exists(output_path) or os.path.getsize(output_path) < 500:
            err_text = stderr_data.decode(errors="replace")[-300:] if stderr_data else "unknown"
            print(f"[PLAYBACK] ffmpeg produced no usable output: {err_text}")
            return Response(
                content=b'{"error":"Failed to extract video clip - ffmpeg produced no output"}',
                status_code=500,
                media_type="application/json",
                headers={"Access-Control-Allow-Origin": "*"},
            )

        # ── 6. Read the clip and return it as a streaming MP4 response ──────────
        with open(output_path, "rb") as f:
            clip_data = f.read()

        try:
            os.remove(output_path)
        except Exception:
            pass

        print(f"[PLAYBACK] ✅ Returning clip ({len(clip_data):,} bytes)")

        import io
        return StreamingResponse(
            io.BytesIO(clip_data),
            media_type="video/mp4",
            headers={
                "Content-Length":      str(len(clip_data)),
                "Content-Type":        "video/mp4",
                "Accept-Ranges":       "bytes",
                "Cache-Control":       "no-store",
                "Access-Control-Allow-Origin":   "*",
                "Access-Control-Allow-Methods":  "GET, OPTIONS",
                "Access-Control-Allow-Headers":  "*",
                "Access-Control-Expose-Headers": "Content-Length, Content-Type",
            },
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[PLAYBACK] ❌ Unexpected error: {e}")
        return Response(
            content=f'{{"error":"{str(e)}"}}'.encode(),
            status_code=500,
            media_type="application/json",
            headers={"Access-Control-Allow-Origin": "*"},
        )

async def system_health_collector():
    while True:
        try:
            cpu = psutil.cpu_percent()
            ram = psutil.virtual_memory().percent
            disk = psutil.disk_usage('/').percent

            _db["health_logs"].insert_one({
                "type": "system",
                "cpu": cpu,
                "ram": ram,
                "disk": disk,
                "timestamp": datetime.utcnow()
            })

        except Exception as e:
            print("[SYSTEM HEALTH ERROR]", e)

        await asyncio.sleep(5)
async def camera_health_collector():
    while True:
        try:
            for cam in devices:
                _db["health_logs"].insert_one({
                    "type": "camera",
                    "ip": cam.get("ip"),
                    "status": "online" if cam.get("enabled") else "offline",
                    "timestamp": datetime.utcnow()
                })
        except Exception as e:
            print("[CAM HEALTH ERROR]", e)

        await asyncio.sleep(10)            
@app.websocket("/ws/events")
async def websocket_events(websocket: WebSocket):
    try:
        print("🔥 WS HIT")

        await websocket.accept()
        connected_clients.append(websocket)

        print(f"✅ WS Connected | Total: {len(connected_clients)}")

        while True:
            await asyncio.sleep(10)   # ✅ KEEP CONNECTION ALIVE

    except WebSocketDisconnect:
        print("❌ WS Disconnected")

    except Exception as e:
        print(f"❌ WS ERROR: {e}")

    finally:
        if websocket in connected_clients:
            connected_clients.remove(websocket)

async def broadcast_event(event):
    for client in connected_clients:
        try:
            await client.send_json(event)
        except Exception as e:
            print("[WS ERROR]", e)
log_clients = []

@app.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
    await websocket.accept()
    log_clients.append(websocket)

    print(f"📡 Logs WS Connected: {len(log_clients)}")

    try:
        while True:
            await asyncio.sleep(10)
    except WebSocketDisconnect:
        log_clients.remove(websocket)
        print("❌ Logs WS Disconnected")

async def broadcast_log(log):
    for client in log_clients:
        try:
            await client.send_json(log)
        except:
            pass

# ------------------------------------------------------------------
# WebSocket: Dashboard (replaces 10s polling)
# ------------------------------------------------------------------
dashboard_clients = []

@app.websocket("/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket):
    await websocket.accept()
    dashboard_clients.append(websocket)
    print(f"📊 Dashboard WS Connected: {len(dashboard_clients)}")

    try:
        while True:
            try:
                # Build dashboard payload
                summary_data = {}
                camera_health_data = []

                if cameras_col is not None and analytics_col is not None:
                    total_cameras = cameras_col.count_documents({})
                    active_streams = cameras_col.count_documents({"enabled": {"$ne": False}})
                    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
                    alarms_today = analytics_col.count_documents({"received_at": {"$gte": today_start}})

                    latest_health = _db["health_logs"].find_one(
                        {"type": "system"}, sort=[("timestamp", -1)]
                    )
                    cpu = latest_health.get("cpu", 0) if latest_health else 0
                    ram = latest_health.get("ram", 0) if latest_health else 0
                    disk = latest_health.get("disk", 0) if latest_health else 0

                    alerts = []
                    if cpu > 85: alerts.append("High CPU Usage")
                    if ram > 85: alerts.append("High RAM Usage")
                    if disk > 90: alerts.append("Disk Almost Full")

                    status = "Healthy"
                    if cpu > 85 or ram > 85 or disk > 90: status = "Critical"
                    elif cpu > 60 or ram > 60 or disk > 75: status = "Warning"

                    summary_data = {
                        "total_cameras": total_cameras,
                        "active_streams": active_streams,
                        "alarms_today": alarms_today,
                        "cpu": cpu, "ram": ram, "disk": disk,
                        "alerts": alerts, "status": status
                    }

                    # Camera health from camera_health collection
                    try:
                        raw_health = list(_db["camera_health"].find({}, {"_id": 0}))
                        valid_cameras = list(cameras_col.find({}, {"_id": 0, "ip": 1}))
                        valid_ips = [c["ip"].replace(".", "_") for c in valid_cameras]
                        camera_health_data = [
                            d for d in raw_health
                            if any(ip in d.get("stream", "") for ip in valid_ips)
                            and "cam0" in d.get("stream", "")
                        ]
                    except Exception:
                        camera_health_data = []

                await websocket.send_json({
                    "type": "dashboard_update",
                    "summary": summary_data,
                    "camera_health": camera_health_data
                })

            except Exception as e:
                print(f"[WS Dashboard] Data build error: {e}")

            await asyncio.sleep(5)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS Dashboard] Error: {e}")
    finally:
        if websocket in dashboard_clients:
            dashboard_clients.remove(websocket)
        print(f"📊 Dashboard WS Disconnected: {len(dashboard_clients)} remaining")

# ------------------------------------------------------------------
# WebSocket: Backup Status (replaces 3s polling)
# ------------------------------------------------------------------
backup_ws_clients = []

@app.websocket("/ws/backup-status")
async def websocket_backup_status(websocket: WebSocket):
    await websocket.accept()
    backup_ws_clients.append(websocket)
    print(f"💾 Backup WS Connected: {len(backup_ws_clients)}")

    try:
        while True:
            try:
                from backup_service import backup_state, get_storage_usage, get_local_path, is_network_available, auto_watcher_active, NETWORK_BASE_DIR
                state = dict(backup_state)
                state["storage_usage"] = get_storage_usage()
                state["local_path"] = str(get_local_path())
                state["network_path"] = str(NETWORK_BASE_DIR)
                state["network_available"] = is_network_available()
                state["auto_active"] = auto_watcher_active

                await websocket.send_json({
                    "type": "backup_status",
                    **state
                })
            except Exception as e:
                print(f"[WS Backup] Error: {e}")

            await asyncio.sleep(2)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS Backup] Error: {e}")
    finally:
        if websocket in backup_ws_clients:
            backup_ws_clients.remove(websocket)
        print(f"💾 Backup WS Disconnected: {len(backup_ws_clients)} remaining")
# ------------------------------------------------------------------
# OME readiness wait
# ------------------------------------------------------------------
async def _wait_for_ome(max_retries: int = 30, delay: int = 5):
    import socket
    for attempt in range(1, max_retries + 1):
        try:
            r = http_requests.get(OME_API, headers={"Authorization": OME_AUTH}, timeout=3)
            if r.status_code in (200, 201, 404):
                # Also verify the WebSocket port is accepting connections
                try:
                    sock = socket.create_connection(("ome", int(OME_WS_PORT)), timeout=2)
                    sock.close()
                except Exception:
                    raise Exception(f"WS port {OME_WS_PORT} not yet open")
                print(f"[STARTUP] ✅ OME REST + WS ready (attempt {attempt})")
                await asyncio.sleep(2)  # brief grace period for stream ingestion
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
            rec_rtsp    = device.get("recording_rtsp", rtsp_url)
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
# Analytics background polling
# ------------------------------------------------------------------
_analytics_tasks: dict[str, asyncio.Task] = {}


async def _analytics_poll_loop(ip: str, port: int, username: str, password: str):
    print(f"[ANALYTICS] ▶ Started polling for {ip}")
    consecutive_failures = 0
    while True:
        try:
            result = await asyncio.to_thread(
                pull_camera_events, ip, port, username, password
            )
            if result["success"] and result["events"]:
                for ev in result["events"]:
                    doc = {
                        "ip":          ip,
                        "event_type":  ev["event_type"],
                        "topic":       ev["topic"],
                        "utc_time":    ev["utc_time"],
                        "raw":         ev["raw"],
                        "received_at": datetime.utcnow(),
                    }
                    if analytics_col is not None:
                        analytics_col.insert_one(doc)
                    print(f"[ANALYTICS] {ip} → {ev['event_type']}")
                consecutive_failures = 0
            elif not result["success"]:
                consecutive_failures += 1
                if consecutive_failures >= 10:
                    print(f"[ANALYTICS] ✗ Giving up on {ip} after 10 failures")
                    break
        except asyncio.CancelledError:
            print(f"[ANALYTICS] ⏹ Stopped for {ip}")
            break
        except Exception as e:
            print(f"[ANALYTICS] ❌ {ip}: {e}")
            consecutive_failures += 1
        await asyncio.sleep(5)


# ------------------------------------------------------------------
# Startup / Shutdown
# ------------------------------------------------------------------
from utils.terminal_logger import log_terminal

@app.on_event("startup")
async def startup():
    # ── Standardize DB naming convention ──────────────────────────
    if cameras_col is not None:
        try:
            all_cams = list(cameras_col.find({}))
            for cam in all_cams:
                ip = cam.get("ip")
                if not ip: continue
                base_name = ip.replace(".", "_")
                current   = cam.get("ome_stream", "")
                # Only rename if the stream has NO hash suffix (old format).
                # Multi-channel streams have a suffix like 192_168_126_240_e1c95c — leave them alone.
                if current and current != base_name and not current.startswith(base_name + "_"):
                    print(f"[MIGRATION] 🚚 Renaming stream: {current} -> {base_name}")
                    cameras_col.update_one({"_id": cam["_id"]}, {"$set": {"ome_stream": base_name}})
                # If it already HAS a unique suffix, don't touch it
            # Reload devices after migration
            global devices
            devices = load_devices()
        except Exception as e:
            print(f"[MIGRATION] ⚠ DB naming cleanup failed: {e}")

    log_terminal(
        "admin@gmail.com",
        "admin",
        "backend started",
        "/app",
        0,
        "startup success"
    )
    global _health_monitor_task
    print(f"[STARTUP] Starting with {len(devices)} saved devices")
    await _wait_for_ome()

    for device in devices:
        stream_name = device.get("ome_stream")
        rtsp_url    = device.get("rtsp_url")
        if device.get("enabled") is False:
            print(f"[STARTUP] ⏭ Skipping disabled camera: {stream_name}")
            continue
        if stream_name and rtsp_url:
            print(f"[STARTUP] Registering stream: {stream_name}")
            register_stream(stream_name, rtsp_url)

    asyncio.create_task(stream_watchdog())

    if analytics_subs_col is not None:
        active_subs = list(analytics_subs_col.find({"enabled": True}))
        for sub in active_subs:
            sub_ip = sub.get("ip")
            if sub_ip:
                t = asyncio.create_task(
                    _analytics_poll_loop(
                        sub_ip, sub.get("port", 80),
                        sub.get("username", ""), sub.get("password", "")
                    )
                )
                _analytics_tasks[sub_ip] = t
                print(f"[ANALYTICS] ♻ Restored for {sub_ip}")

    _health_monitor_task = asyncio.create_task(start_health_monitoring(devices, cameras_col))
    encrypt_service.start_watcher()
    recorder.start_recording_all(devices)
    asyncio.create_task(system_health_collector())
    asyncio.create_task(camera_health_collector())
    enabled_count = sum(1 for d in devices if d.get("enabled") is not False)
    print(f"[STARTUP] 🎥 Recording started for {enabled_count}/{len(devices)} enabled camera(s)")
    asyncio.create_task(watch_mongo_changes())

    print(f"[STARTUP] ✓ Stream health monitoring started")

@app.on_event("shutdown")
async def shutdown():
    print("[SHUTDOWN] Stopping recorders and encryption watcher...")
    recorder.stop_all()
    encrypt_service.stop_watcher()


# ------------------------------------------------------------------
# Debug
# ------------------------------------------------------------------
@app.get("/api/debug/mongo", dependencies=[Depends(verify_token)])
def debug_mongo():
    try:
        _mongo.server_info()
        cam_count  = cameras_col.count_documents({})
        rec_count  = _db["recordings"].count_documents({})
        user_count = users_col.count_documents({})
        return {
            "status":       "connected",
            "uri":          MONGO_URI,
            "cameras":      cam_count,
            "recordings":   rec_count,
            "users":        user_count,
            "devices_json": len(devices),
        }
    except Exception as e:
        return {"status": "failed", "error": str(e), "uri": MONGO_URI}


# ------------------------------------------------------------------
# Auth endpoints
# ------------------------------------------------------------------
@app.post("/api/auth/signup")
def auth_signup(req: SignupRequest):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.email or not req.password:
        raise HTTPException(status_code=400, detail="Email and password are required")
    email_regex = r"^[^\s@]+@[^\s@]+\.[^\s@]+$"
    if not re.match(email_regex, req.email):
        raise HTTPException(status_code=400, detail="Invalid email format")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if req.role not in ("admin", "client"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'client'")
    if users_col.find_one({"email": req.email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed_password = pwd_context.hash(req.password)
    user_doc = {
        "email":     req.email,
        "password":  hashed_password,
        "role":      req.role,
        "createdAt": datetime.utcnow().isoformat(),
    }
    try:
        users_col.insert_one(user_doc)
        print(f"[AUTH] ✅ New user registered: {req.email} ({req.role})")
    except Exception as e:
        print(f"[AUTH] ❌ Signup failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to create account")
    return {"success": True, "message": "Account created successfully! Please sign in."}


@app.post("/api/auth/login")
def auth_login(req: LoginRequest):

    user = users_col.find_one({"email": req.email})

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not pwd_context.verify(req.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # ✅ CREATE TOKEN
    token = create_token(user["email"], user["role"])

    return {
        "success": True,
        "token": token,
        "user": {
            "email": user["email"],
            "role": user["role"]
        }
    }

@app.post("/api/auth/forgot-password")
def auth_forgot_password(req: ForgotPasswordRequest):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.email:
        raise HTTPException(status_code=400, detail="Email is required")
    user = users_col.find_one({"email": req.email})
    if not user:
        raise HTTPException(status_code=404, detail="No account found with this email. Please sign up instead.")
    print(f"[AUTH] 🔑 Password reset requested for: {req.email}")
    return {
        "success": True,
        "message": f"Password reset link sent to {req.email}. Check your email (demo mode)."
    }


@app.post("/api/auth/reset-password")
def auth_reset_password(req: ResetPasswordRequest):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.email or not req.new_password or not req.confirm_password:
        raise HTTPException(status_code=400, detail="All fields are required")
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if req.new_password != req.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    user = users_col.find_one({"email": req.email})
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    hashed_password = pwd_context.hash(req.new_password)
    users_col.update_one(
        {"email": req.email},
        {"$set": {"password": hashed_password, "updatedAt": datetime.utcnow().isoformat()}}
    )
    print(f"[AUTH] ✅ Password reset for: {req.email}")
    return {"success": True, "message": "Password reset successfully! Please sign in."}


# ------------------------------------------------------------------
# Basic endpoints
# ------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/cameras", dependencies=[Depends(verify_token)])
def get_all_cameras():
    return load_devices()
@app.post("/api/recordings/decrypt-upload", dependencies=[Depends(verify_token)])
async def decrypt_uploaded_file(file: UploadFile = File(...)):
    enc_path = None
    dec_path = None

    try:
        print(f"[UPLOAD] Received file: {file.filename}")

        # Validate extension
        if not file.filename.endswith(".enc"):
            raise HTTPException(status_code=400, detail="Only .enc files allowed")

        # Save temp encrypted file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".enc") as temp_enc:
            temp_enc.write(await file.read())
            enc_path = temp_enc.name

        # Output path
        dec_path = enc_path.replace(".enc", ".mp4")

        print(f"[DECRYPT] Input: {enc_path}")
        print(f"[DECRYPT] Output: {dec_path}")

        # Decrypt — now returns True/False and raises on bad key
        success = encrypt_service.decrypt_file(enc_path, dec_path)
        if not success:
            raise HTTPException(status_code=500, detail="Decryption utility failed. Check backend logs.")

        if not os.path.exists(dec_path):
            raise HTTPException(status_code=500, detail="Decrypted file not created.")

        # Read fully before cleanup
        with open(dec_path, "rb") as f:
            data = f.read()

        if not data:
            raise HTTPException(status_code=500, detail="Decryption produced empty output — key mismatch?")

        safe_filename = file.filename.replace('.enc', '.mp4')

        return Response(
            content=data,
            media_type="video/mp4",
            headers={
                # Explicit Content-Type so browsers/VLC know this is MP4
                "Content-Type":        "video/mp4",
                "Content-Length":      str(len(data)),
                "Content-Disposition": f"inline; filename=\"{safe_filename}\"",
                "Accept-Ranges":       "bytes",
                "Cache-Control":       "no-store",
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Decryption failed: {str(e)}")

    finally:
        try:
            if enc_path and os.path.exists(enc_path):
                os.remove(enc_path)
            if dec_path and os.path.exists(dec_path):
                os.remove(dec_path)
        except Exception as cleanup_err:
            print("[CLEANUP ERROR]", cleanup_err)
@app.get("/api/discover-devices", dependencies=[Depends(verify_token)])
async def discover_devices():
    try:
        from discovery_service import discover_all
        print("[DISCOVER] Starting network discovery...")
        found = await asyncio.to_thread(discover_all, 4, 150)
        print(f"[DISCOVER] Found {len(found)} device(s)")
 
        for device in found:
            rtsp_url = device.get("rtsp_url")
            ip       = device.get("ip")

            if not rtsp_url or not ip:
                device["ws_url"]        = None
                device["stream_key"]    = None
                device["stream_status"] = "no_rtsp"
                continue
 
            from urllib.parse import urlparse
            parsed = urlparse(rtsp_url)
            if not parsed.username:
                print(f"[DISCOVER] ⚠ {ip} — no credentials in RTSP URL, skipping OME")
                device["ws_url"]        = None
                device["stream_key"]    = None
                device["stream_status"] = "credentials_required"
                continue
            stream_name = normalize_stream_name(ip)

            if stream_exists_in_ome(stream_name):
                print(f"[DISCOVER] ✅ {ip} already in OME")
                status_code = 200
            else:
                ome_result  = register_stream(stream_name, rtsp_url)
                status_code = ome_result.get("statusCode", 0) \
                              if isinstance(ome_result, dict) else 0
                print(f"[DISCOVER] OME register {ip}: HTTP {status_code}")
 
            if status_code in (200, 201, 409):
                device["ws_url"]        = f"ws://{OME_HOST_IP}:{OME_WS_PORT}/app/{stream_name}"
                device["stream_key"]    = stream_name
                device["stream_status"] = "streaming"
 
                existing = next((d for d in devices if d.get("ip") == ip), None)

                if not existing:
                    new_dev = {
                        "ome_stream":     stream_name,
                        "rtsp_url":       rtsp_url,
                        "recording_rtsp": rtsp_url,
                        "ip":             ip,
                        "enabled":        True,
                    }
                    saved = save_camera_to_db(new_dev)
                    if saved:
                        devices.append(new_dev)
                        save_devices(devices)
                    recorder.start_camera(stream_name, rtsp_url, new_dev)
            else:
                device["ws_url"]        = None
                device["stream_key"]    = None
                device["stream_status"] = "error"
 
        return {"devices": found}
 
    except Exception as e:
        print(f"[DISCOVER] ❌ Discovery error: {e}")
        return {"devices": [], "error": str(e)}
 
 
# ------------------------------------------------------------------
# Camera enable / disable / delete
# ------------------------------------------------------------------
@app.post("/api/cameras/by-ip/{ip}/enable", dependencies=[Depends(verify_token)])
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


@app.post("/api/cameras/by-ip/{ip}/disable", dependencies=[Depends(verify_token)])
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


@app.delete("/api/cameras/by-ip/{ip}/delete", dependencies=[Depends(verify_token)])
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
    if cameras_col is not None:
        result = cameras_col.delete_many({"ip": ip})
        print(f"[DELETE] 🗑 MongoDB: removed {result.deleted_count} document(s) for IP {ip}")
    return {"success": True, "ip": ip, "streams_stopped": stopped}


@app.put("/api/cameras/by-ip/{ip}", dependencies=[Depends(verify_token)])
async def update_camera_by_ip(ip: str, request: Request):
    data = await request.json()
    
    if cameras_col is not None:
        # Only update allowed fields
        allowed_keys = {"name", "device_name", "mac", "manufacturer", "model", "rtsp_url", "group_id"}
        update_data = {k: v for k, v in data.items() if k in allowed_keys}
        if update_data:
            cameras_col.update_many({"ip": ip}, {"$set": update_data})
            print(f"[UPDATE] ✏️ MongoDB: updated document(s) for IP {ip}")

    # Update in-memory devices
    global devices
    for d in devices:
        if d.get("ip") == ip:
            for k, v in data.items():
                d[k] = v
    save_devices(devices)
    
    return {"success": True, "ip": ip}


# ------------------------------------------------------------------
# ONVIF probe
# ------------------------------------------------------------------
@app.post("/api/onvif/probe", dependencies=[Depends(verify_token)])
async def onvif_probe(req: ProbeRequest):
    print(f"[ONVIF] Probing {req.ip}:{req.port} ...")
    token = load_license()
    valid, data = validate_license(token)
 
    if not valid:
        raise HTTPException(status_code=400, detail="Invalid License")
 
    if cameras_col is not None:
        current_count = cameras_col.count_documents({"enabled": True})
        if current_count >= data["max_cameras"]:
            raise HTTPException(status_code=400, detail="Camera limit exceeded")
 
    result = await asyncio.to_thread(
        probe_camera, req.ip, req.port, req.username, req.password, req.channel
    )

 
    if result["success"]:
        print(f"[ONVIF] ✅ {result['manufacturer']} {result['model']} "
              f"— {result.get('stream_count', '?')} stream(s)")
        # Use the first profile's rtsp_url (reflects the selected channel from the UI)
        # Fallback to stream_uri for backward compatibility
        profiles_list = result.get("profiles") or result.get("all_profiles") or []
        if profiles_list and profiles_list[0].get("rtsp_url"):
            rtsp = profiles_list[0]["rtsp_url"]
        else:
            rtsp = result.get("stream_uri", "")
        rtsp = re.sub(r"[&?]proto=Onvif", "", rtsp)

        parsed = urllib.parse.urlparse(rtsp)
        if req.username and not parsed.username:
            user_clean = req.username.strip()
            pass_clean = req.password.strip()
            host = parsed.hostname
            port = parsed.port
            if port:
                netloc = f"{user_clean}:{pass_clean}@{host}:{port}"
            else:
                netloc = f"{user_clean}:{pass_clean}@{host}"
            
            rtsp = urllib.parse.urlunparse((
                parsed.scheme,
                netloc,
                parsed.path,
                parsed.params,
                parsed.query,
                parsed.fragment            ))
 
            if "transport=" not in rtsp:
                if "?" in rtsp:
                    rtsp += "&transport=tcp"
                else:
                    rtsp += "?transport=tcp"

        print("FINAL RTSP:", rtsp)
        # changes ends
        # Generate a unique stream name based on IP and a hash of the RTSP URL
        # Use channel-based suffix for stable, unique stream names on multi-channel devices
        suffix = f"cam{req.channel}" if req.channel > 0 else hashlib.md5(rtsp.encode()).hexdigest()[:6]
        stream_name = normalize_stream_name(req.ip, suffix)
        
        existing    = next((d for d in devices if d.get("ome_stream") == stream_name), None)

 
        if not existing or not stream_exists_in_ome(stream_name):
            print(f"[ONVIF] Registering stream in OME: {stream_name}")
            ome_response = register_stream(stream_name, rtsp)
            print(f"[ONVIF] OME response: {ome_response}")
 
            if not existing:
                new_device = {
                    "ome_stream":     stream_name,
                    "rtsp_url":       rtsp,
                    "recording_rtsp": rtsp,
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
                "api_profile":     result.get("api_profile"),
                "group_id":        req.group_id,
                "device_name":     req.device_name,
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
@app.post("/api/streams/register", dependencies=[Depends(verify_token)])
async def register_rtsp_stream(req: StreamRegisterRequest):
    token = load_license()
    valid, data = validate_license(token)
 
    if not valid:
        return {"success": False, "error": "Invalid License"}
 
    if cameras_col is not None:
        current_count = cameras_col.count_documents({"enabled": True})
        if current_count >= data["max_cameras"]:
            return {"success": False, "error": "Camera limit exceeded"}
 
    rtsp = req.rtsp_url.strip()
    print(f"[RTSP] Registering stream: {rtsp}")
 
    import hashlib
    rtsp_hash = hashlib.md5(rtsp.encode()).hexdigest()[:6]

    if req.ip:
        host        = req.ip
        stream_name = normalize_stream_name(host, rtsp_hash)
    else:
        try:
            from urllib.parse import urlparse
            parsed      = urlparse(rtsp)
            host        = parsed.hostname or "unknown"
            stream_name = normalize_stream_name(host, rtsp_hash)
        except Exception:
            host        = "unknown"
            stream_name = normalize_stream_name("unknown", rtsp_hash)

    existing = next(
        (d for d in devices if d.get("ome_stream") == stream_name),
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
            "recording_rtsp": rtsp,
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
        "ip":             host,
        "ome_stream":     stream_name,
        "rtsp_url":       rtsp,
        "recording_rtsp": rtsp,
        "manufacturer":   req.manufacturer,
        "model":          req.model,
        "mac":            req.mac,
        "device_name":    req.device_name or f"Camera @ {host}",
        "port":           req.port,
        "username":       req.username,
        "password":       req.password,
        "added_at":       datetime.utcnow(),
        "status":         "streaming",
        "enabled":        True,
        "source":         "rtsp",
        "group_id":       req.group_id,
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
# Assign independent Live + Recording streams
# ------------------------------------------------------------------
@app.post("/api/streams/assign", dependencies=[Depends(verify_token)])
async def assign_streams(req: StreamAssignRequest):
    import time

    host        = req.ip.strip()
    # For assignment, we need to find which camera we are talking about.
    # We'll use the IP and look for the one with matching profiles if possible, 
    # but the safest way is to look for the one that has the live_rtsp or recording_rtsp.
    # However, since we don't have the ID, we'll try to find by IP and manufacturer for now
    # or just use the first match for this IP.
    stream_name = normalize_stream_name(host) 

    print(f"[ASSIGN] {host}: live={req.live_profile!r}  rec={req.recording_profile!r}")
    print(f"[ASSIGN] live_rtsp={req.live_rtsp!r}")
    print(f"[ASSIGN] rec_rtsp={req.recording_rtsp!r}")

    # ── 1. Update OME only if live RTSP actually changed ──────────────
    existing = next(
        (d for d in devices if d.get("ip") == host and (d.get("rtsp_url") == req.live_rtsp or d.get("recording_rtsp") == req.recording_rtsp)),
        next((d for d in devices if d.get("ip") == host), None)
    )
    current_live_rtsp = existing.get("rtsp_url") if existing else None
    live_rtsp_changed = current_live_rtsp != req.live_rtsp

    if live_rtsp_changed or not stream_exists_in_ome(stream_name):
        print(f"[ASSIGN] Live RTSP changed or stream missing — re-registering OME")
        try:
            # Delete existing first to avoid 409
            try:
                http_requests.delete(
                    f"{OME_API}/{stream_name}",
                    headers={"Authorization": OME_AUTH},
                    timeout=5,
                )
            except:
                pass

            time.sleep(0.5)

            ome_response = register_stream(stream_name, req.live_rtsp)
            status_code  = ome_response.get("statusCode", 0) if isinstance(ome_response, dict) else 0
            print(f"[ASSIGN] OME register HTTP {status_code}: {ome_response}")

            if status_code not in (200, 201):
                print(f"[ASSIGN] ⚠ OME registration returned HTTP {status_code} — continuing anyway")
        except Exception as e:
            print(f"[ASSIGN] ⚠ OME error (non-fatal): {e} — continuing")
    else:
        print(f"[ASSIGN] Live RTSP unchanged and stream exists — skipping OME re-register")

    # ── 2. Always update device entry ────────────────────────────────
    if existing:
        existing["rtsp_url"]            = req.live_rtsp
        existing["recording_rtsp"]      = req.recording_rtsp
        existing["active_live_profile"] = req.live_profile
        existing["active_rec_profile"]  = req.recording_profile
        existing["recording_profile"]   = req.recording_profile
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
            "recording_profile":    req.recording_profile,

        }
        devices.append(device_entry)

    save_devices(devices)

    # ── 3. Persist to MongoDB ─────────────────────────────────────────
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

    # 🔥 THIS IS THE MISSING FIX
    "active_live_profile":  req.live_profile,
    "active_rec_profile":   req.recording_profile,
    "recording_profile":    req.recording_profile,

    "updated_at":           datetime.utcnow(),
})

    # ── 4. Restart recorder with new recording RTSP ───────────────────
    # IMPORTANT: stop first, wait 1s for the thread to fully exit,
    # then start with the new RTSP URL so the profile change takes effect.
    print(f"[ASSIGN] 🔄 Restarting recorder with new profile")
    recorder.stop_camera(stream_name)
    time.sleep(1)  # let the old thread fully exit before starting new one
    recorder.start_camera(stream_name, req.recording_rtsp, device_entry)
    print(f"[ASSIGN] ✅ Recorder restarted with: {req.recording_rtsp}")

    # ── 5. Reset watchdog so the stream is not blacklisted ───────────
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
# Camera lookup by IP
# ------------------------------------------------------------------
@app.get("/api/cameras/by-ip/{ip}", dependencies=[Depends(verify_token)])
async def get_camera_by_ip(ip: str):
    if cameras_col is not None:
        doc = cameras_col.find_one({"ip": ip}, {"_id": 0})
        if doc:
            return doc
    dev = next((d for d in devices if d.get("ip") == ip), None)
    if dev:
        return dev
    raise HTTPException(status_code=404, detail=f"Camera {ip} not found")


# ------------------------------------------------------------------
# Camera Features Router endpoints
# ------------------------------------------------------------------
@features_router.post("/capabilities")
async def get_camera_capabilities(req: CameraCredentials):
    print(f"[FEATURES] Full capability probe: {req.ip}:{req.port}")
    result = await asyncio.to_thread(
        probe_camera, req.ip, req.port, req.username, req.password
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Probe failed"))
    return result


@features_router.post("/imaging/set")
async def set_imaging(req: ImagingSettingRequest):
    print(f"[FEATURES] Set imaging {req.setting}={req.value} on {req.ip}")
    result = await asyncio.to_thread(
        set_imaging_setting,
        req.ip, req.port, req.username, req.password,
        req.setting, req.value
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/ptz/preset/goto")
async def goto_preset(req: PTZPresetRequest):
    result = await asyncio.to_thread(
        ptz_go_to_preset,
        req.ip, req.port, req.username, req.password,
        req.preset_token
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/ptz/preset/save")
async def save_preset(req: PTZSavePresetRequest):
    result = await asyncio.to_thread(
        ptz_set_preset,
        req.ip, req.port, req.username, req.password,
        req.preset_name, req.preset_token
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/ptz/home")
async def goto_home(req: CameraCredentials):
    result = await asyncio.to_thread(
        ptz_go_home,
        req.ip, req.port, req.username, req.password
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/ptz/move")
async def ptz_move(req: PTZMoveRequest):
    result = await asyncio.to_thread(
        move_camera_ptz,
        req.ip, req.port, req.username, req.password,
        req.pan, req.tilt, req.zoom
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/io/relay")
async def set_relay(req: RelayRequest):
    result = await asyncio.to_thread(
        trigger_relay,
        req.ip, req.port, req.username, req.password,
        req.relay_token, req.state
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/analytics/enable")
async def enable_analytics(req: CameraCredentials):
    ip = req.ip
    if ip in _analytics_tasks and not _analytics_tasks[ip].done():
        return {"success": True, "message": "Already running"}
    if analytics_subs_col is not None:
        analytics_subs_col.update_one(
            {"ip": ip},
            {"$set": {
                "ip": ip, "port": req.port,
                "username": req.username, "password": req.password,
                "enabled": True, "enabled_at": datetime.utcnow()
            }},
            upsert=True
        )
    task = asyncio.create_task(
        _analytics_poll_loop(ip, req.port, req.username, req.password)
    )
    _analytics_tasks[ip] = task
    print(f"[ANALYTICS] ✅ Enabled for {ip}")
    return {"success": True, "message": f"Analytics started for {ip}"}


@features_router.post("/analytics/disable")
async def disable_analytics(req: CameraCredentials):
    ip = req.ip
    task = _analytics_tasks.get(ip)
    if task and not task.done():
        task.cancel()
        del _analytics_tasks[ip]
    if analytics_subs_col is not None:
        analytics_subs_col.update_one({"ip": ip}, {"$set": {"enabled": False}})
    print(f"[ANALYTICS] ⏹ Disabled for {ip}")
    return {"success": True, "message": f"Analytics stopped for {ip}"}


@features_router.get("/analytics/status/{ip}")
async def analytics_status(ip: str):
    running = ip in _analytics_tasks and not _analytics_tasks[ip].done()
    return {"ip": ip, "running": running}


@features_router.get("/analytics/events/{ip}")
async def get_analytics_events(ip: str, limit: int = 50):
    if analytics_col is None:
        return {"events": []}
    docs = list(
        analytics_col.find({"ip": ip}, {"_id": 0})
        .sort("received_at", -1).limit(limit)
    )
    for d in docs:
        if "received_at" in d:
            d["received_at"] = d["received_at"].isoformat()
    return {"events": docs}


# ------------------------------------------------------------------
# Device / storage endpoints
# ------------------------------------------------------------------
@app.post("/api/devices/", dependencies=[Depends(verify_token)])
async def add_device(device: dict):
    print("DEVICE REGISTERED:", device)
    # Use ome_stream or IP as the unique key
    stream_id = device.get("ome_stream") or device.get("ip_address")
    if not stream_id:
        return {"success": False, "error": "Missing identifier"}

    existing = next(
        (d for d in devices if (d.get("ome_stream") or d.get("ip_address")) == stream_id), 
        None
    )
    if existing:
        devices.remove(existing)
    devices.append(device)
    save_devices(devices)
    return {"success": True, "device": device}


@app.get("/api/devices", dependencies=[Depends(verify_token)])
async def get_devices():
    devs = await _db.devices.find({}).to_list(None)
    result = []
    for d in devs:
        d["id"]  = str(d["_id"])
        d["_id"] = str(d["_id"])
        result.append(d)
    return result


@app.get("/api/cameras/", dependencies=[Depends(verify_token)])
async def get_cameras_from_db():
    if cameras_col is None:
        return []
    docs = list(cameras_col.find({}, {"_id": 0}))
    return docs


@app.get("/api/storage/selection", dependencies=[Depends(verify_token)])
def storage_selection():
    if cameras_col is None:
        return []
    docs   = list(cameras_col.find({}, {"_id": 0}))
    result = []
    for cam in docs:
        stream         = cam.get("ome_stream", "")
        recordings_dir = recorder.get_recordings_dir()
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
        used_gb    = round(used_bytes / (1024 ** 3), 2)
        oldest_str = datetime.fromtimestamp(oldest).strftime("%d-%m-%Y %H:%M:%S") if oldest else "N/A"
        result.append({
            "device":           f"{cam.get('manufacturer', '')} {cam.get('model', '')}".strip() or cam.get("ip"),
            "ip":               cam.get("ip"),
            "used_storage":     f"{used_gb} GB",
            "location":         recordings_dir,
            "retention":        cam.get("retention_days", 70),
            "oldest_recording": oldest_str,
            "failover":         cam.get("failover", False),
        })
    return result


@app.post("/api/storage/selection", dependencies=[Depends(verify_token)])
def update_storage_selection(payload: dict):
    if cameras_col is None:
        return {"error": "MongoDB not connected"}
    ip = payload.get("ip")
    if not ip:
        return {"error": "ip required"}
    # Update by ome_stream if provided, fallback to IP (warning: IP update affects all channels)
    stream_id = payload.get("ome_stream")
    if stream_id:
        cameras_col.update_one({"ome_stream": stream_id}, {"$set": {
            "retention_days": payload.get("retention_days", 70),
            "failover":       payload.get("failover", False),
            "store_to":       payload.get("store_to", recorder.get_recordings_dir()),
        }})
    else:
        cameras_col.update_many(
            {"ip": ip},
            {"$set": {
                "retention_days": payload.get("retention_days", 70),
                "failover":       payload.get("failover", False),
                "store_to":       payload.get("store_to", recorder.get_recordings_dir()),
            }}
        )
    return {"success": True}


@app.post("/api/onvif/ptz/move", dependencies=[Depends(verify_token)])
async def onvif_ptz_move(req: PTZMoveRequest):
    print(f"[PTZ] Moving {req.ip} to P:{req.pan} T:{req.tilt} Z:{req.zoom}")
    result = await asyncio.to_thread(
        move_camera_ptz,
        req.ip, req.port, req.username, req.password,
        req.pan, req.tilt, req.zoom
    )
    return result


# ------------------------------------------------------------------
# Dashboard
# ------------------------------------------------------------------
@app.get("/api/dashboard/summary", dependencies=[Depends(verify_token)])
async def get_dashboard_summary():
    if cameras_col is None or analytics_col is None:
        return {}

    total_cameras = cameras_col.count_documents({})

    active_streams = cameras_col.count_documents({
        "enabled": {"$ne": False}
    })

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    alarms_today = analytics_col.count_documents({
        "received_at": {"$gte": today_start}
    })

    latest_health = _db["health_logs"].find_one(
        {"type": "system"},
        sort=[("timestamp", -1)]
    )

    cpu = latest_health.get("cpu", 0) if latest_health else 0
    ram = latest_health.get("ram", 0) if latest_health else 0
    disk = latest_health.get("disk", 0) if latest_health else 0

    # 🔥 ADD ALERT LOGIC
    alerts = []

    if cpu > 85:
        alerts.append("High CPU Usage")

    if ram > 85:
        alerts.append("High RAM Usage")

    if disk > 90:
        alerts.append("Disk Almost Full")

    # 🔥 SYSTEM STATUS
    status = "Healthy"
    if cpu > 85 or ram > 85 or disk > 90:
        status = "Critical"
    elif cpu > 60 or ram > 60 or disk > 75:
        status = "Warning"

    return {
        "total_cameras": total_cameras,
        "active_streams": active_streams,
        "alarms_today": alarms_today,

        "cpu": cpu,
        "ram": ram,
        "disk": disk,

        "alerts": alerts,
        "status": status
    }
@app.get("/api/camera-health", dependencies=[Depends(verify_token)])
def get_camera_health():
    # 1. Get valid camera IPs from DB
    cameras = list(cameras_col.find({}, {"_id": 0, "ip": 1}))
    valid_ips = [c["ip"].replace(".", "_") for c in cameras]

    # 2. Get latest health records only
    docs = list(_db["camera_health"].find({}, {"_id": 0}))

    filtered = []

    for d in docs:
        stream = d.get("stream", "")

        # 3. Keep only streams matching DB cameras
        if any(ip in stream for ip in valid_ips):
            # 4. OPTIONAL: only main stream (avoid duplicates)
            if "cam0" in stream:   # 🔥 IMPORTANT FILTER
                filtered.append(d)

    return filtered

@app.get("/api/cameras", dependencies=[Depends(verify_token)])
async def get_cameras():
    if cameras_col is None:
        return {"devices": []}
    
    docs = list(cameras_col.find({"enabled": {"$ne": False}}, {"_id": 0}))
    
    for d in docs:
        d.setdefault("device_name", d.get("name", f"Camera @ {d.get('ip', 'unknown')}"))
        d["stream_status"] = "streaming" if d.get("status") == "streaming" else "offline"
        d.setdefault("group_id", "default")
        d.setdefault("ome_stream", d.get("stream_key") or d.get("ip"))
        
    return {"devices": docs}

@app.get("/api/action-rules", dependencies=[Depends(verify_token)])
def get_action_rules():
    rules = list(_db["action_rules"].find({}, {"_id": 0}))
    return {"rules": rules}
@app.get("/api/dashboard/events", dependencies=[Depends(verify_token)])
async def get_dashboard_events(limit: int = 20):
    if analytics_col is None:
        return []
    docs = list(
        analytics_col.find({}, {"_id": 0})
        .sort("received_at", -1)
        .limit(limit)
    )
    for d in docs:
        if "received_at" in d:
            d["received_at"] = d["received_at"].isoformat()
    return docs


@app.get("/api/alerts", dependencies=[Depends(verify_token)])
async def get_alerts(limit: int = 50):
    if _db is None:
        return {"alerts": []}

    try:
        mqtt_col = _db["mqtt_logs"]

        docs = list(
            mqtt_col.find({}, {"_id": 0})
            # .sort("received_at", -1)
            .sort("_id", -1)   # 🔥 FIX

            .limit(limit)
        )

        formatted = []

        for d in docs:
            msg  = d.get("message", {})
            data = msg.get("data", {})

            formatted.append({
                "ip":        d.get("ip"),
                "serial":    d.get("serial"),
                "time":      data.get("triggerTime"),
                "scenario":  data.get("scenario"),
                "type":      data.get("scenarioType"),
                "human":     data.get("human"),
                "total":     data.get("total"),
                "class":     data.get("classTypes"),
                "object_id": data.get("objectId"),
                "status":    "Active",
                "received_at": d.get("received_at"),
            })

        return {"alerts": formatted}

    except Exception as e:
        print(f"[ALERTS] ❌ {e}")
        return {"alerts": []}
# @app.get("/api/alerts")
# def get_alerts(limit: int = 50):
#     try:
#         alerts = list(
#             watch_collection
#             .find({})
#             .sort("_id", -1)   # ✅ newest first (VERY IMPORTANT)
#             .limit(limit)
#         )

#         # convert ObjectId → string
#         for a in alerts:
#             a["_id"] = str(a["_id"])

#         return {"alerts": alerts}

#     except Exception as e:
#         return {"alerts": [], "error": str(e)}


@app.get("/api/license", dependencies=[Depends(verify_token)])
def get_license():
    from license.license_store import load_license
    from license.license_validator import validate_license

    token = load_license()

    if not token:
        return {"status": "error", "max_cameras": 0}

    valid, data = validate_license(token)

    if not valid:
        return {"status": "error", "max_cameras": 0}

    return {
        "status":      "ok",
        "max_cameras": data["max_cameras"],
    }


# ------------------------------------------------------------------
# Register features router last (routes are defined above)
# ------------------------------------------------------------------
app.include_router(features_router)