import re
import ssl
import os
from datetime import datetime, timedelta, timezone
from camera_api_detector import detect_camera_api

# ── Patch SSL BEFORE any other imports so zeep/requests never verify certs ──
os.environ['CURL_CA_BUNDLE'] = ''
os.environ['REQUESTS_CA_BUNDLE'] = ''
os.environ['SSL_CERT_FILE'] = ''

try:
    _orig_create_default_context = ssl.create_default_context
    def _patched_ssl_context(*args, **kwargs):
        ctx = _orig_create_default_context(*args, **kwargs)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    ssl.create_default_context = _patched_ssl_context
except Exception:
    pass

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

import requests
from requests.adapters import HTTPAdapter
from urllib3.poolmanager import PoolManager

class _NoSSLAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        kwargs['ssl_context'] = ssl.create_default_context()
        return super().init_poolmanager(*args, **kwargs)

# Patch the default requests session
_session = requests.Session()
_session.verify = False
_session.mount('https://', _NoSSLAdapter())

try:
    import zeep.transports as _zt
    _orig_transport_init = _zt.Transport.__init__
    def _patched_transport_init(self, *args, **kwargs):
        kwargs.setdefault('operation_timeout', 10)
        _orig_transport_init(self, *args, **kwargs)
        try:
            self.session.verify = False
            self.session.mount('https://', _NoSSLAdapter())
        except Exception:
            pass
    _zt.Transport.__init__ = _patched_transport_init
except Exception:
    pass

from onvif import ONVIFCamera
try:
    requests.packages.urllib3.disable_warnings()
except Exception:
    pass


def _make_cam(ip, port, username, password):
    """Create ONVIFCamera with SSL verification disabled."""
    cam = ONVIFCamera(ip, port, username, password)
    try:
        for attr in dir(cam):
            if attr.startswith('_'):
                continue
            svc = getattr(cam, attr, None)
            if svc and hasattr(svc, 'transport'):
                try:
                    svc.transport.session.verify = False
                except Exception:
                    pass
    except Exception:
        pass
    return cam


def _parse_onvif_time(date_obj, time_obj):
    if date_obj is None or time_obj is None:
        return None
    try:
        seconds = float(getattr(time_obj, 'Second', 0))
        sec_int = int(seconds)
        micro = int((seconds - sec_int) * 1_000_000)
        return datetime(
            date_obj.Year, date_obj.Month, date_obj.Day,
            time_obj.Hour, time_obj.Minute, sec_int, micro,
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
    if tz_str.upper() in ('UTC', 'Z'):
        return timezone.utc
    if '/' in tz_str:
        try:
            from zoneinfo import ZoneInfo
            return ZoneInfo(tz_str)
        except Exception:
            pass
        try:
            import pytz
            return pytz.timezone(tz_str)
        except Exception:
            pass
    posix_match = re.match(r'^[A-Za-z]+([+-]\d{1,2}(?::?\d{2})?)', tz_str)
    if posix_match:
        tz_str = posix_match.group(1)
    if tz_str.upper().startswith('GMT'):
        tz_str = tz_str[3:].strip()
    match = re.match(r'^([+-])\s*(\d{1,2})(?::?(\d{2}))?(?:\.(\d+))?$', tz_str)
    if match:
        sign, hours_text, minutes_text, decimal_text = match.groups()
        try:
            hours   = int(hours_text)
            minutes = int(minutes_text) if minutes_text else 0
            if decimal_text:
                minutes = int(round(float('0.' + decimal_text) * 60))
            delta = timedelta(hours=hours, minutes=minutes)
            if sign == '-':
                delta = -delta
            return timezone(delta)
        except Exception:
            return None
    return None


_NON_CAMERA_KEYWORDS = [
    "nvr", "dvr", "recorder", "server", "nas",
    "display", "decoder", "workstation", "desktop", "laptop"
]


# ─────────────────────────────────────────────────────────────────
# CAPABILITY FETCHING HELPERS
# ─────────────────────────────────────────────────────────────────

def _fetch_capabilities(device_service) -> dict:
    caps = {
        "ptz":       False,
        "imaging":   False,
        "events":    False,
        "analytics": False,
        "io":        False,
        "recording": False,
    }
    try:
        raw = device_service.GetCapabilities({"Category": "All"})

        if getattr(raw, 'PTZ', None):
            caps["ptz"] = True
        if getattr(raw, 'Imaging', None):
            caps["imaging"] = True
        if getattr(raw, 'Events', None):
            caps["events"] = True
        if getattr(raw, 'Analytics', None):
            caps["analytics"] = True

        device_cap = getattr(raw, 'Device', None)
        if device_cap:
            io_cap = getattr(device_cap, 'IO', None)
            if io_cap:
                inputs  = getattr(io_cap, 'InputConnectors',  0) or 0
                outputs = getattr(io_cap, 'RelayOutputs',     0) or 0
                caps["io"] = (inputs > 0 or outputs > 0)
                caps["io_inputs"]  = int(inputs)
                caps["io_outputs"] = int(outputs)

        rec_cap = getattr(raw, 'Recording', None) or getattr(raw, 'MediaCapabilities', None)
        if rec_cap:
            caps["recording"] = True

        print(f"[CAPS] GetCapabilities: {caps}")
    except Exception as e:
        print(f"[CAPS] GetCapabilities failed: {e}")

    return caps


def _fetch_imaging_settings(cam, media_service) -> dict:
    imaging_info = {
        "supported": False,
        "brightness":       None,
        "contrast":         None,
        "saturation":       None,
        "sharpness":        None,
        "backlight_compensation": None,
        "exposure_mode":    None,
        "exposure_min_gain": None,
        "exposure_max_gain": None,
        "exposure_min_shutter": None,
        "exposure_max_shutter": None,
        "white_balance_mode": None,
        "ir_cut_filter":    None,
        "wide_dynamic_range": None,
        "wdr_level":        None,
        "focus_mode":       None,
        "focus_near_limit": None,
        "focus_far_limit":  None,
        "options":          {},
    }

    try:
        imaging_service = cam.create_imaging_service()
        try:
            imaging_service.transport.session.verify = False
        except Exception:
            pass

        media_service2 = cam.create_media_service()
        try:
            media_service2.transport.session.verify = False
        except Exception:
            pass

        sources = media_service2.GetVideoSources()
        if not sources:
            return imaging_info

        source_token = sources[0].token
        settings = imaging_service.GetImagingSettings({"VideoSourceToken": source_token})
        imaging_info["supported"] = True

        imaging_info["brightness"]  = _safe_get(settings, 'Brightness')
        imaging_info["contrast"]    = _safe_get(settings, 'ColorSaturation')
        imaging_info["saturation"]  = _safe_get(settings, 'ColorSaturation')
        imaging_info["sharpness"]   = _safe_get(settings, 'Sharpness')

        blc = _safe_get(settings, 'BacklightCompensation')
        if blc:
            imaging_info["backlight_compensation"] = {
                "mode":  str(getattr(blc, 'Mode',  '') or ''),
                "level": _safe_get(blc, 'Level'),
            }

        exp = _safe_get(settings, 'Exposure')
        if exp:
            imaging_info["exposure_mode"]        = str(getattr(exp, 'Mode', '') or '')
            imaging_info["exposure_min_gain"]    = _safe_get(exp, 'MinGain')
            imaging_info["exposure_max_gain"]    = _safe_get(exp, 'MaxGain')
            imaging_info["exposure_min_shutter"] = _safe_get(exp, 'MinExposureTime')
            imaging_info["exposure_max_shutter"] = _safe_get(exp, 'MaxExposureTime')

        wb = _safe_get(settings, 'WhiteBalance')
        if wb:
            imaging_info["white_balance_mode"] = str(getattr(wb, 'Mode', '') or '')

        ir = _safe_get(settings, 'IrCutFilter')
        if ir is not None:
            imaging_info["ir_cut_filter"] = str(ir)

        wdr = _safe_get(settings, 'WideDynamicRange')
        if wdr:
            imaging_info["wide_dynamic_range"] = str(getattr(wdr, 'Mode', '') or '')
            imaging_info["wdr_level"]          = _safe_get(wdr, 'Level')

        focus = _safe_get(settings, 'Focus')
        if focus:
            imaging_info["focus_mode"]       = str(getattr(focus, 'AutoFocusMode', '') or '')
            imaging_info["focus_near_limit"] = _safe_get(focus, 'NearLimit')
            imaging_info["focus_far_limit"]  = _safe_get(focus, 'FarLimit')

        try:
            options = imaging_service.GetOptions({"VideoSourceToken": source_token})
            opts = {}

            brightness_opts = _safe_get(options, 'Brightness')
            if brightness_opts:
                opts["brightness_range"] = {
                    "min": _safe_get(brightness_opts, 'Min'),
                    "max": _safe_get(brightness_opts, 'Max'),
                }

            contrast_opts = _safe_get(options, 'ColorSaturation')
            if contrast_opts:
                opts["saturation_range"] = {
                    "min": _safe_get(contrast_opts, 'Min'),
                    "max": _safe_get(contrast_opts, 'Max'),
                }

            sharpness_opts = _safe_get(options, 'Sharpness')
            if sharpness_opts:
                opts["sharpness_range"] = {
                    "min": _safe_get(sharpness_opts, 'Min'),
                    "max": _safe_get(sharpness_opts, 'Max'),
                }

            exp_opts = _safe_get(options, 'Exposure')
            if exp_opts:
                modes = getattr(exp_opts, 'Mode', []) or []
                opts["exposure_modes"] = [str(m) for m in modes]

            wb_opts = _safe_get(options, 'WhiteBalance')
            if wb_opts:
                modes = getattr(wb_opts, 'Mode', []) or []
                opts["white_balance_modes"] = [str(m) for m in modes]

            ir_opts = _safe_get(options, 'IrCutFilterModes')
            if ir_opts:
                opts["ir_cut_modes"] = [str(m) for m in ir_opts]

            wdr_opts = _safe_get(options, 'WideDynamicRange')
            if wdr_opts:
                modes = getattr(wdr_opts, 'Mode', []) or []
                opts["wdr_modes"] = [str(m) for m in modes]

            focus_opts = _safe_get(options, 'Focus')
            if focus_opts:
                modes = getattr(focus_opts, 'AutoFocusMode', []) or []
                opts["focus_modes"] = [str(m) for m in modes]

            imaging_info["options"] = opts
        except Exception as e:
            print(f"[IMAGING] GetOptions failed: {e}")

        print(f"[IMAGING] Settings fetched for {source_token}: "
              f"brightness={imaging_info['brightness']}, "
              f"ir_cut={imaging_info['ir_cut_filter']}, "
              f"wdr={imaging_info['wide_dynamic_range']}")

    except Exception as e:
        print(f"[IMAGING] GetImagingSettings failed: {e}")

    return imaging_info


def _fetch_ptz_info(cam, media_service) -> dict:
    ptz_info = {
        "supported":       False,
        "presets":         [],
        "home_supported":  False,
        "continuous_move": False,
        "absolute_move":   True,
        "relative_move":   False,
        "spaces":          {},
    }

    try:
        ptz_service = cam.create_ptz_service()
        try:
            ptz_service.transport.session.verify = False
        except Exception:
            pass

        profiles = media_service.GetProfiles()
        if not profiles:
            return ptz_info

        token = profiles[0].token
        ptz_info["supported"] = True

        try:
            presets = ptz_service.GetPresets({"ProfileToken": token})
            ptz_info["presets"] = [
                {
                    "token": str(p.token),
                    "name":  str(getattr(p, 'Name', f"Preset {i+1}")),
                }
                for i, p in enumerate(presets or [])
            ]
            print(f"[PTZ] {len(ptz_info['presets'])} preset(s) found")
        except Exception as e:
            print(f"[PTZ] GetPresets failed: {e}")

        try:
            config = ptz_service.GetConfiguration({"PTZConfigurationToken": token})
            if config:
                ptz_info["home_supported"] = True
        except Exception:
            pass

        try:
            nodes = ptz_service.GetNodes()
            if nodes:
                node = nodes[0]
                sup_spaces = getattr(node, 'SupportedPTZSpaces', None)
                if sup_spaces:
                    cont = getattr(sup_spaces, 'ContinuousPanTiltVelocitySpace', None)
                    ptz_info["continuous_move"] = bool(cont)
                    rel = getattr(sup_spaces, 'RelativePanTiltTranslationSpace', None)
                    ptz_info["relative_move"] = bool(rel)
        except Exception as e:
            print(f"[PTZ] GetNodes failed: {e}")

    except Exception as e:
        print(f"[PTZ] PTZ service failed: {e}")

    return ptz_info


def _fetch_event_capabilities(cam) -> dict:
    event_info = {
        "supported":         False,
        "motion_detection":  False,
        "tampering":         False,
        "line_crossing":     False,
        "intrusion":         False,
        "face_detection":    False,
        "audio_detection":   False,
        "topics":            [],
    }

    try:
        event_service = cam.create_events_service()
        try:
            event_service.transport.session.verify = False
        except Exception:
            pass

        props = event_service.GetEventProperties()
        event_info["supported"] = True

        topic_set    = getattr(props, 'TopicSet', None)
        topics_raw   = str(topic_set) if topic_set else ""
        topics_lower = topics_raw.lower()

        event_info["motion_detection"] = any(k in topics_lower for k in [
            "motion", "cellobjectdetection", "motionalarm", "rulealarm"
        ])
        event_info["tampering"] = any(k in topics_lower for k in [
            "tamper", "tampering", "sabotage"
        ])
        event_info["line_crossing"] = any(k in topics_lower for k in [
            "linecrossing", "linecross", "crossing"
        ])
        event_info["intrusion"] = any(k in topics_lower for k in [
            "intrusion", "fielddetection", "regionofinterest"
        ])
        event_info["face_detection"] = any(k in topics_lower for k in [
            "face", "facedetect", "facerecognition"
        ])
        event_info["audio_detection"] = any(k in topics_lower for k in [
            "audio", "audiodetect", "soundalarm"
        ])

        topic_names = re.findall(r'<[^/][^>]*:([A-Za-z]+)\s', topics_raw)
        event_info["topics"] = list(set(topic_names))[:20]

        print(f"[EVENTS] motion={event_info['motion_detection']}, "
              f"tamper={event_info['tampering']}, "
              f"linecross={event_info['line_crossing']}")

    except Exception as e:
        print(f"[EVENTS] GetEventProperties failed: {e}")

    return event_info


def _fetch_audio_info(cam, media_service) -> dict:
    audio_info = {
        "input_supported":  False,
        "output_supported": False,
        "encoding":         None,
        "sample_rate":      None,
        "bitrate":          None,
    }

    try:
        profiles = media_service.GetProfiles()
        if profiles:
            for p in profiles:
                aec = getattr(p, 'AudioEncoderConfiguration', None)
                if aec:
                    audio_info["input_supported"] = True
                    audio_info["encoding"]    = str(getattr(aec, 'Encoding',   '') or '')
                    audio_info["sample_rate"] = _safe_get(aec, 'SampleRate')
                    audio_info["bitrate"]     = _safe_get(aec, 'Bitrate')
                    break

        try:
            sources = media_service.GetAudioSources()
            if sources:
                audio_info["input_supported"] = True
        except Exception:
            pass

        try:
            outputs = media_service.GetAudioOutputs()
            if outputs:
                audio_info["output_supported"] = True
        except Exception:
            pass

        print(f"[AUDIO] input={audio_info['input_supported']}, "
              f"output={audio_info['output_supported']}, "
              f"enc={audio_info['encoding']}")

    except Exception as e:
        print(f"[AUDIO] Audio detection failed: {e}")

    return audio_info


def _fetch_network_info(device_service) -> dict:
    net_info = {
        "dhcp":         None,
        "ip_address":   None,
        "gateway":      None,
        "dns":          [],
        "ntp":          [],
        "hostname":     None,
        "http_port":    80,
        "rtsp_port":    554,
        "https_port":   None,
    }

    try:
        interfaces = device_service.GetNetworkInterfaces()
        if interfaces:
            iface = interfaces[0]
            ipv4  = getattr(iface, 'IPv4', None)
            if ipv4:
                config = getattr(ipv4, 'Config', None)
                if config:
                    net_info["dhcp"] = bool(getattr(config, 'DHCP', False))
                    manual = getattr(config, 'Manual', None)
                    if manual and len(manual) > 0:
                        net_info["ip_address"] = getattr(manual[0], 'Address', None)
    except Exception as e:
        print(f"[NET] GetNetworkInterfaces failed: {e}")

    try:
        gw = device_service.GetNetworkDefaultGateway()
        if gw:
            addrs = getattr(gw, 'IPv4Address', []) or []
            if addrs:
                net_info["gateway"] = str(addrs[0])
    except Exception:
        pass

    try:
        dns = device_service.GetDNS()
        if dns:
            servers = getattr(dns, 'DNSManual', []) or getattr(dns, 'DNSFromDHCP', []) or []
            net_info["dns"] = [str(getattr(s, 'IPv4Address', s)) for s in servers][:3]
    except Exception:
        pass

    try:
        ntp = device_service.GetNTP()
        if ntp:
            servers = getattr(ntp, 'NTPManual', []) or getattr(ntp, 'NTPFromDHCP', []) or []
            net_info["ntp"] = [str(getattr(s, 'IPv4Address', getattr(s, 'DNSname', s))) for s in servers][:3]
    except Exception:
        pass

    try:
        host = device_service.GetHostname()
        if host:
            net_info["hostname"] = str(getattr(host, 'Name', '') or '')
    except Exception:
        pass

    try:
        protocols = device_service.GetServiceCapabilities()
        if protocols:
            net_info["tls_support"] = bool(getattr(protocols, 'TLS1.2', False))
    except Exception:
        pass

    return net_info


def _fetch_io_info(device_service) -> dict:
    io_info = {
        "relay_outputs": [],
        "alarm_inputs":  [],
    }

    try:
        relays = device_service.GetRelayOutputs()
        io_info["relay_outputs"] = [
            {
                "token":      str(getattr(r, 'token', i)),
                "mode":       str(getattr(getattr(r, 'Properties', None), 'Mode', '') or ''),
                "idle_state": str(getattr(getattr(r, 'Properties', None), 'IdleState', '') or ''),
            }
            for i, r in enumerate(relays or [])
        ]
        print(f"[IO] {len(io_info['relay_outputs'])} relay output(s)")
    except Exception as e:
        print(f"[IO] GetRelayOutputs failed: {e}")

    try:
        inputs = device_service.GetDigitalInputs()
        io_info["alarm_inputs"] = [
            {
                "token":      str(getattr(inp, 'token', i)),
                "idle_state": str(getattr(inp, 'IdleState', '') or ''),
            }
            for i, inp in enumerate(inputs or [])
        ]
        print(f"[IO] {len(io_info['alarm_inputs'])} alarm input(s)")
    except Exception as e:
        print(f"[IO] GetDigitalInputs failed: {e}")

    return io_info


def _fetch_analytics_info(cam) -> dict:
    analytics_info = {
        "supported":    False,
        "rule_support": False,
        "modules":      [],
    }

    try:
        analytics_service = cam.create_analyticsdevice_service()
        try:
            analytics_service.transport.session.verify = False
        except Exception:
            pass

        analytics_info["supported"] = True

        try:
            configs = analytics_service.GetAnalyticsEngineConfigurations()
            if configs:
                analytics_info["rule_support"] = True
                analytics_info["modules"] = [
                    str(getattr(c, 'Name', f"Module {i}"))
                    for i, c in enumerate(configs or [])
                ]
        except Exception:
            pass

        print(f"[ANALYTICS] supported=True, modules={analytics_info['modules']}")
    except Exception as e:
        print(f"[ANALYTICS] Analytics service failed: {e}")

    return analytics_info


def _safe_get(obj, attr, default=None):
    try:
        val = getattr(obj, attr, default)
        if val is None:
            return default
        if hasattr(val, '__class__') and 'zeep' in str(type(val)):
            return str(val)
        return val
    except Exception:
        return default


def _classify_event(topic: str) -> str:
    """Classify an event topic string into a standard event type."""
    t = topic.lower()
    if any(k in t for k in ['motion', 'motionalarm', 'cellobject', 'alarm', 'loiter']):
        return 'motion'
    elif any(k in t for k in ['tamper', 'sabotage']):
        return 'tampering'
    elif any(k in t for k in ['linecross', 'crossing']):
        return 'line_crossing'
    elif any(k in t for k in ['intrusion', 'fielddetection', 'field']):
        return 'intrusion'
    elif any(k in t for k in ['face']):
        return 'face_detection'
    elif any(k in t for k in ['audio', 'sound']):
        return 'audio_detection'
    return 'other'


# ─────────────────────────────────────────────────────────────────
# MAIN PROBE FUNCTION
# ─────────────────────────────────────────────────────────────────

def probe_camera(ip: str, port: int, username: str, password: str) -> dict:
    try:
        cam = _make_cam(ip, port, username, password)

        device_service = cam.create_devicemgmt_service()
        try:
            device_service.transport.session.verify = False
        except Exception:
            pass

        info = device_service.GetDeviceInformation()

        model_str        = (getattr(info, 'Model',        '') or '').lower()
        manufacturer_str = (getattr(info, 'Manufacturer', '') or '').lower()
        for kw in _NON_CAMERA_KEYWORDS:
            if kw in model_str or kw in manufacturer_str:
                print(f"[ONVIF] ✗ {ip} — non-camera: '{info.Manufacturer} {info.Model}'")
                return {
                    "success": False,
                    "error":   f"Device appears to be a non-camera ({info.Manufacturer} {info.Model})",
                }

        media_service = cam.create_media_service()
        try:
            media_service.transport.session.verify = False
        except Exception:
            pass

        try:
            video_sources = media_service.GetVideoSources()
            if not video_sources:
                return {"success": False, "error": "No video sources found"}
            print(f"[ONVIF] ✓ {ip} has {len(video_sources)} video source(s)")
        except Exception as vs_err:
            print(f"[ONVIF] ⚠ GetVideoSources failed ({vs_err}), continuing")

        profiles     = media_service.GetProfiles()
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
                    res = enc = fps = bitrate = None

                    if vec:
                        try:    res     = f"{vec.Resolution.Width}x{vec.Resolution.Height}"
                        except: pass
                        try:    enc     = str(vec.Encoding)
                        except: pass
                        try:    fps     = int(vec.RateControl.FrameRateLimit)
                        except: pass
                        try:    bitrate = int(vec.RateControl.BitrateLimit)
                        except: pass

                    label = ["MAIN", "SUB", "EXTRA"][idx] if idx < 3 else f"STREAM {idx+1}"

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
                        "name": p.Name, "token": p.token,
                        "label": f"STREAM {idx+1}", "error": str(e),
                    })

        valid_profiles = [
            p for p in profile_list
            if p.get("rtsp_url") and "rtsp://" in p.get("rtsp_url", "")
        ]
        if not valid_profiles:
            return {"success": False, "error": "No valid RTSP stream URLs found"}

        mac = "—"
        try:
            net_info = device_service.GetNetworkInterfaces()
            if net_info:
                mac = net_info[0].Info.HwAddress
        except Exception:
            pass

        print(f"[ONVIF] Fetching full capabilities for {ip}...")

        top_caps  = _fetch_capabilities(device_service)
        imaging   = _fetch_imaging_settings(cam, media_service)
        ptz_info  = _fetch_ptz_info(cam, media_service)
        events    = _fetch_event_capabilities(cam)
        audio     = _fetch_audio_info(cam, media_service)
        network   = _fetch_network_info(device_service)
        io_info   = _fetch_io_info(device_service)
        analytics = _fetch_analytics_info(cam)

        capabilities = {
            "ptz":       ptz_info.get("supported", False),
            "imaging":   imaging.get("supported", False),
            "events":    events.get("supported", False),
            "analytics": analytics.get("supported", False),
            "io":        top_caps.get("io", False),
            "audio_in":  audio.get("input_supported", False),
            "audio_out": audio.get("output_supported", False),

            "imaging_settings": imaging,
            "ptz_info":         ptz_info,
            "event_info":       events,
            "audio_info":       audio,
            "network_info":     network,
            "io_info":          io_info,
            "analytics_info":   analytics,
        }

        print(f"[ONVIF] ✅ Full probe complete for {ip} "
              f"({info.Manufacturer} {info.Model}) — "
              f"PTZ={ptz_info.get('supported')}, "
              f"Imaging={imaging.get('supported')}, "
              f"Events={events.get('supported')}, "
              f"Audio={audio.get('input_supported')}, "
              f"IO={top_caps.get('io')}, "
              f"Analytics={analytics.get('supported')}")
        api_profile = detect_camera_api(
            ip=ip,
            manufacturer=info.Manufacturer,
            model=info.Model,
            username=username,
            password=password,
        )

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
            "ptz":          "Yes" if ptz_info.get("supported") else "No",
            "capabilities": capabilities,
             "api_profile":  api_profile,
            
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────────────────────────
# LIVE CONTROL ENDPOINTS
# ─────────────────────────────────────────────────────────────────

def set_imaging_setting(ip: str, port: int, username: str, password: str,
                        setting: str, value) -> dict:
    try:
        cam = _make_cam(ip, port, username, password)
        imaging_service = cam.create_imaging_service()
        try:
            imaging_service.transport.session.verify = False
        except Exception:
            pass

        media_service = cam.create_media_service()
        try:
            media_service.transport.session.verify = False
        except Exception:
            pass

        sources = media_service.GetVideoSources()
        if not sources:
            return {"success": False, "error": "No video sources"}

        source_token = sources[0].token
        current = imaging_service.GetImagingSettings({"VideoSourceToken": source_token})

        if setting == "brightness":
            current.Brightness = float(value)
        elif setting == "saturation":
            current.ColorSaturation = float(value)
        elif setting == "sharpness":
            current.Sharpness = float(value)
        elif setting == "ir_cut_filter":
            current.IrCutFilter = str(value)
        elif setting == "wdr":
            if current.WideDynamicRange:
                current.WideDynamicRange.Mode = str(value)
        elif setting == "wdr_level":
            if current.WideDynamicRange:
                current.WideDynamicRange.Level = float(value)
        elif setting == "exposure_mode":
            if current.Exposure:
                current.Exposure.Mode = str(value)
        elif setting == "white_balance":
            if current.WhiteBalance:
                current.WhiteBalance.Mode = str(value)
        elif setting == "backlight_compensation":
            if current.BacklightCompensation:
                current.BacklightCompensation.Mode = str(value)
        else:
            return {"success": False, "error": f"Unknown setting: {setting}"}

        imaging_service.SetImagingSettings({
            "VideoSourceToken": source_token,
            "ImagingSettings":  current,
            "ForcePersistence": True,
        })

        print(f"[IMAGING] ✅ Set {setting}={value} on {ip}")
        return {"success": True, "setting": setting, "value": value}

    except Exception as e:
        print(f"[IMAGING] ❌ Set {setting} failed on {ip}: {e}")
        return {"success": False, "error": str(e)}


def ptz_go_to_preset(ip: str, port: int, username: str, password: str,
                     preset_token: str) -> dict:
    try:
        cam = _make_cam(ip, port, username, password)
        ptz_service   = cam.create_ptz_service()
        media_service = cam.create_media_service()
        try:
            ptz_service.transport.session.verify   = False
            media_service.transport.session.verify = False
        except Exception:
            pass

        profiles = media_service.GetProfiles()
        if not profiles:
            return {"success": False, "error": "No profiles"}

        token = profiles[0].token
        ptz_service.GotoPreset({
            "ProfileToken": token,
            "PresetToken":  preset_token,
            "Speed":        {"PanTilt": {"x": 0.5, "y": 0.5}, "Zoom": {"x": 0.5}},
        })
        return {"success": True, "preset": preset_token}
    except Exception as e:
        return {"success": False, "error": str(e)}


def ptz_set_preset(ip: str, port: int, username: str, password: str,
                   preset_name: str, preset_token: str = None) -> dict:
    try:
        cam = _make_cam(ip, port, username, password)
        ptz_service   = cam.create_ptz_service()
        media_service = cam.create_media_service()
        try:
            ptz_service.transport.session.verify   = False
            media_service.transport.session.verify = False
        except Exception:
            pass

        profiles = media_service.GetProfiles()
        if not profiles:
            return {"success": False, "error": "No profiles"}

        token  = profiles[0].token
        req    = {"ProfileToken": token, "PresetName": preset_name}
        if preset_token:
            req["PresetToken"] = preset_token

        result = ptz_service.SetPreset(req)
        return {"success": True, "preset_token": str(result)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def ptz_go_home(ip: str, port: int, username: str, password: str) -> dict:
    try:
        cam = _make_cam(ip, port, username, password)
        ptz_service   = cam.create_ptz_service()
        media_service = cam.create_media_service()
        try:
            ptz_service.transport.session.verify   = False
            media_service.transport.session.verify = False
        except Exception:
            pass

        profiles = media_service.GetProfiles()
        if not profiles:
            return {"success": False, "error": "No profiles"}

        token = profiles[0].token
        ptz_service.GotoHomePosition({
            "ProfileToken": token,
            "Speed":        {"PanTilt": {"x": 0.5, "y": 0.5}, "Zoom": {"x": 0.5}},
        })
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def trigger_relay(ip: str, port: int, username: str, password: str,
                  relay_token: str, state: str = "Active") -> dict:
    try:
        cam = _make_cam(ip, port, username, password)
        device_service = cam.create_devicemgmt_service()
        try:
            device_service.transport.session.verify = False
        except Exception:
            pass

        device_service.SetRelayOutputState({
            "RelayOutputToken": relay_token,
            "LogicalState":     state,
        })
        return {"success": True, "relay": relay_token, "state": state}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_camera_system_time(ip, port=80, username="", password=""):
    try:
        cam = _make_cam(ip, port, username, password)
        device_service = cam.create_devicemgmt_service()
        try:
            device_service.transport.session.verify = False
        except Exception:
            pass

        sys_time = device_service.GetSystemDateAndTime()
        raw_tz   = getattr(sys_time, 'TimeZone', None)
        tz_info  = _parse_onvif_timezone(raw_tz)
        dt       = None

        if getattr(sys_time, "LocalDateTime", None):
            d  = sys_time.LocalDateTime.Date
            t  = sys_time.LocalDateTime.Time
            dt = _parse_onvif_time(d, t)
            if dt and tz_info:
                dt = dt.replace(tzinfo=tz_info)
        elif getattr(sys_time, "UTCDateTime", None):
            d  = sys_time.UTCDateTime.Date
            t  = sys_time.UTCDateTime.Time
            dt = _parse_onvif_time(d, t)
            if dt:
                dt = dt.replace(tzinfo=timezone.utc)
                dt = dt.astimezone(tz_info) if tz_info else dt.astimezone()

        if dt is None:
            return None
        return dt.replace(tzinfo=None)
    except Exception as e:
        print(f"[ONVIF TIME] Failed: {e}")
        return None


def move_camera_ptz(ip, port, username, password, pan, tilt, zoom):
    try:
        cam = _make_cam(ip, port, username, password)
        ptz_service   = cam.create_ptz_service()
        media_service = cam.create_media_service()
        try:
            ptz_service.transport.session.verify   = False
            media_service.transport.session.verify = False
        except Exception:
            pass

        profiles = media_service.GetProfiles()
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


# ─────────────────────────────────────────────────────────────────
# BRAND-SPECIFIC EVENT FETCHERS
# ─────────────────────────────────────────────────────────────────

def _fetch_bosch_events(ip, username, password) -> list:
    """
    Bosch cameras expose events via their own REST API.
    Supports DINION, FLEXIDOME, AUTODOME series.
    """
    endpoints = [
        f"http://{ip}/api/event/notification/eventlog",
        f"http://{ip}/api/event/notification/alarms",
        f"http://{ip}/cgi-bin/eventrequest.cgi",
    ]
    for url in endpoints:
        try:
            resp = requests.get(
                url,
                auth=(username, password),
                verify=False,
                timeout=5,
            )
            if resp.status_code == 200:
                try:
                    data  = resp.json()
                    items = data if isinstance(data, list) else \
                            data.get("events", data.get("alarms", data.get("items", [])))
                    events = []
                    for item in (items or []):
                        raw_type    = str(item.get("eventType", item.get("type", "")) or "")
                        description = str(item.get("description", item.get("text", "")) or "")
                        combined    = (raw_type + " " + description).lower()
                        event_type  = _classify_event(combined)
                        events.append({
                            "topic":      raw_type or "bosch_event",
                            "event_type": event_type,
                            "utc_time":   str(item.get("timestamp", item.get("time", "")) or ""),
                            "raw":        str(item),
                        })
                    print(f"[BOSCH] {ip} → {len(events)} event(s) via REST ({url})")
                    return events
                except Exception:
                    pass
        except Exception:
            pass
    return []


def _fetch_hikvision_events(ip, username, password) -> list:
    """
    Hikvision cameras support ISAPI event search endpoint.
    Falls back to ONVIF if this fails.
    """
    try:
        url  = f"http://{ip}/ISAPI/Event/notification/alertStream"
        resp = requests.get(
            url,
            auth=(username, password),
            verify=False,
            timeout=5,
            stream=True,
        )
        if resp.status_code == 200:
            # Just check it's reachable — actual streaming handled by ONVIF PullPoint
            print(f"[HIK] {ip} ISAPI alert stream reachable")
        return []
    except Exception:
        return []


def _fetch_dahua_events(ip, username, password) -> list:
    """
    Dahua cameras support event search via their HTTP API.
    """
    try:
        url  = f"http://{ip}/cgi-bin/eventManager.cgi?action=getEventIndexes&code=All"
        resp = requests.get(
            url,
            auth=(username, password),
            verify=False,
            timeout=5,
        )
        if resp.status_code == 200:
            print(f"[DAHUA] {ip} event manager reachable")
        return []
    except Exception:
        return []


# ─────────────────────────────────────────────────────────────────
# MAIN EVENT PULL FUNCTION — supports ALL brands
# ─────────────────────────────────────────────────────────────────

def pull_camera_events(ip, port, username, password, max_messages=50):
    """
    Universal event fetcher. Tries methods in this order:
    1. ONVIF PullPoint  → works for Hikvision, Dahua, Axis, Hanwha, Uniview
    2. Bosch REST API   → works for Bosch DINION, FLEXIDOME, AUTODOME
    3. Silent fallback  → keeps polling alive without crashing
    """
    try:
        cam = _make_cam(ip, port, username, password)

        # ── METHOD 1: ONVIF PullPoint (most cameras) ──────────────
        try:
            events_service = cam.create_events_service()
            events_service.transport.session.verify = False

            # Create pull-point subscription
            sub = events_service.CreatePullPointSubscription({
                'RequestedTerminationTime': 'PT1H',
            })

            pullpoint = cam.create_pullpoint_service()
            pullpoint.transport.session.verify = False

            msgs = pullpoint.PullMessages({
                'MessageLimit': max_messages,
                'Timeout':      'PT5S',
            })

            results = []
            for msg in (getattr(msgs, 'NotificationMessage', []) or []):
                topic    = str(getattr(msg, 'Topic', '') or '')
                message  = getattr(msg, 'Message', None)
                utc_time = str(getattr(message, 'UtcTime', '') or '') if message else ''
                data     = getattr(message, 'Data', None) if message else None

                results.append({
                    "topic":      topic,
                    "event_type": _classify_event(topic),
                    "utc_time":   utc_time,
                    "raw":        str(data or ''),
                })

            print(f"[EVENTS] PullPoint got {len(results)} message(s) from {ip}")
            return {"success": True, "events": results}

        except Exception as pull_err:
            print(f"[EVENTS] PullPoint failed for {ip}: {pull_err} — trying brand-specific APIs")

        # ── METHOD 2: Bosch REST API ──────────────────────────────
        try:
            bosch_events = _fetch_bosch_events(ip, username, password)
            if bosch_events:
                return {"success": True, "events": bosch_events}
            # If reachable but no events yet — still success, keep polling
            resp_check = requests.get(
                f"http://{ip}/api/event/notification/eventlog",
                auth=(username, password),
                verify=False,
                timeout=3,
            )
            if resp_check.status_code in (200, 204, 401, 403):
                # Camera is Bosch-type, just no events right now
                print(f"[BOSCH] {ip} reachable, no events currently")
                return {"success": True, "events": []}
        except Exception:
            pass

        # ── METHOD 3: Silent fallback — keep polling alive ────────
        # Camera uses push-mode or unsupported event method.
        # Return success with empty events so polling loop never crashes.
        print(f"[EVENTS] {ip} — no compatible event method found, polling silently")
        return {"success": True, "events": []}

    except Exception as e:
        print(f"[EVENTS] Fatal error for {ip}: {e}")
        # Still return success=True so polling doesn't give up
        return {"success": True, "events": []}