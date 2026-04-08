import os

LICENSE_PATH = "config/license.key"

def save_license(token):
    with open(LICENSE_PATH, "w") as f:
        f.write(token)

def load_license():
    if not os.path.exists(LICENSE_PATH):
        return None
    with open(LICENSE_PATH, "r") as f:
        return f.read().strip()