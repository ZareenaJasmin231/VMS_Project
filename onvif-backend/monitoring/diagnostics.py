import psutil
import time
import asyncio
import os
import platform
import re
from datetime import datetime
from app.core.database import mongo_client

MONGO_URI       = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
client          = mongo_client
db              = client["mirador-vms"]
diagnostics_col = db["network_diagnostics"]
nodes_col       = db["infrastructure_nodes"]   # FIX: write live fields back here


async def ping_host(host):
    """Returns (avg_latency_ms, packet_loss_pct) or (None, 100) if unreachable."""
    if platform.system().lower() == "windows":
        command = ["ping", "-n", "5", "-w", "1000", host]
    else:
        command = ["ping", "-c", "5", "-W", "1", host]

    start = time.time()
    try:
        proc = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await proc.communicate()
        end    = time.time()
        output = stdout.decode("utf-8", errors="ignore")

        if proc.returncode == 0 or (
            platform.system().lower() == "windows" and "Reply from" in output
        ):
            loss    = 0
            latency = round((end - start) * 1000 / 5, 2)

            if platform.system().lower() == "windows":
                loss_match = re.search(r"\((\d+)% loss\)", output)
                lat_match  = re.search(r"Average = (\d+)ms", output)
                if loss_match: loss    = int(loss_match.group(1))
                if lat_match:  latency = float(lat_match.group(1))
            else:
                loss_match = re.search(r"(\d+)% packet loss", output)
                lat_match  = re.search(r"min/avg/max/mdev = [\d.]+/([\d.]+)", output)
                if loss_match: loss    = int(loss_match.group(1))
                if lat_match:  latency = float(lat_match.group(1))

            return latency, loss
        return None, 100
    except Exception:
        return None, 100


async def check_port(host, port, timeout=1):
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
    """Background loop: pings every camera, checks ports, writes results to
    infrastructure_nodes so the frontend Details sidebar shows live values."""
    print("[DIAGNOSTICS] Starting Real-Time Network Health Monitor...")

    while True:
        try:
            cameras = list(db["cameras"].find({}, {"_id": 0, "ip": 1, "name": 1}))

            stats = []
            for cam in cameras:
                ip = cam.get("ip")
                if not ip:
                    continue

                (latency, packet_loss), rtsp, http, onvif = await asyncio.gather(
                    ping_host(ip),
                    check_port(ip, 554),
                    check_port(ip, 80),
                    check_port(ip, 8080, timeout=0.5)
                )

                stats.append({
                    "ip":          ip,
                    "name":        cam.get("name"),
                    "latency":     latency,
                    "packet_loss": packet_loss,
                    "ports":       {"rtsp": rtsp, "http": http, "onvif": onvif},
                    "status":      "Online" if latency is not None else "Offline"
                })

            # ── FIX: Write latency, packet_loss, and port flags back to ───
            # infrastructure_nodes so the Details + Network sidebar tabs show
            # live values. Also broadcast NODE_UPDATE for instant UI refresh.
            for stat in stats:
                ip      = stat["ip"]
                node_id = f"node-{ip.replace('.', '-')}"

                # Fields the frontend Details tab reads directly off d.*
                node_fields = {
                    "latency":         stat["latency"],
                    "packet_loss":     stat["packet_loss"],
                    "onvif_connected": stat["ports"]["onvif"],
                    # FIX: also persist rtsp flag — stream_health.py overwrites
                    # this with a richer value, but this gives immediate feedback
                    "rtsp_connected":  stat["ports"]["rtsp"],
                }

                # If RTSP port is open but stream_health hasn't probed yet,
                # set a minimal stream_status so the sidebar doesn't show "—"
                existing = nodes_col.find_one(
                    {"id": node_id},
                    {"stream_status": 1, "_id": 0}
                )
                if existing and not existing.get("stream_status"):
                    node_fields["stream_status"] = (
                        "degraded" if stat["ports"]["rtsp"] else "dead"
                    )

                nodes_col.update_one({"id": node_id}, {"$set": node_fields})



            # ── Persist diagnostics snapshot & broadcast global update ─────
            bandwidth = await get_bandwidth()
            report = {
                "devices":   stats,
                "bandwidth": bandwidth,
                "timestamp": datetime.utcnow()
            }
            diagnostics_col.insert_one(report)
            if diagnostics_col.count_documents({}) > 100:
                oldest = diagnostics_col.find_one(sort=[("_id", 1)])
                if oldest:
                    diagnostics_col.delete_one({"_id": oldest["_id"]})



        except Exception as e:
            print(f"[DIAGNOSTICS ERROR] {e}")

        await asyncio.sleep(5)
