import os
import json
import paho.mqtt.client as mqtt
from pymongo import MongoClient
from datetime import datetime, timezone, timedelta

# ── Config ─────────────────────────────────────────────────────────
MQTT_BROKER = "192.168.126.200"
MQTT_PORT   = int(os.environ.get("MQTT_PORT", 1883))
MQTT_TOPIC  = "axis/#"

MONGO_URI   = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB    = "mirador-vms"
MONGO_COL   = "mqtt_logs"

SKIP_TOPICS = {"connection", "status", "birth", "lwt"}

# ───────────────────────────────────────────────────────────────────
IST = timezone(timedelta(hours=5, minutes=30))

mongo_client = MongoClient(MONGO_URI)
collection   = mongo_client[MONGO_DB][MONGO_COL]


# ✅ FIXED: Convert new topic → old structure
def break_topic(topic: str) -> dict:
    try:
        # Extract analytics part
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

    print(f"\n[RECEIVED] {msg.topic}")

    data = payload.get("message", {}).get("data", {})

    # ✅ Only store REAL alerts
    if data.get("active") != "1":
        return

    # ✅ Convert topic to old format
    topic_parts = break_topic(msg.topic)

    document = {
        "received_at": datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S+05:30"),

        # ── Topic (UI depends on this) ──
        "topic": topic_parts["topic"],
        "topic_platform": topic_parts["topic_platform"],
        "topic_analytics": topic_parts["topic_analytics"],
        "topic_event": topic_parts["topic_event"],

        # ── Camera Info ──
        "timestamp": payload.get("timestamp"),
        "serial": payload.get("serial"),

        # ── Event Data ──
        "message": {
            "source": payload.get("message", {}).get("source", {}),
            "key": payload.get("message", {}).get("key", {}),
            "data": {
                "triggerTime": data.get("triggerTime"),
                "active": True,   # boolean for UI
                "objectId": data.get("objectId"),
                "classTypes": data.get("classTypes"),
            }
        }
    }

    result = collection.insert_one(document)
    print(f"[SAVED] {result.inserted_id}")


# ── Run Client ─────────────────────────────────────────────────────
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect
client.on_message = on_message

print(f"[MQTT] Connecting to {MQTT_BROKER}:{MQTT_PORT} ...")
client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)

client.loop_forever()