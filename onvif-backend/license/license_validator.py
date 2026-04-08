import jwt
from license.device import get_device_id

SECRET = "MIRADOR_SECRET_KEY"

def validate_license(token):
    try:
        decoded = jwt.decode(token, SECRET, algorithms=["HS256"])

        if decoded["device_id"] != get_device_id():
            return False, "Invalid device"

        return True, decoded

    except jwt.ExpiredSignatureError:
        return False, "License expired"

    except Exception:
        return False, "Invalid license"