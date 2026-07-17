import os
from pathlib import Path
from pymongo import MongoClient

# Load .env directly here so this module never depends on import order
# or on whichever entry-point script happened to parse .env first.
# Walk up from this file until we find a .env (handles being called from
# any depth in the project).
_here = Path(__file__).resolve()
for _parent in [_here.parent, *_here.parents]:
    _candidate = _parent / ".env"
    if _candidate.exists():
        for _line in _candidate.read_text(encoding="utf-8").splitlines():
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _key, _val = _line.split("=", 1)
                os.environ.setdefault(_key.strip(), _val.strip().strip("'\""))
        break

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME", "vms_db")

try:
    mongo_client = MongoClient(
        MONGO_URI, 
        serverSelectionTimeoutMS=5000,
        maxPoolSize=100,
        minPoolSize=10
    )
    db = mongo_client[MONGO_DB_NAME]

    # Collections
    cameras_col = db["cameras"]
    users_col = db["users"]
    users_col.create_index("email", unique=True)
    settings_col = db["settings"]
    settings_col.create_index("name", unique=True)
    auth_logs_col = db["auth_logs"]
    analytics_col = db["analytics_events"]
    analytics_subs_col = db["analytics_subscriptions"]
    watch_collection = db["mqtt_logs"]
    recordings_col = db["recordings"]
    event_clips_col = db["event_clips"]
    health_logs_col = db["health_logs"]

    print(f"[MONGO] Connected: {MONGO_URI}")
except Exception as e:
    print(f"[MONGO] FAILED to connect: {e}")
    mongo_client = None
    db = None
    cameras_col = None
    users_col = None
    settings_col = None
    auth_logs_col = None
    analytics_col = None
    analytics_subs_col = None
    watch_collection = None
    recordings_col = None
    event_clips_col = None
    health_logs_col = None