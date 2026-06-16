import { useEffect, useRef, useState, memo } from 'react';
import { useImageConfig } from '../../hooks/useImageConfig';
import { Volume2, VolumeX } from 'lucide-react';
import { useDigitalZoom } from '../../hooks/useDigitalZoom';

class StreamConnection {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.pc = null;
    this.ws = null;
    this.stream = null;
    this.connected = false;
    this.error = '';
    this.subscribers = new Set();
    this.cleanupTimer = null;
    this.peerId = null;
    this.answerSent = false;
    this.closed = false;

    this.start();
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    // Call immediately with current state
    callback({
      connected: this.connected,
      error: this.error,
      stream: this.stream
    });
  }

  unsubscribe(callback) {
    this.subscribers.delete(callback);
    if (this.subscribers.size === 0) {
      // Keep connection alive for 15 seconds after last subscriber unmounts
      this.cleanupTimer = setTimeout(() => {
        this.destroy();
      }, 15000);
    }
  }

  notify() {
    for (const callback of this.subscribers) {
      try {
        callback({
          connected: this.connected,
          error: this.error,
          stream: this.stream
        });
      } catch (err) {
        console.error('[WebRTC Cache] Notify callback error:', err);
      }
    }
  }

  destroy() {
    this.closed = true;
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      try { this.pc.close(); } catch {}
      this.pc = null;
    }
    this.stream = null;
    this.connected = false;
    delete streamCache[this.serverUrl];
  }

  async start() {
    if (this.closed || !this.serverUrl) return;
    this.error = '';
    this.connected = false;
    this.answerSent = false;
    this.peerId = null;
    this.notify();

    // Clean up any existing connection
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    if (this.pc) { try { this.pc.close(); } catch {} this.pc = null; }

    // ── Setup PeerConnection ──────────────────────────────────
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    this.pc = pc;

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.ontrack = (e) => {
      if (this.closed) return;
      const stream = e.streams[0] || new MediaStream([e.track]);
      if (this.stream !== stream) {
        this.stream = stream;
        this.connected = true;
        this.notify();
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          command:       'candidate',
          id:            this.peerId,
          peer_id:       this.peerId,
          candidate: {
            candidate:     e.candidate.candidate,
            sdpMid:        e.candidate.sdpMid,
            sdpMLineIndex: e.candidate.sdpMLineIndex,
          }
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC Cache] ${this.serverUrl} → ${pc.connectionState}`);
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        if (!this.closed) {
          this.connected = false;
          this.notify();
          // Auto retry after 4 seconds
          setTimeout(() => {
            if (!this.closed && !this.connected) {
              this.start();
            }
          }, 4000);
        }
      }
    };

    // ── Setup WebSocket ───────────────────────────────────────
    try {
      console.log(`[WebRTC Cache] Connecting to ${this.serverUrl}`);
      const ws = new WebSocket(this.serverUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (this.closed) { ws.close(); return; }
        console.log(`[WebRTC Cache] WS open → requesting offer`);
        ws.send(JSON.stringify({ command: 'request_offer' }));
      };

      ws.onmessage = async (evt) => {
        if (this.closed) return;
        let msg;
        try { msg = JSON.parse(evt.data); } catch { return; }

        // Handle offer
        if ((msg.command === 'offer' || msg.type === 'offer') && msg.sdp && !this.answerSent) {
          this.answerSent = true;
          this.peerId = msg.peer_id || msg.id;

          const sdpStr = typeof msg.sdp === 'string' ? msg.sdp : msg.sdp?.sdp;
          if (!sdpStr) return;

          try {
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: 'offer', sdp: sdpStr })
            );
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({
              command: 'answer',
              id:      msg.id,
              peer_id: msg.peer_id,
              sdp:     { type: 'answer', sdp: answer.sdp },
            }));
          } catch (e) {
            console.error('[WebRTC Cache] SDP error:', e);
          }
        }

        // Handle ICE candidates
        const candidates = Array.isArray(msg.candidates)
          ? msg.candidates
          : msg.candidate ? [msg] : [];

        for (const c of candidates) {
          if (c.candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate({
                candidate:     c.candidate,
                sdpMid:        c.sdpMid,
                sdpMLineIndex: c.sdpMLineIndex,
              }));
            } catch {}
          }
        }
      };

      ws.onerror = (e) => {
        console.error('[WebRTC Cache] WS error', e);
        if (!this.closed) {
          this.error = 'Connection error — retrying…';
          this.notify();
        }
      };

      ws.onclose = (e) => {
        console.log(`[WebRTC Cache] WS closed — code:${e.code}`);
        if (!this.closed) {
          this.connected = false;
          this.notify();
          if (e.code !== 1000) {
            setTimeout(() => {
              if (!this.closed && !this.connected) {
                this.start();
              }
            }, 4000);
          }
        }
      };

    } catch (e) {
      console.error('[WebRTC Cache] start error:', e);
      if (!this.closed) {
        this.error = 'Failed to connect — retrying…';
        this.notify();
        setTimeout(() => {
          if (!this.closed && !this.connected) {
            this.start();
          }
        }, 4000);
      }
    }
  }
}

const streamCache = {};

function getOrCreateStream(serverUrl) {
  if (!serverUrl) return null;
  if (!streamCache[serverUrl]) {
    streamCache[serverUrl] = new StreamConnection(serverUrl);
  }
  return streamCache[serverUrl];
}

function WebRTCPlayer({ serverUrl, cameraId, onConnectChange }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [isMuted, setIsMuted] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);

  useEffect(() => {
    onConnectChange?.(connected);
  }, [connected, onConnectChange]);

  const { cssFilter, cssTransform } = useImageConfig(cameraId);
  const { zoom, zoomTransform, handlers } = useDigitalZoom(containerRef, videoRef);

  useEffect(() => {
    if (!serverUrl) return;

    const connection = getOrCreateStream(serverUrl);
    if (!connection) return;

    const handleUpdate = (state) => {
      setConnected(state.connected);
      setError(state.error);

      if (videoRef.current) {
        if (state.stream) {
          if (videoRef.current.srcObject !== state.stream) {
            videoRef.current.srcObject = state.stream;
            videoRef.current.play().catch(() => {});
          }
        } else {
          videoRef.current.srcObject = null;
        }
      }
    };

    connection.subscribe(handleUpdate);

    return () => {
      connection.unsubscribe(handleUpdate);
    };
  }, [serverUrl]);

  const toggleMute = (e) => {
    e.stopPropagation();
    setIsMuted(prev => !prev);
  };

  const wrapStyle = {
    position: 'relative', width: '100%', height: '100%',
    background: '#000', borderRadius: 6, overflow: 'hidden',
  };

  const centreStyle = {
    position: 'absolute', inset: 0, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'column', gap: 8,
  };

  const volumeBtnStyle = {
    position: 'absolute',
    bottom: '8px',
    left: '8px',
    background: btnHovered ? 'rgba(20, 184, 166, 0.95)' : 'rgba(15, 23, 42, 0.75)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '50%',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    zIndex: 20,
    outline: 'none',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
    opacity: hovered ? 1 : 0,
    transform: hovered ? 'scale(1)' : 'scale(0.85)',
    pointerEvents: hovered ? 'auto' : 'none',
  };

  return (
    <div 
      ref={containerRef}
      style={{ ...wrapStyle, cursor: zoom > 1 ? 'grab' : 'default' }}
      {...handlers}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <video
        ref={videoRef}
        autoPlay
        muted={isMuted}
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          filter: cssFilter || 'none',
          transform: `${cssTransform !== 'none' ? cssTransform : ''} ${zoomTransform !== 'none' ? zoomTransform : ''}`.trim() || 'none',
          transition: "filter 0.1s ease"
        }}
      />
      {!connected && !error && (
        <div style={centreStyle}>
          <span style={{ fontSize: 11, color: '#94a3b8', letterSpacing: 1 }}>
            ● CONNECTING…
          </span>
        </div>
      )}
      {error && (
        <div style={centreStyle}>
          <span style={{ color: '#ef4444', fontSize: 20 }}>⚠</span>
          <span style={{ color: '#94a3b8', fontSize: 11 }}>{error}</span>
        </div>
      )}
      {connected && !error && (
        <button
          style={volumeBtnStyle}
          onClick={toggleMute}
          onMouseEnter={() => setBtnHovered(true)}
          onMouseLeave={() => setBtnHovered(false)}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      )}
    </div>
  );
}

export default memo(WebRTCPlayer);