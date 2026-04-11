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


# ─────────────────────────────────────────────────────────────────
# CAMERA FACTORY
# ─────────────────────────────────────────────────────────────────

def _make_cam(ip, port, username, password):
    """Create ONVIFCamera with SSL verification disabled."""
    wsdl_dir = None
    try:
        import onvif
        wsdl_dir = os.path.join(os.path.dirname(onvif.__file__), 'wsdl')
    except Exception:
        pass

    # AXIS cameras enforce HTTPS — detect via HSTS header and switch port 80 → 443
    if port == 80:
        try:
            _test = requests.get(
                f'http://{ip}/', verify=False, timeout=3, allow_redirects=False
            )
            if ('Strict-Transport-Security' in _test.headers or
                    _test.status_code in (301, 302, 307, 308)):
                print(f"[CAM] {ip} enforces HTTPS — switching port 80 → 443")
                port = 443
        except Exception:
            pass

    try:
        if wsdl_dir and os.path.exists(wsdl_dir):
            cam = ONVIFCamera(ip, port, username, password, wsdl_dir)
        else:
            cam = ONVIFCamera(ip, port, username, password)
    except Exception:
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


# ─────────────────────────────────────────────────────────────────
# TIME / TIMEZONE HELPERS
# ─────────────────────────────────────────────────────────────────

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
# AXIS DIGEST AUTH FALLBACK
# Used when standard WSSE token auth returns "Unknown fault occurred"
# AXIS cameras support HTTP Digest auth on their ONVIF endpoints
# ─────────────────────────────────────────────────────────────────

def _probe_axis_fallback(ip: str, port: int, username: str, password: str) -> dict:
    """
    AXIS cameras often reject WSSE/UsernameToken auth and require HTTP Digest.
    This fallback sends raw SOAP requests with HTTPDigestAuth directly.
    Handles: AXIS P, Q, M, T series and all ARTPEC-based cameras.
    """
    from requests.auth import HTTPDigestAuth
    import xml.etree.ElementTree as ET

    DEVICE_NS = "http://www.onvif.org/ver10/device/wsdl"
    MEDIA_NS  = "http://www.onvif.org/ver10/media/wsdl"
    SCHEMA_NS = "http://www.onvif.org/ver10/schema"

    auth = HTTPDigestAuth(username, password)
    from urllib.parse import urlparse

    print(f"[AXIS] Trying HTTP Digest fallback for {ip}:{port} ...")

    # ── Auto-detect HTTP vs HTTPS and correct port ────────────────
    # AXIS cameras with newer firmware redirect HTTP → HTTPS (302).
    # We try all combinations to find what works.
    if port == 443:
        schemes_ports = [("https", 443)]
    elif port == 80:
        # AXIS blocks POST on HTTP entirely — go straight to HTTPS 443
        schemes_ports = [("https", 443)]
    else:
        schemes_ports = [("https", port), ("https", 443), ("http", port)]

    headers_variants = [
        {"Content-Type": "text/xml; charset=utf-8"},
        {"Content-Type": "application/soap+xml; charset=utf-8"},
    ]
    device_paths = [
        "/onvif/device_service",
        "/onvif/services",
        "/onvif/devicemgmt",
        "/onvif/device",
    ]

    get_time_body = """<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body><tds:GetSystemDateAndTime/></s:Body>
</s:Envelope>"""

    working_headers     = None
    working_device_path = None
    base                = None

    for scheme, try_port in schemes_ports:
        if working_headers:
            break
        try_base = f"{scheme}://{ip}:{try_port}"
        for h in headers_variants:
            if working_headers:
                break
            for path in device_paths:
                try:
                    r = requests.post(
                        f"{try_base}{path}", data=get_time_body,
                        headers={**h, "SOAPAction": '"http://www.onvif.org/ver10/device/wsdl/GetSystemDateAndTime"'},
                        auth=auth,
                        verify=False,
                        timeout=5,
                        allow_redirects=False,
                    )
                    print(f"[AXIS] {try_base}{path} ({h['Content-Type'].split(';')[0]}) → HTTP {r.status_code}")

                    # Handle HTTP→HTTPS redirect explicitly
                    if r.status_code in (301, 302, 307, 308):
                        location = r.headers.get("Location", "")
                        print(f"[AXIS] Redirect → {location}")
                        if location.startswith("https://"):
                            r2 = requests.post(
                                location, data=get_time_body,
                                headers={**h, "SOAPAction": '"http://www.onvif.org/ver10/device/wsdl/GetSystemDateAndTime"'},
                                auth=auth, verify=False, timeout=5,
                            )
                            print(f"[AXIS] After redirect → HTTP {r2.status_code}")
                            if r2.status_code in (200, 400, 401):
                                parsed = urlparse(location)
                                base                = f"{parsed.scheme}://{parsed.netloc}"
                                working_device_path = parsed.path
                                working_headers     = h
                                print(f"[AXIS] ✅ HTTPS redirect: {base}{working_device_path}")
                                break
                        continue

                    if r.status_code in (200, 400, 401):
                        base                = try_base
                        working_device_path = path
                        working_headers     = h
                        print(f"[AXIS] ✅ Device endpoint: {try_base}{path}")
                        break
                except Exception as e:
                    print(f"[AXIS] {try_base}{path} failed: {e}")

    if not working_headers or not base:
        return {"success": False, "error": "AXIS ONVIF not reachable — tried HTTP/HTTPS on all paths"}

    headers = working_headers

    # ── Step 1: GetDeviceInformation ──────────────────────────────
    get_info_body = """<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body><tds:GetDeviceInformation/></s:Body>
</s:Envelope>"""

    info_headers = {**headers, "SOAPAction": '"http://www.onvif.org/ver10/device/wsdl/GetDeviceInformation"'}
    manufacturer = "Axis"
    model        = "Unknown"
    firmware     = ""
    serial       = ""

    try:
        resp = requests.post(
            f"{base}{working_device_path}",
            data=get_info_body,
            headers=info_headers,
            auth=auth,
            verify=False,
            timeout=10,
        )
        print(f"[AXIS] GetDeviceInformation → HTTP {resp.status_code}")

        if resp.status_code == 401:
            return {"success": False, "error": "AXIS authentication failed — check username/password"}
            return {"success": False, "error": "AXIS authentication failed — check username/password"}
        if resp.status_code not in (200, 201):
            return {"success": False, "error": f"AXIS ONVIF returned HTTP {resp.status_code}"}

        root         = ET.fromstring(resp.text)
        manufacturer = root.findtext(f".//{{{DEVICE_NS}}}Manufacturer") or "Axis"
        model        = root.findtext(f".//{{{DEVICE_NS}}}Model")        or "Unknown"
        firmware     = root.findtext(f".//{{{DEVICE_NS}}}FirmwareVersion") or ""
        serial       = root.findtext(f".//{{{DEVICE_NS}}}SerialNumber")    or ""
        print(f"[AXIS] ✅ Device: {manufacturer} {model} fw={firmware}")

    except ET.ParseError as e:
        print(f"[AXIS] XML parse error on GetDeviceInformation: {e}")
        return {"success": False, "error": f"AXIS returned invalid XML: {e}"}
    except Exception as e:
        return {"success": False, "error": f"AXIS SOAP request failed: {e}"}

    # ── Step 2: Discover working media endpoint ───────────────────
    media_paths = ["/onvif/media_service", "/onvif/media", "/onvif/services"]
    working_media_path = None
    probe_body = """<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
  <s:Body><trt:GetProfiles/></s:Body>
</s:Envelope>"""
    for mpath in media_paths:
        try:
            tr = requests.post(
                f"{base}{mpath}", data=probe_body,
                headers={**headers, "SOAPAction": '"http://www.onvif.org/ver10/media/wsdl/GetProfiles"'},
                verify=False, timeout=4,
            )
            print(f"[AXIS] Media probe {mpath} → HTTP {tr.status_code}")
            if tr.status_code in (200, 400, 401):
                working_media_path = mpath
                print(f"[AXIS] ✅ Media endpoint: {mpath}")
                break
        except Exception as me:
            print(f"[AXIS] Media probe {mpath} failed: {me}")

    if not working_media_path:
        working_media_path = "/onvif/media_service"
        print(f"[AXIS] ⚠ No media endpoint responded — defaulting to {working_media_path}")

    # ── Step 3: GetProfiles ───────────────────────────────────────
    get_profiles_body = """<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
  <s:Body><trt:GetProfiles/></s:Body>
</s:Envelope>"""

    profile_list = []
    stream_uri   = None

    try:
        profiles_headers = {**headers, "SOAPAction": '"http://www.onvif.org/ver10/media/wsdl/GetProfiles"'}
        resp2 = requests.post(
            f"{base}{working_media_path}",
            data=get_profiles_body,
            headers=profiles_headers,
            auth=auth,
            verify=False,
            timeout=10,
        )
        print(f"[AXIS] GetProfiles → HTTP {resp2.status_code}")

        root2 = ET.fromstring(resp2.text)

        # Try multiple namespace variants that AXIS uses
        all_profiles = (
            root2.findall(f".//{{{SCHEMA_NS}}}Profiles") or
            root2.findall(f".//{{{MEDIA_NS}}}Profiles")  or
            root2.findall(".//{*}Profiles")
        )
        print(f"[AXIS] Found {len(all_profiles)} profile(s)")

        for idx, p in enumerate(all_profiles):
            token = p.get("token", f"profile_{idx}")
            name  = (
                p.findtext(f"{{{SCHEMA_NS}}}Name") or
                p.findtext(f"{{{MEDIA_NS}}}Name")  or
                f"Profile {idx}"
            )

            # ── Step 4: GetStreamUri per profile ─────────────────
            get_uri_body = f"""<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
            xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
    <trt:GetStreamUri>
      <trt:StreamSetup>
        <tt:Stream>RTP-Unicast</tt:Stream>
        <tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>
      </trt:StreamSetup>
      <trt:ProfileToken>{token}</trt:ProfileToken>
    </trt:GetStreamUri>
  </s:Body>
</s:Envelope>"""

            rtsp_url = None
            try:
                uri_headers = {**headers, "SOAPAction": '"http://www.onvif.org/ver10/media/wsdl/GetStreamUri"'}
                resp3    = requests.post(
                    f"{base}{working_media_path}",
                    data=get_uri_body,
                    headers=uri_headers,
                    auth=auth,
                    verify=False,
                    timeout=10,
                )
                uri_root = ET.fromstring(resp3.text)
                rtsp_url = (
                    uri_root.findtext(f".//{{{SCHEMA_NS}}}Uri") or
                    uri_root.findtext(f".//{{{MEDIA_NS}}}Uri")  or
                    uri_root.findtext(".//{*}Uri")
                )
                if rtsp_url and idx == 0:
                    stream_uri = rtsp_url
                print(f"[AXIS] Profile '{token}' → {rtsp_url}")
            except Exception as e:
                print(f"[AXIS] GetStreamUri failed for profile '{token}': {e}")

            label = ["MAIN", "SUB", "EXTRA"][idx] if idx < 3 else f"STREAM {idx+1}"
            profile_list.append({
                "name":     name,
                "token":    token,
                "label":    label,
                "rtsp_url": rtsp_url or "",
            })

    except Exception as e:
        print(f"[AXIS] GetProfiles failed: {e} — using AXIS default RTSP path")

    # ── Fallback: use AXIS default RTSP path if no profiles found ─
    if not stream_uri:
        stream_uri = f"rtsp://{ip}/axis-media/media.amp"
        print(f"[AXIS] No stream URI from ONVIF — using default: {stream_uri}")

    if not profile_list:
        profile_list = [{
            "name":     "Main Stream",
            "token":    "profile_1_h264",
            "label":    "MAIN",
            "rtsp_url": stream_uri,
        }]

    valid_profiles = [
        p for p in profile_list
        if p.get("rtsp_url") and "rtsp://" in p.get("rtsp_url", "")
    ]
    if not valid_profiles:
        valid_profiles = profile_list

    # ── Step 5: Get MAC address ───────────────────────────────────
    mac = "—"
    get_interfaces_body = """<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body><tds:GetNetworkInterfaces/></s:Body>
</s:Envelope>"""
    try:
        mac_headers = {**headers, "SOAPAction": '"http://www.onvif.org/ver10/device/wsdl/GetNetworkInterfaces"'}
        resp_mac = requests.post(
            f"{base}{working_device_path}",
            data=get_interfaces_body,
            headers=mac_headers,
            auth=auth,
            verify=False,
            timeout=5,
        )
        mac_root = ET.fromstring(resp_mac.text)
        hw_addr  = mac_root.findtext(".//{*}HwAddress")
        if hw_addr:
            mac = hw_addr.strip()
    except Exception:
        pass

    # ── Step 5: Try to detect full capabilities via ONVIF ─────────
    caps = {
        "ptz": False, "imaging": False, "events": False,
        "analytics": False, "io": False,
        "audio_in": False, "audio_out": False,
    }
    try:
        get_caps_body = """<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body>
    <tds:GetCapabilities>
      <tds:Category>All</tds:Category>
    </tds:GetCapabilities>
  </s:Body>
</s:Envelope>"""
        caps_headers = {**headers, "SOAPAction": '"http://www.onvif.org/ver10/device/wsdl/GetCapabilities"'}
        resp_caps = requests.post(
            f"{base}{working_device_path}",
            data=get_caps_body,
            headers=caps_headers,
            auth=auth,
            verify=False,
            timeout=5,
        )
        caps_root = ET.fromstring(resp_caps.text)
        caps_text = resp_caps.text.lower()
        caps["ptz"]      = "ptz" in caps_text and "<tt:ptz" in caps_text.replace(" ", "")
        caps["imaging"]  = "imaging" in caps_text
        caps["events"]   = "events" in caps_text
        caps["audio_in"] = "audio" in caps_text
        caps["io"]       = "io" in caps_text and ("relay" in caps_text or "input" in caps_text)
        print(f"[AXIS] Capabilities: {caps}")
    except Exception as e:
        print(f"[AXIS] GetCapabilities failed (non-fatal): {e}")

    # ── Try api_profile detection ─────────────────────────────────
    api_profile = None
    try:
        api_profile = detect_camera_api(
            ip=ip,
            manufacturer=manufacturer,
            model=model,
            username=username,
            password=password,
        )
    except Exception as e:
        print(f"[AXIS] detect_camera_api failed (non-fatal): {e}")

    print(f"[AXIS] ✅ Fallback probe complete: {manufacturer} {model}, "
          f"{len(valid_profiles)} stream(s), uri={stream_uri}")

    return {
        "success":      True,
        "manufacturer": manufacturer,
        "model":        model,
        "firmware":     firmware,
        "serial":       serial,
        "mac":          mac,
        "stream_uri":   stream_uri,
        "profiles":     profile_list,
        "stream_count": len(profile_list),
        "ptz":          "Yes" if caps.get("ptz") else "No",
        "capabilities": {
            "ptz":       caps.get("ptz", False),
            "imaging":   caps.get("imaging", False),
            "events":    caps.get("events", False),
            "analytics": caps.get("analytics", False),
            "io":        caps.get("io", False),
            "audio_in":  caps.get("audio_in", False),
            "audio_out": caps.get("audio_out", False),
            "imaging_settings": {"supported": False},
            "ptz_info":         {"supported": False, "presets": []},
            "event_info":       {"supported": False},
            "audio_info":       {"input_supported": caps.get("audio_in", False), "output_supported": False},
            "network_info":     {},
            "io_info":          {"relay_outputs": [], "alarm_inputs": []},
            "analytics_info":   {"supported": False},
        },
        "api_profile": api_profile,
    }


# ─────────────────────────────────────────────────────────────────
# MAIN PROBE FUNCTION
# ─────────────────────────────────────────────────────────────────

def probe_camera(ip: str, port: int, username: str, password: str) -> dict:
    try:
        # AXIS cameras block all ONVIF on HTTP — detect HSTS and go direct to HTTPS fallback
        if port == 80:
            try:
                _hsts_test = requests.get(
                    f'http://{ip}/', verify=False, timeout=3, allow_redirects=False
                )
                if ('Strict-Transport-Security' in _hsts_test.headers or
                        _hsts_test.status_code in (301, 302, 307, 308)):
                    print(f"[ONVIF] {ip} has HSTS/redirect — routing directly to AXIS HTTPS fallback")
                    return _probe_axis_fallback(ip, 443, username, password)
            except Exception:
                pass

        cam = _make_cam(ip, port, username, password)

        device_service = cam.create_devicemgmt_service()
        try:
            device_service.transport.session.verify = False
        except Exception:
            pass

        # ── AXIS / WSSE auth check ────────────────────────────────
        # Try GetSystemDateAndTime first — it's lightweight and reveals auth failures
        # before we attempt the heavier GetDeviceInformation call.
        # AXIS cameras return "Unknown fault occurred" or "Sender" fault on bad WSSE auth.
        try:
            device_service.GetSystemDateAndTime()
        except Exception as time_err:
            err_str = str(time_err).lower()
            if any(k in err_str for k in [
                "unknown fault", "sender", "unauthorized",
                "authentication", "actionnotauthorized", "notauthorized",
            ]):
                print(f"[ONVIF] Auth fault detected for {ip} ({time_err}) "
                      f"— switching to AXIS Digest fallback")
                return _probe_axis_fallback(ip, port, username, password)
            # Other errors (timeout, network) — continue and let GetDeviceInformation fail naturally

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
        err_str = str(e).lower()
        # Last-resort catch — if any unhandled exception looks like AXIS auth, try fallback
        if any(k in err_str for k in [
            "unknown fault", "sender", "unauthorized",
            "authentication", "actionnotauthorized",
        ]):
            print(f"[ONVIF] Unhandled auth exception for {ip}: {e} — trying AXIS fallback")
            return _probe_axis_fallback(ip, port, username, password)
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
            resp_check = requests.get(
                f"http://{ip}/api/event/notification/eventlog",
                auth=(username, password),
                verify=False,
                timeout=3,
            )
            if resp_check.status_code in (200, 204, 401, 403):
                print(f"[BOSCH] {ip} reachable, no events currently")
                return {"success": True, "events": []}
        except Exception:
            pass

        # ── METHOD 3: Silent fallback ─────────────────────────────
        print(f"[EVENTS] {ip} — no compatible event method found, polling silently")
        return {"success": True, "events": []}

    except Exception as e:
        print(f"[EVENTS] Fatal error for {ip}: {e}")
        return {"success": True, "events": []}