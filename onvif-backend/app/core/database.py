import os
from pymongo import MongoClient

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")
MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME", "vms_database")

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
