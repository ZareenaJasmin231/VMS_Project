import jwt
from datetime import datetime, timedelta

SECRET = "MIRADOR_SECRET_KEY"

def generate_32_license(device_id):
    payload = {
        "plan": "BASIC_32",
        "max_cameras": 2,
        "features": ["live", "playback", "backup", "export"],
        "device_id": device_id,
        "exp": datetime.utcnow() + timedelta(days=3650)
    }

    return jwt.encode(payload, SECRET, algorithm="HS256")


print(generate_32_license("MY_PC_001"))