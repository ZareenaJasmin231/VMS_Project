"""
Core ONVIF Analytics Service
Handles analytics module configuration and rule management
Based on ONVIF Analytics Service Specification Ver 25.12
"""

import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from bson import ObjectId
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError

from models.analytics_models import (
    AnalyticsConfig, AnalyticsRule, AnalyticsEvent, 
    RuleType, EventType, DetectedObject, Frame,
    AnalyticsCapabilities, FaceMatchEvent, LPRMatchEvent
)
from analytics_capabilities import capability_detector

logger = logging.getLogger(__name__)


class AnalyticsService:
    """Main analytics service for Mirador VMS"""
    
    def __init__(self, mongodb_url: str = "mongodb://localhost:27017/", db_name: str = "mirador_vms"):
        self.client = MongoClient(mongodb_url)
        self.db = self.client[db_name]
        
        # Collections
        self.configs_col = self.db["analytics_configs"]
        self.rules_col = self.db["analytics_rules"]
        self.objects_col = self.db["analytics_objects"]
        self.events_col = self.db["analytics_events"]
        self.face_matches_col = self.db["analytics_face_matches"]
        self.lpr_matches_col = self.db["analytics_lpr_matches"]
        self.audio_events_col = self.db["analytics_audio_events"]
        
        logger.info("AnalyticsService initialized")
    
    # ============================================
    # Analytics Configuration Methods (Section 6.3)
    # ============================================
    
    async def get_analytics_config(self, device_id: str, config_token: str) -> Optional[Dict]:
        """Get analytics configuration for a device"""
        result = self.configs_col.find_one({
            "device_id": device_id,
            "config_token": config_token
        })
        if result:
            result["_id"] = str(result["_id"])
        return result
    
    async def create_analytics_config(self, device_id: str, config_token: str, 
                                       profile_token: str, name: str) -> Dict:
        """Create a new analytics configuration"""
        config = {
            "device_id": device_id,
            "config_token": config_token,
            "profile_token": profile_token,
            "name": name,
            "modules": [],
            "rules": [],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        
        try:
            result = self.configs_col.insert_one(config)
            config["_id"] = str(result.inserted_id)
            logger.info(f"Created analytics config {config_token} for device {device_id}")
            return config
        except DuplicateKeyError:
            logger.warning(f"Config {config_token} already exists for device {device_id}")
            return await self.get_analytics_config(device_id, config_token)
    
    # ============================================
    # Rule Management Methods (Section 6.2)
    # ============================================
    
    async def get_rules(self, device_id: str, config_token: str) -> List[Dict]:
        """Get all rules for a configuration (Section 6.2.3.2)"""
        rules = list(self.rules_col.find({
            "device_id": device_id,
            "config_token": config_token
        }))
        
        for rule in rules:
            rule["_id"] = str(rule["_id"])
        return rules
    
    async def get_rule(self, device_id: str, config_token: str, rule_name: str) -> Optional[Dict]:
        """Get a specific rule by name"""
        rule = self.rules_col.find_one({
            "device_id": device_id,
            "config_token": config_token,
            "rule_name": rule_name
        })
        if rule:
            rule["_id"] = str(rule["_id"])
        return rule
    
    async def create_rule(self, device_id: str, config_token: str, 
                          rule_name: str, rule_type: RuleType, 
                          parameters: Dict) -> Dict:
        """Create a new rule (Section 6.2.3.3)"""
        
        # Check if rule already exists
        existing = await self.get_rule(device_id, config_token, rule_name)
        if existing:
            raise ValueError(f"Rule '{rule_name}' already exists")
        
        rule = {
            "device_id": device_id,
            "config_token": config_token,
            "rule_name": rule_name,
            "rule_type": rule_type.value,
            "parameters": parameters,
            "is_active": True,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        
        result = self.rules_col.insert_one(rule)
        rule["_id"] = str(result.inserted_id)
        
        # Also update the config's rules list
        self.configs_col.update_one(
            {"device_id": device_id, "config_token": config_token},
            {"$push": {"rules": rule_name}, "$set": {"updated_at": datetime.utcnow()}}
        )
        
        logger.info(f"Created rule '{rule_name}' of type {rule_type.value} for device {device_id}")
        return rule
    
    async def update_rule(self, device_id: str, config_token: str, 
                          rule_name: str, updates: Dict) -> bool:
        """Update an existing rule (Section 6.2.3.4)"""
        update_data = {"updated_at": datetime.utcnow()}
        
        if "parameters" in updates:
            update_data["parameters"] = updates["parameters"]
        if "is_active" in updates:
            update_data["is_active"] = updates["is_active"]
        
        result = self.rules_col.update_one(
            {"device_id": device_id, "config_token": config_token, "rule_name": rule_name},
            {"$set": update_data}
        )
        
        if result.modified_count > 0:
            logger.info(f"Updated rule '{rule_name}' for device {device_id}")
            return True
        return False
    
    async def delete_rule(self, device_id: str, config_token: str, rule_name: str) -> bool:
        """Delete a rule (Section 6.2.3.5)"""
        result = self.rules_col.delete_one({
            "device_id": device_id,
            "config_token": config_token,
            "rule_name": rule_name
        })
        
        if result.deleted_count > 0:
            # Remove from config's rules list
            self.configs_col.update_one(
                {"device_id": device_id, "config_token": config_token},
                {"$pull": {"rules": rule_name}}
            )
            logger.info(f"Deleted rule '{rule_name}' for device {device_id}")
            return True
        return False
    
    # ============================================
    # Rule Options (Section 6.2.3.6)
    # ============================================
    
    async def get_rule_options(self, device_id: str, rule_type: Optional[str] = None) -> Dict:
        """Get available options for rule configuration"""
        
        # Default options based on ONVIF specification
        options = {
            "tt:LineDetector": {
                "Direction": {"type": "string", "values": ["Left", "Right", "Any"]},
                "ClassFilter": {"type": "string_list", "values": ["Vehicle", "Person", "Animal", "Bicycle"]},
                "Segments": {"type": "polyline", "min_points": 2, "max_points": 10}
            },
            "tt:FieldDetector": {
                "Field": {"type": "polygon", "min_points": 3, "max_points": 100}
            },
            "tt:LoiteringDetector": {
                "TimeThreshold": {"type": "duration", "min": "PT1S", "max": "PT1H"},
                "Field": {"type": "polygon", "min_points": 3, "max_points": 100}
            },
            "tt:ObjectDetection": {
                "ClassFilter": {"type": "string_list", "values": ["Person", "Vehicle", "Face", "LicensePlate"]},
                "ConfidenceLevel": {"type": "float", "min": 0.0, "max": 1.0},
                "DwellTime": {"type": "duration", "min": "PT0S", "max": "PT10S"}
            },
            "tt:FaceRecognition": {
                "Threshold": {"type": "float", "min": 0.0, "max": 1.0},
                "IncludeImage": {"type": "string", "values": ["Embedded", "LocalStorage", "RemoteStorage"]}
            },
            "tt:LicensePlateRecognition": {
                "Country": {"type": "string_list", "values": ["US", "GB", "DE", "FR", "JP", "CN"]},
                "Sensitivity": {"type": "float", "min": 0.0, "max": 1.0},
                "Threshold": {"type": "float", "min": 0.0, "max": 1.0}
            }
        }
        
        # Check device capabilities to filter options
        caps = await capability_detector.get_cached_capabilities(device_id)
        if caps:
            # Only return options for rules the device supports
            supported_types = [rt.value for rt in caps.supported_rule_types]
            options = {k: v for k, v in options.items() if k in supported_types}
        
        if rule_type and rule_type in options:
            return {rule_type: options[rule_type]}
        
        return options
    
    # ============================================
    # Analytics Events Storage
    # ============================================
    
    async def store_analytics_event(self, event: AnalyticsEvent) -> str:
        """Store an analytics rule trigger event"""
        event_dict = event.model_dump(exclude={'id'})
        event_dict["triggered_at"] = datetime.utcnow()
        
        result = self.events_col.insert_one(event_dict)
        logger.info(f"Stored analytics event: {event.event_type} for rule {event.rule_name}")
        return str(result.inserted_id)
    
    async def get_events(self, device_id: str, limit: int = 100, 
                         offset: int = 0, rule_name: Optional[str] = None) -> List[Dict]:
        """Get analytics events for a device"""
        query = {"device_id": device_id}
        if rule_name:
            query["rule_name"] = rule_name
        
        events = list(self.events_col.find(query)
                      .sort("triggered_at", DESCENDING)
                      .skip(offset)
                      .limit(limit))
        
        for event in events:
            event["_id"] = str(event["_id"])
        return events
    
    async def acknowledge_event(self, event_id: str) -> bool:
        """Mark an event as acknowledged"""
        result = self.events_col.update_one(
            {"_id": ObjectId(event_id)},
            {"$set": {"is_acknowledged": True, "acknowledged_at": datetime.utcnow()}}
        )
        return result.modified_count > 0
    
    # ============================================
    # Detected Objects Storage
    # ============================================
    
    async def store_detected_objects(self, device_id: str, frame: Frame) -> List[str]:
        """Store detected objects from a metadata frame"""
        object_ids = []
        
        for obj in frame.objects:
            obj_dict = {
                "device_id": device_id,
                "object_id": obj.object_id,
                "object_uuid": obj.uuid,
                "parent_object_id": obj.parent_id,
                "frame_time": frame.utc_time,
                "class_type": obj.appearance.class_types[0].type_name if obj.appearance.class_types else None,
                "likelihood": obj.appearance.class_types[0].likelihood if obj.appearance.class_types else 1.0,
                "bounding_box": obj.appearance.bounding_box.model_dump() if obj.appearance.bounding_box else None,
                "metadata": obj.model_dump(),
                "created_at": datetime.utcnow()
            }
            
            result = self.objects_col.insert_one(obj_dict)
            object_ids.append(str(result.inserted_id))
        
        return object_ids
    
    async def get_objects(self, device_id: str, start_time: datetime, 
                          end_time: datetime, class_type: Optional[str] = None) -> List[Dict]:
        """Get detected objects within time range"""
        query = {
            "device_id": device_id,
            "frame_time": {"$gte": start_time, "$lte": end_time}
        }
        if class_type:
            query["class_type"] = class_type
        
        objects = list(self.objects_col.find(query).sort("frame_time", DESCENDING))
        for obj in objects:
            obj["_id"] = str(obj["_id"])
        return objects
    
    # ============================================
    # Face Recognition Storage
    # ============================================
    
    async def store_face_match(self, match: FaceMatchEvent) -> str:
        """Store a face recognition match"""
        match_dict = match.model_dump(exclude={'id'})
        match_dict["matched_at"] = datetime.utcnow()
        
        result = self.face_matches_col.insert_one(match_dict)
        logger.info(f"Stored face match for enrollment {match.enrollment_id}")
        return str(result.inserted_id)
    
    async def get_face_matches(self, device_id: str, limit: int = 50) -> List[Dict]:
        """Get recent face matches"""
        matches = list(self.face_matches_col.find({"device_id": device_id})
                       .sort("matched_at", DESCENDING)
                       .limit(limit))
        
        for match in matches:
            match["_id"] = str(match["_id"])
        return matches
    
    # ============================================
    # License Plate Recognition Storage
    # ============================================
    
    async def store_lpr_match(self, match: LPRMatchEvent) -> str:
        """Store a license plate recognition match"""
        match_dict = match.model_dump(exclude={'id'})
        match_dict["matched_at"] = datetime.utcnow()
        
        result = self.lpr_matches_col.insert_one(match_dict)
        logger.info(f"Stored LPR match for plate {match.plate_number}")
        return str(result.inserted_id)
    
    async def get_lpr_matches(self, device_id: str, limit: int = 50, 
                               plate_number: Optional[str] = None) -> List[Dict]:
        """Get recent license plate matches"""
        query = {"device_id": device_id}
        if plate_number:
            query["plate_number"] = plate_number
        
        matches = list(self.lpr_matches_col.find(query)
                       .sort("matched_at", DESCENDING)
                       .limit(limit))
        
        for match in matches:
            match["_id"] = str(match["_id"])
        return matches
    
    # ============================================
    # Statistics & Dashboard
    # ============================================
    
    async def get_statistics(self, device_id: str, days: int = 7) -> Dict:
        """Get analytics statistics for dashboard"""
        from datetime import timedelta
        
        since = datetime.utcnow() - timedelta(days=days)
        
        # Count events by type
        event_stats = list(self.events_col.aggregate([
            {"$match": {"device_id": device_id, "triggered_at": {"$gte": since}}},
            {"$group": {"_id": "$event_type", "count": {"$sum": 1}}}
        ]))
        
        # Count objects by class
        object_stats = list(self.objects_col.aggregate([
            {"$match": {"device_id": device_id, "frame_time": {"$gte": since}}},
            {"$group": {"_id": "$class_type", "count": {"$sum": 1}}}
        ]))
        
        # Count face matches
        face_count = self.face_matches_col.count_documents({
            "device_id": device_id,
            "matched_at": {"$gte": since}
        })
        
        # Count LPR matches
        lpr_count = self.lpr_matches_col.count_documents({
            "device_id": device_id,
            "matched_at": {"$gte": since}
        })
        
        return {
            "device_id": device_id,
            "period_days": days,
            "total_events": sum(s["count"] for s in event_stats),
            "events_by_type": {s["_id"]: s["count"] for s in event_stats},
            "total_objects_detected": sum(s["count"] for s in object_stats),
            "objects_by_class": {s["_id"]: s["count"] for s in object_stats if s["_id"]},
            "face_matches": face_count,
            "lpr_matches": lpr_count,
            "active_rules": self.rules_col.count_documents({"device_id": device_id, "is_active": True})
        }
    
    def close(self):
        """Close MongoDB connection"""
        self.client.close()