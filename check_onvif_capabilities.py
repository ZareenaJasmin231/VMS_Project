from onvif import ONVIFCamera

cam = ONVIFCamera(
    "192.168.126.240",
    80,
    "admin",
    "admin123"
)

events = cam.create_events_service()

try:
    props = events.GetEventProperties()
    print("SUCCESS")
    print(props)
except Exception as e:
    print("FAILED")
    print(e)