from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from jwt_auth import verify_token
from pydantic import BaseModel
from typing import Optional
import asyncio, shutil, os, json
import httpx
from pathlib import Path
from datetime import datetime, timedelta
import rtsp_recorder as recorder

backup_router = APIRouter(prefix="/api/backup", tags=["backup"], dependencies=[Depends(verify_token)])
HOST_AGENT = "http://host.docker.internal:9500"

async def _agent(path: str):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{HOST_AGENT}{path}")
    except Exception as e:
        print(f"[BACKUP] Host agent call failed ({path}): {e}")

# ── Paths from environment ────────────────────────────────────────────────────
CONFIG_FILE      = Path(os.environ.get("BACKUP_CONFIG",      "/app/data/backup_config.json"))
HEALTH_LOG       = Path(os.environ.get("BACKUP_HEALTH",      "/app/data/health_log.json"))
NETWORK_BASE_DIR = Path(os.environ.get("BACKUP_NETWORK_DIR", "/network_backup"))

# Only .enc and .meta — these are the actual recording files
RECORDING_EXTENSIONS = {".enc", ".meta"}

backup_state = {
    "status":        "Idle",
    "progress":      0,
    "last_backup":   None,
    "storage_usage": 0,
}
auto_watcher_active   = False
_auto_backup_task: Optional[asyncio.Task] = None
_auto_retention_task: Optional[asyncio.Task] = None

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
        "retention_enabled": False,
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

def copy_file_to_dest(src: Path, dest_base: Path, local_base: Path) -> bool:
    """
    Copy src file to dest_base, preserving folder structure relative to local_base.
    e.g. /recordings/192_168_1_101/2026-04-07/00-17-27.enc
         → <dest_base>/192_168_1_101/2026-04-07/00-17-27.enc
    """
    try:
        rel  = src.relative_to(local_base)
        dest = dest_base / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        print(f"[BACKUP] ✓ {rel} → {dest_base}")
        return True
    except Exception as e:
        print(f"[BACKUP] ✗ Copy failed {src.name}: {e}")
        return False

def copy_file_to_network(src: Path) -> bool:
    """Auto-backup helper — always copies to NETWORK_BASE_DIR."""
    return copy_file_to_dest(src, NETWORK_BASE_DIR, get_local_path())

def collect_files_in_range(
    base_dir: Path,
    cam_ip_norm: str,
    start_dt: "datetime.date",
    end_dt: "datetime.date",
) -> list:
    """
    Walk base_dir/<cam_folder>/<YYYY-MM-DD>/ and collect .enc/.meta files
    whose DATE FOLDER name falls within [start_dt, end_dt].
    Uses folder name for date — NOT mtime (mtime is unreliable in Docker volumes).
    """
    files = []
    try:
        for cam_dir in base_dir.iterdir():
            if not cam_dir.is_dir():
                continue
            if cam_ip_norm not in cam_dir.name:
                continue
            for date_dir in cam_dir.iterdir():
                if not date_dir.is_dir():
                    continue
                try:
                    folder_date = datetime.strptime(date_dir.name, "%Y-%m-%d").date()
                except ValueError:
                    continue  # not a date folder, skip
                if not (start_dt <= folder_date <= end_dt):
                    continue
                for f in date_dir.iterdir():
                    if f.is_file() and f.suffix.lower() in RECORDING_EXTENSIONS:
                        files.append(f)
    except Exception as e:
        print(f"[BACKUP] collect_files error: {e}")
    return files

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
    cameras:          list[str]
    start_date:       str
    end_date:         str
    format:           str = "ENC"
    destination_path: str = ""   # D:\, C:\, Z:\, custom path — empty = NETWORK_BASE_DIR

class CameraRetentionItem(BaseModel):
    ip: str
    days: int

class RetentionRequest(BaseModel):
    retention_days: Optional[int] = 7
    camera_configs: Optional[list[CameraRetentionItem]] = None
    retention_enabled: Optional[bool] = None

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
    Polls /recordings every 3 s for new .enc/.meta files.
    Copies any unseen (size-stable) files to NETWORK_BASE_DIR.
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
                # Wait until write is complete (size stable over 1 s)
                try:
                    size1 = file.stat().st_size
                    await asyncio.sleep(1)
                    size2 = file.stat().st_size
                    if size1 != size2:
                        continue
                except Exception:
                    continue

                print(f"[AutoBackup] New file: {file.name}")
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


async def auto_retention_polling():
    """
    Background worker that runs a retention sweep every 60 seconds.
    Reads current camera and group retention settings from backup_config.json.
    """
    print("[AutoRetention] ▶ Automatic retention service active")
    while auto_watcher_active:
        try:
            cfg = load_config()
            if not cfg.get("retention_enabled", False):
                await asyncio.sleep(5)
                continue

            if is_network_available():
                retention_days = cfg.get("retention_days", 7)
                camera_configs = cfg.get("camera_configs", [])

                camera_map = {}
                for item in camera_configs:
                    norm_ip = item.get("ip", "").replace(".", "_")
                    if norm_ip:
                        camera_map[norm_ip] = item.get("days", retention_days)

                local = get_local_path()
                moved, failed = 0, 0

                for f in local.rglob("*"):
                    if not f.is_file() or f.suffix.lower() not in RECORDING_EXTENSIONS:
                        continue
                    
                    parts = f.parts
                    camera_folder = parts[-3] if len(parts) >= 3 else "unknown"

                    days = retention_days
                    if camera_folder in camera_map:
                        days = camera_map[camera_folder]
                    elif camera_folder != "unknown":
                        for norm_ip, c_days in camera_map.items():
                            if norm_ip in camera_folder:
                                days = c_days
                                break

                    cutoff = datetime.now() - timedelta(minutes=days)
                    if datetime.fromtimestamp(f.stat().st_mtime) < cutoff:
                        # Safety pre-check: Is the file already backed up on network?
                        backed_up = False
                        try:
                            rel = f.relative_to(local)
                            dest = NETWORK_BASE_DIR / rel
                            backed_up = dest.is_file()
                        except Exception:
                            pass

                        if backed_up:
                            f.unlink()
                            moved += 1
                        else:
                            # Not in backup yet. Try to back it up first, and only delete if successful!
                            if copy_file_to_network(f):
                                f.unlink()
                                moved += 1
                            else:
                                failed += 1

                if moved > 0:
                    print(f"[AutoRetention] Swept and archived {moved} expired recording(s) locally.")
                    append_log(
                        f"Auto-Retention (Sweep) — automatically archived and purged {moved} expired file(s) locally.",
                        "Success" if failed == 0 else "Warning"
                    )
        except Exception as e:
            print(f"[AutoRetention] Automated retention loop error: {e}")

        # Sleep for 60 seconds between sweeps with high-responsiveness interrupt
        for _ in range(60):
            if not auto_watcher_active:
                break
            if not load_config().get("retention_enabled", False):
                break
            await asyncio.sleep(1)

    print("[AutoRetention] ⏹ Automatic retention service stopped")


def start_auto_watcher():
    global auto_watcher_active, _auto_backup_task, _auto_retention_task
    if auto_watcher_active:
        return
    if not is_network_available():
        print("[AutoBackup] ✗ /network_backup not accessible.")
        return
    auto_watcher_active = True
    _auto_backup_task = asyncio.create_task(auto_backup_polling())
    _auto_retention_task = asyncio.create_task(auto_retention_polling())
    asyncio.create_task(_agent("/start"))
    print(f"[AutoBackup] ✓ Watching: {get_local_path()} → {NETWORK_BASE_DIR}")
    append_log("Auto backup & retention polling started", "Info")


def stop_auto_watcher():
    global auto_watcher_active, _auto_backup_task, _auto_retention_task
    auto_watcher_active = False
    if _auto_backup_task and not _auto_backup_task.done():
        _auto_backup_task.cancel()
    if _auto_retention_task and not _auto_retention_task.done():
        _auto_retention_task.cancel()
    _auto_backup_task = None
    _auto_retention_task = None
    asyncio.create_task(_agent("/stop"))
    append_log("Auto backup stopped", "Info")


# ── Endpoints ─────────────────────────────────────────────────────────────────
@backup_router.get("/config")
async def get_config():
    cfg = load_config()
    cfg["local_path"]        = str(get_local_path())
    cfg["network_path"]      = str(NETWORK_BASE_DIR)
    cfg["network_available"] = is_network_available()
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
                "✅ /network_backup accessible! "
                "Flow: /recordings → /network_backup (C:\\vmsrecording_backup) "
                "→ Robocopy → laptop share"
            ),
        }
    raise HTTPException(
        status_code=400,
        detail=(
            "❌ /network_backup not accessible inside container. "
            "Check docker-compose volume: C:/vmsrecording_backup:/network_backup "
            "then run: docker-compose down && docker-compose up -d"
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
        "message": "Network settings saved.",
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
def windows_path_to_container(windows_path: str) -> Path:
    """
    Convert a Windows path selected in the UI → container mount path.
    
    Examples:
      D:\\Backup        → /mnt/dest_d/Backup
      D:\\              → /mnt/dest_d
      E:\\MyUSB\\clips  → /mnt/dest_e/MyUSB/clips
      C:\\Backup        → /mnt/dest_c/Backup
      Z:\\              → /network_backup  (already mounted)
    """
    stripped = windows_path.strip()

    # Not a Windows path — return as-is (already a Linux path)
    if len(stripped) < 2 or stripped[1] != ':':
        return Path(stripped) if stripped else NETWORK_BASE_DIR

    drive_letter = stripped[0].lower()          # "d"
    rest         = stripped[2:].lstrip("\\/")   # "Backup" or "" or "MyUSB\\clips"
    rest_linux   = rest.replace("\\", "/")      # "Backup" or "" or "MyUSB/clips"

    # Z: is already the network_backup mount
    if drive_letter == 'z':
        return NETWORK_BASE_DIR / rest_linux if rest_linux else NETWORK_BASE_DIR

    container_root = Path(f"/mnt/dest_{drive_letter}")
    return container_root / rest_linux if rest_linux else container_root

# ── Manual backup ─────────────────────────────────────────────────────────────
async def run_manual_backup(req: ManualBackupRequest):
    global backup_state
    backup_state.update({"status": "Processing", "progress": 0})

    # Resolve destination
    dest_base = windows_path_to_container(req.destination_path) if req.destination_path.strip() else NETWORK_BASE_DIR
    append_log(
        f"Manual backup started — {len(req.cameras)} camera(s), "
        f"{req.start_date} → {req.end_date}, dest: {dest_base}",
        "Info"
    )

    try:
        local    = get_local_path()
        start_dt = datetime.strptime(req.start_date, "%Y-%m-%d").date()
        end_dt   = datetime.strptime(req.end_date,   "%Y-%m-%d").date()

        # Create destination
        try:
            dest_base.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            backup_state["status"] = "Failed"
            append_log(f"Cannot create destination {dest_base}: {e}", "Error")
            return

        # Verify source exists
        if not local.exists():
            backup_state["status"] = "Failed"
            append_log(f"Source recordings folder not found: {local}", "Error")
            return

        print(f"[BACKUP] Source: {local}")
        print(f"[BACKUP] Destination: {dest_base}")
        print(f"[BACKUP] Date range: {start_dt} → {end_dt}")
        print(f"[BACKUP] Cameras: {req.cameras}")

        # Collect all matching .enc and .meta files
        all_files: list[Path] = []
        for camera in req.cameras:
            cam_ip_norm = camera.replace(".", "_")
            print(f"[BACKUP] Looking for camera folder matching: {cam_ip_norm}")
            found = collect_files_in_range(local, cam_ip_norm, start_dt, end_dt)
            print(f"[BACKUP] Found {len(found)} files for camera {camera}")
            all_files.extend(found)

        total = len(all_files)
        chunks = total // 2  # each recording = 1 .enc + 1 .meta
        print(f"[BACKUP] Total: {total} files ({chunks} recording chunks) to copy → {dest_base}")

        if total == 0:
            backup_state.update({"status": "Completed", "progress": 100})
            append_log(
                f"Manual backup: no .enc/.meta files found for {req.cameras} "
                f"between {req.start_date} and {req.end_date}. "
                f"Check that recordings exist in {local}",
                "Warning"
            )
            return

        copied = 0
        failed = 0
        for i, f in enumerate(all_files):
            try:
                rel  = f.relative_to(local)
                dest = dest_base / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, dest)
                copied += 1
                print(f"[BACKUP] ✓ ({i+1}/{total}) {rel}")
            except Exception as e:
                failed += 1
                print(f"[BACKUP] ✗ ({i+1}/{total}) {f.name}: {e}")

            backup_state["progress"] = int(((i + 1) / total) * 100)
            await asyncio.sleep(0.01)

        backup_state.update({
            "status":      "Completed",
            "progress":    100,
            "last_backup": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        })
        append_log(
            f"Manual backup done — {copied}/{total} files ({copied//2} chunks) "
            f"copied to {dest_base}, {failed} failed",
            "Success" if failed == 0 else "Warning"
        )

    except Exception as e:
        backup_state["status"] = "Failed"
        append_log(f"Manual backup failed: {e}", "Error")
        print(f"[BACKUP] Manual error: {e}")


@backup_router.post("/manual/start")
async def start_manual_backup(req: ManualBackupRequest, background_tasks: BackgroundTasks):
    if backup_state["status"] == "Processing":
        raise HTTPException(status_code=400, detail="A backup is already running.")

    # If destination is the default network mount, check it's accessible
    dest = req.destination_path.strip()
    if not dest and not is_network_available():
        raise HTTPException(
            status_code=400,
            detail="Network storage not accessible. Set a destination path or fix the network mount."
        )

    background_tasks.add_task(run_manual_backup, req)
    dest_display = dest if dest else str(NETWORK_BASE_DIR)
    return {"status": "success", "message": f"Manual backup started → {dest_display}"}


# ── Retention ─────────────────────────────────────────────────────────────────
@backup_router.get("/retention/preview")
async def preview_retention(days: int = 7):
    cutoff = datetime.now() - timedelta(minutes=days)
    local  = get_local_path()
    files  = []
    try:
        for f in local.rglob("*"):
            if not f.is_file() or f.suffix.lower() not in RECORDING_EXTENSIONS:
                continue
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


@backup_router.post("/retention/preview")
async def preview_retention_post(req: RetentionRequest):
    camera_map = {}
    if req.camera_configs:
        for item in req.camera_configs:
            norm_ip = item.ip.replace(".", "_")
            camera_map[norm_ip] = item.days

    local = get_local_path()
    files = []
    missing_in_backup_count = 0
    missing_files = []
    try:
        for f in local.rglob("*"):
            if not f.is_file() or f.suffix.lower() not in RECORDING_EXTENSIONS:
                continue
            
            parts = f.parts
            camera_folder = parts[-3] if len(parts) >= 3 else "unknown"
            
            days = req.retention_days
            if camera_folder in camera_map:
                days = camera_map[camera_folder]
            elif camera_folder != "unknown":
                for norm_ip, c_days in camera_map.items():
                    if norm_ip in camera_folder:
                        days = c_days
                        break
            
            cutoff = datetime.now() - timedelta(minutes=days)
            mtime = datetime.fromtimestamp(f.stat().st_mtime)
            if mtime < cutoff:
                # Check if it exists in the network backup
                backed_up = False
                try:
                    rel = f.relative_to(local)
                    dest = NETWORK_BASE_DIR / rel
                    backed_up = dest.is_file()
                except Exception:
                    pass

                files.append({
                    "file":     f.name,
                    "camera":   camera_folder,
                    "modified": mtime.strftime("%Y-%m-%d %H:%M"),
                    "backed_up": backed_up
                })
                if not backed_up:
                    missing_in_backup_count += 1
                    missing_files.append(f"{camera_folder}/{f.name}")
    except Exception as e:
        print(f"[BACKUP] Preview error: {e}")
    return {
        "count": len(files),
        "files": files[:20],
        "missing_in_backup_count": missing_in_backup_count,
        "missing_files": missing_files[:10]
    }


@backup_router.post("/retention/enforce")
async def enforce_retention(req: RetentionRequest):
    if not is_network_available():
        raise HTTPException(status_code=400, detail="Network storage not accessible.")
    
    camera_map = {}
    if req.camera_configs:
        for item in req.camera_configs:
            norm_ip = item.ip.replace(".", "_")
            camera_map[norm_ip] = item.days

    local = get_local_path()
    expired_files = []
    missing_files = []
    
    try:
        for f in local.rglob("*"):
            if not f.is_file() or f.suffix.lower() not in RECORDING_EXTENSIONS:
                continue
            
            parts = f.parts
            camera_folder = parts[-3] if len(parts) >= 3 else "unknown"
            
            days = req.retention_days
            if camera_folder in camera_map:
                days = camera_map[camera_folder]
            elif camera_folder != "unknown":
                for norm_ip, c_days in camera_map.items():
                    if norm_ip in camera_folder:
                        days = c_days
                        break

            cutoff = datetime.now() - timedelta(minutes=days)
            if datetime.fromtimestamp(f.stat().st_mtime) < cutoff:
                # Check if it exists in the network backup
                backed_up = False
                try:
                    rel = f.relative_to(local)
                    dest = NETWORK_BASE_DIR / rel
                    backed_up = dest.is_file()
                except Exception:
                    pass
                
                expired_files.append(f)
                if not backed_up:
                    missing_files.append(f"{camera_folder}/{f.name}")
    except Exception as e:
        print(f"[BACKUP] Scan error: {e}")

    # Safety Halt: If any expired files are NOT stored in the backup, cancel retention!
    if missing_files:
        append_log(
            f"Retention halted — {len(missing_files)} file(s) are missing from network backup.",
            "Error"
        )
        return {
            "status": "error",
            "error_type": "missing_backups",
            "message": "Retention cannot happen as some files are not stored in the backup.",
            "missing_files": missing_files[:10]
        }

    # Second Pass: Safely purge the local recordings (since they are fully backed up)
    moved = 0
    failed = 0
    try:
        for f in expired_files:
            try:
                # Double-check existence in backup one last time before unlinking
                rel = f.relative_to(local)
                dest = NETWORK_BASE_DIR / rel
                if dest.is_file():
                    f.unlink()
                    moved += 1
                else:
                    failed += 1
            except Exception:
                failed += 1
    except Exception as e:
        print(f"[BACKUP] Purge error: {e}")

    cfg = load_config()
    cfg["retention_days"] = req.retention_days
    if req.camera_configs:
        cfg["camera_configs"] = [item.dict() for item in req.camera_configs]
    save_config(cfg)
    
    append_log(
        f"Retention enforced — local files purged: {moved}, failed: {failed}",
        "Success" if failed == 0 else "Warning",
    )
    return {
        "status":  "success",
        "moved":   moved,
        "failed":  failed,
        "message": f"Enforced retention rules successfully. Purged {moved} expired file(s) already verified in network storage.",
    }


@backup_router.post("/retention/save")
async def save_retention_settings(req: RetentionRequest):
    cfg = load_config()
    if req.retention_days is not None:
        cfg["retention_days"] = req.retention_days
    if req.camera_configs is not None:
        cfg["camera_configs"] = [item.dict() for item in req.camera_configs]
    if req.retention_enabled is not None:
        cfg["retention_enabled"] = req.retention_enabled
    save_config(cfg)
    
    status_msg = "enabled" if cfg.get("retention_enabled", False) else "disabled"
    append_log(f"Retention configuration updated (Enabled: {status_msg})", "Info")
    return {
        "status": "success",
        "message": f"Retention settings saved successfully. Background sweep is {status_msg}."
    }


# ── Restore ───────────────────────────────────────────────────────────────────
async def run_restore(req: RestoreRequest):
    global backup_state
    backup_state.update({"status": "Processing", "progress": 0})
    append_log(f"Restore started — {len(req.cameras)} camera(s)", "Info")
    try:
        net      = NETWORK_BASE_DIR
        local    = get_local_path()
        start_dt = datetime.strptime(req.start_date, "%Y-%m-%d").date()
        end_dt   = datetime.strptime(req.end_date,   "%Y-%m-%d").date()

        if req.use_smart_restore and req.cameras:
            smart_end = get_last_healthy(req.cameras[0], req.end_date + "T23:59:59")
            if smart_end:
                end_dt = datetime.fromisoformat(smart_end).date()
                append_log(f"Smart restore point: {smart_end}", "Info")

        all_files: list[Path] = []
        for camera in req.cameras:
            cam_ip_norm = camera.replace(".", "_")
            found = collect_files_in_range(net, cam_ip_norm, start_dt, end_dt)
            all_files.extend(found)

        total = len(all_files)
        if total == 0:
            backup_state.update({"status": "Completed", "progress": 100})
            append_log("Restore done — no files found in network backup", "Warning")
            return

        for i, f in enumerate(all_files):
            try:
                rel  = f.relative_to(net)
                dest = local / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, dest)
                print(f"[RESTORE] ✓ {rel}")
            except Exception as e:
                print(f"[RESTORE] ✗ {f.name}: {e}")
            backup_state["progress"] = int(((i + 1) / total) * 100)
            await asyncio.sleep(0.01)

        backup_state.update({
            "status":      "Completed",
            "progress":    100,
            "last_backup": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        })
        append_log(f"Restore done — {total} file(s) restored to {local}", "Success")

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