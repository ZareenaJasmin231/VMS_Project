import threading
import asyncio
import time
from .health import check_all_nodes, save_discovered_nodes
from .scanner import scanner
from .inference import run_root_cause_analysis


class MonitoringScheduler:
    def __init__(self, interval=15):
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread = None
        self._stream_loop_started = False  # guard against double-start

    def _loop(self):
        print(f"[MONITOR] Background monitoring started (interval={self.interval}s)")
        while not self.stop_event.is_set():
            try:
                check_all_nodes()
                run_root_cause_analysis()
            except Exception as e:
                print(f"[MONITOR] Error in monitoring loop: {e}")

            self.stop_event.wait(self.interval)

    def _run_stream_health_in_thread(self):
        """
        Run the async stream_health loop inside a *dedicated* event loop
        on its own daemon thread. Completely isolated from FastAPI's main
        loop so there are no cross-loop conflicts.
        """
        from .stream_health import run_stream_health_loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(run_stream_health_loop())
        except Exception as e:
            print(f"[STREAM_HEALTH] Thread crashed: {e}")
        finally:
            loop.close()

    def start(self):
        if self.thread and self.thread.is_alive():
            return

        # ── Seed cameras into infrastructure_nodes first ──────────────────
        def seed_task():
            try:
                from .health import seed_topology_from_cameras
                seed_topology_from_cameras()
            except Exception as e:
                print(f"[MONITOR] Seeding failed: {e}")

        seed_thread = threading.Thread(target=seed_task, daemon=True)
        seed_thread.start()

        # ── Start stream health poller (async loop on its own thread) ─────
        if not self._stream_loop_started:
            self._stream_loop_started = True
            sh_thread = threading.Thread(
                target=self._run_stream_health_in_thread,
                daemon=True,
                name="stream-health-poller"
            )
            sh_thread.start()
            print("[MONITOR] Stream health poller thread started.")

        # ── Start the main node-status monitoring loop ────────────────────
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
