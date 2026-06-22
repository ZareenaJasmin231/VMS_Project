from dahua_adapter import pull_dahua_events

result = pull_dahua_events(
    ip="192.168.126.233",
    port=80,
    username="admin",
    password="Admin123$"
)

print(result)