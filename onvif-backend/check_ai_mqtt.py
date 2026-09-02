import paho.mqtt.client as mqtt
import sys

# Allow the user to specify a topic, otherwise default to all analytics
target_topic = "vms/analytics/#"
if len(sys.argv) > 1:
    target_topic = sys.argv[1]

def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print("[SUCCESS] Connected to MQTT broker.")
        client.subscribe(target_topic)
        print(f"[LISTENING] Subscribed specifically to: {target_topic}")
        print("Waiting for data from the other team...\n")
    else:
        print(f"[ERROR] Failed to connect, return code {rc}\n")

def on_message(client, userdata, msg):
    print("=" * 50)
    print(f"✅ NEW MESSAGE RECEIVED ON TOPIC: {msg.topic}")
    print("=" * 50)
    print(msg.payload.decode('utf-8', errors='ignore'))
    print("=" * 50 + "\n")

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect
client.on_message = on_message

try:
    print("Connecting to local broker (192.168.126.2:1883)...")
    client.connect("192.168.126.2", 1883, 60)
    client.loop_forever()
except KeyboardInterrupt:
    print("\n[STOPPED] Listening stopped by user.")
except Exception as e:
    print(f"\n[ERROR] Could not connect to MQTT: {e}")
