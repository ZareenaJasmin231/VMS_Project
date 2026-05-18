import psutil
import time
import asyncio
import os
import platform
import re
from datetime import datetime
from pymongo import MongoClient
from .websocket_manager import manager

# MongoDB Setup
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
client = MongoClient(MONGO_URI)
db = client["mirador-vms"]
diagnostics_col = db["network_diagnostics"]


async def ping_host(host):
    """Returns (avg_latency_ms, packet_loss_pct) or (None, 100) if unreachable."""
    if platform.system().lower() == "windows":
        # -n 5 = send 5 packets, -w 1000 = 1s timeout
        command = ["ping", "-n", "5", "-w", "1000", host]
    else:
        # -c 5 = send 5 packets, -W 1 = 1s timeout
        command = ["ping", "-c", "5", "-W", "1", host]

    start = time.time()
    try:
        proc = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await proc.communicate()
        end = time.time()
        output = stdout.decode("utf-8", errors="ignore")

        if proc.returncode == 0 or (platform.system().lower() == "windows" and "Reply from" in output):
            # Parse packet loss and latency from output
            loss = 0
            latency = round((end - start) * 1000 / 5, 2) # rough estimate if parsing fails

            if platform.system().lower() == "windows":
                loss_match = re.search(r"\((\d+)% loss\)", output)
                lat_match  = re.search(r"Average = (\d+)ms", output)
                if loss_match: loss = int(loss_match.group(1))
                if lat_match:  latency = float(lat_match.group(1))
            else:
                loss_match = re.search(r"(\d+)% packet loss", output)
                lat_match  = re.search(r"avg/max/mdev = (\d+\.\d+)", output)
                if loss_match: loss = int(loss_match.group(1))
                if lat_match:  latency = float(lat_match.group(1))

            return latency, loss
        return None, 100
    except Exception:
        return None, 100


async def check_port(host, port, timeout=1):
    """
    ✅ FIX #1: Properly opens AND closes the connection.
    Previously the writer was never closed, leaking file descriptors.
    """
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=timeout
        )
        writer.close()
        await writer.wait_closed()
        return True
    except Exception:
        return False


async def get_bandwidth():
    """Returns bytes sent/received per second."""
    io1 = psutil.net_io_counters()
    await asyncio.sleep(1)
    io2 = psutil.net_io_counters()

    sent = io2.bytes_sent - io1.bytes_sent
    recv = io2.bytes_recv - io1.bytes_recv

    return {
        "sent_kbps": round((sent * 8) / 1024, 2),
        "recv_kbps": round((recv * 8) / 1024, 2),
        "timestamp": datetime.utcnow()
    }


async def run_diagnostics_loop():
    """Background loop to update network health and broadcast to frontend."""
    print("[DIAGNOSTICS] 🚀 Starting Real-Time Network Health Monitor...")

    while True:
        try:
            cameras = list(db["cameras"].find({}, {"_id": 0, "ip": 1, "name": 1}))

            stats = []
            for cam in cameras:
                ip = cam.get("ip")
                if not ip:
                    continue

                # Run ping + port checks concurrently
                (latency, packet_loss), rtsp, http, onvif = await asyncio.gather(
                    ping_host(ip),
                    check_port(ip, 554),
                    check_port(ip, 80),
                    check_port(ip, 8080, timeout=0.5)
                )

                stats.append({
                    "ip": ip,
                    "name": cam.get("name"),
                    "latency": latency,
                    "packet_loss": packet_loss,
                    "ports": {
                        "rtsp": rtsp,
                        "http": http,
                        "onvif": onvif
                    },
                    "status": "Online" if latency is not None else "Offline"
                })

            # Get server bandwidth
            bandwidth = await get_bandwidth()

            report = {
                "devices": stats,
                "bandwidth": bandwidth,
                "timestamp": datetime.utcnow()
            }

            # Keep only last 100 records
            diagnostics_col.insert_one(report)
            if diagnostics_col.count_documents({}) > 100:
                oldest = diagnostics_col.find_one(sort=[("_id", 1)])
                if oldest:
                    diagnostics_col.delete_one({"_id": oldest["_id"]})

            # ✅ FIX #2: Broadcast diagnostics update to all connected frontends
            try:
                await manager.broadcast({
                    "type": "DIAGNOSTICS_UPDATE",
                    "data": {
                        "devices": stats,
                        "bandwidth": {
                            "sent_kbps": bandwidth["sent_kbps"],
                            "recv_kbps": bandwidth["recv_kbps"],
                            "timestamp": bandwidth["timestamp"].isoformat()
                        }
                    }
                })
            except Exception as e:
                print(f"[DIAGNOSTICS] Broadcast error: {e}")

        except Exception as e:
            print(f"[DIAGNOSTICS ERROR] {e}")

        await asyncio.sleep(5)