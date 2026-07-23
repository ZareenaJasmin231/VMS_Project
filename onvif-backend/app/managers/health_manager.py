import asyncio
import psutil
from datetime import datetime
from app.core.database import db, watch_collection, analytics_col
from app.managers.stream_manager import devices
from app.adapters.bosch_adapter import pull_bosch_events
from app.adapters.dahua_adapter import pull_dahua_events

async def system_health_collector():
    while True:
        try:
            cpu = psutil.cpu_percent()
            ram = psutil.virtual_memory().percent
            disk = psutil.disk_usage('/').percent

            # Optional process metrics summary sampling
            ffmpeg_count = 0
            vms_ram_mb = 0.0
            try:
                for proc in psutil.process_iter(['name', 'memory_info']):
                    pname = (proc.info['name'] or '').lower()
                    if 'ffmpeg' in pname:
                        ffmpeg_count += 1
                        if proc.info['memory_info']:
                            vms_ram_mb += proc.info['memory_info'].rss / (1024 * 1024)
                    elif 'python' in pname or 'mongod' in pname or 'minio' in pname or 'mediamtx' in pname:
                        if proc.info['memory_info']:
                            vms_ram_mb += proc.info['memory_info'].rss / (1024 * 1024)
            except Exception:
                pass

            if db is not None:
                db["health_logs"].insert_one({
                    "type": "system",
                    "cpu": cpu,
                    "ram": ram,
                    "disk": disk,
                    "ffmpeg_count": ffmpeg_count,
                    "vms_ram_mb": round(vms_ram_mb, 1),
                    "timestamp": datetime.utcnow()
                })

        except Exception as e:
            print("[SYSTEM HEALTH ERROR]", e)

        await asyncio.sleep(10)

async def camera_health_collector():
    while True:
        try:
            for cam in devices:
                db["health_logs"].insert_one({
                    "type": "camera",
                    "ip": cam.get("ip"),
                    "status": "online" if cam.get("enabled") else "offline",
                    "timestamp": datetime.utcnow()
                })
        except Exception as e:
            print("[CAM HEALTH ERROR]", e)

        await asyncio.sleep(10)            

_analytics_semaphore = asyncio.Semaphore(5)

async def analytics_poll_loop(ip: str, port: int, username: str, password: str, manufacturer: str = "bosch"):
    print(f"[ANALYTICS] ▶ Started polling for {ip} ({manufacturer})")

    consecutive_failures = 0
    is_dahua = "dahua" in manufacturer.lower()

    while True:
        try:
            from app.services.license_manager import license_manager
            from app.core.database import analytics_subs_col

            # Enforce max analytics modules limit
            max_analytics = license_manager.get_max_analytics()
            active_count = analytics_subs_col.count_documents({"enabled": True}) if analytics_subs_col is not None else 0
            if active_count > max_analytics:
                print(f"[ANALYTICS] ⚠️ License limit exceeded: active={active_count}, max={max_analytics}. Suspending poll loop for {ip}.")
                await asyncio.sleep(30)
                continue

            async with _analytics_semaphore:
                if is_dahua:
                    result = await asyncio.to_thread(
                        pull_dahua_events,
                        ip, port, username, password
                    )
                    source_name = "dahua"
                else:
                    result = await asyncio.to_thread(
                        pull_bosch_events,
                        ip, port, username, password
                    )
                    source_name = "bosch"

            if result["success"] and result["events"]:
                for ev in result["events"]:
                    event_type = ev.get("event_type", "Object Detection")
                    
                    if not license_manager.is_analytics_enabled(event_type):
                        print(f"[ANALYTICS] ⚠️ Skipped event type: {event_type} on {ip} (not licensed)")
                        continue

                    alert = {
                        "ip": ip,
                        "serial": ip.replace(".", "_"),
                        "type":        event_type,
                        "scenario":    ev.get("scenario_name", "Detect Any Object"),
                        "status": "Active",
                        "source": source_name,
                        "topic": ev.get("topic", ""),
                        "raw": ev.get("raw", {}),
                        "time": datetime.now().isoformat(),
                        "received_at": datetime.now().isoformat(),
                    }

                    if "occupancy" in alert["type"].lower():
                        count_val = ev.get("count")
                        if count_val is None:
                            raw_data = ev.get("raw", {})
                            count_val = raw_data.get("Value") or raw_data.get("Active") or raw_data.get("State") or raw_data.get("Occupancy") or raw_data.get("Count")
                        if count_val is not None:
                            try:
                                alert["total"] = int(count_val)
                                alert["human"] = int(count_val)
                            except ValueError:
                                alert["total"] = count_val
                                alert["human"] = count_val

                    if analytics_col is not None:
                        analytics_col.insert_one(alert)
                    if watch_collection is not None:
                        watch_collection.insert_one(alert)

                    print(f"[{source_name.upper()} UI ALERT] {ip} → {alert['type']}")
                consecutive_failures = 0

            elif not result["success"]:
                consecutive_failures += 1
                if consecutive_failures % 5 == 0:
                    print(f"[ANALYTICS] ✗ Failed to poll {ip} {consecutive_failures} times. Retrying in 10s...")
                    await asyncio.sleep(10)
                    continue

        except asyncio.CancelledError:
            print(f"[ANALYTICS] ⏹ Stopped for {ip}")
            break
        except Exception as e:
            print(f"[ANALYTICS] ❌ {ip}: {e}")
            consecutive_failures += 1
            if consecutive_failures % 5 == 0:
                await asyncio.sleep(10)
                continue

        await asyncio.sleep(5)
