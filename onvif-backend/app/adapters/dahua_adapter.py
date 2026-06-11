"""
dahua_adapter.py
────────────────
Dahua IPC ONVIF PullPoint analytics adapter.

Unlike Bosch (which sends only ConcreteSet), Dahua sends properly named
ONVIF topics like:
  - tns1:RuleEngine/FieldDetector/ObjectInField
  - tns1:RuleEngine/LineDetector/Crossed
  - tns1:VideoSource/MotionAlarm/Motion
  - tns1:RuleEngine/PeopleCounter/People
  - tns1:RuleEngine/TamperDetector/Tamper
  - tns1:RuleEngine/FaceDetector/Face
  - tns1:RuleEngine/AudioDetector/AudioException

So we get real named analytics from Dahua via standard ONVIF.
"""

from __future__ import annotations
from datetime import datetime, timedelta
from typing import Any
from lxml import etree

# ── XML namespaces ─────────────────────────────────────────────────────────────
NS_SCHEMA = "http://www.onvif.org/ver10/schema"
NS_TOPICS = "http://www.onvif.org/ver10/topics"
NS_WSNT   = "http://docs.oasis-open.org/wsn/b-2"

# ── Dahua ONVIF Topic → (event_type, scenario_name) ───────────────────────────
DAHUA_TOPIC_MAP: dict[str, tuple[str, str]] = {
    # Motion
    "MotionAlarm":          ("Motion",           "Motion Detection"),
    "Motion":               ("Motion",           "Motion Detection"),
    "MotionDetect":         ("Motion",           "Motion Detection"),

    # Intrusion / Field Detection
    "ObjectInField":        ("Intrusion",        "Object In Field"),
    "FieldDetector":        ("Intrusion",        "Field Detection"),
    "Intrusion":            ("Intrusion",        "Intrusion Detection"),
    "EnterArea":            ("Intrusion",        "Enter Area"),
    "LeaveArea":            ("Intrusion",        "Leave Area"),

    # Line Crossing
    "Crossed":              ("LineCrossing",     "Line Crossing"),
    "LineDetector":         ("LineCrossing",     "Line Crossing"),
    "LineCrossing":         ("LineCrossing",     "Line Crossing"),

    # People Counting
    "PeopleCounter":        ("PeopleCounting",   "People Counting"),
    "People":               ("PeopleCounting",   "People Counting"),
    "Counting":             ("PeopleCounting",   "People Counting"),

    # Face Detection
    "FaceDetector":         ("FaceDetection",    "Face Detection"),
    "Face":                 ("FaceDetection",    "Face Detection"),
    "FaceRecognition":      ("FaceDetection",    "Face Recognition"),

    # Tamper
    "TamperDetector":       ("Tamper",           "Tamper Detection"),
    "Tamper":               ("Tamper",           "Tamper Detection"),
    "VideoBlind":           ("Tamper",           "Video Blind"),
    "SceneChange":          ("Tamper",           "Scene Change"),

    # Audio
    "AudioDetector":        ("AudioException",   "Audio Exception"),
    "AudioException":       ("AudioException",   "Audio Exception"),

    # Loitering
    "Loitering":            ("Loitering",        "Loitering Detection"),

    # Abandoned / Missing Object
    "AbandonedObject":      ("AbandonedObject",  "Abandoned Object"),
    "MissingObject":        ("MissingObject",    "Missing Object"),
    "RemovedObject":        ("MissingObject",    "Removed Object"),

    # Parking / Vehicle
    "Parking":              ("Parking",          "Parking Detection"),
    "Vehicle":              ("Vehicle",          "Vehicle Detection"),

    # Video Loss
    "VideoLoss":            ("VideoLoss",        "Video Loss"),
    "SignalLoss":           ("VideoLoss",        "Signal Loss"),
}


# ── Subscription cache ─────────────────────────────────────────────────────────
_subscriptions: dict[str, dict] = {}
_SUB_LIFETIME   = 120
_TIMEOUT_PROBES = ["PT0S", "PT1S", "PT5S"]


def _safe_str(v: Any) -> str:
    if v is None:           return ""
    if isinstance(v, str):  return v
    if hasattr(v, "_value_1"):
        return str(v._value_1) if v._value_1 else ""
    return str(v)


def _map_dahua_event(topic: str) -> tuple[str, str]:
    """
    Map a Dahua ONVIF topic string to (event_type, scenario_name).
    Dahua topics look like:
      tns1:RuleEngine/FieldDetector/ObjectInField
      tns1:VideoSource/MotionAlarm/Motion
    We check each known key against the topic string.
    """
    for key, (event_type, scenario) in DAHUA_TOPIC_MAP.items():
        if key.lower() in topic.lower():
            return event_type, scenario

    # Fallback: extract last segment of topic path
    parts = topic.replace("//", "/").rstrip("/").split("/")
    last = parts[-1] if parts else "Unknown"
    return last, last


# ── Topic extraction ───────────────────────────────────────────────────────────
def _extract_topic(notif_obj: Any) -> str:
    """Extract topic string from ONVIF notification."""

    def _is_valid_topic(val: Any) -> bool:
        if not isinstance(val, str) or not val.strip():
            return False
        # Ignore Dialect strings and namespaces
        if "topicExpression" in val or val.strip().startswith("http://"):
            return False
        return True

    # Strategy 1: zeep _value_1 as string
    try:
        tw = getattr(notif_obj, "Topic", None)
        if tw is not None:
            v1 = getattr(tw, "_value_1", None)
            if _is_valid_topic(v1):
                return v1.strip()
            if hasattr(v1, "tag"):
                text = (v1.text or "").strip()
                if _is_valid_topic(text):
                    return text
    except Exception:
        pass

    # Strategy 2: _raw_elements
    try:
        topic_obj = notif_obj.Topic
        raw_elems = getattr(topic_obj, "_raw_elements", None)
        if raw_elems:
            for el in raw_elems:
                text = (el.text or "").strip()
                if _is_valid_topic(text):
                    return text
    except Exception:
        pass

    # Strategy 3: __values__
    try:
        topic_obj = notif_obj.Topic
        if hasattr(topic_obj, "__values__"):
            for k, v in topic_obj.__values__.items():
                if _is_valid_topic(v):
                    return v.strip()
    except Exception:
        pass

    return ""



# ── Message parsing ────────────────────────────────────────────────────────────
def _parse_message(notif_obj: Any) -> dict:
    """Parse the lxml Element at notif.Message._value_1."""
    result = {
        "utc_time":           datetime.utcnow().isoformat(),
        "property_operation": "",
        "items":              {},
    }

    try:
        msg_wrapper = getattr(notif_obj, "Message", None)
        if msg_wrapper is None:
            return result

        msg_el = getattr(msg_wrapper, "_value_1", None)
        if msg_el is None or not hasattr(msg_el, "tag"):
            return result

        utc = msg_el.get("UtcTime") or msg_el.get("utcTime")
        if utc:
            result["utc_time"] = utc.strip()

        op = msg_el.get("PropertyOperation") or msg_el.get("propertyOperation", "")
        result["property_operation"] = op.strip()

        for section in ("Source", "Data", "Key"):
            sec_el = msg_el.find(f"{{{NS_SCHEMA}}}{section}")
            if sec_el is None:
                sec_el = msg_el.find(section)
            if sec_el is not None:
                for item in sec_el:
                    name  = item.get("Name",  "")
                    value = item.get("Value", "")
                    if name:
                        result["items"][name] = value

    except Exception as e:
        print(f"[DAHUA] ⚠ _parse_message: {e}")

    return result


# ── Subscription management ────────────────────────────────────────────────────
def _create_subscription(ip: str, port: int, username: str, password: str) -> dict:
    from onvif import ONVIFCamera

    print(f"[DAHUA] 🔗 Creating PullPoint subscription for {ip}")
    cam           = ONVIFCamera(ip, port, username, password)
    event_service = cam.create_events_service()

    try:
        sub = event_service.CreatePullPointSubscription(
            {"InitialTerminationTime": f"PT{_SUB_LIFETIME}S"}
        )
    except Exception:
        try:
            sub = event_service.CreatePullPointSubscription({})
        except Exception as e:
            raise RuntimeError(f"Cannot subscribe: {e}") from e

    pullpoint = cam.create_pullpoint_service()

    try:
        addr = _safe_str(sub.SubscriptionReference.Address)
        if addr:
            pullpoint._client._binding_options["address"] = addr
            print(f"[DAHUA] {ip} → sub addr: {addr}")
    except Exception:
        pass

    # Probe working timeout
    working = "PT0S"
    for t in _TIMEOUT_PROBES:
        try:
            pullpoint.PullMessages({"MessageLimit": 1, "Timeout": t})
            working = t
            print(f"[DAHUA] {ip} → working Timeout: {t}")
            break
        except Exception as e:
            if "argument value invalid" in str(e).lower():
                continue
            break

    now = datetime.utcnow()
    return {
        "pullpoint":       pullpoint,
        "event_service":   event_service,
        "cam":             cam,
        "working_timeout": working,
        "expires_at":      now + timedelta(seconds=_SUB_LIFETIME - 20),
    }


def _get_subscription(ip: str, port: int, username: str, password: str) -> dict:
    c = _subscriptions.get(ip)
    if c and datetime.utcnow() < c["expires_at"]:
        return c
    if c:
        try: c["event_service"].Unsubscribe({})
        except Exception: pass
        del _subscriptions[ip]
    entry = _create_subscription(ip, port, username, password)
    _subscriptions[ip] = entry
    return entry


def _invalidate(ip: str) -> None:
    if ip not in _subscriptions:
        return
    try: _subscriptions[ip]["event_service"].Unsubscribe({})
    except Exception: pass
    del _subscriptions[ip]
    print(f"[DAHUA] 🗑  Cleared subscription for {ip}")


# ── Public API ─────────────────────────────────────────────────────────────────
def pull_dahua_events(
    ip: str,
    port: int = 80,
    username: str = "admin",
    password: str = "admin123",
    max_messages: int = 50,
) -> dict:
    """
    Pull ONVIF events from a Dahua IPC camera.
    Returns {"success": bool, "events": [...], "error": str|None}
    Each event dict contains:
      - event_type:    e.g. "Motion", "Intrusion", "LineCrossing"
      - scenario_name: e.g. "Motion Detection", "Line Crossing"
      - topic:         raw ONVIF topic string
      - utc_time:      ISO timestamp
      - source:        "dahua"
      - raw:           dict of raw items from ONVIF message
    """
    try:
        from onvif import ONVIFCamera  # noqa
    except ImportError:
        return {"success": False, "events": [], "error": "onvif-zeep not installed"}

    events: list[dict] = []

    for attempt in range(2):
        try:
            sub       = _get_subscription(ip, port, username, password)
            pp        = sub["pullpoint"]
            working_t = sub["working_timeout"]
            response  = pp.PullMessages({"MessageLimit": max_messages, "Timeout": working_t})
            break
        except Exception as e:
            print(f"[DAHUA] ⚠ PullMessages failed for {ip} (attempt {attempt+1}): {e}")
            _invalidate(ip)
            if attempt == 1:
                return {"success": False, "events": [], "error": str(e)}

    notifications = getattr(response, "NotificationMessage", []) or []

    if not notifications:
        print(f"[DAHUA] {ip} reachable, no events currently")
        return {"success": True, "events": [], "error": None}

    print(f"[DAHUA] {ip} → {len(notifications)} raw notification(s)")

    for notif in notifications:
        topic   = _extract_topic(notif)
        parsed  = _parse_message(notif)

        prop_op  = parsed["property_operation"].lower()
        items    = parsed["items"]
        utc_time = parsed["utc_time"]

        # Debug log (remove after confirmed working)
        print(f"[DAHUA EVENT] topic={topic!r} op={prop_op!r} items={items}")
        print(f"[DAHUA DEBUG] raw topic obj: {repr(getattr(notif, 'Topic', None))}")
        try:
            print(f"[DAHUA DEBUG] topic __values__: {getattr(notif.Topic, '__values__', {})}")
        except Exception:
            pass

        # ── Skip initialized snapshots ────────────────────────────────
        if prop_op == "initialized":
            continue

        # ── Skip empty items ──────────────────────────────────────────
        if not items:
            continue

        # ── Skip relay/input noise ────────────────────────────────────
        if "RelayToken" in items or "InputToken" in items:
            continue

        # ── Skip Profile/Status junk ──────────────────────────────────
        if "Profile" in items and not items.get("Status", "").strip():
            continue

        # ── Get state value ───────────────────────────────────────────
        state = items.get(
            "State",
            items.get("Value", items.get("LogicalState", items.get("IsMotion", "")))
        ).lower().strip()

        # ── Skip OFF states ───────────────────────────────────────────
        if state in ("false", "0", "inactive", "no", "off", ""):
            # But allow count events (People Counting sends Count not State)
            count = items.get("Count", items.get("ObjectCount", items.get("EnteredSubtotal", None)))
            if count is None:
                continue

        # ── Map topic to event type ───────────────────────────────────
        if topic:
            event_type, scenario_name = _map_dahua_event(topic)
        else:
            # Fallback: guess from items
            if "Count" in items or "ObjectCount" in items:
                event_type, scenario_name = "PeopleCounting", "People Counting"
            elif "IsMotion" in items:
                event_type, scenario_name = "Motion", "Motion Detection"
            else:
                event_type, scenario_name = "Motion", "Motion Detection"

        # ── Extract count for people counting ────────────────────────
        count_val = items.get("Count", items.get("ObjectCount", items.get("EnteredSubtotal", None)))

        raw = {"topic": topic or "unknown", **items}

        events.append({
            "event_type":    event_type,
            "scenario_name": scenario_name,
            "topic":         topic or "unknown",
            "utc_time":      utc_time,
            "source":        "dahua",
            "count":         count_val,
            "raw":           raw,
        })

    if events:
        print(f"[DAHUA] ✅ {ip} → {len(events)} actionable event(s)")
    else:
        print(f"[DAHUA] {ip} → notifications received but all filtered out")

    return {"success": True, "events": events, "error": None}