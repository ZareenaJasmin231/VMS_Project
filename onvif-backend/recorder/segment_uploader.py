import os
import glob
import time
import requests
import threading
import shutil

BUFFER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "devices_data", "segment_buffer"))
MAX_BUFFER_SIZE_BYTES = 5 * 1024 * 1024 * 1024  # 5GB

_cleanup_thread = None
_cleanup_lock = threading.Lock()

def _global_cleanup_loop():
    while True:
        try:
            if os.path.exists(BUFFER_DIR):
                all_ts_files = glob.glob(os.path.join(BUFFER_DIR, "*", "*", "*", "*.ts"))
                total_size = sum(os.path.getsize(f) for f in all_ts_files if os.path.exists(f))
                
                if total_size > MAX_BUFFER_SIZE_BYTES:
                    # Sort files by modification time (oldest first)
                    all_ts_files.sort(key=lambda f: os.path.getmtime(f) if os.path.exists(f) else float('inf'))
                    
                    bytes_to_free = total_size - (MAX_BUFFER_SIZE_BYTES * 0.9)  # Free up to 90%
                    freed = 0
                    
                    for f in all_ts_files:
                        if freed >= bytes_to_free:
                            break
                        try:
                            if os.path.exists(f):
                                size = os.path.getsize(f)
                                os.remove(f)
                                freed += size
                                print(f"[UPLOADER-CLEANUP] 🗑 Deleted old segment {f} to free disk space.")
                        except Exception as e:
                            pass
                            
                # Cleanup empty directories
                for dirpath, dirnames, filenames in os.walk(BUFFER_DIR, topdown=False):
                    if not dirnames and not filenames and dirpath != BUFFER_DIR:
                        try:
                            os.rmdir(dirpath)
                        except:
                            pass
        except Exception as e:
            print(f"[UPLOADER-CLEANUP] Error during cleanup: {e}")
            
        time.sleep(60)

def start_global_cleanup():
    global _cleanup_thread
    with _cleanup_lock:
        if _cleanup_thread is None or not _cleanup_thread.is_alive():
            _cleanup_thread = threading.Thread(target=_global_cleanup_loop, daemon=True, name="SegmentUploaderCleanup")
            _cleanup_thread.start()

class SegmentUploader(threading.Thread):
    def __init__(self, stream_name: str, backend_port: int):
        super().__init__(name=f"Uploader-{stream_name}", daemon=True)
        self.stream_name = stream_name
        self.backend_port = backend_port
        self.stop_event = threading.Event()
        self.is_recording = False  # Track if ffmpeg is currently writing

    def run(self):
        start_global_cleanup()
        cam_buffer_dir = os.path.join(BUFFER_DIR, self.stream_name)
        
        while not self.stop_event.is_set():
            try:
                self.process_buffer(cam_buffer_dir)
            except Exception as e:
                print(f"[UPLOADER] ❌ Error in uploader for {self.stream_name}: {e}")
            
            # Wait before next poll
            time.sleep(2)
            
        # One last process before exiting
        try:
            self.process_buffer(cam_buffer_dir)
        except:
            pass
            
    def process_buffer(self, cam_buffer_dir):
        if not os.path.exists(cam_buffer_dir):
            return
            
        ts_files = glob.glob(os.path.join(cam_buffer_dir, "*", "*", "*.ts"))
        if not ts_files:
            return
            
        sessions = {}
        for file_path in ts_files:
            parts = file_path.replace("\\", "/").split("/")
            if len(parts) >= 4:
                time_str = parts[-2]
                date_str = parts[-3]
                session_key = f"{date_str}/{time_str}"
                
                try:
                    index = int(parts[-1].replace(".ts", ""))
                    if session_key not in sessions:
                        sessions[session_key] = []
                    sessions[session_key].append((index, file_path))
                except ValueError:
                    pass
                    
        for session_key, files in sessions.items():
            files.sort(key=lambda x: x[0])  # Sort by segment index
            
            for i, (index, file_path) in enumerate(files):
                if self.stop_event.is_set():
                    break
                    
                is_last_file = (i == len(files) - 1)
                mtime = os.path.getmtime(file_path) if os.path.exists(file_path) else 0
                age = time.time() - mtime
                
                # Safe to upload if it's not the last file, or ffmpeg stopped, or file is old enough
                is_safe_to_upload = not is_last_file or not self.is_recording or age > 15
                
                if is_safe_to_upload:
                    date_str, time_str = session_key.split("/")
                    success = self.upload_segment(date_str, time_str, index, file_path)
                    if success:
                        try:
                            if os.path.exists(file_path):
                                os.remove(file_path)
                        except OSError as e:
                            print(f"[UPLOADER] ⚠ Failed to delete {file_path}: {e}")
                    else:
                        # Break out to retry this session later and preserve order
                        break

    def upload_segment(self, date_str, time_str, index, file_path):
        url = f"http://127.0.0.1:{self.backend_port}/_seg/{self.stream_name}/{date_str}/{time_str}/{index}"
        try:
            with open(file_path, "rb") as f:
                data = f.read()
            res = requests.put(url, data=data, timeout=15)
            if res.status_code in (200, 201):
                return True
            else:
                print(f"[UPLOADER] ⚠ Failed to upload {file_path} (Status {res.status_code}): {res.text}")
                return False
        except requests.exceptions.RequestException as e:
            # Network issue, just retry later quietly
            return False
        except Exception as e:
            print(f"[UPLOADER] ⚠ Unexpected error uploading {file_path}: {e}")
            return False
