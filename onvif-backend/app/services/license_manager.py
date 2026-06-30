import os
import logging
import threading
from typing import Optional, List, Dict, Any
from datetime import date, datetime

logger = logging.getLogger(__name__)

# Try importing the validator; fall back if package is not yet fully installed
try:
    from license_validator import LicenseValidator, ValidatorResponse
except ImportError:
    # Placeholder for type hinting/fallback during build/bootstrap
    class LicenseValidator:
        @staticmethod
        def validate_license(path: str):
            raise ImportError("mirador-license-validator is not installed")
    class ValidatorResponse:
        pass


class LicenseValidationError(Exception):
    """Custom exception raised when license validation fails."""
    pass


class VmsLicenseManager:
    """Manages license validation, enforcement, caching, and thread-safe operations."""

    def __init__(self):
        # Thread safety lock
        self._lock = threading.RLock()
        
        # Read configurations from environment variables
        self.license_path = os.getenv("MIRADOR_LICENSE_PATH", "/etc/mirador/license.lic")
        
        # Check if validation is disabled or in dev mode
        self.validation_enabled = os.getenv("LICENSE_VALIDATION_ENABLED", "true").lower() != "false"
        self.dev_mode = os.getenv("DEV_MODE", "false").lower() == "true"
        
        # State
        self.license_response: Optional[Any] = None
        self.is_initialized = False

    def initialize(self, force_revalidate: bool = False) -> bool:
        """
        Initialize and validate the license.
        
        Args:
            force_revalidate: If True, re-runs verification regardless of current initialization state.
            
        Returns:
            True if license is valid, False/Raises LicenseValidationError otherwise.
        """
        with self._lock:
            if self.is_initialized and not force_revalidate:
                return True

            if not self.validation_enabled or self.dev_mode:
                logger.warning("⚠️ LICENSE VALIDATION BYPASSED (Development/Demo Mode)")
                self.is_initialized = True
                return True

            try:
                logger.info(f"Validating license from: {self.license_path}")
                response = LicenseValidator.validate_license(self.license_path)
                
                if not response.is_valid:
                    error_msg = f"License validation failed: {response.error_message} (Code: {response.error_code})"
                    logger.error(error_msg)
                    raise LicenseValidationError(error_msg)

                # Store validated license response in memory
                self.license_response = response
                self.is_initialized = True

                # Secure Logging: Log only Customer ID, License ID, Expiry, Camera Limit, and Analytics Enabled
                # Never log raw license data, keys, MAC, or UUID.
                data = response.data
                logger.info("✓ License validated successfully:")
                logger.info(f"  Customer ID: {data.customer_id}")
                logger.info(f"  License ID: {data.license_id}")
                logger.info(f"  Expiry Date: {data.expiry}")
                logger.info(f"  Max Cameras: {data.max_cameras}")
                logger.info(f"  Enabled Analytics: {data.analytics}")
                return True

            except FileNotFoundError as e:
                error_msg = f"License file not found at: {self.license_path}"
                logger.error(error_msg)
                raise LicenseValidationError(error_msg) from e
            except LicenseValidationError:
                raise
            except Exception as e:
                error_msg = f"Unexpected error during license validation: {e}"
                logger.error(error_msg)
                raise LicenseValidationError(error_msg) from e

    def get_max_cameras(self) -> int:
        """Get maximum number of cameras allowed by the license."""
        with self._lock:
            if not self.validation_enabled or self.dev_mode:
                return 20  # Unlimited for dev/mock mode
            if self._check_valid():
                return self.license_response.data.max_cameras
            return 0

    def get_max_analytics(self) -> int:
        """Get maximum number of active analytics modules allowed."""
        with self._lock:
            if not self.validation_enabled or self.dev_mode:
                return 99999  # Unlimited for dev/mock mode
            if self._check_valid():
                return self.license_response.data.max_analytics
            return 0

    def is_analytics_enabled(self, analytics_name: str) -> bool:
        """Check if a specific analytics module is enabled."""
        with self._lock:
            if not self.validation_enabled or self.dev_mode:
                return True  # All enabled in dev/mock mode
            if self._check_valid():
                return analytics_name in self.license_response.data.analytics
            return False

    def get_enabled_analytics(self) -> List[str]:
        """Get list of enabled analytics modules."""
        with self._lock:
            if not self.validation_enabled or self.dev_mode:
                return ["ObjectInArea", "OccupancyCount", "CrossLine", "MotionDetection", 
                        "Tampering", "FaceDetection", "VehicleDetection", "LoiteringGuard", 
                        "IntrusionDetection", "SoundDetection"]
            if self._check_valid():
                return self.license_response.data.analytics
            return []

    def get_days_until_expiry(self) -> Optional[int]:
        """Get number of days until the license expires."""
        with self._lock:
            if not self.validation_enabled or self.dev_mode:
                return 365  # Always 1 year remaining in dev/mock mode
            if self._check_valid():
                expiry = self.license_response.data.expiry
                # Handle both datetime.date and string expiry safely
                if isinstance(expiry, str):
                    expiry = datetime.strptime(expiry, "%Y-%m-%d").date()
                elif isinstance(expiry, datetime):
                    expiry = expiry.date()
                delta = expiry - date.today()
                return max(0, delta.days)
            return None

    def get_license_info(self, is_admin: bool = False) -> Dict[str, Any]:
        """
        Get comprehensive license info. Masks sensitive machine identifiers unless is_admin is True.
        """
        with self._lock:
            if not self.validation_enabled or self.dev_mode:
                return {
                    "valid": True,
                    "dev_mode": True,
                    "customer_id": "DEVELOPMENT_MODE",
                    "license_id": "DEV_LICENSE",
                    "max_cameras": 20,
                    "max_analytics": 99999,
                    "enabled_analytics": self.get_enabled_analytics(),
                    "days_remaining": 365,
                    "expiry_date": (date.today().replace(year=date.today().year + 1)).isoformat()
                }

            if not self._check_valid():
                return {
                    "valid": False,
                    "error": "No valid license loaded"
                }

            data = self.license_response.data
            expiry_val = data.expiry
            if isinstance(expiry_val, (date, datetime)):
                expiry_str = expiry_val.isoformat()
            else:
                expiry_str = str(expiry_val)

            info = {
                "valid": True,
                "customer_id": data.customer_id,
                "license_id": data.license_id,
                "max_cameras": data.max_cameras,
                "max_analytics": data.max_analytics,
                "enabled_analytics": data.analytics,
                "days_remaining": self.get_days_until_expiry(),
                "expiry_date": expiry_str
            }

            # Only expose hardware UUID/MAC if requested by an administrator
            if is_admin:
                info["system_uuid"] = getattr(data, "uuid", None)
                info["mac_address"] = getattr(data, "mac", None)

            return info

    def _check_valid(self) -> bool:
        """Checks if internal license state has a valid validation response."""
        return (
            self.is_initialized and
            self.license_response is not None and
            getattr(self.license_response, "is_valid", False)
        )


# Singleton instance
license_manager = VmsLicenseManager()
