import os
from pathlib import Path

# Disable OpenCV OpenCL globally to prevent Intel igdfcl64.dll crashes
os.environ["OPENCV_OPENCL_RUNTIME"] = "disabled"
os.environ["OPENCV_OPENCL_DEVICE"] = "disabled"

import requests
# Global requests timeout patch to prevent third-party libraries from hanging indefinitely on network requests
_orig_send = requests.Session.send
def _patched_send(self, request, **kwargs):
    kwargs.setdefault('timeout', 8)
    return _orig_send(self, request, **kwargs)
requests.Session.send = _patched_send

try:
    import cv2
    cv2.ocl.setUseOpenCL(False)
except ImportError:
    pass

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
