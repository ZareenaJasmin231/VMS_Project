from pymongo import MongoClient
from bson import ObjectId
from datetime import datetime
from mask_models import MaskCreate, MaskUpdate, MaskResponse
import os

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
client = MongoClient(MONGO_URL)
db = client["miradorvms"]
masks_col = db["masks"]


def _serialize(doc) -> dict:
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc


def get_masks_by_camera(camera_id: str):
    docs = masks_col.find({"camera_id": camera_id})
    return [_serialize(doc) for doc in docs]


def create_mask(data: MaskCreate):
    doc = data.dict()
    doc["created_at"] = datetime.utcnow()
    result = masks_col.insert_one(doc)
    doc["id"] = str(result.inserted_id)
    del doc["_id"]
    return doc


def update_mask(mask_id: str, data: MaskUpdate):
    updates = {k: v for k, v in data.dict().items() if v is not None}
    if not updates:
        return None
    masks_col.update_one({"_id": ObjectId(mask_id)}, {"$set": updates})
    doc = masks_col.find_one({"_id": ObjectId(mask_id)})
    return _serialize(doc) if doc else None


def delete_mask(mask_id: str):
    result = masks_col.delete_one({"_id": ObjectId(mask_id)})
    return result.deleted_count == 1