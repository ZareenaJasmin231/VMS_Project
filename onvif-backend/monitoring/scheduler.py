import threading
import time
from .health import check_all_nodes, save_discovered_nodes
from .scanner import scanner
from .inference import run_root_cause_analysis


class MonitoringScheduler:
    def __init__(self, interval=15):
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread = None

    def _loop(self):
        print(f"[MONITOR] Background monitoring started (interval={self.interval}s)")
        while not self.stop_event.is_set():
            try:
                check_all_nodes()
                run_root_cause_analysis()
            except Exception as e:
                print(f"[MONITOR] Error in monitoring loop: {e}")

            self.stop_event.wait(self.interval)

    def start(self):
        if self.thread and self.thread.is_alive():
            return

        # ✅ FIX #6: Seed existing devices in a SEPARATE background thread.
        # Previously seed_topology_from_cameras() was called synchronously here,
        # which pinged ALL cameras and blocked FastAPI startup for 30+ seconds.
        def seed_task():
            try:
                from .health import seed_topology_from_cameras
                seed_topology_from_cameras()
            except Exception as e:
                print(f"[MONITOR] Seeding failed: {e}")

        seed_thread = threading.Thread(target=seed_task, daemon=True)
        seed_thread.start()

        # Start the main monitoring loop
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=5)

    def trigger_scan(self, subnet=None):
        """Runs a full network scan in a separate thread so it never blocks."""
        def task():
            results = scanner.scan_network(subnet)
            save_discovered_nodes(results)

        t = threading.Thread(target=task, daemon=True)
        t.start()


scheduler = MonitoringScheduler()