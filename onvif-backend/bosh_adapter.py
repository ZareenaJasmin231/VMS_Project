"""
bosch_adapter.py
────────────────
Bosch camera analytics via ONVIF PullPoint subscription.

Pulls motion, line-crossing, intrusion, and tamper events from
Bosch cameras and returns them in the same normalized dict format
that the Axis/ONVIF poll loop already uses, so they land in the
same `analytics_events` MongoDB collection without any changes to
main.py storage logic.

Requirements:
    pip install onvif-zeep

Usage (called from main.py):
    from bosch_adapter import pull_bosch_events
    result = pull_bosch_events(ip, port, username, password)
"""

from __future__ import annotations
import traceback
from datetime import datetime
from typing import Any

# ── ONVIF topic → human-readable event type map ──────────────────────────────
TOPIC_MAP: dict[str, str] = {
    "tns1:VideoAnalytics/Motion/MotionAlarm":              "Motion",
    "tns1:VideoAnalytics/MotionDetection":                 "Motion",
    "tns1:VideoAnalytics/ObjectInField":                   "Intrusion",
    "tns1:VideoAnalytics/LineCrossing":                    "LineCrossing",
    "tns1:VideoAnalytics/TamperDetection":                 "Tamper",
    "tns1:RuleEngine/MotionDetector/Motion":               "Motion",
    "tns1:RuleEngine/FieldDetector/ObjectsInside":         "Intrusion",
    "tns1:RuleEngine/LineDetector/Crossed":                "LineCrossing",
    "tns1:RuleEngine/TamperDetector/Tamper":               "Tamper",
    "tns1:VideoSource/MotionAlarm":                        "Motion",
}


def _topic_str(topic_obj: Any) -> str:
    """
    Extract a flat topic string from whatever zeep returns.
    zeep may return a string, an object with ._value_1, or a nested element.
    """
    if topic_obj is None:
        return ""
    if isinstance(topic_obj, str):
        return topic_obj.strip()
    # zeep SimpleValue wrapper
    if hasattr(topic_obj, "_value_1"):
        return str(topic_obj._value_1).strip()
    return str(topic_obj).strip()


def _map_event_type(topic: str) -> str:
    """Return a clean event-type label for a given ONVIF topic string."""
    for key, label in TOPIC_MAP.items():
        if key in topic:
            return label
    # Fallback: last segment of the topic path
    parts = topic.replace("//", "/").rstrip("/").split("/")
    return parts[-1] if parts else "Unknown"


def _safe_str(value: Any) -> str:
    """Convert any zeep value to a plain string safely."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if hasattr(value, "_value_1"):
        return str(value._value_1)
    return str(value)


def pull_bosch_events(
    ip: str,
    port: int = 80,
    username: str = "",
    password: str = "",
    timeout_seconds: int = 5,
    max_messages: int = 20,
) -> dict:
    """
    Open an ONVIF PullPoint subscription to a Bosch camera and
    drain any pending event messages.

    Returns
    -------
    {
        "success": bool,
        "events":  list[dict],   # normalized, same format as Axis
        "error":   str | None,
    }

    Each event dict:
    {
        "event_type": str,       # e.g. "Motion", "LineCrossing"
        "topic":      str,       # raw ONVIF topic
        "utc_time":   str,       # ISO-8601
        "source":     "bosch",
        "raw":        dict,      # whatever fields we could extract
    }
    """
    try:
        from onvif import ONVIFCamera   # onvif-zeep package
    except ImportError:
        return {
            "success": False,
            "events":  [],
            "error":   "onvif-zeep not installed — run: pip install onvif-zeep",
        }

    events: list[dict] = []

    try:
        # ── 1. Connect ────────────────────────────────────────────────
        cam = ONVIFCamera(ip, port, username, password)
        event_service = cam.create_events_service()

        # ── 2. Create PullPoint subscription ─────────────────────────
        # Some Bosch firmwares need InitialTerminationTime in ISO duration format
        try:
            subscription = event_service.CreatePullPointSubscription(
                {"InitialTerminationTime": f"PT{timeout_seconds + 30}S"}
            )
        except Exception:
            # Older Bosch firmware — no InitialTerminationTime argument
            subscription = event_service.CreatePullPointSubscription({})

        # ── 3. Build a PullMessages service aimed at the subscription ─
        pullpoint = cam.create_pullpoint_service()

        # Zeep uses the subscription reference address if provided
        try:
            addr = subscription.SubscriptionReference.Address
            if addr:
                pullpoint._client._binding_options["address"] = _safe_str(addr)
        except Exception:
            pass  # Not all Bosch firmwares return a custom address

        # ── 4. Pull messages ──────────────────────────────────────────
        pull_request = {
            "MessageLimit": max_messages,
            "Timeout":      f"PT{timeout_seconds}S",
        }
        response = pullpoint.PullMessages(pull_request)

        notifications = getattr(response, "NotificationMessage", []) or []

        # ── 5. Normalise ──────────────────────────────────────────────
        for notif in notifications:
            topic = _topic_str(getattr(notif, "Topic", None))

            # UTC time: prefer the Message element's UtcTime
            utc_time = datetime.utcnow().isoformat()
            try:
                msg = getattr(notif, "Message", None)
                if msg:
                    msg_inner = getattr(msg, "Message", msg)
                    t = getattr(msg_inner, "UtcTime", None)
                    if t:
                        utc_time = t.isoformat() if hasattr(t, "isoformat") else str(t)
            except Exception:
                pass

            # Extract simple source/data key-value pairs from the ONVIF message
            raw: dict[str, Any] = {"topic": topic}
            try:
                msg      = getattr(notif, "Message", None)
                msg_body = getattr(msg, "Message", msg) if msg else None
                if msg_body:
                    src = getattr(msg_body, "Source", None)
                    if src:
                        for item in (getattr(src, "SimpleItem", []) or []):
                            raw[_safe_str(getattr(item, "Name", ""))] = \
                                _safe_str(getattr(item, "Value", ""))
                    dat = getattr(msg_body, "Data", None)
                    if dat:
                        for item in (getattr(dat, "SimpleItem", []) or []):
                            raw[_safe_str(getattr(item, "Name", ""))] = \
                                _safe_str(getattr(item, "Value", ""))
            except Exception:
                pass

            event_type = _map_event_type(topic)

            events.append({
                "event_type": event_type,
                "topic":      topic,
                "utc_time":   utc_time,
                "source":     "bosch",
                "raw":        raw,
            })

        # ── 6. Unsubscribe cleanly ────────────────────────────────────
        try:
            event_service.Unsubscribe({})
        except Exception:
            pass  # Non-fatal — Bosch will expire it automatically

        print(f"[BOSCH] {ip} → pulled {len(events)} event(s)")
        return {"success": True, "events": events, "error": None}

    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[BOSCH] ❌ {ip}: {exc}\n{tb}")
        return {"success": False, "events": [], "error": str(exc)}