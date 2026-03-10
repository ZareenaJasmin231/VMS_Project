from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio

from onvif_service import probe_camera

app = FastAPI(title="MIRADORAI ONVIF Backend")

# ── CORS — allow React dev server ────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # tighten this in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request model ────────────────────────────────────────────────
class ProbeRequest(BaseModel):
    ip:       str
    port:     int  = 80
    username: str  = ""
    password: str  = ""

# ── Health check ─────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}

# ── ONVIF Probe endpoint ─────────────────────────────────────────
@app.post("/api/onvif/probe")
async def onvif_probe(req: ProbeRequest):
    """
    Probe a camera via ONVIF.
    Frontend sends: { ip, port, username, password }
    Returns: device info + stream URI + profiles
    """
    print(f"[ONVIF] Probing {req.ip}:{req.port} ...")

    # Run blocking ONVIF call in a thread so FastAPI stays non-blocking
    result = await asyncio.to_thread(
        probe_camera, req.ip, req.port, req.username, req.password
    )

    if result["success"]:
        print(f"[ONVIF] ✅ {result['manufacturer']} {result['model']}")
    else:
        print(f"[ONVIF] ❌ {result['error']}")

    return result
