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
from designer_router import router as designer_router

from monitoring.websocket_manager import manager
from forensic_api import forensic_router



from  onvif_service import (
    probe_camera,
    set_imaging_setting,
    ptz_go_to_preset,
    ptz_set_preset,
    ptz_go_home,
    trigger_relay,
    move_camera_ptz,
  
)
from bosch_adapter import pull_bosch_events
import rtsp_recorder as recorder
import encrypt_service
import psutil
from recording_api import recording_router, storage_router
from stream_health import start_health_monitoring
from masks_router import router as masks_router
from backup_service import backup_router  # ← moved here, before app is created
from logs_router import router as logs_router
from brand_control import brand_router
from monitoring.router import router as infrastructure_router
from monitoring.scheduler import scheduler as infrastructure_scheduler
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
app.include_router(designer_router)
app.include_router(infrastructure_router)
app.include_router(forensic_router)


# @app.on_event("startup")
# async def startup_event():
#     infrastructure_scheduler.start()
    
#     # Start Real-Time Network Diagnostics
#     from monitoring.diagnostics import run_diagnostics_loop
#     asyncio.create_task(run_diagnostics_loop())

@app.on_event("startup")
async def startup_event():
    infrastructure_scheduler.start()
    
    # Start Real-Time Network Diagnostics
    from monitoring.diagnostics import run_diagnostics_loop
    asyncio.create_task(run_diagnostics_loop())

    # Start Camera Stream Health Poller (fills stream_fps, bitrate, resolution etc.)
    from monitoring.stream_health import run_stream_health_loop
    asyncio.create_task(run_stream_health_loop())




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
HOST_IP = os.environ.get("HOST_IP", "127.0.0.1")
OME_WHIP_BASE = os.environ.get("OME_WHIP_BASE", f"http://{HOST_IP}:3333/app")
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
    settings_col       = _db["settings"]
    settings_col.create_index("name", unique=True)
    auth_logs_col      = _db["auth_logs"]
    settings_col       = _db["settings"]
    settings_col.create_index("name", unique=True)
    auth_logs_col      = _db["auth_logs"]
    analytics_col      = _db["analytics_events"]
    analytics_subs_col = _db["analytics_subscriptions"]
    print(f"[MONGO] ✅ Connected: {MONGO_URI}")
except Exception as e:
    print(f"[MONGO] ❌ FAILED to connect: {e}")
    _mongo             = None
    settings_col       = None
    auth_logs_col      = None
    _db                = None
    cameras_col        = None
    users_col          = None
    settings_col       = None
    auth_logs_col      = None
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



class SupervisorPasswordRequest(BaseModel):
    password:         str
    confirm_password: str


class SupervisorVerifyRequest(BaseModel):
    password: str


class ResetPasswordRequest(BaseModel):
    email:            str
    new_password:     str
    confirm_password: str


class SupervisorPasswordRequest(BaseModel):
    password:         str
    confirm_password: str


class SupervisorVerifyRequest(BaseModel):
    password: str


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

@app.get("/api/event-playback")
def event_playback(ip: str, time: str, stream: int = 0):
    """
    stream=0 (default): returns JSON with clipUrl
    stream=1: returns video/mp4 bytes directly (used by <video src="...">)
    """
    import re, tempfile, subprocess, os
    from datetime import datetime, timezone, timedelta

    CHUNK_SECONDS = 300

    try:
        print("\n========== ALERT PLAYBACK ==========")
        print("IP   :", ip)
        print("TIME :", time)
        print("STREAM:", stream)

        # ── 1. Parse timestamp ────────────────────────────────────────
        t = time.strip()
        if " " in t:
            t = t.replace(" ", "+")
        t = re.sub(r"([+-])(\d{2})(\d{2})$", r"\1\2:\3", t)

        try:
            alert_dt = datetime.fromisoformat(t)
        except ValueError:
            t_clean  = re.sub(r"[+-]\d{2}:\d{2}$", "", t).rstrip("Z").strip()
            alert_dt = datetime.fromisoformat(t_clean)

        alert_local_hms  = alert_dt.strftime("%H-%M-%S")
        alert_local_date = alert_dt.strftime("%Y-%m-%d")
        alert_local_secs = (
            alert_dt.hour * 3600 + alert_dt.minute * 60 + alert_dt.second
        )

        if alert_dt.tzinfo is not None:
            alert_utc = alert_dt.astimezone(timezone.utc).replace(tzinfo=None)
        else:
            alert_utc = alert_dt

        print(f"Alert local : {alert_local_date} {alert_local_hms}  ({alert_local_secs}s)")

        # ── 2. Build candidate camera_id list ────────────────────────
        ip_prefix = ip.strip().replace(".", "_")
        recordings_col = _db["recordings"]

        all_cam_ids = recordings_col.distinct(
            "camera_id",
            {"camera_id": {"$regex": f"^{re.escape(ip_prefix)}"}}
        )
        if not all_cam_ids:
            all_cam_ids = [ip_prefix, ip.strip()]

        print(f"Camera IDs  : {all_cam_ids}")

        # ── 3. Find the best chunk in DB ──────────────────────────────
        def find_best_chunk_db(date_str, hms_str):
            best = None
            for cam_id in all_cam_ids:
                candidate = recordings_col.find_one(
                    {
                        "camera_id":  cam_id,
                        "date":       date_str,
                        "start_time": {"$lte": hms_str},
                    },
                    sort=[("start_time", -1)],
                )
                if candidate:
                    if best is None or candidate["start_time"] > best["start_time"]:
                        best = candidate
            return best

        doc = find_best_chunk_db(alert_local_date, alert_local_hms)

        if not doc:
            prev = (alert_dt - timedelta(days=1)).strftime("%Y-%m-%d")
            doc  = find_best_chunk_db(prev, "23-59-59")

        if not doc:
            doc = find_best_chunk_db(
                alert_utc.strftime("%Y-%m-%d"),
                alert_utc.strftime("%H-%M-%S"),
            )

        # ── 4. Validate chunk ─────────────────────────────────────────
        enc_path = None

        if doc:
            try:
                parts = re.split(r"[-:]", doc["start_time"])
                ch, cm, cs = int(parts[0]), int(parts[1]), int(parts[2])
                chunk_secs  = ch * 3600 + cm * 60 + cs
                elapsed     = alert_local_secs - chunk_secs
                print(f"DB chunk    : {doc['start_time']}  elapsed={elapsed:.0f}s")

                if elapsed <= CHUNK_SECONDS + 30:
                    enc_path = doc.get("file_path", "").replace("\\", "/")
                    print(f"DB chunk OK : {enc_path}")
                else:
                    print(f"DB chunk too old ({elapsed:.0f}s > {CHUNK_SECONDS}s) — scanning filesystem")
                    doc = None
            except Exception as e:
                print(f"Elapsed calc error: {e}")

        # ── 5. Filesystem fallback ────────────────────────────────────
        if not enc_path:
            rec_dir   = recorder.get_recordings_dir()
            best_file = None
            best_diff = None

            for cam_folder in os.listdir(rec_dir):
                if not cam_folder.startswith(ip_prefix):
                    continue
                date_dir = os.path.join(rec_dir, cam_folder, alert_local_date)
                if not os.path.isdir(date_dir):
                    continue
                for fname in os.listdir(date_dir):
                    if not fname.endswith(".enc"):
                        continue
                    stem = fname.replace(".enc", "")
                    try:
                        fparts = re.split(r"[-:]", stem)
                        fh, fm, fs = int(fparts[0]), int(fparts[1]), int(fparts[2])
                        file_secs  = fh * 3600 + fm * 60 + fs
                    except Exception:
                        continue
                    diff = alert_local_secs - file_secs
                    if 0 <= diff <= CHUNK_SECONDS + 30:
                        if best_diff is None or diff < best_diff:
                            best_diff = diff
                            best_file = os.path.join(date_dir, fname)
                            print(f"FS candidate: {best_file}  diff={diff:.0f}s")

            if best_file:
                enc_path = best_file
                stem     = os.path.basename(best_file).replace(".enc", "")
                fparts   = re.split(r"[-:]", stem)
                fh, fm, fs = int(fparts[0]), int(fparts[1]), int(fparts[2])
                elapsed  = alert_local_secs - (fh * 3600 + fm * 60 + fs)
                print(f"FS chunk OK : {enc_path}  elapsed={elapsed:.0f}s")
            else:
                msg = (
                    f"No recording found for IP={ip_prefix} "
                    f"date={alert_local_date} time={alert_local_hms}. "
                    f"Recording may not exist for this alert time."
                )
                print(f"[PLAYBACK] ERROR: {msg}")
                return Response(
                    content=f'{{"error":"{msg}"}}'.encode(),
                    status_code=404,
                    media_type="application/json",
                    headers={"Access-Control-Allow-Origin": "*"},
                )

        if not os.path.exists(enc_path):
            return Response(
                content=f'{{"error":"File not found on disk: {enc_path}"}}'.encode(),
                status_code=404,
                media_type="application/json",
                headers={"Access-Control-Allow-Origin": "*"},
            )

        # ── 6. Seek offset ────────────────────────────────────────────
        BEFORE   = 10
        AFTER    = 10
        offset   = max(0.0, elapsed - BEFORE)
        duration = BEFORE + AFTER

        print(f"Seek        : offset={offset:.1f}s  duration={duration}s")

        # ── 7. Decrypt ────────────────────────────────────────────────
        try:
            decrypted_bytes = b""
            for chunk in encrypt_service.decrypt_file_stream(enc_path):
                decrypted_bytes += chunk
        except Exception as dec_err:
            print(f"[PLAYBACK] Decryption failed: {dec_err}")
            return Response(
                content=f'{{"error":"Decryption failed: {str(dec_err)}"}}'.encode(),
                status_code=500,
                media_type="application/json",
                headers={"Access-Control-Allow-Origin": "*"},
            )

        if len(decrypted_bytes) < 1000:
            return Response(
                content=b'{"error":"Decrypted file is empty - key mismatch?"}',
                status_code=500,
                media_type="application/json",
                headers={"Access-Control-Allow-Origin": "*"},
            )

        print(f"Decrypted   : {len(decrypted_bytes):,} bytes")

        # ── 8. Extract clip with ffmpeg ───────────────────────────────
        output_path = tempfile.mktemp(suffix=".mp4")
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i",      "pipe:0",
            "-ss",     str(offset),
            "-t",      str(duration),
            "-c",      "copy",
            "-an",
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
            print(f"[PLAYBACK] ffmpeg rc={proc.returncode}: "
                  f"{stderr_data.decode(errors='replace')[-300:]}")

        if not os.path.exists(output_path) or os.path.getsize(output_path) < 500:
            print("[PLAYBACK] Retrying ffmpeg with offset=0")
            ffmpeg_cmd2 = [
                "ffmpeg", "-y",
                "-i",      "pipe:0",
                "-t",      str(duration),
                "-c",      "copy",
                "-an",
                "-movflags", "+faststart",
                output_path,
            ]
            proc2 = subprocess.Popen(
                ffmpeg_cmd2,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            try:
                proc2.communicate(input=decrypted_bytes, timeout=60)
            except subprocess.TimeoutExpired:
                proc2.kill()
                proc2.communicate()

        if not os.path.exists(output_path) or os.path.getsize(output_path) < 500:
            return Response(
                content=b'{"error":"Failed to extract clip from recording"}',
                status_code=500,
                media_type="application/json",
                headers={"Access-Control-Allow-Origin": "*"},
            )

        # ── 9. Save clip as encrypted .enc ────────────────────────────
        event_clips_col = _db["event_clips"]

        clips_base    = os.path.join(recorder.get_recordings_dir(), "event_clips")
        ip_folder     = ip.strip().replace(".", "_")
        clip_date     = alert_local_date
        clip_ts       = alert_dt.strftime("%H-%M-%S")
        clip_dir      = os.path.join(clips_base, ip_folder, clip_date)
        os.makedirs(clip_dir, exist_ok=True)

        clip_filename = f"{ip_folder}_{clip_ts}.enc"
        clip_enc_path = os.path.join(clip_dir, clip_filename)

        already_saved = os.path.exists(clip_enc_path)
        if not already_saved:
            try:
                with open(output_path, "rb") as f:
                    raw_mp4 = f.read()
                encrypted_clip = encrypt_service._aes_encrypt(raw_mp4)
                with open(clip_enc_path, "wb") as f:
                    f.write(encrypted_clip)
                print(f"[CLIP] ✅ Saved encrypted clip: {clip_enc_path}")

                event_clips_col.update_one(
                    {"ip": ip, "time": time},
                    {"$set": {
                        "ip":         ip,
                        "time":       time,
                        "date":       clip_date,
                        "file_path":  clip_enc_path.replace("\\", "/"),
                        "saved_at":   datetime.utcnow(),
                        "size_bytes": os.path.getsize(clip_enc_path),
                    }},
                    upsert=True
                )
            except Exception as save_err:
                print(f"[CLIP] ⚠ Auto-save failed (non-fatal): {save_err}")
        else:
            print(f"[CLIP] ℹ Clip already exists: {clip_enc_path}")

        # ── 10. Return URL or video bytes based on stream param ───────
        # stream=1 → return video bytes directly (for <video src="...">)
        # stream=0 → return JSON with clip_url (default, for other team)
        if stream == 1:
            # Return video bytes directly
            with open(output_path, "rb") as f:
                clip_data = f.read()
            try:
                os.remove(output_path)
            except Exception:
                pass

            print(f"[STREAM=1] Returning video bytes: {len(clip_data):,} bytes")

            return Response(
                content=clip_data,
                media_type="video/mp4",
                headers={
                    "Content-Type":        "video/mp4",
                    "Content-Length":      str(len(clip_data)),
                    "Content-Disposition": "inline",
                    "Accept-Ranges":       "bytes",
                    "Cache-Control":       "no-store",
                    "Access-Control-Allow-Origin":   "*",
                    "Access-Control-Allow-Methods":  "GET, OPTIONS",
                    "Access-Control-Allow-Headers":  "*",
                    "Access-Control-Expose-Headers": "Content-Length, Content-Type, X-Server-IP, X-Camera-IP",
                    "X-Server-IP": "192.168.126.200",
                    "X-Camera-IP": ip,
                },
            )

        # stream=0 → return JSON with playable URL
        try:
            os.remove(output_path)
        except Exception:
            pass

        clipUrl = (
                    f"http://192.168.126.200/api/event-playback"
                    f"?ip={urllib.parse.quote(ip)}"
                    f"&time={urllib.parse.quote(time)}"
                    f"&stream=1"
                )

        print(f"[STREAM=0] Returning JSON with clipUrl: {clipUrl}")

        return Response(
                    content=json.dumps({
                        "clipUrl": clipUrl,
                    }).encode(),
                    media_type="application/json",
                    headers={
                        "Access-Control-Allow-Origin":  "*",
                        "Access-Control-Allow-Methods": "GET, OPTIONS",
                        "Access-Control-Allow-Headers": "*",
                    },
                )
    except Exception as e:
        import traceback
        traceback.print_exc()
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
    dead = []

    for client in connected_clients:
        try:
            await client.send_json(event)
        except Exception:
            dead.append(client)

    for d in dead:
        if d in connected_clients:
            connected_clients.remove(d)
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



@app.websocket("/api/infrastructure/ws")
async def infrastructure_ws(websocket: WebSocket):
    await manager.connect(websocket)

    try:
        while True:
            await asyncio.sleep(10)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
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
                pull_bosch_events,
                ip,
                port,
                username,
                password
            )

            if result["success"] and result["events"]:

                for ev in result["events"]:

                    # -------------------------------------------------
                    # Bosch → Standard Alert Format for Existing UI
                    # -------------------------------------------------
                    bosch_alert = {
                        "ip": ip,
                        "serial": ip.replace(".", "_"),

                        # Same format used by Axis alerts
                        "type":        ev.get("event_type", "Object Detection"),

                        "scenario":    ev.get("scenario_name", "Detect Any Object"),

                        

                        "status": "Active",
                        "source": "bosch",

                        "topic": ev.get("topic", ""),
                        "raw": ev.get("raw", {}),

                        "time": datetime.now().isoformat(),
                        "received_at": datetime.now().isoformat(),
                    }

                    # Save in analytics history
                    if analytics_col is not None:
                        analytics_col.insert_one(bosch_alert)

                    # Save in main alerts collection
                    if watch_collection is not None:
                        watch_collection.insert_one(bosch_alert)

                    # Send live websocket alert
                    await broadcast_event(bosch_alert)

                    print(f"[BOSCH UI ALERT] {ip} → {bosch_alert['type']}")

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
    # ── DB naming cleanup (4 steps) ───────────────────────────────
    if cameras_col is not None:
        try:
            all_cams = list(cameras_col.find({}))

            # ── Step 1: Rename old MD5 hash-suffix entries → plain IP name ──
            # e.g. 192_168_126_235_3b1b71 → 192_168_126_235
            # BUT only when NO camN entry for the same IP exists
            # (if camN exists, step 3 will delete the hash entry instead).
            # _camN entries are left completely untouched.
            for cam in all_cams:
                ip = cam.get("ip")
                if not ip:
                    continue
                base_name = ip.replace(".", "_")
                current   = cam.get("ome_stream", "")

                # Proper camN entry → skip
                if re.search(r"_cam\d+$", current):
                    continue

                # Old MD5 hash entry (e.g. _3b1b71) → rename to plain IP
                if re.search(r"_[0-9a-f]{6}$", current):
                    # Only rename if no camN entry exists for this IP
                    has_cam_n = cameras_col.find_one({
                        "ip": ip,
                        "ome_stream": re.compile(f"^{re.escape(base_name)}_cam\\d+$")
                    })
                    if not has_cam_n:
                        # Avoid collision with an already-existing plain entry
                        conflict = cameras_col.find_one({
                            "ome_stream": base_name,
                            "_id": {"$ne": cam["_id"]}
                        })
                        if not conflict:
                            cameras_col.update_one(
                                {"_id": cam["_id"]},
                                {"$set": {"ome_stream": base_name}}
                            )
                            print(f"[MIGRATION] 🚚 Renamed hash entry: {current} → {base_name}")
                    continue

                # Completely foreign name (not IP-based at all) → rename to base_name
                if current and current != base_name and not current.startswith(base_name + "_"):
                    print(f"[MIGRATION] 🚚 Renaming stream: {current} → {base_name}")
                    cameras_col.update_one({"_id": cam["_id"]}, {"$set": {"ome_stream": base_name}})

            # ── Step 2: Purge ghost entries (no rtsp_url) ─────────────────
            ghost_result = cameras_col.delete_many({
                "$or": [
                    {"rtsp_url": {"$exists": False}},
                    {"rtsp_url": None},
                    {"rtsp_url": ""},
                ]
            })
            if ghost_result.deleted_count:
                print(f"[MIGRATION] 🧹 Purged {ghost_result.deleted_count} ghost entry/entries with no rtsp_url")

            # Re-fetch after steps 1 & 2
            all_cams = list(cameras_col.find({}))

            # Build set of IPs that have at least one camN entry
            cam_n_ips = {
                cam.get("ip", "")
                for cam in all_cams
                if re.search(r"_cam\d+$", cam.get("ome_stream", ""))
            }

            ids_to_delete = []

            for cam in all_cams:
                stream = cam.get("ome_stream", "")
                ip     = cam.get("ip", "")
                base   = ip.replace(".", "_") if ip else ""

                # ── Step 3: Old MD5 hash entry AND camN exists for same IP → delete
                if re.search(r"_[0-9a-f]{6}$", stream) and ip in cam_n_ips:
                    ids_to_delete.append(cam["_id"])
                    print(f"[MIGRATION] 🗑 Removing superseded hash entry: {stream}")
                    continue

                # ── Step 4: Plain IP entry AND camN exists for same IP → delete
                # e.g. 192_168_126_240 is redundant when 192_168_126_240_cam1 exists
                if stream == base and ip in cam_n_ips:
                    ids_to_delete.append(cam["_id"])
                    print(f"[MIGRATION] 🗑 Removing plain IP entry: {stream} (camN exists for {ip})")

            if ids_to_delete:
                cameras_col.delete_many({"_id": {"$in": ids_to_delete}})
                print(f"[MIGRATION] ✅ Removed {len(ids_to_delete)} stale entry/entries")

            # Reload devices after all migration steps
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
        # ── 1. Auto-subscribe any registered Bosch cameras that are missing subscriptions ──
        for device in devices:
            manuf = str(device.get("manufacturer", "")).lower()
            model = str(device.get("model", "")).lower()
            ip    = device.get("ip")
            
            if ip and ("bosch" in manuf or "bosch" in model):
                existing_sub = analytics_subs_col.find_one({"ip": ip})
                if not existing_sub or not existing_sub.get("enabled"):
                    print(f"[ANALYTICS] 🔗 Auto-subscribed Bosch camera: {ip}")
                    analytics_subs_col.update_one(
                        {"ip": ip},
                        {"$set": {
                            "ip":       ip,
                            "port":     device.get("port", 80),
                            "username": device.get("username", ""),
                            "password": device.get("password", ""),
                            "enabled":  True,
                            "enabled_at": datetime.utcnow()
                        }},
                        upsert=True
                    )

        # ── 2. Restore all enabled subscriptions (including the newly auto-subscribed ones) ──
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
    if req.role not in ("admin", "client", "operator"):
        raise HTTPException(status_code=400, detail="Role must be 'admin', 'client', or 'operator'")
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
        print(f"[AUTH] ✅ Account created for: {req.email}")
    except Exception as e:
        print(f"[AUTH] ❌ Signup failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to create account")
    return {"success": True, "message": "Account created successfully! Please sign in."}


@app.post("/api/auth/login")
def auth_login(req: LoginRequest, request: Request):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    user = users_col.find_one({"email": req.email})



    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not pwd_context.verify(req.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if user.get("role") != req.role:
        actual_role = user.get("role", "unknown").capitalize()
        attempted_role = req.role.capitalize()
        raise HTTPException(status_code=403, detail=f"Account registered as {actual_role}. Cannot login as {attempted_role}.")  



    if auth_logs_col is not None:
        try:
            auth_logs_col.insert_one({
                "type":      "login",
                "email":     user["email"],
                "role":      user["role"],
                "timestamp": datetime.utcnow().isoformat(),
                "ip":        request.client.host if request.client else None,
            })
        except Exception:
            pass
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


@app.post("/api/auth/supervisor-password")
def auth_set_supervisor_password(req: SupervisorPasswordRequest, user=Depends(require_admin)):
    if settings_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.password or not req.confirm_password:
        raise HTTPException(status_code=400, detail="Password and confirm password are required")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    if req.password != req.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    hashed_password = pwd_context.hash(req.password)
    settings_col.update_one(
        {"name": "supervisor_password"},
        {"$set": {"value": hashed_password, "updatedAt": datetime.utcnow().isoformat()}},
        upsert=True
    )
    print(f"[AUTH] ✅ Supervisor password updated by: {user.get('sub')}")
    return {"success": True, "message": "Supervisor password saved."}


@app.post("/api/auth/verify-supervisor")
def auth_verify_supervisor(req: SupervisorVerifyRequest):
    if settings_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.password:
        raise HTTPException(status_code=400, detail="Password is required")

    stored = settings_col.find_one({"name": "supervisor_password"})
    if stored and stored.get("value"):
        if pwd_context.verify(req.password, stored["value"]):
            return {"success": True}
        raise HTTPException(status_code=401, detail="Incorrect supervisor password")

    # fallback default
    if req.password == "supervisor123":
        return {"success": True}
    raise HTTPException(status_code=401, detail="Incorrect supervisor password")


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


@app.delete("/api/cameras/by-stream/{stream_name}/delete", dependencies=[Depends(verify_token)])
async def delete_camera_by_stream(stream_name: str):
    """
    Delete a camera entry by its ome_stream name.
    Removes ghost/stale entries that exist in MongoDB but were never properly cleaned up.
    The frontend (AddDevicesPage.jsx) already calls this endpoint on Remove.
    """
    global devices
    stopped = []
    # Stop recorder and OME stream
    recorder.stop_camera(stream_name)
    stopped.append(stream_name)
    try:
        r = http_requests.delete(
            f"{OME_API}/{stream_name}",
            headers={"Authorization": OME_AUTH},
            timeout=3,
        )
        print(f"[DELETE-STREAM] OME unregister {stream_name}: HTTP {r.status_code}")
    except Exception as e:
        print(f"[DELETE-STREAM] OME unregister failed for {stream_name} (non-fatal): {e}")
    _watchdog_failures.pop(stream_name, None)
    # Remove from in-memory devices
    devices = [d for d in devices if d.get("ome_stream") != stream_name]
    save_devices(devices)
    # Remove from MongoDB by ome_stream name
    if cameras_col is not None:
        result = cameras_col.delete_many({"ome_stream": stream_name})
        print(f"[DELETE-STREAM] 🗑 MongoDB: removed {result.deleted_count} doc(s) for stream '{stream_name}'")
    return {"success": True, "stream_name": stream_name, "streams_stopped": stopped}


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
        suffix = f"cam{req.channel}" if req.channel > 0 else None
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
                    "active_rec_profile": "MAIN_STREAM",
                    "recording_profile":  "MAIN_STREAM",
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
                "active_rec_profile": "MAIN_STREAM",
                "recording_profile":  "MAIN_STREAM",
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
            "active_rec_profile": "MAIN_STREAM",
            "recording_profile":  "MAIN_STREAM",
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
        "active_rec_profile": "MAIN_STREAM",
        "recording_profile":  "MAIN_STREAM",
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
    if cameras_col is None:
        return []
        
    # 1. Get registered cameras
    registered_cameras = list(cameras_col.find({}, {"_id": 0}))
    result = []
    
    for cam in registered_cameras:
        ip = cam.get("ip")
        if not ip: continue
        
        # 2. Find the latest health record for this camera's IP
        ip_pattern = ip.replace(".", "_")
        latest = _db["camera_health"].find_one(
            {"stream": {"$regex": ip_pattern}},
            sort=[("timestamp", -1)]
        )
        
        # 3. Combine registered info with live health info
        health_entry = {
            "name": cam.get("name") or cam.get("device_name") or f"Camera @ {ip}",
            "model": cam.get("model", "ONVIF Camera"),
            "ip": ip,
            "status": latest.get("status", "offline") if latest else "offline",
            "bitrate": latest.get("bitrate", 0) if latest else 0,
            "fps": latest.get("fps", 0) if latest else 0,
            "timestamp": latest.get("timestamp") if latest else None
        }
        result.append(health_entry)

    return result

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
# @app.get("/api/camera-models", dependencies=[Depends(verify_token)])
# async def get_camera_models(brand: str = None, type: str = None, search: str = None):
#     if _db is None:
#         return {"cameras": [], "brands": []}
#     try:
#         query = {}
#         if brand:
#             query["brand"] = brand
#         if type:
#             query["type"] = type
#         if search:
#             query["$or"] = [
#                 {"brand":  {"$regex": search, "$options": "i"}},
#                 {"model":  {"$regex": search, "$options": "i"}},
#                 {"series": {"$regex": search, "$options": "i"}},
#                 {"notes":  {"$regex": search, "$options": "i"}},
#             ]
#         col = _db["camera_models"]
#         cameras = list(col.find(query, {"_id": 0}))
#         brands  = col.distinct("brand")
#         return {"cameras": cameras, "brands": sorted(brands)}
#     except Exception as e:
#         print(f"[CAMERA-MODELS] ❌ {e}")
#         return {"cameras": [], "brands": []}

@app.get("/api/alerts", dependencies=[Depends(verify_token)])
async def get_alerts(limit: int = 50):
    if _db is None:
        return {"alerts": []}

    try:
        mqtt_col = _db["mqtt_logs"]
        docs = list(
            mqtt_col.find({}, {"_id": 0})
            .sort("_id", -1)
            .limit(limit)
        )

        formatted = []
        for d in docs:
            # Bosch alerts are flat (written directly by _analytics_poll_loop)
            if d.get("source") == "bosch":
                t = d.get("type")
                if not t or str(t).strip().lower() == "none":
                    t = "Object Detection"
                s = d.get("scenario")
                if not s or str(s).strip().lower() == "none":
                    s = "Detect Any Object"
                formatted.append({
                    "ip":          d.get("ip"),
                    "serial":      d.get("serial"),
                    "time":        d.get("time"),
                    "scenario":    s,
                    "type":        t,
                    "status":      d.get("status", "Active"),
                    "received_at": d.get("received_at"),
                    "topic":       d.get("topic", ""),
                })
            else:
                # Original MQTT/Axis nested format
                msg  = d.get("message", {})
                data = msg.get("data", {})
                
                t = d.get("type") or data.get("scenarioType")
                if not t or str(t).strip().lower() == "none":
                    t = "Object Detection"
                s = d.get("scenario") or data.get("scenario")
                if not s or str(s).strip().lower() == "none":
                    s = "Detect Any Object"
                    
                formatted.append({
                    "ip":        d.get("ip"),
                    "serial":    d.get("serial"),
                    "time":      data.get("triggerTime") or d.get("time"),
                    "scenario":  s,
                    "type":      t,
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
# Event Clips — list, play, manual save
# ------------------------------------------------------------------

@app.get("/api/event-clips", dependencies=[Depends(verify_token)])
def list_event_clips(ip: str = None, limit: int = 50):
    """List all saved event clips, optionally filtered by IP."""
    event_clips_col = _db["event_clips"]
    query = {}
    if ip:
        query["ip"] = ip
    docs = list(
        event_clips_col.find(query, {"_id": 0})
        .sort("saved_at", -1)
        .limit(limit)
    )
    for d in docs:
        if "saved_at" in d and hasattr(d["saved_at"], "isoformat"):
            d["saved_at"] = d["saved_at"].isoformat()
    return {"clips": docs}


@app.get("/api/event-clip/play", dependencies=[Depends(verify_token)])
def play_event_clip(ip: str, time: str):
    """Decrypt and stream a saved event clip."""
    event_clips_col = _db["event_clips"]

    doc = event_clips_col.find_one({"ip": ip, "time": time})
    if not doc:
        return Response(
            content=b'{"error":"Clip not found"}',
            status_code=404,
            media_type="application/json",
            headers={"Access-Control-Allow-Origin": "*"},
        )

    enc_path = doc.get("file_path", "")
    if not os.path.exists(enc_path):
        return Response(
            content=b'{"error":"Clip file missing on disk"}',
            status_code=404,
            media_type="application/json",
            headers={"Access-Control-Allow-Origin": "*"},
        )

    try:
        decrypted = b""
        for chunk in encrypt_service.decrypt_file_stream(enc_path):
            decrypted += chunk
    except Exception as e:
        return Response(
            content=f'{{"error":"Decryption failed: {str(e)}"}}'.encode(),
            status_code=500,
            media_type="application/json",
            headers={"Access-Control-Allow-Origin": "*"},
        )

    return Response(
        content=decrypted,
        media_type="video/mp4",
        headers={
            "Content-Type":        "video/mp4",
            "Content-Length":      str(len(decrypted)),
            "Content-Disposition": "inline",
            "Accept-Ranges":       "bytes",
            "Cache-Control":       "no-store",
            "Access-Control-Allow-Origin":   "*",
            "Access-Control-Allow-Methods":  "GET, OPTIONS",
            "Access-Control-Allow-Headers":  "*",
            "Access-Control-Expose-Headers": "Content-Length, Content-Type",
        },
    )


@app.post("/api/event-clip/save", dependencies=[Depends(verify_token)])
async def manual_save_clip(request: Request):
    """
    Manual save — called from UI Save button.
    Body: { "ip": "...", "time": "..." }
    Triggers event-playback internally and saves the clip.
    """
    body = await request.json()
    ip   = body.get("ip")
    time_str = body.get("time")

    if not ip or not time_str:
        raise HTTPException(status_code=400, detail="ip and time required")

    event_clips_col = _db["event_clips"]

    # Check if already saved
    existing = event_clips_col.find_one({"ip": ip, "time": time_str})
    if existing and os.path.exists(existing.get("file_path", "")):
        return {"success": True, "message": "Already saved", "already_existed": True}

    # Re-use the playback logic to get the clip bytes, then save
    from datetime import datetime as dt
    import re as _re

    try:
        # Parse time
        t = time_str.strip()
        if " " in t:
            t = t.replace(" ", "+")
        t = _re.sub(r"([+-])(\d{2})(\d{2})$", r"\1\2:\3", t)
        try:
            alert_dt = dt.fromisoformat(t)
        except ValueError:
            t_clean  = _re.sub(r"[+-]\d{2}:\d{2}$", "", t).rstrip("Z").strip()
            alert_dt = dt.fromisoformat(t_clean)

        clip_date  = alert_dt.strftime("%Y-%m-%d")
        clip_ts    = alert_dt.strftime("%H-%M-%S")
        ip_folder  = ip.strip().replace(".", "_")
        clips_base = os.path.join(recorder.get_recordings_dir(), "event_clips")
        clip_dir   = os.path.join(clips_base, ip_folder, clip_date)
        os.makedirs(clip_dir, exist_ok=True)

        clip_enc_path = os.path.join(clip_dir, f"{ip_folder}_{clip_ts}.enc")

        # Call event_playback internally to get the raw mp4 bytes
        # We do this by calling the function directly
        resp = event_playback(ip=ip, time=time_str)

        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="Recording not found for this alert")

        raw_mp4 = resp.body

        # Encrypt and save
        encrypted_clip = encrypt_service._aes_encrypt(raw_mp4)
        with open(clip_enc_path, "wb") as f:
            f.write(encrypted_clip)

        event_clips_col.update_one(
            {"ip": ip, "time": time_str},
            {"$set": {
                "ip":         ip,
                "time":       time_str,
                "date":       clip_date,
                "file_path":  clip_enc_path.replace("\\", "/"),
                "saved_at":   dt.utcnow(),
                "size_bytes": len(encrypted_clip),
            }},
            upsert=True
        )

        print(f"[CLIP] ✅ Manually saved: {clip_enc_path}")
        return {"success": True, "message": "Clip saved", "file": clip_enc_path}

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Save failed: {str(e)}")

# ------------------------------------------------------------------
# Register features router last (routes are defined above)
# ------------------------------------------------------------------
app.include_router(features_router)