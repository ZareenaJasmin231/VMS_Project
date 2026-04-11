"""
camera_api_detector.py
─────────────────────────────────────────────────────────────────
Dynamic camera API detection for MIRADORAI VMS.

How it works:
  1. After ONVIF probe gives us manufacturer + model, we call detect_camera_api()
  2. It probes HTTP endpoints silently (no hardcoded brand checks in main code)
  3. Returns an api_profile dict that gets saved to MongoDB cameras collection
  4. CameraFeaturesPage reads api_profile and renders brand-specific features

Supported brands (auto-detected, not hardcoded in caller):
  - Hikvision  (ISAPI)
  - Dahua      (CGI / RPC2)
  - Axis       (VAPIX)
  - Bosch      (REST)
  - Uniview    (UNIVIEW API)
  - Hanwha     (SUNAPI)
  - Reolink    (CGI)
  - Generic    (basic ONVIF-only fallback)
"""

import requests
import urllib3
from requests.auth import HTTPDigestAuth, HTTPBasicAuth
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ─────────────────────────────────────────────────────────────────
# Brand fingerprint definitions
# Each entry: probe a specific URL, check for expected content/status
# This is the ONLY place brand knowledge lives — callers stay generic
# ─────────────────────────────────────────────────────────────────

BRAND_PROBES = {
    "hikvision": {
        "display_name": "Hikvision",
        "probes": [
            {"url": "/ISAPI/System/deviceInfo",        "expect_any": ["DeviceInfo", "deviceName", "model"]},
            {"url": "/ISAPI/System/status",             "expect_any": ["DeviceStatus"]},
        ],
        "auth": "digest",            # Hikvision requires Digest auth
        "ports": [80, 443, 8000],
        "endpoints": {
            # System
            "device_info":      "/ISAPI/System/deviceInfo",
            "device_status":    "/ISAPI/System/status",
            "reboot":           "/ISAPI/System/reboot",
            # Streaming
            "snapshot":         "/ISAPI/Streaming/channels/{channel}01/picture",
            "stream_caps":      "/ISAPI/Streaming/channels",
            "video_inputs":     "/ISAPI/System/Video/inputs/channels",
            # Events
            "event_caps":       "/ISAPI/Event/capabilities",
            "alert_stream":     "/ISAPI/Event/notification/alertStream",
            "motion_detect":    "/ISAPI/System/Video/inputs/channels/{channel}/motionDetection",
            "line_crossing":    "/ISAPI/Smart/LineDetection/{channel}",
            "intrusion":        "/ISAPI/Smart/FieldDetection/{channel}",
            "face_detect":      "/ISAPI/Smart/FaceDetect/{channel}",
            # PTZ
            "ptz_status":       "/ISAPI/PTZCtrl/channels/{channel}/status",
            "ptz_continuous":   "/ISAPI/PTZCtrl/channels/{channel}/continuous",
            "ptz_preset_list":  "/ISAPI/PTZCtrl/channels/{channel}/presets",
            "ptz_goto_preset":  "/ISAPI/PTZCtrl/channels/{channel}/presets/{preset}/goto",
            # Audio
            "audio_channels":   "/ISAPI/System/Audio/inputs/channels",
            # Storage
            "storage_status":   "/ISAPI/ContentMgmt/storage",
            "recording_status": "/ISAPI/ContentMgmt/record/status",
            # Smart / AI
            "ai_config":        "/ISAPI/Smart/capabilities",
            "heat_map":         "/ISAPI/Smart/HeatMap/{channel}",
            "crowd_density":    "/ISAPI/Smart/PeopleCounting/{channel}",
        },
        "features": {
            "smart_events":     True,
            "ai_analytics":     True,
            "isapi":            True,
            "snapshot_url":     True,
        },
    },

    "dahua": {
        "display_name": "Dahua",
        "probes": [
            {"url": "/cgi-bin/magicBox.cgi?action=getDeviceType",  "expect_any": ["DeviceType", "OK"]},
            {"url": "/cgi-bin/configManager.cgi?action=getConfig&name=General", "expect_any": ["table", "General"]},
            {"url": "/RPC2",                                        "expect_any": ["error", "result"], "method": "POST",
             "json": {"method": "global.login", "params": {}, "id": 1}},
        ],
        "auth": "digest",
        "ports": [80, 443, 37777],
        "endpoints": {
            # System
            "device_info":      "/cgi-bin/magicBox.cgi?action=getDeviceType",
            "software_version": "/cgi-bin/magicBox.cgi?action=getSoftwareVersion",
            "reboot":           "/cgi-bin/magicBox.cgi?action=reboot",
            # Streaming / snapshot
            "snapshot":         "/cgi-bin/snapshot.cgi?channel={channel}",
            "stream_caps":      "/cgi-bin/configManager.cgi?action=getConfig&name=Encode",
            # Events
            "event_manager":    "/cgi-bin/eventManager.cgi?action=getEventIndexes&code=All",
            "motion_detect":    "/cgi-bin/configManager.cgi?action=getConfig&name=MotionDetect",
            "smart_motion":     "/cgi-bin/configManager.cgi?action=getConfig&name=SmartMotionDetect",
            "line_crossing":    "/cgi-bin/configManager.cgi?action=getConfig&name=CrossLineDetection",
            "intrusion":        "/cgi-bin/configManager.cgi?action=getConfig&name=CrossRegionDetection",
            "face_detect":      "/cgi-bin/configManager.cgi?action=getConfig&name=FaceDetect",
            # PTZ
            "ptz_status":       "/cgi-bin/ptz.cgi?action=getStatus",
            "ptz_move":         "/cgi-bin/ptz.cgi?action=start&channel={channel}&code={code}&arg1={arg1}&arg2={arg2}&arg3={arg3}",
            "ptz_stop":         "/cgi-bin/ptz.cgi?action=stop&channel={channel}&code={code}&arg1=0&arg2=0&arg3=0",
            "ptz_preset_list":  "/cgi-bin/configManager.cgi?action=getConfig&name=PresetList",
            # Audio
            "audio_in_config":  "/cgi-bin/configManager.cgi?action=getConfig&name=AudioInput",
            # Storage
            "storage_info":     "/cgi-bin/storageDevice.cgi?action=getDeviceAllInfo",
            # AI / Smart
            "ai_config":        "/cgi-bin/configManager.cgi?action=getConfig&name=SmartPlan",
            "people_count":     "/cgi-bin/VideoStatServer.cgi?action=getReport&startTime={start}&endTime={end}&type=People",
        },
        "features": {
            "smart_events":     True,
            "ai_analytics":     True,
            "cgi_api":          True,
            "rpc2":             True,
            "snapshot_url":     True,
        },
    },

    "axis": {
        "display_name": "Axis",
        "probes": [
            {"url": "/axis-cgi/basicdeviceinfo.cgi",   "expect_any": ["data", "propertyList", "Axis"]},
            {"url": "/axis-cgi/param.cgi?action=list&group=root.Brand", "expect_any": ["Brand", "Axis"]},
        ],
        "auth": "basic",
        "ports": [80, 443],
        "endpoints": {
            # System
            "device_info":      "/axis-cgi/basicdeviceinfo.cgi",
            "param_list":       "/axis-cgi/param.cgi?action=list",
            "firmware_version": "/axis-cgi/param.cgi?action=list&group=root.Properties.Firmware",
            # Streaming / snapshot
            "snapshot":         "/axis-cgi/jpg/image.cgi",
            "stream_caps":      "/axis-cgi/param.cgi?action=list&group=root.StreamProfile",
            # Events
            "event_instances":  "/vapix/services",
            "motion_detect":    "/axis-cgi/motion/listprofiles.cgi",
            # PTZ
            "ptz_caps":         "/axis-cgi/com/ptz.cgi?info=1",
            "ptz_move":         "/axis-cgi/com/ptz.cgi?pan={pan}&tilt={tilt}&zoom={zoom}",
            "ptz_preset_list":  "/axis-cgi/com/ptz.cgi?query=presetposall",
            "ptz_goto_preset":  "/axis-cgi/com/ptz.cgi?gotoserverpresetno={preset}",
            # Audio
            "audio_config":     "/axis-cgi/param.cgi?action=list&group=root.AudioSource",
            # Storage
            "storage_info":     "/axis-cgi/disks/properties/list.cgi",
            # ACAP apps
            "applications":     "/axis-cgi/applications/list.cgi",
        },
        "features": {
            "vapix":            True,
            "acap_apps":        True,
            "snapshot_url":     True,
        },
    },

    "bosch": {
        "display_name": "Bosch",
        "probes": [
            {"url": "/api/version",                     "expect_any": ["apiVersion", "version"]},
            {"url": "/rcp.xml?command=0x0999",          "expect_any": ["rcp", "data", "200"]},
        ],
        "auth": "digest",
        "ports": [80, 443],
        "endpoints": {
            # System
            "device_info":      "/api/deviceinfo",
            "api_version":      "/api/version",
            # Events
            "event_log":        "/api/event/notification/eventlog",
            "alarm_list":       "/api/event/notification/alarms",
            "event_caps":       "/api/event/support",
            # Streaming / snapshot
            "snapshot":         "/snap.jpg",
            "stream_profiles":  "/api/video/encoder",
            # PTZ
            "ptz_caps":         "/api/ptz/support",
            "ptz_position":     "/api/ptz/position",
            "ptz_move":         "/api/ptz/move",
            "ptz_preset_list":  "/api/ptz/positions/presets",
            # Audio
            "audio_config":     "/api/audio/encoder",
            # AI / IVA
            "iva_config":       "/api/iva/config",
            "iva_tasks":        "/api/iva/tasks",
        },
        "features": {
            "rest_api":         True,
            "iva":              True,
            "snapshot_url":     True,
        },
    },

    "uniview": {
        "display_name": "Uniview",
        "probes": [
            {"url": "/LAPI/V1.0/System/DeviceBasicInfo", "expect_any": ["DeviceName", "Model", "ResponseURL"]},
        ],
        "auth": "digest",
        "ports": [80, 443],
        "endpoints": {
            "device_info":      "/LAPI/V1.0/System/DeviceBasicInfo",
            "snapshot":         "/LAPI/V1.0/Channels/{channel}/Media/Video/Streams/SnapShot",
            "event_caps":       "/LAPI/V1.0/Channels/{channel}/Alarm/MotionDetection",
            "line_crossing":    "/LAPI/V1.0/Channels/{channel}/Intelligent/Detection/LineCrossing",
            "intrusion":        "/LAPI/V1.0/Channels/{channel}/Intelligent/Detection/RegionEntrance",
            "ptz_caps":         "/LAPI/V1.0/Channels/{channel}/PTZ/Status",
            "ptz_move":         "/LAPI/V1.0/Channels/{channel}/PTZ/ContinuousMove",
            "ptz_preset_list":  "/LAPI/V1.0/Channels/{channel}/PTZ/Presets",
        },
        "features": {
            "lapi":             True,
            "smart_events":     True,
            "snapshot_url":     True,
        },
    },

    "hanwha": {
        "display_name": "Hanwha / Samsung",
        "probes": [
            {"url": "/stw-cgi/system.cgi?msubmenu=deviceinfo&action=view", "expect_any": ["Model", "DeviceName", "Response"]},
        ],
        "auth": "digest",
        "ports": [80, 443],
        "endpoints": {
            "device_info":      "/stw-cgi/system.cgi?msubmenu=deviceinfo&action=view",
            "snapshot":         "/stw-cgi/video.cgi?msubmenu=snapshot&action=view&Channel={channel}",
            "event_caps":       "/stw-cgi/eventalarm.cgi?msubmenu=capability&action=view",
            "motion_detect":    "/stw-cgi/eventalarm.cgi?msubmenu=videoanalysis&action=view",
            "ptz_caps":         "/stw-cgi/ptz.cgi?msubmenu=capability&action=view",
            "ptz_move":         "/stw-cgi/ptz.cgi?msubmenu=move&action=control",
        },
        "features": {
            "sunapi":           True,
            "snapshot_url":     True,
        },
    },

    "reolink": {
        "display_name": "Reolink",
        "probes": [
            {"url": "/api.cgi?cmd=GetDevInfo",          "expect_any": ["devInfo", "rspCode"], "method": "POST",
             "json": [{"cmd": "GetDevInfo", "action": 0, "param": {}}]},
        ],
        "auth": "none",             # Reolink uses token auth in POST body
        "ports": [80, 443, 8080],
        "endpoints": {
            "device_info":      "/api.cgi?cmd=GetDevInfo",
            "snapshot":         "/cgi-bin/api.cgi?cmd=Snap&channel={channel}&rs=xxx&user={user}&password={password}",
            "motion_detect":    "/api.cgi?cmd=GetMdState",
            "ai_detect":        "/api.cgi?cmd=GetAiState",
            "ptz_caps":         "/api.cgi?cmd=GetPtzSerial",
            "ptz_move":         "/api.cgi?cmd=PtzCtrl",
        },
        "features": {
            "cgi_api":          True,
            "ai_analytics":     True,
            "snapshot_url":     True,
        },
    },
}

# Manufacturer string → brand key mapping
# This maps what ONVIF returns to which BRAND_PROBES entry to try FIRST
# Even if this mapping fails, we still probe ALL brands as fallback
MANUFACTURER_HINTS = {
    "hikvision":    "hikvision",
    "hikvisio":     "hikvision",
    "hik":          "hikvision",
    "dahua":        "dahua",
    "zhejiang":     "dahua",
    "axis":         "axis",
    "axis comm":    "axis",
    "bosch":        "bosch",
    "bosch security": "bosch",
    "uniview":      "uniview",
    "uni":          "uniview",
    "hanwha":       "hanwha",
    "samsung":      "hanwha",
    "wisenet":      "hanwha",
    "reolink":      "reolink",
}


# ─────────────────────────────────────────────────────────────────
# CORE DETECTION
# ─────────────────────────────────────────────────────────────────

def _try_auth(url: str, username: str, password: str, auth_type: str,
              method: str = "GET", json_body=None, timeout: int = 4):
    """
    Try a single HTTP request with the given auth type.
    Returns (response, auth_type_used) or (None, None).
    """
    auth_methods = []
    if auth_type == "digest":
        auth_methods = [
            ("digest", HTTPDigestAuth(username, password)),
            ("basic",  HTTPBasicAuth(username, password)),
        ]
    elif auth_type == "basic":
        auth_methods = [
            ("basic",  HTTPBasicAuth(username, password)),
            ("digest", HTTPDigestAuth(username, password)),
        ]
    else:
        auth_methods = [
            ("basic",  HTTPBasicAuth(username, password)),
            ("digest", HTTPDigestAuth(username, password)),
            ("none",   None),
        ]

    for auth_name, auth_obj in auth_methods:
        try:
            kwargs = dict(auth=auth_obj, verify=False, timeout=timeout)
            if method == "POST":
                kwargs["json"] = json_body
                r = _session.post(url, **kwargs)
            else:
                r = _session.get(url, **kwargs)

            if r.status_code in (200, 201, 206):
                return r, auth_name
            if r.status_code in (401, 403):
                continue   # try next auth method
        except Exception:
            pass
    return None, None


_session = requests.Session()
_session.verify = False


def _probe_brand(ip: str, port: int, brand_key: str, brand_def: dict,
                 username: str, password: str) -> Optional[dict]:
    """
    Try all probe URLs for a brand. Returns confirmed api_profile or None.
    """
    scheme = "https" if port == 443 else "http"
    base   = f"{scheme}://{ip}:{port}"

    for probe in brand_def["probes"]:
        url    = base + probe["url"]
        method = probe.get("method", "GET")
        json_b = probe.get("json")
        expect = probe.get("expect_any", [])

        resp, auth_used = _try_auth(
            url, username, password,
            brand_def["auth"],
            method=method,
            json_body=json_b,
        )

        if resp is None:
            continue

        body = resp.text
        if expect and not any(e.lower() in body.lower() for e in expect):
            continue  # got a 200 but wrong content (e.g. login page)

        # ✅ Brand confirmed
        print(f"[API_DETECT] ✅ {ip} → {brand_def['display_name']} "
              f"confirmed via {probe['url']} (auth={auth_used})")

        return {
            "brand":          brand_key,
            "display_name":   brand_def["display_name"],
            "auth_method":    auth_used,
            "port":           port,
            "scheme":         scheme,
            "base_url":       base,
            "endpoints":      brand_def["endpoints"],
            "features":       brand_def["features"],
            "confirmed":      True,
            "probe_url":      probe["url"],
        }

    return None


def _scan_ports(ip: str, candidate_ports: list[int]) -> list[int]:
    """Quick TCP check to find open HTTP ports."""
    import socket
    open_ports = []
    for port in candidate_ports:
        try:
            with socket.create_connection((ip, port), timeout=1):
                open_ports.append(port)
        except Exception:
            pass
    return open_ports


def detect_camera_api(
    ip: str,
    manufacturer: str = "",
    model: str = "",
    username: str = "",
    password: str = "",
    timeout: int = 5,
) -> dict:
    """
    Main entry point. Call this after ONVIF probe.

    Returns api_profile dict — always returns something
    (falls back to generic ONVIF-only if nothing detected).

    Usage:
        api_profile = detect_camera_api(
            ip="192.168.1.64",
            manufacturer="Hikvision",
            model="DS-2CD2143G2-I",
            username="admin",
            password="Admin123",
        )
        # Save to MongoDB: cameras_col.update_one({"ip": ip}, {"$set": {"api_profile": api_profile}})
    """
    print(f"[API_DETECT] Starting detection for {ip} ({manufacturer} {model})")

    # Step 1: Build ordered list of brands to try
    # Manufacturer hint → try that brand first, then all others
    mfr_lower  = manufacturer.lower().strip()
    hint_brand = None
    for keyword, brand in MANUFACTURER_HINTS.items():
        if keyword in mfr_lower:
            hint_brand = brand
            break

    brand_order = []
    if hint_brand:
        brand_order.append(hint_brand)
    for k in BRAND_PROBES:
        if k != hint_brand:
            brand_order.append(k)

    # Step 2: Collect all candidate ports (deduplicated)
    all_ports = []
    seen = set()
    for brand_key in brand_order:
        for p in BRAND_PROBES[brand_key]["ports"]:
            if p not in seen:
                all_ports.append(p)
                seen.add(p)

    # Step 3: Quick port scan
    open_ports = _scan_ports(ip, all_ports)
    if not open_ports:
        open_ports = [80]   # assume 80 even if scan fails (firewall may block)
    print(f"[API_DETECT] {ip} open ports: {open_ports}")

    # Step 4: Probe in parallel — try hint brand on all ports first, then others
    # Limit concurrency to avoid flooding the camera
    results = []

    def _try(brand_key, port):
        if port not in open_ports:
            return None
        return _probe_brand(ip, port, brand_key, BRAND_PROBES[brand_key], username, password)

    # Try hint brand first (synchronous, fast)
    if hint_brand:
        for port in BRAND_PROBES[hint_brand]["ports"]:
            res = _try(hint_brand, port)
            if res:
                return _enrich_profile(res, ip, manufacturer, model)

    # Try remaining brands in parallel
    tasks = [
        (brand_key, port)
        for brand_key in brand_order
        if brand_key != hint_brand
        for port in BRAND_PROBES[brand_key]["ports"]
    ]

    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(_try, bk, p): (bk, p) for bk, p in tasks}
        for future in as_completed(futures, timeout=timeout):
            try:
                result = future.result()
                if result:
                    # Cancel remaining futures
                    for f in futures:
                        f.cancel()
                    return _enrich_profile(result, ip, manufacturer, model)
            except Exception:
                pass

    # Step 5: Fallback — ONVIF only, no brand API detected
    print(f"[API_DETECT] {ip} — no brand API found, using ONVIF-only profile")
    return {
        "brand":        "generic",
        "display_name": manufacturer or "Generic Camera",
        "auth_method":  "digest",
        "port":         open_ports[0] if open_ports else 80,
        "scheme":       "http",
        "base_url":     f"http://{ip}",
        "endpoints":    {},
        "features":     {},
        "confirmed":    False,
        "onvif_only":   True,
        "manufacturer": manufacturer,
        "model":        model,
    }


def _enrich_profile(profile: dict, ip: str, manufacturer: str, model: str) -> dict:
    """Add extra metadata to a confirmed profile."""
    profile["ip"]           = ip
    profile["manufacturer"] = manufacturer
    profile["model"]        = model
    profile["snapshot_url"] = _build_snapshot_url(profile)
    return profile


def _build_snapshot_url(profile: dict) -> Optional[str]:
    """Build a ready-to-use snapshot URL from the profile."""
    endpoints = profile.get("endpoints", {})
    snap      = endpoints.get("snapshot")
    if not snap:
        return None
    # Replace {channel} with default 1
    snap = snap.replace("{channel}", "1")
    base = profile.get("base_url", "")
    return base + snap if snap.startswith("/") else snap


# ─────────────────────────────────────────────────────────────────
# ENDPOINT VERIFICATION  (optional — call after detection)
# ─────────────────────────────────────────────────────────────────

def verify_endpoints(profile: dict, username: str, password: str,
                     endpoints_to_check: list[str] = None) -> dict:
    """
    After brand detection, verify which specific endpoints actually respond.
    Returns profile with 'verified_endpoints' dict  {endpoint_key: bool}.

    This runs ONCE per camera and the result is stored in MongoDB.
    """
    if not profile.get("confirmed"):
        return profile

    to_check = endpoints_to_check or list(profile["endpoints"].keys())
    verified = {}
    base     = profile["base_url"]
    auth_t   = profile.get("auth_method", "digest")

    def _check(ep_key):
        path = profile["endpoints"].get(ep_key, "")
        # Skip parameterized endpoints (contain {})
        if "{" in path:
            verified[ep_key] = "parameterized"
            return
        url = base + path
        resp, _ = _try_auth(url, username, password, auth_t, timeout=3)
        verified[ep_key] = resp is not None

    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(_check, to_check))

    profile["verified_endpoints"] = verified
    active_count = sum(1 for v in verified.values() if v is True)
    print(f"[API_DETECT] {profile['ip']} → {active_count}/{len(to_check)} endpoints verified")
    return profile


# ─────────────────────────────────────────────────────────────────
# HELPER: build a ready-to-call URL from profile
# ─────────────────────────────────────────────────────────────────

def build_endpoint_url(profile: dict, endpoint_key: str, **params) -> Optional[str]:
    """
    Build a complete URL from a profile's endpoint template.

    Example:
        url = build_endpoint_url(profile, "ptz_preset_list", channel=1)
        # → "http://192.168.1.64/ISAPI/PTZCtrl/channels/1/presets"
    """
    path = profile.get("endpoints", {}).get(endpoint_key)
    if not path:
        return None

    # Fill in template variables
    params.setdefault("channel", "1")
    params.setdefault("preset",  "1")
    try:
        path = path.format(**params)
    except KeyError:
        pass  # leave remaining placeholders as-is

    return profile["base_url"] + path


def get_api_summary(profile: dict) -> dict:
    """
    Returns a clean summary for the frontend to display.
    """
    if not profile:
        return {"detected": False}

    return {
        "detected":     profile.get("confirmed", False),
        "brand":        profile.get("brand",        "generic"),
        "display_name": profile.get("display_name", "Unknown"),
        "auth_method":  profile.get("auth_method",  "digest"),
        "base_url":     profile.get("base_url",     ""),
        "snapshot_url": profile.get("snapshot_url"),
        "features":     profile.get("features",     {}),
        "onvif_only":   profile.get("onvif_only",   False),
        "endpoint_count": len(profile.get("endpoints", {})),
        "verified_endpoints": profile.get("verified_endpoints", {}),
    }