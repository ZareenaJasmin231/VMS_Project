from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


class MaskPoint(BaseModel):
    x: float
    y: float


class MaskPolygon(BaseModel):
    points: List[MaskPoint]


class MaskCreate(BaseModel):
    camera_id: str
    label: str = "Zone 1"
    enabled: bool = True
    color: str = "#000000"
    opacity: float = 1.0
    polygons: List[MaskPolygon]


class MaskUpdate(BaseModel):
    label: Optional[str] = None
    enabled: Optional[bool] = None
    color: Optional[str] = None
    opacity: Optional[float] = None
    polygons: Optional[List[MaskPolygon]] = None


class MaskResponse(BaseModel):
    id: str
    camera_id: str
    label: str
    enabled: bool
    color: str
    opacity: float
    polygons: List[MaskPolygon]
    created_at: datetime

    class Config:
        populate_by_name = True