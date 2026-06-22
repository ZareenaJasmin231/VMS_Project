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

import uvicorn
if __name__ == "__main__":
    port = int(os.environ.get("BACKEND_PORT", 8000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=False)
