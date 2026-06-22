import requests
import hashlib
import json
import urllib3
urllib3.disable_warnings()

ip = "192.168.126.237"
user = "admin"
pwd = "admin123"

# Use RPC2_Login for the auth handshake
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
        return {"error": "Invalid JSON", "text": resp.text}

print("--- Step 1: Login Challenge ---")
r1 = rpc_call(login_url, "global.login", {"userName": user, "password": "", "clientType": "Web3.0"}, req_id=1)
print(json.dumps(r1, indent=2))

session = r1.get("session")
if not session and "params" in r1:
    session = r1["params"].get("session")

challenge = r1.get("params", {})
if not challenge and "error" in r1:
    pass
    
if "params" in r1 and "realm" in r1["params"]:
    realm = r1["params"]["realm"]
    random_str = r1["params"]["random"]
    session = r1.get("session", r1["params"].get("session"))
    
    print("\n--- Step 2: Hashing ---")
    h1 = hashlib.md5(f"{user}:{realm}:{pwd}".encode()).hexdigest().upper()
    h2 = hashlib.md5(f"{user}:{random_str}:{h1}".encode()).hexdigest().upper()
    print(f"Hash: {h2}")
    
    print("\n--- Step 3: Login Final ---")
    r2 = rpc_call(login_url, "global.login", {"userName": user, "password": h2, "clientType": "Web3.0"}, session=session, req_id=2)
    print(json.dumps(r2, indent=2))
    
    if r2.get("result"):
        print("\n--- Step 4: Get Caps ---")
        sess2 = r2.get("session", session)
        # Use main RPC2 url for config
        r3 = rpc_call(rpc_url, "configManager.getConfigCaps", {"name": "Encode"}, session=sess2, req_id=3)
        print(json.dumps(r3, indent=2))
        
        r4 = rpc_call(rpc_url, "encode.getSmartCaps", {"channel": 0, "config": [{"Compression":"H.264","Policy":0}]}, session=sess2, req_id=4)
        print("SmartCaps:", json.dumps(r4, indent=2))
else:
    print("Could not find realm/random in response.")
