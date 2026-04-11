import os
import json
import paho.mqtt.client as mqtt
from pymongo import MongoClient
from datetime import datetime, timezone, timedelta

# ── Config ────────────────────────────────────────────────────────────────────
MQTT_BROKER  = os.environ.get("MQTT_BROKER", "localhost")
MQTT_PORT    = int(os.environ.get("MQTT_PORT", 1883))
MQTT_TOPIC   = "axis/#"

MONGO_URI    = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB     = "mirador-vms"
MONGO_COL    = "mqtt_logs"          # ← stores raw MQTT data here

SKIP_TOPICS  = {"connection", "status", "birth", "lwt"}
# ─────────────────────────────────────────────────────────────────────────────

IST = timezone(timedelta(hours=5, minutes=30))

mongo_client = MongoClient(MONGO_URI)
collection   = mongo_client[MONGO_DB][MONGO_COL]


def break_topic(topic: str) -> dict:
    try:
        stripped = topic.replace("axis:", "")
        parts    = stripped.split("/")
        return {
            "topic":           topic,
            "topic_platform":  parts[0] if len(parts) > 0 else None,
            "topic_analytics": parts[1] if len(parts) > 1 else None,
            "topic_event":     parts[2] if len(parts) > 2 else None,
        }
    except Exception:
        return {
            "topic":           topic,
            "topic_platform":  None,
            "topic_analytics": None,
            "topic_event":     None,
        }


def on_connect(client, userdata, flags, reason_code, properties):
    print(f"[MQTT] Connected to {MQTT_BROKER}:{MQTT_PORT} (rc={reason_code}). Subscribing to '{MQTT_TOPIC}'")
    client.subscribe(MQTT_TOPIC, qos=1)


def on_message(client, userdata, msg):
    if msg.topic.split("/")[-1].lower() in SKIP_TOPICS:
        print(f"[SKIP] {msg.topic}")
        return

    try:
        payload = json.loads(msg.payload.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        print(f"[SKIP] Non-JSON payload on: {msg.topic}")
        return

    if not payload.get("serial"):
        print(f"[SKIP] No serial on: {msg.topic}")
        return

    data        = payload.get("message", {}).get("data", {})
    topic_parts = break_topic(payload.get("topic", ""))

    document = {
        "received_at":     datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S+05:30"),

        # ── Topic (broken down) ───────────────────────────────────────────────
        "topic":           topic_parts["topic"],
        "topic_platform":  topic_parts["topic_platform"],
        "topic_analytics": topic_parts["topic_analytics"],
        "topic_event":     topic_parts["topic_event"],

        # ── Camera Info ───────────────────────────────────────────────────────
        "timestamp":       payload.get("timestamp"),
        "serial":          payload.get("serial"),

        # ── Event Data ────────────────────────────────────────────────────────
        "message": {
            "source": payload.get("message", {}).get("source", {}),
            "key":    payload.get("message", {}).get("key",    {}),
            "data": {
                "triggerTime": data.get("triggerTime", None),
                "active":      data.get("active") == "1",
                "objectId":    data.get("objectId",   None),
                "classTypes":  data.get("classTypes", None),
            }
        }
    }

    result = collection.insert_one(document)

    print(
        f"\n{'─'*60}\n"
        f"  received_at      : {document['received_at']}\n"
        f"  topic            : {document['topic']}\n"
        f"  topic_platform   : {document['topic_platform']}\n"
        f"  topic_analytics  : {document['topic_analytics']}\n"
        f"  topic_event      : {document['topic_event']}\n"
        f"  serial           : {document['serial']}\n"
        f"  triggerTime      : {document['message']['data']['triggerTime']}\n"
        f"  active           : {document['message']['data']['active']}\n"
        f"  objectId         : {document['message']['data']['objectId']}\n"
        f"  classTypes       : {document['message']['data']['classTypes']}\n"
        f"  mongo_id         : {result.inserted_id}\n"
        f"{'─'*60}"
    )


client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect
client.on_message = on_message

print(f"[MQTT] Connecting to {MQTT_BROKER}:{MQTT_PORT} ...")
client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
client.loop_forever()