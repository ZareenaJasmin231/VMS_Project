import asyncio
import threading
from schedulers.email_report_worker import email_report_worker
# from schedulers.forensic_indexer_worker import start_background_indexer
from schedulers.stream_health_worker import start_health_monitoring
from schedulers.mqtt_to_db_worker import start_mqtt
from app.core.database import cameras_col

def start():
    print("[SCHEDULER] Starting Mirador VMS Scheduler Service...")

    # 1. Start Forensic Indexer (daemon thread)
    # try:
    #     start_background_indexer()
    # except Exception as e:
    #     print(f"[SCHEDULER] ❌ Failed to start forensic indexer: {e}")

    # 2. Start MQTT Client in a background thread (so it doesn't block the async loop)
    try:
        mqtt_thread = threading.Thread(target=start_mqtt, daemon=True, name="mqtt-worker")
        mqtt_thread.start()
        print("[SCHEDULER] ✅ MQTT event consumer thread started.")
    except Exception as e:
        print(f"[SCHEDULER] ❌ Failed to start MQTT consumer: {e}")

    # 3. Start asyncio loop for async health/report workers
    async def run_async_workers():
        if cameras_col is None:
            print("[SCHEDULER] ❌ MongoDB cameras collection is not connected. Async workers will exit.")
            return

        try:
            # Load active cameras for stream health monitoring
            devices = list(cameras_col.find({"enabled": {"$ne": False}}))
            print(f"[SCHEDULER] Stream Health Monitor watching {len(devices)} cameras.")
        except Exception as e:
            print(f"[SCHEDULER] ❌ Failed to load cameras for stream health: {e}")
            devices = []

        await asyncio.gather(
            email_report_worker(),
            start_health_monitoring(devices, cameras_col)
        )

    try:
        import sys
        if sys.platform == 'win32':
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        asyncio.run(run_async_workers())
    except KeyboardInterrupt:
        print("\n[SCHEDULER] Shutting down scheduler...")
