import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'onvif-backend')))
from app.core.database import db as _db

db = _db['cameras']
db.update_one({'ip': '192.168.126.235'}, {'$set': {'username': 'service', 'password': 'Admin123!', 'manufacturer': 'Bosch'}})
db.update_one({'ip': '192.168.126.234'}, {'$set': {'username': 'service', 'password': 'Admin1234', 'manufacturer': 'Axis'}})
db.update_one({'ip': '192.168.126.240'}, {'$set': {'username': 'MIRADOR VMS', 'password': 'Miradorvms@axis', 'manufacturer': 'Axis'}})
docs = list(db.find({}, {'_id': 0, 'ip': 1, 'username': 1, 'password': 1}))
print('Updated! Current state:')
for d in docs:
    print(d)