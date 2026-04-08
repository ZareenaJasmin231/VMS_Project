import uuid

def get_device_id():
    return str(uuid.getnode())  # MAC address