import os

files = [
    r'c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\api\routers\system_router.py',
    r'c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\services\camera\discovery_service.py',
    r'c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\services\camera\onvif_service.py',
    r'c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\api\routers\camera_router.py',
    r'c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\api\routers\dashboard_router.py',
    r'c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\core\lifecycle.py',
    r'c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\managers\health_manager.py',
    r'c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\managers\stream_manager.py',
    r'c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\services\storage\encrypt_service.py',
    r'c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\services\storage\rtsp_recorder.py'
]

replacements = {
    "✅": "[OK]", "❌": "[FAIL]", "⚠": "[WARN]", "⏭": "[SKIP]", "💡": "[INFO]",
    "✗": "[X]", "✓": "[OK]", "⬜": "[EMPTY]", "—": "-", "“": "\"", "”": "\""
}

for filepath in files:
    if os.path.exists(filepath):
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        for k, v in replacements.items():
            content = content.replace(k, v)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Fixed emojis in {os.path.basename(filepath)}")
