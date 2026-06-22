from app.services.camera.mediamtx_service import register_stream

result = register_stream(
    "testcam2",
    "rtsp://192.168.126.234/axis-media/media.amp"
)

print(result)