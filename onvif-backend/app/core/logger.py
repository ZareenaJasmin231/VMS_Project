import os
import logging
from logging.handlers import TimedRotatingFileHandler

LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")

security_logger = logging.getLogger("vms_security")
security_logger.setLevel(logging.INFO)

log_file = os.path.join(LOG_DIR, "security.log")
handler = TimedRotatingFileHandler(
    log_file,
    when="midnight",
    interval=1,
    backupCount=180,  # 180 days CERT-In compliance
    encoding="utf-8"
)
handler.setFormatter(formatter)

if not security_logger.handlers:
    security_logger.addHandler(handler)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    security_logger.addHandler(console_handler)

def log_security_event(level: str, event_type: str, message: str, ip_address: str = "Unknown"):
    log_message = f"[{event_type}] [IP: {ip_address}] {message}"
    if level.upper() == "WARNING":
        security_logger.warning(log_message)
    elif level.upper() == "ERROR":
        security_logger.error(log_message)
    elif level.upper() == "CRITICAL":
        security_logger.critical(log_message)
    else:
        security_logger.info(log_message)
