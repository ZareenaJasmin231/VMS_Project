from fastapi import APIRouter, HTTPException
from mask_models import MaskCreate, MaskUpdate
import mask_service

router = APIRouter(prefix="/api/masks", tags=["masks"])


@router.get("/{camera_id}")
def get_masks(camera_id: str):
    return mask_service.get_masks_by_camera(camera_id)


@router.post("/{camera_id}")
def create_mask(camera_id: str, data: MaskCreate):
    data.camera_id = camera_id
    return mask_service.create_mask(data)


@router.put("/{mask_id}")
def update_mask(mask_id: str, data: MaskUpdate):
    result = mask_service.update_mask(mask_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Mask not found")
    return result


@router.delete("/{mask_id}")
def delete_mask(mask_id: str):
    success = mask_service.delete_mask(mask_id)
    if not success:
        raise HTTPException(status_code=404, detail="Mask not found")
    return {"deleted": True}