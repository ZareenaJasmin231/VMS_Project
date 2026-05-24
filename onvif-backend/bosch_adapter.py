"""
bosch_adapter.py
────────────────
Bosch ONVIF PullPoint analytics adapter.

Key insight from debug:
- Topic._value_1 is None (zeep couldn't deserialize it)
- The actual topic text lives in the raw XML of the notification
- Message._value_1 is a raw lxml Element with UtcTime, PropertyOperation,
  Source/Data SimpleItems
- We must parse both from lxml directly
"""

from __future__ import annotations
import traceback
from datetime import datetime, timedelta
from typing import Any

from lxml import etree

# ── XML namespaces ─────────────────────────────────────────────────────────────
NS_SCHEMA = "http://www.onvif.org/ver10/schema"
NS_TOPICS = "http://www.onvif.org/ver10/topics"
NS_WSNT   = "http://docs.oasis-open.org/wsn/b-2"

NS = {
    "tt":   NS_SCHEMA,
    "tns1": NS_TOPICS,
    "wsnt": NS_WSNT,
}

# ── Topic → event type ─────────────────────────────────────────────────────────
TOPIC_MAP: dict[str, str] = {
    "Motion":         "Motion",
    "MotionAlarm":    "Motion",
    "MotionDetect":   "Motion",
    "ObjectInField":  "Intrusion",
    "LineCrossing":   "LineCrossing",
    "TamperDetect":   "Tamper",
    "Tamper":         "Tamper",
    "FieldDetector":  "Intrusion",
    "LineDetector":   "LineCrossing",
    "MyRuleDetector": "Motion",
    "Trigger":        "Motion",
}

# ── Subscription cache ─────────────────────────────────────────────────────────
_subscriptions: dict[str, dict] = {}
_SUB_LIFETIME   = 120   # seconds; renew 20 s early
_TIMEOUT_PROBES = ["PT0S", "PT1S", "PT5S"]

_DEBUG_TOPIC = True   # set False once topic parsing is confirmed working


def _safe_str(v: Any) -> str:
    if v is None:       return ""
    if isinstance(v, str): return v
    if hasattr(v, "_value_1"): return str(v._value_1) if v._value_1 else ""
    return str(v)


def _map_event_type(topic: str) -> str:
    for key, label in TOPIC_MAP.items():
        if key.lower() in topic.lower():
            return label
    parts = topic.replace("//", "/").rstrip("/").split("/")
    return parts[-1] if parts else "Unknown"


# ── Topic extraction ───────────────────────────────────────────────────────────

def _extract_topic_from_notif(notif_obj: Any) -> str:
    """
    Bosch stores the topic in the raw XML of the notification wrapper.
    zeep wraps it as notif.Topic with _value_1=None and the real data
    in an internal XML buffer. We serialise the zeep object to XML and
    parse the <wsnt:Topic> element directly.
    """
    # Strategy 1: try zeep's _value_1 as string
    try:
        tw = getattr(notif_obj, "Topic", None)
        if tw is not None:
            v1 = getattr(tw, "_value_1", None)
            if isinstance(v1, str) and v1.strip():
                return v1.strip()
            # v1 might be an lxml Element
            if hasattr(v1, "tag"):
                text = (v1.text or "").strip()
                if text:
                    return text
                # topic may be in the element's serialised text
                raw = etree.tostring(v1, encoding="unicode")
                if _DEBUG_TOPIC:
                    print(f"[BOSCH TOPIC EL] {raw!r}")
                return raw.strip()
    except Exception as e:
        if _DEBUG_TOPIC:
            print(f"[BOSCH TOPIC] strategy1 error: {e}")

    # Strategy 2: serialise the full notification with zeep and parse wsnt:Topic
    try:
        import zeep.helpers
        d = zeep.helpers.serialize_object(notif_obj)
        # d['Topic']['_value_1'] is still None for Bosch
        # but the internal zeep client may expose the raw element via __values__
        topic_obj = notif_obj.Topic
        if hasattr(topic_obj, "__values__"):
            for k, v in topic_obj.__values__.items():
                if v and isinstance(v, str) and v.strip():
                    return v.strip()
    except Exception as e:
        if _DEBUG_TOPIC:
            print(f"[BOSCH TOPIC] strategy2 error: {e}")

    # Strategy 3: use zeep's _raw_elements if available
    try:
        topic_obj = notif_obj.Topic
        raw_elems = getattr(topic_obj, "_raw_elements", None)
        if raw_elems:
            for el in raw_elems:
                text = (el.text or "").strip()
                if text:
                    return text
    except Exception:
        pass

    # Strategy 4: walk _attr_1 on the Topic wrapper
    try:
        tw = getattr(notif_obj, "Topic", None)
        if tw:
            attr1 = getattr(tw, "_attr_1", {}) or {}
            for k, v in attr1.items():
                s = _safe_str(v)
                if s.strip():
                    return s.strip()
    except Exception:
        pass

    return ""


# ── Message element parsing ────────────────────────────────────────────────────

def _parse_message_element(notif_obj: Any) -> dict:
    """
    Parse the lxml Element at notif.Message._value_1.
    Returns {utc_time, property_operation, items}.
    """
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

        # UtcTime and PropertyOperation are attributes on the Message element
        utc = msg_el.get("UtcTime") or msg_el.get("utcTime")
        if utc:
            result["utc_time"] = utc.strip()

        op = msg_el.get("PropertyOperation") or msg_el.get("propertyOperation", "")
        result["property_operation"] = op.strip()

        # SimpleItems inside <tt:Source> and <tt:Data>
        for section in ("Source", "Data"):
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
        print(f"[BOSCH] ⚠ _parse_message_element: {e}")

    return result


# ── Subscription management ────────────────────────────────────────────────────

def _create_subscription(ip: str, port: int, username: str, password: str) -> dict:
    from onvif import ONVIFCamera

    print(f"[BOSCH] 🔗 Creating PullPoint subscription for {ip}")
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
            print(f"[BOSCH] {ip} → sub addr: {addr}")
    except Exception:
        pass

    # Probe working timeout
    working = "PT0S"
    for t in _TIMEOUT_PROBES:
        try:
            pullpoint.PullMessages({"MessageLimit": 1, "Timeout": t})
            working = t
            print(f"[BOSCH] {ip} → working Timeout: {t}")
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
    print(f"[BOSCH] 🗑  Cleared subscription for {ip}")


# ── Public API ─────────────────────────────────────────────────────────────────

def pull_bosch_events(
    ip: str,
    port: int = 80,
    username: str = "",
    password: str = "",
    timeout_seconds: int = 5,
    max_messages: int = 50,
) -> dict:
    try:
        from onvif import ONVIFCamera  # noqa
    except ImportError:
        return {"success": False, "events": [],
                "error": "onvif-zeep not installed"}

    events: list[dict] = []

    for attempt in range(2):
        try:
            sub       = _get_subscription(ip, port, username, password)
            pp        = sub["pullpoint"]
            working_t = sub["working_timeout"]
            response  = pp.PullMessages({"MessageLimit": max_messages, "Timeout": working_t})
            break
        except Exception as e:
            print(f"[BOSCH] ⚠ PullMessages failed for {ip} (attempt {attempt+1}): {e}")
            _invalidate(ip)
            if attempt == 1:
                return {"success": False, "events": [], "error": str(e)}

    notifications = getattr(response, "NotificationMessage", []) or []

    if not notifications:
        print(f"[BOSCH] {ip} reachable, no events currently")
        return {"success": True, "events": [], "error": None}

    print(f"[BOSCH] {ip} → {len(notifications)} raw notification(s)")

    for notif in notifications:
        topic  = _extract_topic_from_notif(notif)
        parsed = _parse_message_element(notif)

        prop_op = parsed["property_operation"].lower()
        items   = parsed["items"]
        utc_time = parsed["utc_time"]

        
        print("""
        ================ BOSCH ANALYTICS EVENT ================
        TOPIC        : {}
        OPERATION    : {}
        ITEMS        : {}
        =======================================================
        """.format(topic, prop_op, items))



        # # Skip baseline snapshots
        # if prop_op == "initialized":
        #     continue

        # # Skip pure profile/noise events with no meaningful value
        # if not items or list(items.keys()) == ["Profile"]:
        #     continue

        # # Skip "off" states
        # state = items.get("State", items.get("Value", items.get("LogicalState", ""))).lower()
        # if state in ("false", "0", "inactive", "no", "off"):
        #     continue

        # Infer event type from topic, or fall back to items
        # ── REPLACE this entire block in pull_bosch_events ──────────────

# ── State filtering ──────────────────────────────────────────
        state = items.get(
            "State",
            items.get("Value", items.get("LogicalState", ""))
        ).lower().strip()

        status = items.get("Status", "").strip()

        # Skip initialized snapshots
        if prop_op == "initialized":
            continue

        # Skip empty items
        if not items:
            continue

        # Skip Profile/Status junk (no real state)
        if "Profile" in items and not status:
            continue

        # Skip relay/input noise
        if "RelayToken" in items or "InputToken" in items:
            continue

        # Skip OFF states
        if state in ("false", "0", "inactive", "no", "off", ""):
            continue

        # ── Event type mapping ───────────────────────────────────────
        # Since Bosch EVA always sends ConcreteSet, use Source number
        # to distinguish rules (Source='1' = rule 1, Source='2' = rule 2)
        source_num = items.get("Source", "1")

        # Map Source number to your configured scenarios
        # Source 1 = first VCA rule = "Detect any object" (Intrusion)
        SOURCE_MAP = {
            "1": ("Object Detection", "Detect Any Object"),
            "2": ("LineCrossing",     "Line Crossing"),
            "3": ("Tamper",           "Tamper Detection"),
        }

        event_type, scenario_name = SOURCE_MAP.get(
            source_num,
            ("Motion", "VCA Motion")
        )

        raw = {"topic": topic or "unknown", **items}

        events.append({
            "event_type":    event_type,
            "scenario_name": scenario_name,
            "topic":         topic or "unknown",
            "utc_time":      utc_time,
            "source":        "bosch",
            "raw":           raw,
        })

    if events:
        print(f"[BOSCH] ✅ {ip} → {len(events)} actionable event(s)")
    else:
        print(f"[BOSCH] {ip} → notifications received but all filtered out")

    return {"success": True, "events": events, "error": None}