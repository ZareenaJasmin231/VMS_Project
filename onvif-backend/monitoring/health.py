from pymongo import MongoClient
import os
from datetime import datetime
import threading
import asyncio
import psutil
from .websocket_manager import manager

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
client = MongoClient(MONGO_URI)
db = client["mirador-vms"]
nodes_col = db["infrastructure_nodes"]
alerts_col = db["infrastructure_alerts"]


def _broadcast_safe(payload: dict):
    loop = manager.loop if hasattr(manager, 'loop') and manager.loop else None
    if not loop:
        try:
            loop = asyncio.get_event_loop()
        except Exception:
            pass
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(manager.broadcast(payload), loop)


def _get_uptime_info():
    try:
        boot_ts = psutil.boot_time()
        bt = datetime.fromtimestamp(boot_ts)
        delta = datetime.now() - bt
        days = delta.days
        hours, rem = divmod(delta.seconds, 3600)
        minutes, _ = divmod(rem, 60)
        return f"{days}d {hours}h {minutes}m", bt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return "N/A", "N/A"


def update_node_status(node_id, status, latency=None):
    node = nodes_col.find_one({"id": node_id})
    previous_status = node.get("status") if node else None

    update_data = {"status": status, "last_seen": datetime.utcnow()}
    if latency is not None:
        update_data["latency"] = latency

    nodes_col.update_one({"id": node_id}, {"$set": update_data})

    # Fire alert on transition to offline
    if previous_status and previous_status != status and status == "offline":
        alert = {
            "node_id": node_id,
            "ip": node.get("ip", ""),
            "model": node.get("model", ""),
            "type": node.get("type", ""),
            "event": "device_offline",
            "message": f"{node.get('model') or node.get('ip')} went OFFLINE",
            "timestamp": datetime.utcnow(),
            "acknowledged": False
        }
        alerts_col.insert_one(alert)
        try:
            _broadcast_safe({
                "type": "ALERT",
                "data": {**alert, "timestamp": alert["timestamp"].isoformat()}
            })
        except Exception as e:
            print(f"[HEALTH] Alert broadcast error: {e}")

    try:
        _broadcast_safe({
            "type": "NODE_UPDATE",
            "id": node_id,
            "data": {**update_data, "last_seen": update_data["last_seen"].isoformat()}
        })
    except Exception as e:
        print(f"[HEALTH] Broadcast error: {e}")


def check_all_nodes():
    from .scanner import scanner
    nodes = list(nodes_col.find({}))

    def worker(node):
        ip = node.get("ip")
        if not ip:
            return
        latency = scanner.ping_device(ip)
        if latency >= 0:
            status = "online"
        else:
            is_reachable = any(
                scanner.probe_port(ip, port)
                for port in [80, 554, 8080, 8000, 8081, 8899]
            )
            status = "online" if is_reachable else "offline"
            latency = 1 if is_reachable else None
        update_node_status(node["id"], status, latency)

    threads = [threading.Thread(target=worker, args=(n,)) for n in nodes]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)


def save_discovered_nodes(discovered_list):
    for dev in discovered_list:
        node_id = f"node-{dev['ip'].replace('.', '-')}"
        existing = nodes_col.find_one({"id": node_id})
        node_data = {
            "id": node_id, "ip": dev["ip"], "type": dev["type"],
            "manufacturer": dev.get("manufacturer", ""), "model": dev.get("model", ""),
            "status": "online", "latency": dev.get("latency"),
            "last_seen": dev.get("last_seen", datetime.utcnow()), "inferred": False
        }
        if not existing:
            node_data["position"] = {"x": 100, "y": 100}
            nodes_col.insert_one(node_data)
            print(f"[HEALTH] Added new node: {node_id} ({dev['ip']})")
        else:
            nodes_col.update_one({"id": node_id}, {"$set": node_data})

    try:
        _broadcast_safe({"type": "TOPOLOGY_UPDATE", "count": len(discovered_list)})
    except Exception as e:
        print(f"[HEALTH] Topology broadcast error: {e}")


def seed_topology_from_cameras():
    """
    ✅ FIX: VMS dedup now strictly by model='VMS Host' — prevents duplicates on IP change.
    ✅ NEW: Persists uptime + last_reboot to VMS node for frontend display.
    """
    from .scanner import scanner
    cams_col = db["cameras"]
    cameras = list(cams_col.find({}))

    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = "127.0.0.1"

    uptime_str, last_reboot = _get_uptime_info()

    # ✅ KEY FIX: Dedup by model only, not IP
    existing_host = nodes_col.find_one({"model": "VMS Host"})
    if not existing_host:
        vms_node = {
            "ip": local_ip, "type": "server", "manufacturer": "Mirador",
            "model": "VMS Host", "latency": 0,
            "uptime": uptime_str, "last_reboot": last_reboot,
            "last_seen": datetime.utcnow()
        }
        save_discovered_nodes([vms_node])
    else:
        nodes_col.update_one(
            {"model": "VMS Host"},
            {"$set": {"uptime": uptime_str, "last_reboot": last_reboot, "ip": local_ip}}
        )

    discovered = []
    for cam in cameras:
        ip = cam.get("ip")
        if not ip:
            continue
        latency = scanner.ping_device(ip)
        if latency < 0:
            is_reachable = any(
                scanner.probe_port(ip, p) for p in [80, 554, 8080, 8000, 8081, 8899]
            )
            latency = 1 if is_reachable else None
        discovered.append({
            "ip": ip, "type": "camera",
            "manufacturer": cam.get("manufacturer", ""),
            "model": cam.get("model", ""),
            "latency": latency, "last_seen": datetime.utcnow()
        })

    save_discovered_nodes(discovered)
    print(f"[HEALTH] Seeded topology with {len(discovered)} cameras and VMS host.")