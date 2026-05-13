from datetime import datetime, timezone
from pymongo import MongoClient
import os
import asyncio

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")
mongo_client = MongoClient(MONGO_URI)
db = mongo_client["mirador-vms"]
terminal_logs_col = db["terminal_logs"]

def log_terminal(user_email, user_role, command, project_folder, exit_code=0, output=""):
    try:
        doc = {
            "user_email": user_email,
            "user_role": user_role,
            "command": command,
            "project_folder": project_folder,
            "exit_code": exit_code,
            "output_snippet": output[:500],
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        terminal_logs_col.insert_one(doc)

        # 🔥 SEND TO WEBSOCKET
        try:
            from main import broadcast_log, manager

            loop = manager.loop if hasattr(manager, 'loop') and manager.loop else None

            if loop and loop.is_running():
                asyncio.run_coroutine_threadsafe(
                    broadcast_log(doc),
                    loop
                )
            else:
                print("No running event loop for broadcast")

        except Exception as e:
            print("WS broadcast failed:", e)

    except Exception as e:
        print("Terminal log failed:", e)