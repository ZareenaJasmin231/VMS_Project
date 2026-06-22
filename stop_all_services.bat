@echo off
net stop mirador-api
net stop mirador-scheduler
net stop mirador-recorder
net stop mirador-mediamtx
net stop mosquitto
echo All Mirador app services stopped.
