from onvif import ONVIFCamera
import asyncio

def probe_camera(ip: str, port: int, username: str, password: str) -> dict:
    """
    Connect to an ONVIF camera and return device info + stream URI.
    Runs synchronously — called via asyncio.to_thread from FastAPI.
    """
    try:
        cam = ONVIFCamera(ip, port, username, password)

        # ── Device Information ──────────────────────────────────────
        device_service = cam.create_devicemgmt_service()
        info = device_service.GetDeviceInformation()

        # ── Stream URI ──────────────────────────────────────────────
        media_service = cam.create_media_service()
        profiles      = media_service.GetProfiles()

        stream_uri  = "Unavailable"
        profile_list = []

        if profiles:
            # Get stream URI from first profile
            stream_setup = media_service.create_type("GetStreamUri")
            stream_setup.ProfileToken     = profiles[0].token
            stream_setup.StreamSetup      = {"Stream": "RTP-Unicast", "Transport": {"Protocol": "RTSP"}}
            stream_response               = media_service.GetStreamUri(stream_setup)
            stream_uri                    = stream_response.Uri

            # Build profile list
            for p in profiles:
                try:
                    res = p.VideoEncoderConfiguration.Resolution
                    enc = p.VideoEncoderConfiguration.Encoding
                    profile_list.append({
                        "name":       p.Name,
                        "token":      p.token,
                        "resolution": f"{res.Width}x{res.Height}",
                        "encoding":   str(enc),
                    })
                except Exception:
                    profile_list.append({"name": p.Name, "token": p.token})

        # ── PTZ check ───────────────────────────────────────────────
        ptz = "No"
        try:
            cam.create_ptz_service()
            ptz = "Yes"
        except Exception:
            pass

        return {
            "success":      True,
            "manufacturer": info.Manufacturer,
            "model":        info.Model,
            "firmware":     info.FirmwareVersion,
            "serial":       info.SerialNumber,
            "hardware":     info.HardwareId,
            "stream_uri":   stream_uri,
            "profiles":     profile_list,
            "ptz":          ptz,
        }

    except Exception as e:
        return {
            "success": False,
            "error":   str(e),
        }
