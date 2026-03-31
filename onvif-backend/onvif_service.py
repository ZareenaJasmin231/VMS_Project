from onvif import ONVIFCamera

def probe_camera(ip: str, port: int, username: str, password: str) -> dict:
    """
    Connect to an ONVIF camera and return device info + all stream profiles with RTSP URLs.
    Runs synchronously — called via asyncio.to_thread from FastAPI.
    """
    try:
        cam = ONVIFCamera(ip, port, username, password)

        # ── Device Information ────────────────────────────────────
        device_service = cam.create_devicemgmt_service()
        info           = device_service.GetDeviceInformation()

        # ── Media service + profiles ──────────────────────────────
        media_service = cam.create_media_service()
        profiles      = media_service.GetProfiles()

        stream_uri   = "Unavailable"
        profile_list = []

        if profiles:
            # Get RTSP URL for EACH profile individually
            for idx, p in enumerate(profiles):
                try:
                    # ── Get RTSP URL for this specific profile ────
                    stream_setup = media_service.create_type("GetStreamUri")
                    stream_setup.ProfileToken = p.token
                    stream_setup.StreamSetup  = {
                        "Stream":    "RTP-Unicast",
                        "Transport": {"Protocol": "RTSP"},
                    }
                    uri = media_service.GetStreamUri(stream_setup).Uri

                    # Use first profile's URI as the main stream_uri
                    if idx == 0:
                        stream_uri = uri

                    # ── Extract video encoder config ──────────────
                    vec = p.VideoEncoderConfiguration
                    res = None
                    enc = None
                    fps = None
                    bitrate = None

                    if vec:
                        try:
                            res = f"{vec.Resolution.Width}x{vec.Resolution.Height}"
                        except Exception:
                            res = None
                        try:
                            enc = str(vec.Encoding)
                        except Exception:
                            enc = None
                        try:
                            rc  = vec.RateControl        # ← FIX: rc defined here
                            fps = int(rc.FrameRateLimit) if rc else None
                        except Exception:
                            fps = None
                        try:
                            rc      = vec.RateControl
                            bitrate = int(rc.BitrateLimit) if rc else None
                        except Exception:
                            bitrate = None

                    # ── Label: MAIN, SUB, EXTRA, STREAM N ────────
                    if idx == 0:
                        label = "MAIN"
                    elif idx == 1:
                        label = "SUB"
                    elif idx == 2:
                        label = "EXTRA"
                    else:
                        label = f"STREAM {idx + 1}"

                    profile_list.append({
                        "name":       p.Name,
                        "token":      p.token,
                        "label":      label,
                        "resolution": res,
                        "encoding":   enc,
                        "fps":        fps,
                        "bitrate":    bitrate,
                        "rtsp_url":   uri,
                    })

                except Exception as e:
                    # Even if URI fetch fails, still save the profile name/token
                    profile_list.append({
                        "name":  p.Name,
                        "token": p.token,
                        "label": f"STREAM {idx + 1}",
                        "error": str(e),
                    })

        # ── PTZ check ─────────────────────────────────────────────
        ptz = "No"
        try:
            cam.create_ptz_service()
            ptz = "Yes"
        except Exception:
            pass

        # ── MAC address (best effort) ─────────────────────────────
        mac = "—"
        try:
            net_info = device_service.GetNetworkInterfaces()
            if net_info:
                mac = net_info[0].Info.HwAddress
        except Exception:
            pass

        return {
            "success":      True,
            "manufacturer": info.Manufacturer,
            "model":        info.Model,
            "firmware":     info.FirmwareVersion,
            "serial":       info.SerialNumber,
            "hardware":     info.HardwareId,
            "mac":          mac,
            "stream_uri":   stream_uri,        # RTSP URL of first (MAIN) profile
            "profiles":     profile_list,      # All profiles with their RTSP URLs
            "stream_count": len(profile_list),
            "ptz":          ptz,
        }

    except Exception as e:
        return {
            "success": False,
            "error":   str(e),
        }


def move_camera_ptz(ip: str, port: int, username: str, password: str,
                    pan: float, tilt: float, zoom: float) -> dict:
    """
    Absolute PTZ move.
    pan:  -1.0 to 1.0
    tilt: -1.0 to 1.0
    zoom:  0.0 to 1.0
    """
    try:
        cam           = ONVIFCamera(ip, port, username, password)
        ptz_service   = cam.create_ptz_service()
        media_service = cam.create_media_service()
        profiles      = media_service.GetProfiles()

        if not profiles:
            return {"success": False, "error": "No profiles found"}

        token   = profiles[0].token
        request = ptz_service.create_type("AbsoluteMove")
        request.ProfileToken = token
        request.Position = {
            "PanTilt": {"x": float(pan),  "y": float(tilt)},
            "Zoom":    {"x": float(zoom)},
        }
        request.Speed = {
            "PanTilt": {"x": 0.5, "y": 0.5},
            "Zoom":    {"x": 0.5},
        }
        ptz_service.AbsoluteMove(request)
        return {"success": True}

    except Exception as e:
        return {"success": False, "error": str(e)}