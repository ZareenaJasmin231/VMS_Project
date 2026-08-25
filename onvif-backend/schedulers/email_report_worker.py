import asyncio
from datetime import datetime, timedelta, time
from app.core.database import db as _db
from app.services.email_service import send_scheduled_report

async def email_report_worker():
    """
    Background worker that runs periodically to evaluate active email report schedules
    and dispatch report emails.
    """
    print("[ReportWorker] Starting Automated Email Report Scheduler...")
    while True:
        try:
            if _db is None:
                await asyncio.sleep(60)
                continue
                
            col = _db["report_schedules"]
            active_schedules = list(col.find({"enabled": True}))
            
            now = datetime.now()
            current_time = now.time()
            
            for sch in active_schedules:
                schedule_type = sch.get("schedule_type")
                if schedule_type == "immediate":
                    continue
                    
                last_run_str = sch.get("last_run")
                send_time_str = sch.get("send_time", "09:00")
                
                try:
                    sh, sm = map(int, send_time_str.split(":"))
                    target_time = time(sh, sm)
                except Exception:
                    target_time = time(9, 0)
                
                # Check delta and time condition based on frequency
                should_run = False
                if not last_run_str:
                    # Run immediately if we have reached the target time today
                    if current_time >= target_time:
                        should_run = True
                else:
                    try:
                        last_run = datetime.fromisoformat(last_run_str)
                        elapsed = now - last_run
                        
                        if schedule_type == "daily":
                            if elapsed >= timedelta(hours=20) and current_time >= target_time:
                                should_run = True
                        elif schedule_type == "weekly":
                            if elapsed >= timedelta(days=6) and current_time >= target_time:
                                should_run = True
                        elif schedule_type == "monthly":
                            if elapsed >= timedelta(days=28) and current_time >= target_time:
                                should_run = True
                    except Exception as parse_err:
                        print(f"[ReportWorker] Date parse error for schedule {sch.get('_id')}: {parse_err}")
                        if current_time >= target_time:
                            should_run = True
                
                if should_run:
                    # Dispatch email report (run in a separate thread so it doesn't block async loop)
                    loop = asyncio.get_running_loop()
                    success = await loop.run_in_executor(None, send_scheduled_report, sch)
                    
                    if success:
                        col.update_one(
                            {"_id": sch["_id"]},
                            {"$set": {"last_run": now.isoformat()}}
                        )
                        print(f"[ReportWorker] Schedule {sch.get('report_type')} ({sch.get('schedule_type')}) executed successfully.")
                        
        except Exception as e:
            print(f"[ReportWorker] Error in scheduler loop: {e}")
            
        # Poll every 1 minute for faster response to schedule delivery times
        await asyncio.sleep(60)
