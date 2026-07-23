import subprocess
import json
import os

class WindowsStorageRepository:
    def __init__(self):
        # file is at onvif-backend/app/api/storage/repository.py -> go up 4 levels to VMS_Project root
        self.storage_scripts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../scripts/storage"))

    def _run_ps_script(self, script_name: str, args: list = None) -> subprocess.CompletedProcess:
        script_path = os.path.join(self.storage_scripts_dir, script_name)
        if not os.path.exists(script_path):
            raise Exception(f"Script not found: {script_path}")
        
        cmd = ["powershell", "-ExecutionPolicy", "Bypass", "-NoProfile", "-File", script_path]
        if args:
            cmd.extend(args)
            
        return subprocess.run(cmd, capture_output=True, text=True)

    def get_devices(self) -> list:
        result = self._run_ps_script("discover_disks.ps1")
        if result.returncode != 0:
            raise Exception(f"Failed to get devices: {result.stderr}")
        
        output = result.stdout.strip()
        if not output:
            return []
        data = json.loads(output)
        if isinstance(data, dict):
            data = [data]
        return data

    def get_volume_status(self, drive_letter: str) -> dict:
        result = self._run_ps_script("health_check.ps1", ["-DriveLetter", drive_letter])
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout.strip())
        return {"health": "Unknown", "capacity_tb": 0.0, "free_tb": 0.0, "used_tb": 0.0}

    def provision_storage(self, target_drive: str, recordings_folder: str) -> str:
        result = self._run_ps_script("provision_storage.ps1", [
            "-TargetDriveLetter", target_drive,
            "-RecordingsFolder", recordings_folder,
            "-Force"
        ])
        if result.returncode != 0:
            raise Exception(f"Provisioning failed: {result.stdout}\n{result.stderr}")
        return result.stdout

    def run_performance_test(self, drive_letter: str) -> dict:
        result = self._run_ps_script("test_io.ps1", ["-DriveLetter", drive_letter])
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout.strip())
        return {"write_speed": "Error", "read_speed": "Error"}
