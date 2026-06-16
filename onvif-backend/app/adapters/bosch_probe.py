"""
bosch_probe.py
══════════════
LIVE DIAGNOSTIC TOOL — Loops continuously, auto-reconnects, prints ONLY
real analytics events (Line Crossing, Motion, Object Detection).

HOW TO USE:
  1. Run:  python bosch_probe.py
  2. Walk in front of camera .235  (Detect any object)
  3. Cross the line in front of camera .238  (Crossing line 1)
  4. Watch events print here. Press Ctrl+C to stop.
"""

import time
from datetime import datetime, timedelta
from onvif import ONVIFCamera
from lxml import etree

# ── CONFIGURE YOUR CAMERAS ────────────────────────────────────────────────────
CAMERAS = [
    {"ip": "192.168.126.235", "port": 80, "username": "service", "password": "Admin123!"},
    {"ip": "192.168.126.238", "port": 80, "username": "service", "password": "Admin123!"},
]
# ─────────────────────────────────────────────────────────────────────────────

# Topics to IGNORE (stream stats, not analytics)
IGNORE_TOPICS = {
    "tns1:Monitoring/Profile/ActiveConnections",
    "tns1:Device/Trigger/Relay",
    "tns1:Device/Trigger/DigitalInput",
    "tns1:VideoSource/ImageTooBright/AnalyticsService",
    "tns1:VideoSource/ImageTooDark/AnalyticsService",
    "tns1:VideoSource/SignalLoss/AnalyticsService",
}

POLL_INTERVAL    = 1     # seconds between polls
SUB_LIFETIME_S   = 240   # renew subscription before 5 min expires
PULL_LIMIT       = 50


def get_topic(notif):
    """Extract topic via XML path (zeep path always returns None on Bosch)."""
    try:
        msg = getattr(notif, "Message", None)
        if msg and hasattr(msg, "_value_1"):
            el = msg._value_1
            if hasattr(el, "getparent"):
                gp = el.getparent()
                if gp is not None:
                    ggp = gp.getparent()
                    if ggp is not None:
                        tops = ggp.xpath(".//*[local-name()='Topic']")
                        if tops and tops[0].text:
                            return tops[0].text.strip()
    except Exception:
        pass
    return None


def get_body(notif):
    """Return lxml Message element, or None."""
    try:
        msg = getattr(notif, "Message", None)
        if msg and hasattr(msg, "_value_1"):
            body = msg._value_1
            if hasattr(body, "tag"):
                return body
    except Exception:
        pass
    return None


def connect_camera(cfg):
    """
    Connect and create a pullpoint. Returns dict with session info, or None.
    Binds pullpoint to subscription address (required for Bosch).
    """
    ip, port = cfg["ip"], cfg["port"]
    user, pwd = cfg["username"], cfg["password"]

    try:
        cam = ONVIFCamera(ip, port, user, pwd)

        # Device info
        try:
            dev  = cam.create_devicemgmt_service()
            info = dev.GetDeviceInformation()
            print(f"  [{ip}] ✅ {info.Manufacturer} {info.Model} fw={info.FirmwareVersion}")
        except Exception:
            print(f"  [{ip}] ✅ Connected (device info unavailable)")

        # Create subscription
        event_svc = cam.create_events_service()
        try:
            sub = event_svc.CreatePullPointSubscription({"InitialTerminationTime": f"PT{SUB_LIFETIME_S}S"})
        except Exception:
            sub = event_svc.CreatePullPointSubscription({})

        # Bind pullpoint to the subscription's own address (Bosch requirement)
        pullpoint = cam.create_pullpoint_service()
        try:
            addr = sub.SubscriptionReference.Address
            addr_str = str(addr._value_1) if hasattr(addr, "_value_1") else str(addr)
            if addr_str and addr_str != "None":
                pullpoint._client._binding_options["address"] = addr_str
                print(f"  [{ip}] 📌 Bound to subscription address: {addr_str}")
        except Exception:
            pass

        # Find working timeout
        working_timeout = "PT1S"
        for t in ["PT0S", "PT1S", "PT5S"]:
            try:
                pullpoint.PullMessages({"MessageLimit": 1, "Timeout": t})
                working_timeout = t
                print(f"  [{ip}] ✅ Working timeout = {t}")
                break
            except Exception:
                continue

        return {
            "ip":          ip,
            "cfg":         cfg,
            "pullpoint":   pullpoint,
            "event_svc":   event_svc,
            "timeout":     working_timeout,
            "expires_at":  datetime.utcnow() + timedelta(seconds=SUB_LIFETIME_S - 30),
        }

    except Exception as e:
        print(f"  [{ip}] ❌ Connection failed: {e}")
        return None


def renew_session(session):
    """Re-subscribe when session is about to expire."""
    ip = session["ip"]
    print(f"\n  [{ip}] 🔄 Renewing subscription...")
    new_session = connect_camera(session["cfg"])
    if new_session:
        print(f"  [{ip}] ✅ Renewed")
    return new_session


def pull_and_print(session):
    """Pull messages, print only real analytics events. Returns updated session."""
    ip        = session["ip"]
    pullpoint = session["pullpoint"]
    timeout   = session["timeout"]

    # Auto-renew before expiry
    if datetime.utcnow() >= session["expires_at"]:
        session = renew_session(session)
        if session is None:
            return None
        pullpoint = session["pullpoint"]
        timeout   = session["timeout"]

    try:
        response = pullpoint.PullMessages({
            "MessageLimit": PULL_LIMIT,
            "Timeout":      timeout,
        })
    except Exception as e:
        err = str(e).lower()
        if "argument value invalid" in err or "soap" in err or "expired" in err:
            # Subscription expired — re-subscribe
            print(f"\n  [{ip}] ⚠ Subscription expired — reconnecting...")
            session = renew_session(session)
            return session
        return session  # other errors — keep going

    notifications = getattr(response, "NotificationMessage", []) or []

    for notif in notifications:
        topic = get_topic(notif)
        body  = get_body(notif)

        if body is None or topic is None:
            continue

        prop_op  = (body.get("PropertyOperation") or "").strip()
        utc_time = body.get("UtcTime", "")

        # Skip baseline snapshots (except for occupancy)
        if prop_op.lower() == "initialized" and "occupancy" not in topic.lower():
            continue

        # Skip ignored topics (stream stats, relay, etc.)
        if topic in IGNORE_TOPICS:
            continue

        # Get all SimpleItems
        simple_items = body.xpath(".//*[local-name()='SimpleItem']")
        data = {}
        for si in simple_items:
            name = si.get("Name")
            val  = si.get("Value")
            if name:
                data[name] = val

        # Skip "off" / ended states — only show active triggers
        state_val = (
            data.get("State") or data.get("Value") or
            data.get("Active") or data.get("LogicalState") or ""
        ).lower()
        if state_val in ("false", "0", "inactive", "no", "off"):
            continue

        # ── PRINT REAL ANALYTICS EVENT ─────────────────────────────────
        now = datetime.now().strftime("%H:%M:%S")
        print(f"\n{'='*60}")
        print(f"  🔴 ANALYTICS EVENT  [{now}]")
        print(f"  Camera    : {ip}")
        print(f"  Topic     : {topic}")
        print(f"  PropOp    : {prop_op}")
        print(f"  UtcTime   : {utc_time}")
        if data:
            print(f"  Data      :")
            for k, v in data.items():
                print(f"    {k} = {v}")
        else:
            print(f"  Data      : (no SimpleItems — see XML below)")
        print(f"\n  -- Full XML --")
        print(etree.tostring(body, pretty_print=True).decode())
        print(f"{'='*60}")

    return session


if __name__ == "__main__":
    print(f"\n{'#'*60}")
    print(f"#  BOSCH LIVE ANALYTICS PROBE")
    print(f"#  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"#  Monitoring topics only (stream stats ignored)")
    print(f"#  Press Ctrl+C to stop")
    print(f"{'#'*60}")
    print()

    # Connect to all cameras
    sessions = []
    for cfg in CAMERAS:
        print(f"\n[CONNECTING] {cfg['ip']} ...")
        s = connect_camera(cfg)
        if s:
            sessions.append(s)

    if not sessions:
        print("\n❌ No cameras connected.")
        exit(1)

    print(f"\n{'─'*60}")
    print(f"✅ Watching {len(sessions)} camera(s)")
    print(f"")
    print(f"  👉 NOW physically trigger events:")
    print(f"     • Walk past / cross line on camera 192.168.126.238")
    print(f"     • Move in front of camera 192.168.126.235")
    print(f"")
    print(f"  Waiting for analytics events...")
    print(f"  (Stream stats and relay events are filtered out)")
    print(f"{'─'*60}\n")

    total_events = 0
    tick = 0
    try:
        while True:
            for i, s in enumerate(sessions):
                updated = pull_and_print(s)
                if updated is not None:
                    sessions[i] = updated

            tick += 1
            spinner = ["|", "/", "-", "\\"][tick % 4]
            print(f"  {spinner} polling... (real analytics events: {total_events})", end="\r")
            time.sleep(POLL_INTERVAL)

    except KeyboardInterrupt:
        print(f"\n\n[STOPPED] Total analytics events captured: {total_events}")
        print("Done.\n")