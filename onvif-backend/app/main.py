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
from recorder.segment_receiver import segment_router, recover_on_startup
from recorder.backup_service import backup_router
from app.api.routers.logs_router import router as logs_router
from app.api.routers.brand_control import brand_router
from monitoring.router import router as infrastructure_router
from app.api.routers.camera_analytics_router import camera_analytics_router
from app.api.routers.maps_router import router as maps_router
from app.api.routers.designer_router import router as designer_router
# from app.api.routers.forensic_api import forensic_router
from app.api.routers.viewing_stations_router import router as viewing_stations_router
from app.api.routers.monitoring_api import router as monitoring_api_router
from app.api.routers.reports_router import router as reports_router
from app.api.routers.ai_alerts_router import router as ai_alerts_router, reader_router
from app.api.storage.router import router as storage_management_router
from app.api.routers.events_ws_router import router as events_ws_router
import threading
import queue

class LoggerWrapper:
    _local = threading.local()
    _queue = queue.Queue()
    _worker_started = False
    _lock = threading.Lock()

    @classmethod
    def _worker(cls):
        while True:
            try:
                msg = cls._queue.get()
                if msg is None:
                    break
                log_terminal("admin@gmail.com", "admin", "system log", "backend", 0, msg)
                cls._queue.task_done()
            except Exception:
                pass

    def write(self, message):
        if getattr(self._local, "in_write", False):
            try:
                sys.__stdout__.write(message)
            except UnicodeEncodeError:
                enc = getattr(sys.__stdout__, 'encoding', 'utf-8') or 'utf-8'
                sys.__stdout__.write(message.encode(enc, errors='replace').decode(enc))
            return
        
        self._local.in_write = True
        try:
            msg = message.strip()
            if msg and ("[WATCHDOG]" in msg or "[ENCRYPT]" in msg or "[RTSP]" in msg or "ERROR" in msg or "❌" in msg):
                if not LoggerWrapper._worker_started:
                    with LoggerWrapper._lock:
                        if not LoggerWrapper._worker_started:
                            t = threading.Thread(target=LoggerWrapper._worker, daemon=True, name="bg-logger-worker")
                            t.start()
                            LoggerWrapper._worker_started = True
                LoggerWrapper._queue.put(msg)
        except Exception:
            pass
        finally:
            self._local.in_write = False

        try:
            sys.__stdout__.write(message)
        except UnicodeEncodeError:
            enc = getattr(sys.__stdout__, 'encoding', 'utf-8') or 'utf-8'
            sys.__stdout__.write(message.encode(enc, errors='replace').decode(enc))

    def isatty(self):
        return getattr(sys.__stdout__, "isatty", lambda: False)()

    def fileno(self):
        return getattr(sys.__stdout__, "fileno", lambda: 1)()

    @property
    def encoding(self):
        return getattr(sys.__stdout__, "encoding", "utf-8") or "utf-8"

    @property
    def errors(self):
        return getattr(sys.__stdout__, "errors", "replace") or "replace"

sys.stdout = LoggerWrapper()

app = FastAPI(title="MIRADOR ONVIF Backend", lifespan=lifespan)

@app.on_event("startup")
async def _startup_segment_recovery():
    print("[STARTUP] Running segment receiver recovery...")
    await recover_on_startup()

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

# Persistent snapshots dir (snapshots captured at alert time)
snapshots_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "snapshots")
os.makedirs(snapshots_dir, exist_ok=True)
app.mount("/api/snapshots", StaticFiles(directory=snapshots_dir), name="snapshots")


# Register all routers
from app.api.routers.groups_router import router as groups_router
app.include_router(events_ws_router)
app.include_router(auth_router)
app.include_router(playback_router)
app.include_router(camera_router)
app.include_router(features_router)
app.include_router(dashboard_router)
app.include_router(system_router)
app.include_router(storage_router_ext)
app.include_router(dashboard_diagnostics_router)
app.include_router(groups_router)

app.include_router(segment_router)
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
app.include_router(monitoring_api_router)
app.include_router(reports_router)
app.include_router(ai_alerts_router)
app.include_router(reader_router)
app.include_router(storage_management_router)
