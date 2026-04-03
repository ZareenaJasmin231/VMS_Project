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





import { useEffect, useRef, useState, memo } from 'react'

function WebRTCPlayer({ serverUrl }) {
  const videoRef  = useRef(null)
  const pcRef     = useRef(null)
  const wsRef     = useRef(null)
  const peerIdRef = useRef(null)   // ← NEW
  const [connected, setConnected] = useState(false)
  const [error,     setError]     = useState('')

  useEffect(() => {
    let closed     = false
    let answerSent = false

    async function start() {
      if (!serverUrl) return
      setError('')
      setConnected(false)

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      })
      pcRef.current = pc
      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.addTransceiver('audio', { direction: 'recvonly' })

      pc.ontrack = (e) => {
        if (closed || !videoRef.current || !e.streams[0]) return
        videoRef.current.srcObject = e.streams[0]
        videoRef.current.play().catch(() => {})
        setConnected(true)
      }

      // ← FIXED: now sends id and peer_id with every ICE candidate
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
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
          if (!closed) setConnected(false)
        }
      }

      try {
        const ws = new WebSocket(serverUrl)
        wsRef.current = ws

        ws.onopen = () => {
          if (closed) { ws.close(); return }
          ws.send(JSON.stringify({ command: 'request_offer' }))
        }

        ws.onmessage = async (evt) => {
          if (closed) return
          const msg = JSON.parse(evt.data)

          if ((msg.command === 'offer' || msg.type === 'offer') && msg.sdp && !answerSent) {
            answerSent = true
            peerIdRef.current = msg.peer_id   // ← NEW: save peer_id from offer
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

          if (Array.isArray(msg.candidates)) {
            for (const c of msg.candidates) {
              try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {}
            }
          }
        }

        ws.onerror = ()  => setError('...')
        ws.onclose = ()  => { if (!closed) setConnected(false) }
      } catch (e) {
        setError(String(e))
      }
    }

    start()

    return () => {
      closed = true
      setConnected(false)
      if (videoRef.current) videoRef.current.srcObject = null
      wsRef.current?.close()
      pcRef.current?.close()
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
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
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
          <span style={{ color: '#ef4444', fontSize: 20 }}></span>
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