import re

file_path = r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\main.py"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add contextlib and task_manager imports
if "from contextlib import asynccontextmanager" not in content:
    content = content.replace(
        "from fastapi import FastAPI, HTTPException, Request, APIRouter",
        "from fastapi import FastAPI, HTTPException, Request, APIRouter\nfrom contextlib import asynccontextmanager\nfrom app.background_task_manager import task_manager"
    )

# 2. Rename @app.on_event("startup") to internal functions
# First occurrence (commented out) - ignore or let it be if we only replace active ones
# Active ones:
content = content.replace(
    "@app.on_event(\"startup\")\nasync def startup_event():",
    "async def _startup_phase_1():"
)
content = content.replace(
    "@app.on_event(\"startup\")\nasync def startup():",
    "async def _startup_phase_2():"
)

# 3. Rename @app.on_event("shutdown") to internal function
content = content.replace(
    "@app.on_event(\"shutdown\")\nasync def shutdown():",
    "async def _shutdown_phase_1():"
)

# 4. Create the lifespan context manager
lifespan_code = """
@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- STARTUP ---
    await _startup_phase_1()
    await _startup_phase_2()
    yield
    # --- SHUTDOWN ---
    await _shutdown_phase_1()
    # Shut down all central tasks with max 5s timeout
    await task_manager.shutdown_all_tasks(timeout=5.0)
    # Stop background indexer
    try:
        from app.background.forensic_indexer_worker import stop_background_indexer
        stop_background_indexer()
    except Exception as e:
        print(f"[SHUTDOWN] Failed to stop indexer: {e}")
    # Stop infrastructure scheduler
    infrastructure_scheduler.stop()
    # Find and kill orphan ffmpeg processes
    task_manager.kill_orphan_ffmpegs()

app = FastAPI(title="MIRADOR ONVIF Backend", lifespan=lifespan)
"""

content = content.replace(
    "app = FastAPI(title=\"MIRADOR ONVIF Backend\")",
    lifespan_code.strip()
)

# 5. Replace asyncio.create_task with task_manager.start_task
# Phase 1 tasks
content = content.replace(
    "asyncio.create_task(run_diagnostics_loop())",
    "await task_manager.start_task('diagnostics', run_diagnostics_loop())"
)
content = content.replace(
    "asyncio.create_task(run_stream_health_loop())",
    "await task_manager.start_task('stream_health', run_stream_health_loop())"
)

# Phase 2 tasks
content = content.replace(
    "asyncio.create_task(stream_watchdog())",
    "await task_manager.start_task('stream_watchdog', stream_watchdog())"
)
content = content.replace(
    "_health_monitor_task = asyncio.create_task(start_health_monitoring(devices, cameras_col))",
    "_health_monitor_task = await task_manager.start_task('health_monitor', start_health_monitoring(devices, cameras_col))"
)
content = content.replace(
    "asyncio.create_task(system_health_collector())",
    "await task_manager.start_task('system_health', system_health_collector())"
)
content = content.replace(
    "asyncio.create_task(camera_health_collector())",
    "await task_manager.start_task('camera_health', camera_health_collector())"
)

# Analytics poll loop (requires a bit of regex because of multi-line format)
# The existing code is:
#                 t = asyncio.create_task(
#                     _analytics_poll_loop(
#                         sub_ip, sub.get("port", 80),
#                         sub.get("username", ""), sub.get("password", "")
#                     )
#                 )
analytics_target = """                t = asyncio.create_task(
                    _analytics_poll_loop(
                        sub_ip, sub.get("port", 80),
                        sub.get("username", ""), sub.get("password", "")
                    )
                )"""
analytics_replacement = """                t = await task_manager.start_task(
                    f"analytics_{sub_ip}",
                    _analytics_poll_loop(
                        sub_ip, sub.get("port", 80),
                        sub.get("username", ""), sub.get("password", "")
                    )
                )"""
content = content.replace(analytics_target, analytics_replacement)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Refactoring complete.")
