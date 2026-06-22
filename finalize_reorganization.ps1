# Finalize Reorganization Script
# Run this script in PowerShell inside the VMS_Project directory to perform the moves/deletes of legacy directories and binary files.

# 1. Rename smartsearcxh to smartsearch
if (Test-Path "miradorai-vms\src\pages\smartsearcxh") {
    Rename-Item -Path "miradorai-vms\src\pages\smartsearcxh" -NewName "smartsearch" -Force
    Write-Host "[REORG] Renamed smartsearcxh to smartsearch."
}

# 2. Copy binary key and decrypted video segments to the new player directory
if (Test-Path "miradorai-vms\src\pages\player_mirador\video.key") {
    Copy-Item -Path "miradorai-vms\src\pages\player_mirador\video.key" -Destination "onvif-backend\player\video.key" -Force
    Write-Host "[REORG] Copied video.key to onvif-backend\player\"
}
if (Test-Path "miradorai-vms\src\pages\player_mirador\decrypted") {
    Copy-Item -Path "miradorai-vms\src\pages\player_mirador\decrypted" -Destination "onvif-backend\player\decrypted" -Recurse -Force
    Write-Host "[REORG] Copied decrypted segments folder to onvif-backend\player\"
}

# 3. Delete legacy player_mirador directory entirely
if (Test-Path "miradorai-vms\src\pages\player_mirador") {
    Remove-Item -Path "miradorai-vms\src\pages\player_mirador" -Recurse -Force
    Write-Host "[REORG] Deleted miradorai-vms\src\pages\player_mirador"
}

# 4. Delete origin_conf/ entirely
if (Test-Path "origin_conf") {
    Remove-Item -Path "origin_conf" -Recurse -Force
    Write-Host "[REORG] Deleted origin_conf/"
}

# 5. Delete onvif-backend/Dockerfile
if (Test-Path "onvif-backend\Dockerfile") {
    Remove-Item -Path "onvif-backend\Dockerfile" -Force
    Write-Host "[REORG] Deleted onvif-backend\Dockerfile"
}

# 6. Delete onvif-backend/app/refactor_main.py, rewrite_main.py, refactor_script.py
@("refactor_main.py", "rewrite_main.py", "refactor_script.py") | ForEach-Object {
    $path = "onvif-backend\app\$_"
    if (Test-Path $path) {
        Remove-Item -Path $path -Force
        Write-Host "[REORG] Deleted $path"
    }
}

# 7. Delete onvif-backend/models/, onvif-backend/routes/, onvif-backend/utils/
@("models", "routes", "utils") | ForEach-Object {
    $path = "onvif-backend\$_"
    if (Test-Path $path) {
        Remove-Item -Path $path -Recurse -Force
        Write-Host "[REORG] Deleted $path/"
    }
}

# 8. Delete moved legacy files in app/services/storage/
@("rtsp_recorder.py", "recorder_worker.py", "encrypt_service.py", "backup_service.py", "signature_service.py", "signature_service.zip") | ForEach-Object {
    $path = "onvif-backend\app\services\storage\$_"
    if (Test-Path $path) {
        Remove-Item -Path $path -Force
        Write-Host "[REORG] Deleted legacy storage file: $path"
    }
}
if (Test-Path "onvif-backend\app\services\storage") {
    Remove-Item -Path "onvif-backend\app\services\storage" -Recurse -Force
    Write-Host "[REORG] Cleaned up legacy app\services\storage\"
}

# 9. Delete moved legacy files in app/background/
@("email_report_worker.py", "forensic_indexer_worker.py", "stream_health.py", "mqtt_to_db.py", "hardware_health.py") | ForEach-Object {
    $path = "onvif-backend\app\background\$_"
    if (Test-Path $path) {
        Remove-Item -Path $path -Force
        Write-Host "[REORG] Deleted legacy background file: $path"
    }
}
if (Test-Path "onvif-backend\app\background") {
    Remove-Item -Path "onvif-backend\app\background" -Recurse -Force
    Write-Host "[REORG] Cleaned up legacy app\background\"
}

# 10. Delete app/services/camera/ome_service.py
if (Test-Path "onvif-backend\app\services\camera\ome_service.py") {
    Remove-Item -Path "onvif-backend\app\services\camera\ome_service.py" -Force
    Write-Host "[REORG] Deleted onvif-backend\app\services\camera\ome_service.py"
}

Write-Host "[REORG] Reorganization completed successfully! You can delete this script (finalize_reorganization.ps1) when done."
