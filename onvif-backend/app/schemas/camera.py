from pydantic import BaseModel
from typing import Optional

class CameraCredentials(BaseModel):
    ip:       str
    port:     int = 80
    username: str = ""
    password: str = ""

class ImagingSettingRequest(BaseModel):
    ip:       str
    port:     int   = 80
    username: str   = ""
    password: str   = ""
    setting:  str
    value:    str | float | int

class PTZPresetRequest(BaseModel):
    ip:           str
    port:         int = 80
    username:     str = ""
    password:     str = ""
    preset_token: str

class PTZSavePresetRequest(BaseModel):
    ip:           str
    port:         int = 80
    username:     str = ""
    password:     str = ""
    preset_name:  str
    preset_token: Optional[str] = None

class PTZMoveRequest(BaseModel):
    ip:       str
    port:     int   = 80
    username: str   = ""
    password: str   = ""
    pan:      float = 0.0
    tilt:     float = 0.0
    zoom:     float = 0.0

class RelayRequest(BaseModel):
    ip:          str
    port:        int = 80
    username:    str = ""
    password:    str = ""
    relay_token: str
    state:       str = "Active"

class ProbeRequest(BaseModel):
    ip:       str
    port:     int = 80
    username: str = ""
    password: str = ""
    channel:  int = 0
    group_id:    str = "default"
    device_name: str = ""

class StreamRegisterRequest(BaseModel):
    rtsp_url:     str
    ip:           str = ""
    port:         int = 80
    username:     str = ""
    password:     str = ""
    manufacturer: str = "Unknown"
    model:        str = "Unknown"
    mac:          str = "—"
    device_name:  str = ""
    group_id:     str = "default"

class StreamAssignRequest(BaseModel):
    ip:                str
    port:              int = 80
    username:          str = ""
    manufacturer:      str = "Unknown"
    model:             str = "Unknown"
    mac:               str = "—"
    device_name:       str = ""
    live_rtsp:         str
    recording_rtsp:    str
    live_profile:      str = ""
    recording_profile: str = ""
