FROM python:3.11-slim

# Install ffmpeg (needed by rtsp_recorder.py)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

COPY . .

# /recordings is where MP4 chunks land before encryption
# /app/data holds devices.json and video.key
VOLUME ["/recordings", "/app/data"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80"]
