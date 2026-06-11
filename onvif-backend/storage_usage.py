import pymongo

client = pymongo.MongoClient('mongodb://mongo:27017')
db = client['mirador-vms']
pipeline = [
    {'$group': {'_id': '$camera_id', 'total_bytes': {'$sum': '$file_size'}}},
    {'$sort': {'total_bytes': -1}}
]
results = list(db.recordings.aggregate(pipeline))

print("\n--- STORAGE USAGE PER CAMERA ---")
for r in results:
    camera = r['_id']
    mb = r['total_bytes'] / (1024 * 1024)
    gb = mb / 1024
    if gb >= 1:
        print(f"Camera {camera}: {gb:.2f} GB")
    else:
        print(f"Camera {camera}: {mb:.2f} MB")
print("--------------------------------\n")
