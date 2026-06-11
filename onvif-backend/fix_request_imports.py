import glob
import re

for filepath in glob.glob(r'c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\api\routers\*.py'):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Check if 'Request' is used in the file
    if re.search(r'\bRequest\b', content):
        # Check if Request is already imported
        if not re.search(r'import\s+.*Request', content) and not re.search(r'from\s+fastapi\s+import\s+.*Request', content):
            # Attempt to add Request to the fastapi import
            new_content = re.sub(r'(from\s+fastapi\s+import\s+[\w\s,]+)', r'\1, Request', content, count=1)
            
            if new_content != content:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"Added Request import to {filepath}")
