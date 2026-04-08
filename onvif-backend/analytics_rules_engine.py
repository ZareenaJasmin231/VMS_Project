"""
Analytics Rules Engine
Processes rules against incoming metadata (Section 6.2)
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from collections import defaultdict

from models.analytics_models import (
    Frame, DetectedObject, AnalyticsEvent, EventType,
    RuleType, Point, Polyline, Polygon
)

logger = logging.getLogger(__name__)


class AnalyticsRulesEngine:
    """Engine for evaluating analytics rules against scene descriptions"""
    
    def __init__(self):
        self.active_rules: Dict[str, Dict] = {}
        self.object_tracks: Dict[str, Dict] = defaultdict(dict)
    
    async def load_rule(self, rule: Dict):
        """Load a rule into the engine"""
        self.active_rules[rule["rule_name"]] = rule
        logger.info(f"Loaded rule: {rule['rule_name']}")
    
    async def unload_rule(self, rule_name: str):
        """Unload a rule from the engine"""
        if rule_name in self.active_rules:
            del self.active_rules[rule_name]
            logger.info(f"Unloaded rule: {rule_name}")
    
    async def process_frame(self, device_id: str, frame: Frame) -> List[AnalyticsEvent]:
        """Process a frame against all active rules"""
        events = []
        
        for rule_name, rule in self.active_rules.items():
            if not rule.get("is_active", True):
                continue
            
            rule_type = rule["rule_type"]
            parameters = rule.get("parameters", {})
            
            # Evaluate based on rule type
            if rule_type == RuleType.LINE_DETECTOR.value:
                events.extend(await self._evaluate_line_detector(
                    device_id, rule_name, parameters, frame
                ))
            elif rule_type == RuleType.FIELD_DETECTOR.value:
                events.extend(await self._evaluate_field_detector(
                    device_id, rule_name, parameters, frame
                ))
            elif rule_type == RuleType.OBJECT_DETECTION.value:
                events.extend(await self._evaluate_object_detection(
                    device_id, rule_name, parameters, frame
                ))
            elif rule_type == RuleType.LOITERING_DETECTOR.value:
                events.extend(await self._evaluate_loitering_detector(
                    device_id, rule_name, parameters, frame
                ))
        
        return events
    
    async def _evaluate_line_detector(self, device_id: str, rule_name: str,
                                        parameters: Dict, frame: Frame) -> List[AnalyticsEvent]:
        """
        Line Detector Rule (Section A.2)
        Triggers when an object crosses a polyline
        """
        events = []
        
        # Get line segments from parameters
        segments_data = parameters.get("Segments", {})
        if not segments_data:
            return events
        
        # Parse polyline points
        points = []
        for point_data in segments_data.get("points", []):
            points.append(Point(x=point_data["x"], y=point_data["y"]))
        
        direction = parameters.get("Direction", "Any")
        class_filter = parameters.get("ClassFilter", [])
        
        # Check each object in frame
        for obj in frame.objects:
            # Apply class filter
            if class_filter:
                obj_classes = [c.type_name for c in obj.appearance.class_types]
                if not any(c in class_filter for c in obj_classes):
                    continue
            
            # Get object center point
            if obj.appearance.bounding_box:
                center = obj.appearance.bounding_box.center
                
                # Check if object crossed the line (simplified)
                crossed = self._check_line_crossing(points, center)
                
                if crossed:
                    events.append(AnalyticsEvent(
                        device_id=device_id,
                        config_token="",  # Will be filled by caller
                        rule_name=rule_name,
                        rule_type=RuleType.LINE_DETECTOR,
                        event_type=EventType.CROSSED,
                        object_ids=[obj.object_id],
                        event_data={
                            "direction": direction,
                            "position": {"x": center.x, "y": center.y}
                        }
                    ))
        
        return events
    
    async def _evaluate_field_detector(self, device_id: str, rule_name: str,
                                         parameters: Dict, frame: Frame) -> List[AnalyticsEvent]:
        """
        Field Detector Rule (Section A.3)
        Triggers when objects enter/exit a polygon area
        """
        events = []
        
        # Get field polygon from parameters
        field_data = parameters.get("Field", {})
        if not field_data:
            return events
        
        # Parse polygon points
        points = []
        for point_data in field_data.get("points", []):
            points.append(Point(x=point_data["x"], y=point_data["y"]))
        
        class_filter = parameters.get("ClassFilter", [])
        
        # Track objects inside field
        for obj in frame.objects:
            # Apply class filter
            if class_filter:
                obj_classes = [c.type_name for c in obj.appearance.class_types]
                if not any(c in class_filter for c in obj_classes):
                    continue
            
            if obj.appearance.bounding_box:
                center = obj.appearance.bounding_box.center
                
                # Check if inside polygon
                is_inside = self._point_in_polygon(center, points)
                
                # Check previous state
                track_key = f"{rule_name}_{obj.object_id}"
                prev_state = self.object_tracks[track_key].get("inside_field", False)
                
                if is_inside != prev_state:
                    events.append(AnalyticsEvent(
                        device_id=device_id,
                        config_token="",
                        rule_name=rule_name,
                        rule_type=RuleType.FIELD_DETECTOR,
                        event_type=EventType.INSIDE if is_inside else EventType.CROSSED,
                        object_ids=[obj.object_id],
                        event_data={
                            "is_inside": is_inside,
                            "position": {"x": center.x, "y": center.y}
                        }
                    ))
                    
                    self.object_tracks[track_key]["inside_field"] = is_inside
        
        return events
    
    async def _evaluate_object_detection(self, device_id: str, rule_name: str,
                                           parameters: Dict, frame: Frame) -> List[AnalyticsEvent]:
        """
        Object Detection Rule (Section A.7)
        Triggers when configured object types are detected
        """
        events = []
        
        class_filter = parameters.get("ClassFilter", [])
        confidence_threshold = parameters.get("ConfidenceLevel", 0.5)
        
        detected_objects = []
        
        for obj in frame.objects:
            for class_type in obj.appearance.class_types:
                if class_type.type_name in class_filter:
                    if class_type.likelihood >= confidence_threshold:
                        detected_objects.append({
                            "object_id": obj.object_id,
                            "class": class_type.type_name,
                            "likelihood": class_type.likelihood
                        })
        
        if detected_objects:
            events.append(AnalyticsEvent(
                device_id=device_id,
                config_token="",
                rule_name=rule_name,
                rule_type=RuleType.OBJECT_DETECTION,
                event_type=EventType.OBJECT_DETECTED,
                object_ids=[obj["object_id"] for obj in detected_objects],
                event_data={"detected_objects": detected_objects}
            ))
        
        return events
    
    async def _evaluate_loitering_detector(self, device_id: str, rule_name: str,
                                             parameters: Dict, frame: Frame) -> List[AnalyticsEvent]:
        """
        Loitering Detector Rule (Section A.4)
        Triggers when objects stay in area longer than threshold
        """
        events = []
        
        field_data = parameters.get("Field", {})
        if not field_data:
            return events
        
        time_threshold = parameters.get("TimeThreshold", "PT30S")
        threshold_seconds = self._parse_duration(time_threshold)
        
        # Parse polygon
        points = []
        for point_data in field_data.get("points", []):
            points.append(Point(x=point_data["x"], y=point_data["y"]))
        
        current_time = frame.utc_time
        
        for obj in frame.objects:
            if not obj.appearance.bounding_box:
                continue
            
            center = obj.appearance.bounding_box.center
            is_inside = self._point_in_polygon(center, points)
            
            track_key = f"{rule_name}_{obj.object_id}"
            
            if is_inside:
                # Track when object entered
                if "enter_time" not in self.object_tracks[track_key]:
                    self.object_tracks[track_key]["enter_time"] = current_time
                    self.object_tracks[track_key]["loitering_triggered"] = False
                
                # Check if threshold exceeded
                enter_time = self.object_tracks[track_key]["enter_time"]
                duration = (current_time - enter_time).total_seconds()
                
                if duration >= threshold_seconds and not self.object_tracks[track_key].get("loitering_triggered"):
                    events.append(AnalyticsEvent(
                        device_id=device_id,
                        config_token="",
                        rule_name=rule_name,
                        rule_type=RuleType.LOITERING_DETECTOR,
                        event_type=EventType.LOITERING,
                        object_ids=[obj.object_id],
                        event_data={
                            "duration_seconds": duration,
                            "since": enter_time.isoformat()
                        }
                    ))
                    self.object_tracks[track_key]["loitering_triggered"] = True
            else:
                # Reset tracking when object leaves
                if track_key in self.object_tracks:
                    del self.object_tracks[track_key]
        
        return events
    
    # ============================================
    # Helper Methods
    # ============================================
    
    def _point_in_polygon(self, point: Point, polygon: List[Point]) -> bool:
        """Ray casting algorithm to check if point is inside polygon"""
        inside = False
        n = len(polygon)
        
        for i in range(n):
            x1, y1 = polygon[i].x, polygon[i].y
            x2, y2 = polygon[(i + 1) % n].x, polygon[(i + 1) % n].y
            
            # Check if point is on the horizontal edge
            if (y1 > point.y) != (y2 > point.y):
                x_intersect = x1 + (point.y - y1) * (x2 - x1) / (y2 - y1)
                if x_intersect > point.x:
                    inside = not inside
        
        return inside
    
    def _check_line_crossing(self, line: List[Point], point: Point, threshold: float = 0.05) -> bool:
        """Check if point crosses a line (simplified)"""
        # Simplified implementation - checks if point is near the line
        for i in range(len(line) - 1):
            p1, p2 = line[i], line[i + 1]
            
            # Calculate distance from point to line segment
            distance = self._point_line_distance(point, p1, p2)
            
            if distance < threshold:
                return True
        
        return False
    
    def _point_line_distance(self, point: Point, line_start: Point, line_end: Point) -> float:
        """Calculate distance from point to line segment"""
        import math
        
        # Vector from line_start to line_end
        dx = line_end.x - line_start.x
        dy = line_end.y - line_start.y
        
        if dx == 0 and dy == 0:
            return math.hypot(point.x - line_start.x, point.y - line_start.y)
        
        # Project point onto line
        t = ((point.x - line_start.x) * dx + (point.y - line_start.y) * dy) / (dx * dx + dy * dy)
        
        if t < 0:
            closest = line_start
        elif t > 1:
            closest = line_end
        else:
            closest = Point(x=line_start.x + t * dx, y=line_start.y + t * dy)
        
        return math.hypot(point.x - closest.x, point.y - closest.y)
    
    def _parse_duration(self, duration_str: str) -> int:
        """Parse ISO 8601 duration string to seconds"""
        import re
        
        # Simple parser for PT30S, PT1M, PT1H format
        match = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', duration_str)
        if match:
            hours = int(match.group(1) or 0)
            minutes = int(match.group(2) or 0)
            seconds = int(match.group(3) or 0)
            return hours * 3600 + minutes * 60 + seconds
        
        # Default to 30 seconds
        return 30


# Singleton instance
rules_engine = AnalyticsRulesEngine()