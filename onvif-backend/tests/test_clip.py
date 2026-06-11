import os
from datetime import datetime
from app.core.database import mongo_client
import forensic_tracker
import encrypt_service

MONGO_URI = "mongodb://localhost:27017/"
client = mongo_client
db = client["mirador-vms"]
forensic_col = db["forensic_index"]

# Find a detection to test
det = forensic_col.find_one({"detection_id": "det_1036"})
if not det:
    det = forensic_col.find_one()

print("Testing detection:", det)
if det:
    out_path = "test_out.mp4"
    if os.path.exists(out_path):
        try: os.unlink(out_path)
        except: pass
        
    print("\nRunning get_clip_with_fallback...")
    # Enable verbose printing by overriding print temporarily
    success = forensic_tracker.get_clip_with_fallback(det, out_path, db=db)
    print("Success status:", success)
    if os.path.exists(out_path):
        print("Output file size:", os.path.getsize(out_path))
    else:
        print("Output file does not exist!")
else:
    print("No detections found in forensic_index!")
