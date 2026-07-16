from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
import os
import shutil
import tempfile
from app.core.security import verify_token
from app.core.database import db as _db, cameras_col
from recorder import rtsp_recorder as recorder
from recorder import encrypt_service

router = APIRouter(prefix="/api", tags=["storage_ext"])

@router.post("/recordings/decrypt-upload", dependencies=[Depends(verify_token)])
async def decrypt_uploaded_file(file: UploadFile = File(...)):
    enc_path = None
    dec_path = None

    try:
        print(f"[UPLOAD] Received file: {file.filename}")

        # Validate extension
        if not file.filename.endswith(".enc"):
            raise HTTPException(status_code=400, detail="Only .enc files allowed")

        # Save temp encrypted file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".enc") as temp_enc:
            temp_enc.write(await file.read())
            enc_path = temp_enc.name

        # Output path
        dec_path = enc_path.replace(".enc", ".mp4")

        print(f"[DECRYPT] Input: {enc_path}")
        print(f"[DECRYPT] Output: {dec_path}")

        # Decrypt — now returns True/False and raises on bad key
        success = encrypt_service.decrypt_file(enc_path, dec_path)
        if not success:
            raise HTTPException(status_code=500, detail="Decryption utility failed. Check backend logs.")

        if not os.path.exists(dec_path):
            raise HTTPException(status_code=500, detail="Decrypted file not created.")

        # Read fully before cleanup
        with open(dec_path, "rb") as f:
            data = f.read()

        if not data:
            raise HTTPException(status_code=500, detail="Decryption produced empty output — key mismatch?")

        safe_filename = file.filename.replace('.enc', '.mp4')

        return Response(
            content=data,
            media_type="video/mp4",
            headers={
                # Explicit Content-Type so browsers/VLC know this is MP4
                "Content-Type":        "video/mp4",
                "Content-Length":      str(len(data)),
                "Content-Disposition": f"inline; filename=\"{safe_filename}\"",
                "Accept-Ranges":       "bytes",
                "Cache-Control":       "no-store",
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Decryption failed: {str(e)}")

    finally:
        try:
            if enc_path and os.path.exists(enc_path):
                os.remove(enc_path)
            if dec_path and os.path.exists(dec_path):
                os.remove(dec_path)
        except Exception as cleanup_err:
            print("[CLEANUP ERROR]", cleanup_err)

@router.get("/storage/selection", dependencies=[Depends(verify_token)])
def storage_selection():
    if cameras_col is None:
        return []
    docs   = list(cameras_col.find({}, {"_id": 0}))
    result = []
    
    recordings_col = _db["recordings"] if _db is not None else None
    from datetime import datetime
    
    for cam in docs:
        stream = cam.get("ome_stream", "")
        
        used_bytes = 0
        oldest     = None
        
        try:
            if recordings_col is not None:
                # Aggregate total file size of completed recordings
                pipeline = [
                    {"$match": {"camera_id": stream, "status": "COMPLETE"}},
                    {"$group": {"_id": None, "total_size": {"$sum": "$file_size"}}}
                ]
                agg = list(recordings_col.aggregate(pipeline))
                if agg:
                    used_bytes = agg[0].get("total_size", 0)
                
                # Retrieve the oldest complete recording
                oldest_rec = recordings_col.find_one(
                    {"camera_id": stream, "status": "COMPLETE"},
                    sort=[("created_at", 1)]
                )
                if oldest_rec:
                    created_at = oldest_rec.get("created_at")
                    if isinstance(created_at, datetime):
                        oldest = created_at.timestamp()
                    elif isinstance(created_at, str):
                        try:
                            oldest = datetime.fromisoformat(created_at.replace("Z", "+00:00")).timestamp()
                        except:
                            pass
        except Exception as e:
            print(f"[STORAGE] DB size query failed for {stream}: {e}")
            
        used_gb    = round(used_bytes / (1024 ** 3), 2)
        oldest_str = datetime.fromtimestamp(oldest).strftime("%d-%m-%Y %H:%M:%S") if oldest else "N/A"
        result.append({
            "device":           f"{cam.get('manufacturer', '')} {cam.get('model', '')}".strip() or cam.get("ip"),
            "ip":               cam.get("ip"),
            "used_storage":     f"{used_gb} GB",
            "location":         "minio",
            "retention":        cam.get("retention_days", 70),
            "oldest_recording": oldest_str,
            "failover":         cam.get("failover", False),
        })
    return result



@router.post("/storage/selection", dependencies=[Depends(verify_token)])
def update_storage_selection(payload: dict):
    if cameras_col is None:
        return {"error": "MongoDB not connected"}
    ip = payload.get("ip")
    if not ip:
        return {"error": "ip required"}
    # Update by ome_stream if provided, fallback to IP (warning: IP update affects all channels)
    stream_id = payload.get("ome_stream")
    if stream_id:
        cameras_col.update_one({"ome_stream": stream_id}, {"$set": {
            "retention_days": payload.get("retention_days", 70),
            "failover":       payload.get("failover", False),
            "store_to":       payload.get("store_to", recorder.get_recordings_dir()),
        }})
    else:
        cameras_col.update_many(
            {"ip": ip},
            {"$set": {
                "retention_days": payload.get("retention_days", 70),
                "failover":       payload.get("failover", False),
                "store_to":       payload.get("store_to", recorder.get_recordings_dir()),
            }}
        )
    return {"success": True}


