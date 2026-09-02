import asyncio
import websockets
import sys

uri = "ws://192.168.126.35:8083/vms/analytics/alerts"
if len(sys.argv) > 1:
    uri = sys.argv[1]

async def listen_websocket():
    print(f"Attempting to connect to WebSocket at: {uri} ...")
    try:
        async with websockets.connect(uri) as websocket:
            print("[SUCCESS] Connected to WebSocket!")
            print("Listening for incoming alerts...")
            while True:
                message = await websocket.recv()
                print("=" * 50)
                print(f"✅ NEW WEBSOCKET ALERT RECEIVED")
                print("=" * 50)
                print(message)
                print("=" * 50 + "\n")
    except Exception as e:
        print(f"\n[ERROR] Failed to connect or read from WebSocket: {e}")
        print("Note: If the port is different, run: python check_ai_websocket.py ws://192.168.126.35:<PORT>/path")

if __name__ == "__main__":
    asyncio.run(listen_websocket())
