import requests
from requests.auth import HTTPDigestAuth
import json
import urllib3
urllib3.disable_warnings()

ip = "192.168.126.237"
user = "admin"
pwd = "admin123"

# Test 1: devVideoEncode.cgi
try:
    r = requests.get(f"http://{ip}/cgi-bin/devVideoEncode.cgi?action=getCaps", auth=HTTPDigestAuth(user, pwd), verify=False, timeout=3)
    if r.status_code == 200:
        print("devVideoEncode.cgi SUCCESS!")
        print(r.text[:500])
except: pass

# Test 2: configManager.cgi?action=getConfigCaps
try:
    r = requests.get(f"http://{ip}/cgi-bin/configManager.cgi?action=getConfigCaps&name=Encode", auth=HTTPDigestAuth(user, pwd), verify=False, timeout=3)
    if r.status_code == 200:
        print("configManager.cgi getConfigCaps SUCCESS!")
        print(r.text[:500])
except: pass

# Test 3: RPC encode.getSmartCaps
try:
    login_url = f"http://{ip}/RPC2_Login"
    r1 = requests.post(login_url, json={"method": "global.login", "params": {"userName": user, "password": "", "clientType": "Web3.0"}, "id": 1}, verify=False).json()
    import hashlib
    realm = r1["params"]["realm"]
    random_str = r1["params"]["random"]
    h1 = hashlib.md5(f"{user}:{realm}:{pwd}".encode()).hexdigest().upper()
    h2 = hashlib.md5(f"{user}:{random_str}:{h1}".encode()).hexdigest().upper()
    r2 = requests.post(login_url, json={"method": "global.login", "params": {"userName": user, "password": h2, "clientType": "Web3.0"}, "session": r1.get("session"), "id": 2}, verify=False).json()
    sess = r2.get("session") or r1.get("session")
    
    r3 = requests.post(f"http://{ip}/RPC2", json={"method": "devVideoEncode.getCaps", "params": {}, "session": sess, "id": 3}, verify=False).json()
    if r3.get("result"):
        print("devVideoEncode.getCaps RPC SUCCESS!")
        print(json.dumps(r3)[:500])
except Exception as e:
    print("RPC Error:", e)
