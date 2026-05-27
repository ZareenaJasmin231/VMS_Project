FROM python:3.11-slim

# Install ffmpeg (needed by rtsp_recorder.py)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# /recordings is where MP4 chunks land before encryption
# /app/data holds devices.json and video.key
VOLUME ["/recordings", "/app/data"]

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "80"]
