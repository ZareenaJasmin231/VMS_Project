import os

LICENSE_FILE = os.path.join(os.path.dirname(__file__), "license.key")

def load_license():
    if not os.path.exists(LICENSE_FILE):
        return None

    with open(LICENSE_FILE, "r") as f:
        return f.read().strip()