"""
hikvision_adapter.py
────────────────────
Hikvision camera analytics via ONVIF PullPoint subscription.

Primary:  ONVIF PullPoint (works on most Hikvision IPC/NVR firmware >= V5.x)
Fallback: ISAPI multipart alertStream   (/ISAPI/Event/notification/alertStream)

Hikvision ONVIF topics of interest:
  - tns1:VideoAnalytics/MotionDetection/Motion
  - tns1:RuleEngine/FieldDetector/ObjectInField
  - tns1:RuleEngine/LineDetector/Crossed
  - tns1:RuleEngine/TamperDetector/Tamper
  - tns1:RuleEngine/FaceDetector/Face
  - tns1:RuleEngine/PeopleCounter/People
  - tns1:VideoSource/MotionAlarm/IsMoveDetected
  - tns1:Device/HardwareFailure/StorageFailure

Requirements:
    pip install onvif-zeep requests
"""

from __future__ import annotations
import re
import threading
import time
from datetime import datetime, timedelta
from typing import Any

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

# ── Hikvision ONVIF Topic → (event_type, scenario_name) ──────────────────────
HIK_TOPIC_MAP: dict[str, tuple[str, str]] = {
    # Motion
    "MotionAlarm":             ("Motion",           "Motion Detection"),
    "IsMoveDetected":          ("Motion",           "Motion Detection"),
    "MotionDetection":         ("Motion",           "Motion Detection"),

    # Intrusion / Field
    "ObjectInField":           ("Intrusion",        "Object In Field"),
    "FieldDetector":           ("Intrusion",        "Field Detection"),
    "Intrusion":               ("Intrusion",        "Intrusion Detection"),
    "EnterArea":               ("Intrusion",        "Enter Area"),
    "LeaveArea":               ("Intrusion",        "Leave Area"),
    "ParkingDetection":        ("Intrusion",        "Parking Detection"),
    "UnattendedBaggage":       ("Intrusion",        "Unattended Baggage"),
    "BagRemoval":              ("Intrusion",        "Bag Removal"),

    # Line Crossing
    "Crossed":                 ("LineCrossing",     "Line Crossing"),
    "LineDetector":            ("LineCrossing",     "Line Crossing"),
    "LineCrossing":            ("LineCrossing",     "Line Crossing"),

    # Face
    "Face":                    ("FaceDetection",    "Face Detection"),
    "FaceDetector":            ("FaceDetection",    "Face Detection"),
    "FaceCapture":             ("FaceDetection",    "Face Capture"),

    # People counting
    "People":                  ("PeopleCounter",    "People Count"),
    "PeopleCounter":           ("PeopleCounter",    "People Count"),

    # Tamper
    "Tamper":                  ("Tamper",           "Camera Tamper"),
    "TamperDetector":          ("Tamper",           "Camera Tamper"),
    "Defocus":                 ("Tamper",           "Defocus Detection"),

    # Hardware
    "StorageFailure":          ("HardwareAlert",    "Storage Failure"),
    "VideoLoss":               ("HardwareAlert",    "Video Loss"),

    # Audio
    "AudioException":          ("AudioDetection",   "Audio Exception"),
    "SoundDetection":          ("AudioDetection",   "Sound Detection"),
}

# Topics to silently ignore
HIK_IGNORE_TOPICS = {
    "tns1:Monitoring/Profile/ActiveConnections",
    "tns1:Device/Trigger/Relay",
    "tns1:Device/Trigger/DigitalInput",
    "tns1:VideoSource/ImageTooBright",
    "tns1:VideoSource/ImageTooDark",
    "tns1:VideoSource/GlobalSceneChange",
}

# ── Persistent subscription cache { ip → { client, sub_ref, expires_at } } ───
_subscriptions: dict[str, dict] = {}
_SUB_LIFETIME_SECONDS = 300   # 5 min — renew 60 s before expiry
_TIMEOUT_CANDIDATES   = ["PT0S", "PT1S", "PT5S"]


def _classify_topic(topic: str) -> tuple[str, str]:
    """Map an ONVIF topic string to (event_type, scenario_name)."""
    topic_upper = topic.upper()
    for key, (evt, scen) in HIK_TOPIC_MAP.items():
        if key.upper() in topic_upper:
            return evt, scen
    # Generic fallback — extract last segment
    parts = re.split(r"[/:]", topic)
    label = next((p for p in reversed(parts) if p and p not in {"tns1", "tns", "onvif"}), "Event")
    return label, label


def _topic_str(notif: Any) -> str:
    """Robustly extract topic string from an ONVIF notification."""
    if notif is None:
        return ""
    # Try Topic attribute
    topic_obj = getattr(notif, "Topic", None)
    if topic_obj is not None:
        # zeep wraps in _value_1 sometimes
        val = getattr(topic_obj, "_value_1", None) or str(topic_obj)
        return str(val).strip()
    return ""


# ── ONVIF PullPoint (primary method) ─────────────────────────────────────────

def _pull_via_onvif(ip: str, port: int, username: str, password: str) -> dict:
    """
    Pull events from Hikvision via ONVIF PullPoint subscription.
    Maintains a persistent subscription per IP to avoid losing buffered events.
    """
    try:
        from onvif import ONVIFCamera
    except ImportError:
        return {"success": False, "error": "onvif-zeep not installed", "events": []}

    now = time.time()
    cached = _subscriptions.get(ip)
    pullpoint = None
    cam = None

    try:
        # ── Reuse or create subscription ─────────────────────────────
        if cached and now < cached.get("expires_at", 0) - 60:
            pullpoint = cached["pullpoint"]
        else:
            # Create fresh ONVIF camera + subscription
            cam = ONVIFCamera(ip, port, username, password)
            cam.update_xaddrs()
            events_svc = cam.create_events_service()
            events_svc.transport.session.verify = False

            sub_ref = None
            for timeout_val in _TIMEOUT_CANDIDATES:
                try:
                    sub_ref = events_svc.CreatePullPointSubscription({
                        "RequestedTerminationTime": f"PT{_SUB_LIFETIME_SECONDS}S",
                        "Filter": {
                            "TopicExpression": {
                                "_value_1": "tns1:VideoAnalytics/. | tns1:RuleEngine/. | tns1:Device/HardwareFailure/.",
                                "Dialect": "http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet",
                            }
                        }
                    })
                    break
                except Exception:
                    sub_ref = None

            if sub_ref is None:
                # No filter — subscribe to everything
                sub_ref = events_svc.CreatePullPointSubscription({
                    "RequestedTerminationTime": f"PT{_SUB_LIFETIME_SECONDS}S",
                })

            pullpoint = cam.create_pullpoint_service()
            pullpoint.transport.session.verify = False

            _subscriptions[ip] = {
                "pullpoint":  pullpoint,
                "expires_at": now + _SUB_LIFETIME_SECONDS,
            }

        # ── Pull buffered messages ────────────────────────────────────
        pull_timeout = None
        for t_val in _TIMEOUT_CANDIDATES:
            try:
                resp = pullpoint.PullMessages({
                    "MessageLimit": 50,
                    "Timeout":      t_val,
                })
                pull_timeout = t_val
                break
            except Exception:
                continue

        if pull_timeout is None:
            return {"success": False, "error": "PullMessages failed for all timeouts", "events": []}

        notifications = getattr(resp, "NotificationMessage", []) or []
        events = []

        for notif in notifications:
            topic = _topic_str(notif)

            # Skip ignored topics
            if any(ig in topic for ig in HIK_IGNORE_TOPICS):
                continue

            # Only process if active/changed (not just Initialized state)
            message = getattr(notif, "Message", None)
            if message:
                prop_op = str(getattr(message, "PropertyOperation", "") or "")
                if prop_op.lower() == "initialized":
                    continue

            event_type, scenario_name = _classify_topic(topic)

            events.append({
                "topic":         topic,
                "event_type":    event_type,
                "scenario_name": scenario_name,
                "raw":           {"topic": topic},
            })

        return {"success": True, "events": events}

    except Exception as e:
        # Clear stale subscription so next call creates fresh one
        _subscriptions.pop(ip, None)
        return {"success": False, "error": str(e), "events": []}


# ── ISAPI alertStream (fallback) ──────────────────────────────────────────────

# Cache of ongoing stream threads { ip → thread }
_stream_threads: dict[str, dict] = {}
_stream_lock = threading.Lock()


def _parse_isapi_alert(chunk: str) -> dict | None:
    """Parse a single ISAPI alertStream multipart chunk into a normalized event."""
    event_type_match  = re.search(r"<eventType>(.*?)</eventType>",     chunk, re.IGNORECASE)
    event_state_match = re.search(r"<eventState>(.*?)</eventState>",   chunk, re.IGNORECASE)
    channel_match     = re.search(r"<channelID>(.*?)</channelID>",     chunk, re.IGNORECASE)

    if not event_type_match:
        return None

    raw_type    = event_type_match.group(1).strip()
    event_state = (event_state_match.group(1).strip() if event_state_match else "active").lower()

    # Only report active alerts
    if event_state not in ("active", "1", "true"):
        return None

    evt, scen = _classify_topic(raw_type)
    return {
        "topic":         f"hikvision/isapi/{raw_type}",
        "event_type":    evt,
        "scenario_name": scen,
        "raw":           {"eventType": raw_type, "eventState": event_state,
                          "channelID": channel_match.group(1) if channel_match else "1"},
    }


def _pull_via_isapi(ip: str, username: str, password: str) -> dict:
    """
    Connect to Hikvision ISAPI alertStream (multipart/form-data push stream).
    Reads up to 50 events with a 6-second window.
    """
    if not REQUESTS_AVAILABLE:
        return {"success": False, "error": "requests not installed", "events": []}

    url = f"http://{ip}/ISAPI/Event/notification/alertStream"
    events = []
    try:
        from requests.auth import HTTPDigestAuth
        resp = requests.get(
            url,
            auth=HTTPDigestAuth(username, password),
            stream=True,
            timeout=(5, 6),
            verify=False,
        )
        if resp.status_code == 401:
            return {"success": False, "error": "Auth failed (digest)", "events": []}
        if resp.status_code != 200:
            return {"success": False, "error": f"HTTP {resp.status_code}", "events": []}

        buffer = ""
        for chunk in resp.iter_content(chunk_size=1024, decode_unicode=True):
            buffer += chunk
            # Each event is separated by a multipart boundary
            while "--" in buffer:
                parts = buffer.split("--", 1)
                segment = parts[0]
                buffer  = "--" + parts[1] if len(parts) > 1 else ""
                ev = _parse_isapi_alert(segment)
                if ev:
                    events.append(ev)
                if len(events) >= 50:
                    break
            if len(events) >= 50:
                break

        return {"success": True, "events": events}
    except requests.exceptions.Timeout:
        # Normal — stream window expired
        return {"success": True, "events": events}
    except Exception as e:
        return {"success": False, "error": str(e), "events": []}


# ── Public API ────────────────────────────────────────────────────────────────

def pull_hikvision_events(ip: str, port: int, username: str, password: str) -> dict:
    """
    Pull analytics events from a Hikvision camera.

    Tries in order:
    1. ONVIF PullPoint  (most IPC/NVR firmware V5.x+)
    2. ISAPI alertStream (older firmware or when PullPoint is unavailable)

    Returns:
        {
            "success": bool,
            "events": [
                {
                    "topic": str,
                    "event_type": str,
                    "scenario_name": str,
                    "raw": dict
                },
                ...
            ],
            "error": str  # only on failure
        }
    """
    # ── Method 1: ONVIF PullPoint ─────────────────────────────────────────────
    result = _pull_via_onvif(ip, port, username, password)
    if result["success"]:
        return result

    print(f"[HIK_ADAPTER] ONVIF PullPoint failed for {ip}: {result.get('error')} — trying ISAPI alertStream")

    # ── Method 2: ISAPI alertStream ───────────────────────────────────────────
    result2 = _pull_via_isapi(ip, username, password)
    if result2["success"]:
        return result2

    print(f"[HIK_ADAPTER] ISAPI alertStream also failed for {ip}: {result2.get('error')}")

    # Both failed — return success=True with empty list so poll loop keeps trying
    return {"success": True, "events": [], "error": result.get("error")}
