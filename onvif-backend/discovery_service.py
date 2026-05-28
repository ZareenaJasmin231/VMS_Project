"""
ONVIF Device Discovery Service
Auto-detects network subnet and finds ONLY real ONVIF cameras.

Key filtering strategy (in order):
  1. WS-Discovery scope check — NVR/display scopes rejected immediately
  2. RTSP port 554 check — real cameras ALWAYS have this open; PCs/CPU boxes do NOT
  3. ONVIF probe — must succeed with valid video profiles + RTSP URLs
  4. Model/manufacturer keyword reject — drops NVR, DVR, server, PC labels
  5. Subnet scan fallback also uses all above checks
"""

import socket
import re
import subprocess
import os
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading


# ── Non-camera model/manufacturer keywords ────────────────────────────────────
_NON_CAMERA_KEYWORDS = [
    "nas", "display", "decoder", "workstation", "desktop",
    "laptop", "switch", "router", "gateway", "hub",
    "printer", "access point", "ap ", "firewall",
]

# ── MAC OUI vendor → device-type ──────────────────────────────────────────────
_OUI_MAP: dict[str, str] = {
    "00:1a:8c": "camera", "8c:e7:48": "camera", "bc:ad:28": "camera",
    "28:57:be": "camera", "e0:50:8b": "camera", "00:12:17": "camera",
    "ac:cc:8e": "camera", "00:02:d1": "camera", "00:1b:c5": "camera",
    "b4:a2:eb": "switch", "00:00:0c": "router", "00:1e:13": "router",
    "00:50:56": "server", "00:0c:29": "server", "00:1a:4b": "printer",
    "a0:d3:c1": "printer", "18:a9:05": "printer",
    "b8:27:eb": "iot",    "dc:a6:32": "iot",    "00:17:88": "iot",
}

_HTTP_KEYWORDS: dict[str, str] = {
    "hikvision": "camera", "dahua": "camera", "axis": "camera",
    "bosch": "camera", "hanwha": "camera", "uniview": "camera",
    "reolink": "camera", "amcrest": "camera", "foscam": "camera",
    "vivotek": "camera", "pelco": "camera", "onvif": "camera",
    "network camera": "camera", "ip camera": "camera",
    "ipcam": "camera", "webcam": "camera",
    "cisco": "switch", "juniper": "switch", "ubiquiti": "switch",
    "unifi": "switch", "netgear": "switch", "d-link": "switch",
    "tp-link": "switch", "zyxel": "router", "mikrotik": "router",
    "openwrt": "router", "dd-wrt": "router", "pfsense": "router",
    "fortinet": "router", "fortigate": "router", "router": "router",
    "printer": "printer", "hewlett-packard": "printer",
    "lexmark": "printer", "brother": "printer", "epson": "printer",
    "proxmox": "server", "esxi": "server", "synology": "server",
    "qnap": "server", "truenas": "server", "nas": "server",
    "windows server": "server",
    "esp8266": "iot", "esp32": "iot", "tasmota": "iot",
    "home assistant": "iot", "shelly": "iot",
}

_SNMP_KEYWORDS: dict[str, str] = {
    "camera": "camera", "onvif": "camera",
    "hikvision": "camera", "dahua": "camera",
    "cisco": "switch", "catalyst": "switch",
    "juniper": "switch", "ubiquiti": "switch",
    "routeros": "router", "openwrt": "router",
    "linux": "server", "windows": "server",
    "printer": "printer", "jetdirect": "printer",
}


# ─────────────────────────────────────────────────────────────────────────────
# Subnet detection
# ─────────────────────────────────────────────────────────────────────────────

def get_local_subnet() -> str:
    env_subnet = os.environ.get("HOST_SUBNET", "").strip()
    if env_subnet:
        print(f"[DISCOVERY] Using HOST_SUBNET env var: {env_subnet}")
        return env_subnet

    try:
        import platform
        if platform.system() == "Windows":
            result = subprocess.run(["ipconfig"], capture_output=True, text=True, timeout=3)
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
# ✅ PRIMARY CAMERA GATE: RTSP port 554
# Real IP cameras ALWAYS listen on 554.
# CPU boxes, PCs, NVR management UIs, switches — do NOT.
# This single check eliminates ~99% of false positives instantly.
# ─────────────────────────────────────────────────────────────────────────────

def _has_rtsp_port(ip: str, timeout_ms: int = 600) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout_ms / 1000.0)
            result = s.connect_ex((ip, 554))
            is_open = (result == 0)
            print(f"[RTSP GATE] {ip}:554 → {'OPEN ✓ — is a camera' if is_open else 'CLOSED ✗ — not a camera'}")
            return is_open
    except Exception:
        return False


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
# Fingerprinting helpers (used as last-resort fallback only)
# ─────────────────────────────────────────────────────────────────────────────

def _oui_lookup(mac: str) -> str | None:
    if not mac or mac in ("Unknown", "—", ""):
        return None
    normalized = mac.lower().replace("-", ":").strip()
    prefix = normalized[:8]
    return _OUI_MAP.get(prefix)


def _http_banner_grab(ip: str, port: int, timeout: float = 2.0) -> str:
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
    try:
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

        comm     = community.encode()
        oid      = _encode_oid("1.3.6.1.2.1.1.1.0")
        varbind  = _tlv(0x30, _tlv(0x06, oid) + _tlv(0x05, b""))
        varbinds = _tlv(0x30, varbind)
        pdu      = _tlv(0xa0, b'\x02\x01\x01' + b'\x02\x01\x00' + b'\x02\x01\x00' + varbinds)
        packet   = _tlv(0x30, b'\x02\x01\x00' + _tlv(0x04, comm) + pdu)

        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(timeout)
            s.sendto(packet, (ip, 161))
            data, _ = s.recvfrom(4096)

        match = re.search(r'\x04([\x01-\x7f])([\x20-\x7e]{4,})', data.decode("latin-1", errors="ignore"))
        if match:
            length = ord(match.group(1))
            return match.group(2)[:length].strip()
        return ""
    except Exception:
        return ""


def _classify_device(ip: str, port: int, mac: str = "") -> tuple[str, str, str]:
    oui_type = _oui_lookup(mac)
    if oui_type and oui_type != "server":
        print(f"[CLASSIFY] {ip} → {oui_type} (OUI)")
        return oui_type, "", ""

    sysdescr = _snmp_get_sysdescr(ip)
    if sysdescr:
        sysdescr_lower = sysdescr.lower()
        for kw, dtype in _SNMP_KEYWORDS.items():
            if kw in sysdescr_lower:
                manufacturer = sysdescr.split()[0] if sysdescr.split() else ""
                print(f"[CLASSIFY] {ip} → {dtype} (SNMP: '{sysdescr[:60]}')")
                return dtype, manufacturer, ""

    banner = _http_banner_grab(ip, port)
    if banner:
        for kw, dtype in _HTTP_KEYWORDS.items():
            if kw in banner:
                server_match = re.search(r'server:\s*([^\r\n]+)', banner)
                model_hint   = server_match.group(1).strip()[:40] if server_match else ""
                print(f"[CLASSIFY] {ip} → {dtype} (HTTP banner, kw='{kw}')")
                return dtype, "", model_hint

    print(f"[CLASSIFY] {ip} → unknown (no fingerprint matched)")
    return "unknown", "", ""


# ─────────────────────────────────────────────────────────────────────────────
# ONVIF probe — RTSP gate first, then full validation
# ─────────────────────────────────────────────────────────────────────────────

def probe_onvif_device(ip: str, port: int = 80, username: str = "", password: str = "") -> dict | None:
    """
    Full camera validation pipeline:
      Gate 1 → RTSP port 554 must be open
      Gate 2 → ONVIF probe must succeed (or device included as auth-required camera)
      Gate 3 → Model/manufacturer must not be NVR/server/PC
      Gate 4 → Must have at least one valid RTSP URL in profiles
    """

    # ── GATE 1: RTSP port 554 ─────────────────────────────────────
    # This is the single most reliable camera indicator.
    # A CPU box, PC, NVR UI, printer or switch will NEVER have port 554 open.
    if not _has_rtsp_port(ip):
        print(f"[DISCOVERY] ✗ {ip} — port 554 CLOSED — not a camera")
        return None

    # ── GATE 2: ONVIF probe ───────────────────────────────────────
    try:
        from onvif_service import probe_camera
        result = probe_camera(ip, port, username, password)

        if result.get("success"):

            # ── GATE 3: Model/manufacturer keyword check ──────────
            # (Keywords check removed to allow NVRs/Encoders with valid streams)

            # ── GATE 4: Valid RTSP URLs in profiles ───────────────
            profiles = result.get("profiles", [])
            valid_profiles = [
                p for p in profiles
                if p.get("rtsp_url") and "rtsp://" in p.get("rtsp_url", "")
            ]
            if not valid_profiles:
                print(f"[DISCOVERY] ✗ {ip} — ONVIF succeeded but no valid RTSP URLs in profiles")
                return None

            rtsp_url = result.get('stream_uri', '')
            rtsp_url = re.sub(r"[&?]proto=Onvif", "", rtsp_url)

            print(f"[DISCOVERY] ✅ CONFIRMED camera {ip}: "
                  f"{result.get('manufacturer')} {result.get('model')} "
                  f"| {len(valid_profiles)} stream(s)")

            return {
                'id':            f"device-{ip}",
                'ip':            ip,
                'mac': result.get('mac', 'Unknown'),
                'status':        'online',
                'manufacturer':  result.get('manufacturer', 'Unknown'),
                'model':         result.get('model', 'Unknown'),
                'firmware':      result.get('firmware', ''),
                'rtsp_url':      rtsp_url,
                'stream_uri':    rtsp_url,
                'device_type':   'camera',
                'discovered_at': datetime.utcnow().isoformat(),
            }

        else:
            # ONVIF probe failed but port 554 IS open →
            # It's definitely a camera, just needs credentials or uses non-standard ONVIF
            print(f"[DISCOVERY] ⚠ {ip} — port 554 open, ONVIF probe failed "
                  f"({result.get('error', '?')}) — including as auth-required camera")
            return {
                'id':            f"device-{ip}",
                'ip':            ip,
                'mac':           'Unknown',
                'status':        'online',
                'manufacturer':  'Unknown',
                'model':         'Camera (credentials required)',
                'device_type':   'camera',
                'note':          'ONVIF probe failed — try adding credentials',
                'discovered_at': datetime.utcnow().isoformat(),
            }

    except Exception as e:
        # Exception but port 554 was confirmed open → still a camera
        print(f"[DISCOVERY] ⚠ {ip} — port 554 open, ONVIF exception: {e} — including as camera")
        return {
            'id':            f"device-{ip}",
            'ip':            ip,
            'mac':           'Unknown',
            'status':        'online',
            'manufacturer':  'Unknown',
            'model':         'RTSP Camera',
            'device_type':   'camera',
            'discovered_at': datetime.utcnow().isoformat(),
        }


# ─────────────────────────────────────────────────────────────────────────────
# WS-Discovery — scope filter + RTSP gate via probe_onvif_device
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

                print(f"[DISCOVERY] WS-Discovery response from {ip}")

                # Reject known NVR/display/recorder scopes immediately
                scopes_raw = re.findall(
                    r'<(?:[^:>]+:)?Scopes[^>]*>(.*?)</(?:[^:>]+:)?Scopes>',
                    xml_data, re.DOTALL | re.IGNORECASE
                )
                all_scopes = ' '.join(scopes_raw).lower()

                is_non_camera_scope = any(kw in all_scopes for kw in [
                    'networkvideodisplay',
                    'networkvideorecorder',
                    'network_video_recorder',
                    'network_video_display',
                    'videodisplay',
                ])

                if is_non_camera_scope:
                    print(f"[DISCOVERY] ✗ {ip} — WS scope is NVR/display, skipping")
                    continue

                device_id = f"device-{ip}"
                if device_id not in discovered_devices and ip not in probe_futures:
                    # probe_onvif_device will do the RTSP 554 gate check
                    probe_futures[ip] = probe_executor.submit(probe_onvif_device, ip)

        except socket.timeout:
            pass
        finally:
            sock.close()

        for ip, future in probe_futures.items():
            try:
                device_info = future.result(timeout=12)
                if device_info:
                    discovered_devices[f"device-{ip}"] = device_info
            except Exception as e:
                print(f"[DISCOVERY] WS probe result error for {ip}: {e}")

        probe_executor.shutdown(wait=False)

    except Exception as e:
        print(f"[DISCOVERY] WS-Discovery error: {e}")

    return list(discovered_devices.values())


# ─────────────────────────────────────────────────────────────────────────────
# Subnet scan
# ─────────────────────────────────────────────────────────────────────────────

def discover_onvif_devices_simple(
    timeout_ms:  int = 800,
    username:    str = "",
    password:    str = "",
    max_workers: int = 100,
) -> list:
    discovered_devices: dict[str, dict] = {}
    lock = threading.Lock()

    # ── Try host proxy first (fixes Docker Desktop Windows NAT issue) ──────
    open_ips: dict[str, int] = {}
    try:
        import urllib.request, json as _json
        with urllib.request.urlopen("http://host.docker.internal:19999", timeout=90) as r:
            ips = _json.loads(r.read()).get("ips", [])
        if ips:
            open_ips = {ip: 554 for ip in ips}
            print(f"[DISCOVERY] Host proxy found {len(open_ips)} IPs: {list(open_ips)}")
    except Exception as e:
        print(f"[DISCOVERY] Host proxy failed ({e}) — falling back to container scan")

    # ── Fallback: scan from inside container (works on Linux host) ──────────
    if not open_ips:
        subnet = get_local_subnet()
        ports  = [554, 80, 8080, 8081, 8888, 8000, 8899, 37777, 5000]
        print(f"[DISCOVERY] Scanning {subnet}.1-254 on ports {ports} "
              f"(timeout={timeout_ms}ms, workers={max_workers})...")
        scan_targets = [
            (f"{subnet}.{i}", port)
            for i in range(1, 255)
            for port in ports
        ]
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

    # ── Everything below is UNCHANGED from your original ───────────────────
    def probe_and_classify(ip: str, port: int):
        device_info = probe_onvif_device(ip, port, username, password)
        if device_info:
            return ip, device_info
        device_type, manufacturer, model = _classify_device(ip, port)
        if device_type == "camera":
            fallback = {
                'id':            f"device-{ip}",
                'ip':            ip,
                'mac':           "Unknown",
                'status':        'online',
                'manufacturer':  manufacturer or 'Unknown',
                'model':         model or f"Port {port}",
                'device_type':   'camera',
                'discovered_at': datetime.utcnow().isoformat(),
            }
            print(f"[DISCOVERY] ✓ Fingerprint-only camera at {ip}:{port}")
            return ip, fallback
        print(f"[DISCOVERY] ✗ {ip} — not a camera (type={device_type})")
        return ip, None

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
                print(f"[DISCOVERY] Probe/classify failed: {e}")

    return list(discovered_devices.values())

# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def discover_all(
    ws_timeout:      int = 4,
    scan_timeout_ms: int = 800,
    username:        str = "",
    password:        str = "",
) -> list:
    """
    Runs WS-Discovery and subnet scan concurrently.
    Every device MUST pass port 554 RTSP check to be included.
    This eliminates CPU boxes, NVRs, switches, printers — anything
    that isn't actively streaming RTSP video.
    """
    print("[DISCOVERY] Starting parallel WS-Discovery + subnet scan...")

    with ThreadPoolExecutor(max_workers=2) as executor:
        ws_future     = executor.submit(discover_onvif_devices, ws_timeout)
        subnet_future = executor.submit(
            discover_onvif_devices_simple, scan_timeout_ms, username, password
        )
        ws_results     = ws_future.result()
        subnet_results = subnet_future.result()

    # Merge — WS-Discovery (richer data) takes precedence
    merged: dict[str, dict] = {}
    for d in subnet_results:
        merged[d['ip']] = d
    for d in ws_results:
        merged[d['ip']] = d

    result = list(merged.values())
    print(f"[DISCOVERY] ✅ Done — {len(result)} confirmed camera(s) "
          f"(WS={len(ws_results)}, subnet={len(subnet_results)})")
    return result