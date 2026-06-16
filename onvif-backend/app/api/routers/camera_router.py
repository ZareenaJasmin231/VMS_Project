from fastapi import APIRouter, Depends, HTTPException, Request
import json
from app.core.database import cameras_col, db as _db
from app.core.security import verify_token
from app.managers.stream_manager import normalize_stream_name, get_devices_by_ip, devices, save_devices
from app.services.camera.onvif_service import (
    probe_camera,
    set_imaging_setting,
    ptz_go_to_preset,
    ptz_set_preset,
    ptz_go_home,
    trigger_relay,
    move_camera_ptz,
    get_video_encoder_options,
    set_video_encoder_setting
)
from app.services.camera.ome_service import register_stream
from app.services.storage import rtsp_recorder as recorder
from app.schemas.camera import (
    StreamRegisterRequest,
    StreamAssignRequest,
    ProbeRequest,
    ImagingSettingRequest,
    PTZPresetRequest,
    PTZSavePresetRequest,
    PTZMoveRequest,
    RelayRequest,
    CameraCredentials,
    VideoEncoderSettingRequest
)


import asyncio
import re
import os
import urllib.parse
from datetime import datetime
import requests as http_requests

from app.core.lifecycle import _analytics_tasks, OME_API, OME_AUTH, OME_WS_PORT
from app.managers.health_manager import analytics_poll_loop as _analytics_poll_loop
from app.core.database import analytics_col, analytics_subs_col
from app.managers.stream_manager import load_devices, save_camera_to_db, _watchdog_failures, stream_exists_in_ome


OME_HOST_IP = os.environ.get("OME_HOST_IP", "192.168.126.200")

router = APIRouter(prefix="/api", tags=["cameras"])
features_router = APIRouter(prefix="/api/camera", tags=["camera-features"], dependencies=[Depends(verify_token)])

@router.get("/cameras", dependencies=[Depends(verify_token)])
def get_all_cameras():
    return load_devices()

@router.post("/cameras/by-ip/{ip}/enable", dependencies=[Depends(verify_token)])
async def enable_camera_by_ip(ip: str):
    global devices
    matched = get_devices_by_ip(ip)
    if not matched:
        raise HTTPException(status_code=404, detail=f"No camera found with IP {ip}")
    started = []
    for device in matched:
        stream_name = device.get("ome_stream")
        rtsp_url    = device.get("rtsp_url")
        if not stream_name or not rtsp_url:
            continue
        device["enabled"] = True
        try:
            register_stream(stream_name, rtsp_url)
        except Exception as e:
            print(f"[ENABLE] OME re-register failed for {stream_name}: {e}")
        started.append(stream_name)
        print(f"[ENABLE] ✅ {stream_name} enabled. Recording will be started by the assigned worker process.")
    save_devices(devices)
    if cameras_col is not None:
        cameras_col.update_one({"ip": ip}, {"$set": {"enabled": True}})
    return {"success": True, "ip": ip, "streams_started": started}


@router.post("/cameras/by-ip/{ip}/disable", dependencies=[Depends(verify_token)])
async def disable_camera_by_ip(ip: str):
    global devices
    matched = get_devices_by_ip(ip)
    if not matched:
        raise HTTPException(status_code=404, detail=f"No camera found with IP {ip}")
    stopped = []
    for device in matched:
        stream_name = device.get("ome_stream")
        if not stream_name:
            continue
        device["enabled"] = False
        stopped.append(stream_name)
        print(f"[DISABLE] ⏹ {stream_name} disabled. Recording will be stopped by the assigned worker process.")
    save_devices(devices)
    if cameras_col is not None:
        cameras_col.update_one({"ip": ip}, {"$set": {"enabled": False}})
    return {"success": True, "ip": ip, "streams_stopped": stopped}


@router.delete("/cameras/by-ip/{ip}/delete", dependencies=[Depends(verify_token)])
async def delete_camera_by_ip(ip: str):
    global devices
    matched = get_devices_by_ip(ip)
    stopped = []
    for device in matched:
        stream_name = device.get("ome_stream")
        if not stream_name:
            continue
        recorder.stop_camera(stream_name)
        stopped.append(stream_name)
        print(f"[DELETE] ⏹ Stopped recorder for {stream_name}")
        try:
            r = http_requests.delete(
                f"{OME_API}/{stream_name}",
                headers={"Authorization": OME_AUTH},
                timeout=3,
            )
            print(f"[DELETE] OME unregister {stream_name}: HTTP {r.status_code}")
        except Exception as e:
            print(f"[DELETE] OME unregister failed for {stream_name} (non-fatal): {e}")
        _watchdog_failures.pop(stream_name, None)
    devices = [d for d in devices if d.get("ip") != ip]
    save_devices(devices)
    if cameras_col is not None:
        result = cameras_col.delete_many({"ip": ip})
        print(f"[DELETE] 🗑 MongoDB: removed {result.deleted_count} document(s) for IP {ip}")
    return {"success": True, "ip": ip, "streams_stopped": stopped}


@router.delete("/cameras/by-stream/{stream_name}/delete", dependencies=[Depends(verify_token)])
async def delete_camera_by_stream(stream_name: str):
    """
    Delete a camera entry by its ome_stream name.
    Removes ghost/stale entries that exist in MongoDB but were never properly cleaned up.
    The frontend (AddDevicesPage.jsx) already calls this endpoint on Remove.
    """
    global devices
    stopped = []
    # Stop recorder and OME stream
    recorder.stop_camera(stream_name)
    stopped.append(stream_name)
    try:
        r = http_requests.delete(
            f"{OME_API}/{stream_name}",
            headers={"Authorization": OME_AUTH},
            timeout=3,
        )
        print(f"[DELETE-STREAM] OME unregister {stream_name}: HTTP {r.status_code}")
    except Exception as e:
        print(f"[DELETE-STREAM] OME unregister failed for {stream_name} (non-fatal): {e}")
    _watchdog_failures.pop(stream_name, None)
    # Remove from in-memory devices
    devices = [d for d in devices if d.get("ome_stream") != stream_name]
    save_devices(devices)
    # Remove from MongoDB by ome_stream name
    if cameras_col is not None:
        result = cameras_col.delete_many({"ome_stream": stream_name})
        print(f"[DELETE-STREAM] 🗑 MongoDB: removed {result.deleted_count} doc(s) for stream '{stream_name}'")
    return {"success": True, "stream_name": stream_name, "streams_stopped": stopped}


@router.put("/cameras/by-ip/{ip}", dependencies=[Depends(verify_token)])
async def update_camera_by_ip(ip: str, request: Request):
    data = await request.json()
    
    if cameras_col is not None:
        # Only update allowed fields
        allowed_keys = {"name", "device_name", "mac", "manufacturer", "model", "rtsp_url", "group_id"}
        update_data = {k: v for k, v in data.items() if k in allowed_keys}
        if update_data:
            cameras_col.update_many({"ip": ip}, {"$set": update_data})
            print(f"[UPDATE] ✏️ MongoDB: updated document(s) for IP {ip}")

    # Update in-memory devices
    global devices
    for d in devices:
        if d.get("ip") == ip:
            for k, v in data.items():
                d[k] = v
    save_devices(devices)
    
    return {"success": True, "ip": ip}


# ------------------------------------------------------------------
# ONVIF probe
# ------------------------------------------------------------------
@router.post("/onvif/probe", dependencies=[Depends(verify_token)])
async def onvif_probe(req: ProbeRequest):
    print(f"[ONVIF] Probing {req.ip}:{req.port} ...")
 
    result = await asyncio.to_thread(
        probe_camera, req.ip, req.port, req.username, req.password, req.channel
    )

 
    if result["success"]:
        print(f"[ONVIF] ✅ {result['manufacturer']} {result['model']} "
              f"— {result.get('stream_count', '?')} stream(s)")
        # Use the first profile's rtsp_url (reflects the selected channel from the UI)
        # Fallback to stream_uri for backward compatibility
        profiles_list = result.get("profiles") or result.get("all_profiles") or []
        if profiles_list and profiles_list[0].get("rtsp_url"):
            rtsp = profiles_list[0]["rtsp_url"]
        else:
            rtsp = result.get("stream_uri", "")
        rtsp = re.sub(r"[&?]proto=Onvif", "", rtsp)

        parsed = urllib.parse.urlparse(rtsp)
        if req.username and not parsed.username:
            user_clean = req.username.strip()
            pass_clean = req.password.strip()
            user_enc = urllib.parse.quote(user_clean, safe='')
            pass_enc = urllib.parse.quote(pass_clean, safe='')
            host = parsed.hostname
            port = parsed.port
            if port:
                netloc = f"{user_enc}:{pass_enc}@{host}:{port}"
            else:
                netloc = f"{user_enc}:{pass_enc}@{host}"
            
            rtsp = urllib.parse.urlunparse((
                parsed.scheme,
                netloc,
                parsed.path,
                parsed.params,
                parsed.query,
                parsed.fragment            ))
 
            if "transport=" not in rtsp:
                if "?" in rtsp:
                    rtsp += "&transport=tcp"
                else:
                    rtsp += "?transport=tcp"

        print("FINAL RTSP:", rtsp)
        # changes ends
        # Generate a unique stream name based on IP and a hash of the RTSP URL
        # Use channel-based suffix for stable, unique stream names on multi-channel devices
        suffix = f"cam{req.channel}" if req.channel > 0 else None
        stream_name = normalize_stream_name(req.ip, suffix)
        
        existing    = next((d for d in devices if d.get("ome_stream") == stream_name), None)

 
        if not existing or not stream_exists_in_ome(stream_name):
            print(f"[ONVIF] Registering stream in OME: {stream_name}")
            ome_response = register_stream(stream_name, rtsp)
            print(f"[ONVIF] OME response: {ome_response}")
 
            if not existing:
                new_device = {
                    "ome_stream":     stream_name,
                    "rtsp_url":       rtsp,
                    "recording_rtsp": rtsp,
                    "ip":             req.ip,
                    "port":           req.port,
                    "username":       req.username,
                    "password":       req.password,
                    "active_rec_profile": "MAIN_STREAM",
                    "recording_profile":  "MAIN_STREAM",
                    "enabled":        True,
                }
                devices.append(new_device)
                save_devices(devices)
            else:
                existing["rtsp_url"]       = rtsp
                existing["recording_rtsp"] = existing.get("recording_rtsp", rtsp)
                existing["port"]           = req.port
                existing["username"]       = req.username
                existing["password"]       = req.password
                save_devices(devices)
 
            save_camera_to_db({
                "ip":              req.ip,
                "ome_stream":      stream_name,
                "rtsp_url":        rtsp,
                "recording_rtsp":  rtsp,
                "manufacturer":    result.get("manufacturer", ""),
                "model":           result.get("model", ""),
                "mac":             result.get("mac", ""),
                "port":            req.port,
                "username":        req.username,
                "password":        req.password,
                "added_at":        datetime.utcnow(),
                "status":          "streaming",
                "enabled":         True,
                "stream_count":    result.get("stream_count", 0),
                "stream_profiles": result.get("profiles", []),
                "active_rec_profile": "MAIN_STREAM",
                "recording_profile":  "MAIN_STREAM",
                "api_profile":     result.get("api_profile"),
                "group_id":        req.group_id,
                "device_name":     req.device_name,
            })
            print(f"[ONVIF] 🎥 Recording will be started by the assigned worker process for {stream_name}")
 
        else:
            print(f"[ONVIF] Stream {stream_name} already live in OME, skipping.")
            ome_response = {"message": "Already registered", "statusCode": 200}
 
        result["ome_stream"]   = stream_name
        result["ome_response"] = ome_response
        result["ws_url"]       = f"ws://{OME_HOST_IP}:{OME_WS_PORT}/app/{stream_name}"
        result["stream_key"]   = stream_name
        result["status"]       = "streaming"
        result["rtsp_url"]     = rtsp
 
    else:
        print(f"[ONVIF] ❌ {result['error']}")
 
    return result


# ------------------------------------------------------------------
# RTSP stream register
# ------------------------------------------------------------------
@router.post("/streams/register", dependencies=[Depends(verify_token)])
async def register_rtsp_stream(req: StreamRegisterRequest):
 
    rtsp = req.rtsp_url.strip()
    print(f"[RTSP] Registering stream: {rtsp}")
 
    import hashlib
    rtsp_hash = hashlib.md5(rtsp.encode()).hexdigest()[:6]

    if req.ip:
        host        = req.ip
        stream_name = normalize_stream_name(host, rtsp_hash)
    else:
        try:
            from urllib.parse import urlparse
            parsed      = urlparse(rtsp)
            host        = parsed.hostname or "unknown"
            stream_name = normalize_stream_name(host, rtsp_hash)
        except Exception:
            host        = "unknown"
            stream_name = normalize_stream_name("unknown", rtsp_hash)

    existing = next(
        (d for d in devices if d.get("ome_stream") == stream_name),
        None
    )
 
    if existing and stream_exists_in_ome(stream_name):
        print(f"[RTSP] Stream {stream_name} already live in OME, skipping.")
        existing["rtsp_url"] = rtsp
        save_devices(devices)
        return {
            "success":    True,
            "ome_stream": stream_name,
            "ws_url":     f"ws://{OME_HOST_IP}:{OME_WS_PORT}/app/{stream_name}",
            "stream_key": stream_name,
            "status":     "streaming",
            "rtsp_url":   rtsp,
        }
 
    try:
        ome_response = register_stream(stream_name, rtsp)
        print(f"[RTSP] OME response: {ome_response}")
    except Exception as e:
        print(f"[RTSP] ❌ OME registration failed: {e}")
        return {"success": False, "error": str(e)}
 
    status_code = ome_response.get("statusCode", 0) if isinstance(ome_response, dict) else 0
    if status_code not in (200, 201):
        return {
            "success": False,
            "error":   ome_response.get("message", "OME registration failed"),
            "ws_url":  None,
        }
 
    if not existing:
        new_device = {
            "ome_stream":     stream_name,
            "rtsp_url":       rtsp,
            "recording_rtsp": rtsp,
            "ip":             host,
            "port":           req.port,
            "username":       req.username,
            "password":       req.password,
            "active_rec_profile": "MAIN_STREAM",
            "recording_profile":  "MAIN_STREAM",
            "enabled":        True,
        }
        devices.append(new_device)
    else:
        existing["rtsp_url"]       = rtsp
        existing["recording_rtsp"] = existing.get("recording_rtsp", rtsp)
        existing["port"]           = req.port
        existing["username"]       = req.username
        existing["password"]       = req.password
        new_device = existing
    save_devices(devices)
 
    save_camera_to_db({
        "ip":             host,
        "ome_stream":     stream_name,
        "rtsp_url":       rtsp,
        "recording_rtsp": rtsp,
        "manufacturer":   req.manufacturer,
        "model":          req.model,
        "mac":            req.mac,
        "device_name":    req.device_name or f"Camera @ {host}",
        "port":           req.port,
        "username":       req.username,
        "password":       req.password,
        "added_at":       datetime.utcnow(),
        "status":         "streaming",
        "active_rec_profile": "MAIN_STREAM",
        "recording_profile":  "MAIN_STREAM",
        "enabled":        True,
        "source":         "rtsp",
        "group_id":       req.group_id,
    })
 
 
    _watchdog_failures[stream_name] = 0
    print(f"[RTSP] 🎥 Recording will be started by the assigned worker process for {stream_name}")
 
    return {
        "success":    True,
        "ome_stream": stream_name,
        "ws_url":     f"ws://{OME_HOST_IP}:{OME_WS_PORT}/app/{stream_name}",
        "stream_key": stream_name,
        "status":     "streaming",
        "rtsp_url":   rtsp,
    }
    


# ------------------------------------------------------------------
# Assign independent Live + Recording streams
# ------------------------------------------------------------------
@router.post("/streams/assign", dependencies=[Depends(verify_token)])
async def assign_streams(req: StreamAssignRequest):
    import time

    host        = req.ip.strip()
    # For assignment, we need to find which camera we are talking about.
    # We'll use the IP and look for the one with matching profiles if possible, 
    # but the safest way is to look for the one that has the live_rtsp or recording_rtsp.
    # However, since we don't have the ID, we'll try to find by IP and manufacturer for now
    # or just use the first match for this IP.
    stream_name = normalize_stream_name(host) 

    print(f"[ASSIGN] {host}: live={req.live_profile!r}  rec={req.recording_profile!r}")
    print(f"[ASSIGN] live_rtsp={req.live_rtsp!r}")
    print(f"[ASSIGN] rec_rtsp={req.recording_rtsp!r}")

    # ── 1. Update OME only if live RTSP actually changed ──────────────
    existing = next(
        (d for d in devices if d.get("ip") == host and (d.get("rtsp_url") == req.live_rtsp or d.get("recording_rtsp") == req.recording_rtsp)),
        next((d for d in devices if d.get("ip") == host), None)
    )
    current_live_rtsp = existing.get("rtsp_url") if existing else None
    live_rtsp_changed = current_live_rtsp != req.live_rtsp

    if live_rtsp_changed or not stream_exists_in_ome(stream_name):
        print(f"[ASSIGN] Live RTSP changed or stream missing — re-registering OME")
        try:
            # Delete existing first to avoid 409
            try:
                http_requests.delete(
                    f"{OME_API}/{stream_name}",
                    headers={"Authorization": OME_AUTH},
                    timeout=5,
                )
            except:
                pass

            time.sleep(0.5)

            ome_response = register_stream(stream_name, req.live_rtsp)
            status_code  = ome_response.get("statusCode", 0) if isinstance(ome_response, dict) else 0
            print(f"[ASSIGN] OME register HTTP {status_code}: {ome_response}")

            if status_code not in (200, 201):
                print(f"[ASSIGN] ⚠ OME registration returned HTTP {status_code} — continuing anyway")
        except Exception as e:
            print(f"[ASSIGN] ⚠ OME error (non-fatal): {e} — continuing")
    else:
        print(f"[ASSIGN] Live RTSP unchanged and stream exists — skipping OME re-register")

    # ── 2. Always update device entry ────────────────────────────────
    if existing:
        existing["rtsp_url"]            = req.live_rtsp
        existing["recording_rtsp"]      = req.recording_rtsp
        existing["active_live_profile"] = req.live_profile
        existing["active_rec_profile"]  = req.recording_profile
        existing["recording_profile"]   = req.recording_profile
        device_entry = existing
    else:
        device_entry = {
            "ome_stream":           stream_name,
            "rtsp_url":             req.live_rtsp,
            "recording_rtsp":       req.recording_rtsp,
            "ip":                   host,
            "port":                 req.port,
            "username":             req.username,
            "enabled":              True,
            "active_live_profile":  req.live_profile,
            "active_rec_profile":   req.recording_profile,
            "recording_profile":    req.recording_profile,

        }
        devices.append(device_entry)

    save_devices(devices)

    # ── 3. Persist to MongoDB ─────────────────────────────────────────
    save_camera_to_db({
    "ip":                   host,
    "ome_stream":           stream_name,
    "rtsp_url":             req.live_rtsp,
    "recording_rtsp":       req.recording_rtsp,
    "manufacturer":         req.manufacturer,
    "model":                req.model,
    "mac":                  req.mac,
    "device_name":          req.device_name or f"Camera @ {host}",
    "port":                 req.port,
    "username":             req.username,

    # 🔥 THIS IS THE MISSING FIX
    "active_live_profile":  req.live_profile,
    "active_rec_profile":   req.recording_profile,
    "recording_profile":    req.recording_profile,

    "updated_at":           datetime.utcnow(),
})

    # ── 4. Recording profile updated ──────────────────────────────────
    # The assigned worker process will automatically detect the change
    # and restart its recorder with the new profile RTSP URL.
    print(f"[ASSIGN] ✅ Recording profile updated for {stream_name} to: {req.recording_rtsp}")

    # ── 5. Reset watchdog so the stream is not blacklisted ───────────
    _watchdog_failures[stream_name] = 0

    return {
        "success":           True,
        "ome_stream":        stream_name,
        "ws_url":            f"ws://{OME_HOST_IP}:{OME_WS_PORT}/app/{stream_name}",
        "stream_key":        stream_name,
        "live_rtsp":         req.live_rtsp,
        "recording_rtsp":    req.recording_rtsp,
        "live_profile":      req.live_profile,
        "recording_profile": req.recording_profile,
    }


# ------------------------------------------------------------------
# Camera lookup by IP
# ------------------------------------------------------------------
@router.get("/cameras/by-ip/{ip}", dependencies=[Depends(verify_token)])
async def get_camera_by_ip(ip: str):
    if cameras_col is not None:
        doc = cameras_col.find_one({"ip": ip}, {"_id": 0})
        if doc:
            return doc
    dev = next((d for d in devices if d.get("ip") == ip), None)
    if dev:
        return dev
    raise HTTPException(status_code=404, detail=f"Camera {ip} not found")


# ------------------------------------------------------------------
# Camera Features Router endpoints
# ------------------------------------------------------------------

@features_router.get("/encoder/options")
async def get_encoder_options(ip: str, port: int = 80, username: str = "", password: str = "", profile_token: str = ""):
    if not profile_token:
        raise HTTPException(status_code=400, detail="Missing profile_token")
    result = await asyncio.to_thread(
        get_video_encoder_options, ip, port, username, password, profile_token
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to get encoder options"))
    return result


@features_router.post("/encoder/set")
async def set_encoder_profile_settings(req: VideoEncoderSettingRequest):
    print(f"[FEATURES] Set encoder on {req.ip} for profile {req.profile_token}")
    result = await asyncio.to_thread(
        set_video_encoder_setting,
        req.ip, req.port, req.username, req.password,
        req.profile_token, req.resolution, req.encoding, req.fps, req.bitrate
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to update video encoder configuration"))
    
    probe_res = await asyncio.to_thread(
        probe_camera, req.ip, req.port, req.username, req.password
    )
    
    if probe_res.get("success"):
        if cameras_col is not None:
            cameras_col.update_one(
                {"ip": req.ip},
                {"$set": {
                    "stream_profiles": probe_res.get("all_profiles", probe_res.get("profiles", [])),
                    "stream_count": probe_res.get("stream_count", 0)
                }}
            )
        
        global devices
        for device in devices:
            if device.get("ip") == req.ip:
                stream_name = device.get("ome_stream")
                if stream_name:
                    print(f"[ENCODER] Stream profiles updated for: {stream_name}")
    
    return {"success": True, "message": "Video encoder configuration updated successfully."}


@features_router.post("/capabilities")
async def get_camera_capabilities(req: CameraCredentials):
    print(f"[FEATURES] Full capability probe: {req.ip}:{req.port}")
    result = await asyncio.to_thread(
        probe_camera, req.ip, req.port, req.username, req.password
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Probe failed"))
    return result


@features_router.post("/imaging/set")
async def set_imaging(req: ImagingSettingRequest):
    print(f"[FEATURES] Set imaging {req.setting}={req.value} on {req.ip}")
    result = await asyncio.to_thread(
        set_imaging_setting,
        req.ip, req.port, req.username, req.password,
        req.setting, req.value
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/ptz/preset/goto")
async def goto_preset(req: PTZPresetRequest):
    result = await asyncio.to_thread(
        ptz_go_to_preset,
        req.ip, req.port, req.username, req.password,
        req.preset_token
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/ptz/preset/save")
async def save_preset(req: PTZSavePresetRequest):
    result = await asyncio.to_thread(
        ptz_set_preset,
        req.ip, req.port, req.username, req.password,
        req.preset_name, req.preset_token
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/ptz/home")
async def goto_home(req: CameraCredentials):
    result = await asyncio.to_thread(
        ptz_go_home,
        req.ip, req.port, req.username, req.password
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/ptz/move")
async def ptz_move(req: PTZMoveRequest):
    result = await asyncio.to_thread(
        move_camera_ptz,
        req.ip, req.port, req.username, req.password,
        req.pan, req.tilt, req.zoom
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/io/relay")
async def set_relay(req: RelayRequest):
    result = await asyncio.to_thread(
        trigger_relay,
        req.ip, req.port, req.username, req.password,
        req.relay_token, req.state
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/analytics/enable")
async def enable_analytics(req: CameraCredentials):
    ip = req.ip
    if ip in _analytics_tasks and not _analytics_tasks[ip].done():
        return {"success": True, "message": "Already running"}
        
    device = next((d for d in devices if d.get("ip") == ip), None)
    manufacturer = device.get("manufacturer", "") if device else "bosch"

    if analytics_subs_col is not None:
        analytics_subs_col.update_one(
            {"ip": ip},
            {"$set": {
                "ip": ip, "port": req.port,
                "username": req.username, "password": req.password,
                "manufacturer": manufacturer,
                "enabled": True, "enabled_at": datetime.utcnow()
            }},
            upsert=True
        )
    task = asyncio.create_task(
        _analytics_poll_loop(ip, req.port, req.username, req.password, manufacturer)
    )
    _analytics_tasks[ip] = task
    print(f"[ANALYTICS] ✅ Enabled for {ip} ({manufacturer})")
    return {"success": True, "message": f"Analytics started for {ip}"}


@features_router.post("/analytics/disable")
async def disable_analytics(req: CameraCredentials):
    ip = req.ip
    task = _analytics_tasks.get(ip)
    if task and not task.done():
        task.cancel()
        del _analytics_tasks[ip]
    if analytics_subs_col is not None:
        analytics_subs_col.update_one({"ip": ip}, {"$set": {"enabled": False}})
    print(f"[ANALYTICS] ⏹ Disabled for {ip}")
    return {"success": True, "message": f"Analytics stopped for {ip}"}


@features_router.get("/analytics/status/{ip}")
async def analytics_status(ip: str):
    running = ip in _analytics_tasks and not _analytics_tasks[ip].done()
    return {"ip": ip, "running": running}


@features_router.get("/analytics/events/{ip}")
async def get_analytics_events(ip: str, limit: int = 50):
    if analytics_col is None:
        return {"events": []}
    docs = list(
        analytics_col.find({"ip": ip}, {"_id": 0})
        .sort("received_at", -1).limit(limit)
    )
    for d in docs:
        if "received_at" in d:
            d["received_at"] = d["received_at"].isoformat()
    return {"events": docs}


# ------------------------------------------------------------------
# Device / storage endpoints
# ------------------------------------------------------------------

@router.post("/devices/", dependencies=[Depends(verify_token)])
async def add_device(device: dict):
    print("DEVICE REGISTERED:", device)
    # Use ome_stream or IP as the unique key
    stream_id = device.get("ome_stream") or device.get("ip_address")
    if not stream_id:
        return {"success": False, "error": "Missing identifier"}

    existing = next(
        (d for d in devices if (d.get("ome_stream") or d.get("ip_address")) == stream_id), 
        None
    )
    if existing:
        devices.remove(existing)
    devices.append(device)
    save_devices(devices)
    return {"success": True, "device": device}



@router.get("/devices", dependencies=[Depends(verify_token)])
async def get_devices():
    devs = await _db.devices.find({}).to_list(None)
    result = []
    for d in devs:
        d["id"]  = str(d["_id"])
        d["_id"] = str(d["_id"])
        result.append(d)
    return result



@router.get("/cameras/", dependencies=[Depends(verify_token)])
async def get_cameras_from_db():
    if cameras_col is None:
        return []
    docs = list(cameras_col.find({}, {"_id": 0}))
    return docs



@router.post("/onvif/ptz/move", dependencies=[Depends(verify_token)])
async def onvif_ptz_move(req: PTZMoveRequest):
    print(f"[PTZ] Moving {req.ip} to P:{req.pan} T:{req.tilt} Z:{req.zoom}")
    result = await asyncio.to_thread(
        move_camera_ptz,
        req.ip, req.port, req.username, req.password,
        req.pan, req.tilt, req.zoom
    )
    return result


# ------------------------------------------------------------------
# Dashboard
# ------------------------------------------------------------------
