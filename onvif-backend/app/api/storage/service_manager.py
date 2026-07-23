import subprocess

class ServiceManager:
    """
    Manages NSSM and native Windows Services for the VMS.
    """
    def __init__(self):
        # The core VMS services that depend on storage
        self.vms_services = ["MediaMTX", "mirador-failover-watchdog", "MinIO"]

    def stop(self, service_name: str) -> bool:
        return self._run_cmd(["powershell", "-NoProfile", "-Command", f"Stop-Service -Name {service_name} -Force -ErrorAction SilentlyContinue"])

    def start(self, service_name: str) -> bool:
        return self._run_cmd(["powershell", "-NoProfile", "-Command", f"Start-Service -Name {service_name} -ErrorAction SilentlyContinue"])

    def restart(self, service_name: str) -> bool:
        return self._run_cmd(["powershell", "-NoProfile", "-Command", f"Restart-Service -Name {service_name} -Force -ErrorAction SilentlyContinue"])

    def status(self, service_name: str) -> str:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", f"(Get-Service -Name {service_name} -ErrorAction SilentlyContinue).Status"],
            capture_output=True, text=True
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        return "Unknown"

    def verify_healthy(self, service_name: str) -> bool:
        return self.status(service_name) == "Running"

    def restart_all_vms_services(self):
        for svc in self.vms_services:
            self.restart(svc)

    def _run_cmd(self, cmd: list) -> bool:
        result = subprocess.run(cmd, capture_output=True)
        return result.returncode == 0
