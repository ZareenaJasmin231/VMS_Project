# ========================================================================
# VMS Backend NSSM Multi-Services Setup Script
# ========================================================================
# Installs and registers the three core VMS components as native Windows Services:
# - mirador-recorder  (run_recorder.py)
# - mirador-scheduler (run_scheduler.py)
# - mirador-api       (run_api.py)
#
# Run this script as ADMINISTRATOR:
# powershell -ExecutionPolicy Bypass -File "setup_nssm_services.ps1"
# ========================================================================

Write-Host "VMS Services Deployment Manager (NSSM)" -ForegroundColor Cyan
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

# ── 3. Create Logs Directory ──────────────────────────────────────────────
$logsDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $logsDir)) {
    Write-Host "[STEP 2] Creating logs directory at $logsDir..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
}

# ── 4. Parse and Optimize .env File ──────────────────────────────────────
Write-Host "`n[STEP 3] Loading environment variables from .env..." -ForegroundColor Yellow
$envFilePath = Join-Path $PSScriptRoot ".env"
$envVars = @{}

if (Test-Path $envFilePath) {
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
    Write-Host "[OK] Loaded configuration from .env." -ForegroundColor Green
} else {
    Write-Host "No .env file found at root. Using default fallback configuration." -ForegroundColor Yellow
}

# Apply default config if missing in .env
if (-not $envVars.ContainsKey("VIDEO_KEY_FILE")) {
    $envVars["VIDEO_KEY_FILE"] = "$PSScriptRoot/devices_data/video.key"
}
if (-not $envVars.ContainsKey("RECORDING_CONFIG_FILE")) {
    $envVars["RECORDING_CONFIG_FILE"] = "$PSScriptRoot/devices_data/recording_config.json"
}

# Format extra environment variables string for NSSM
$envLines = @()
foreach ($key in $envVars.Keys) {
    $envLines += "$key=$($envVars[$key])"
}
$envString = $envLines -join "`n"

# ── 5. Verify Python Virtual Environment ──────────────────────────────
Write-Host "`n[STEP 4] Locating Python executable..." -ForegroundColor Yellow
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
        Write-Error "ERROR: Python was not found on this system. Please install Python and run virtualenv setup."
        Exit 1
    }
} else {
    Write-Host "[OK] Using Python Virtual Environment: $pythonExe" -ForegroundColor Green
}

# ── 6. Helper Function to Register/Configure NSSM Services ─────────────────
function Install-VmsService($serviceName, $scriptName, $description) {
    Write-Host "`nRegistering service '$serviceName'..." -ForegroundColor Cyan
    
    # Clean up existing service if it exists
    $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Service '$serviceName' already exists. Removing older registration..." -ForegroundColor Gray
        & $nssmExe stop $serviceName | Out-Null
        & $nssmExe remove $serviceName confirm | Out-Null
    }

    # Install service
    & $nssmExe install $serviceName "$pythonExe" "$scriptName"
    & $nssmExe set $serviceName AppDirectory "$backendDir"
    & $nssmExe set $serviceName Description "$description"
    & $nssmExe set $serviceName AppStdout "$logsDir\$serviceName.log"
    & $nssmExe set $serviceName AppStderr "$logsDir\$serviceName-err.log"
    & $nssmExe set $serviceName AppRotateFiles 1
    & $nssmExe set $serviceName Start SERVICE_AUTO_START
    
    # Apply environment variables
    if ($envString) {
        & $nssmExe set $serviceName AppEnvironmentExtra "$envString"
    }
    
    Write-Host "[OK] Service '$serviceName' registered successfully." -ForegroundColor Green
}

# ── 7. Register the Services ──────────────────────────────────────────────
Install-VmsService "mirador-recorder" "run_recorder.py" "MIRADOR Video Management System Recorder Process"
Install-VmsService "mirador-scheduler" "run_scheduler.py" "MIRADOR Video Management System Scheduler Process"
Install-VmsService "mirador-api" "run_api.py" "MIRADOR Video Management System Backend API Process"

# ── 8. Start the Services ─────────────────────────────────────────────────
Write-Host "`n[STEP 5] Starting services..." -ForegroundColor Yellow

$services = @("mirador-recorder", "mirador-scheduler", "mirador-api")
foreach ($srv in $services) {
    Write-Host "Starting $srv..." -ForegroundColor Gray
    & $nssmExe start $srv
}

Start-Sleep -Seconds 3

Write-Host "`nService Status Verification:" -ForegroundColor Yellow
Write-Host "=============================" -ForegroundColor Yellow
foreach ($srv in $services) {
    $status = Get-Service -Name $srv -ErrorAction SilentlyContinue
    if ($status) {
        $color = if ($status.Status -eq "Running") { "Green" } else { "Red" }
        Write-Host "Service: $($status.Name.PadRight(20)) Status: $($status.Status)" -ForegroundColor $color
    } else {
        Write-Host "Service: $($srv.PadRight(20)) Status: NOT FOUND" -ForegroundColor Red
    }
}

Write-Host "`n[COMPLETE] All native VMS services are registered." -ForegroundColor Green
Write-Host "Logs are saved under the project root 'logs' directory." -ForegroundColor Green
