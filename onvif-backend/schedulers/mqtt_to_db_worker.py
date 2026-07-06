import os
import json
import asyncio
import paho.mqtt.client as mqtt
from app.core.database import mongo_client
from datetime import datetime, timezone, timedelta

# ── Config ─────────────────────────────────────────────────────────
MQTT_BROKER =  "192.168.126.36"
MQTT_PORT   = int(os.environ.get("MQTT_PORT", 1883))
MQTT_TOPIC  = "axis/#"

MONGO_URI   = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB    = os.environ.get("MONGO_DB_NAME", "vms_db")
MONGO_COL   = "mqtt_logs"

SKIP_TOPICS = {"connection", "status", "birth", "lwt"}

# ───────────────────────────────────────────────────────────────────
IST = timezone(timedelta(hours=5, minutes=30))

mongo_client = mongo_client
collection   = mongo_client[MONGO_DB][MONGO_COL]


def break_topic(topic: str) -> dict:
    try:
        if "tns:axis/" in topic:
            topic = topic.split("tns:axis/")[-1]
            topic = f"axis:{topic}"

        stripped = topic.replace("axis:", "")
        parts = stripped.split("/")

        return {
            "topic": topic,
            "topic_platform": parts[0] if len(parts) > 0 else None,
            "topic_analytics": parts[1] if len(parts) > 1 else None,
            "topic_event": parts[2] if len(parts) > 2 else None,
        }

    except Exception:
        return {
            "topic": topic,
            "topic_platform": None,
            "topic_analytics": None,
            "topic_event": None,
        }


# ── MQTT Callbacks ─────────────────────────────────────────────────
def on_connect(client, userdata, flags, reason_code, properties):
    print(f"[MQTT] Connected to {MQTT_BROKER}:{MQTT_PORT} (rc={reason_code})")
    client.subscribe(MQTT_TOPIC, qos=1)


def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
    except Exception:
        print(f"[SKIP] Invalid JSON: {msg.topic}")
        return

    # Skip unwanted topics
    if msg.topic.split("/")[-1].lower() in SKIP_TOPICS:
        print(f"[SKIP] {msg.topic}")
        return

    print("\n========== NEW EVENT ==========")
    print("TOPIC:", msg.topic)

    data = payload.get("message", {}).get("data", {})
    print("DATA:", json.dumps(data, indent=2))

    # ✅ Accept only valid events
    if not data:
        return

    # ✅ Convert topic
    topic_parts = break_topic(msg.topic)

    # ─────────────────────────────────────────
    # 🔥 EXTRACT IP FROM TOPIC (IMPORTANT FIX)
    # ─────────────────────────────────────────
    topic_ip = None
    try:
        parts = msg.topic.split("/")
        # Example: axis/192.168.126.240/event/...
        if len(parts) > 1:
            topic_ip = parts[1]
    except Exception:
        topic_ip = None

    # Convert to folder format
    if topic_ip:
        topic_ip = topic_ip.replace(".", "_")

    print(f"[IP EXTRACTED] {topic_ip}")

    # ─────────────────────────────────────────
    # ✅ Event name + type
    # ─────────────────────────────────────────
    scenario      = data.get("scenario")
    scenario_type = data.get("scenarioType")

    event_type = scenario_type or topic_parts.get("topic_event") or "Unknown"
    event_name = scenario or scenario_type or topic_parts.get("topic_event") or "Unknown"

    event_type = str(event_type).strip()
    event_name = str(event_name).strip()

    # ─────────────────────────────────────────
    # ✅ FINAL DOCUMENT
    # ─────────────────────────────────────────
    document = {
        "received_at": datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S+05:30"),

        "topic": topic_parts["topic"],
        "topic_platform": topic_parts["topic_platform"],
        "topic_analytics": topic_parts["topic_analytics"],
        "topic_event": topic_parts["topic_event"],

        "timestamp": payload.get("timestamp"),

        # ✅ FIXED (NOW WILL NOT BE NULL)
        "ip": topic_ip,

        "serial": payload.get("serial"),

        "time": data.get("triggerTime"),
        "scenario": event_name,
        "type": event_type,

        "human": data.get("human"),
        "total": data.get("total"),
        "class": data.get("classTypes"),
        "object_id": data.get("objectId"),

        "active": data.get("active"),
        "status": "Active",

        "message": {
            "source": payload.get("message", {}).get("source", {}),
            "key": payload.get("message", {}).get("key", {}),
            "data": data
        }
    }

    result = collection.insert_one(document)
    print(f"[SAVED] {result.inserted_id} | type={event_type} | scenario={event_name}")


# ── Run Client ─────────────────────────────────────────────────────
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect
client.on_message = on_message

def start_mqtt():
    print(f"[MQTT] Connecting to {MQTT_BROKER}:{MQTT_PORT} ...")
    client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
    client.loop_forever()

if __name__ == "__main__":
    start_mqtt()
