from fastapi import APIRouter, Depends, HTTPException, File, UploadFile
from app.core.security import verify_token, require_admin
from app.services.license_manager import license_manager
import json
import asyncio
from urllib.parse import urlparse
from pydantic import BaseModel
from typing import Optional
from app.core.database import mongo_client, db as _db, cameras_col, users_col
from app.managers.stream_manager import (
    normalize_stream_name,
    save_camera_to_db,
    save_devices,
    stream_exists_in_mediamtx,
    devices
)
from app.services.camera.mediamtx_service import register_stream
from recorder import rtsp_recorder as recorder
import uuid

import os

STARTUP_ID = str(uuid.uuid4())

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")

CACHED_DISCOVERED_DEVICES = []
_discovery_in_progress = False

async def run_discovery_pipeline():
    global CACHED_DISCOVERED_DEVICES, _discovery_in_progress
    if _discovery_in_progress:
        return
    _discovery_in_progress = True
    print("[BACKGROUND-DISCOVERY] Starting network scan...")
    try:
        from app.services.camera.discovery_service import discover_all
        found = await asyncio.to_thread(discover_all, 4, 1000)
        print(f"[BACKGROUND-DISCOVERY] Found {len(found)} device(s)")

        # Enrich discovered devices with their registered details (like exact model name) if already in database/VMS
        from app.managers.stream_manager import load_devices
        try:
            registered_devices = load_devices()
            registered_by_ip = {r.get("ip"): r for r in registered_devices if r.get("ip")}
            for device in found:
                ip = device.get("ip")
                if ip in registered_by_ip:
                    reg_dev = registered_by_ip[ip]
                    if reg_dev.get("manufacturer") and reg_dev.get("manufacturer") != "Unknown":
                        device["manufacturer"] = reg_dev["manufacturer"]
                    if reg_dev.get("model") and reg_dev.get("model") != "Unknown":
                        device["model"] = reg_dev["model"]
                    if reg_dev.get("mac") and reg_dev.get("mac") != "Unknown":
                        device["mac"] = reg_dev["mac"]
        except Exception as enrich_err:
            print(f"[BACKGROUND-DISCOVERY] ⚠ Failed to enrich with registered devices: {enrich_err}")

        for device in found:
            rtsp_url = device.get("rtsp_url")
            ip       = device.get("ip")

            if not rtsp_url:
                print(f"[BACKGROUND-DISCOVERY] ⏭ {ip} — no RTSP URL found, skipping OME")
                device["ws_url"]        = None
                device["stream_key"]    = None
                device["stream_status"] = "credentials_required"
                continue

            from urllib.parse import urlparse
            parsed = urlparse(rtsp_url)
            if not parsed.username:
                print(f"[BACKGROUND-DISCOVERY] ⚠ {ip} — no credentials in RTSP URL, skipping OME")
                device["ws_url"]        = None
                device["stream_key"]    = None
                device["stream_status"] = "credentials_required"
                continue
            stream_name = normalize_stream_name(ip)

            if stream_exists_in_mediamtx(stream_name):
                print(f"[BACKGROUND-DISCOVERY] ✅ {ip} already in MediaMTX")
                status_code = 200
            else:
                register_result = register_stream(stream_name, rtsp_url)
                status = register_result.get("status") if isinstance(register_result, dict) else "error"
                print(f"[BACKGROUND-DISCOVERY] MediaMTX register {ip}: {status}")
                status_code = 200 if status == "ok" else 0
 
            if status_code in (200, 201, 409):
                device["ws_url"]        = f"http://host.docker.internal:8889/{stream_name}"
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

        CACHED_DISCOVERED_DEVICES = found
        print(f"[BACKGROUND-DISCOVERY] Cached list updated with {len(found)} device(s)")
    except Exception as e:
        print(f"[BACKGROUND-DISCOVERY] ❌ Discovery pipeline error: {e}")
    finally:
        _discovery_in_progress = False

def start_background_discovery():
    asyncio.create_task(run_discovery_pipeline())

router = APIRouter(prefix="/api", tags=["system"])

@router.get("/health")
def health():
    import os
    import socket
    from monitoring.scheduler import scheduler
    from app.core.database import mongo_client
    import urllib.request
    
    watchdog_active = scheduler.thread.is_alive() if scheduler.thread else False
    
    # 1. MongoDB Check
    mongodb_ok = False
    try:
        if mongo_client:
            mongo_client.admin.command('ping')
            mongodb_ok = True
    except Exception:
        pass

    # 2. Mosquitto Check
    mosquitto_ok = False
    try:
        mqtt_host = os.environ.get("MQTT_BROKER", "127.0.0.1")
        mqtt_port = int(os.environ.get("MQTT_PORT", 1883))
        with socket.create_connection((mqtt_host, mqtt_port), timeout=1):
            mosquitto_ok = True
    except Exception:
        pass

    # 3. MinIO Check
    minio_ok = False
    try:
        minio_endpoint = os.environ.get("MINIO_ENDPOINT", "127.0.0.1:9000")
        m_host = minio_endpoint.split(":")[0] if ":" in minio_endpoint else minio_endpoint
        m_port = int(minio_endpoint.split(":")[1]) if ":" in minio_endpoint else 9000
        with socket.create_connection((m_host, m_port), timeout=1):
            minio_ok = True
    except Exception:
        pass

    # 4. MediaMTX Check
    mediamtx_ok = False
    try:
        mtx_url = os.environ.get("MEDIAMTX_API_URL", "http://127.0.0.1:9997/v3/paths/list")
        if "host.docker.internal" in mtx_url:
            mtx_url = mtx_url.replace("host.docker.internal", "127.0.0.1")
        req = urllib.request.Request(mtx_url, method="GET")
        with urllib.request.urlopen(req, timeout=1) as response:
            if response.status == 200:
                mediamtx_ok = True
    except Exception:
        pass

    days_left = license_manager.get_days_until_expiry()
    max_cams = license_manager.get_max_cameras()
    active_cams = cameras_col.count_documents({"enabled": True}) if cameras_col is not None else len([d for d in devices if d.get("enabled") is True])

    is_healthy = mongodb_ok and mosquitto_ok and minio_ok and mediamtx_ok and watchdog_active

    from fastapi.responses import JSONResponse
    status_code = 200 if is_healthy else 503

    return JSONResponse(status_code=status_code, content={
        "status": "ok" if is_healthy else "error",
        "mongodb": mongodb_ok,
        "minio": minio_ok,
        "mediamtx": mediamtx_ok,
        "mosquitto": mosquitto_ok,
        "stream_manager": True, # Placeholder for explicit stream manager process check
        "scheduler": watchdog_active,
        "version": os.environ.get("APP_VERSION", "1.0.0"),
        "startup_id": STARTUP_ID,
        "license": {
            "valid": license_manager._check_valid() or (not license_manager.validation_enabled or license_manager.dev_mode),
            "days_remaining": days_left,
            "expiring_soon": days_left is not None and days_left <= 30
        },
        "camera_usage": {
            "used": active_cams,
            "licensed": max_cams
        }
    })

@router.get("/discover-devices", dependencies=[Depends(verify_token)])
async def discover_devices():
    try:
        if not _discovery_in_progress:
            start_background_discovery()
        return {"devices": CACHED_DISCOVERED_DEVICES}
 
    except Exception as e:
        print(f"[DISCOVER] ❌ Discovery error: {e}")
        return {"devices": [], "error": str(e)}
 
 
# ------------------------------------------------------------------
# Camera enable / disable / delete
# ------------------------------------------------------------------

@router.get("/debug/mongo", dependencies=[Depends(verify_token)])
def debug_mongo():
    try:
        mongo_client.server_info()
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

@router.get("/camera-health", dependencies=[Depends(verify_token)])
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


@router.get("/license", dependencies=[Depends(verify_token)])
def get_license(payload: dict = Depends(verify_token)):
    is_admin = payload.get("role") == "admin"
    return license_manager.get_license_info(is_admin=is_admin)

@router.get("/license/info", dependencies=[Depends(verify_token)])
def get_license_info(payload: dict = Depends(verify_token)):
    is_admin = payload.get("role") == "admin"
    return license_manager.get_license_info(is_admin=is_admin)

@router.get("/license/status", dependencies=[Depends(verify_token)])
def get_license_status():
    return {
        "valid": license_manager._check_valid() or (not license_manager.validation_enabled or license_manager.dev_mode),
        "days_remaining": license_manager.get_days_until_expiry(),
        "expiring_soon": license_manager.get_days_until_expiry() is not None and license_manager.get_days_until_expiry() <= 30
    }

@router.post("/license/upload", dependencies=[Depends(require_admin)])
async def upload_license(file: UploadFile = File(...)):
    content = await file.read()
    temp_path = license_manager.license_path + ".tmp"
    backup_path = license_manager.license_path + ".bak"
    
    # Write new license to temp file
    os.makedirs(os.path.dirname(temp_path), exist_ok=True)
    with open(temp_path, "wb") as f:
        f.write(content)
        
    original_path = license_manager.license_path
    try:
        # Swap configuration path to validate the temporary uploaded file
        license_manager.license_path = temp_path
        license_manager.initialize(force_revalidate=True)
        
        # If successfully validated, backup current license and overwrite it
        import shutil
        if os.path.exists(original_path):
            shutil.copy2(original_path, backup_path)
            
        shutil.move(temp_path, original_path)
        license_manager.license_path = original_path
        
        # Finally initialize the manager with the newly moved license
        license_manager.initialize(force_revalidate=True)
        return {"success": True, "message": "License uploaded and activated successfully"}
        
    except Exception as e:
        # Restore the manager state to use the original license path
        license_manager.license_path = original_path
        try:
            license_manager.initialize(force_revalidate=True)
        except Exception:
            pass
            
        # Clean up temp file
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass
                
        raise HTTPException(status_code=400, detail=f"Invalid license upload: {str(e)}")

@router.post("/license/revalidate", dependencies=[Depends(require_admin)])
def revalidate_license():
    try:
        license_manager.initialize(force_revalidate=True)
        return {
            "success": True, 
            "message": "License revalidated successfully", 
            "info": license_manager.get_license_info(is_admin=True)
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
# ------------------------------------------------------------------
# Event Clips — list, play, manual save
# ------------------------------------------------------------------

