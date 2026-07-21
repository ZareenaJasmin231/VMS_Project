from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import datetime, timezone, timedelta
from app.core.database import mongo_client
import os

router = APIRouter(prefix="/api/reports", tags=["Reports"])

MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME", "vms_db")
db = mongo_client[MONGO_DB_NAME] if mongo_client else None
uptime_events_col = db["uptime_events"] if db is not None else None
cameras_col = db["cameras"] if db is not None else None
nodes_col = db["infrastructure_nodes"] if db is not None else None

def get_initial_state(node_id: str, event_type: str, from_date: datetime):
    if uptime_events_col is None:
        return "down"
    
    # Try to find the last event before from_date
    last_event = uptime_events_col.find_one(
        {"node_id": node_id, "event_type": event_type, "timestamp": {"$lt": from_date}},
        sort=[("timestamp", -1)]
    )
    if last_event:
        return last_event["state"]
    
    # If no event, we assume it was DOWN unless its current state is UP and there's no DOWN event since then
    # But it's simpler to just query its current state from nodes_col as a best effort
    if nodes_col is not None:
        node = nodes_col.find_one({"id": node_id})
        if node:
            if event_type == "camera":
                status = node.get("stream_status")
                return "up" if status in ["healthy", "degraded", "auth_required"] else "down"
            elif event_type == "recording":
                return "up" if node.get("recording") else "down"
    return "down"

@router.get("/history")
async def get_camera_history(
    from_date: str = Query(..., description="Start date in ISO format"),
    # to_date: str = Query(..., description="End date in ISO format")
    to_date: str = Query(..., description="End date in ISO format"),
    live_only: bool = Query(False, description="Filter for live/healthy cameras only")
):
    if db is None:
        raise HTTPException(status_code=500, detail="Database not connected")
        
    try:
        start_dt = datetime.fromisoformat(from_date.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(to_date.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use ISO format.")

    # Get all configured cameras
    # all_cameras = list(cameras_col.find({}, {"_id": 0, "ip": 1, "name": 1, "model": 1}))
    query = {}
    all_cameras = list(cameras_col.find(query, {"_id": 0, "ip": 1, "name": 1, "model": 1}))

        if live_only:
        live_cams = []
        for cam in all_cameras:
            node_id = f"node-{cam.get('ip', '').replace('.', '-')}"
            node = nodes_col.find_one({"id": node_id})
            if node and node.get("stream_status") in ["healthy", "auth_required"]:
                live_cams.append(cam)
        all_cameras = live_cams

    
    report_data = []

    for cam in all_cameras:
        ip = cam.get("ip")
        if not ip:
            continue
            
        node_id = f"node-{ip.replace('.', '-')}"
        cam_name = cam.get("name", ip)
        
        # Fetch events for this camera in range
        cam_events = list(uptime_events_col.find({
            "node_id": node_id,
            "timestamp": {"$gte": start_dt, "$lte": end_dt}
        }).sort("timestamp", 1))

        # Process Camera events
        cam_history_events = [e for e in cam_events if e["event_type"] == "camera"]
        rec_history_events = [e for e in cam_events if e["event_type"] == "recording"]

        def calc_hours(events_list, e_type):
            current_time = start_dt
            current_state = get_initial_state(node_id, e_type, start_dt)
            total_up = 0.0
            total_down = 0.0
            
            for ev in events_list:
                ev_time = ev["timestamp"]
                if ev_time.tzinfo is None:
                    ev_time = ev_time.replace(tzinfo=timezone.utc)
                
                delta_hours = (ev_time - current_time).total_seconds() / 3600.0
                if current_state == "up":
                    total_up += delta_hours
                else:
                    total_down += delta_hours
                    
                current_time = ev_time
                current_state = ev["state"]
                
            # Add time from last event to end_dt
            if end_dt > current_time:
                delta_hours = (end_dt - current_time).total_seconds() / 3600.0
                if current_state == "up":
                    total_up += delta_hours
                else:
                    total_down += delta_hours
                    
            return round(total_up, 2), round(total_down, 2)

        cam_up, cam_down = calc_hours(cam_history_events, "camera")
        rec_up, rec_down = calc_hours(rec_history_events, "recording")

        def format_event(e):
            return {
                "state": e["state"].upper(),
                "timestamp": e["timestamp"].isoformat()
            }

        report_data.append({
            "ip": ip,
            "name": cam_name,
            "camera_hours_up": cam_up,
            "camera_hours_down": cam_down,
            "recording_hours_up": rec_up,
            "recording_hours_down": rec_down,
            "camera_events": [format_event(e) for e in cam_history_events],
            "recording_events": [format_event(e) for e in rec_history_events]
        })

    return {"status": "success", "data": report_data}
