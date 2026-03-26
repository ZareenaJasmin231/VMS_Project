# VMS Camera Streaming Troubleshooting & Setup Guide

## ✅ Issues Fixed

Your streaming problems have been comprehensively addressed:

### 1. **WebSocket Connection Failures**
- **Issue**: Hardcoded IP addresses in backend prevented WebSocket connections
- **Fix**: Now uses dynamic environment variables
- **Status**: ✓ Fixed in `main.py`

### 2. **Intermittent Disconnections / Stream Getting Stuck**
- **Issue**: No automatic reconnection when connection drops
- **Fix**: Added exponential backoff reconnection with max 10 attempts
- **Status**: ✓ Fixed in `WebRTCPlayer.jsx`

### 3. **Live Feed Lag & Stuttering**
- **Issue**: Insufficient OME worker threads and short timeout values
- **Fix**: Doubled worker threads and increased timeouts
- **Status**: ✓ Fixed in `VHost.xml`

### 4. **ICE/NAT Connectivity Issues**
- **Issue**: Hardcoded ICE candidate IP prevented connections in different networks
- **Fix**: Changed to wildcard ICE candidate for auto-detection
- **Status**: ✓ Fixed in `Server.xml`

### 5. **No Stream Health Monitoring**
- **Issue**: Dead/disconnected streams weren't detected or recovered
- **Fix**: Added continuous health monitoring with auto-recovery
- **Status**: ✓ Added `stream_health.py` module

---

## 🚀 Setup & Deployment

### Option 1: Local Development (Recommended)

```powershell
# Windows PowerShell
cd d:\Kiru\VMS\Mirador_VMS_UI
docker-compose up
```

This uses `localhost` automatically.

### Option 2: Remote Access / Multi-Machine Setup

**Step 1:** Get your server's IP address

```powershell
# On the machine running Docker
ipconfig
# Find "IPv4 Address" (e.g., 192.168.1.100 or 10.0.0.5)
```

**Step 2:** Set environment variable before running Docker

```powershell
# Windows PowerShell
$env:OME_HOST_IP = "YOUR_ACTUAL_IP"
docker-compose up

# Or on Linux/Mac:
export OME_HOST_IP="YOUR_ACTUAL_IP"
docker-compose up
```

**Step 3:** Verify connectivity

Open browser to: `http://YOUR_ACTUAL_IP:8000/api/cameras` (should return JSON)

---

## 🔧 Advanced Configuration

### Increase Worker Threads (For Many Cameras)

Edit `origin_conf/VHost.xml`:

```xml
<Publishers>
    <AppWorkerCount>8</AppWorkerCount>      <!-- Increase this (1-16) -->
    <StreamWorkerCount>32</StreamWorkerCount>  <!-- Increase this (8-64) -->
```

Then restart: `docker-compose down && docker-compose up`

### Adjust Health Check Interval

Edit `onvif-backend/stream_health.py`:

```python
HEALTH_CHECK_INTERVAL = 15  # Check every 15 seconds (default 30)
```

### Increase Reconnection Attempts

Edit `miradorai-vms/src/components/shared/WebRTCPlayer.jsx`:

```javascript
const MAX_RECONNECT_ATTEMPTS = 20  // default 10
```

---

## 📊 Monitor Stream Health

### Via Backend Logs

```powershell
docker-compose logs -f backend | grep HEALTH
```

Expected output:
```
[HEALTH] ✓ camera_stream: OK (1500000 bytes)
[HEALTH] ⚠ old_camera: DOWN
[HEALTH] 🔄 Attempting recovery for old_camera...
[HEALTH] ✓ Stream old_camera recovered successfully
```

### Via MongoDB

```powershell
# Connect to MongoDB container
docker exec -it mirador-mongo mongosh

# View camera status
use mirador-vms
db.cameras.find({ }, { ip: 1, stream_status: 1, last_health_check: 1 } )
```

---

## 🔍 Diagnostic Checklist

### ✓ Network Issues

```powershell
# 1. Check if OME is reachable
curl http://YOUR_IP:8081/v1/vhosts/default

# 2. Check WebRTC port availability
Test-NetConnection YOUR_IP -Port 3333

# 3. Check ICE UDP ports (10000-10009)
Test-NetConnection YOUR_IP -Port 10000
```

### ✓ Docker Container Health

```powershell
# Check all containers are running
docker ps

# View logs
docker-compose logs -f ome      # OME streaming server
docker-compose logs -f backend  # Python API
docker-compose logs -f mongo    # Database

# Restart a failed container
docker-compose restart backend
```

### ✓ RTSP Source Connection

```powershell
# Test if RTSP stream is accessible
# Replace with your actual camera RTSP URL
rtsp://192.168.1.50:554/live

# Using ffmpeg:
ffmpeg -i "rtsp://192.168.1.50:554/live" -f null -
```

### ✓ WebRTC Connection

From browser DevTools Console:

```javascript
// Check if connection state
fetch('http://YOUR_IP:8000/api/cameras')
  .then(r => r.json())
  .then(d => console.log(d))
```

---

## 🛠️ Common Problems & Solutions

### Problem: "WebSocket connection failed"

**Causes:**
1. Wrong `OME_HOST_IP` set
2. Port 3333 blocked by firewall
3. OME container not running

**Solutions:**
```powershell
# 1. Check environment variable
echo $env:OME_HOST_IP

# 2. Check OME is running
docker ps | grep ome

# 3. Check port is listening
netstat -an | findstr 3333

# 4. Restart OME
docker-compose restart ome
```

### Problem: "Stream stucking" or "Stream freezing"

**Causes:**
1. RTSP source disconnected
2. OME workers exhausted
3. Network congestion between camera and server

**Solutions:**
```powershell
# 1. Check RTSP connectivity
# (test with ffmpeg as shown above)

# 2. Increase workers in VHost.xml
# (see Advanced Configuration section)

# 3. Check OME resource usage
docker stats mirador-ome

# 4. Check backend logs
docker-compose logs backend | tail -50
```

### Problem: "Stream works for 30 seconds then drops"

**This was the timeout issue - now fixed!**

Old timeout was 30s → now 60s in `VHost.xml`

If still happening:
```xml
<WebRTC>
    <Timeout>120000</Timeout>  <!-- Increase to 120 seconds -->
    <MaxWaitingTime>60000</MaxWaitingTime>
</WebRTC>
```

---

## 📈 Performance Tuning

### For High-Bandwidth Streams

```xml
<!-- In origin_conf/VHost.xml -->
<Providers>
    <RTSPPull>
        <MaxFrameSize>209715200</MaxFrameSize>  <!-- 200MB -->
        <BufferSize>52428800</BufferSize>       <!-- 50MB -->
    </RTSPPull>
</Providers>
```

### For Many Concurrent Clients

```xml
<Publishers>
    <AppWorkerCount>16</AppWorkerCount>
    <StreamWorkerCount>64</StreamWorkerCount>
</Publishers>
```

Then increase Docker memory:

```yaml
# docker-compose.yml
services:
  ome:
    mem_limit: 2g  # 2GB (adjust as needed)
```

---

## ✅ Verification Steps

After applying these fixes, verify everything works:

1. **Start containers**
   ```powershell
   $env:OME_HOST_IP = "YOUR_IP"
   docker-compose up -d
   ```

2. **Wait 30 seconds for services to initialize**

3. **Add a camera** via the UI
   - Navigate to "Add Devices"
   - Provide camera RTSP URL
   - Click "Start Streaming"

4. **Check status**
   ```powershell
   docker-compose logs backend | grep -E "ONVIF|HEALTH"
   ```

5. **View stream** in Live View
   - Should show "● LIVE" badge (green)
   - Should NOT show "⚠ WebSocket connection failed"
   - Should stream smoothly without freezing

6. **Test reconnection** (optional)
   - Kill OME container: `docker-compose stop ome`
   - Watch frontend show "⟳ RECONNECTING..."
   - Restart OME: `docker-compose start ome`
   - Stream should auto-recover within 10 seconds

---

## 📝 Files Modified

- ✓ `miradorai-vms/src/components/shared/WebRTCPlayer.jsx` - Frontend reconnection logic
- ✓ `onvif-backend/main.py` - Health monitoring integration
- ✓ `onvif-backend/stream_health.py` - NEW: Health check module
- ✓ `origin_conf/Server.xml` - Wildcard ICE candidates
- ✓ `origin_conf/VHost.xml` - Increased timeouts & workers
- ✓ `docker-compose.yml` - Environment variable handling

---

## 🆘 Still Having Issues?

1. **Check all Docker logs simultaneously**
   ```powershell
   docker-compose logs -f
   ```

2. **Collect diagnostic info**
   ```powershell
   docker-compose ps
   docker exec mirador-backend curl http://ome:8081/v1/vhosts/default
   docker-compose logs --tail=100 > debug.log
   ```

3. **Restart everything fresh**
   ```powershell
   docker-compose down
   docker-compose up -d
   ```

4. **Check MongoDB for stream status**
   ```powershell
   docker exec mirador-mongo mongosh -- mirador-vms --eval "db.cameras.find()"
   ```

---

## 📚 Additional Resources

- OME Documentation: https://github.com/AirenSoft/OvenMediaEngine
- WebRTC Troubleshooting: https://webrtc.org/troubleshooting/
- Docker Logs: `docker-compose logs [service_name]`
