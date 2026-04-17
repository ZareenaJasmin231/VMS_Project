// import { useEffect, useRef, useState, memo } from 'react'

// function WebRTCPlayer({ serverUrl }) {
//   const videoRef = useRef(null)
//   const pcRef = useRef(null)
//   const wsRef = useRef(null)
//   const peerIdRef = useRef(null)
//   const [connected, setConnected] = useState(false)
//   const [error, setError] = useState('')

//   useEffect(() => {
//     let closed = false
//     let answerSent = false

//     async function start() {
//       if (!serverUrl) return
//       setError('')
//       setConnected(false)

//       try {
//         const pc = new RTCPeerConnection({
//           iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
//         })
//         pcRef.current = pc

//         // Pre-configure transceivers for receiving
//         pc.addTransceiver('video', { direction: 'recvonly' })
//         pc.addTransceiver('audio', { direction: 'recvonly' })

//         pc.ontrack = (e) => {
//           if (closed || !videoRef.current) return
          
//           // Ensure we capture the stream correctly
//           const stream = e.streams[0] || new MediaStream([e.track])
//           if (videoRef.current.srcObject !== stream) {
//             videoRef.current.srcObject = stream
//             // Force play once metadata loads to bypass some browser restrictions
//             videoRef.current.onloadedmetadata = () => {
//               videoRef.current.play().catch(() => {})
//             }
//             setConnected(true)
//           }
//         }

//         pc.onicecandidate = (e) => {
//           // Only send if candidate exists and peerId is known
//           if (e.candidate && peerIdRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
//             wsRef.current.send(JSON.stringify({
//               command: 'candidate',
//               id: peerIdRef.current,
//               peer_id: peerIdRef.current,
//               candidate: e.candidate.candidate,
//               sdpMid: e.candidate.sdpMid,
//               sdpMLineIndex: e.candidate.sdpMLineIndex,
//             }))
//           }
//         }

//         pc.onconnectionstatechange = () => {
//           console.log("Connection State:", pc.connectionState)
//           if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
//             if (!closed) setConnected(false)
//           }
//         }

//         const ws = new WebSocket(serverUrl)
//         wsRef.current = ws

//         ws.onopen = () => {
//           if (closed) { ws.close(); return }
//           ws.send(JSON.stringify({ command: 'request_offer' }))
//         }

//         ws.onmessage = async (evt) => {
//           if (closed) return
//           const msg = JSON.parse(evt.data)

//           // 1. Handle Offer
//           if ((msg.command === 'offer' || msg.type === 'offer') && msg.sdp && !answerSent) {
//             answerSent = true
//             peerIdRef.current = msg.peer_id || msg.id

//             const remoteSdp = typeof msg.sdp === 'string' ? msg.sdp : msg.sdp.sdp
//             await pc.setRemoteDescription(new RTCSessionDescription({
//               type: 'offer',
//               sdp: remoteSdp,
//             }))

//             const answer = await pc.createAnswer()
//             await pc.setLocalDescription(answer)

//             ws.send(JSON.stringify({
//               command: 'answer',
//               id: msg.id,
//               peer_id: msg.peer_id,
//               sdp: { type: 'answer', sdp: answer.sdp },
//             }))
//           }

//           // 2. Handle ICE Candidates (Supports both single objects and arrays)
//           if (msg.command === 'candidate' || msg.candidate || Array.isArray(msg.candidates)) {
//             const candidates = Array.isArray(msg.candidates) ? msg.candidates : [msg]
            
//             for (const c of candidates) {
//               if (c.candidate) {
//                 try {
//                   await pc.addIceCandidate(new RTCIceCandidate({
//                     candidate: c.candidate,
//                     sdpMid: c.sdpMid,
//                     sdpMLineIndex: c.sdpMLineIndex
//                   }))
//                 } catch (e) {
//                   console.warn("Failed to add ICE candidate", e)
//                 }
//               }
//             }
//           }
//         }

//         ws.onerror = () => setError('.')
//         ws.onclose = () => { if (!closed) setConnected(false) }

//       } catch (e) {
//         console.error("WebRTC Error:", e)
//         setError(String(e))
//       }
//     }

//     start()

//     return () => {
//       closed = true
//       setConnected(false)
//       if (videoRef.current) videoRef.current.srcObject = null
//       wsRef.current?.close()
//       pcRef.current?.close()
//     }
//   }, [serverUrl])

//   const wrapStyle = {
//     position: 'relative', width: '100%', height: '100%',
//     background: '#000', borderRadius: 6, overflow: 'hidden',
//   }

//   const centreStyle = {
//     position: 'absolute', inset: 0, display: 'flex',
//     alignItems: 'center', justifyContent: 'center',
//     flexDirection: 'column', gap: 8, zIndex: 10,
//   }

//   return (
//     <div style={wrapStyle}>
//       <video
//         ref={videoRef}
//         autoPlay
//         muted
//         playsInline
//         style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
//       />
      
//       {!connected && !error && (
//         <div style={centreStyle}>
//           <span style={{ fontSize: 11, color: '#94a3b8', letterSpacing: 1 }}>
//             ● CONNECTING…
//           </span>
//         </div>
//       )}

//       {error && (
//         <div style={centreStyle}>
//           <span style={{ color: '#fafafa', fontSize: 11 }}>{error}</span>
//         </div>
//       )}

//       {connected && (
//         <div style={{
//           position: 'absolute', top: 8, left: 8,
//           background: 'rgba(0,0,0,.6)',
//           padding: '2px 7px', borderRadius: 3,
//           fontSize: 10, color: '#22c55e', letterSpacing: 1,
//         }}>
//           ● LIVE
//         </div>
//       )}
//     </div>
//   )
// }

// export default memo(WebRTCPlayer)





// import { useEffect, useRef, useState, memo } from 'react'

// function WebRTCPlayer({ serverUrl }) {
//   const videoRef  = useRef(null)
//   const pcRef     = useRef(null)
//   const wsRef     = useRef(null)
//   const peerIdRef = useRef(null)   // ← NEW
//   const [connected, setConnected] = useState(false)
//   const [error,     setError]     = useState('')

//   useEffect(() => {
//     let closed     = false
//     let answerSent = false

//     async function start() {
//       if (!serverUrl) return
//       setError('')
//       setConnected(false)

//       const pc = new RTCPeerConnection({
//         iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
//       })
//       pcRef.current = pc
//       pc.addTransceiver('video', { direction: 'recvonly' })
//       pc.addTransceiver('audio', { direction: 'recvonly' })

//       pc.ontrack = (e) => {
//         if (closed || !videoRef.current || !e.streams[0]) return
//         videoRef.current.srcObject = e.streams[0]
//         videoRef.current.play().catch(() => {})
//         setConnected(true)
//       }

//       // ← FIXED: now sends id and peer_id with every ICE candidate
//       pc.onicecandidate = (e) => {
//         if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
//           wsRef.current.send(JSON.stringify({
//             command:       'candidate',
//             id:            peerIdRef.current,
//             peer_id:       peerIdRef.current,
//             candidate:     e.candidate.candidate,
//             sdpMid:        e.candidate.sdpMid,
//             sdpMLineIndex: e.candidate.sdpMLineIndex,
//           }))
//         }
//       }

//       pc.onconnectionstatechange = () => {
//         if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
//           if (!closed) setConnected(false)
//         }
//       }

//       try {
//         const ws = new WebSocket(serverUrl)
//         wsRef.current = ws

//         ws.onopen = () => {
//           if (closed) { ws.close(); return }
//           ws.send(JSON.stringify({ command: 'request_offer' }))
//         }

//         ws.onmessage = async (evt) => {
//           if (closed) return
//           const msg = JSON.parse(evt.data)

//           if ((msg.command === 'offer' || msg.type === 'offer') && msg.sdp && !answerSent) {
//             answerSent = true
//             peerIdRef.current = msg.peer_id   // ← NEW: save peer_id from offer
//             await pc.setRemoteDescription(new RTCSessionDescription({
//               type: 'offer',
//               sdp:  msg.sdp.sdp || msg.sdp,
//             }))
//             const answer = await pc.createAnswer()
//             await pc.setLocalDescription(answer)
//             ws.send(JSON.stringify({
//               command:  'answer',
//               id:       msg.id,
//               peer_id:  msg.peer_id,
//               sdp:      { type: 'answer', sdp: answer.sdp },
//             }))
//           }

//           if (Array.isArray(msg.candidates)) {
//             for (const c of msg.candidates) {
//               try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {}
//             }
//           }
//         }

//         ws.onerror = ()  => setError('...')
//         ws.onclose = ()  => { if (!closed) setConnected(false) }
//       } catch (e) {
//         setError(String(e))
//       }
//     }

//     start()

//     return () => {
//       closed = true
//       setConnected(false)
//       if (videoRef.current) videoRef.current.srcObject = null
//       wsRef.current?.close()
//       pcRef.current?.close()
//     }
//   }, [serverUrl])

//   const wrapStyle = {
//     position: 'relative', width: '100%', height: '100%',
//     background: '#000', borderRadius: 6, overflow: 'hidden',
//   }

//   const centreStyle = {
//     position: 'absolute', inset: 0, display: 'flex',
//     alignItems: 'center', justifyContent: 'center',
//     flexDirection: 'column', gap: 8,
//   }

//   return (
//     <div style={wrapStyle}>
//       <video
//         ref={videoRef}
//         autoPlay muted playsInline
//         style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
//       />
//       {!connected && !error && (
//         <div style={centreStyle}>
//           <span style={{ fontSize: 11, color: '#94a3b8', letterSpacing: 1 }}>
//             ● CONNECTING…
//           </span>
//         </div>
//       )}
//       {error && (
//         <div style={centreStyle}>
//           <span style={{ color: '#ef4444', fontSize: 20 }}></span>
//           <span style={{ color: '#94a3b8', fontSize: 11 }}>{error}</span>
//         </div>
//       )}
//       {connected && (
//         <div style={{
//           position: 'absolute', top: 8, left: 8,
//           background: 'rgba(0,0,0,.6)',
//           padding: '2px 7px', borderRadius: 3,
//           fontSize: 10, color: '#22c55e', letterSpacing: 1,
//         }}>
//           ● LIVE
//         </div>
//       )}
//     </div>
//   )
// }

// export default memo(WebRTCPlayer)



import { useEffect, useRef, useState, memo } from 'react';
import { useImageConfig } from '../../hooks/useImageConfig';

function WebRTCPlayer({ serverUrl, cameraId }) {
  const videoRef    = useRef(null);
  const pcRef       = useRef(null)
  const wsRef       = useRef(null)
  const peerIdRef   = useRef(null)
  const retryTimer  = useRef(null)
  const mountedRef  = useRef(false)

  const [connected, setConnected] = useState(false)
  const [error,     setError]     = useState('')

  const { cssFilter, cssTransform } = useImageConfig(cameraId);

  useEffect(() => {
    // ← Guard against StrictMode double-mount
    if (mountedRef.current) return
    mountedRef.current = true

    let closed     = false
    let answerSent = false

    function cleanup() {
      closed = true
      clearTimeout(retryTimer.current)
      setConnected(false)
      if (videoRef.current) videoRef.current.srcObject = null
      if (wsRef.current) {
        wsRef.current.onopen    = null
        wsRef.current.onmessage = null
        wsRef.current.onerror   = null
        wsRef.current.onclose   = null
        wsRef.current.close()
        wsRef.current = null
      }
      if (pcRef.current) {
        pcRef.current.ontrack               = null
        pcRef.current.onicecandidate        = null
        pcRef.current.onconnectionstatechange = null
        pcRef.current.close()
        pcRef.current = null
      }
    }

    async function start() {
      if (closed || !serverUrl) return
      setError('')
      answerSent = false
      peerIdRef.current = null

      // Clean up any previous connection
      if (wsRef.current)  { wsRef.current.close();  wsRef.current  = null }
      if (pcRef.current)  { pcRef.current.close();  pcRef.current  = null }

      // ── Setup PeerConnection ──────────────────────────────────
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      })
      pcRef.current = pc

      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.addTransceiver('audio', { direction: 'recvonly' })

      pc.ontrack = (e) => {
        if (closed || !videoRef.current) return
        const stream = e.streams[0] || new MediaStream([e.track])
        if (videoRef.current.srcObject !== stream) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
          setConnected(true)
        }
      }

      pc.onicecandidate = (e) => {
        if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            command:       'candidate',
            id:            peerIdRef.current,
            peer_id:       peerIdRef.current,
            candidate:     e.candidate.candidate,
            sdpMid:        e.candidate.sdpMid,
            sdpMLineIndex: e.candidate.sdpMLineIndex,
          }))
        }
      }

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] ${serverUrl} → ${pc.connectionState}`)
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
          if (!closed) {
            setConnected(false)
            // ← Auto retry after 4 seconds
            retryTimer.current = setTimeout(start, 4000)
          }
        }
      }

      // ── Setup WebSocket ───────────────────────────────────────
      try {
        console.log(`[WebRTC] Connecting to ${serverUrl}`)
        const ws = new WebSocket(serverUrl)
        wsRef.current = ws

        ws.onopen = () => {
          if (closed) { ws.close(); return }
          console.log(`[WebRTC] WS open → requesting offer`)
          ws.send(JSON.stringify({ command: 'request_offer' }))
        }

        ws.onmessage = async (evt) => {
          if (closed) return
          let msg
          try { msg = JSON.parse(evt.data) } catch { return }

          // Handle offer
          if ((msg.command === 'offer' || msg.type === 'offer') && msg.sdp && !answerSent) {
            answerSent        = true
            peerIdRef.current = msg.peer_id || msg.id

            const sdpStr = typeof msg.sdp === 'string' ? msg.sdp : msg.sdp?.sdp
            if (!sdpStr) return

            try {
              await pc.setRemoteDescription(
                new RTCSessionDescription({ type: 'offer', sdp: sdpStr })
              )
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              ws.send(JSON.stringify({
                command: 'answer',
                id:      msg.id,
                peer_id: msg.peer_id,
                sdp:     { type: 'answer', sdp: answer.sdp },
              }))
            } catch (e) {
              console.error('[WebRTC] SDP error:', e)
            }
          }

          // Handle ICE candidates
          const candidates = Array.isArray(msg.candidates)
            ? msg.candidates
            : msg.candidate ? [msg] : []

          for (const c of candidates) {
            if (c.candidate) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate({
                  candidate:     c.candidate,
                  sdpMid:        c.sdpMid,
                  sdpMLineIndex: c.sdpMLineIndex,
                }))
              } catch {}
            }
          }
        }

        ws.onerror = (e) => {
          console.error('[WebRTC] WS error', e)
          if (!closed) setError('Connection error — retrying…')
        }

        ws.onclose = (e) => {
          console.log(`[WebRTC] WS closed — code:${e.code}`)
          if (!closed) {
            setConnected(false)
            // ← Retry on unexpected close
            if (e.code !== 1000) {
              retryTimer.current = setTimeout(start, 4000)
            }
          }
        }

      } catch (e) {
        console.error('[WebRTC] start error:', e)
        if (!closed) {
          setError('Failed to connect — retrying…')
          retryTimer.current = setTimeout(start, 4000)
        }
      }
    }

    // Small delay to avoid StrictMode race condition
    retryTimer.current = setTimeout(start, 300)

    return () => {
      mountedRef.current = false
      cleanup()
    }
  }, [serverUrl])

  const wrapStyle = {
    position: 'relative', width: '100%', height: '100%',
    background: '#000', borderRadius: 6, overflow: 'hidden',
  }

  const centreStyle = {
    position: 'absolute', inset: 0, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'column', gap: 8,
  }

  return (
    <div style={wrapStyle}>
      <video
        ref={videoRef}
        autoPlay muted playsInline
        style={{ 
          width: '100%', 
          height: '100%', 
          objectFit: 'cover', 
          display: 'block',
          filter: cssFilter || 'none',
          transform: cssTransform || 'none',
          transition: "filter 0.1s ease, transform 0.2s ease"
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