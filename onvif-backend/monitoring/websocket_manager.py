from fastapi import WebSocket
from typing import List
import json
import asyncio


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.loop = None  # ✅ FIX #7: store event loop for thread-safe broadcasts

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.loop = asyncio.get_event_loop()  # ✅ capture running loop on first connect
        print(f"[WS] New connection. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"[WS] Connection closed. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        """Broadcasts a JSON message to all connected clients."""
        if not self.active_connections:
            return

        disconnected = []
        payload = json.dumps(message, default=str)  # ✅ default=str handles datetime serialization

        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                disconnected.append(connection)

        for conn in disconnected:
            self.disconnect(conn)


# Global manager instance
manager = ConnectionManager()