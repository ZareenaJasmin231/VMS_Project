import os
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|stimeout;2000000"

import threading
import time
import cv2
import numpy as np
from pymongo import MongoClient

# We will import recorder inside methods to avoid circular import issues
# if recorder imports motion_detector

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")

# Shared MongoDB client — reused across all motion detector threads
_shared_mongo = MongoClient(MONGO_URI, maxPoolSize=10)
_shared_db = _shared_mongo["mirador-vms"]

class CameraMotionDetector(threading.Thread):
    def __init__(self, stream_name: str, rtsp_url: str, camera_data: dict):
        super().__init__(daemon=True, name=f"motion-detector-{stream_name}")
        self.stream_name = stream_name
        self.rtsp_url = rtsp_url
        self.camera_data = camera_data
        self.stop_event = threading.Event()
        
    def get_sub_stream_url(self) -> str:
        profiles = self.camera_data.get("stream_profiles", [])
        if not profiles:
            return self.rtsp_url
            
        def sort_key(p):
            w = p.get("width") or 0
            h = p.get("height") or 0
            res = w * h
            br = p.get("bitrate") or 0
            return (res, br)
            
        sorted_profiles = sorted(profiles, key=sort_key)
        sub_profile = sorted_profiles[0]
        
        rtsp_url = sub_profile.get("rtsp_url")
        if not rtsp_url:
            return self.rtsp_url
            
        user = self.camera_data.get("username")
        password = self.camera_data.get("password")
        
        # Fallback: extract credentials from main rtsp_url if fields are empty
        if (not user or not password) and self.rtsp_url.startswith("rtsp://"):
            try:
                import urllib.parse
                url_part = self.rtsp_url[7:]
                if "@" in url_part:
                    creds = url_part.split("@", 1)[0]
                    if ":" in creds:
                        u, p = creds.split(":", 1)
                        if not user:
                            user = urllib.parse.unquote(u)
                        if not password:
                            password = urllib.parse.unquote(p)
                    else:
                        if not user:
                            user = urllib.parse.unquote(creds)
            except Exception as e:
                print(f"[MOTION DETECT] Error parsing credentials from main URL: {e}")
        
        if user and rtsp_url.startswith("rtsp://"):
            import urllib.parse
            url_part = rtsp_url[7:]
            if "@" in url_part:
                url_part = url_part.split("@", 1)[1]
            encoded_user = urllib.parse.quote(user)
            encoded_pass = urllib.parse.quote(password or "")
            return f"rtsp://{encoded_user}:{encoded_pass}@{url_part}"
            
        return rtsp_url

    def run(self):
        import rtsp_recorder as recorder
        sub_rtsp = self.get_sub_stream_url()
        print(f"[MOTION DETECT] ▶ Starting motion detector for {self.stream_name} on sub-stream: {sub_rtsp}")
        
        cap = cv2.VideoCapture(sub_rtsp, cv2.CAP_FFMPEG)
        # Use MOG2 background subtractor
        fgbg = cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=16, detectShadows=False)
        
        # Load frontal face Haar Cascade
        face_cascade_path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
        face_cascade = cv2.CascadeClassifier(face_cascade_path)
        
        last_process_time = 0
        consecutive_failures = 0
        
        while not self.stop_event.is_set():
            ret = cap.grab()
            if not ret:
                consecutive_failures += 1
                if consecutive_failures >= 30:
                    print(f"[MOTION DETECT] ⚠ {self.stream_name} stream grab failed 30 times, reconnecting...")
                    cap.release()
                    time.sleep(5)
                    cap = cv2.VideoCapture(sub_rtsp, cv2.CAP_FFMPEG)
                    consecutive_failures = 0
                else:
                    time.sleep(0.1)
                continue
            
            consecutive_failures = 0
            now = time.time()
            if now - last_process_time >= 0.5: # 2 FPS
                last_process_time = now
                ret, frame = cap.retrieve()
                if ret and frame is not None:
                    try:
                        # Resize to 160x120 to keep CPU extremely low
                        small_frame = cv2.resize(frame, (160, 120))
                        # Gray scale
                        gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
                        # Blur to remove noise
                        gray = cv2.GaussianBlur(gray, (5, 5), 0)
                        
                        fgmask = fgbg.apply(gray)
                        
                        # Count non-zero pixels (pixels changed)
                        non_zero = np.count_nonzero(fgmask)
                        total_pixels = gray.shape[0] * gray.shape[1]
                        motion_ratio = non_zero / total_pixels
                        
                        # Threshold of 1.5% pixel change
                        if motion_ratio > 0.015:
                            # Detect and crop face
                            face_file_url = None
                            try:
                                h_orig, w_orig = frame.shape[:2]
                                scale_w = 640 / w_orig
                                scale_h = 480 / h_orig
                                face_detect_frame = cv2.resize(frame, (640, 480))
                                gray_face = cv2.cvtColor(face_detect_frame, cv2.COLOR_BGR2GRAY)
                                faces = face_cascade.detectMultiScale(gray_face, scaleFactor=1.1, minNeighbors=3, minSize=(30, 30))
                                
                                if len(faces) > 0:
                                    # Found face! Crop first match from original frame
                                    (x, y, w, h) = faces[0]
                                    x_orig = int(x / scale_w)
                                    y_orig = int(y / scale_h)
                                    w_orig_crop = int(w / scale_w)
                                    h_orig_crop = int(h / scale_h)
                                    
                                    # Clamp coordinates
                                    x0 = max(0, min(x_orig, w_orig - 1))
                                    y0 = max(0, min(y_orig, h_orig - 1))
                                    x1 = max(0, min(x_orig + w_orig_crop, w_orig))
                                    y1 = max(0, min(y_orig + h_orig_crop, h_orig))
                                    
                                    if (x1 - x0) > 0 and (y1 - y0) > 0:
                                        face_crop = frame[y0:y1, x0:x1]
                                        faces_dir = os.path.join(os.path.dirname(__file__), "static", "faces")
                                        os.makedirs(faces_dir, exist_ok=True)
                                        
                                        import uuid
                                        face_filename = f"face_{self.stream_name}_{int(time.time())}_{uuid.uuid4().hex[:6]}.jpg"
                                        face_filepath = os.path.join(faces_dir, face_filename)
                                        cv2.imwrite(face_filepath, face_crop)
                                        face_file_url = f"/api/faces/{face_filename}"
                                        print(f"[MOTION DETECT] 👤 Face detected and cropped: {face_filename}")
                            except Exception as fe:
                                print(f"[MOTION DETECT] ❌ Face detection error: {fe}")

                            # Trigger motion with the face URL
                            recorder.trigger_motion(self.stream_name, face_file_url)
                            
                            # Insert alert into MongoDB for frontend Live View UI to pick up
                            try:
                                from datetime import datetime
                                ip = self.camera_data.get("ip", "")
                                alert_doc = {
                                    "ip": ip,
                                    "serial": ip.replace(".", "_"),
                                    "type": "Motion",
                                    "scenario": f"[RECORDER] 💥 Motion trigger received for {self.stream_name}",
                                    "status": "Active",
                                    "source": "software_motion",
                                    "topic": "motion_detected",
                                    "raw": {"motion_ratio": motion_ratio},
                                    "time": datetime.utcnow().isoformat() + "Z",
                                    "received_at": datetime.utcnow().isoformat() + "Z",
                                    "face_url": face_file_url
                                }
                                _shared_db["mqtt_logs"].insert_one(alert_doc)
                                print(f"[MOTION DETECT] 🚨 Logged software motion alert for {self.stream_name}")
                            except Exception as e:
                                print(f"[MOTION DETECT] Error logging alert: {e}")
                    except Exception as e:
                        print(f"[MOTION DETECT] ❌ Error processing frame for {self.stream_name}: {e}")
                        
        cap.release()
        print(f"[MOTION DETECT] ⏹ Stopped motion detector for {self.stream_name}")

def cleanup_face_images_loop():
    faces_dir = os.path.join(os.path.dirname(__file__), "static", "faces")
    while True:
        try:
            if os.path.exists(faces_dir):
                now = time.time()
                for filename in os.listdir(faces_dir):
                    filepath = os.path.join(faces_dir, filename)
                    if os.path.isfile(filepath) and filename.endswith(".jpg"):
                        file_age = now - os.path.getmtime(filepath)
                        if file_age > 120:  # 2 minutes
                            os.remove(filepath)
                            print(f"[CLEANUP] Deleted face crop file: {filename}")
        except Exception as e:
            print(f"[CLEANUP] Error in cleanup loop: {e}")
        time.sleep(15)
class MotionDetectorManager:
    def __init__(self):
        self.detectors = {}
        self.lock = threading.Lock()
        self.running = False
        self.thread = None
        self.stop_event = threading.Event()
        
    def start(self):
        with self.lock:
            if self.running:
                return
            self.running = True
            self.stop_event.clear()
            self.thread = threading.Thread(target=self._sync_loop, daemon=True, name="motion-manager")
            self.thread.start()
            
            # Start face image cleanup thread
            cleanup_thread = threading.Thread(target=cleanup_face_images_loop, daemon=True, name="face-cleanup")
            cleanup_thread.start()
            
            print("[MOTION DETECT] Manager started with face cleanup thread.")
            
    def stop(self):
        with self.lock:
            self.running = False
            self.stop_event.set()
            for detector in self.detectors.values():
                detector.stop_event.set()
            for detector in self.detectors.values():
                detector.join(timeout=2)
            self.detectors.clear()
            print("[MOTION DETECT] Manager stopped.")

    def trigger_sync(self):
        if self.running:
            threading.Thread(target=self._sync_now, daemon=True, name="motion-manager-instant-sync").start()

    def _sync_now(self):
        try:
            docs = list(_shared_db["cameras"].find({"enabled": {"$ne": False}, "motion_only": True}))
            active_streams = []
            
            for doc in docs:
                stream_name = doc.get("ome_stream")
                rtsp_url = doc.get("rtsp_url")
                if not stream_name or not rtsp_url:
                    continue
                    
                active_streams.append(stream_name)
                
                with self.lock:
                    if stream_name not in self.detectors:
                        detector = CameraMotionDetector(stream_name, rtsp_url, doc)
                        self.detectors[stream_name] = detector
                        detector.start()
                    else:
                        # Update camera data just in case
                        self.detectors[stream_name].camera_data = doc
                        
            # Stop detectors for cameras that are no longer motion_only or disabled
            with self.lock:
                to_remove = []
                for stream_name, detector in self.detectors.items():
                    if stream_name not in active_streams:
                        detector.stop_event.set()
                        to_remove.append(stream_name)
                        
                for stream_name in to_remove:
                    self.detectors[stream_name].join(timeout=2)
                    del self.detectors[stream_name]
        except Exception as e:
            print(f"[MOTION DETECT] Instant sync error: {e}")

    def _sync_loop(self):
        while not self.stop_event.is_set():
            self._sync_now()
            self.stop_event.wait(2) # check database every 2 seconds

# Global manager instance
manager = MotionDetectorManager()
