import React, { useEffect, useRef } from 'react';

export default function GlobalLiveMirror() {
  const pcRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    let ws = null;
    let keepAliveInterval = null;
    let globalHeartbeatInterval = null;
    let initTimeout = null;
    let mounted = true;

    const rtcConfig = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject"
        }
      ]
    };

    const cleanupWebRTC = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };

    const checkAndConnect = () => {
      if (!mounted) return;
      
      let sid = sessionStorage.getItem("miradorai_workstation_id");
      if (!sid) {
        sid = "ws-" + Math.random().toString(36).substring(2, 8);
        sessionStorage.setItem("miradorai_workstation_id", sid);
      }
      let sname = sessionStorage.getItem("miradorai_workstation_name");
      if (!sname) {
        sname = "Terminal " + sid.split("-")[1].toUpperCase();
        sessionStorage.setItem("miradorai_workstation_name", sname);
      }

      const stationDetails = { sid, sname };
      
      const apiBase = import.meta.env.VITE_API_URL || '';
      
      const sendGlobalHeartbeat = async () => {
        const token = localStorage.getItem("miradorai_token");
        if (!token || window.location.pathname.includes('/live-view')) return;
        try {
          await fetch(`${apiBase}/api/viewing-stations/heartbeat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + token
            },
            body: JSON.stringify({
              station_id: sid,
              name: sname,
              grid: "Background",
              device_order: [],
              applied_timestamp: 0,
              active_feeds_count: 0
            })
          });
        } catch (e) {}
      };
      
      globalHeartbeatInterval = setInterval(sendGlobalHeartbeat, 5000);
      sendGlobalHeartbeat();

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

        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);
            
            if (msg.event === "start_record") {
              console.log("[GlobalLiveMirror] Starting System Screen Capture");
              cleanupWebRTC();

              try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                  console.error("[GlobalLiveMirror] getDisplayMedia is not supported in this browser or context. Make sure you are using HTTPS or localhost.");
                  alert("Screen sharing is not supported in this browser. Please ensure you are accessing the site via HTTPS or localhost to enable screen sharing.");
                  return;
                }
                const stream = await navigator.mediaDevices.getDisplayMedia({
                  video: { displaySurface: "monitor" },
                  audio: false
                });
                streamRef.current = stream;

                const pc = new RTCPeerConnection(rtcConfig);
                pcRef.current = pc;
                pcRef.current.remoteDescriptionSet = false;
                pcRef.current.iceQueue = [];

                stream.getTracks().forEach(track => pc.addTrack(track, stream));

                pc.onconnectionstatechange = () => {
                    console.log("[GlobalLiveMirror] Connection state:", pc.connectionState);
                };
                
                pc.oniceconnectionstatechange = () => {
                    console.log("[GlobalLiveMirror] ICE connection state:", pc.iceConnectionState);
                };

                pc.onicecandidate = (e) => {
                  if (e.candidate && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                      action: "publish",
                      topic: `station_${stationDetails.sid}_stream`,
                      pub_event: "webrtc_ice_candidate",
                      data: e.candidate
                    }));
                  }
                };

                // When user manually stops sharing via browser bar
                stream.getVideoTracks()[0].onended = () => {
                    cleanupWebRTC();
                };

                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                if (ws.readyState === WebSocket.OPEN) {
                  console.log("[GlobalLiveMirror] Sending webrtc_offer");
                  ws.send(JSON.stringify({
                    action: "publish",
                    topic: `station_${stationDetails.sid}_stream`,
                    pub_event: "webrtc_offer",
                    data: offer
                  }));
                }
              } catch (err) {
                console.error("[GlobalLiveMirror] Display media error:", err);
              }
            } else if (msg.event === "webrtc_answer") {
              console.log("[GlobalLiveMirror] Received webrtc_answer");
              if (pcRef.current) {
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.data));
                pcRef.current.remoteDescriptionSet = true;
                for (let c of pcRef.current.iceQueue) {
                    await pcRef.current.addIceCandidate(c);
                }
              }
            } else if (msg.event === "webrtc_ice_candidate") {
              console.log("[GlobalLiveMirror] Received webrtc_ice_candidate");
              if (pcRef.current) {
                const candidate = new RTCIceCandidate(msg.data);
                if (pcRef.current.remoteDescriptionSet) {
                    await pcRef.current.addIceCandidate(candidate);
                } else {
                    pcRef.current.iceQueue.push(candidate);
                }
              }
            } else if (msg.event === "stop_record") {
              console.log("[GlobalLiveMirror] Received stop_record, cleaning up WebRTC");
              cleanupWebRTC();
            }
          } catch (e) {
             console.error("[GlobalLiveMirror] WebSocket message parse error:", e);
          }
        };

        ws.onclose = () => {
          console.log("[GlobalLiveMirror] WebSocket closed, retrying in 5s...");
          cleanupWebRTC();
          if (keepAliveInterval) clearInterval(keepAliveInterval);
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
      if (globalHeartbeatInterval) clearInterval(globalHeartbeatInterval);
      if (ws) ws.close();
      cleanupWebRTC();
    };
  }, []);

  return null;
}
