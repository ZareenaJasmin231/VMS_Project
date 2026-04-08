"""
Analytics WebSocket Routes
Real-time metadata streaming
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging
from datetime import datetime

# Create router - THIS IS THE MISSING LINE
router = APIRouter()
logger = logging.getLogger(__name__)


class ConnectionManager:
    """WebSocket connection manager"""
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_message(self, message: dict, websocket: WebSocket):
        await websocket.send_json(message)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass


manager = ConnectionManager()


@router.websocket("/analytics/{device_id}")
async def analytics_websocket(websocket: WebSocket, device_id: str):
    """WebSocket endpoint for real-time analytics events"""
    await manager.connect(websocket)
    logger.info(f"Analytics WebSocket connected for device {device_id}")
    
    try:
        # Send initial connection message
        await manager.send_message({
            "type": "connected",
            "device_id": device_id,
            "timestamp": datetime.utcnow().isoformat()
        }, websocket)
        
        # Keep connection alive and listen for messages
        while True:
            data = await websocket.receive_text()
            # Handle client messages (e.g., subscribe to specific rules)
            try:
                import json
                msg = json.loads(data)
                logger.debug(f"Received from client: {msg}")
            except:
                pass
                
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info(f"Analytics WebSocket disconnected for device {device_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)