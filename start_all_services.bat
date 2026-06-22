@echo off
net start MongoDB
net start MinIO
net start mosquitto
net start mirador-mediamtx
net start mirador-scheduler
net start mirador-api
echo All Mirador services started.
