"""
email_alerts.py
───────────────
Sends email notifications for infrastructure events.

Configure via environment variables:
  ALERT_EMAIL_FROM     → sender address
  ALERT_EMAIL_TO       → recipient address (comma-separated for multiple)
  SMTP_HOST            → SMTP server host       (default: smtp.gmail.com)
  SMTP_PORT            → SMTP server port       (default: 587)
  SMTP_USER            → SMTP login username
  SMTP_PASSWORD        → SMTP login password
  ALERT_EMAILS_ENABLED → set to "false" to disable all emails (default: true)
"""
import os
import smtplib
import threading
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime

# ── Config ────────────────────────────────────────────────────────────────

ALERT_FROM    = os.environ.get("ALERT_EMAIL_FROM", "alerts@mirador-vms.local")
ALERT_TO_RAW  = os.environ.get("ALERT_EMAIL_TO", "")
ALERT_TO      = [e.strip() for e in ALERT_TO_RAW.split(",") if e.strip()]
SMTP_HOST     = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER     = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
EMAILS_ENABLED = os.environ.get("ALERT_EMAILS_ENABLED", "true").lower() != "false"


# ── Core sender ───────────────────────────────────────────────────────────

def _send_email(subject: str, html_body: str):
    """
    Sends an email in a background thread so it never blocks the event loop.
    Silently logs on failure — never raises.
    """
    if not EMAILS_ENABLED:
        print(f"[EMAIL] (disabled) Would send: {subject}")
        return
    if not ALERT_TO:
        print(f"[EMAIL] No recipient configured (ALERT_EMAIL_TO). Skipping: {subject}")
        return

    def _worker():
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"]    = ALERT_FROM
            msg["To"]      = ", ".join(ALERT_TO)
            msg.attach(MIMEText(html_body, "html"))

            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
                server.ehlo()
                server.starttls()
                if SMTP_USER and SMTP_PASSWORD:
                    server.login(SMTP_USER, SMTP_PASSWORD)
                server.sendmail(ALERT_FROM, ALERT_TO, msg.as_string())
            print(f"[EMAIL] Sent: {subject}")
        except Exception as e:
            print(f"[EMAIL] Failed to send '{subject}': {e}")

    threading.Thread(target=_worker, daemon=True).start()


def _ts() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")


def _base_template(color: str, icon: str, title: str, rows: list[tuple]) -> str:
    """Minimal HTML email template."""
    row_html = "".join(
        f"<tr><td style='padding:6px 12px;color:#9ca3af;font-size:13px'>{k}</td>"
        f"<td style='padding:6px 12px;color:#f3f4f6;font-size:13px'>{v}</td></tr>"
        for k, v in rows
    )
    return f"""
    <div style='font-family:sans-serif;background:#111827;padding:24px;border-radius:8px;max-width:520px'>
      <div style='border-left:4px solid {color};padding-left:16px;margin-bottom:20px'>
        <div style='font-size:22px;margin-bottom:4px'>{icon}</div>
        <h2 style='margin:0;color:#f9fafb;font-size:18px'>{title}</h2>
      </div>
      <table style='width:100%;border-collapse:collapse;background:#1f2937;border-radius:6px;overflow:hidden'>
        {row_html}
      </table>
      <p style='color:#6b7280;font-size:11px;margin-top:16px'>Mirador VMS · {_ts()}</p>
    </div>
    """


# ── Public alert functions ────────────────────────────────────────────────

def alert_device_offline(device_name: str, ip: str):
    """Fired when a camera or device goes offline."""
    _send_email(
        subject=f"🔴 Device Offline: {device_name} ({ip})",
        html_body=_base_template(
            color="#ef4444", icon="🔴",
            title=f"Device Offline: {device_name}",
            rows=[
                ("Device", device_name),
                ("IP Address", ip),
                ("Status", "<span style='color:#ef4444'>OFFLINE</span>"),
                ("Time", _ts()),
                ("Action", "Check device power and network connection."),
            ]
        )
    )


def alert_nvr_unreachable(device_name: str, ip: str):
    """Fired when the NVR management port (80) becomes unreachable."""
    _send_email(
        subject=f"🟠 NVR Unreachable: {device_name} ({ip})",
        html_body=_base_template(
            color="#f97316", icon="🟠",
            title=f"NVR Unreachable: {device_name}",
            rows=[
                ("Device", device_name),
                ("IP Address", ip),
                ("Port", "80 (NVR management)"),
                ("Status", "<span style='color:#f97316'>UNREACHABLE</span>"),
                ("Time", _ts()),
                ("Action", "Verify NVR service is running on the device."),
            ]
        )
    )


def alert_bandwidth_spike(device_name: str, total_mbps: float):
    """Fired when total network bandwidth exceeds the spike threshold."""
    _send_email(
        subject=f"⚡ Bandwidth Spike: {total_mbps:.1f} Mbps on {device_name}",
        html_body=_base_template(
            color="#f59e0b", icon="⚡",
            title=f"Bandwidth Spike Detected",
            rows=[
                ("Device", device_name),
                ("Total Bandwidth", f"<span style='color:#f59e0b'>{total_mbps:.1f} Mbps</span>"),
                ("Threshold", f"{os.environ.get('BW_SPIKE_THRESHOLD_KBPS', '50000')} kbps"),
                ("Time", _ts()),
                ("Action", "Check for unusual traffic or streaming issues."),
            ]
        )
    )


def alert_unexpected_reboot(device_name: str, ip: str):
    """Fired when a device reboots unexpectedly (boot time changes mid-session)."""
    _send_email(
        subject=f"⚠️ Unexpected Reboot: {device_name} ({ip})",
        html_body=_base_template(
            color="#a855f7", icon="⚠️",
            title=f"Unexpected Reboot: {device_name}",
            rows=[
                ("Device", device_name),
                ("IP Address", ip),
                ("Event", "<span style='color:#a855f7'>UNEXPECTED REBOOT DETECTED</span>"),
                ("Time", _ts()),
                ("Action", "Investigate power stability or software crash logs."),
            ]
        )
    )


def alert_switch_port_down(device_name: str, ip: str, port_name: str):
    """Fired when a monitored switch port transitions from UP to DOWN."""
    _send_email(
        subject=f"🔌 Switch Port Down: {port_name.upper()} on {device_name} ({ip})",
        html_body=_base_template(
            color="#ef4444", icon="🔌",
            title=f"Switch Port Down: {port_name.upper()}",
            rows=[
                ("Device", device_name),
                ("IP Address", ip),
                ("Port", port_name.upper()),
                ("Status", "<span style='color:#ef4444'>DOWN</span>"),
                ("Time", _ts()),
                ("Action", "Check the cable or device connected to this port."),
            ]
        )
    )
