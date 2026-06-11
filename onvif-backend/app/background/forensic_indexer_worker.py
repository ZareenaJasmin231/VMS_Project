"""
forensic_indexer_worker.py
--------------------------
Startup hook for the forensic background indexer.

Import and call start_background_indexer() from main.py on startup.
The indexer thread is a daemon — it will be killed automatically when
the FastAPI process exits.
"""

import threading
from app.services.ai.forensic_indexer import BackgroundIndexer

_indexer_thread: BackgroundIndexer | None = None
_lock = threading.Lock()


def start_background_indexer():
    """
    Start the forensic background indexer daemon thread.
    Safe to call multiple times — only starts one thread.
    """
    global _indexer_thread
    with _lock:
        if _indexer_thread is not None and _indexer_thread.is_alive():
            print("[FORENSIC WORKER] Indexer thread already running.")
            return
        _indexer_thread = BackgroundIndexer()
        _indexer_thread.start()
        print("[FORENSIC WORKER] ✅ Background forensic indexer started.")


def stop_background_indexer():
    """Stop the background indexer thread gracefully."""
    global _indexer_thread
    with _lock:
        if _indexer_thread and _indexer_thread.is_alive():
            _indexer_thread.stop()
            _indexer_thread.join(timeout=10)
            print("[FORENSIC WORKER] Indexer stopped.")
        _indexer_thread = None


def is_indexer_running() -> bool:
    return _indexer_thread is not None and _indexer_thread.is_alive()
