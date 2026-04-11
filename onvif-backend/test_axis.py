import requests, urllib3
urllib3.disable_warnings()
from requests.auth import HTTPDigestAuth

auth = HTTPDigestAuth('admin', 'admin123!')
ip = '192.168.126.234'

body = '''<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body><tds:GetSystemDateAndTime/></s:Body>
</s:Envelope>'''

print("=== TEST 1: POST with SOAPAction header ===")
for ct in ['text/xml; charset=utf-8', 'application/soap+xml; charset=utf-8']:
    try:
        r = requests.post(
            f'http://{ip}/onvif/device_service',
            data=body,
            headers={
                'Content-Type': ct,
                'SOAPAction': '"http://www.onvif.org/ver10/device/wsdl/GetSystemDateAndTime"'
            },
            auth=auth, verify=False, timeout=5
        )
        print(f'[{r.status_code}] CT={ct.split(";")[0]}')
        if r.status_code in (200, 400, 401):
            print('  BODY:', r.text[:500])
    except Exception as e:
        print(f'[ERR] {e}')

print("\n=== TEST 2: GET request (check if server is alive) ===")
try:
    r = requests.get(f'http://{ip}/', verify=False, timeout=5)
    print(f'GET / → [{r.status_code}]')
    print('  Headers:', dict(r.headers))
except Exception as e:
    print(f'[ERR] {e}')

print("\n=== TEST 3: No auth, just check what 405 says ===")
try:
    r = requests.post(
        f'http://{ip}/onvif/device_service',
        data=body,
        headers={'Content-Type': 'text/xml; charset=utf-8'},
        verify=False, timeout=5
    )
    print(f'No auth → [{r.status_code}]')
    print('  BODY:', r.text[:500])
    print('  Headers:', dict(r.headers))
except Exception as e:
    print(f'[ERR] {e}')

print("\n=== TEST 4: Check AXIS port 80 Allow header ===")
try:
    r = requests.options(f'http://{ip}/onvif/device_service', verify=False, timeout=5)
    print(f'OPTIONS → [{r.status_code}] Allow: {r.headers.get("Allow", "not set")}')
    print('  Headers:', dict(r.headers))
except Exception as e:
    print(f'[ERR] OPTIONS: {e}')

print("\n=== TEST 5: Try HTTPS port 443 with SOAPAction ===")
try:
    r = requests.post(
        f'https://{ip}/onvif/device_service',
        data=body,
        headers={
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': '"http://www.onvif.org/ver10/device/wsdl/GetSystemDateAndTime"'
        },
        auth=auth, verify=False, timeout=5
    )
    print(f'HTTPS [{r.status_code}]')
    if r.status_code in (200, 400, 401):
        print('  BODY:', r.text[:500])
except Exception as e:
    print(f'[ERR] HTTPS: {e}')

print("\n=== TEST 6: Check what AXIS web UI says ===")
for url in [f'http://{ip}/', f'http://{ip}/axis-cgi/basicdeviceinfo.cgi']:
    try:
        r = requests.get(url, auth=auth, verify=False, timeout=5)
        print(f'GET {url} → [{r.status_code}]')
        if r.status_code == 200:
            print('  BODY:', r.text[:300])
    except Exception as e:
        print(f'[ERR] {url}: {e}')