"""
Analytics REST API Routes
Implements ONVIF Analytics Service endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel

from analytics_service import AnalyticsService
from analytics_capabilities import capability_detector
from analytics_rules_engine import rules_engine

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

# Initialize services
analytics_service = AnalyticsService()


# ============================================
# Request/Response Models
# ============================================

class CreateRuleRequest(BaseModel):
    rule_name: str
    rule_type: str
    parameters: Dict[str, Any] = {}
    is_active: bool = True


class UpdateRuleRequest(BaseModel):
    parameters: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class CreateConfigRequest(BaseModel):
    config_token: str
    profile_token: str
    name: str


class RuleResponse(BaseModel):
    rule_name: str
    rule_type: str
    parameters: Dict[str, Any]
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ============================================
# Device Capabilities Endpoints
# ============================================

@router.get("/devices/{device_id}/capabilities")
async def get_device_capabilities(device_id: str):
    """
    Get analytics capabilities for a device (Section 6.4)
    """
    caps = await capability_detector.get_cached_capabilities(device_id)
    if not caps:
        # Try to detect
        # caps = await capability_detector.detect_capabilities(device, device_id)
        return {"device_id": device_id, "message": "Capabilities not yet detected"}
    
    return capability_detector.get_capabilities_summary(device_id)


@router.get("/devices/{device_id}/capabilities/detect")
async def detect_capabilities(device_id: str):
    """
    Force detect analytics capabilities from device
    """
    # This would need an ONVIF device instance
    # For now, return mock data
    return {
        "device_id": device_id,
        "rule_support": True,
        "supported_rule_types": [
            "tt:LineDetector",
            "tt:FieldDetector", 
            "tt:ObjectDetection"
        ],
        "max_rules": 10
    }


# ============================================
# Analytics Configuration Endpoints (Section 6.3)
# ============================================

@router.post("/devices/{device_id}/configurations")
async def create_analytics_config(device_id: str, request: CreateConfigRequest):
    """
    Create an analytics configuration
    """
    config = await analytics_service.create_analytics_config(
        device_id=device_id,
        config_token=request.config_token,
        profile_token=request.profile_token,
        name=request.name
    )
    return config


@router.get("/devices/{device_id}/configurations/{config_token}")
async def get_analytics_config(device_id: str, config_token: str):
    """
    Get analytics configuration
    """
    config = await analytics_service.get_analytics_config(device_id, config_token)
    if not config:
        raise HTTPException(status_code=404, detail="Configuration not found")
    return config


# ============================================
# Rule Management Endpoints (Section 6.2)
# ============================================

@router.get("/devices/{device_id}/configurations/{config_token}/rules")
async def get_rules(device_id: str, config_token: str):
    """
    Get all rules for a configuration (Section 6.2.3.2)
    """
    rules = await analytics_service.get_rules(device_id, config_token)
    return {"rules": rules, "count": len(rules)}


@router.get("/devices/{device_id}/configurations/{config_token}/rules/{rule_name}")
async def get_rule(device_id: str, config_token: str, rule_name: str):
    """
    Get a specific rule
    """
    rule = await analytics_service.get_rule(device_id, config_token, rule_name)
    if not rule:
        raise HTTPException(status_code=404, detail=f"Rule '{rule_name}' not found")
    return rule


@router.post("/devices/{device_id}/configurations/{config_token}/rules")
async def create_rule(device_id: str, config_token: str, request: CreateRuleRequest):
    """
    Create a new rule (Section 6.2.3.3)
    """
    # Check if rule already exists
    existing = await analytics_service.get_rule(device_id, config_token, request.rule_name)
    if existing:
        raise HTTPException(status_code=409, detail=f"Rule '{request.rule_name}' already exists")
    
    # Validate rule type
    from models.analytics_models import RuleType
    try:
        rule_type = RuleType(request.rule_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid rule type: {request.rule_type}")
    
    try:
        rule = await analytics_service.create_rule(
            device_id=device_id,
            config_token=config_token,
            rule_name=request.rule_name,
            rule_type=rule_type,
            parameters=request.parameters
        )
        
        # Load rule into engine if active
        if request.is_active:
            await rules_engine.load_rule(rule)
        
        return rule
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/devices/{device_id}/configurations/{config_token}/rules/{rule_name}")
async def update_rule(device_id: str, config_token: str, rule_name: str, request: UpdateRuleRequest):
    """
    Update a rule (Section 6.2.3.4)
    """
    updates = {}
    if request.parameters is not None:
        updates["parameters"] = request.parameters
    if request.is_active is not None:
        updates["is_active"] = request.is_active
    
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    
    success = await analytics_service.update_rule(device_id, config_token, rule_name, updates)
    if not success:
        raise HTTPException(status_code=404, detail=f"Rule '{rule_name}' not found")
    
    # Reload rule in engine if status changed
    if "is_active" in updates:
        updated_rule = await analytics_service.get_rule(device_id, config_token, rule_name)
        if updated_rule:
            if updated_rule["is_active"]:
                await rules_engine.load_rule(updated_rule)
            else:
                await rules_engine.unload_rule(rule_name)
    
    return {"message": f"Rule '{rule_name}' updated"}


@router.delete("/devices/{device_id}/configurations/{config_token}/rules/{rule_name}")
async def delete_rule(device_id: str, config_token: str, rule_name: str):
    """
    Delete a rule (Section 6.2.3.5)
    """
    success = await analytics_service.delete_rule(device_id, config_token, rule_name)
    if not success:
        raise HTTPException(status_code=404, detail=f"Rule '{rule_name}' not found")
    
    # Unload from engine
    await rules_engine.unload_rule(rule_name)
    
    return {"message": f"Rule '{rule_name}' deleted"}


@router.get("/devices/{device_id}/configurations/{config_token}/rules/options")
async def get_rule_options(device_id: str, config_token: str, rule_type: Optional[str] = None):
    """
    Get rule configuration options (Section 6.2.3.6)
    """
    options = await analytics_service.get_rule_options(device_id, rule_type)
    return {"rule_options": options}


# ============================================
# Analytics Events Endpoints
# ============================================

@router.get("/devices/{device_id}/events")
async def get_analytics_events(
    device_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    rule_name: Optional[str] = None
):
    """
    Get analytics events for a device
    """
    events = await analytics_service.get_events(device_id, limit, offset, rule_name)
    return {"events": events, "count": len(events)}


@router.post("/devices/{device_id}/events/{event_id}/acknowledge")
async def acknowledge_event(device_id: str, event_id: str):
    """
    Acknowledge an analytics event
    """
    success = await analytics_service.acknowledge_event(event_id)
    if not success:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"message": "Event acknowledged"}


# ============================================
# Detected Objects Endpoints
# ============================================

@router.get("/devices/{device_id}/objects")
async def get_detected_objects(
    device_id: str,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    class_type: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000)
):
    """
    Get detected objects within time range
    """
    if not start_time:
        from datetime import timedelta
        start_time = datetime.utcnow() - timedelta(hours=24)
    if not end_time:
        end_time = datetime.utcnow()
    
    objects = await analytics_service.get_objects(device_id, start_time, end_time, class_type)
    return {"objects": objects[:limit], "count": len(objects)}


# ============================================
# Face Recognition Endpoints
# ============================================

@router.get("/devices/{device_id}/face-matches")
async def get_face_matches(device_id: str, limit: int = Query(50, ge=1, le=200)):
    """
    Get face recognition matches
    """
    matches = await analytics_service.get_face_matches(device_id, limit)
    return {"matches": matches, "count": len(matches)}


@router.post("/devices/{device_id}/face-matches")
async def create_face_match(device_id: str, match_data: Dict[str, Any]):
    """
    Store a face match event (for testing/webhook)
    """
    from models.analytics_models import FaceMatchEvent
    
    match = FaceMatchEvent(
        device_id=device_id,
        enrollment_id=match_data["enrollment_id"],
        person_name=match_data.get("person_name"),
        object_id=match_data.get("object_id"),
        likelihood=match_data.get("likelihood", 1.0),
        image_uri=match_data.get("image_uri")
    )
    
    match_id = await analytics_service.store_face_match(match)
    return {"match_id": match_id}


# ============================================
# License Plate Recognition Endpoints
# ============================================

@router.get("/devices/{device_id}/lpr-matches")
async def get_lpr_matches(
    device_id: str, 
    limit: int = Query(50, ge=1, le=200),
    plate_number: Optional[str] = None
):
    """
    Get license plate recognition matches
    """
    matches = await analytics_service.get_lpr_matches(device_id, limit, plate_number)
    return {"matches": matches, "count": len(matches)}


@router.post("/devices/{device_id}/lpr-matches")
async def create_lpr_match(device_id: str, match_data: Dict[str, Any]):
    """
    Store an LPR match event (for testing/webhook)
    """
    from models.analytics_models import LPRMatchEvent
    
    match = LPRMatchEvent(
        device_id=device_id,
        plate_number=match_data["plate_number"],
        country_code=match_data.get("country_code"),
        object_id=match_data.get("object_id"),
        vehicle_type=match_data.get("vehicle_type"),
        likelihood=match_data.get("likelihood", 1.0),
        speed=match_data.get("speed"),
        direction=match_data.get("direction"),
        image_uri=match_data.get("image_uri")
    )
    
    match_id = await analytics_service.store_lpr_match(match)
    return {"match_id": match_id}


# ============================================
# Statistics Dashboard
# ============================================

@router.get("/devices/{device_id}/statistics")
async def get_analytics_statistics(device_id: str, days: int = Query(7, ge=1, le=30)):
    """
    Get analytics statistics for dashboard
    """
    stats = await analytics_service.get_statistics(device_id, days)
    return stats


# ============================================
# Health Check
# ============================================

@router.get("/health")
async def health_check():
    """Check analytics service health"""
    return {
        "status": "healthy",
        "service": "analytics",
        "timestamp": datetime.utcnow().isoformat()
    }