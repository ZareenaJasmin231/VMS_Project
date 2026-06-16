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

            db["health_logs"].insert_one({
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
                db["health_logs"].insert_one({
                    "type": "camera",
                    "ip": cam.get("ip"),
                    "status": "online" if cam.get("enabled") else "offline",
                    "timestamp": datetime.utcnow()
                })
        except Exception as e:
            print("[CAM HEALTH ERROR]", e)

        await asyncio.sleep(10)            

async def analytics_poll_loop(ip: str, port: int, username: str, password: str, manufacturer: str = "bosch"):
    print(f"[ANALYTICS] ▶ Started polling for {ip} ({manufacturer})")

    consecutive_failures = 0
    is_dahua = "dahua" in manufacturer.lower()

    while True:
        try:
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
                    alert = {
                        "ip": ip,
                        "serial": ip.replace(".", "_"),
                        "type":        ev.get("event_type", "Object Detection"),
                        "scenario":    ev.get("scenario_name", "Detect Any Object"),
                        "status": "Active",
                        "source": source_name,
                        "topic": ev.get("topic", ""),
                        "raw": ev.get("raw", {}),
                        "time": datetime.now().isoformat(),
                        "received_at": datetime.now().isoformat(),
                    }

                    # For Occupancy events, extract count from event or raw data
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
                if consecutive_failures % 10 == 0:
                    print(f"[ANALYTICS] ✗ Failed to poll {ip} {consecutive_failures} times. Retrying in 10s...")
                    await asyncio.sleep(10)
                    continue

        except asyncio.CancelledError:
            print(f"[ANALYTICS] ⏹ Stopped for {ip}")
            break
        except Exception as e:
            print(f"[ANALYTICS] ❌ {ip}: {e}")
            consecutive_failures += 1
            if consecutive_failures % 10 == 0:
                await asyncio.sleep(10)
                continue

        await asyncio.sleep(5)
