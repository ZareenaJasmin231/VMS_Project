from fastapi import APIRouter, Depends, HTTPException
from app.core.security import verify_token
import json
import asyncio
from urllib.parse import urlparse
from pydantic import BaseModel
from typing import Optional
from app.core.database import mongo_client, db as _db, cameras_col, users_col
from app.managers.stream_manager import devices

import os

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")

router = APIRouter(prefix="/api", tags=["system"])

@router.get("/health")
def health():
    import os
    from monitoring.scheduler import scheduler
    watchdog_active = scheduler.thread.is_alive() if scheduler.thread else False
    return {
        "status": "ok",
        "version": os.environ.get("APP_VERSION", "1.0.0"),
        "watchdog": "Active" if watchdog_active else "Inactive"
    }



@router.get("/discover-devices", dependencies=[Depends(verify_token)])
async def discover_devices():
    try:
        from app.services.camera.discovery_service import discover_all
        print("[DISCOVER] Starting network discovery...")
        found = await asyncio.to_thread(discover_all, 4, 150)
        print(f"[DISCOVER] Found {len(found)} device(s)")
 
        for device in found:
            rtsp_url = device.get("rtsp_url")
            ip       = device.get("ip")

            if not rtsp_url:
                print(f"[DISCOVER] ⏭ {ip} — no RTSP URL found, skipping OME")
                device["ws_url"]        = None
                device["stream_key"]    = None
                device["stream_status"] = "credentials_required"
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
def get_license():
    return {
        "status":      "ok",
        "max_cameras": 9999,
    }
# ------------------------------------------------------------------
# Event Clips — list, play, manual save
# ------------------------------------------------------------------

