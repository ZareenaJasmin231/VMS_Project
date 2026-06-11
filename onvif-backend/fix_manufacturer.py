from pymongo import MongoClient

client = MongoClient("mongodb://127.0.0.1:27017/")
db = client["mirador-vms"]

for sub in db.analytics_subs_col.find({"enabled": True}):
    ip = sub.get("ip")
    # find camera in cameras collection
    cam = db.cameras.find_one({"ip": ip})
    if cam:
        manuf = cam.get("manufacturer", "bosch")
        print(f"Updating {ip} to manufacturer: {manuf}")
        db.analytics_subs_col.update_one({"_id": sub["_id"]}, {"$set": {"manufacturer": manuf}})
    else:
        print(f"Camera {ip} not found in cameras col")

client.close()
