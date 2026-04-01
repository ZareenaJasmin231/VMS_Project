"""
ONVIF Device Discovery Service
Auto-detects network subnet and finds real ONVIF cameras.

Changes from original:
  - Fallback generic entries now go through multi-protocol fingerprinting
    (HTTP banner grab + MAC OUI lookup + SNMP sysDescr) to classify
    device_type as "camera" | "router" | "switch" | "printer" |
    "server" | "iot" | "unknown"
  - Only devices with device_type == "camera" OR device_type == "unknown"
    (couldn't be identified as non-camera) are returned to the frontend
  - No behaviour change for devices that respond successfully to ONVIF probe
"""

import socket
import re
import subprocess
import ipaddress
import os
import struct
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading


# ── MAC OUI vendor → device-type mapping ─────────────────────────────────────
# Extend as needed. Keys are the first 8 chars of MAC (XX:XX:XX).
_OUI_MAP: dict[str, str] = {
    # Cameras
    "00:1a:8c": "camera",   # Hikvision
    "8c:e7:48": "camera",   # Hikvision
    "bc:ad:28": "camera",   # Hikvision
    "28:57:be": "camera",   # Dahua
    "e0:50:8b": "camera",   # Dahua
    "00:12:17": "camera",   # Axis
    "ac:cc:8e": "camera",   # Axis
    "00:02:d1": "camera",   # Bosch Security
    "00:1b:c5": "camera",   # Bosch Security
    "b4:a2:eb": "switch",   # Cisco
    "00:00:0c": "router",   # Cisco
    "00:1e:13": "router",   # Cisco
    "00:50:56": "server",   # VMware (virtual)
    "00:0c:29": "server",   # VMware (virtual)
    "00:1a:4b": "printer",  # HP
    "a0:d3:c1": "printer",  # HP
    "18:a9:05": "printer",  # HP
    "b8:27:eb": "iot",      # Raspberry Pi
    "dc:a6:32": "iot",      # Raspberry Pi
    "00:17:88": "iot",      # Philips Hue
}

# HTTP banner keywords → device-type
_HTTP_KEYWORDS: dict[str, str] = {
    # Cameras (checked first — most specific)
    "hikvision":         "camera",
    "dahua":             "camera",
    "axis":              "camera",
    "bosch":             "camera",
    "hanwha":            "camera",
    "uniview":           "camera",
    "reolink":           "camera",
    "amcrest":           "camera",
    "foscam":            "camera",
    "vivotek":           "camera",
    "pelco":             "camera",
    "onvif":             "camera",
    "network camera":    "camera",
    "ip camera":         "camera",
    "ipcam":             "camera",
    "webcam":            "camera",
    "nvr":               "camera",
    "dvr":               "camera",
    # Network gear
    "cisco":             "switch",
    "juniper":           "switch",
    "ubiquiti":          "switch",
    "unifi":             "switch",
    "netgear":           "switch",
    "d-link":            "switch",
    "tp-link":           "switch",
    "zyxel":             "router",
    "mikrotik":          "router",
    "openwrt":           "router",
    "dd-wrt":            "router",
    "pfsense":           "router",
    "fortinet":          "router",
    "fortigate":         "router",
    "router":            "router",
    # Printers
    "printer":           "printer",
    "print server":      "printer",
    "hewlett-packard":   "printer",
    "lexmark":           "printer",
    "brother":           "printer",
    "canon printer":     "printer",
    "epson":             "printer",
    "xerox":             "printer",
    # Servers / NAS
    "proxmox":           "server",
    "esxi":              "server",
    "synology":          "server",
    "qnap":              "server",
    "truenas":           "server",
    "nas":               "server",
    "windows server":    "server",
    # IoT
    "esp8266":           "iot",
    "esp32":             "iot",
    "tasmota":           "iot",
    "home assistant":    "iot",
    "shelly":            "iot",
}

# SNMP sysDescr keywords → device-type
_SNMP_KEYWORDS: dict[str, str] = {
    "camera":      "camera",
    "onvif":       "camera",
    "hikvision":   "camera",
    "dahua":       "camera",
    "cisco":       "switch",
    "catalyst":    "switch",
    "juniper":     "switch",
    "ubiquiti":    "switch",
    "routeros":    "router",
    "openwrt":     "router",
    "linux":       "server",   # generic Linux — could be anything
    "windows":     "server",
    "printer":     "printer",
    "jetdirect":   "printer",
}


# ─────────────────────────────────────────────────────────────────────────────
# Subnet detection (unchanged from original)
# ─────────────────────────────────────────────────────────────────────────────

def get_local_subnet() -> str:
    env_subnet = os.environ.get("HOST_SUBNET", "").strip()
    if env_subnet:
        print(f"[DISCOVERY] Using HOST_SUBNET env var: {env_subnet}")
        return env_subnet

    try:
        import platform
        if platform.system() == "Windows":
            result = subprocess.run(
                ["ipconfig"], capture_output=True, text=True, timeout=3
            )
            for line in result.stdout.split('\n'):
                if "IPv4 Address" in line:
                    ip = re.search(r'(\d+\.\d+\.\d+\.\d+)', line)
                    if ip:
                        local_ip = ip.group(1)
                        if not local_ip.startswith(('127.', '172.17.', '172.18.', '169.254.')):
                            subnet = '.'.join(local_ip.split('.')[:3])
                            print(f"[DISCOVERY] Detected subnet from ipconfig: {subnet}.x")
                            return subnet
    except Exception as e:
        print(f"[DISCOVERY] ipconfig failed: {e}")

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
        if not local_ip.startswith(('127.', '172.17.', '172.18.')):
            subnet = '.'.join(local_ip.split('.')[:3])
            print(f"[DISCOVERY] Detected subnet from socket: {subnet}.x")
            return subnet
    except Exception as e:
        print(f"[DISCOVERY] socket subnet detection failed: {e}")

    print("[DISCOVERY] Could not auto-detect subnet, falling back to 192.168.1")
    return "192.168.1"


# ─────────────────────────────────────────────────────────────────────────────
# Fingerprinting helpers
# ─────────────────────────────────────────────────────────────────────────────

def _oui_lookup(mac: str) -> str | None:
    """Return device_type from MAC OUI table, or None if not found."""
    if not mac or mac in ("Unknown", "—", ""):
        return None
    normalized = mac.lower().replace("-", ":").strip()
    prefix = normalized[:8]  # "xx:xx:xx"
    return _OUI_MAP.get(prefix)


def _http_banner_grab(ip: str, port: int, timeout: float = 2.0) -> str:
    """
    Send a minimal HTTP GET and return the raw response text (headers + partial body).
    Falls back to empty string on any error.
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect((ip, port))
            s.sendall(b"GET / HTTP/1.0\r\nHost: " + ip.encode() + b"\r\nConnection: close\r\n\r\n")
            chunks = []
            while True:
                chunk = s.recv(2048)
                if not chunk:
                    break
                chunks.append(chunk)
                if sum(len(c) for c in chunks) > 8192:
                    break
            return b"".join(chunks).decode("utf-8", errors="ignore").lower()
    except Exception:
        return ""


def _snmp_get_sysdescr(ip: str, community: str = "public", timeout: float = 1.5) -> str:
    """
    Send a raw SNMP v1 GetRequest for sysDescr (OID 1.3.6.1.2.1.1.1.0).
    Returns the sysDescr string or empty string on failure.
    No third-party library required — pure socket.
    """
    try:
        # Build minimal SNMPv1 GetRequest for sysDescr
        def _encode_oid(oid_str):
            parts = list(map(int, oid_str.split(".")))
            encoded = bytes([40 * parts[0] + parts[1]])
            for p in parts[2:]:
                if p == 0:
                    encoded += b'\x00'
                else:
                    segs = []
                    while p:
                        segs.append(p & 0x7f)
                        p >>= 7
                    segs.reverse()
                    for i, s in enumerate(segs):
                        encoded += bytes([s | (0x80 if i < len(segs) - 1 else 0)])
            return encoded

        def _tlv(tag, value):
            if len(value) < 128:
                return bytes([tag, len(value)]) + value
            elif len(value) < 256:
                return bytes([tag, 0x81, len(value)]) + value
            else:
                return bytes([tag, 0x82, len(value) >> 8, len(value) & 0xff]) + value

        comm  = community.encode()
        oid   = _encode_oid("1.3.6.1.2.1.1.1.0")
        varbind  = _tlv(0x30, _tlv(0x06, oid) + _tlv(0x05, b""))  # OID + Null
        varbinds = _tlv(0x30, varbind)
        pdu      = _tlv(0xa0, b'\x02\x01\x01' + b'\x02\x01\x00' + b'\x02\x01\x00' + varbinds)
        packet   = _tlv(0x30,
                        b'\x02\x01\x00' +          # version = 0 (SNMPv1)
                        _tlv(0x04, comm) +          # community
                        pdu)

        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(timeout)
            s.sendto(packet, (ip, 161))
            data, _ = s.recvfrom(4096)

        # Very simple: find OctetString (0x04) value after the OID in the response
        raw = data.decode("latin-1", errors="ignore")
        # Look for printable ASCII string after the response OID
        match = re.search(r'\x04([\x01-\x7f])([\x20-\x7e]{4,})', data.decode("latin-1", errors="ignore"))
        if match:
            length = ord(match.group(1))
            return match.group(2)[:length].strip()
        return ""
    except Exception:
        return ""


def _classify_device(ip: str, port: int, mac: str = "") -> tuple[str, str, str]:
    """
    Multi-protocol fingerprint a device.
    Returns (device_type, manufacturer, model).
    Order: OUI → SNMP → HTTP banner
    """
    # 1. MAC OUI (fastest, no network round-trip beyond what we already have)
    oui_type = _oui_lookup(mac)
    if oui_type and oui_type != "server":  # server from OUI is too generic
        print(f"[CLASSIFY] {ip} → {oui_type} (OUI)")
        return oui_type, "", ""

    # 2. SNMP sysDescr (network gear almost always responds to this)
    sysdescr = _snmp_get_sysdescr(ip)
    if sysdescr:
        sysdescr_lower = sysdescr.lower()
        for kw, dtype in _SNMP_KEYWORDS.items():
            if kw in sysdescr_lower:
                # Extract first useful word as manufacturer hint
                manufacturer = sysdescr.split()[0] if sysdescr.split() else ""
                print(f"[CLASSIFY] {ip} → {dtype} (SNMP: '{sysdescr[:60]}')")
                return dtype, manufacturer, ""

    # 3. HTTP banner grab
    banner = _http_banner_grab(ip, port)
    if banner:
        for kw, dtype in _HTTP_KEYWORDS.items():
            if kw in banner:
                # Try to pull a model hint from Server: header
                server_match = re.search(r'server:\s*([^\r\n]+)', banner)
                model_hint   = server_match.group(1).strip()[:40] if server_match else ""
                print(f"[CLASSIFY] {ip} → {dtype} (HTTP banner, kw='{kw}')")
                return dtype, "", model_hint

    print(f"[CLASSIFY] {ip} → unknown (no fingerprint matched)")
    return "unknown", "", ""


# ─────────────────────────────────────────────────────────────────────────────
# ONVIF probe (unchanged logic, same return shape)
# ─────────────────────────────────────────────────────────────────────────────

def probe_onvif_device(ip: str, port: int = 80, username: str = "", password: str = "") -> dict | None:
    try:
        from onvif_service import probe_camera
        result = probe_camera(ip, port, username, password)

        if result.get("success"):
            rtsp_url = result.get('stream_uri', '')
            rtsp_url = re.sub(r"[&?]proto=Onvif", "", rtsp_url)

            device_info = {
                'id':           f"device-{ip}",
                'ip':           ip,
                'mac':          result.get('serial', 'Unknown'),
                'status':       'online',
                'manufacturer': result.get('manufacturer', 'Unknown'),
                'model':        result.get('model', 'Unknown'),
                'firmware':     result.get('firmware', ''),
                'rtsp_url':     rtsp_url,
                'stream_uri':   rtsp_url,
                'device_type':  'camera',   # ✅ ONVIF success = definitely a camera
                'discovered_at': datetime.utcnow().isoformat(),
            }
            print(f"[DISCOVERY] ✓ ONVIF {ip}: {result.get('manufacturer')} {result.get('model')}")
            return device_info
    except Exception as e:
        print(f"[DISCOVERY] ONVIF probe failed for {ip}: {e}")
    return None


def _check_port(ip: str, port: int, timeout_ms: int = 150) -> tuple[str, int] | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout_ms / 1000.0)
            if sock.connect_ex((ip, port)) == 0:
                return (ip, port)
    except Exception:
        pass
    return None


# ─────────────────────────────────────────────────────────────────────────────
# WS-Discovery (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

def discover_onvif_devices(timeout: int = 5) -> list:
    discovered_devices = {}

    try:
        probe_message = b"""<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
  <s:Header>
    <a:Action s:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>
    <a:MessageID>urn:uuid:0d52d05f-bfd6-4e77-b8a8-5f22c39f7fcf</a:MessageID>
    <a:ReplyTo>
      <a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address>
    </a:ReplyTo>
    <a:To s:mustUnderstand="1">dn:///</a:To>
  </s:Header>
  <s:Body>
    <d:Probe>
      <d:Types>tdn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </s:Body>
</s:Envelope>"""

        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.settimeout(timeout)

        MCAST_GRP  = '239.255.255.250'
        MCAST_PORT = 3702

        print(f"[DISCOVERY] WS-Discovery probe (timeout={timeout}s)...")
        sock.sendto(probe_message, (MCAST_GRP, MCAST_PORT))

        probe_futures  = {}
        probe_executor = ThreadPoolExecutor(max_workers=20)

        try:
            while True:
                data, addr = sock.recvfrom(4096)
                xml_data   = data.decode('utf-8', errors='ignore')
                ip         = addr[0]

                if ip.startswith('127.') or ip.startswith('255.'):
                    continue

                endpoint_match = re.search(r'<a:Address>(http[^<]+)</a:Address>', xml_data)
                if endpoint_match:
                    device_id = f"device-{ip}"
                    if device_id not in discovered_devices and ip not in probe_futures:
                        print(f"[DISCOVERY] WS-Discovery response from {ip}, queuing probe...")
                        probe_futures[ip] = probe_executor.submit(probe_onvif_device, ip)

        except socket.timeout:
            pass
        finally:
            sock.close()

        for ip, future in probe_futures.items():
            try:
                device_info = future.result(timeout=10)
                if device_info:
                    discovered_devices[f"device-{ip}"] = device_info
            except Exception as e:
                print(f"[DISCOVERY] WS probe result error for {ip}: {e}")

        probe_executor.shutdown(wait=False)

    except Exception as e:
        print(f"[DISCOVERY] WS-Discovery error: {e}")

    return list(discovered_devices.values())


# ─────────────────────────────────────────────────────────────────────────────
# Subnet scan — now with fingerprinting instead of blind fallback
# ─────────────────────────────────────────────────────────────────────────────

def discover_onvif_devices_simple(
    timeout_ms: int = 150,
    username:   str = "",
    password:   str = "",
    max_workers: int = 50,
) -> list:
    discovered_devices: dict[str, dict] = {}
    lock = threading.Lock()

    subnet = get_local_subnet()
    ports  = [80, 8080, 8081, 8888, 554]

    print(f"[DISCOVERY] Scanning {subnet}.1-254 on ports {ports} "
          f"(timeout={timeout_ms}ms, workers={max_workers})...")

    # ── Phase 1: parallel port scan ──────────────────────────────────
    scan_targets = [
        (f"{subnet}.{i}", port)
        for i in range(1, 255)
        for port in ports
    ]

    open_ips: dict[str, int] = {}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_check_port, ip, port, timeout_ms): (ip, port)
            for ip, port in scan_targets
        }
        for future in as_completed(futures):
            result = future.result()
            if result:
                ip, port = result
                with lock:
                    if ip not in open_ips:
                        open_ips[ip] = port
                        print(f"[DISCOVERY] Open port {ip}:{port}")

    print(f"[DISCOVERY] Port scan done — {len(open_ips)} hosts found")

    if not open_ips:
        return []

    # ── Phase 2: ONVIF probe + fingerprint fallback ──────────────────
    def probe_and_classify(ip: str, port: int):
        # First try ONVIF
        device_info = probe_onvif_device(ip, port, username, password)
        if device_info:
            return ip, device_info

        # ONVIF failed — fingerprint to decide if it's even a camera
        device_type, manufacturer, model = _classify_device(ip, port)

        # ✅ KEY CHANGE: only return the device if it looks like a camera
        # or we genuinely couldn't tell (unknown). Discard known non-cameras.
        if device_type not in ("camera", "unknown"):
            print(f"[DISCOVERY] ✗ Skipping {ip} — classified as '{device_type}'")
            return ip, None

        # Build a fallback entry — but with real classification info
        fallback = {
            'id':           f"device-{ip}",
            'ip':           ip,
            'mac':          "Unknown",
            'status':       'online',
            'manufacturer': manufacturer or 'Unknown',
            'model':        model        or f"Port {port}",
            'device_type':  device_type,
            'discovered_at': datetime.utcnow().isoformat(),
        }

        if device_type == "unknown":
            print(f"[DISCOVERY] ? Unclassified device at {ip}:{port} — included for user review")
        else:
            print(f"[DISCOVERY] ✓ Likely camera at {ip}:{port} (fingerprint)")

        return ip, fallback

    with ThreadPoolExecutor(max_workers=min(len(open_ips), 20)) as executor:
        probe_futures = {
            executor.submit(probe_and_classify, ip, port): ip
            for ip, port in open_ips.items()
        }
        for future in as_completed(probe_futures):
            try:
                ip, device_info = future.result(timeout=15)
                if device_info:
                    with lock:
                        discovered_devices[ip] = device_info
            except Exception as e:
                print(f"[DISCOVERY] Probe/classify failed for unknown host: {e}")

    return list(discovered_devices.values())


# ─────────────────────────────────────────────────────────────────────────────
# Entry point (unchanged signature)
# ─────────────────────────────────────────────────────────────────────────────

def discover_all(
    ws_timeout:     int = 4,
    scan_timeout_ms: int = 150,
    username:       str = "",
    password:       str = "",
) -> list:
    """
    Runs WS-Discovery and subnet scan concurrently, merges and deduplicates.
    Non-camera devices (routers, switches, printers, servers) are filtered out.
    Devices that could not be classified are included for user review.
    """
    print("[DISCOVERY] Starting parallel WS-Discovery + subnet scan...")

    with ThreadPoolExecutor(max_workers=2) as executor:
        ws_future     = executor.submit(discover_onvif_devices, ws_timeout)
        subnet_future = executor.submit(
            discover_onvif_devices_simple, scan_timeout_ms, username, password
        )
        ws_results     = ws_future.result()
        subnet_results = subnet_future.result()

    # Merge — WS-Discovery (richer) takes precedence over subnet scan
    merged: dict[str, dict] = {}
    for d in subnet_results:
        merged[d['ip']] = d
    for d in ws_results:
        merged[d['ip']] = d

    result = list(merged.values())
    print(f"[DISCOVERY] Done — {len(result)} device(s) after filtering "
          f"(WS={len(ws_results)}, subnet={len(subnet_results)})")
    return result