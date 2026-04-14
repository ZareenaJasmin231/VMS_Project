import socket
import re
import hashlib

ip = "192.168.126.234"
port = 554
username = "admin"
password = "Admin1234567!SDAR"
path = "/axis-media/media.amp"
url  = f"rtsp://{ip}{path}"

def md5(s):
    return hashlib.md5(s.encode()).hexdigest()

def send_recv(s, data):
    s.sendall(data.encode())
    response = b""
    while True:
        try:
            chunk = s.recv(8192)
            if not chunk:
                break
            response += chunk
            if b"\r\n\r\n" in response:
                # Check if we have full response
                if b"Content-Length:" in response:
                    cl_match = re.search(rb'Content-Length:\s*(\d+)', response)
                    if cl_match:
                        cl = int(cl_match.group(1))
                        header_end = response.find(b"\r\n\r\n") + 4
                        if len(response) >= header_end + cl:
                            break
                else:
                    break
        except socket.timeout:
            break
    return response.decode('utf-8', errors='replace')

print(f"[TEST] Connecting to {ip}:{port}...")
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(8)
s.connect((ip, port))

# Step 1: DESCRIBE without auth
describe1 = (
    f"DESCRIBE {url} RTSP/1.0\r\n"
    f"CSeq: 1\r\n"
    f"User-Agent: OME-Test\r\n"
    f"Accept: application/sdp\r\n\r\n"
)
resp1 = send_recv(s, describe1)
print(f"Step 1 - No auth: {resp1.splitlines()[0]}")

# Extract digest challenge
realm  = re.search(r'realm="([^"]+)"', resp1)
nonce  = re.search(r'nonce="([^"]+)"', resp1)

if not realm or not nonce:
    print("No digest challenge received")
    s.close()
    exit()

realm  = realm.group(1)
nonce  = nonce.group(1)
print(f"Realm: {realm}, Nonce: {nonce[:20]}...")

# Step 2: DESCRIBE with Digest auth
ha1      = md5(f"{username}:{realm}:{password}")
ha2      = md5(f"DESCRIBE:{url}")
response = md5(f"{ha1}:{nonce}:{ha2}")

auth_header = (
    f'Digest username="{username}", realm="{realm}", '
    f'nonce="{nonce}", uri="{url}", response="{response}"'
)

describe2 = (
    f"DESCRIBE {url} RTSP/1.0\r\n"
    f"CSeq: 2\r\n"
    f"User-Agent: OME-Test\r\n"
    f"Accept: application/sdp\r\n"
    f"Authorization: {auth_header}\r\n\r\n"
)
resp2 = send_recv(s, describe2)
print(f"\nStep 2 - With Digest auth: {resp2.splitlines()[0]}")

# Parse Content-Base and a=control
cb = re.search(r'Content-Base:\s*(.+)', resp2)
if cb:
    content_base = cb.group(1).strip()
    print(f"\n✅ Content-Base: {content_base}")
    if '@' in content_base:
        # Extract what's between // and @
        user_part = content_base.split('://')[1].split('@')[0] if '://' in content_base else ''
        print(f"⚠️  Content-Base has @ — user part is: '{user_part}'")
        print(f"   This means AXIS strips password, keeping only: '{user_part}'")
        print(f"   OME will use this broken URL for SETUP → 400 Bad Request")
    else:
        print(f"✅ Content-Base has no @ — SETUP should work!")

controls = re.findall(r'a=control:(rtsp[^\r\n]+)', resp2)
print(f"\na=control URLs:")
for c in controls:
    print(f"  {c.strip()}")
    if '@' in c:
        print(f"  ⚠️  Control URL also has @ issue!")

# Show full SDP
sdp_start = resp2.find('\r\n\r\n')
if sdp_start > 0:
    print(f"\n=== Full SDP ===")
    print(resp2[sdp_start+4:sdp_start+1500])

s.close()