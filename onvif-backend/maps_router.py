from fastapi import APIRouter, HTTPException, Depends
from pymongo import MongoClient
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional
from jwt_auth import verify_token
import os

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")
_client   = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
_db       = _client["mirador-vms"]
maps_col  = _db["map_layouts"]

router = APIRouter(prefix="/api/maps", tags=["maps"])


class Marker(BaseModel):
    camId:   str
    camName: Optional[str] = ""
    camIp:   Optional[str] = ""
    x:       float
    y:       float


class MapSaveRequest(BaseModel):
    map_id:     Optional[str] = "default"
    markers:    List[Marker]
    floor_plan: Optional[str] = None  # base64 data-URL (omit to keep existing)


class MapLayout(BaseModel):
    map_id:     str
    markers:    List[Marker]
    floor_plan: Optional[str] = None
    updated_at: Optional[str] = None


# ── GET /api/maps ─────────────────────────────────────────────────
@router.get("", dependencies=[Depends(verify_token)])
def get_map(map_id: str = "default"):
    doc = maps_col.find_one({"map_id": map_id}, {"_id": 0})
    if not doc:
        return {"map_id": map_id, "markers": [], "floor_plan": None}
    return doc


# ── POST /api/maps ────────────────────────────────────────────────
@router.post("", dependencies=[Depends(verify_token)])
def save_map(req: MapSaveRequest):
    existing = maps_col.find_one({"map_id": req.map_id}, {"_id": 0})

    # Keep the stored floor plan if the client didn't send a new one
    floor_plan = req.floor_plan
    if floor_plan is None and existing:
        floor_plan = existing.get("floor_plan")

    doc = {
        "map_id":     req.map_id,
        "markers":    [m.dict() for m in req.markers],
        "floor_plan": floor_plan,
        "updated_at": datetime.utcnow().isoformat(),
    }
    result = maps_col.update_one(
        {"map_id": req.map_id},
        {"$set": doc},
        upsert=True,
    )
    print(f"[MAPS] ✅ Saved map '{req.map_id}': {len(req.markers)} markers | "
          f"upserted={result.upserted_id is not None} modified={result.modified_count}")
    return {"success": True, "map_id": req.map_id, "marker_count": len(req.markers)}


# ── DELETE /api/maps ──────────────────────────────────────────────
@router.delete("", dependencies=[Depends(verify_token)])
def delete_map(map_id: str = "default"):
    maps_col.delete_one({"map_id": map_id})
    return {"success": True, "map_id": map_id}


# ── POST /api/maps/floor-plan ─────────────────────────────────────
@router.post("/floor-plan", dependencies=[Depends(verify_token)])
def save_floor_plan(payload: dict):
    map_id     = payload.get("map_id", "default")
    floor_plan = payload.get("floor_plan")
    if not floor_plan:
        raise HTTPException(status_code=400, detail="floor_plan required")
    result = maps_col.update_one(
        {"map_id": map_id},
        {"$set": {"floor_plan": floor_plan, "updated_at": datetime.utcnow().isoformat()}},
        upsert=True,
    )
    print(f"[MAPS] ✅ Floor plan saved for map '{map_id}' | "
          f"upserted={result.upserted_id is not None} modified={result.modified_count}")
    return {"success": True, "map_id": map_id}