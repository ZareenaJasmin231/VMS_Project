import os
import re

files_to_process = [
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\components\layout\Sidebar.jsx",
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\pages\Dashboard\DashboardPage.jsx",
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\pages\liveview\LiveViewPage.jsx",
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\pages\devices\CamerasPage.jsx",
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\pages\devices\MaskingPage.jsx",
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\pages\recording\Schedules.jsx",
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\pages\recording\Recordingmethodpage.jsx",
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\pages\storage\StorageManagementPage.jsx",
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\pages\admin\MediaPlayerPage.jsx",
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\pages\forensic\ForensicSearchPage.jsx",
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\pages\admin\BackupPage.jsx",
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\pages\MapView\DesignerView.jsx",
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\pages\MapView\MapViewPage.jsx",
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\pages\infrastructure\Topology.jsx",
    r"c:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms\src\pages\logs\LogsPage.jsx"
]

def bump_match(m):
    val = int(m.group(1))
    new_val = val + 2
    return m.group(0).replace(str(val), str(new_val))

for jsx_file in files_to_process:
    css_file = jsx_file.replace(".jsx", ".css")
    for file_path in [jsx_file, css_file]:
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            # Match font-size: 12px
            content = re.sub(r'font-size:\s*(\d+)px', bump_match, content)
            
            # Match fontSize: 12
            content = re.sub(r'fontSize:\s*(\d+)(?!px)', bump_match, content)
            
            # Match fontSize: "12px" or fontSize: '12px'
            content = re.sub(r'fontSize:\s*["\'](\d+)px["\']', bump_match, content)
            
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Updated {file_path}")
