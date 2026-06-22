import os
from pathlib import Path

# Load .env file from parent directory (VMS_Project/.env)
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, val = line.split("=", 1)
            val = val.strip().strip("'\"")
            os.environ.setdefault(key.strip(), val)

from schedulers.main import start
if __name__ == "__main__":
    start()
