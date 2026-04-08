"""
MQTT Analytics Publisher
Publishes scene description metadata over MQTT
Based on Section 5.4 - JSON over MQTT
"""

import json
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
import asyncio

import paho.mqtt.client as mqtt
from paho.mqtt.client import MQTTMessage

from models.analytics_models import Frame, DetectedObject, BoundingBox

logger = logging.getLogger(__name__)


class MQTTAnalyticsPublisher:
    """
    MQTT Publisher for ONVIF Analytics metadata
    Topic structure: {prefix}/onvif-mj/VideoAnalytics/{profile}/{module}
    """
    
    def __init__(self, broker_host: str = "localhost", broker_port: int = 1883,
                 topic_prefix: str = "mirador", client_id: str = "mirador-analytics"):
        self.broker_host = broker_host
        self.broker_port = broker_port
        self.topic_prefix = topic_prefix
        self.client_id = client_id
        
        self.client = mqtt.Client(client_id=client_id)
        self.client.on_connect = self._on_connect
        self.client.on_publish = self._on_publish
        self.client.on_disconnect = self._on_disconnect
        
        self.connected = False
        self._connect_lock = asyncio.Lock()
    
    def _on_connect(self, client, userdata, flags, rc):
        """MQTT connect callback"""
        if rc == 0:
            self.connected = True
            logger.info(f"MQTT connected to {self.broker_host}:{self.broker_port}")
        else:
            self.connected = False
            logger.error(f"MQTT connection failed with code {rc}")
    
    def _on_publish(self, client, userdata, mid):
        """MQTT publish callback"""
        logger.debug(f"Message {mid} published")
    
    def _on_disconnect(self, client, userdata, rc):
        """MQTT disconnect callback"""
        self.connected = False
        logger.warning(f"MQTT disconnected: {rc}")
    
    async def connect(self):
        """Connect to MQTT broker"""
        async with self._connect_lock:
            if not self.connected:
                try:
                    self.client.connect(self.broker_host, self.broker_port, 60)
                    self.client.loop_start()
                    # Wait for connection
                    await asyncio.sleep(1)
                except Exception as e:
                    logger.error(f"Failed to connect to MQTT broker: {e}")
                    raise
    
    async def disconnect(self):
        """Disconnect from MQTT broker"""
        if self.connected:
            self.client.loop_stop()
            self.client.disconnect()
            self.connected = False
            logger.info("MQTT disconnected")
    
    def _get_topic(self, profile_token: str, module_name: str) -> str:
        """
        Generate MQTT topic (Section 5.4.2)
        Format: {prefix}/onvif-mj/VideoAnalytics/{profile}/{module}
        """
        return f"{self.topic_prefix}/onvif-mj/VideoAnalytics/{profile_token}/{module_name}"
    
    def _frame_to_json(self, frame: Frame, context: Optional[Dict] = None) -> str:
        """
        Convert Frame to JSON format (Section 5.4.3)
        """
        # Build frame JSON
        frame_json = {
            "UtcTime": frame.utc_time.isoformat().replace('+00:00', 'Z'),
            "Object": []
        }
        
        if frame.source:
            frame_json["Source"] = frame.source
        
        if frame.transformation:
            frame_json["Transformation"] = {}
            if frame.transformation.translate:
                frame_json["Transformation"]["Translate"] = {
                    "x": frame.transformation.translate.x,
                    "y": frame.transformation.translate.y
                }
            if frame.transformation.scale:
                frame_json["Transformation"]["Scale"] = {
                    "x": frame.transformation.scale.x,
                    "y": frame.transformation.scale.y
                }
        
        # Add objects
        for obj in frame.objects:
            obj_json = self._object_to_json(obj)
            if obj_json:
                frame_json["Object"].append(obj_json)
        
        # Wrap in Frame array
        result = {"Frame": [frame_json]}
        
        # Add context if provided
        if context:
            result["context"] = context
        
        return json.dumps(result, indent=2)
    
    def _object_to_json(self, obj: DetectedObject) -> Optional[Dict]:
        """Convert DetectedObject to JSON format"""
        obj_json = {
            "ObjectId": obj.object_id
        }
        
        if obj.uuid:
            obj_json["UUID"] = obj.uuid
        
        if obj.parent_id:
            obj_json["Parent"] = obj.parent_id
        
        # Build appearance
        appearance_json = {}
        
        # Shape information
        if obj.appearance.shape:
            shape_json = {}
            if obj.appearance.shape.get('bounding_box'):
                bb = obj.appearance.shape['bounding_box']
                shape_json["BoundingBox"] = {
                    "left": bb.left,
                    "top": bb.top,
                    "right": bb.right,
                    "bottom": bb.bottom
                }
            
            if shape_json:
                appearance_json["Shape"] = shape_json
        
        # Class information
        if obj.appearance.class_types:
            class_json = {}
            types_list = []
            for ct in obj.appearance.class_types:
                type_entry = {
                    "$": ct.type_name,
                    "Likelihood": ct.likelihood
                }
                types_list.append(type_entry)
            class_json["Type"] = types_list
            appearance_json["Class"] = class_json
        
        # Face information
        if obj.face:
            face_json = {}
            if obj.face.gender:
                face_json["Gender"] = obj.face.gender
            if obj.face.age_min or obj.face.age_max:
                face_json["Age"] = {}
                if obj.face.age_min:
                    face_json["Age"]["Min"] = obj.face.age_min
                if obj.face.age_max:
                    face_json["Age"]["Max"] = obj.face.age_max
            if obj.face.glasses is not None:
                face_json["Accessory"] = {
                    "Opticals": {"Wear": "True" if obj.face.glasses else "False"}
                }
            appearance_json["HumanFace"] = face_json
        
        # Vehicle information
        if obj.vehicle:
            vehicle_json = {}
            if obj.vehicle.vehicle_type:
                vehicle_json["Type"] = {
                    "$": obj.vehicle.vehicle_type,
                    "Likelihood": obj.vehicle.likelihood
                }
            if obj.vehicle.brand:
                vehicle_json["Brand"] = obj.vehicle.brand
            if obj.vehicle.model:
                vehicle_json["Model"] = obj.vehicle.model
            appearance_json["VehicleInfo"] = vehicle_json
        
        # License plate information
        if obj.license_plate:
            lp_json = {}
            if obj.license_plate.plate_number:
                lp_json["PlateNumber"] = {
                    "$": obj.license_plate.plate_number,
                    "Likelihood": obj.license_plate.likelihood
                }
            if obj.license_plate.country_code:
                lp_json["CountryCode"] = obj.license_plate.country_code
            if obj.license_plate.plate_type:
                lp_json["PlateType"] = obj.license_plate.plate_type
            appearance_json["LicensePlateInfo"] = lp_json
        
        if appearance_json:
            obj_json["Appearance"] = appearance_json
        
        # Behavior
        if obj.behavior:
            behavior_json = {}
            if obj.behavior.is_idle:
                behavior_json["Idle"] = {}
            if obj.behavior.is_removed:
                behavior_json["Removed"] = {}
            if obj.behavior.speed:
                behavior_json["Speed"] = obj.behavior.speed
            if behavior_json:
                obj_json["Behavior"] = behavior_json
        
        return obj_json
    
    async def publish_frame(self, frame: Frame, profile_token: str, 
                            module_name: str, context: Optional[Dict] = None) -> bool:
        """
        Publish a frame to MQTT
        """
        if not self.connected:
            logger.warning(f"MQTT not connected, cannot publish frame for {module_name}")
            return False
        
        try:
            topic = self._get_topic(profile_token, module_name)
            payload = self._frame_to_json(frame, context)
            
            result = self.client.publish(topic, payload, qos=1, retain=False)
            
            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                logger.debug(f"Published frame to {topic}")
                return True
            else:
                logger.error(f"Failed to publish: {result.rc}")
                return False
                
        except Exception as e:
            logger.error(f"Error publishing frame: {e}")
            return False
    
    async def publish_batch(self, frames: List[Frame], profile_token: str, 
                            module_name: str) -> int:
        """
        Publish multiple frames
        Returns number of successfully published frames
        """
        success_count = 0
        
        for frame in frames:
            if await self.publish_frame(frame, profile_token, module_name):
                success_count += 1
        
        return success_count


class AnalyticsMQTTClient:
    """Wrapper for MQTT client with connection management"""
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or {}
        self.publisher: Optional[MQTTAnalyticsPublisher] = None
        self._initialized = False
    
    async def initialize(self):
        """Initialize MQTT connection"""
        if self._initialized:
            return
        
        broker_host = self.config.get('host', 'localhost')
        broker_port = self.config.get('port', 1883)
        topic_prefix = self.config.get('topic_prefix', 'mirador')
        
        self.publisher = MQTTAnalyticsPublisher(
            broker_host=broker_host,
            broker_port=broker_port,
            topic_prefix=topic_prefix
        )
        
        await self.publisher.connect()
        self._initialized = True
        logger.info("MQTT analytics client initialized")
    
    async def close(self):
        """Close MQTT connection"""
        if self.publisher:
            await self.publisher.disconnect()
            self._initialized = False
    
    async def publish_metadata(self, frames: List[Frame], profile_token: str, 
                                module_name: str = "metadata") -> int:
        """
        Publish metadata frames
        """
        if not self._initialized:
            await self.initialize()
        
        if not frames:
            return 0
        
        return await self.publisher.publish_batch(frames, profile_token, module_name)
    
    def is_connected(self) -> bool:
        """Check if MQTT is connected"""
        return self.publisher is not None and self.publisher.connected


# Singleton instance
mqtt_client = AnalyticsMQTTClient()