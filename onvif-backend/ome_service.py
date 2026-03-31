import requests
import os

OME_URL = os.environ.get("OME_URL", "http://ome:8081/v1/vhosts/default/apps/app/streams")

headers = {
    "Authorization": "Basic bXl2bXNhY2Nlc3N0b2tlbg==",
    "Content-Type": "application/json"
}

def register_stream(stream_name, rtsp_url):
    payload = {
        "name": stream_name,
        "type": "pull",                        # ← ADD THIS — required by OME
        "urls": [rtsp_url],
        "persistent": True,
        "noInputFailoverTimeoutMs": -1,
        "unusedStreamDeletionTimeoutMs": -1
    }
    try:
        res = requests.post(OME_URL, json=payload, headers=headers, timeout=10)
        print("OME STATUS:", res.status_code)
        print("OME RESPONSE:", res.text)
        return res.json()
    except Exception as e:
        return {"error": str(e), "statusCode": 0}