import os
import re

base_dir = r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app"
main_file = os.path.join(base_dir, "main.py")

with open(main_file, "r", encoding="utf-8") as f:
    content = f.read()

# dashboard_router.py
dashboard_code = """from fastapi import APIRouter, Depends, Response, HTTPException
import json
from app.core.database import db as _db, analytics_col, watch_collection, cameras_col
from app.core.security import verify_token
from bson import ObjectId
import math
import os
from datetime import datetime, timedelta

router = APIRouter(prefix="/api", tags=["dashboard"])
"""

patterns_dashboard = [
    r"(@app\.get\(\"/api/dashboard/summary\".*?)(?=@app\.get\(\"/api/camera-health\"|@app\.get\(\"/api/cameras\"|$)",
    r"(@app\.get\(\"/api/action-rules\".*?)(?=# @app\.get\(\"/api/camera-models\"|@app\.get\(\"/api/alerts\"|$)",
    r"(@app\.get\(\"/api/alerts\".*?)(?=@app\.get\(\"/api/license\"|$)"
]

for pat in patterns_dashboard:
    m = re.search(pat, content, re.DOTALL)
    if m:
        s = m.group(1).replace("@app.get(\"/api", "@router.get(\"").replace("@app.post(\"/api", "@router.post(\"")
        dashboard_code += "\n" + s

with open(os.path.join(base_dir, "api", "routers", "dashboard_router.py"), "w", encoding="utf-8") as f:
    f.write(dashboard_code)
print("dashboard_router.py created.")

# system_router.py
system_code = """from fastapi import APIRouter, Depends
from app.core.security import verify_token
from app.core.database import mongo_client, db as _db, cameras_col, users_col
from license.license_store import load_license
from license.license_validator import validate_license
from app.managers.stream_manager import devices
from monitoring.stream_health import _stream_stats
import os

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")

router = APIRouter(prefix="/api", tags=["system"])
"""

patterns_system = [
    r"(@app\.get\(\"/health\".*?)(?=@app\.get\(\"/api/cameras\"|$)",
    r"(@app\.get\(\"/api/discover-devices\".*?)(?=@app\.post\(\"/api/cameras/by-ip/\{ip\}/enable\"|$)",
    r"(@app\.get\(\"/api/debug/mongo\".*?)(?=@app\.post\(\"/api/auth/signup\"|$)",
    r"(@app\.get\(\"/api/camera-health\".*?)(?=@app\.get\(\"/api/cameras\"|$)",
    r"(@app\.get\(\"/api/license\".*?)(?=@app\.get\(\"/api/event-clips\"|$)"
]
for pat in patterns_system:
    m = re.search(pat, content, re.DOTALL)
    if m:
        s = m.group(1).replace("@app.get(\"/api", "@router.get(\"").replace("@app.get(\"/health", "@router.get(\"/health")
        system_code += "\n" + s

with open(os.path.join(base_dir, "api", "routers", "system_router.py"), "w", encoding="utf-8") as f:
    f.write(system_code)
print("system_router.py created.")

# camera_router.py
camera_code = """from fastapi import APIRouter, Depends, HTTPException
import json
from app.core.database import cameras_col, db as _db
from app.core.security import verify_token
from app.managers.stream_manager import normalize_stream_name, get_devices_by_ip, devices, save_devices
from app.services.camera.onvif_service import probe_camera, set_imaging_setting, ptz_go_to_preset, ptz_set_preset, ptz_go_home, trigger_relay, move_camera_ptz
from app.services.camera.ome_service import register_stream
from app.services.storage import rtsp_recorder as recorder
from app.schemas.camera import StreamRegisterRequest, StreamAssignRequest, ProbeRequest, ImagingSettingRequest, PTZPresetRequest, PTZSavePresetRequest, PTZMoveRequest, RelayRequest

router = APIRouter(prefix="/api", tags=["cameras"])
features_router = APIRouter(prefix="/api/camera", tags=["camera-features"], dependencies=[Depends(verify_token)])
"""

patterns_camera = [
    r"(@app\.get\(\"/api/cameras\".*?)(?=@app\.post\(\"/api/recordings/decrypt-upload\"|$)",
    r"(@app\.post\(\"/api/cameras/by-ip/.*?(?=@app\.get\(\"/api/devices\"|@app\.get\(\"/api/storage/selection\"|@features_router\.post\(\"/capabilities\"|$))",
    r"(@app\.post\(\"/api/onvif/probe\".*?)(?=@app\.post\(\"/api/streams/register\"|$)",
    r"(@app\.post\(\"/api/streams/register\".*?)(?=@app\.post\(\"/api/streams/assign\"|$)",
    r"(@app\.post\(\"/api/streams/assign\".*?)(?=@app\.get\(\"/api/cameras/by-ip/\{ip\}\"|$)",
    r"(@app\.get\(\"/api/cameras/by-ip/\{ip\}\".*?)(?=@features_router\.post\(\"/capabilities\"|$)",
    r"(@features_router\.post\(\"/capabilities\".*?)(?=@app\.post\(\"/api/devices/\"|$)",
    r"(@app\.post\(\"/api/devices/\".*?)(?=@app\.get\(\"/api/devices\"|$)",
    r"(@app\.get\(\"/api/devices\".*?)(?=@app\.get\(\"/api/cameras/\"|$)",
    r"(@app\.get\(\"/api/cameras/\".*?)(?=@app\.get\(\"/api/storage/selection\"|$)",
    r"(@app\.post\(\"/api/onvif/ptz/move\".*?)(?=@app\.get\(\"/api/dashboard/summary\"|$)"
]
for pat in patterns_camera:
    m = re.search(pat, content, re.DOTALL)
    if m:
        s = m.group(1).replace("@app.get(\"/api", "@router.get(\"").replace("@app.post(\"/api", "@router.post(\"").replace("@app.put(\"/api", "@router.put(\"").replace("@app.delete(\"/api", "@router.delete(\"")
        camera_code += "\n" + s

with open(os.path.join(base_dir, "api", "routers", "camera_router.py"), "w", encoding="utf-8") as f:
    f.write(camera_code)
print("camera_router.py created.")

# Now for storage/recording routes: add to recording_api.py (will just create storage_router_ext.py and we merge later)
storage_code = """from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
import os
import shutil
from app.core.security import verify_token
from app.core.database import db as _db

router = APIRouter(prefix="/api", tags=["storage_ext"])
"""
patterns_storage = [
    r"(@app\.post\(\"/api/recordings/decrypt-upload\".*?)(?=@app\.get\(\"/api/discover-devices\"|$)",
    r"(@app\.get\(\"/api/storage/selection\".*?)(?=@app\.post\(\"/api/storage/selection\"|$)",
    r"(@app\.post\(\"/api/storage/selection\".*?)(?=@app\.post\(\"/api/onvif/ptz/move\"|$)"
]
for pat in patterns_storage:
    m = re.search(pat, content, re.DOTALL)
    if m:
        s = m.group(1).replace("@app.get(\"/api", "@router.get(\"").replace("@app.post(\"/api", "@router.post(\"")
        storage_code += "\n" + s
        
with open(os.path.join(base_dir, "api", "routers", "storage_router_ext.py"), "w", encoding="utf-8") as f:
    f.write(storage_code)
print("storage_router_ext.py created.")

