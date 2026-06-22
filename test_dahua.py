import requests
from requests.auth import HTTPDigestAuth, HTTPBasicAuth

ip = "192.168.126.237"
user = "admin"
pwd = "admin123"

endpoints = [
    f"http://{ip}/cgi-bin/encode.cgi?action=getConfigCaps",
    f"http://{ip}/cgi-bin/configManager.cgi?action=getConfig&name=Encode",
    f"http://{ip}/cgi-bin/encode.cgi?action=getConfigCaps&channel=0"
]

print(f"Testing Dahua CGI for {ip}...")
for url in endpoints:
    print(f"\n--- Trying {url} ---")
    for AuthType in (HTTPDigestAuth, HTTPBasicAuth):
        try:
            r = requests.get(url, auth=AuthType(user, pwd), timeout=3, verify=False)
            print(f"Auth: {AuthType.__name__} -> Status: {r.status_code}")
            if r.status_code == 200:
                print("Response starts with:")
                print(r.text[:500])
                break
        except Exception as e:
            print(f"Auth: {AuthType.__name__} -> Error: {e}")
