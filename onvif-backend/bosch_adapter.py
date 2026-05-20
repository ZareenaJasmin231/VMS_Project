"""
bosch_adapter.py
────────────────
Bosch camera analytics via ONVIF PullPoint subscription.

Pulls motion, line-crossing, intrusion, and tamper events from
Bosch cameras and returns them in the same normalized dict format
that the Axis/ONVIF poll loop already uses.

KEY FIX: Maintains a persistent subscription per camera IP so events
accumulate between polls rather than being lost on every reconnect.

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
    # Bosch-specific topics
    "tns1:RuleEngine/MyRuleDetector":                      "Motion",
    "tns1:VideoAnalytics/":                                "Motion",
    "tns1:Device/Trigger":                                 "Motion",
}

# ── Persistent subscription cache keyed by IP ─────────────────────────────────
# Stores: { ip: { "pullpoint": <service>, "expires_at": datetime } }
_subscriptions: dict[str, dict] = {}

# Subscription lifetime — renew 60s before expiry
_SUB_LIFETIME_SECONDS = 300   # PT5M


def _topic_str(topic_obj: Any) -> str:
    if topic_obj is None:
        return ""
    if isinstance(topic_obj, str):
        return topic_obj.strip()
    if hasattr(topic_obj, "_value_1"):
        return str(topic_obj._value_1).strip()
    return str(topic_obj).strip()


def _map_event_type(topic: str) -> str:
    for key, label in TOPIC_MAP.items():
        if key in topic:
            return label
    parts = topic.replace("//", "/").rstrip("/").split("/")
    return parts[-1] if parts else "Unknown"


def _safe_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if hasattr(value, "_value_1"):
        return str(value._value_1)
    return str(value)


def _get_or_create_subscription(
    ip: str,
    port: int,
    username: str,
    password: str,
    timeout_seconds: int,
) -> tuple[Any, Any]:
    """
    Return (pullpoint_service, event_service) reusing a cached subscription
    when still valid, or creating a fresh one otherwise.
    """
    from onvif import ONVIFCamera

    cached = _subscriptions.get(ip)
    now = datetime.utcnow()

    # Check if cached subscription is still fresh (with 60s safety margin)
    if cached and cached["expires_at"] > now:
        return cached["pullpoint"], cached["event_service"]

    # ── Create a new subscription ──────────────────────────────────────────
    print(f"[BOSCH] 🔗 Creating new PullPoint subscription for {ip}")

    cam = ONVIFCamera(ip, port, username, password)
    event_service = cam.create_events_service()

    lifetime = _SUB_LIFETIME_SECONDS
    try:
        subscription = event_service.CreatePullPointSubscription(
            {"InitialTerminationTime": f"PT{lifetime}S"}
        )
    except Exception:
        subscription = event_service.CreatePullPointSubscription({})

    pullpoint = cam.create_pullpoint_service()

    # Point the pullpoint service at the subscription's address if provided
    try:
        addr = subscription.SubscriptionReference.Address
        if addr:
            addr_str = _safe_str(addr)
            if addr_str:
                pullpoint._client._binding_options["address"] = addr_str
                print(f"[BOSCH] {ip} → subscription address: {addr_str}")
    except Exception:
        pass

    expires_at = datetime(
        now.year, now.month, now.day,
        now.hour, now.minute, now.second
    )
    from datetime import timedelta
    expires_at = now + timedelta(seconds=lifetime - 60)  # renew 60s early

    _subscriptions[ip] = {
        "pullpoint":     pullpoint,
        "event_service": event_service,
        "expires_at":    expires_at,
        "cam":           cam,
    }

    return pullpoint, event_service


def _invalidate_subscription(ip: str) -> None:
    """Remove a cached subscription so the next call creates a fresh one."""
    if ip in _subscriptions:
        try:
            _subscriptions[ip]["event_service"].Unsubscribe({})
        except Exception:
            pass
        del _subscriptions[ip]
        print(f"[BOSCH] 🗑  Invalidated subscription for {ip}")


def pull_bosch_events(
    ip: str,
    port: int = 80,
    username: str = "",
    password: str = "",
    timeout_seconds: int = 5,
    max_messages: int = 50,
) -> dict:
    """
    Pull pending ONVIF events from a Bosch camera using a persistent
    PullPoint subscription.

    Returns
    -------
    {
        "success": bool,
        "events":  list[dict],
        "error":   str | None,
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
        pullpoint, event_service = _get_or_create_subscription(
            ip, port, username, password, timeout_seconds
        )

        # ── Pull messages ──────────────────────────────────────────────
        pull_request = {
            "MessageLimit": max_messages,
            "Timeout":      f"PT{timeout_seconds}S",
        }

        try:
            response = pullpoint.PullMessages(pull_request)
        except Exception as pull_err:
            # Subscription likely expired — invalidate and retry once
            print(f"[BOSCH] ⚠ PullMessages failed for {ip}: {pull_err} — re-subscribing")
            _invalidate_subscription(ip)
            pullpoint, event_service = _get_or_create_subscription(
                ip, port, username, password, timeout_seconds
            )
            response = pullpoint.PullMessages(pull_request)

        notifications = getattr(response, "NotificationMessage", []) or []

        # ── Log raw notification count for debugging ───────────────────
        if notifications:
            print(f"[BOSCH] {ip} → {len(notifications)} raw notification(s)")
        else:
            print(f"[BOSCH] {ip} reachable, no events currently")

        # ── Normalise each notification ────────────────────────────────
        for notif in notifications:
            topic = _topic_str(getattr(notif, "Topic", None))

            # UTC time: prefer Message.UtcTime
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

            # Extract SimpleItem key-value pairs from Source + Data
            raw: dict[str, Any] = {"topic": topic}
            try:
                msg      = getattr(notif, "Message", None)
                msg_body = getattr(msg, "Message", msg) if msg else None
                if msg_body:
                    for section_name in ("Source", "Data"):
                        section = getattr(msg_body, section_name, None)
                        if section:
                            for item in (getattr(section, "SimpleItem", []) or []):
                                key = _safe_str(getattr(item, "Name",  ""))
                                val = _safe_str(getattr(item, "Value", ""))
                                if key:
                                    raw[key] = val
            except Exception:
                pass

            # Also log the PropertyOperation (Changed / Initialized / Deleted)
            try:
                msg = getattr(notif, "Message", None)
                if msg:
                    msg_inner = getattr(msg, "Message", msg)
                    op = getattr(msg_inner, "PropertyOperation", None)
                    if op:
                        raw["PropertyOperation"] = _safe_str(op)
            except Exception:
                pass

            event_type = _map_event_type(topic)

            # ── Only emit events where something actually happened ─────
            # Bosch sends "Initialized" notifications on subscription start
            # (current state snapshot). We want only "Changed" = real triggers.
            prop_op = raw.get("PropertyOperation", "").lower()
            if prop_op == "initialized":
                # Skip snapshot/baseline events
                continue

            # For Value-based motion topics, only emit when Value is True/1
            value = raw.get("Value", "").lower()
            if value in ("false", "0", "inactive", "no"):
                continue

            events.append({
                "event_type": event_type,
                "topic":      topic,
                "utc_time":   utc_time,
                "source":     "bosch",
                "raw":        raw,
            })

        if events:
            print(f"[BOSCH] ✅ {ip} → {len(events)} actionable event(s)")

        return {"success": True, "events": events, "error": None}

    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[BOSCH] ❌ {ip}: {exc}\n{tb}")
        # Invalidate the cached subscription on any hard error
        _invalidate_subscription(ip)
        return {"success": False, "events": [], "error": str(exc)}