# discovery_host.py
# Run this ONCE on Windows host: python discovery_host.py
# Keep it running alongside Docker

from http.server import HTTPServer, BaseHTTPRequestHandler
import socket, json, os
from concurrent.futures import ThreadPoolExecutor, as_completed

SUBNET  = os.environ.get("HOST_SUBNET", "192.168.126")
PORTS   = [554, 80, 8080, 8899, 37777]
TIMEOUT = 0.8

def check(ip, port):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(TIMEOUT)
            return ip if s.connect_ex((ip, port)) == 0 else None
    except:
        return None

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        targets = [(f"{SUBNET}.{i}", p) for i in range(1, 255) for p in PORTS]
        found   = set()
        with ThreadPoolExecutor(max_workers=200) as ex:
            for f in as_completed({ex.submit(check, ip, p) for ip, p in targets}):
                r = f.result()
                if r:
                    found.add(r)
        body = json.dumps({"ips": sorted(found)}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a):
        print(f"[HOST-SCAN] Scan done — {a}")

print(f"[HOST-SCAN] Running on port 19999 (subnet={SUBNET})")
HTTPServer(("0.0.0.0", 19999), H).serve_forever()