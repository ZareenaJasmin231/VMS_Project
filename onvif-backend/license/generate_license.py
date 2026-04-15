import jwt
from datetime import datetime, timedelta, UTC

SECRET = "MIRADOR_SUPER_SECURE_KEY_12345678901234567890"

def generate_license(device_id):
    payload = {
        "plan": "BASIC_2",
        "max_cameras": 2,
        "device_id": device_id,
        "exp": datetime.now(UTC) + timedelta(days=3650)
    }

    token = jwt.encode(payload, SECRET, algorithm="HS256")
    return token


print(generate_license("MY_PC_001"))