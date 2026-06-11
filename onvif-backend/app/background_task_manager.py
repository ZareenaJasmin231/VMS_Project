import asyncio
import psutil
import logging
import signal

logger = logging.getLogger("TaskManager")

class BackgroundTaskManager:
    def __init__(self):
        self._tasks: dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()

    async def start_task(self, name: str, coro):
        """Starts an asyncio task and tracks it. Prevents duplicates."""
        async with self._lock:
            if name in self._tasks:
                task = self._tasks[name]
                if not task.done():
                    print(f"[TaskManager] Task '{name}' is already running. Ignoring duplicate.")
                    return task
            print(f"[TaskManager] Starting async task: {name}")
            task = asyncio.create_task(coro, name=name)
            self._tasks[name] = task
            
            # Clean up the dict when the task completes
            task.add_done_callback(lambda t, n=name: self._task_done_callback(t, n))
            return task

    def _task_done_callback(self, task: asyncio.Task, name: str):
        if name in self._tasks and self._tasks[name] is task:
            del self._tasks[name]
            try:
                task.result()
            except asyncio.CancelledError:
                pass
            except Exception as e:
                print(f"[TaskManager] Task '{name}' completed with error: {e}")

    async def cancel_task(self, name: str, timeout: float = 5.0):
        """Cancels a specific async task by name."""
        async with self._lock:
            task = self._tasks.get(name)
        
        if task and not task.done():
            print(f"[TaskManager] Cancelling task: {name}")
            task.cancel()
            try:
                await asyncio.wait_for(task, timeout=timeout)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass

    async def shutdown_all_tasks(self, timeout: float = 5.0):
        """Cancels all tracked async tasks with a timeout."""
        async with self._lock:
            tasks_to_cancel = [t for t in self._tasks.values() if not t.done()]
            if not tasks_to_cancel:
                return

            print(f"[TaskManager] Cancelling {len(tasks_to_cancel)} tracked async tasks...")
            for task in tasks_to_cancel:
                task.cancel()
                
            try:
                await asyncio.wait(tasks_to_cancel, timeout=timeout)
            except asyncio.TimeoutError:
                print(f"[TaskManager] ⚠ Timed out waiting {timeout}s for async tasks to cancel.")
            self._tasks.clear()

    def kill_orphan_ffmpegs(self):
        """Finds and forcefully terminates any orphaned ffmpeg processes."""
        print("[TaskManager] Checking for orphan ffmpeg processes...")
        try:
            killed_count = 0
            for proc in psutil.process_iter(['pid', 'name']):
                try:
                    if proc.info['name'] and 'ffmpeg' in proc.info['name'].lower():
                        print(f"[TaskManager] Killing orphan ffmpeg PID: {proc.info['pid']}")
                        # using terminate first, then kill if needed, or directly kill
                        proc.kill()
                        killed_count += 1
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            if killed_count > 0:
                print(f"[TaskManager] Killed {killed_count} orphan ffmpeg process(es).")
        except Exception as e:
            print(f"[TaskManager] Error during ffmpeg cleanup: {e}")


# Global instance
task_manager = BackgroundTaskManager()
