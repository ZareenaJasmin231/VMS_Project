from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from pymongo import MongoClient
import os

# Connect to Mongo
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")
try:
    mongo_client = MongoClient(MONGO_URI)
    db = mongo_client["mirador-vms"]
    ui_logs_col = db["ui_logs"]
    terminal_logs_col = db["terminal_logs"]
    print(f"[MONGO] Logs router connected to DB")
except Exception as e:
    print(f"[MONGO] Logs router failed to connect: {e}")
    ui_logs_col = None
    terminal_logs_col = None

router = APIRouter(prefix="/api/logs", tags=["logs"])

class UILogEntry(BaseModel):
    user_email: str
    user_role: str
    action: str
    category: str
    details: Optional[Dict[str, Any]] = {}
    session_id: Optional[str] = None
    timestamp: Optional[str] = None

class TerminalLogEntry(BaseModel):
    user_email: str
    user_role: str
    command: str
    project_folder: str
    exit_code: int = 0
    output_snippet: str = ""
    session_id: Optional[str] = None
    timestamp: Optional[str] = None

@router.post("/ui")
def add_ui_log(log: UILogEntry):
    if ui_logs_col is None:
        return {"success": False, "error": "Database not connected"}
    
    doc = log.dict()
    if not doc.get("timestamp"):
      doc["timestamp"] = datetime.now(timezone.utc).isoformat()        
    try:
        ui_logs_col.insert_one(doc)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.get("/ui")
def get_ui_logs(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user_email: Optional[str] = None,
    limit: int = 100
):
    if ui_logs_col is None:
        return {"success": False, "error": "Database not connected", "logs": []}
        
    query = {}
    
    if from_date or to_date:
        query["timestamp"] = {}
        if from_date:
            query["timestamp"]["$gte"] = from_date
        if to_date:
            query["timestamp"]["$lte"] = to_date + "T23:59:59.999Z"
            
    if user_email:
        query["user_email"] = user_email
        
    try:
        cursor = ui_logs_col.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit)
        logs = list(cursor)
        return {"success": True, "logs": logs}
    except Exception as e:
        return {"success": False, "error": str(e), "logs": []}

@router.post("/terminal")
def add_terminal_log(log: TerminalLogEntry):
    if terminal_logs_col is None:
        return {"success": False, "error": "Database not connected"}
        
    doc = log.dict()
    if not doc.get("timestamp"):
        doc["timestamp"] = datetime.utcnow().isoformat()
        
    try:
        terminal_logs_col.insert_one(doc)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.get("/terminal")
def get_terminal_logs(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user_email: Optional[str] = None,
    limit: int = 100
):
    if terminal_logs_col is None:
        return {"success": False, "error": "Database not connected", "logs": []}
        
    query = {}
    
    if from_date or to_date:
        query["timestamp"] = {}
        if from_date:
            query["timestamp"]["$gte"] = from_date
        if to_date:
            query["timestamp"]["$lte"] = to_date + "T23:59:59.999Z"
            
    if user_email:
        query["user_email"] = user_email
        
    try:
        cursor = terminal_logs_col.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit)
        logs = list(cursor)
        return {"success": True, "logs": logs}
    except Exception as e:
        return {"success": False, "error": str(e), "logs": []}
