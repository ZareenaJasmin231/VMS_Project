"""
Analytics Models for MongoDB
Defines data structures for ONVIF Analytics Service
"""

from datetime import datetime
from typing import List, Optional, Dict, Any, Union
from enum import Enum
from pydantic import BaseModel, Field, field_validator
from bson import ObjectId
from pydantic import ConfigDict


# ============================================
# Enums for Rule Types (ONVIF Specification)
# ============================================

class RuleType(str, Enum):
    """Supported rule types from ONVIF Analytics Spec Annex A"""
    LINE_DETECTOR = "tt:LineDetector"           # A.2 - Line crossing
    FIELD_DETECTOR = "tt:FieldDetector"         # A.3 - Field/area detection
    LOITERING_DETECTOR = "tt:LoiteringDetector" # A.4 - Loitering
    LINE_COUNTING = "tt:LineCounting"           # A.5 - Line crossing count
    OCCUPANCY_COUNTING = "tt:OccupancyCounting" # A.6 - Occupancy
    OBJECT_DETECTION = "tt:ObjectDetection"     # A.7 - Object detection
    OBJECT_ABANDONED = "tt:ObjectAbandoned"     # A.8 - Abandoned object
    OBJECT_REMOVED = "tt:ObjectRemoved"         # A.9 - Object removal
    FACE_RECOGNITION = "tt:FaceRecognition"     # G.2 - Face recognition
    LICENSE_PLATE = "tt:LicensePlateRecognition" # G.3 - LPR
    MOTION_REGION = "tt:MotionRegionDetector"   # C.1 - Motion detection
    TAMPERING = "tt:TamperingDetection"         # E.1 - Tampering
    AUDIO_CLASS = "tt:AudioClassDetector"       # H.1 - Audio classification


class Direction(str, Enum):
    """Direction for line crossing"""
    LEFT = "Left"
    RIGHT = "Right"
    ANY = "Any"


class EventType(str, Enum):
    """Analytics event types"""
    CROSSED = "crossed"
    INSIDE = "inside"
    LOITERING = "loitering"
    OBJECT_DETECTED = "object_detected"
    ABANDONED = "abandoned"
    REMOVED = "removed"
    FACE_MATCH = "face_match"
    PLATE_MATCH = "plate_match"
    MOTION = "motion"
    TAMPERING = "tampering"
    AUDIO_DETECTED = "audio_detected"


# ============================================
# Geometry Models (Section 5.2.2)
# ============================================

class Point(BaseModel):
    """Point in normalized coordinates"""
    x: float = Field(..., ge=-1.0, le=1.0, description="X coordinate (-1 to 1)")
    y: float = Field(..., ge=-1.0, le=1.0, description="Y coordinate (-1 to 1)")


class Vector(BaseModel):
    """Vector for transformations"""
    x: float = 0.0
    y: float = 0.0


class Transformation(BaseModel):
    """Coordinate system transformation (Section 5.2.2)"""
    translate: Optional[Vector] = None
    scale: Optional[Vector] = None


class BoundingBox(BaseModel):
    """Object bounding box (Section 5.3.4)"""
    left: float = Field(..., ge=-1.0, le=1.0)
    top: float = Field(..., ge=-1.0, le=1.0)
    right: float = Field(..., ge=-1.0, le=1.0)
    bottom: float = Field(..., ge=-1.0, le=1.0)
    
    @property
    def width(self) -> float:
        return abs(self.right - self.left)
    
    @property
    def height(self) -> float:
        return abs(self.bottom - self.top)
    
    @property
    def center(self) -> Point:
        return Point(
            x=(self.left + self.right) / 2,
            y=(self.top + self.bottom) / 2
        )


class Polygon(BaseModel):
    """Polygon shape (Section 5.3.4)"""
    points: List[Point] = Field(..., min_length=3)


class Polyline(BaseModel):
    """Polyline for line detectors (Section A.2)"""
    points: List[Point] = Field(..., min_length=2)


# ============================================
# Object Models (Section 5.3)
# ============================================

class ClassType(BaseModel):
    """Object class descriptor (Section 5.3.6)"""
    type_name: str
    likelihood: float = Field(1.0, ge=0.0, le=1.0)


class ColorCluster(BaseModel):
    """Color cluster descriptor (Section 5.3.5)"""
    color: Dict[str, float]  # Y, Cb, Cr or R, G, B
    weight: Optional[float] = Field(None, ge=0.0, le=1.0)
    likelihood: Optional[float] = Field(None, ge=0.0, le=1.0)


class Appearance(BaseModel):
    """Object appearance (Section 5.3.1)"""
    bounding_box: Optional[BoundingBox] = None
    polygon: Optional[Polygon] = None
    class_types: List[ClassType] = Field(default_factory=list)
    colors: List[ColorCluster] = Field(default_factory=list)
    transformation: Optional[Transformation] = None


class Behavior(BaseModel):
    """Object behavior (Section 5.3.1)"""
    is_idle: bool = False
    is_removed: bool = False
    speed: Optional[float] = Field(None, description="Speed in meters/second")
    direction: Optional[str] = None


class LicensePlateInfo(BaseModel):
    """License plate information (Section 5.3.12)"""
    plate_number: str
    likelihood: float = Field(1.0, ge=0.0, le=1.0)
    country_code: Optional[str] = Field(None, max_length=2)
    plate_type: Optional[str] = None
    issuing_entity: Optional[str] = None
    color: Optional[str] = None


class FaceInfo(BaseModel):
    """Face information (Section 5.3.14)"""
    gender: Optional[str] = None
    age_min: Optional[int] = None
    age_max: Optional[int] = None
    glasses: Optional[bool] = None
    facial_hair: Optional[bool] = None
    enrollment_id: Optional[str] = None
    confidence: float = Field(1.0, ge=0.0, le=1.0)


class VehicleInfo(BaseModel):
    """Vehicle information (Section 5.3.8)"""
    vehicle_type: Optional[str] = None  # Car, Truck, Bus, Motorcycle, Bicycle
    brand: Optional[str] = None
    model: Optional[str] = None
    color: Optional[str] = None
    likelihood: float = Field(1.0, ge=0.0, le=1.0)


class DetectedObject(BaseModel):
    """Detected object from analytics (Section 5.3.1)"""
    object_id: int
    uuid: Optional[str] = None
    parent_id: Optional[int] = None
    appearance: Appearance
    behavior: Optional[Behavior] = None
    license_plate: Optional[LicensePlateInfo] = None
    face: Optional[FaceInfo] = None
    vehicle: Optional[VehicleInfo] = None
    frame_time: datetime


# ============================================
# Rule Configuration Models (Section 6.2)
# ============================================

class RuleParameter(BaseModel):
    """Individual rule parameter"""
    name: str
    value: Any


class AnalyticsRule(BaseModel):
    """Analytics rule configuration (Section 6.2.1)"""
    id: Optional[str] = Field(default=None, alias="_id")
    device_id: str
    config_token: str
    rule_name: str
    rule_type: RuleType
    parameters: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)


class AnalyticsConfig(BaseModel):
    """Analytics module configuration (Section 6.3.1)"""
    id: Optional[str] = Field(default=None, alias="_id")
    device_id: str
    config_token: str
    profile_token: Optional[str] = None
    name: str
    modules: List[Dict[str, Any]] = Field(default_factory=list)
    rules: List[AnalyticsRule] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)


# ============================================
# Analytics Event Models
# ============================================

class AnalyticsEvent(BaseModel):
    """Analytics rule trigger event"""
    id: Optional[str] = Field(default=None, alias="_id")
    device_id: str
    config_token: str
    rule_name: str
    rule_type: RuleType
    event_type: EventType
    object_ids: List[int] = Field(default_factory=list)
    event_data: Dict[str, Any] = Field(default_factory=dict)
    triggered_at: datetime = Field(default_factory=datetime.utcnow)
    is_acknowledged: bool = False
    acknowledged_at: Optional[datetime] = None
    
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)


class FaceMatchEvent(BaseModel):
    """Face recognition match event"""
    id: Optional[str] = Field(default=None, alias="_id")
    device_id: str
    enrollment_id: str
    object_id: Optional[int] = None
    person_name: Optional[str] = None
    likelihood: float = Field(..., ge=0.0, le=1.0)
    image_uri: Optional[str] = None
    bounding_box: Optional[BoundingBox] = None
    matched_at: datetime = Field(default_factory=datetime.utcnow)
    
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)


class LPRMatchEvent(BaseModel):
    """License plate recognition match event"""
    id: Optional[str] = Field(default=None, alias="_id")
    device_id: str
    plate_number: str
    country_code: Optional[str] = None
    object_id: Optional[int] = None
    vehicle_type: Optional[str] = None
    likelihood: float = Field(..., ge=0.0, le=1.0)
    speed: Optional[float] = None
    direction: Optional[str] = None
    image_uri: Optional[str] = None
    matched_at: datetime = Field(default_factory=datetime.utcnow)
    
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)


# ============================================
# Scene Description Models (Section 5)
# ============================================

class Frame(BaseModel):
    """Video frame with analytics data (Section 5.2)"""
    utc_time: datetime
    source: Optional[str] = None
    transformation: Optional[Transformation] = None
    objects: List[DetectedObject] = Field(default_factory=list)
    ptz_status: Optional[Dict[str, Any]] = None


class MetadataStream(BaseModel):
    """Complete metadata stream"""
    frames: List[Frame] = Field(default_factory=list)


# ============================================
# Capability Models
# ============================================

class AnalyticsCapabilities(BaseModel):
    """Device analytics capabilities (Section 6.4)"""
    device_id: str
    rule_support: bool = False
    analytics_module_support: bool = False
    cell_based_scene_support: bool = False
    rule_options_supported: bool = False
    analytics_module_options_support: bool = False
    supported_metadata: bool = False
    image_sending_types: List[str] = Field(default_factory=list)
    supported_rule_types: List[RuleType] = Field(default_factory=list)
    max_rules: int = 10
    max_modules: int = 5
    updated_at: datetime = Field(default_factory=datetime.utcnow)