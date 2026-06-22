import requests
import os

MEDIAMTX_API = os.environ.get(
    "MEDIAMTX_API_URL",
    "http://localhost:9997"
)

def register_stream(stream_name, rtsp_url):
    payload = {
        "source": rtsp_url,
        "sourceOnDemand": False
    }

    try:
        res = requests.post(
            f"{MEDIAMTX_API}/v3/config/paths/add/{stream_name}",
            json=payload,
            timeout=10
        )

        print("MEDIAMTX STATUS:", res.status_code)
        print("MEDIAMTX RESPONSE:", res.text)

        if res.status_code in [200, 201]:
            return {"status": "ok"}

        return {
            "status": "error",
            "message": res.text,
            "statusCode": res.status_code
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "statusCode": 0
        }


def remove_stream(stream_name):
    try:
        res = requests.delete(
            f"{MEDIAMTX_API}/v3/config/paths/delete/{stream_name}",
            timeout=10
        )

        print("MEDIAMTX DELETE STATUS:", res.status_code)
        print("MEDIAMTX DELETE RESPONSE:", res.text)

        return res.status_code in [200, 204]

    except Exception as e:
        print("MEDIAMTX DELETE ERROR:", str(e))
        return False


def stream_exists(stream_name):
    try:
        res = requests.get(
            f"{MEDIAMTX_API}/v3/config/paths/get/{stream_name}",
            timeout=5
        )

        return res.status_code == 200

    except Exception:
        return False