import os
from .repository import WindowsStorageRepository
from .config_manager import StorageConfig
from .service_manager import ServiceManager

class StorageService:
    def __init__(self):
        self.repo = WindowsStorageRepository()
        self.config = StorageConfig()
        self.services = ServiceManager()

    def get_devices(self) -> list:
        return self.repo.get_devices()

    def get_status(self) -> dict:
        current_path = self.config.get_recording_path()
        drive_letter = current_path.split(":")[0] if ":" in current_path else "C"
        return self.repo.get_volume_status(drive_letter)

    def get_config(self) -> dict:
        return {
            "recording_path": self.config.get_recording_path(),
            "retention_days": self.config.get_retention_days()
        }

    def provision_storage(self, target_drive: str, recordings_folder: str) -> dict:
        # 1. Provision Storage (Infrastructure)
        log_output = self.repo.provision_storage(target_drive, recordings_folder)
        
        # 2. Update Configuration
        final_path = f"{target_drive}:\\{recordings_folder}"
        self.config.set_recording_path(final_path)
        
        # 3. Restart Dependent Services
        self.services.restart_all_vms_services()
        
        return {
            "success": True,
            "path": final_path,
            "log": log_output
        }

    def run_performance_test(self) -> dict:
        current_path = self.config.get_recording_path()
        drive_letter = current_path.split(":")[0] if ":" in current_path else "C"
        return self.repo.run_performance_test(drive_letter)

    def get_logs(self) -> dict:
        log_paths = [
            r"C:\ProgramData\VMS\Logs\StorageProvision.log",
            os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../../logs/failover.log"))
        ]
        for path in log_paths:
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()[-100:]
                    return {"logs": "".join(lines)}
        return {"logs": "No active system logs found."}

    def get_replication(self) -> dict:
        minio_running = self.services.verify_healthy("MinIO")
        return {
            "minio_status": "Healthy" if minio_running else "Stopped",
            "minio_service": "Running" if minio_running else "Stopped",
            "syncthing_status": "Not Configured"
        }
