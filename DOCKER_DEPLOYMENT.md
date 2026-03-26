# Mirador VMS — Docker Deployment Guide (Company PC)

## Prerequisites
- Docker Desktop installed & running
- Project cloned to the PC

## 1. Full Stack (All Services via Docker)
```powershell
cd d:\Kiru\VMS\Mirador_VMS_UI
docker-compose up -d
```
This starts: **MongoDB** (port 27017), **OvenMediaEngine** (ports 1935, 3333, 8080, 8081), **Backend** (port 8000).

## 2. Frontend Separately (for live-reload dev)
```powershell
cd d:\Kiru\VMS\Mirador_VMS_UI\miradorai-vms
npm run dev
```
Frontend at: `http://localhost:5173`

## 3. Backend Separately (without Docker backend container)
If you want hot-reload on backend code, run only DB + OME in Docker:
```powershell
# Start only MongoDB + OME
docker-compose up -d mongo ome

# Run backend locally
cd d:\Kiru\VMS\Mirador_VMS_UI\onvif-backend
.\venv\Scripts\activate
$env:MONGO_URI='mongodb://localhost:27017/'
$env:OME_API='http://localhost:8081'
$env:OME_URL='http://localhost:8081/v1/vhosts/default/apps/app/streams'
$env:OME_HOST_IP='<YOUR_COMPANY_PC_IP>'
$env:OME_WS_PORT='3333'
$env:RECORDINGS_DIR='C:/recordings'
$env:VIDEO_KEY_FILE='C:/recordings/video.key'
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

> **Note:** Replace `<YOUR_COMPANY_PC_IP>` with the actual LAN IP (e.g., `192.168.1.100`).
> If the venv is broken, recreate it:
> ```powershell
> Remove-Item -Recurse -Force .\venv
> python -m venv venv
> .\venv\Scripts\activate
> pip install -r requirements.txt
> ```

## 4. Stop Everything
```powershell
docker-compose down
```

## 5. Useful Commands
| Action | Command |
|--------|---------|
| View logs | `docker-compose logs -f backend` |
| Health check | `curl http://localhost:8000/health` |
| OME streams | `curl -H "Authorization: Basic bXl2bXNhY2Nlc3N0b2tlbg==" http://localhost:8081/v1/vhosts/default/apps/app/streams` |
| Rebuild backend | `docker-compose build backend && docker-compose up -d backend` |
