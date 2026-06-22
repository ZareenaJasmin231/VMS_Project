# ========================================================================
# VMS Backend NSSM Service Setup Script
# ========================================================================
# Installs and registers the VMS Backend as a native Windows Service
# using NSSM (Non-Sucking Service Manager).
#
# Run this script as ADMINISTRATOR:
# powershell -ExecutionPolicy Bypass -File "setup_nssm_service.ps1"
# ========================================================================

Write-Host "VMS Service Deployment Manager (NSSM)" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

# ── 1. Validate Administrator Privileges ─────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "ERROR: This script MUST be run from an Administrator PowerShell prompt."
    Write-Host "Please close this shell, right-click PowerShell, select 'Run as Administrator', and run this script again." -ForegroundColor Yellow
    Exit 1
}

# ── 2. Setup Bin Directory & Download NSSM ────────────────────────────────
$binDir = Join-Path $PSScriptRoot "bin"
$nssmExe = Join-Path $binDir "nssm.exe"
$nssmZip = Join-Path $binDir "nssm-2.24.zip"

if (-not (Test-Path $nssmExe)) {
    Write-Host "[STEP 1] Downloading NSSM..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    
    # Official URL
    $nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
    try {
        Invoke-WebRequest -Uri $nssmUrl -OutFile $nssmZip -TimeoutSec 30
        Write-Host "Extracting NSSM..." -ForegroundColor Yellow
        Expand-Archive -Path $nssmZip -DestinationPath $binDir -Force
        
        # Copy win64 nssm.exe to bin/
        $win64Nssm = Join-Path $binDir "nssm-2.24\win64\nssm.exe"
        if (Test-Path $win64Nssm) {
            Copy-Item -Path $win64Nssm -Destination $nssmExe -Force
            Write-Host "[OK] NSSM 64-bit extracted successfully." -ForegroundColor Green
        } else {
            throw "win64\nssm.exe not found in extracted files."
        }
    } catch {
        Write-Error "Failed to download NSSM from the official website: $_"
        Write-Host "Attempting fallback to secure GitHub mirror..." -ForegroundColor Yellow
        $fallbackUrl = "https://github.com/kirillgorgut/nssm-mirror/raw/master/nssm-2.24.zip"
        try {
            Invoke-WebRequest -Uri $fallbackUrl -OutFile $nssmZip -TimeoutSec 30
            Expand-Archive -Path $nssmZip -DestinationPath $binDir -Force
            Copy-Item -Path (Join-Path $binDir "nssm-2.24\win64\nssm.exe") -Destination $nssmExe -Force
            Write-Host "[OK] NSSM downloaded and extracted from mirror." -ForegroundColor Green
        } catch {
            Write-Error "All NSSM download attempts failed. Please place nssm.exe inside the '$binDir' directory manually."
            Exit 1
        }
    } finally {
        # Cleanup temporary files
        if (Test-Path $nssmZip) { Remove-Item -Path $nssmZip -Force }
        $extractedDir = Join-Path $binDir "nssm-2.24"
        if (Test-Path $extractedDir) { Remove-Item -Path $extractedDir -Recurse -Force }
    }
} else {
    Write-Host "[STEP 1] NSSM is already installed." -ForegroundColor Green
}

# ── 3. Parse and Optimize .env File ──────────────────────────────────────
Write-Host "`n[STEP 2] Parsing and configuring environment variables..." -ForegroundColor Yellow
$envFilePath = Join-Path $PSScriptRoot ".env"
$envVars = @{}

if (Test-Path $envFilePath) {
    Write-Host "Found .env file. Loading configuration..." -ForegroundColor Cyan
    Get-Content $envFilePath | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line -like "*=*") {
            $parts = $line.Split("=", 2)
            $key = $parts[0].Trim()
            $val = $parts[1].Trim()
            # Strip outer quotes if present
            $val = $val -replace "^['`"]|['`"]$" , ""
            $envVars[$key] = $val
        }
    }
} else {
    Write-Host "No .env file found at root. Using default fallback configuration." -ForegroundColor Yellow
}

# Native Host Overrides: Shift from Docker container addresses to localhost
if ($envVars.ContainsKey("MINIO_ENDPOINT") -and $envVars["MINIO_ENDPOINT"] -eq "minio:9000") {
    $envVars["MINIO_ENDPOINT"] = "127.0.0.1:9000"
    Write-Host "🔧 Overrode MINIO_ENDPOINT to '127.0.0.1:9000' for host deployment." -ForegroundColor Gray
}
if (-not $envVars.ContainsKey("MONGO_URI")) {
    $envVars["MONGO_URI"] = "mongodb://127.0.0.1:27017/"
} else {
    $envVars["MONGO_URI"] = $envVars["MONGO_URI"] -replace "mongo", "127.0.0.1"
}
if ($envVars.ContainsKey("MQTT_BROKER") -and $envVars["MQTT_BROKER"] -eq "mosquitto") {
    $envVars["MQTT_BROKER"] = "127.0.0.1"
}
# Default native recordings directory matches backend compose volume E:/REC
if (-not $envVars.ContainsKey("RECORDINGS_DIR")) {
    $envVars["RECORDINGS_DIR"] = "E:/REC"
}
# Ensure the key file uses the native Windows path sibling by default
if (-not $envVars.ContainsKey("VIDEO_KEY_FILE")) {
    $envVars["VIDEO_KEY_FILE"] = "$PSScriptRoot/devices_data/video.key"
}
if (-not $envVars.ContainsKey("RECORDING_CONFIG_FILE")) {
    $envVars["RECORDING_CONFIG_FILE"] = "$PSScriptRoot/devices_data/recording_config.json"
}
if (-not $envVars.ContainsKey("BACKEND_PORT")) {
    $envVars["BACKEND_PORT"] = "80"
}

# ── 4. Verify Python and Virtual Environment ──────────────────────────────
Write-Host "`n[STEP 3] Locating Python executable..." -ForegroundColor Yellow
$backendDir = Join-Path $PSScriptRoot "onvif-backend"
$pythonExe = Join-Path $backendDir "venv\Scripts\python.exe"

if (-not (Test-Path $pythonExe)) {
    Write-Host "[WARNING] Python Virtual Environment (venv) not found at: $pythonExe" -ForegroundColor Yellow
    Write-Host "Searching system path for global python..." -ForegroundColor Yellow
    $globalPython = Get-Command python -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if ($globalPython) {
        $pythonExe = $globalPython
        Write-Host "Found global python: $pythonExe" -ForegroundColor Cyan
    } else {
        Write-Error "ERROR: Python was not found on this system. Please install Python 3.10+ and add it to your PATH."
        Exit 1
    }
} else {
    Write-Host "[OK] Using Python Virtual Environment: $pythonExe" -ForegroundColor Green
}

# ── 5. Register the Service via NSSM ─────────────────────────────────────
Write-Host "`n[STEP 4] Registering VMS_Backend Windows Service..." -ForegroundColor Yellow

$serviceName = "VMS_Backend"
$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue

if ($existingService) {
    Write-Host "Service '$serviceName' already exists. Reinstalling..." -ForegroundColor Cyan
    & $nssmExe stop $serviceName | Out-Null
    & $nssmExe remove $serviceName confirm | Out-Null
}

$port = $envVars["BACKEND_PORT"]
$args = "-m uvicorn app.main:app --host 0.0.0.0 --port $port"

# Install service
& $nssmExe install $serviceName "$pythonExe" "$args"
& $nssmExe set $serviceName AppDirectory "$backendDir"
& $nssmExe set $serviceName Description "MIRADOR Video Management System Backend Service"
& $nssmExe set $serviceName Start SERVICE_AUTO_START

# Add environment variables
$envLines = @()
foreach ($key in $envVars.Keys) {
    $envLines += "$key=$($envVars[$key])"
}
$envString = $envLines -join "`n"
& $nssmExe set $serviceName AppEnvironmentExtra "$envString"

Write-Host "[SUCCESS] Windows Service '$serviceName' registered successfully." -ForegroundColor Green

# ── 6. Start the Service ──────────────────────────────────────────────────
Write-Host "`n[STEP 5] Starting service..." -ForegroundColor Yellow
& $nssmExe start $serviceName

Start-Sleep -Seconds 3
$status = Get-Service -Name $serviceName
if ($status.Status -eq "Running") {
    Write-Host "[OK] VMS Backend service is now RUNNING!" -ForegroundColor Green
    Write-Host "Access it at http://localhost:$port" -ForegroundColor Cyan
} else {
    Write-Host "[WARNING] Service was started but status is: $($status.Status)" -ForegroundColor Yellow
    Write-Host "Please check backend logs or NSSM logs if the startup failed." -ForegroundColor Yellow
}

# ── 7. Display Deployment Instructions ────────────────────────────────────
Write-Host "`n[COMPLETE] Service Setup Summary" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Service Name:  VMS_Backend" -ForegroundColor White
Write-Host "Executable:    $pythonExe" -ForegroundColor White
Write-Host "Arguments:     $args" -ForegroundColor White
Write-Host "Directory:     $backendDir" -ForegroundColor White
Write-Host "Port:          $port" -ForegroundColor White
Write-Host "Recordings:    $($envVars['RECORDINGS_DIR'])" -ForegroundColor White
Write-Host "`nUseful PowerShell Service Commands:" -ForegroundColor Yellow
Write-Host "Start Service:   nssm start VMS_Backend   (or Start-Service VMS_Backend)" -ForegroundColor White
Write-Host "Stop Service:    nssm stop VMS_Backend    (or Stop-Service VMS_Backend)" -ForegroundColor White
Write-Host "Service Status:  nssm status VMS_Backend  (or Get-Service VMS_Backend)" -ForegroundColor White
Write-Host "Configure UI:    nssm edit VMS_Backend" -ForegroundColor White
Write-Host "Remove Service:  nssm remove VMS_Backend" -ForegroundColor White
