import sys

filepath = r'c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\api\routers\playback_router.py'

with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if line.startswith('async def system_health_collector():'):
        start_idx = i
        break

for i in range(start_idx, len(lines)):
    if lines[i].startswith('@router.get("/api/event-clips"'):
        # Let's keep the lines starting from # Debug so we go back a few lines
        end_idx = i - 5
        break

if start_idx != -1 and end_idx != -1:
    new_lines = lines[:start_idx] + lines[end_idx:]
    with open(filepath, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print(f'Successfully removed lines {start_idx} to {end_idx - 1}')
else:
    print(f'Failed to find indices. Start: {start_idx}, End: {end_idx}')
