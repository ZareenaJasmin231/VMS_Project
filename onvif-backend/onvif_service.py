import re
from datetime import datetime, timedelta, timezone
from onvif import ONVIFCamera

def _parse_onvif_time(date_obj, time_obj):
    if date_obj is None or time_obj is None:
        return None
    try:
        seconds = float(getattr(time_obj, 'Second', 0))
        sec_int = int(seconds)
        micro = int((seconds - sec_int) * 1_000_000)
        return datetime(
            date_obj.Year,
            date_obj.Month,
            date_obj.Day,
            time_obj.Hour,
            time_obj.Minute,
            sec_int,
            micro,
        )
    except Exception:
        return None


def _parse_onvif_timezone(tz_obj):
    if tz_obj is None:
        return None
    if isinstance(tz_obj, str):
        tz_str = tz_obj
    else:
        tz_str = getattr(tz_obj, 'TZ', None) or getattr(tz_obj, 'GMT', None)
    if not tz_str:
        return None

    tz_str = str(tz_str).strip()
    if not tz_str:
        return None

    if tz_str.upper() == 'UTC' or tz_str.upper() == 'Z':
        return timezone.utc

    if tz_str.upper().startswith('GMT'):
        tz_str = tz_str[3:].strip()

    match = re.match(r'^([+-])\s*(\d{1,2})(?::?(\d{2}))?(?:\.(\d+))?$', tz_str)
    if match:
        sign, hours_text, minutes_text, decimal_text = match.groups()
        try:
            hours = int(hours_text)
            minutes = int(minutes_text) if minutes_text else 0
            if decimal_text:
                frac = float('0.' + decimal_text)
                minutes = int(round(frac * 60))
            delta = timedelta(hours=hours, minutes=minutes)
            if sign == '-':
                delta = -delta
            return timezone(delta)
        except Exception:
            print(f"[ONVIF TIME] Could not parse timezone string: {tz_str}")
            return None

    print(f"[ONVIF TIME] Unsupported timezone format: {tz_str}")
    return None


# ✅ FIX 3: Keywords that indicate a device is NOT a camera
_NON_CAMERA_KEYWORDS = [
    "nvr", "dvr", "recorder", "server", "nas",
    "display", "decoder", "workstation", "desktop", "laptop"
]


def probe_camera(ip: str, port: int, username: str, password: str) -> dict:
    """
    Connect to an ONVIF camera and return device info + all stream profiles with RTSP URLs.
    Runs synchronously — called via asyncio.to_thread from FastAPI.

    ✅ FIX 3 applied:
      - Checks GetVideoSources to confirm device has actual video input.
      - Rejects device if model/manufacturer name contains NVR/DVR/server keywords.
    """
    try:
        cam = ONVIFCamera(ip, port, username, password)

        # ── Device Information ────────────────────────────────────
        device_service = cam.create_devicemgmt_service()
        info           = device_service.GetDeviceInformation()

        # ✅ FIX 3a: Reject immediately if model/manufacturer signals non-camera
        model_str        = (getattr(info, 'Model',        '') or '').lower()
        manufacturer_str = (getattr(info, 'Manufacturer', '') or '').lower()
        for kw in _NON_CAMERA_KEYWORDS:
            if kw in model_str or kw in manufacturer_str:
                print(f"[ONVIF] ✗ {ip} — device info indicates non-camera: "
                      f"'{info.Manufacturer} {info.Model}' — rejecting")
                return {
                    "success": False,
                    "error":   f"Device appears to be a non-camera ({info.Manufacturer} {info.Model})",
                }

        # ── Media service + profiles ──────────────────────────────
        media_service = cam.create_media_service()

        # ✅ FIX 3b: Verify the device actually has video sources (cameras do, PCs/NVRs may not)
        try:
            video_sources = media_service.GetVideoSources()
            if not video_sources:
                print(f"[ONVIF] ✗ {ip} — GetVideoSources returned empty — not a real camera")
                return {
                    "success": False,
                    "error":   "No video sources found — device is not a camera",
                }
            print(f"[ONVIF] ✓ {ip} has {len(video_sources)} video source(s)")
        except Exception as vs_err:
            # Some cameras don't implement GetVideoSources fully — log and continue
            print(f"[ONVIF] ⚠ {ip} — GetVideoSources failed ({vs_err}), continuing anyway")

        profiles = media_service.GetProfiles()

        stream_uri   = "Unavailable"
        profile_list = []

        if profiles:
            for idx, p in enumerate(profiles):
                try:
                    stream_setup = media_service.create_type("GetStreamUri")
                    stream_setup.ProfileToken = p.token
                    stream_setup.StreamSetup  = {
                        "Stream":    "RTP-Unicast",
                        "Transport": {"Protocol": "RTSP"},
                    }
                    uri = media_service.GetStreamUri(stream_setup).Uri

                    if idx == 0:
                        stream_uri = uri

                    vec     = p.VideoEncoderConfiguration
                    res     = None
                    enc     = None
                    fps     = None
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
                            rc  = vec.RateControl
                            fps = int(rc.FrameRateLimit) if rc else None
                        except Exception:
                            fps = None
                        try:
                            rc      = vec.RateControl
                            bitrate = int(rc.BitrateLimit) if rc else None
                        except Exception:
                            bitrate = None

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
                    profile_list.append({
                        "name":  p.Name,
                        "token": p.token,
                        "label": f"STREAM {idx + 1}",
                        "error": str(e),
                    })

        # ✅ FIX 3c: Final check — must have at least one valid RTSP URL in profiles
        valid_rtsp_profiles = [
            p for p in profile_list
            if p.get("rtsp_url") and "rtsp://" in p.get("rtsp_url", "")
        ]
        if not valid_rtsp_profiles:
            print(f"[ONVIF] ✗ {ip} — no valid RTSP URLs in any profile — rejecting")
            return {
                "success": False,
                "error":   "No valid RTSP stream URLs found in device profiles",
            }

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
            "stream_uri":   stream_uri,
            "profiles":     profile_list,
            "stream_count": len(profile_list),
            "ptz":          ptz,
        }

    except Exception as e:
        return {
            "success": False,
            "error":   str(e),
        }


def get_camera_system_time(ip: str, port: int = 80, username: str = "", password: str = "") -> datetime | None:
    """
    Fetch the camera's system clock via ONVIF so recording filenames reflect the camera's own time.
    """
    try:
        cam = ONVIFCamera(ip, port, username, password)
        device_service = cam.create_devicemgmt_service()
        sys_time = device_service.GetSystemDateAndTime()

        tz_info = _parse_onvif_timezone(getattr(sys_time, 'TimeZone', None))
        dt = None

        if getattr(sys_time, "LocalDateTime", None):
            d = sys_time.LocalDateTime.Date
            t = sys_time.LocalDateTime.Time
            dt = _parse_onvif_time(d, t)
            if dt and tz_info:
                dt = dt.replace(tzinfo=tz_info)

        elif getattr(sys_time, "UTCDateTime", None):
            d = sys_time.UTCDateTime.Date
            t = sys_time.UTCDateTime.Time
            dt = _parse_onvif_time(d, t)
            if dt:
                dt = dt.replace(tzinfo=timezone.utc)
                if tz_info:
                    dt = dt.astimezone(tz_info)

        if dt is not None:
            print(f"[ONVIF TIME] Parsed camera time for {ip}:{port} -> {dt.isoformat()} tz={tz_info}")
            return dt

        print(f"[ONVIF TIME] No valid camera time parsed for {ip}:{port} (tz={getattr(sys_time, 'TimeZone', None)})")
        print(f"[ONVIF TIME] Raw system time response: LocalDateTime={getattr(sys_time, 'LocalDateTime', None)}, UTCDateTime={getattr(sys_time, 'UTCDateTime', None)}")
        return None
    except Exception as e:
        print(f"[ONVIF TIME] Failed to query camera time for {ip}:{port} — {e}")
        return None


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