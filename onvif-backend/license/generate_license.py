import jwt
from datetime import datetime, timedelta, UTC
import uuid

SECRET = "!@#$%^&*"

# ✅ ADD THIS FUNCTION
def get_device_id():
    return str(uuid.getnode())

def generate_license(device_id):
    payload = {
        "plan": "BASIC_10",
        "max_cameras": 10,
        "device_id": device_id,
        "exp": datetime.now(UTC) + timedelta(days=3650)
    }

    token = jwt.encode(payload, SECRET, algorithm="HS256")
    return token

# ✅ NOW THIS WILL WORK
print(generate_license(get_device_id()))