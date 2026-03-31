"""
Stream Health Monitoring Service
Monitors RTSP streams and attempts recovery if disconnected
"""
import os
import asyncio
import requests
import json
from datetime import datetime
from ome_service import register_stream

OME_API = os.environ.get("OME_API", "http://ome:8081") + "/v1/vhosts/default/apps/app/streams"


OME_AUTH = "Basic bXl2bXNhY2Nlc3N0b2tlbg=="

HEALTH_CHECK_INTERVAL = 30  # Check every 30 seconds


async def get_stream_status(stream_name: str) -> dict:
    """
    Get stream status from OME API
    Returns: {'exists': bool, 'connected': bool, 'bytesIn': int, 'bytesOut': int}
    """
    try:
        headers = {"Authorization": OME_AUTH}
        url = f"{OME_API}/{stream_name}"
        res = requests.get(url, headers=headers, timeout=5)
        
        if res.status_code == 200:
            data = res.json()
            return {
                'exists': True,
                'connected': data.get('state') == 'connected',
                'bytesIn': data.get('bytesIn', 0),
                'bytesOut': data.get('bytesOut', 0),
            }
        else:
            return {'exists': False, 'connected': False, 'bytesIn': 0, 'bytesOut': 0}
    except Exception as e:
        print(f"[HEALTH] Error checking stream {stream_name}: {e}")
        return {'exists': False, 'connected': False, 'bytesIn': 0, 'bytesOut': 0}


async def check_stream_health(devices: list, cameras_col) -> list:
    """
    Monitor all registered streams and detect failures
    Returns: list of failed streams that need recovery
    """
    failed_streams = []
    
    for device in devices:
        stream_name = device.get('ome_stream')
        rtsp_url = device.get('rtsp_url')
        
        if not stream_name or not rtsp_url:
            continue
        
        status = await get_stream_status(stream_name)
        
        # Track in database
        try:
            cameras_col.update_one(
                {"ome_stream": stream_name},
                {
                    "$set": {
                        "last_health_check": datetime.utcnow(),
                        "stream_status": status,
                    }
                }
            )
        except Exception as e:
            print(f"[HEALTH] DB update failed: {e}")
        
        if not status['exists'] or not status['connected']:
            print(f"[HEALTH] ⚠ Stream {stream_name} is DOWN")
            failed_streams.append({
                'stream_name': stream_name,
                'rtsp_url': rtsp_url,
                'status': status
            })
        else:
            print(f"[HEALTH] ✓ {stream_name}: OK ({status['bytesOut']} bytes)")
    
    return failed_streams


async def recover_stream(stream_name: str, rtsp_url: str) -> bool:
    """
    Attempt to recover a failed stream by re-registering it
    """
    try:
        print(f"[HEALTH] 🔄 Attempting recovery for {stream_name}...")
        result = register_stream(stream_name, rtsp_url)
        
        if 'id' in result or result.get('statusCode') == 200:
            print(f"[HEALTH] ✓ Stream {stream_name} recovered successfully")
            return True
        else:
            print(f"[HEALTH] ✗ Stream {stream_name} recovery failed: {result}")
            return False
    except Exception as e:
        print(f"[HEALTH] ✗ Error recovering {stream_name}: {e}")
        return False


async def start_health_monitoring(devices: list, cameras_col):
    """
    Continuous health monitoring loop (runs in background)
    """
    print("[HEALTH] Starting stream health monitoring...")
    
    while True:
        try:
            await asyncio.sleep(HEALTH_CHECK_INTERVAL)
            
            # Check all streams
            failed = await check_stream_health(devices, cameras_col)
            
            # Attempt recovery on failed streams
            for failed_stream in failed:
                recovered = await recover_stream(
                    failed_stream['stream_name'],
                    failed_stream['rtsp_url']
                )
                if recovered:
                    print(f"[HEALTH] Stream {failed_stream['stream_name']} recovered")
        
        except Exception as e:
            print(f"[HEALTH] Monitoring loop error: {e}")
            await asyncio.sleep(5)  # Brief pause before retry
