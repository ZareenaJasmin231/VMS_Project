from fastapi import APIRouter, Request, Response, HTTPException
import httpx
import os

OME_HOST_IP   = os.environ.get("OME_HOST_IP", "localhost")
HOST_IP = os.environ.get("HOST_IP", "127.0.0.1")
OME_WHIP_BASE = os.environ.get("OME_WHIP_BASE", f"http://{HOST_IP}:3333/app")

router = APIRouter(tags=["whip"])

@router.post("/api/whip/{stream_key}")
async def webrtc_proxy(stream_key: str, request: Request):
    body    = await request.body()
    ome_url = f"{OME_WHIP_BASE}/{stream_key}"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                ome_url,
                content=body,
                headers={"Content-Type": "application/sdp"},
                timeout=10.0,
            )
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type="application/sdp",
            headers={"Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        print(f"[WHIP] ❌ Proxy error for {stream_key}: {e}")
        raise HTTPException(status_code=502, detail=str(e))

