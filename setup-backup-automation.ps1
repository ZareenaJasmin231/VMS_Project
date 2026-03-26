# ========================================================================
# Docker Startup & Key Backup Automation
# ========================================================================
# This script ensures Docker is running, backs up the key, and uploads to cloud
# Run with: powershell -ExecutionPolicy Bypass -File "setup-backup-automation.ps1"
# ========================================================================

Write-Host "[SETUP] VMS Encryption Key Backup Automation" -ForegroundColor Cyan
Write-Host "[SETUP] ============================================" -ForegroundColor Cyan

# Step 1: Check and start Docker
Write-Host "`n[STEP 1] Checking Docker status..." -ForegroundColor Yellow

$dockerRunning = $false
try {
    $result = docker ps -q 2>&1
    if ($LASTEXITCODE -eq 0) {
        $dockerRunning = $true
        Write-Host "[OK] Docker daemon is running" -ForegroundColor Green
    }
} catch {
    $dockerRunning = $false
}

if (-not $dockerRunning) {
    Write-Host "[WARNING] Docker daemon is not running" -ForegroundColor Yellow
    Write-Host "[ACTION] Attempting to start Docker Desktop..." -ForegroundColor Yellow
    
    # Try to find and start Docker Desktop
    $dockerDesktopPath = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerDesktopPath) {
        & $dockerDesktopPath
        Write-Host "[ACTION] Waiting 30 seconds for Docker to start..." -ForegroundColor Yellow
        Start-Sleep -Seconds 30
        
        # Verify Docker started
        $attempt = 0
        while ($attempt -lt 5) {
            try {
                $result = docker ps -q 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "[OK] Docker started successfully" -ForegroundColor Green
                    $dockerRunning = $true
                    break
                }
            } catch {
                $attempt++
                if ($attempt -lt 5) {
                    Write-Host "[WAIT] Docker still starting... (attempt $attempt/5)" -ForegroundColor Yellow
                    Start-Sleep -Seconds 10
                }
            }
        }
    } else {
        Write-Host "[ERROR] Docker Desktop not found at: $dockerDesktopPath" -ForegroundColor Red
        Write-Host "[HELP] Please start Docker Desktop manually and run this script again" -ForegroundColor Red
        exit 1
    }
}

if (-not $dockerRunning) {
    Write-Host "[ERROR] Docker failed to start after 5 attempts" -ForegroundColor Red
    Write-Host "[HELP] Please start Docker Desktop manually at: $dockerDesktopPath" -ForegroundColor Red
    exit 1
}

# Step 2: Run backup
Write-Host "`n[STEP 2] Running encryption key backup..." -ForegroundColor Yellow
$backupScript = "$PSScriptRoot/scripts/backup-encryption-key.ps1"

if (Test-Path $backupScript) {
    & $backupScript
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[SUCCESS] Backup completed" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Backup failed" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[ERROR] Backup script not found: $backupScript" -ForegroundColor Red
    exit 1
}

# Step 3: Display cloud upload options
Write-Host "`n[STEP 3] Cloud Backup Options" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "Next, upload the backup file to cloud storage:`n" -ForegroundColor White

Write-Host "[OPTION 1] OneDrive (Windows Built-in)" -ForegroundColor Cyan
Write-Host "  1. Open File Explorer" -ForegroundColor White
Write-Host "  2. Navigate to: $PSScriptRoot\backups\" -ForegroundColor White
Write-Host "  3. Right-click video.key.latest" -ForegroundColor White
Write-Host "  4. Select 'Share' > OneDrive > Create shareable link" -ForegroundColor White
Write-Host "  5. Store link in password manager (1Password, Bitwarden, etc)" -ForegroundColor White

Write-Host "`n[OPTION 2] Google Drive" -ForegroundColor Cyan
Write-Host "  1. Visit: https://drive.google.com" -ForegroundColor White
Write-Host "  2. Create folder: 'VMS-Backups'" -ForegroundColor White
Write-Host "  3. Upload: $PSScriptRoot\backups\video.key.latest" -ForegroundColor White
Write-Host "  4. Right-click > Make a copy daily (or set reminder)" -ForegroundColor White

Write-Host "`n[OPTION 3] AWS S3" -ForegroundColor Cyan
Write-Host "  1. Install AWS CLI: https://aws.amazon.com/cli/" -ForegroundColor White
Write-Host "  2. Configure credentials: aws configure" -ForegroundColor White
Write-Host "  3. Run: aws s3 cp $PSScriptRoot\backups\video.key.latest s3://your-bucket/vms-backups/" -ForegroundColor White

Write-Host "`n[OPTION 4] Print Physical Backup" -ForegroundColor Cyan
Write-Host "  1. Run: Get-Content $PSScriptRoot\backups\video.key.latest | Format-Hex" -ForegroundColor White
Write-Host "  2. Copy the hex output" -ForegroundColor White
Write-Host "  3. Paste into Word document" -ForegroundColor White
Write-Host "  4. Print and store in safe/vault" -ForegroundColor White

# Step 4: Schedule daily backups
Write-Host "`n[STEP 4] Scheduling Daily Backups..." -ForegroundColor Yellow

$taskName = "VMS-Encryption-Key-Backup"
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($existingTask) {
    Write-Host "[INFO] Scheduled task already exists: $taskName" -ForegroundColor Cyan
    Write-Host "[REMOVE] Removing old task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# Create scheduled task
$scriptPath = $backupScript
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
$principal = New-ScheduledTaskPrincipal -UserID "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "[SUCCESS] Daily backup scheduled (2:00 AM every day)" -ForegroundColor Green
Write-Host "[VERIFY] Task name: $taskName" -ForegroundColor Cyan

# Step 5: Summary
Write-Host "`n[COMPLETE] Setup Summary" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "[BACKUP] First backup created at:" -ForegroundColor White
Write-Host "         $PSScriptRoot\backups\video.key.latest" -ForegroundColor Cyan
Write-Host "[SCHEDULE] Daily backups: 2:00 AM every day" -ForegroundColor White
Write-Host "[NEXT] Upload backup to cloud storage (see options above)" -ForegroundColor Yellow
Write-Host "[VERIFY] Run: Get-ScheduledTask -TaskName '$taskName'" -ForegroundColor White

Write-Host "`n[IMPORTANT] Do NOT lose this key!" -ForegroundColor Red
Write-Host "            All encrypted recordings depend on it" -ForegroundColor Red
