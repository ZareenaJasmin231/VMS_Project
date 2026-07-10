import os
# Disable OpenCV OpenCL globally to prevent Intel igdfcl64.dll crashes
os.environ["OPENCV_OPENCL_RUNTIME"] = "disabled"
os.environ["OPENCV_OPENCL_DEVICE"] = "disabled"

try:
    import cv2
    cv2.ocl.setUseOpenCL(False)
except ImportError:
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import sys

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

from app.utils.terminal_logger import log_terminal

# Import lifecycle
from app.core.lifecycle import lifespan

# Import all routers
from app.api.routers.auth_router import router as auth_router
from app.api.routers.playback_router import router as playback_router
from app.api.routers.camera_router import router as camera_router, features_router
from app.api.routers.dashboard_router import router as dashboard_router
from app.api.routers.system_router import router as system_router
from app.api.routers.storage_router_ext import router as storage_router_ext
from app.api.routers.dashboard_diagnostics_router import router as dashboard_diagnostics_router
# Existing routers from other files that were already separate
from app.api.routers.recording_api import recording_router, storage_router
from app.api.routers.masks_router import router as masks_router
from recorder.backup_service import backup_router
from app.api.routers.logs_router import router as logs_router
from app.api.routers.brand_control import brand_router
from monitoring.router import router as infrastructure_router
from app.api.routers.camera_analytics_router import camera_analytics_router
from app.api.routers.maps_router import router as maps_router
from app.api.routers.designer_router import router as designer_router
# from app.api.routers.forensic_api import forensic_router
from app.api.routers.viewing_stations_router import router as viewing_stations_router

class LoggerWrapper:
    def write(self, message):
        msg = message.strip()
        if msg and ("[WATCHDOG]" in msg or "[ENCRYPT]" in msg or "[RTSP]" in msg or "ERROR" in msg or "❌" in msg):
            log_terminal("admin@gmail.com", "admin", "system log", "backend", 0, msg)
        sys.__stdout__.write(message)

    def flush(self):
        pass

sys.stdout = LoggerWrapper()

app = FastAPI(title="MIRADOR ONVIF Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

faces_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "faces")
os.makedirs(faces_dir, exist_ok=True)
app.mount("/api/faces", StaticFiles(directory=faces_dir), name="faces")

# Register all routers
app.include_router(auth_router)
app.include_router(playback_router)
app.include_router(camera_router)
app.include_router(features_router)
app.include_router(dashboard_router)
app.include_router(system_router)
app.include_router(storage_router_ext)
app.include_router(dashboard_diagnostics_router)

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
# app.include_router(forensic_router)
app.include_router(viewing_stations_router)
