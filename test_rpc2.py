import requests
import hashlib
import json
import urllib3
urllib3.disable_warnings()

ip = "192.168.126.237"
user = "admin"
pwd = "admin123"

login_url = f"http://{ip}/RPC2_Login"
rpc_url = f"http://{ip}/RPC2"

def rpc_call(url, method, params, session=None, req_id=1):
    req = {
        "method": method,
        "params": params,
        "id": req_id
    }
    if session:
        req["session"] = session
    resp = requests.post(url, json=req, timeout=3, verify=False)
    try:
        return resp.json()
    except:
        return {"error": "Invalid JSON"}

r1 = rpc_call(login_url, "global.login", {"userName": user, "password": "", "clientType": "Web3.0"}, req_id=1)
session = r1.get("session") or (r1.get("params") or {}).get("session")
realm = r1.get("params", {}).get("realm")
random_str = r1.get("params", {}).get("random")

h1 = hashlib.md5(f"{user}:{realm}:{pwd}".encode()).hexdigest().upper()
h2 = hashlib.md5(f"{user}:{random_str}:{h1}".encode()).hexdigest().upper()

r2 = rpc_call(login_url, "global.login", {"userName": user, "password": h2, "clientType": "Web3.0"}, session=session, req_id=2)
sess2 = r2.get("session", session)

print("--- Get Config Encode ---")
r3 = rpc_call(rpc_url, "configManager.getConfig", {"name": "Encode"}, session=sess2, req_id=3)
print(json.dumps(r3, indent=2))

print("\n--- devVideoEncode getCaps ---")
r4 = rpc_call(rpc_url, "devVideoEncode.getCaps", {}, session=sess2, req_id=4)
print(json.dumps(r4, indent=2))
