import React, { useEffect, useRef } from 'react';
import * as rrweb from 'rrweb';

export default function GlobalLiveMirror() {
  const isRecordingRef = useRef(false);
  const stopFnRef = useRef(null);

  useEffect(() => {
    let ws = null;
    let keepAliveInterval = null;
    let initTimeout = null;
    let mounted = true;

    const checkAndConnect = () => {
      if (!mounted) return;
      const sid = sessionStorage.getItem("miradorai_workstation_id");
      if (!sid) {
        initTimeout = setTimeout(checkAndConnect, 2000);
        return;
      }

      const stationDetails = { sid };

      const connect = () => {
        if (!mounted) return;
        const apiBase = import.meta.env.VITE_API_URL || '';
        let wsUrl = '';
        if (apiBase) {
          wsUrl = apiBase.replace(/^http/, 'ws') + '/ws/events?topics=station_' + stationDetails.sid;
        } else {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          wsUrl = protocol + '//' + window.location.host + '/ws/events?topics=station_' + stationDetails.sid;
        }

        console.log("[GlobalLiveMirror] Connecting to WebSocket:", wsUrl);
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log("[GlobalLiveMirror] Connected to:", stationDetails.sid);
          keepAliveInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ action: "ping" }));
            }
          }, 15000);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.event === "start_record") {
              if (!isRecordingRef.current) {
                isRecordingRef.current = true;
                console.log("[GlobalLiveMirror] Starting rrweb.record");
                
                try {
                  stopFnRef.current = rrweb.record({
                    blockSelector: "video",
                    inlineStylesheet: false,
                    sampling: {
                       mousemove: 150,
                       scroll: 200,
                    },
                    emit(rr_event) {
                      if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                          action: "publish",
                          topic: 'station_' + stationDetails.sid + '_stream',
                          pub_event: "rrweb_event",
                          data: rr_event
                        }));
                      }
                    }
                  });
                } catch (recordError) {
                  console.error("[GlobalLiveMirror] rrweb.record failed:", recordError);
                  isRecordingRef.current = false;
                }
              }
            } else if (msg.event === "stop_record") {
              if (isRecordingRef.current && stopFnRef.current) {
                stopFnRef.current();
                stopFnRef.current = null;
                isRecordingRef.current = false;
                console.log("[GlobalLiveMirror] Stopped rrweb.record");
              }
            }
          } catch (e) {
             console.error("[GlobalLiveMirror] WebSocket message parse error:", e);
          }
        };

        ws.onclose = () => {
          console.log("[GlobalLiveMirror] WebSocket closed, retrying in 5s...");
          if (keepAliveInterval) clearInterval(keepAliveInterval);
          if (isRecordingRef.current && stopFnRef.current) {
            stopFnRef.current();
            stopFnRef.current = null;
            isRecordingRef.current = false;
          }
          if (mounted) {
            setTimeout(connect, 5000);
          }
        };
      };

      connect();
    };

    checkAndConnect();

    return () => {
      mounted = false;
      if (initTimeout) clearTimeout(initTimeout);
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      if (ws) ws.close();
      if (isRecordingRef.current && stopFnRef.current) {
        stopFnRef.current();
        stopFnRef.current = null;
        isRecordingRef.current = false;
      }
    };
  }, []);

  return null;
}
