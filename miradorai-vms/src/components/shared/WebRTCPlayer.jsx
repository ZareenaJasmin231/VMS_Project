import { useEffect, useRef, useState, memo } from 'react'

// Place this file at:
// src/components/shared/WebRTCPlayer.jsx
//
// Usage:
// import WebRTCPlayer from '../../components/shared/WebRTCPlayer'
// <WebRTCPlayer serverUrl="ws://YOUR_SERVER_IP:3333/app/STREAM_KEY" />

function WebRTCPlayer({ serverUrl }) {
  const videoRef = useRef(null)
  const pcRef   = useRef(null)
  const wsRef   = useRef(null)
  const [connected, setConnected] = useState(false)
  const [error,     setError]     = useState('')
  const [retrying,  setRetrying]  = useState(false)
  const reconnectTimeoutRef = useRef(null)
  let reconnectAttempts = useRef(0)
  const MAX_RECONNECT_ATTEMPTS = 10
  const INITIAL_RECONNECT_DELAY = 2000 // 2 seconds
  const MAX_RECONNECT_DELAY = 30000 // 30 seconds

  useEffect(() => {
    let closed     = false
    let answerSent = false

    const getReconnectDelay = () => {
      const exponentialDelay = INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current)
      return Math.min(exponentialDelay, MAX_RECONNECT_DELAY)
    }

    async function start() {
      if (!serverUrl || closed) return
      setError('')
      setConnected(false)

      try {
        // ── 1. Create RTCPeerConnection with multiple STUN/TURN servers ──────
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
          ],
          iceCandidatePoolSize: 10,
        })
        pcRef.current = pc
        pc.addTransceiver('video', { direction: 'recvonly' })
        pc.addTransceiver('audio', { direction: 'recvonly' })

        // ── 2. When video/audio track arrives → attach to <video> ───────────
        pc.ontrack = (e) => {
          if (closed || !videoRef.current || !e.streams[0]) return
          videoRef.current.srcObject = e.streams[0]
          videoRef.current.play().catch(() => {})
          setConnected(true)
          reconnectAttempts.current = 0 // Reset on successful connection
          setRetrying(false)
        }

        // ── 3. Send ICE candidates to OME via WebSocket ──────────────────────
        pc.onicecandidate = (e) => {
          if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              command:      'candidate',
              candidate:    e.candidate.candidate,
              sdpMid:       e.candidate.sdpMid,
              sdpMLineIndex: e.candidate.sdpMLineIndex,
            }))
          }
        }

        // ── 4. Handle connection state changes ───────────────────────────────
        pc.onconnectionstatechange = () => {
          console.log(`[WebRTC] Connection state: ${pc.connectionState}`)
          if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
            if (!closed) {
              setConnected(false)
              // Only auto-reconnect on disconnected/failed, not on closed (manual cleanup)
              if (pc.connectionState !== 'closed' && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
                scheduleReconnect()
              } else if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
                setError(`Connection lost (${MAX_RECONNECT_ATTEMPTS} reconnect attempts failed)`)
              }
            }
          }
        }

        pc.oniceconnectionstatechange = () => {
          console.log(`[WebRTC] ICE state: ${pc.iceConnectionState}`)
        }

        // ── 5. Open WebSocket to OME signalling ────────────────────────────
        const ws = new WebSocket(serverUrl)
        wsRef.current = ws

        ws.onopen = () => {
          if (closed) { ws.close(); return }
          console.log('[WebSocket] Connected')
          ws.send(JSON.stringify({ command: 'request_offer' }))
        }

        ws.onmessage = async (evt) => {
          if (closed) return
          try {
            const msg = JSON.parse(evt.data)

            // OME sends an SDP offer → we answer it
            if ((msg.command === 'offer' || msg.type === 'offer') && msg.sdp && !answerSent) {
              answerSent = true
              await pc.setRemoteDescription(new RTCSessionDescription({
                type: 'offer',
                sdp:  msg.sdp.sdp || msg.sdp,
              }))
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              ws.send(JSON.stringify({
                command:  'answer',
                id:       msg.id,
                peer_id:  msg.peer_id,
                sdp:      { type: 'answer', sdp: answer.sdp },
              }))
            }

            // OME may batch-send ICE candidates
            if (Array.isArray(msg.candidates)) {
              for (const c of msg.candidates) {
                try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {}
              }
            }
          } catch (e) {
            console.error('[WebSocket] Message parse error:', e)
          }
        }

        ws.onerror = (e) => {
          console.error('[WebSocket] Error:', e)
          if (!closed && pc.connectionState !== 'connected' && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
            setError('WebSocket connection failed')
            scheduleReconnect()
          }
        }

        ws.onclose = () => {
          console.log('[WebSocket] Closed')
          if (!closed && pc.connectionState !== 'connected' && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
            scheduleReconnect()
          }
        }
      } catch (e) {
        console.error('[WebRTCPlayer] Error:', e)
        setError(String(e))
        if (!closed && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          scheduleReconnect()
        }
      }
    }

    const scheduleReconnect = () => {
      if (closed || reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) return
      reconnectAttempts.current++
      const delay = getReconnectDelay()
      console.log(`[WebRTCPlayer] Reconnect attempt ${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`)
      setRetrying(true)
      reconnectTimeoutRef.current = setTimeout(() => {
        if (!closed) start()
      }, delay)
    }



    start()

    // Cleanup on unmount / serverUrl change
    return () => {
      closed = true
      setConnected(false)
      setRetrying(false)
      clearTimeout(reconnectTimeoutRef.current)
      if (videoRef.current) videoRef.current.srcObject = null
      wsRef.current?.close()
      pcRef.current?.close()
    }
  }, [serverUrl])

  // ── Styles ──────────────────────────────────────────────────────────────────
  const wrapStyle = {
    position: 'relative',
    width: '100%',
    height: '100%',
    background: '#000',
    borderRadius: 6,
    overflow: 'hidden',
  }

  const centreStyle = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: 8,
  }

  return (
    <div style={wrapStyle}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />

      {/* CONNECTING state */}
      {!connected && !error && (
        <div style={centreStyle}>
          <span style={{ fontSize: 11, color: '#94a3b8', letterSpacing: 1 }}>
            ● CONNECTING…
          </span>
        </div>
      )}

      {/* RETRYING state */}
      {retrying && !error && (
        <div style={centreStyle}>
          <span style={{ fontSize: 12, color: '#f59e0b', letterSpacing: 1 }}>
            ⟳ RECONNECTING…
          </span>
          <span style={{ fontSize: 9, color: '#78716c' }}>
            Attempt {reconnectAttempts.current}
          </span>
        </div>
      )}

      {/* ERROR state */}
      {error && (
        <div style={centreStyle}>
          <span style={{ color: '#ef4444', fontSize: 20 }}>⚠</span>
          <span style={{ color: '#94a3b8', fontSize: 11, textAlign: 'center', maxWidth: '80%' }}>
            {error}
          </span>
          {reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS && (
            <span style={{ color: '#78716c', fontSize: 9, marginTop: 8 }}>
              Auto-reconnecting...
            </span>
          )}
        </div>
      )}

      {/* LIVE badge */}
      {connected && (
        <div style={{
          position: 'absolute', top: 8, left: 8,
          background: 'rgba(0,0,0,.6)',
          padding: '2px 7px', borderRadius: 3,
          fontSize: 10, color: '#22c55e', letterSpacing: 1,
        }}>
          ● LIVE
        </div>
      )}
    </div>
  )
}

export default memo(WebRTCPlayer)