"""
ONVIF Analytics Metadata Parser
Parses XML and JSON scene descriptions from ONVIF devices
Based on Section 5 - Scene Description
"""

import xml.etree.ElementTree as ET
import base64
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any
from io import BytesIO
import zlib

from models.analytics_models import (
    Frame, DetectedObject, Appearance, BoundingBox, Point, 
    Transformation, Vector, ClassType, Behavior, Polygon,
    Polyline, ColorCluster, LicensePlateInfo, FaceInfo, VehicleInfo
)

logger = logging.getLogger(__name__)


class MetadataParser:
    """Parses ONVIF metadata streams (XML and JSON formats)"""
    
    # XML Namespaces (Section 3.3)
    NAMESPACES = {
        'tt': 'http://www.onvif.org/ver10/schema',
        'tns1': 'http://www.onvif.org/ver10/topics',
        'axs': 'http://www.onvif.org/ver20/analytics',
        'fc': 'http://www.onvif.org/ver20/analytics/humanface',
        'bd': 'http://www.onvif.org/ver20/analytics/humanbody'
    }
    
    @classmethod
    def parse_metadata_stream(cls, data: bytes, format_type: str = 'xml') -> List[Frame]:
        """
        Parse complete metadata stream
        Args:
            data: Raw metadata bytes
            format_type: 'xml' or 'json'
        Returns:
            List of Frame objects
        """
        frames = []
        
        if format_type == 'xml':
            frames = cls._parse_xml_stream(data)
        elif format_type == 'json':
            frames = cls._parse_json_stream(data)
        else:
            logger.error(f"Unsupported format: {format_type}")
        
        return frames
    
    @classmethod
    def _parse_xml_stream(cls, data: bytes) -> List[Frame]:
        """Parse XML metadata stream (RTP payload)"""
        frames = []
        
        try:
            # Parse XML
            root = ET.fromstring(data)
            
            # Find all Frame elements
            for frame_elem in root.findall('.//tt:Frame', cls.NAMESPACES):
                frame = cls._parse_xml_frame(frame_elem)
                if frame:
                    frames.append(frame)
                    
        except ET.ParseError as e:
            logger.error(f"XML parsing error: {e}")
        except Exception as e:
            logger.error(f"Error parsing metadata stream: {e}")
        
        return frames
    
    @classmethod
    def _parse_xml_frame(cls, frame_elem: ET.Element) -> Optional[Frame]:
        """Parse a single XML Frame element (Section 5.2)"""
        try:
            # Get UTC time
            utc_time_str = frame_elem.get('UtcTime')
            if not utc_time_str:
                return None
            
            utc_time = datetime.fromisoformat(utc_time_str.replace('Z', '+00:00'))
            
            # Get source if present
            source = frame_elem.get('Source')
            
            # Parse transformation (Section 5.2.2)
            transformation = None
            trans_elem = frame_elem.find('.//tt:Transformation', cls.NAMESPACES)
            if trans_elem is not None:
                transformation = cls._parse_transformation(trans_elem)
            
            # Parse PTZ status if present
            ptz_status = None
            ptz_elem = frame_elem.find('.//tt:PTZStatus', cls.NAMESPACES)
            if ptz_elem is not None:
                ptz_status = cls._parse_ptz_status(ptz_elem)
            
            # Parse objects (Section 5.3.1)
            objects = []
            for obj_elem in frame_elem.findall('.//tt:Object', cls.NAMESPACES):
                obj = cls._parse_object(obj_elem)
                if obj:
                    objects.append(obj)
            
            # Parse object tree (Section 5.3.3)
            object_tree = None
            tree_elem = frame_elem.find('.//tt:ObjectTree', cls.NAMESPACES)
            if tree_elem is not None:
                object_tree = cls._parse_object_tree(tree_elem)
            
            return Frame(
                utc_time=utc_time,
                source=source,
                transformation=transformation,
                objects=objects,
                ptz_status=ptz_status
            )
            
        except Exception as e:
            logger.error(f"Error parsing XML frame: {e}")
            return None
    
    @classmethod
    def _parse_transformation(cls, trans_elem: ET.Element) -> Optional[Transformation]:
        """Parse transformation element (Section 5.2.2)"""
        translate = None
        scale = None
        
        translate_elem = trans_elem.find('.//tt:Translate', cls.NAMESPACES)
        if translate_elem is not None:
            translate = Vector(
                x=float(translate_elem.get('x', 0)),
                y=float(translate_elem.get('y', 0))
            )
        
        scale_elem = trans_elem.find('.//tt:Scale', cls.NAMESPACES)
        if scale_elem is not None:
            scale = Vector(
                x=float(scale_elem.get('x', 1)),
                y=float(scale_elem.get('y', 1))
            )
        
        if translate or scale:
            return Transformation(translate=translate, scale=scale)
        return None
    
    @classmethod
    def _parse_ptz_status(cls, ptz_elem: ET.Element) -> Dict:
        """Parse PTZ status information"""
        status = {}
        
        position_elem = ptz_elem.find('.//tt:Position', cls.NAMESPACES)
        if position_elem is not None:
            status['position'] = {
                'pan': float(position_elem.get('x', 0)),
                'tilt': float(position_elem.get('y', 0)),
                'zoom': float(position_elem.get('zoom', 0))
            }
        
        return status
    
    @classmethod
    def _parse_object(cls, obj_elem: ET.Element) -> Optional[DetectedObject]:
        """Parse Object element (Section 5.3.1)"""
        try:
            object_id = int(obj_elem.get('ObjectId', 0))
            uuid = obj_elem.get('UUID')
            parent_id = int(obj_elem.get('Parent', 0)) if obj_elem.get('Parent') else None
            
            # Parse appearance
            appearance_elem = obj_elem.find('.//tt:Appearance', cls.NAMESPACES)
            appearance = cls._parse_appearance(appearance_elem) if appearance_elem is not None else Appearance()
            
            # Parse behavior
            behavior_elem = obj_elem.find('.//tt:Behavior', cls.NAMESPACES)
            behavior = cls._parse_behavior(behavior_elem) if behavior_elem is not None else None
            
            # Parse license plate info (Section 5.3.12)
            license_plate = None
            lp_elem = appearance_elem.find('.//tt:LicensePlateInfo', cls.NAMESPACES) if appearance_elem else None
            if lp_elem is not None:
                license_plate = cls._parse_license_plate(lp_elem)
            
            # Parse face info (Section 5.3.14)
            face = None
            face_elem = appearance_elem.find('.//tt:HumanFace', cls.NAMESPACES) if appearance_elem else None
            if face_elem is not None:
                face = cls._parse_face(face_elem)
            
            # Parse vehicle info (Section 5.3.8)
            vehicle = None
            vehicle_elem = appearance_elem.find('.//tt:VehicleInfo', cls.NAMESPACES) if appearance_elem else None
            if vehicle_elem is not None:
                vehicle = cls._parse_vehicle(vehicle_elem)
            
            return DetectedObject(
                object_id=object_id,
                uuid=uuid,
                parent_id=parent_id,
                appearance=appearance,
                behavior=behavior,
                license_plate=license_plate,
                face=face,
                vehicle=vehicle,
                frame_time=datetime.utcnow()
            )
            
        except Exception as e:
            logger.error(f"Error parsing object: {e}")
            return None
    
    @classmethod
    def _parse_appearance(cls, app_elem: ET.Element) -> Appearance:
        """Parse Appearance element (Section 5.3.1)"""
        appearance = Appearance()
        
        # Parse shape
        shape_elem = app_elem.find('.//tt:Shape', cls.NAMESPACES)
        if shape_elem is not None:
            shape_data = {}
            
            # Bounding box
            bb_elem = shape_elem.find('.//tt:BoundingBox', cls.NAMESPACES)
            if bb_elem is not None:
                shape_data['bounding_box'] = BoundingBox(
                    left=float(bb_elem.get('left', 0)),
                    top=float(bb_elem.get('top', 0)),
                    right=float(bb_elem.get('right', 0)),
                    bottom=float(bb_elem.get('bottom', 0))
                )
            
            # Center of gravity
            cog_elem = shape_elem.find('.//tt:CenterOfGravity', cls.NAMESPACES)
            if cog_elem is not None:
                shape_data['center'] = Point(
                    x=float(cog_elem.get('x', 0)),
                    y=float(cog_elem.get('y', 0))
                )
            
            # Polygon
            poly_elem = shape_elem.find('.//tt:Polygon', cls.NAMESPACES)
            if poly_elem is not None:
                points = []
                for point_elem in poly_elem.findall('.//tt:Point', cls.NAMESPACES):
                    points.append(Point(
                        x=float(point_elem.get('x', 0)),
                        y=float(point_elem.get('y', 0))
                    ))
                shape_data['polygon'] = Polygon(points=points)
            
            appearance.shape = shape_data
        
        # Parse class types (Section 5.3.6)
        class_elem = app_elem.find('.//tt:Class', cls.NAMESPACES)
        if class_elem is not None:
            appearance.class_types = []
            for type_elem in class_elem.findall('.//tt:Type', cls.NAMESPACES):
                class_type = ClassType(
                    type_name=type_elem.text if type_elem.text else type_elem.get('Value', ''),
                    likelihood=float(type_elem.get('Likelihood', 1.0))
                )
                appearance.class_types.append(class_type)
        
        # Parse colors (Section 5.3.5)
        color_elem = app_elem.find('.//tt:Color', cls.NAMESPACES)
        if color_elem is not None:
            appearance.colors = []
            for cluster in color_elem.findall('.//tt:ColorCluster', cls.NAMESPACES):
                color_data = {}
                color_vals = cluster.find('.//tt:Color', cls.NAMESPACES)
                if color_vals is not None:
                    color_data['color'] = {
                        'Y': float(color_vals.get('Y', 0)),
                        'Cb': float(color_vals.get('Cb', 0)),
                        'Cr': float(color_vals.get('Cr', 0))
                    }
                
                weight_elem = cluster.find('.//tt:Weight', cls.NAMESPACES)
                if weight_elem is not None and weight_elem.text:
                    color_data['weight'] = float(weight_elem.text)
                
                appearance.colors.append(ColorCluster(**color_data))
        
        return appearance
    
    @classmethod
    def _parse_behavior(cls, behavior_elem: ET.Element) -> Behavior:
        """Parse Behavior element (Section 5.3.1)"""
        behavior = Behavior()
        
        if behavior_elem.find('.//tt:Idle', cls.NAMESPACES) is not None:
            behavior.is_idle = True
        
        if behavior_elem.find('.//tt:Removed', cls.NAMESPACES) is not None:
            behavior.is_removed = True
        
        speed_elem = behavior_elem.find('.//tt:Speed', cls.NAMESPACES)
        if speed_elem is not None and speed_elem.text:
            behavior.speed = float(speed_elem.text)
        
        return behavior
    
    @classmethod
    def _parse_license_plate(cls, lp_elem: ET.Element) -> LicensePlateInfo:
        """Parse LicensePlateInfo element (Section 5.3.12)"""
        info = LicensePlateInfo(plate_number="")
        
        plate_elem = lp_elem.find('.//tt:PlateNumber', cls.NAMESPACES)
        if plate_elem is not None and plate_elem.text:
            info.plate_number = plate_elem.text
            info.likelihood = float(plate_elem.get('Likelihood', 1.0))
        
        country_elem = lp_elem.find('.//tt:CountryCode', cls.NAMESPACES)
        if country_elem is not None and country_elem.text:
            info.country_code = country_elem.text
        
        type_elem = lp_elem.find('.//tt:PlateType', cls.NAMESPACES)
        if type_elem is not None and type_elem.text:
            info.plate_type = type_elem.text
        
        return info
    
    @classmethod
    def _parse_face(cls, face_elem: ET.Element) -> FaceInfo:
        """Parse HumanFace element (Section 5.3.14)"""
        face = FaceInfo()
        
        gender_elem = face_elem.find('.//fc:Gender', cls.NAMESPACES)
        if gender_elem is not None and gender_elem.text:
            face.gender = gender_elem.text
        
        age_elem = face_elem.find('.//fc:Age', cls.NAMESPACES)
        if age_elem is not None:
            min_elem = age_elem.find('.//tt:Min', cls.NAMESPACES)
            max_elem = age_elem.find('.//tt:Max', cls.NAMESPACES)
            if min_elem is not None and min_elem.text:
                face.age_min = int(min_elem.text)
            if max_elem is not None and max_elem.text:
                face.age_max = int(max_elem.text)
        
        # Check for glasses
        opticals_elem = face_elem.find('.//fc:Opticals', cls.NAMESPACES)
        if opticals_elem is not None:
            wear_elem = opticals_elem.find('.//fc:Wear', cls.NAMESPACES)
            if wear_elem is not None:
                face.glasses = wear_elem.text == 'True'
        
        return face
    
    @classmethod
    def _parse_vehicle(cls, vehicle_elem: ET.Element) -> VehicleInfo:
        """Parse VehicleInfo element (Section 5.3.8)"""
        vehicle = VehicleInfo()
        
        type_elem = vehicle_elem.find('.//tt:Type', cls.NAMESPACES)
        if type_elem is not None and type_elem.text:
            vehicle.vehicle_type = type_elem.text
            vehicle.likelihood = float(type_elem.get('Likelihood', 1.0))
        
        brand_elem = vehicle_elem.find('.//tt:Brand', cls.NAMESPACES)
        if brand_elem is not None and brand_elem.text:
            vehicle.brand = brand_elem.text
        
        model_elem = vehicle_elem.find('.//tt:Model', cls.NAMESPACES)
        if model_elem is not None and model_elem.text:
            vehicle.model = model_elem.text
        
        return vehicle
    
    @classmethod
    def _parse_object_tree(cls, tree_elem: ET.Element) -> Dict:
        """Parse ObjectTree element (Section 5.3.3)"""
        tree = {}
        
        # Parse merge operations
        merges = []
        for merge_elem in tree_elem.findall('.//tt:Merge', cls.NAMESPACES):
            from_ids = []
            for from_elem in merge_elem.findall('.//tt:From', cls.NAMESPACES):
                from_ids.append(int(from_elem.get('ObjectId', 0)))
            to_elem = merge_elem.find('.//tt:To', cls.NAMESPACES)
            to_id = int(to_elem.get('ObjectId', 0)) if to_elem is not None else None
            merges.append((from_ids, to_id))
        
        if merges:
            tree['merges'] = merges
        
        # Parse split operations
        splits = []
        for split_elem in tree_elem.findall('.//tt:Split', cls.NAMESPACES):
            from_elem = split_elem.find('.//tt:From', cls.NAMESPACES)
            from_id = int(from_elem.get('ObjectId', 0)) if from_elem is not None else None
            to_ids = []
            for to_elem in split_elem.findall('.//tt:To', cls.NAMESPACES):
                to_ids.append(int(to_elem.get('ObjectId', 0)))
            splits.append((from_id, to_ids))
        
        if splits:
            tree['splits'] = splits
        
        return tree
    
    @classmethod
    def _parse_json_stream(cls, data: bytes) -> List[Frame]:
        """Parse JSON metadata stream (Section 5.4)"""
        import json
        
        frames = []
        
        try:
            json_data = json.loads(data)
            
            # Handle different JSON structures
            if 'Frame' in json_data:
                frame_list = json_data['Frame'] if isinstance(json_data['Frame'], list) else [json_data['Frame']]
                
                for frame_data in frame_list:
                    frame = cls._parse_json_frame(frame_data)
                    if frame:
                        frames.append(frame)
                        
        except json.JSONDecodeError as e:
            logger.error(f"JSON parsing error: {e}")
        except Exception as e:
            logger.error(f"Error parsing JSON metadata: {e}")
        
        return frames
    
    @classmethod
    def _parse_json_frame(cls, frame_data: Dict) -> Optional[Frame]:
        """Parse a single JSON Frame object"""
        try:
            utc_time = datetime.fromisoformat(frame_data.get('UtcTime', '').replace('Z', '+00:00'))
            source = frame_data.get('Source')
            
            # Parse transformation
            transformation = None
            if 'Transformation' in frame_data:
                trans = frame_data['Transformation']
                transformation = Transformation(
                    translate=Vector(
                        x=trans.get('Translate', {}).get('x', 0),
                        y=trans.get('Translate', {}).get('y', 0)
                    ) if 'Translate' in trans else None,
                    scale=Vector(
                        x=trans.get('Scale', {}).get('x', 1),
                        y=trans.get('Scale', {}).get('y', 1)
                    ) if 'Scale' in trans else None
                )
            
            # Parse objects
            objects = []
            for obj_data in frame_data.get('Object', []):
                obj = cls._parse_json_object(obj_data)
                if obj:
                    objects.append(obj)
            
            return Frame(
                utc_time=utc_time,
                source=source,
                transformation=transformation,
                objects=objects
            )
            
        except Exception as e:
            logger.error(f"Error parsing JSON frame: {e}")
            return None
    
    @classmethod
    def _parse_json_object(cls, obj_data: Dict) -> Optional[DetectedObject]:
        """Parse a single JSON Object"""
        try:
            object_id = int(obj_data.get('ObjectId', 0))
            uuid = obj_data.get('UUID')
            
            appearance_data = obj_data.get('Appearance', {})
            appearance = cls._parse_json_appearance(appearance_data)
            
            return DetectedObject(
                object_id=object_id,
                uuid=uuid,
                appearance=appearance,
                frame_time=datetime.utcnow()
            )
            
        except Exception as e:
            logger.error(f"Error parsing JSON object: {e}")
            return None
    
    @classmethod
    def _parse_json_appearance(cls, app_data: Dict) -> Appearance:
        """Parse JSON Appearance data"""
        appearance = Appearance()
        
        # Parse shape
        shape_data = app_data.get('Shape', {})
        if shape_data:
            shape = {}
            if 'BoundingBox' in shape_data:
                bb = shape_data['BoundingBox']
                shape['bounding_box'] = BoundingBox(
                    left=float(bb.get('left', 0)),
                    top=float(bb.get('top', 0)),
                    right=float(bb.get('right', 0)),
                    bottom=float(bb.get('bottom', 0))
                )
            appearance.shape = shape
        
        # Parse class types
        class_data = app_data.get('Class', {})
        if class_data:
            appearance.class_types = []
            types = class_data.get('Type', [])
            if not isinstance(types, list):
                types = [types]
            for type_data in types:
                if isinstance(type_data, dict):
                    class_type = ClassType(
                        type_name=type_data.get('$', type_data.get('__content__', '')),
                        likelihood=float(type_data.get('Likelihood', 1.0))
                    )
                else:
                    class_type = ClassType(type_name=str(type_data))
                appearance.class_types.append(class_type)
        
        return appearance


class RTPMetadataDecoder:
    """Decodes RTP payload containing metadata"""
    
    @staticmethod
    def decode_rtp_payload(payload: bytes) -> Optional[bytes]:
        """
        Decode RTP payload (may be compressed)
        Supports deflate compression as per ONVIF spec
        """
        try:
            # Check if payload is compressed (first two bytes might indicate)
            if len(payload) > 2:
                # Try to decompress
                try:
                    decompressed = zlib.decompress(payload, -zlib.MAX_WBITS)
                    return decompressed
                except zlib.error:
                    # Not compressed or different compression
                    pass
            
            return payload
            
        except Exception as e:
            logger.error(f"Error decoding RTP payload: {e}")
            return None
    
    @staticmethod
    def extract_metadata_from_rtp(rtp_data: bytes) -> List[Frame]:
        """
        Extract metadata frames from RTP packet
        """
        frames = []
        
        try:
            # RTP header is typically 12 bytes
            if len(rtp_data) > 12:
                payload = rtp_data[12:]
                decoded = RTPMetadataDecoder.decode_rtp_payload(payload)
                
                if decoded:
                    # Try XML first, then JSON
                    frames = MetadataParser.parse_metadata_stream(decoded, 'xml')
                    if not frames:
                        frames = MetadataParser.parse_metadata_stream(decoded, 'json')
                        
        except Exception as e:
            logger.error(f"Error extracting metadata from RTP: {e}")
        
        return frames


# Singleton instance
metadata_parser = MetadataParser()
rtp_decoder = RTPMetadataDecoder()