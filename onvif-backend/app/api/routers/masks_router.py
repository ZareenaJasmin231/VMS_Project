"""
masks_router.py — Privacy mask CRUD for Mirador VMS
Persists mask polygons in MongoDB (or JSON fallback).

Mount in main.py:
    from app.api.routers.masks_router import router as masks_router
    
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import os, json

router = APIRouter(prefix="/api/masks", tags=["masks"])

# ── Storage backend ──────────────────────────────────────────────
# Tries MongoDB first, falls back to JSON file

_masks_col = None
try:
    import os
    from app.core.database import mongo_client
    MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")
    _mongo    = mongo_client
    _mongo.server_info()
    _masks_col = _mongo["mirador-vms"]["masks"]
    print("[MASKS] ✅ MongoDB backend ready")
except Exception as e:
    print(f"[MASKS] ⚠ MongoDB unavailable ({e}) — using JSON fallback")

MASKS_FILE = os.environ.get(
    "MASKS_FILE",
    os.path.join(os.path.dirname(__file__), "..", "devices_data", "masks.json")
)


def _load_file() -> dict:
    """Load all masks from JSON file → {ip: [mask, ...]}"""
    try:
        if os.path.exists(MASKS_FILE):
            with open(MASKS_FILE) as f:
                return json.load(f)
    except Exception as e:
        print(f"[MASKS] JSON load error: {e}")
    return {}


def _save_file(data: dict):
    try:
        os.makedirs(os.path.dirname(MASKS_FILE), exist_ok=True)
        with open(MASKS_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"[MASKS] JSON save error: {e}")


# ── Pydantic models ──────────────────────────────────────────────

class MaskPoint(BaseModel):
    pass  # points are [[x,y], ...] — plain list


class MaskModel(BaseModel):
    id:        str
    name:      str
    points:    List[List[float]]   # [[x,y], ...]
    color_idx: int   = 0
    enabled:   bool  = True


class SaveMaskRequest(BaseModel):
    mask: MaskModel


class SaveAllMasksRequest(BaseModel):
    masks: List[MaskModel]


# ── Helpers ──────────────────────────────────────────────────────

def _get_masks(ip: str) -> list:
    if _masks_col is not None:
        try:
            doc = _masks_col.find_one({"ip": ip}, {"_id": 0})
            return doc.get("masks", []) if doc else []
        except Exception as e:
            print(f"[MASKS] MongoDB get error: {e}")

    data = _load_file()
    return data.get(ip, [])


def _set_masks(ip: str, masks: list):
    if _masks_col is not None:
        try:
            _masks_col.update_one(
                {"ip": ip},
                {"$set": {"ip": ip, "masks": masks}},
                upsert=True,
            )
            print(f"[MASKS] ✅ Saved {len(masks)} mask(s) for {ip} → MongoDB")
            return
        except Exception as e:
            print(f"[MASKS] MongoDB set error: {e}")

    data = _load_file()
    data[ip] = masks
    _save_file(data)
    print(f"[MASKS] ✅ Saved {len(masks)} mask(s) for {ip} → JSON")


# ── Routes ───────────────────────────────────────────────────────

@router.get("/{ip}")
def get_masks(ip: str):
    """Return all masks for a camera."""
    masks = _get_masks(ip)
    return {"ip": ip, "masks": masks, "count": len(masks)}


@router.post("/{ip}")
def upsert_mask(ip: str, req: SaveMaskRequest):
    """Create or update a single mask by id."""
    masks = _get_masks(ip)
    mask_dict = req.mask.dict()

    idx = next((i for i, m in enumerate(masks) if m.get("id") == req.mask.id), None)
    if idx is not None:
        masks[idx] = mask_dict
        action = "updated"
    else:
        masks.append(mask_dict)
        action = "created"

    _set_masks(ip, masks)
    print(f"[MASKS] {action.capitalize()} mask '{req.mask.name}' for {ip}")
    return {"success": True, "action": action, "mask": mask_dict}


@router.put("/{ip}/all")
def replace_all_masks(ip: str, req: SaveAllMasksRequest):
    """Replace the entire mask list for a camera."""
    masks = [m.dict() for m in req.masks]
    _set_masks(ip, masks)
    return {"success": True, "count": len(masks)}


@router.delete("/{ip}/{mask_id}")
def delete_mask(ip: str, mask_id: str):
    """Delete a single mask by id."""
    masks   = _get_masks(ip)
    before  = len(masks)
    masks   = [m for m in masks if m.get("id") != mask_id]

    if len(masks) == before:
        raise HTTPException(status_code=404, detail=f"Mask {mask_id} not found for {ip}")

    _set_masks(ip, masks)
    print(f"[MASKS] Deleted mask {mask_id} for {ip}")
    return {"success": True, "deleted": mask_id}


@router.delete("/{ip}")
def delete_all_masks(ip: str):
    """Delete all masks for a camera."""
    _set_masks(ip, [])
    print(f"[MASKS] Cleared all masks for {ip}")
    return {"success": True, "ip": ip}
