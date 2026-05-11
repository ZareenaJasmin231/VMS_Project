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
designer_col = _db["designer_layouts"]

router = APIRouter(prefix="/api/designer", tags=["designer"])


# ── Pydantic models ───────────────────────────────────────────────

class PlacedCamera(BaseModel):
    id:        str
    x:         float
    y:         float
    direction: float
    camera:    Dict[str, Any]


class ZonePoint(BaseModel):
    x: float
    y: float


class Zone(BaseModel):
    id:      str
    name:    str
    color:   str
    polygon: List[ZonePoint]


class DesignerSaveRequest(BaseModel):
    map_id:      Optional[str]              = "default"
    floor_id:    Optional[str]              = "floor_1"
    placed:      Optional[List[PlacedCamera]] = []
    zones:       Optional[List[Zone]]         = []
    floor_plan:  Optional[str]              = None
    ppm:         Optional[float]            = 22.0


class FloorPlanRequest(BaseModel):
    map_id:     Optional[str] = "default"
    floor_id:   Optional[str] = "floor_1"
    floor_plan: str


# ── GET /api/designer/camera-models ──────────────────────────────
@router.get("/camera-models", dependencies=[Depends(verify_token)])
async def get_camera_models(brand: str = None, type: str = None, search: str = None):
    if _db is None:
        return {"cameras": [], "brands": []}
    try:
        query = {}
        if brand:
            query["brand"] = brand
        if type:
            query["type"] = type
        if search:
            query["$or"] = [
                {"brand":  {"$regex": search, "$options": "i"}},
                {"model":  {"$regex": search, "$options": "i"}},
                {"series": {"$regex": search, "$options": "i"}},
                {"notes":  {"$regex": search, "$options": "i"}},
            ]
        col = _db["camera_models"]
        cameras = list(col.find(query, {"_id": 0}))
        brands  = col.distinct("brand")
        return {"cameras": cameras, "brands": sorted(brands)}
    except Exception as e:
        print(f"[CAMERA-MODELS] ❌ {e}")
        return {"cameras": [], "brands": []}


# ── GET /api/designer ─────────────────────────────────────────────
@router.get("", dependencies=[Depends(verify_token)])
def get_designer_layout(map_id: str = "default", floor_id: str = "floor_1"):
    """
    Returns the saved designer state for a given map + floor:
      - placed cameras (with full camera objects)
      - zones (polygons)
      - floor plan image data URL
      - ppm (pixels-per-metre)
    """
    doc = designer_col.find_one(
        {"map_id": map_id, "floor_id": floor_id},
        {"_id": 0}
    )

    if not doc:
        return {
            "map_id":     map_id,
            "floor_id":   floor_id,
            "placed":     [],
            "zones":      [],
            "floor_plan": None,
            "ppm":        22.0,
            "updated_at": None,
        }

    return {
        "map_id":     doc.get("map_id"),
        "floor_id":   doc.get("floor_id"),
        "placed":     doc.get("placed", []),
        "zones":      doc.get("zones", []),
        "floor_plan": doc.get("floor_plan"),
        "ppm":        doc.get("ppm", 22.0),
        "updated_at": doc.get("updated_at"),
    }


# ── GET /api/designer/floors ──────────────────────────────────────
@router.get("/floors", dependencies=[Depends(verify_token)])
def list_designer_floors(map_id: str = "default"):
    """
    Lists all floor IDs that have a saved designer layout for a map.
    """
    docs = list(designer_col.find(
        {"map_id": map_id},
        {"_id": 0, "floor_id": 1, "updated_at": 1,
         "placed": 1, "zones": 1}
    ))

    return {
        "map_id": map_id,
        "floors": [
            {
                "floor_id":      d.get("floor_id"),
                "camera_count":  len(d.get("placed", [])),
                "zone_count":    len(d.get("zones", [])),
                "updated_at":    d.get("updated_at"),
            }
            for d in docs
        ]
    }


# ── POST /api/designer ────────────────────────────────────────────
@router.post("", dependencies=[Depends(verify_token)])
def save_designer_layout(req: DesignerSaveRequest):
    """
    Full save of designer state for a map + floor.

    If floor_plan is None in the request, the existing floor plan is preserved
    in the DB (so cameras/zones can be saved without re-uploading the image).
    """
    placed_data = [p.dict() for p in (req.placed or [])]
    zones_data  = [z.dict() for z in (req.zones  or [])]

    # Preserve existing floor_plan if client didn't send one
    existing = designer_col.find_one(
        {"map_id": req.map_id, "floor_id": req.floor_id},
        {"_id": 0, "floor_plan": 1}
    )
    floor_plan = req.floor_plan
    if floor_plan is None and existing:
        floor_plan = existing.get("floor_plan")

    designer_col.update_one(
        {"map_id": req.map_id, "floor_id": req.floor_id},
        {"$set": {
            "map_id":     req.map_id,
            "floor_id":   req.floor_id,
            "placed":     placed_data,
            "zones":      zones_data,
            "floor_plan": floor_plan,
            "ppm":        req.ppm,
            "updated_at": datetime.utcnow().isoformat(),
        }},
        upsert=True,
    )

    print(
        f"[DESIGNER] ✅ Saved layout for map='{req.map_id}' floor='{req.floor_id}' | "
        f"{len(placed_data)} camera(s) | {len(zones_data)} zone(s)"
    )
    return {
        "success":      True,
        "map_id":       req.map_id,
        "floor_id":     req.floor_id,
        "camera_count": len(placed_data),
        "zone_count":   len(zones_data),
    }


# ── POST /api/designer/cameras ────────────────────────────────────
@router.post("/cameras", dependencies=[Depends(verify_token)])
def save_placed_cameras(
    map_id:   str = "default",
    floor_id: str = "floor_1",
    placed:   List[PlacedCamera] = [],
):
    """Saves only the placed cameras list for a map + floor."""
    placed_data = [p.dict() for p in placed]

    designer_col.update_one(
        {"map_id": map_id, "floor_id": floor_id},
        {"$set": {
            "map_id":     map_id,
            "floor_id":   floor_id,
            "placed":     placed_data,
            "updated_at": datetime.utcnow().isoformat(),
        }},
        upsert=True,
    )

    print(f"[DESIGNER] 📷 Saved {len(placed_data)} camera(s) for map='{map_id}' floor='{floor_id}'")
    return {"success": True, "map_id": map_id, "floor_id": floor_id, "camera_count": len(placed_data)}


# ── POST /api/designer/zones ──────────────────────────────────────
@router.post("/zones", dependencies=[Depends(verify_token)])
def save_zones(
    map_id:   str = "default",
    floor_id: str = "floor_1",
    zones:    List[Zone] = [],
):
    """Saves only the zones list for a map + floor."""
    zones_data = [z.dict() for z in zones]

    designer_col.update_one(
        {"map_id": map_id, "floor_id": floor_id},
        {"$set": {
            "map_id":     map_id,
            "floor_id":   floor_id,
            "zones":      zones_data,
            "updated_at": datetime.utcnow().isoformat(),
        }},
        upsert=True,
    )

    print(f"[DESIGNER] 🗺  Saved {len(zones_data)} zone(s) for map='{map_id}' floor='{floor_id}'")
    return {"success": True, "map_id": map_id, "floor_id": floor_id, "zone_count": len(zones_data)}


# ── DELETE /api/designer/zones/{zone_id} ─────────────────────────
@router.delete("/zones/{zone_id}", dependencies=[Depends(verify_token)])
def delete_zone(zone_id: str, map_id: str = "default", floor_id: str = "floor_1"):
    """Remove a single zone by ID from the designer document."""
    result = designer_col.update_one(
        {"map_id": map_id, "floor_id": floor_id},
        {"$pull": {"zones": {"id": zone_id}}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")

    print(f"[DESIGNER] 🗑  Deleted zone '{zone_id}' from map='{map_id}' floor='{floor_id}'")
    return {"success": True, "deleted_zone_id": zone_id}


# ── DELETE /api/designer/cameras/{camera_id} ─────────────────────
@router.delete("/cameras/{camera_id}", dependencies=[Depends(verify_token)])
def delete_placed_camera(camera_id: str, map_id: str = "default", floor_id: str = "floor_1"):
    """Remove a single placed camera by its placed ID."""
    result = designer_col.update_one(
        {"map_id": map_id, "floor_id": floor_id},
        {"$pull": {"placed": {"id": camera_id}}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")

    print(f"[DESIGNER] 🗑  Deleted camera '{camera_id}' from map='{map_id}' floor='{floor_id}'")
    return {"success": True, "deleted_camera_id": camera_id}


# ── POST /api/designer/floor-plan ────────────────────────────────
@router.post("/floor-plan", dependencies=[Depends(verify_token)])
def save_floor_plan(req: FloorPlanRequest):
    """Saves only the floor plan image (base64 data URL) for a map + floor."""
    if not req.floor_plan:
        raise HTTPException(status_code=400, detail="floor_plan is required")

    designer_col.update_one(
        {"map_id": req.map_id, "floor_id": req.floor_id},
        {"$set": {
            "map_id":     req.map_id,
            "floor_id":   req.floor_id,
            "floor_plan": req.floor_plan,
            "updated_at": datetime.utcnow().isoformat(),
        }},
        upsert=True,
    )

    print(f"[DESIGNER] 🖼  Floor plan saved for map='{req.map_id}' floor='{req.floor_id}'")
    return {"success": True, "map_id": req.map_id, "floor_id": req.floor_id}


# ── DELETE /api/designer/floor-plan ──────────────────────────────
# FIX 2: New endpoint — removes only the floor plan image, preserving
# cameras and zones. Called when user clicks ✕ on Floor 1 in sidebar.
@router.delete("/floor-plan", dependencies=[Depends(verify_token)])
def delete_floor_plan(map_id: str = "default", floor_id: str = "floor_1"):
    """
    Removes only the floor plan image for a map + floor.
    Placed cameras and zones are preserved.
    """
    result = designer_col.update_one(
        {"map_id": map_id, "floor_id": floor_id},
        {"$set": {
            "floor_plan": None,
            "updated_at": datetime.utcnow().isoformat(),
        }}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=f"No designer layout found for floor '{floor_id}'")

    print(f"[DESIGNER] 🗑  Floor plan removed for map='{map_id}' floor='{floor_id}'")
    return {"success": True, "map_id": map_id, "floor_id": floor_id}


# ── DELETE /api/designer ──────────────────────────────────────────
@router.delete("", dependencies=[Depends(verify_token)])
def delete_designer_layout(map_id: str = "default", floor_id: str = "floor_1"):
    """Delete the entire designer document for a map + floor."""
    result = designer_col.delete_one({"map_id": map_id, "floor_id": floor_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=f"No designer layout found for floor '{floor_id}'")

    print(f"[DESIGNER] 🗑  Deleted designer layout for map='{map_id}' floor='{floor_id}'")
    return {"success": True, "map_id": map_id, "floor_id": floor_id}


# ── DELETE /api/designer/all ──────────────────────────────────────
@router.delete("/all", dependencies=[Depends(verify_token)])
def delete_all_designer_layouts(map_id: str = "default"):
    """Delete ALL designer documents for a map (all floors)."""
    result = designer_col.delete_many({"map_id": map_id})
    print(f"[DESIGNER] 🗑  Deleted all {result.deleted_count} designer document(s) for map='{map_id}'")
    return {"success": True, "map_id": map_id, "deleted_count": result.deleted_count}