from fastapi import APIRouter, HTTPException, Depends
from pymongo import MongoClient
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional, Any, Dict
from jwt_auth import verify_token
import os

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")
_client   = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
_db       = _client["mirador-vms"]
maps_col  = _db["map_layouts"]

router = APIRouter(prefix="/api/maps", tags=["maps"])


# ── Pydantic models ───────────────────────────────────────────────

class Marker(BaseModel):
    camId:     str
    camName:   Optional[str] = ""
    camIp:     Optional[str] = ""
    x:         float
    y:         float
    fovAngle:  Optional[float] = 60    # ← NEW: FOV angle in degrees (40/60/90/120)
    direction: Optional[float] = 0     # ← NEW: facing direction 0–359°


class Floor(BaseModel):
    id:           str
    name:         str
    imageDataUrl: Optional[str] = None   # base64 data-URL of floor plan image
    markers:      List[Marker]  = []


class MapSaveRequest(BaseModel):
    map_id:     Optional[str]         = "default"
    floors:     Optional[List[Floor]] = None   # new multi-floor format
    # ── legacy single-floor fields (kept for backward compat) ──
    markers:    Optional[List[Marker]] = None
    floor_plan: Optional[str]          = None


# ── Helpers ───────────────────────────────────────────────────────

def _migrate_to_floors(doc: dict) -> List[dict]:
    """
    If the stored document is in the old single-floor format
    (markers[] + floor_plan) migrate it to the new floors[] format.
    """
    if doc.get("floors"):
        return doc["floors"]
    return [{
        "id":           "floor_1",
        "name":         "Floor 1",
        "imageDataUrl": doc.get("floor_plan"),
        "markers":      doc.get("markers", []),
    }]


# ── GET /api/maps ─────────────────────────────────────────────────
@router.get("", dependencies=[Depends(verify_token)])
def get_map(map_id: str = "default"):
    doc = maps_col.find_one({"map_id": map_id}, {"_id": 0})
    if not doc:
        return {"map_id": map_id, "floors": [], "markers": [], "floor_plan": None}

    floors = _migrate_to_floors(doc)
    return {
        "map_id":     map_id,
        "floors":     floors,
        # Keep legacy fields so old clients don't break
        "markers":    doc.get("markers", []),
        "floor_plan": doc.get("floor_plan"),
        "updated_at": doc.get("updated_at"),
    }


# ── POST /api/maps ────────────────────────────────────────────────
@router.post("", dependencies=[Depends(verify_token)])
def save_map(req: MapSaveRequest):
    existing = maps_col.find_one({"map_id": req.map_id}, {"_id": 0})

    if req.floors is not None:
        # ── New multi-floor save ──────────────────────────────────
        floors_data = []
        for f in req.floors:
            floor_dict = f.dict()
            # If client sent None for imageDataUrl, keep existing if available
            if floor_dict["imageDataUrl"] is None and existing:
                existing_floors = existing.get("floors", [])
                match = next((ef for ef in existing_floors if ef.get("id") == f.id), None)
                if match:
                    floor_dict["imageDataUrl"] = match.get("imageDataUrl")
            floors_data.append(floor_dict)

        doc = {
            "map_id":     req.map_id,
            "floors":     floors_data,
            "updated_at": datetime.utcnow().isoformat(),
        }
        total_markers = sum(len(f.get("markers", [])) for f in floors_data)

    else:
        # ── Legacy single-floor save (backward compat) ────────────
        floor_plan = req.floor_plan
        if floor_plan is None and existing:
            floor_plan = existing.get("floor_plan")

        markers_data = [m.dict() for m in (req.markers or [])]

        doc = {
            "map_id":     req.map_id,
            "markers":    markers_data,
            "floor_plan": floor_plan,
            "updated_at": datetime.utcnow().isoformat(),
        }
        total_markers = len(markers_data)

    result = maps_col.update_one(
        {"map_id": req.map_id},
        {"$set": doc},
        upsert=True,
    )
    print(
        f"[MAPS] ✅ Saved map '{req.map_id}': {total_markers} total markers | "
        f"upserted={result.upserted_id is not None} modified={result.modified_count}"
    )
    return {"success": True, "map_id": req.map_id, "marker_count": total_markers}


# ── DELETE /api/maps ──────────────────────────────────────────────
@router.delete("", dependencies=[Depends(verify_token)])
def delete_map(map_id: str = "default"):
    maps_col.delete_one({"map_id": map_id})
    return {"success": True, "map_id": map_id}


# ── POST /api/maps/floor-plan ─────────────────────────────────────
# Legacy endpoint — updates floor plan of floor_1 only
@router.post("/floor-plan", dependencies=[Depends(verify_token)])
def save_floor_plan(payload: dict):
    map_id     = payload.get("map_id", "default")
    floor_plan = payload.get("floor_plan")
    floor_id   = payload.get("floor_id", "floor_1")   # ← NEW optional param

    if not floor_plan:
        raise HTTPException(status_code=400, detail="floor_plan required")

    existing = maps_col.find_one({"map_id": map_id}, {"_id": 0})

    if existing and existing.get("floors"):
        # Update the matching floor's imageDataUrl
        floors = existing["floors"]
        updated = False
        for f in floors:
            if f.get("id") == floor_id:
                f["imageDataUrl"] = floor_plan
                updated = True
                break
        if not updated:
            # Floor not found — add it
            floors.append({"id": floor_id, "name": floor_id, "imageDataUrl": floor_plan, "markers": []})

        result = maps_col.update_one(
            {"map_id": map_id},
            {"$set": {"floors": floors, "updated_at": datetime.utcnow().isoformat()}},
            upsert=True,
        )
    else:
        # Legacy: save as top-level floor_plan
        result = maps_col.update_one(
            {"map_id": map_id},
            {"$set": {"floor_plan": floor_plan, "updated_at": datetime.utcnow().isoformat()}},
            upsert=True,
        )

    print(f"[MAPS] ✅ Floor plan saved for map '{map_id}' floor '{floor_id}' | "
          f"upserted={result.upserted_id is not None}")
    return {"success": True, "map_id": map_id, "floor_id": floor_id}