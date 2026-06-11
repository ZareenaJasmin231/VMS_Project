import os
import json
import re
import asyncio
import requests as http_requests
from app.core.database import cameras_col
from license.license_store import load_license
from license.license_validator import validate_license
from app.services.camera.ome_service import register_stream
from app.services.storage import rtsp_recorder as recorder

DEVICES_FILE  = os.environ.get("DEVICES_FILE", os.path.join(os.path.dirname(__file__), "..", "..", "devices_data", "devices.json"))
OME_API       = os.environ.get("OME_URL", "http://ome:8081/v1/vhosts/default/apps/app/streams")
OME_AUTH      = "Basic bXl2bXNhY2Nlc3N0b2tlbg=="
WATCHDOG_INTERVAL      = 5
WATCHDOG_MAX_RETRIES   = 20
WATCHDOG_BACKOFF_RESET = 10

_watchdog_failures = {}
_watchdog_cycle = 0

def normalize_stream_name(ip: str, suffix: str = None) -> str:
    base = ip.strip().replace(".", "_")
    if suffix:
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
    current_count = cameras_col.count_documents({"enabled": True})

    print("CURRENT:", current_count)
    print("MAX:", license_data["max_cameras"])

    if not existing and current_count >= license_data["max_cameras"]:
        print("❌ Camera limit reached (new camera blocked)")
        return False
 
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
                unique_cams = {}
                for d in docs:
                    stream_id = d.get("ome_stream") or normalize_stream_name(d.get("ip", "unknown"))
                    if not stream_id: continue
                    
                    if stream_id not in unique_cams:
                        unique_cams[stream_id] = d
                    else:
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
                    "motion_only":          d.get("motion_only", False),
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

# Global list of devices
devices = load_devices()

def get_devices_by_ip(ip: str) -> list:
    return [d for d in devices if d.get("ip") == ip]

async def stream_watchdog():
    global _watchdog_cycle, _watchdog_failures, devices
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
