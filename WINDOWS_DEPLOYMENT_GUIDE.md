# Mirador VMS Native Windows Deployment Guide

This guide describes how to run all components of the Mirador Video Management System (VMS) natively on Windows as Windows Services, completely removing the dependency on Docker.

---

## 📋 Architectural Overview

In the native Windows deployment:
1. **MongoDB Service**: Windows native service running on port `27017`.
2. **Mosquitto MQTT Service**: Windows native service running on port `1883`.
3. **MinIO Cloud Storage Service**: Windows native service (registered via NSSM) on port `9000` (Console on `9001`).
4. **VMS Backend Service**: Windows native service (registered via NSSM) executing the Uvicorn/FastAPI server.
5. **OvenMediaEngine (OME)**: Remains in Docker or run natively (OvenMediaEngine runs best in Docker on Windows due to complex media routing requirements, but all recording, processing, databases, and UI run natively on the Windows host).

---

## 🛠️ Step 1: Install Prerequisites

### 1. Python 3.10+
- Download and install [Python 3.10 or 3.11](https://www.python.org/downloads/windows/).
- **CRITICAL**: Check the box to **"Add Python to PATH"** during installation.

### 2. FFmpeg & FFprobe
- Download the Windows builds from [Gyan.dev](https://www.gyan.dev/ffmpeg/builds/).
- Extract to a folder (e.g., `C:\ffmpeg`).
- Add `C:\ffmpeg\bin` to your system's Environment Variables **PATH**.
- Verify in cmd/PowerShell:
  ```cmd
  ffmpeg -version
  ffprobe -version
  ```

---

## 🍃 Step 2: Install MongoDB Community Server

1. Download the MongoDB MSI installer from the [MongoDB Download Center](https://www.mongodb.com/try/download/community).
2. Run the installer and select **Complete** setup.
3. Keep the checkbox checked for **"Install MongoDB as a Service"** (select "Run service as Network Service user").
4. Finish installation. MongoDB is now running natively as a Windows Service!
5. Verify it is running by checking Services (`services.msc`) or opening MongoDB Compass and connecting to `mongodb://localhost:27017/`.

---

## 🦟 Step 3: Install Mosquitto MQTT Broker

1. Download the Mosquitto installer from the [Mosquitto Downloads page](https://mosquitto.org/download/).
2. Run the installer. It will automatically register the `Mosquitto Broker` service.
3. Open Windows Services (`services.msc`), locate **Mosquitto Broker**, and ensure the startup type is set to **Automatic** and the service is started.
4. Verify port `1883` is open by running:
  ```cmd
  netstat -ano | findstr 1883
  ```

---

## ☁️ Step 4: Install MinIO Object Storage

1. Create a directory for MinIO binaries and data:
   - Binary Folder: `C:\MinIO\bin`
   - Data Folder: `D:\MinIO_Data` (or any drive volume with sufficient space)
2. Download the native Windows binary [minio.exe](https://dl.min.io/server/minio/release/windows-amd64/minio.exe) and save it to `C:\MinIO\bin\minio.exe`.
3. We will register MinIO as a Windows Service using the NSSM executable downloaded by our backend script.
4. Run PowerShell as **Administrator** and execute:
   ```powershell
   # Go to your VMS Project directory
   cd "C:\Users\miradorwin\Documents\GitHub\VMS_Project"

   # Register MinIO Service
   .\bin\nssm.exe install MinIO "C:\MinIO\bin\minio.exe" "server D:\MinIO_Data --console-address :9001"
   .\bin\nssm.exe set MinIO AppDirectory "C:\MinIO\bin"
   .\bin\nssm.exe set MinIO Description "MinIO Cloud Storage Engine"
   .\bin\nssm.exe set MinIO Start SERVICE_AUTO_START

   # Set MinIO Credentials (matching VMS .env keys)
   .\bin\nssm.exe set MinIO AppEnvironmentExtra "MINIO_ROOT_USER=admin`nMINIO_ROOT_PASSWORD=admin123"

   # Start the service
   .\bin\nssm.exe start MinIO
   ```
5. Open your web browser and go to `http://localhost:9001`. Log in using `admin` / `admin123`.
6. Create a bucket named `vms-recordings` (matching the `MINIO_BUCKET` in `.env`).

---

## ⚙️ Step 5: Install & Configure VMS Backend Services

1. Open your project directory: `C:\Users\miradorwin\Documents\GitHub\VMS_Project`.
2. Edit the `.env` file in the root directory to match the local services:
   ```ini
   MONGO_PORT=27017
   MQTT_PORT=1883
   BACKEND_PORT=80
   MINIO_ENDPOINT=127.0.0.1:9000
   MINIO_PORT=9000
   MINIO_ACCESS_KEY=admin
   MINIO_SECRET_KEY=admin123
   MINIO_BUCKET=vms-recordings
   RECORDINGS_DIR=E:/REC
   ```
3. Run the multi-services setup script. Open PowerShell as **Administrator** and run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File "setup_nssm_services.ps1"
   ```
4. The script will automatically:
   - Download `nssm.exe` to the `bin/` directory if missing.
   - Detect your python virtual environment (`onvif-backend/venv/`).
   - Create a `logs/` directory in the project root.
   - Load config values from `.env` and set them as environment variables for the services.
   - Register and start the three VMS services:
     - `mirador-recorder` (runs recorder worker loop)
     - `mirador-scheduler` (runs automated tasks/schedulers)
     - `mirador-api` (runs FastAPI server)

---

## 💻 Step 6: Run Frontend UI

1. Open a terminal (CMD or PowerShell).
2. Go to the frontend folder:
   ```cmd
   cd C:\Users\miradorwin\Documents\GitHub\VMS_Project\miradorai-vms
   ```
3. Install dependencies and start the development server:
   ```cmd
   npm install
   npm run dev
   ```
4. Access the Mirador UI in your web browser at `http://localhost:5173`. Go to the **Playback** page to verify local playback fallback and camera recordings!

---

## 🩺 Diagnostic & Management Commands

### 1. Check Service Status
```powershell
# Check if running
Get-Service -Name mirador-api, mirador-scheduler, mirador-recorder

# View service parameters in NSSM UI (e.g. for API)
.\bin\nssm.exe edit mirador-api
```

### 2. Batch Scripts
You can start or stop all VMS-related service stack components at once using the batch files at the root of the project:
```cmd
# Start all VMS services
start_all_services.bat

# Stop VMS app services
stop_all_services.bat
```

### 3. Read Service Console Output (Stderr/Stdout)
Stdout and Stderr logs are redirected to the `logs/` directory in the root of the VMS project:
- `logs/mirador-api.log` / `logs/mirador-api-err.log`
- `logs/mirador-scheduler.log` / `logs/mirador-scheduler-err.log`
- `logs/mirador-recorder.log` / `logs/mirador-recorder-err.log`

To run interactive troubleshooting (stop services first):
```powershell
Stop-Service -Name mirador-api
cd onvif-backend
.\venv\Scripts\python.exe run_api.py
```
