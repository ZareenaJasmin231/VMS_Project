import os
import pymongo
from app.core.database import MONGO_URI

def main():
    print(f"Connecting to MongoDB at {MONGO_URI}...")
    client = pymongo.MongoClient(MONGO_URI)
    db = client["mirador-vms"]
    
    docs = list(db.recordings.find({"file_path": {"$not": {"$regex": "^minio:"}}}))
    print(f"Found {len(docs)} local file records.")
    
    fixed = 0
    for doc in docs:
        fp = doc.get("file_path")
        if fp and not os.path.exists(fp):
            # The file is missing from local disk. Assume it was uploaded to MinIO.
            cam = doc.get("camera_id")
            date = doc.get("date")
            st = doc.get("start_time")
            # If it's a motion based recording, it will have _motion_based in the local path but we don't know easily.
            # But the MinIO key is the fname.
            fname = os.path.basename(fp)
            minio_path = f"minio:{cam}/{date}/{fname}"
            
            db.recordings.update_one(
                {"_id": doc["_id"]},
                {"$set": {"file_path": minio_path}}
            )
            print(f"Updated {fp} -> {minio_path}")
            fixed += 1
            
    print(f"Fixed {fixed} missing local files to point to MinIO.")

if __name__ == "__main__":
    main()
