import requests
import os

MEDIAMTX_API = os.environ.get(
    "MEDIAMTX_API_URL",
    "http://localhost:9997"
)

def register_stream(stream_name, rtsp_url, codec=None):
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

        # NOTE: We no longer register the "_h264" fallback path via the
        # MediaMTX API here. MediaMTX's own config (mediamtx.yml) owns
        # that path through a regex rule (~^(.+)_h264$) using runOnDemand,
        # which auto-transcodes ANY H265 camera the moment a client
        # requests "<camera>_h264" — no per-camera registration needed.
        #
        # Previously, this function also POSTed
        # /v3/config/paths/add/{stream_name}_h264 with {"source": "publisher"}.
        # Because run_discovery_pipeline() only checks whether the BASE
        # stream exists before calling register_stream() again, any
        # rediscovery cycle that re-triggered this function would
        # re-POST the _h264 path and overwrite MediaMTX's regex-managed
        # entry with a static "publisher" one. That destroyed the
        # currently-running ffmpeg transcode process
        # ("runOnDemand command stopped: path destroyed") and left the
        # path expecting a publisher that never arrives — causing
        # permanent 404s on every subsequent WHEP request.
        #
        # We still compute and return the expected _h264 stream name so
        # callers/frontend can know what path to request, but we no
        # longer touch MediaMTX's config for it here.
        needs_h264_path = False
        if codec:
            codec_upper = codec.upper()
            if codec_upper in ["H.265", "H265", "HEVC"]:
                needs_h264_path = True
        else:
            # Safe default if codec is unknown
            needs_h264_path = True

        h264_stream_name = f"{stream_name}_h264"

        # If base stream was successfully created
        if res.status_code in [200, 201]:
            transcoded_stream = h264_stream_name if needs_h264_path else None
            return {"status": "ok", "transcoded_stream": transcoded_stream, "statusCode": res.status_code}

        return {
            "status": "error",
            "message": f"Base: {res.text}",
            "statusCode": res.status_code
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "statusCode": 0
        }

def get_stream_info(stream_name):
    """Get runtime information about a stream including active readers."""
    try:
        res = requests.get(
            f"{MEDIAMTX_API}/v3/paths/get/{stream_name}",
            timeout=5
        )
        if res.status_code == 200:
            return res.json()
        return None
    except Exception as e:
        print(f"MEDIAMTX GET INFO ERROR: {str(e)}")
        return None

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