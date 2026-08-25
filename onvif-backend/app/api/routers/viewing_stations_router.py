"""
viewing_stations_router.py — Viewing Station management and remote layout pushing.
Persists viewing stations in MongoDB with JSON fallback.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import os
import json
import time

from app.core.security import verify_token
from app.core.database import db as _db

router = APIRouter(prefix="/api/viewing-stations", tags=["viewing-stations"])

# ── Storage Backend ──────────────────────────────────────────────────
_stations_col = None
try:
    from app.core.database import mongo_client
    if mongo_client:
        _stations_col = mongo_client[os.environ.get("MONGO_DB_NAME")]["viewing_stations"]
        print("[STATIONS] ✅ MongoDB backend ready")
except Exception as e:
    print(f"[STATIONS] ⚠️ MongoDB unavailable ({e}) — using JSON fallback")

STATIONS_FILE = os.environ.get(
    "STATIONS_FILE",
    os.path.join(os.path.dirname(__file__), "..", "..", "devices_data", "viewing_stations.json")
)

def _load_file() -> dict:
    """Load all stations from JSON file → {station_id: station_doc}"""
    try:
        if os.path.exists(STATIONS_FILE):
            with open(STATIONS_FILE) as f:
                return json.load(f)
    except Exception as e:
        print(f"[STATIONS] JSON load error: {e}")
    return {}

def _save_file(data: dict):
    try:
        os.makedirs(os.path.dirname(STATIONS_FILE), exist_ok=True)
        with open(STATIONS_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"[STATIONS] JSON save error: {e}")

# ── Helpers ──────────────────────────────────────────────────────────

def _get_station(station_id: str) -> Optional[dict]:
    if _stations_col is not None:
        try:
            return _stations_col.find_one({"station_id": station_id}, {"_id": 0})
        except Exception as e:
            print(f"[STATIONS] MongoDB get error: {e}")

    data = _load_file()
    return data.get(station_id)

def _save_station(station: dict):
    station_id = station["station_id"]
    if _stations_col is not None:
        try:
            _stations_col.update_one(
                {"station_id": station_id},
                {"$set": station},
                upsert=True
            )
            return
        except Exception as e:
            print(f"[STATIONS] MongoDB save error: {e}")

    data = _load_file()
    data[station_id] = station
    _save_file(data)

def _get_all_stations() -> List[dict]:
    if _stations_col is not None:
        try:
            return list(_stations_col.find({}, {"_id": 0}))
        except Exception as e:
            print(f"[STATIONS] MongoDB list error: {e}")

    data = _load_file()
    return list(data.values())

# ── Pydantic Models ──────────────────────────────────────────────────

class HeartbeatRequest(BaseModel):
    station_id: str
    name: str
    grid: str
    device_order: List[Optional[str]]
    applied_timestamp: Optional[float] = 0.0
    active_feeds_count: Optional[int] = 0

class PushLayoutRequest(BaseModel):
    station_id: str
    grid: str
    device_order: List[Optional[str]]

# ── Routes ───────────────────────────────────────────────────────────

@router.post("/heartbeat")
def heartbeat(req: HeartbeatRequest, payload: dict = Depends(verify_token)):
    """
    Heartbeat endpoint. Receives current status from a station,
    updates last_seen, and checks if a layout push is pending.
    """
    now = time.time()
    existing = _get_station(req.station_id)

    email = "Unknown"
    user_id = payload.get("sub")
    if _db is not None and user_id:
        from bson.objectid import ObjectId
        try:
            user = _db["users"].find_one({"_id": ObjectId(user_id)})
            if user:
                email = user.get("email", "Unknown")
        except Exception:
            pass

    if existing:
        station = existing
    else:
        # Register new station
        station = {
            "station_id": req.station_id,
            "name": req.name,
            "pushed_layout": None,
        }

    # Update active status
    station["name"] = req.name
    station["last_seen"] = now
    station["active_layout"] = {
        "grid": req.grid,
        "device_order": req.device_order
    }
    station["active_feeds_count"] = req.active_feeds_count
    station["email"] = email

    _save_station(station)

    # Check for pending pushed layout
    pushed = station.get("pushed_layout")
    if pushed and pushed.get("timestamp", 0.0) > req.applied_timestamp:
        return {
            "success": True,
            "pushed_layout": {
                "grid": pushed["grid"],
                "device_order": pushed["device_order"],
                "timestamp": pushed["timestamp"]
            }
        }

    return {
        "success": True,
        "pushed_layout": None
    }

@router.get("")
def list_stations():
    """List all registered stations and calculate online status."""
    now = time.time()
    stations = _get_all_stations()
    result = []
    
    for s in stations:
        last_seen = s.get("last_seen", 0.0)
        # Online if checked in during the last 12 seconds
        is_online = (now - last_seen) < 12.0
        
        if is_online:
            result.append({
                "station_id": s.get("station_id"),
                "name": s.get("name", "Unknown Terminal"),
                "is_online": is_online,
                "last_seen": last_seen,
                "active_layout": s.get("active_layout"),
                "pushed_layout": s.get("pushed_layout"),
                "active_feeds_count": s.get("active_feeds_count", 0),
                "email": s.get("email", "Unknown")
            })
        
    return {"success": True, "stations": result}

@router.post("/push")
def push_layout(req: PushLayoutRequest):
    """Push a layout layout (grid mode + camera order) to a station."""
    station = _get_station(req.station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")

    station["pushed_layout"] = {
        "grid": req.grid,
        "device_order": req.device_order,
        "timestamp": time.time()
    }
    
    _save_station(station)
    return {"success": True, "message": f"Layout successfully pushed to {station.get('name')}"}
