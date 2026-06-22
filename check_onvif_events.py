from onvif import ONVIFCamera
import time

IP = "192.168.126.240"
PORT = 80
USERNAME = "admin"
PASSWORD = "admin123"

print(f"\nConnecting to {IP}...\n")

cam = ONVIFCamera(IP, PORT, USERNAME, PASSWORD)

events = cam.create_events_service()

try:
    sub = events.CreatePullPointSubscription()
    print("✅ PullPoint subscription created")
except Exception as e:
    print("❌ Subscription failed:", e)
    raise

pullpoint = cam.create_pullpoint_service()

try:
    addr = str(sub.SubscriptionReference.Address)
    pullpoint._client._binding_options["address"] = addr
except Exception:
    pass

print("\n========================================")
print("Waiting for ONVIF events...")
print("Trigger Intrusion / Line Crossing now")
print("Press Ctrl+C to stop")
print("========================================\n")

while True:
    try:
        msgs = pullpoint.PullMessages({
            "Timeout": "PT5S",
            "MessageLimit": 20
        })

        notifications = getattr(msgs, "NotificationMessage", [])

        if notifications:
            print(f"\n🔥 RECEIVED {len(notifications)} EVENT(S)\n")

        for n in notifications:

            try:
                topic = ""
                if hasattr(n, "Topic"):
                    if hasattr(n.Topic, "_value_1"):
                        topic = str(n.Topic._value_1)

                print("------------------------------------------------")
                print("TOPIC :", topic)

                try:
                    msg = n.Message._value_1

                    print("UTC   :", msg.get("UtcTime"))

                    for section_name in ["Source", "Data", "Key"]:
                        section = msg.find(
                            "{http://www.onvif.org/ver10/schema}" + section_name
                        )

                        if section is not None:
                            print(f"\n[{section_name}]")

                            for item in section:
                                print(
                                    f"{item.get('Name')} = {item.get('Value')}"
                                )

                except Exception as e:
                    print("Message parse error:", e)

                print("------------------------------------------------\n")

            except Exception as e:
                print("Event error:", e)

        time.sleep(1)

    except KeyboardInterrupt:
        print("\nStopped.")
        break

    except Exception as e:
        print("Pull error:", e)
        time.sleep(5)