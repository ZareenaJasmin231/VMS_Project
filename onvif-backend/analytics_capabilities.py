"""
Analytics Capabilities Detection
Queries ONVIF devices for their analytics capabilities
"""

import logging
from typing import Dict, List, Optional, Any
from datetime import datetime
from onvif import ONVIFCamera
from zeep.exceptions import Fault

from models.analytics_models import AnalyticsCapabilities, RuleType

logger = logging.getLogger(__name__)


class AnalyticsCapabilityDetector:
    """Detects analytics capabilities of ONVIF cameras"""
    
    def __init__(self):
        self.capabilities_cache: Dict[str, AnalyticsCapabilities] = {}
    
    async def detect_capabilities(self, device: ONVIFCamera, device_id: str) -> AnalyticsCapabilities:
        """
        Detect analytics capabilities of a camera
        Section 6.4 - GetServiceCapabilities
        """
        
        capabilities = AnalyticsCapabilities(device_id=device_id)
        
        try:
            # Get service capabilities from device
            analytics_service = device.create_analytics_service()
            
            # Call GetServiceCapabilities (Section 6.4)
            try:
                caps = analytics_service.GetServiceCapabilities()
                if caps:
                    capabilities.rule_support = getattr(caps, 'RuleSupport', False)
                    capabilities.analytics_module_support = getattr(caps, 'AnalyticsModuleSupport', False)
                    capabilities.cell_based_scene_support = getattr(caps, 'CellBasedSceneDescriptionSupport', False)
                    capabilities.rule_options_supported = getattr(caps, 'RuleOptionsSupported', False)
                    capabilities.analytics_module_options_support = getattr(caps, 'AnalyticsModuleOptionsSupport', False)
                    capabilities.supported_metadata = getattr(caps, 'SupportedMetadata', False)
                    
                    image_sending = getattr(caps, 'ImageSendingType', None)
                    if image_sending:
                        capabilities.image_sending_types = image_sending if isinstance(image_sending, list) else [image_sending]
            except Fault as e:
                logger.warning(f"GetServiceCapabilities not supported: {e}")
            
            # Get supported rules if rule support is enabled
            if capabilities.rule_support:
                supported_rules = await self._get_supported_rules(analytics_service, device_id)
                capabilities.supported_rule_types = supported_rules
            
            # Get max rules limit
            if capabilities.rule_options_supported:
                await self._get_rule_limits(analytics_service, capabilities)
            
        except Exception as e:
            logger.error(f"Failed to detect analytics capabilities for {device_id}: {e}")
            # Device doesn't support analytics
            capabilities.rule_support = False
            capabilities.analytics_module_support = False
        
        capabilities.updated_at = datetime.utcnow()
        
        # Cache the capabilities
        self.capabilities_cache[device_id] = capabilities
        
        return capabilities
    
    async def _get_supported_rules(self, analytics_service, device_id: str) -> List[RuleType]:
        """Get supported rule types from device (Section 6.2.3.1)"""
        supported = []
        
        try:
            # Get supported rules
            response = analytics_service.GetSupportedRules()
            
            for rule_desc in response.get('SupportedRules', []):
                rule_type = rule_desc.get('Name')
                
                # Map ONVIF rule types to our enum
                for rt in RuleType:
                    if rt.value == rule_type:
                        supported.append(rt)
                        break
                        
        except Fault as e:
            logger.warning(f"GetSupportedRules not available: {e}")
        except Exception as e:
            logger.error(f"Error getting supported rules: {e}")
        
        return supported
    
    async def _get_rule_limits(self, analytics_service, capabilities: AnalyticsCapabilities):
        """Get rule limits from device"""
        try:
            response = analytics_service.GetSupportedRules()
            for rule_desc in response.get('SupportedRules', []):
                max_instances = rule_desc.get('maxInstances')
                if max_instances and max_instances < capabilities.max_rules:
                    capabilities.max_rules = max_instances
        except Exception:
            pass
    
    async def get_cached_capabilities(self, device_id: str) -> Optional[AnalyticsCapabilities]:
        """Get cached capabilities for a device"""
        return self.capabilities_cache.get(device_id)
    
    def can_support_rule(self, device_id: str, rule_type: RuleType) -> bool:
        """Check if device supports a specific rule type"""
        caps = self.capabilities_cache.get(device_id)
        if not caps:
            return False
        return rule_type in caps.supported_rule_types
    
    def get_capabilities_summary(self, device_id: str) -> Dict[str, Any]:
        """Get human-readable capabilities summary"""
        caps = self.capabilities_cache.get(device_id)
        if not caps:
            return {"error": "No capabilities found for device"}
        
        return {
            "device_id": device_id,
            "supports_rules": caps.rule_support,
            "supports_analytics_modules": caps.analytics_module_support,
            "supported_rule_types": [rt.value for rt in caps.supported_rule_types],
            "max_rules": caps.max_rules,
            "can_configure_rules": caps.rule_options_supported,
            "last_updated": caps.updated_at.isoformat()
        }


# Singleton instance
capability_detector = AnalyticsCapabilityDetector()