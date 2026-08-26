import json
import logging
from typing import Optional, List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from app.core.ws_manager import ws_manager

logger = logging.getLogger("events_ws_router")

router = APIRouter(prefix="/ws", tags=["WebSocket Events"])

@router.websocket("/events")
async def websocket_events_endpoint(
    websocket: WebSocket,
    topics: Optional[str] = Query(None, description="Comma separated initial topics to subscribe to, e.g. 'alerts,camera_status'")
):
    """
    Unified WebSocket endpoint for real-time VMS events.
    Supports topic subscriptions, ping/pong heartbeats, and standardized envelope responses.
    """
    initial_topics: Optional[List[str]] = None
    if topics:
        initial_topics = [t.strip() for t in topics.split(",") if t.strip()]

    await ws_manager.connect(websocket, initial_topics=initial_topics)

    try:
        while True:
            raw_data = await websocket.receive_text()
            if not raw_data:
                continue

            try:
                payload = json.loads(raw_data)
            except Exception:
                logger.warning(f"[WS] Received non-JSON message: {raw_data}")
                await websocket.send_json({
                    "topic": "system",
                    "event": "error",
                    "timestamp": "",
                    "event_id": "",
                    "data": {"message": "Invalid JSON format"}
                })
                continue

            action = payload.get("action") or payload.get("event")

            if action == "ping":
                # Handle heartbeat
                await websocket.send_json({
                    "topic": "system",
                    "event": "pong",
                    "timestamp": payload.get("timestamp", ""),
                    "event_id": payload.get("event_id", ""),
                    "data": {"status": "alive"}
                })

            elif action == "subscribe":
                req_topics = payload.get("topics", [])
                if isinstance(req_topics, list):
                    await ws_manager.subscribe(websocket, req_topics)
                    await websocket.send_json({
                        "topic": "system",
                        "event": "subscribed",
                        "timestamp": "",
                        "event_id": "",
                        "data": {"subscribed_topics": req_topics}
                    })

            elif action == "unsubscribe":
                req_topics = payload.get("topics", [])
                if isinstance(req_topics, list):
                    await ws_manager.unsubscribe(websocket, req_topics)
                    await websocket.send_json({
                        "topic": "system",
                        "event": "unsubscribed",
                        "timestamp": "",
                        "event_id": "",
                        "data": {"topics": req_topics}
                    })

            elif action == "publish":
                pub_topic = payload.get("topic")
                pub_event = payload.get("pub_event", "custom_event")
                pub_data = payload.get("data", {})
                if pub_topic:
                    await ws_manager.broadcast(pub_topic, pub_event, pub_data)

            else:
                logger.debug(f"[WS] Unhandled message action: {action}")

    except WebSocketDisconnect:
        logger.info("[WS] Client disconnected normally via WebSocketDisconnect")
        await ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"[WS] Connection error: {e}")
        await ws_manager.disconnect(websocket)
