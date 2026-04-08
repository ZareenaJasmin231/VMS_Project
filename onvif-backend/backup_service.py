from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import asyncio, shutil, os, json
import httpx
from pathlib import Path
from datetime import datetime, timedelta
import rtsp_recorder as recorder

backup_router = APIRouter(prefix="/api/backup", tags=["backup"])
HOST_AGENT = "http://host.docker.internal:9500"

async def _agent(path: str):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{HOST_AGENT}{path}")
    except Exception as e:
        print(f"[BACKUP] Host agent call failed ({path}): {e}")

# ── Paths from environment (set in docker-compose) ────────────────────────────
CONFIG_FILE      = Path(os.environ.get("BACKUP_CONFIG",      "/app/data/backup_config.json"))
HEALTH_LOG       = Path(os.environ.get("BACKUP_HEALTH",      "/app/data/health_log.json"))
NETWORK_BASE_DIR = Path(os.environ.get("BACKUP_NETWORK_DIR", "/network_backup"))
#
# Full backup flow:
#   /recordings  →  copy_file_to_network()  →  /network_backup
#   /network_backup  =  C:\vmsrecording_backup  (Docker volume mount)
#   C:\vmsrecording_backup  →  Robocopy  →  \\10.22.101.30\vmsrecording  (laptop)
#
# NOTE: Docker cannot mount UNC paths directly. Always use a local Windows
#       folder as the staging area and let Robocopy push it to the network.

RECORDING_EXTENSIONS = {".enc", ".meta"}   # actual file types saved by this VMS

backup_state = {
    "status":        "Idle",
    "progress":      0,
    "last_backup":   None,
    "storage_usage": 0,
}
auto_watcher_active  = False
_auto_backup_task: Optional[asyncio.Task] = None

# ── Config helpers ────────────────────────────────────────────────────────────
def load_config() -> dict:
    try:
        if CONFIG_FILE.exists():
            return json.loads(CONFIG_FILE.read_text())
    except Exception as e:
        print(f"[BACKUP] Config load error: {e}")
    return {
        "network":        {"protocol": "SMB", "ip": "", "port": 445,
                           "username": "", "password": "", "path": ""},
        "auto":           {"enabled": False},
        "retention_days": 7,
    }

def save_config(data: dict):
    try:
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(data, indent=2))
    except Exception as e:
        print(f"[BACKUP] Config save error: {e}")

def get_local_path() -> Path:
    return Path(recorder.get_recordings_dir())

def is_network_available() -> bool:
    try:
        return NETWORK_BASE_DIR.exists()
    except Exception:
        return False

def get_storage_usage() -> int:
    try:
        if not is_network_available():
            return 0
        usage = shutil.disk_usage(NETWORK_BASE_DIR)
        return int((usage.used / usage.total) * 100)
    except Exception:
        return 0

def copy_file_to_network(src: Path) -> bool:
    """
    Copy one file from /recordings → /network_backup preserving folder structure.
    Example:
      /recordings/192_168_126_234/2026-04-07/00-17-27.enc
      → /network_backup/192_168_126_234/2026-04-07/00-17-27.enc
      → C:\\vmsrecording_backup\\...  (same path, via Docker volume)
      → Robocopy → \\\\10.22.101.30\\vmsrecording\\...
    """
    try:
        local = get_local_path()
        rel   = src.relative_to(local)
        dest  = NETWORK_BASE_DIR / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        print(f"[BACKUP] ✓ {src.name} → {dest}")
        return True
    except Exception as e:
        print(f"[BACKUP] ✗ Copy failed {src.name}: {e}")
        return False

def tag_health(camera: str, timestamp: str, status: str):
    try:
        log = json.loads(HEALTH_LOG.read_text()) if HEALTH_LOG.exists() else []
        log.append({"camera": camera, "timestamp": timestamp, "status": status})
        HEALTH_LOG.parent.mkdir(parents=True, exist_ok=True)
        HEALTH_LOG.write_text(json.dumps(log[-500:], indent=2))
    except Exception as e:
        print(f"[BACKUP] Health tag error: {e}")

def get_last_healthy(camera: str, before: str) -> Optional[str]:
    try:
        if not HEALTH_LOG.exists():
            return None
        log       = json.loads(HEALTH_LOG.read_text())
        before_dt = datetime.fromisoformat(before)
        healthy   = [
            e for e in log
            if e["camera"] == camera
            and e["status"] == "Healthy"
            and datetime.fromisoformat(e["timestamp"]) <= before_dt
        ]
        return healthy[-1]["timestamp"] if healthy else None
    except Exception as e:
        print(f"[BACKUP] Health lookup error: {e}")
        return None

def append_log(event: str, status: str):
    try:
        log_file = CONFIG_FILE.parent / "backup_activity.json"
        logs = json.loads(log_file.read_text()) if log_file.exists() else []
        logs.insert(0, {
            "id":     len(logs) + 1,
            "time":   datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "event":  event,
            "status": status,
        })
        log_file.write_text(json.dumps(logs[:100], indent=2))
    except Exception as e:
        print(f"[BACKUP] Log write error: {e}")

# ── Pydantic models ───────────────────────────────────────────────────────────
class NetworkConfig(BaseModel):
    protocol: str = "SMB"
    ip:       str = ""
    port:     int = 445
    username: str = ""
    password: str = ""
    path:     str = ""

class ManualBackupRequest(BaseModel):
    cameras:    list[str]
    start_date: str
    end_date:   str
    format:     str = "MP4"

class RetentionRequest(BaseModel):
    retention_days: int = 7

class RestoreRequest(BaseModel):
    cameras:           list[str]
    start_date:        str
    end_date:          str
    use_smart_restore: bool = False

class AutoConfigRequest(BaseModel):
    enabled: bool

# ── Auto-backup: asyncio polling ──────────────────────────────────────────────
async def auto_backup_polling():
    """
    Polls /recordings every 3 seconds for new .enc/.meta files.
    Copies any unseen files to /network_backup (C:\\vmsrecording_backup).
    Robocopy then picks them up and pushes to \\\\10.22.101.30\\vmsrecording.
    """
    print("[AutoBackup] ▶ Polling started")
    seen: set[str] = set()

    while auto_watcher_active:
        try:
            base = get_local_path()
            for file in base.rglob("*"):
                if file.suffix.lower() not in RECORDING_EXTENSIONS:
                    continue
                key = str(file)
                if key in seen:
                    continue
                # Wait until file is fully written (size stable)
                try:
                    size1 = file.stat().st_size
                    await asyncio.sleep(1)
                    size2 = file.stat().st_size
                    if size1 != size2:
                        continue
                except Exception:
                    continue

                print(f"[AutoBackup] New: {file.name}")
                if copy_file_to_network(file):
                    seen.add(key)
                    cam = file.parent.parent.name
                    tag_health(cam, datetime.now().isoformat(), "Healthy")
                    append_log(f"Auto-pushed: {file.name}", "Success")
                else:
                    append_log(f"Auto-push failed: {file.name}", "Error")

        except Exception as e:
            print(f"[AutoBackup] Poll error: {e}")

        await asyncio.sleep(3)

    print("[AutoBackup] ⏹ Polling stopped")


def start_auto_watcher():
    global auto_watcher_active, _auto_backup_task
    if auto_watcher_active:
        return
    if not is_network_available():
        print("[AutoBackup] ✗ /network_backup not accessible. "
              "Ensure C:/vmsrecording_backup:/network_backup is in docker-compose and container restarted.")
        return
    auto_watcher_active = True
    _auto_backup_task = asyncio.create_task(auto_backup_polling())
    asyncio.create_task(_agent("/start"))
    print(f"[AutoBackup] ✓ Watching: {get_local_path()} → {NETWORK_BASE_DIR}")
    
    append_log("Auto backup polling started", "Info")


def stop_auto_watcher():
    global auto_watcher_active, _auto_backup_task
    auto_watcher_active = False
    if _auto_backup_task and not _auto_backup_task.done():
        _auto_backup_task.cancel()
    _auto_backup_task = None
    asyncio.create_task(_agent("/stop"))
    append_log("Auto backup stopped", "Info")


# ── Endpoints ─────────────────────────────────────────────────────────────────

# @backup_router.on_event("startup") if False else None  # placeholder — startup handled in main.py

@backup_router.get("/config")
async def get_config():
    cfg = load_config()
    cfg["local_path"]        = str(get_local_path())
    cfg["network_path"]      = str(NETWORK_BASE_DIR)
    cfg["network_available"] = is_network_available()
    cfg["unc_display"]       = (
        f"\\\\{cfg['network'].get('ip', '')}\\vmsrecording"
        if cfg["network"].get("ip")
        else "\\\\10.22.101.30\\vmsrecording"
    )
    return cfg


@backup_router.post("/network/test")
async def test_network_connection(config: NetworkConfig):
    cfg = load_config()
    cfg["network"] = config.dict()
    save_config(cfg)

    if is_network_available():
        append_log("Connection test passed", "Success")
        return {
            "status":  "success",
            "message": (
                "✅ /network_backup accessible!\n"
                "Flow: D:\\REC → /network_backup (C:\\vmsrecording_backup) "
                "→ Robocopy → \\\\10.22.101.30\\vmsrecording"
            ),
        }
    raise HTTPException(
        status_code=400,
        detail=(
            "❌ /network_backup not accessible inside container. "
            "Make sure docker-compose.yml has: C:/vmsrecording_backup:/network_backup "
            "and run: docker-compose down && docker-compose up -d"
        ),
    )


@backup_router.post("/network/save")
async def save_network_settings(config: NetworkConfig):
    cfg = load_config()
    cfg["network"] = config.dict()
    save_config(cfg)
    if auto_watcher_active:
        stop_auto_watcher()
        start_auto_watcher()
    append_log("Network settings saved", "Info")
    return {
        "status":  "success",
        "message": "Saved. Flow: /network_backup → C:\\vmsrecording_backup → Robocopy → \\\\10.22.101.30\\vmsrecording",
    }


@backup_router.post("/auto/config")
async def update_auto_config(req: AutoConfigRequest):
    if req.enabled and not is_network_available():
        raise HTTPException(
            status_code=400,
            detail="❌ /network_backup not accessible. Check C:/vmsrecording_backup volume in docker-compose.",
        )
    cfg = load_config()
    cfg["auto"]["enabled"] = req.enabled
    save_config(cfg)
    if req.enabled:
        start_auto_watcher()
    else:
        stop_auto_watcher()
    return {
        "status":  "success",
        "message": f"Auto backup {'enabled ✅' if req.enabled else 'disabled ⏹'}.",
    }


# ── Manual backup ─────────────────────────────────────────────────────────────
async def run_manual_backup(req: ManualBackupRequest):
    global backup_state
    backup_state.update({"status": "Processing", "progress": 0})
    append_log(f"Manual backup started — {len(req.cameras)} camera(s)", "Info")
    try:
        local    = get_local_path()
        start_dt = datetime.strptime(req.start_date, "%Y-%m-%d")
        end_dt   = datetime.strptime(req.end_date,   "%Y-%m-%d") + timedelta(days=1)

        all_files: list[Path] = []
        for camera in req.cameras:
            cam_ip_norm = camera.replace(".", "_")
            for cam_dir in local.iterdir():
                if not cam_dir.is_dir() or cam_ip_norm not in cam_dir.name:
                    continue
                for ext in ["enc", "meta", "mp4"]:
                    for f in cam_dir.rglob(f"*.{ext}"):
                        mtime = datetime.fromtimestamp(f.stat().st_mtime)
                        if start_dt <= mtime <= end_dt:
                            all_files.append(f)

        total = len(all_files)
        if total == 0:
            backup_state.update({"status": "Completed", "progress": 100})
            append_log("Manual backup done — no files in date range", "Warning")
            return

        copied = 0
        for i, f in enumerate(all_files):
            if copy_file_to_network(f):
                copied += 1
            backup_state["progress"] = int(((i + 1) / total) * 100)
            await asyncio.sleep(0.02)

        backup_state.update({
            "status":      "Completed",
            "last_backup": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        })
        append_log(f"Manual backup done — {copied}/{total} copied", "Success")

    except Exception as e:
        backup_state["status"] = "Failed"
        append_log(f"Manual backup failed: {e}", "Error")
        print(f"[BACKUP] Manual error: {e}")


@backup_router.post("/manual/start")
async def start_manual_backup(req: ManualBackupRequest, background_tasks: BackgroundTasks):
    if backup_state["status"] == "Processing":
        raise HTTPException(status_code=400, detail="A backup is already running.")
    if not is_network_available():
        raise HTTPException(status_code=400, detail="Network storage not accessible.")
    background_tasks.add_task(run_manual_backup, req)
    return {"status": "success", "message": "Manual backup started."}


# ── Retention ─────────────────────────────────────────────────────────────────
@backup_router.get("/retention/preview")
async def preview_retention(days: int = 7):
    cutoff = datetime.now() - timedelta(days=days)
    local  = get_local_path()
    files  = []
    try:
        for pattern in ["*.enc", "*.meta", "*.mp4"]:
            for f in local.rglob(pattern):
                mtime = datetime.fromtimestamp(f.stat().st_mtime)
                if mtime < cutoff:
                    parts  = f.parts
                    camera = parts[-3] if len(parts) >= 3 else "unknown"
                    files.append({
                        "file":     f.name,
                        "camera":   camera,
                        "modified": mtime.strftime("%Y-%m-%d %H:%M"),
                    })
    except Exception as e:
        print(f"[BACKUP] Preview error: {e}")
    return {"count": len(files), "files": files[:20]}


@backup_router.post("/retention/enforce")
async def enforce_retention(req: RetentionRequest):
    if not is_network_available():
        raise HTTPException(status_code=400, detail="Network storage not accessible.")
    cutoff        = datetime.now() - timedelta(days=req.retention_days)
    local         = get_local_path()
    moved, failed = 0, 0
    try:
        for pattern in ["*.enc", "*.meta", "*.mp4"]:
            for f in local.rglob(pattern):
                if datetime.fromtimestamp(f.stat().st_mtime) < cutoff:
                    if copy_file_to_network(f):
                        f.unlink()
                        moved += 1
                    else:
                        failed += 1
    except Exception as e:
        print(f"[BACKUP] Retention error: {e}")

    cfg = load_config()
    cfg["retention_days"] = req.retention_days
    save_config(cfg)
    append_log(
        f"Retention ({req.retention_days}d) — moved {moved}, failed {failed}",
        "Success" if failed == 0 else "Warning",
    )
    return {
        "status":  "success",
        "moved":   moved,
        "failed":  failed,
        "message": f"Moved {moved} file(s) older than {req.retention_days} days to network.",
    }


# ── Restore ───────────────────────────────────────────────────────────────────
async def run_restore(req: RestoreRequest):
    global backup_state
    backup_state.update({"status": "Processing", "progress": 0})
    append_log(f"Restore started — {len(req.cameras)} camera(s)", "Info")
    try:
        net      = NETWORK_BASE_DIR
        local    = get_local_path()
        start_dt = datetime.strptime(req.start_date, "%Y-%m-%d")
        end_dt   = datetime.strptime(req.end_date,   "%Y-%m-%d") + timedelta(days=1)

        if req.use_smart_restore and req.cameras:
            smart_end = get_last_healthy(req.cameras[0], end_dt.isoformat())
            if smart_end:
                end_dt = datetime.fromisoformat(smart_end)
                append_log(f"Smart restore point: {smart_end}", "Info")

        all_files: list[Path] = []
        for camera in req.cameras:
            cam_ip_norm = camera.replace(".", "_")
            for cam_dir in net.iterdir():
                if not cam_dir.is_dir() or cam_ip_norm not in cam_dir.name:
                    continue
                for f in (
                    list(cam_dir.rglob("*.enc"))
                    + list(cam_dir.rglob("*.meta"))
                    + list(cam_dir.rglob("*.mp4"))
                ):
                    mtime = datetime.fromtimestamp(f.stat().st_mtime)
                    if start_dt <= mtime <= end_dt:
                        all_files.append(f)

        total = len(all_files)
        if total == 0:
            backup_state.update({"status": "Completed", "progress": 100})
            append_log("Restore done — no files found", "Warning")
            return

        for i, f in enumerate(all_files):
            try:
                rel  = f.relative_to(net)
                dest = local / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, dest)
            except Exception as e:
                print(f"[BACKUP] Restore copy error: {e}")
            backup_state["progress"] = int(((i + 1) / total) * 100)
            await asyncio.sleep(0.02)

        backup_state.update({
            "status":      "Completed",
            "last_backup": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        })
        append_log(f"Restore done — {total} file(s) restored", "Success")

    except Exception as e:
        backup_state["status"] = "Failed"
        append_log(f"Restore failed: {e}", "Error")
        print(f"[BACKUP] Restore error: {e}")


@backup_router.post("/restore/start")
async def start_restore(req: RestoreRequest, background_tasks: BackgroundTasks):
    if backup_state["status"] == "Processing":
        raise HTTPException(status_code=400, detail="A task is already running.")
    if not is_network_available():
        raise HTTPException(status_code=400, detail="Network storage not accessible.")
    background_tasks.add_task(run_restore, req)
    return {"status": "success", "message": "Restore started."}


@backup_router.get("/restore/smart-preview")
async def smart_restore_preview(camera: str, end_date: str):
    last_healthy = get_last_healthy(camera, end_date + "T23:59:59")
    return {
        "camera":                    camera,
        "requested_end":             end_date,
        "recommended_restore_point": last_healthy,
        "reason": (
            "Last confirmed healthy recording before instability or crash"
            if last_healthy else
            "No healthy tags found — full date range will be used"
        ),
    }


@backup_router.post("/health/tag")
async def tag_recording_health(camera: str, timestamp: str, status: str):
    if status not in ("Healthy", "Unstable", "Crashed"):
        raise HTTPException(status_code=400, detail="status must be: Healthy, Unstable, or Crashed")
    tag_health(camera, timestamp, status)
    return {"status": "success"}


@backup_router.get("/status")
async def get_backup_status():
    backup_state["storage_usage"]     = get_storage_usage()
    backup_state["local_path"]        = str(get_local_path())
    backup_state["network_path"]      = str(NETWORK_BASE_DIR)
    backup_state["network_available"] = is_network_available()
    backup_state["auto_active"]       = auto_watcher_active
    return backup_state


@backup_router.get("/logs")
async def get_backup_logs():
    try:
        log_file = CONFIG_FILE.parent / "backup_activity.json"
        if log_file.exists():
            return json.loads(log_file.read_text())
    except Exception as e:
        print(f"[BACKUP] Log read error: {e}")
    return [{"id": 1, "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
             "event": "Backup service ready", "status": "Info"}]