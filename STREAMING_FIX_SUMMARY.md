# 🎬 Camera Streaming - Complete Fix Summary

## What Was Wrong?

Your camera streaming had **5 critical issues**:

| Issue | Root Cause | Impact |
|-------|-----------|---------|
| **WebSocket Connection Failed** | Hardcoded IP addresses (192.168.126.100) | Streams wouldn't connect at all |
| **Intermittent Disconnections** | No reconnection logic | Stream drops every few minutes |
| **Live Feed Stuttering/Lag** | Insufficient OME worker threads | Poor performance with multiple streams |
| **Stream Gets Stuck** | No health monitoring | Dead streams never recovered |
| **ICE Connectivity Issues** | Hardcoded ICE candidate IP | Failed in non-matching networks |

---

## What's Been Fixed? ✅

### 1. Frontend (WebRTCPlayer.jsx)
```javascript
✅ Automatic reconnection with exponential backoff (2s → 30s)
✅ Multiple STUN servers for fast connectivity
✅ WebSocket heartbeat every 10 seconds
✅ Max 10 reconnection attempts
✅ Shows "RECONNECTING..." UI during recovery
```

**Impact**: Stream now automatically recovers from disconnections instead of failing.

---

### 2. Backend (main.py + stream_health.py)
```python
✅ Dynamic IP configuration (no more hardcoded IPs)
✅ Continuous stream health monitoring (every 30s)
✅ Automatic stream recovery when disconnected
✅ MongoDB tracking of stream status
```

**Impact**: Dead streams are automatically detected and restarted.

---

### 3. OME Configuration (Server.xml)
```xml
✅ Changed ICE candidates from hardcoded IP to wildcard (*)
```

**Before:**
```xml
<IceCandidate>192.168.126.100:10000-10009/udp</IceCandidate>
```

**After:**
```xml
<IceCandidate>*:10000-10009/udp</IceCandidate>
```

**Impact**: Works correctly regardless of your actual server IP.

---

### 4. OME Performance (VHost.xml)
```xml
✅ WebRTC Timeout: 30s → 60s (fixes 30s stream drops)
✅ App Workers: 1 → 4 (better concurrency)
✅ Stream Workers: 8 → 16 (handles more streams)
✅ Added RTSP buffer settings (smoother playback)
```

**Impact**: Handles more cameras smoothly without stuttering.

---

## 🚀 How to Deploy

### Quick Start (Local Development)
```powershell
cd d:\Kiru\VMS\Mirador_VMS_UI
docker-compose up
```

### For Network Access (Production)
```powershell
# 1. Find your server IP
ipconfig
# Look for: "IPv4 Address: 192.168.x.x" or "10.0.x.x"

# 2. Set environment variable
$env:OME_HOST_IP = "YOUR_IP_HERE"

# 3. Start Docker
docker-compose up
```

**Example:**
```powershell
$env:OME_HOST_IP = "192.168.1.100"
docker-compose up
```

---

## 📋 What to Check After Restart

```powershell
# 1. Wait for services to start (30-60 seconds)

# 2. Check if backend is healthy
curl http://YOUR_IP:8000/api/cameras

# 3. View logs to confirm health monitoring started
docker-compose logs backend | grep "HEALTH\|Stream health"

# 4. Add a camera and start streaming
# UI: Add Devices → Enter RTSP URL → Start Streaming

# 5. Monitor stream health
docker-compose logs -f backend | grep HEALTH
```

---

## 🎯 Expected Behavior Now

**Before Fix:**
- ❌ "WebSocket connection failed" error
- ❌ Stream works 30 seconds then stops
- ❌ No recovery if camera disconnects
- ❌ Stuttering/lag with multiple streams

**After Fix:**
- ✅ Instant connection
- ✅ Continuous streaming without drops
- ✅ Auto-reconnects in 2-30 seconds if disconnected
- ✅ Smooth multi-stream playback
- ✅ "● LIVE" badge shows when connected

---

## 📊 Monitoring Stream Health

Check if streams are working:

```powershell
# Watch real-time health checks
docker-compose logs -f backend | grep HEALTH

# Output should look like:
# [HEALTH] ✓ camera_stream: OK (500000 bytes)
# [HEALTH] ✓ backyard_cam: OK (750000 bytes)
```

If you see:
```
[HEALTH] ⚠ camera_stream is DOWN
[HEALTH] 🔄 Attempting recovery for camera_stream...
[HEALTH] ✓ Stream camera_stream recovered successfully
```

That means the auto-recovery worked! ✅

---

## 🔍 Diagnostic Commands

If still having issues:

```powershell
# Check if containers are running
docker ps

# Check specific service logs
docker-compose logs ome      # Streaming server
docker-compose logs backend  # API & monitoring
docker-compose logs mongo    # Database

# Test OME API
curl http://YOUR_IP:8081/v1/vhosts/default

# Check if port 3333 is listening
netstat -an | findstr 3333

# View all camera status in database
docker exec mirador-mongo mongosh -- mirador-vms --eval "db.cameras.find()"
```

---

## 📈 Scale Tips

**For Many Cameras (10+):**

Edit `origin_conf/VHost.xml`:
```xml
<AppWorkerCount>8</AppWorkerCount>
<StreamWorkerCount>32</StreamWorkerCount>
```

Then restart:
```powershell
docker-compose down
docker-compose up
```

---

## 📄 Files Changed

```
✓ miradorai-vms/src/components/shared/WebRTCPlayer.jsx
  └─ Added reconnection logic, multiple STUN servers, heartbeat

✓ onvif-backend/main.py
  └─ Added health monitoring initialization

✓ onvif-backend/stream_health.py (NEW)
  └─ Continuous stream health monitoring & auto-recovery

✓ origin_conf/Server.xml
  └─ Changed ICE candidates to wildcard

✓ origin_conf/VHost.xml
  └─ Increased timeouts and worker threads

✓ docker-compose.yml
  └─ Environment variable support
```

---

## ✅ Next Steps

1. **Restart Docker**
   ```powershell
   docker-compose down
   docker-compose up
   ```

2. **Wait 30 seconds for startup**

3. **Check logs**
   ```powershell
   docker-compose logs backend | grep "startup\|HEALTH"
   ```

4. **Add a test camera** and start streaming

5. **Monitor health checks**
   ```powershell
   docker-compose logs -f backend | grep HEALTH
   ```

6. **Test reconnection** (optional)
   - Stop OME: `docker-compose stop ome`
   - Watch UI show "RECONNECTING..."
   - Start OME: `docker-compose start ome`
   - Stream should auto-recover

---

## 🎯 Success Criteria

Your streaming is fixed when you see:

✅ Stream starts connecting within 1-2 seconds  
✅ "● LIVE" badge appears (green)  
✅ No WebSocket error messages  
✅ Stream plays smoothly without stuttering  
✅ If disconnected, auto-reconnects within 30 seconds  
✅ Health monitoring logs show "✓ StreamName: OK"  

---

## 📖 Detailed Guide

For complete troubleshooting and advanced configuration, see:
→ **STREAMING_TROUBLESHOOTING.md**

---

**You're all set! 🚀 Your streaming should now work reliably.**
