import os

LICENSE_FILE = os.path.join(os.path.dirname(__file__), "license.key")

def load_license():
    import os

    LICENSE_FILE = os.path.join(os.path.dirname(__file__), "license.key")

    print("📂 Reading from:", LICENSE_FILE)

    if not os.path.exists(LICENSE_FILE):
        print("❌ NOT FOUND")
        return None

    with open(LICENSE_FILE, "r") as f:
        data = f.read().strip()

    print("📄 LICENSE INSIDE FILE:", data)

    return data