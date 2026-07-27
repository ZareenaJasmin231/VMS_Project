from pymongo import MongoClient
import sys

client = MongoClient('mongodb://127.0.0.1:27017/')
db = client['vms_db']
logs = list(db['terminal_logs'].find().sort('_id', -1).limit(40))

for l in logs:
    ts = l.get('timestamp', '')
    snippet = l.get('output_snippet', '')
    # safely encode to sys.stdout encoding or utf-8
    safe_str = f"[{ts}] {snippet}"
    sys.stdout.buffer.write(safe_str.encode('utf-8', 'ignore') + b'\n')
