import sys

filepath = r'c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\api\routers\camera_router.py'

with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
new_lines.extend(lines[:560]) # up to the blank line before @router.post("/onvif/probe")
new_lines.extend(lines[971:]) # from @features_router.post("/capabilities") onwards

content = "".join(new_lines)

# Add imports
imports = """
import asyncio
import re
import os
import urllib.parse
from datetime import datetime
import requests as http_requests

from license.license_store import load_license
from license.license_validator import validate_license
from app.core.lifecycle import _analytics_tasks, OME_API, OME_AUTH, OME_WS_PORT
from app.managers.health_manager import analytics_poll_loop as _analytics_poll_loop
from app.core.database import analytics_col, analytics_subs_col
from app.managers.stream_manager import load_devices, save_camera_to_db, _watchdog_failures
from app.services.camera.ome_service import stream_exists_in_ome

OME_HOST_IP = os.environ.get("OME_HOST_IP", "192.168.126.200")
"""

# Find where to insert imports (after existing imports)
lines_content = content.split('\n')
insert_idx = 0
for i, line in enumerate(lines_content):
    if line.startswith('router = '):
        insert_idx = i
        break

lines_content.insert(insert_idx, imports)
final_content = '\n'.join(lines_content)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(final_content)
print("SUCCESS: Fixes applied.")
