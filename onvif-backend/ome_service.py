import requests
import base64

OME_URL = "http://ome:8081/v1/vhosts/default/apps/app/streams"

token = base64.b64encode("bXl2bXNhY2Nlc3N0b2tlbg==".encode()).decode()

headers = {
    "Authorization": f"Basic {token}",
    "Content-Type": "application/json"
}

def register_stream(stream_name, rtsp_url):
    payload = {
        "name": stream_name,
        "urls": [rtsp_url],
        "persistent": True,        
        "noInputFailoverTimeoutMs": -1,   
        "unusedStreamDeletionTimeoutMs": -1  
    }
    try:
        res = requests.post(OME_URL, json=payload, headers=headers)
        print("OME STATUS:", res.status_code)
        print("OME RESPONSE:", res.text)
        return res.json()
    except Exception as e:
        return {"error": str(e)}