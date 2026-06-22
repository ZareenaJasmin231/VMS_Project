import { useEffect, useRef, useState, memo } from "react";
import { useImageConfig } from "../../hooks/useImageConfig";
import { Volume2, VolumeX } from "lucide-react";
import { useDigitalZoom } from "../../hooks/useDigitalZoom";

function WebRTCPlayer_MediaMTX({ streamKey, cameraId, onConnectChange }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);

  const [status, setStatus] = useState("connecting"); // "connecting", "connected", "reconnecting", "failed"
  const [errorMsg, setErrorMsg] = useState("");
  const [isMuted, setIsMuted] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);

  const { cssFilter, cssTransform } = useImageConfig(cameraId || streamKey);
  const { zoom, zoomTransform, handlers } = useDigitalZoom(containerRef, videoRef);

  // Store references for cleanup and state
  const pcRef = useRef(null);
  const whepLocationRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const isComponentMounted = useRef(true);

  const cleanupConnection = () => {
    // Clear reconnect timer
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Cleanup WHEP session
    if (whepLocationRef.current) {
      try {
        const whepUrl = new URL(whepLocationRef.current, `http://127.0.0.1:8889/${streamKey}/whep`);
        fetch(whepUrl.toString(), { method: "DELETE", keepalive: true }).catch((err) =>
          console.error("WHEP delete failed", err)
        );
      } catch (err) {
        console.error("Failed to parse WHEP location URL", err);
      }
      whepLocationRef.current = null;
    }

    // Close PC
    if (pcRef.current) {
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.ontrack = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    // Clear video
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startConnection = async () => {
    if (!isComponentMounted.current) return;

    cleanupConnection();

    setStatus((prev) => (prev === "failed" || prev === "reconnecting" ? "reconnecting" : "connecting"));
    setErrorMsg("");

    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      pc.ontrack = (event) => {
        if (videoRef.current && videoRef.current.srcObject !== event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          videoRef.current.play().catch(() => {});
        }
      };

      pc.onconnectionstatechange = () => {
        if (!isComponentMounted.current) return;

        if (pc.connectionState === "connected") {
          setStatus("connected");
          onConnectChange?.(true);
        } else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
          setStatus("reconnecting");
          onConnectChange?.(false);

          if (!reconnectTimeoutRef.current) {
            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectTimeoutRef.current = null;
              startConnection();
            }, 3000);
          }
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const response = await fetch(`http://127.0.0.1:8889/${streamKey}/whep`, {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const locationHeader = response.headers.get("Location");
      if (locationHeader) {
        whepLocationRef.current = locationHeader;
      }

      const answer = await response.text();
      await pc.setRemoteDescription({
        type: "answer",
        sdp: answer,
      });
    } catch (err) {
      console.error("MediaMTX WHEP Error", err);
      if (isComponentMounted.current) {
        setStatus("failed");
        setErrorMsg("Connection failed");
        onConnectChange?.(false);

        if (!reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            startConnection();
          }, 3000);
        }
      }
    }
  };

  useEffect(() => {
    isComponentMounted.current = true;
    startConnection();

    return () => {
      isComponentMounted.current = false;
      cleanupConnection();
      onConnectChange?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey]);

  const toggleMute = (e) => {
    e.stopPropagation();
    setIsMuted((prev) => !prev);
  };

  const wrapStyle = {
    position: "relative",
    width: "100%",
    height: "100%",
    background: "#000",
    borderRadius: 6,
    overflow: "hidden",
  };

  const centreStyle = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    gap: 8,
    pointerEvents: "none",
  };

  const volumeBtnStyle = {
    position: "absolute",
    bottom: "8px",
    left: "8px",
    background: btnHovered ? "rgba(20, 184, 166, 0.95)" : "rgba(15, 23, 42, 0.75)",
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    borderRadius: "50%",
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#ffffff",
    cursor: "pointer",
    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
    zIndex: 20,
    outline: "none",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
    opacity: hovered ? 1 : 0,
    transform: hovered ? "scale(1)" : "scale(0.85)",
    pointerEvents: hovered ? "auto" : "none",
  };

  return (
    <div
      ref={containerRef}
      style={{ ...wrapStyle, cursor: zoom > 1 ? "grab" : "default" }}
      {...handlers}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMuted}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          filter: cssFilter || "none",
          transform: `${cssTransform !== "none" && cssTransform ? cssTransform : ""} ${
            zoomTransform !== "none" && zoomTransform ? zoomTransform : ""
          }`.trim() || "none",
          transition: "filter 0.1s ease",
        }}
      />
      {status === "connecting" && (
        <div style={centreStyle}>
          <span style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1 }}>
            ● CONNECTING…
          </span>
        </div>
      )}
      {status === "reconnecting" && (
        <div style={centreStyle}>
          <span style={{ fontSize: 11, color: "#f59e0b", letterSpacing: 1 }}>
            ● RECONNECTING…
          </span>
        </div>
      )}
      {status === "failed" && (
        <div style={centreStyle}>
          <span style={{ color: "#ef4444", fontSize: 20 }}>⚠</span>
          <span style={{ color: "#94a3b8", fontSize: 11 }}>
            {errorMsg || "Connection failed"}
          </span>
        </div>
      )}
      {status === "connected" && (
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

export default memo(WebRTCPlayer_MediaMTX);