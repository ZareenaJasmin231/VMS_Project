import os
import re
import shutil
import asyncio
from pathlib import Path

async def run_log_organizer():
    print("[LOG ORGANIZER] Starting background log cleanup task...")
    # Navigate up to VMS_Project/logs from VMS_Project/onvif-backend/app/background/log_organizer.py
    log_dir = Path(__file__).parent.parent.parent.parent / "logs"
    
    while True:
        try:
            if log_dir.exists():
                count = 0
                for item in log_dir.iterdir():
                    if not item.is_file() or not item.name.endswith(".log"):
                        continue
                        
                    # Match NSSM rotated log pattern: e.g., mirador-api-20260802T165101.482.log
                    match = re.search(r'-(\d{4})(\d{2})(\d{2})T\d{6}\.\d{3}\.log$', item.name)
                    if match:
                        year, month, day = match.groups()
                        date_folder_name = f"{year}-{month}-{day}"
                        date_folder_path = log_dir / date_folder_name
                        
                        if not date_folder_path.exists():
                            date_folder_path.mkdir(parents=True, exist_ok=True)
                            
                        dest_path = date_folder_path / item.name
                        try:
                            # Move the old rotated log file to the date folder
                            if not dest_path.exists():
                                shutil.move(str(item), str(dest_path))
                                count += 1
                        except Exception as move_err:
                            print(f"[LOG ORGANIZER] Failed to move {item.name}: {move_err}")
                if count > 0:
                    print(f"[LOG ORGANIZER] Successfully organized {count} historical log files into date folders.")
        except Exception as e:
            print(f"[LOG ORGANIZER] Error during log organization: {e}")
            
        # Run check every 4 hours
        await asyncio.sleep(4 * 3600)
