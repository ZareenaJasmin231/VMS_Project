import { useEffect, useRef, useState, memo } from "react";
import Hls from "hls.js";
import { Volume2, VolumeX } from "lucide-react";
import { useImageConfig } from "../../hooks/useImageConfig";

function HlsPlayer({ streamKey, streamUrl, muted = true, autoplay = true, className = "", onConnectChange }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hlsRef = useRef(null);

  const [status, setStatus] = useState("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const [isMuted, setIsMuted] = useState(muted);
  const [hovered, setHovered] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);

  // Still apply standard image CSS filters if available, but NOT digital zoom (disables WebRTC specific zoom)
  const { cssFilter, cssTransform } = useImageConfig(streamKey);

  // Use env var if provided, otherwise fallback to standard MediaMTX port 8888 on the same hostname
  const HLS_BASE_URL = import.meta.env.VITE_HLS_BASE_URL || `${window.location.protocol}//${window.location.hostname}:8888`;

  const [activeStreamKey, setActiveStreamKey] = useState(streamKey);

  useEffect(() => {
    setActiveStreamKey(streamKey);
  }, [streamKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const url = streamUrl || `${HLS_BASE_URL}/${activeStreamKey}/index.m3u8`;

    setStatus("connecting");
    onConnectChange?.(false);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        // Tune for lower latency
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
      });
      hlsRef.current = hls;

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus("connected");
        onConnectChange?.(true);
        if (autoplay) {
          video.play().catch(() => {});
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (activeStreamKey.endsWith("_sub")) {
                console.warn(`[HLS] Sub stream failed (Network Error), falling back to main stream`);
                setActiveStreamKey(activeStreamKey.replace("_sub", ""));
                return;
              }
              setStatus("reconnecting");
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              setStatus("failed");
              setErrorMsg("Stream failed");
              onConnectChange?.(false);
              break;
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native Safari support
      video.src = url;
      video.addEventListener("loadedmetadata", () => {
        setStatus("connected");
        onConnectChange?.(true);
        if (autoplay) video.play().catch(() => {});
      });
      video.addEventListener("error", () => {
        if (activeStreamKey.endsWith("_sub")) {
          console.warn(`[HLS] Sub stream failed (Native Error), falling back to main stream`);
          setActiveStreamKey(activeStreamKey.replace("_sub", ""));
          return;
        }
        setStatus("failed");
        setErrorMsg("Stream failed");
        onConnectChange?.(false);
      });
    } else {
      setStatus("failed");
      setErrorMsg("HLS not supported");
      onConnectChange?.(false);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      onConnectChange?.(false);
    };
  }, [activeStreamKey, streamUrl, autoplay, HLS_BASE_URL, onConnectChange]);

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

  const msgStyle = {
    position: "absolute",
    top: 8,
    left: 8,
    right: 8,
    textAlign: "center",
    pointerEvents: "none",
    zIndex: 10,
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={wrapStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <video
        ref={videoRef}
        playsInline
        muted={isMuted}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          filter: cssFilter || "none",
          transform: cssTransform || "none",
          transition: "filter 0.1s ease",
        }}
      />
      
      {/* Real-time feature disabled warning overlay */}
      <div style={msgStyle}>
        <span style={{ background: "rgba(0,0,0,0.6)", padding: "4px 8px", borderRadius: 4, fontSize: 10, color: "#94a3b8" }}>
          Buffered Mode. Switch to Real-Time for interactive controls.
        </span>
      </div>

      {status === "connecting" && (
        <div style={centreStyle}>
          <span style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1 }}>● BUFFERING…</span>
        </div>
      )}
      {status === "reconnecting" && (
        <div style={centreStyle}>
          <span style={{ fontSize: 11, color: "#f59e0b", letterSpacing: 1 }}>● RECONNECTING…</span>
        </div>
      )}
      {status === "failed" && (
        <div style={centreStyle}>
          <span style={{ color: "#ef4444", fontSize: 20 }}>⚠</span>
          <span style={{ color: "#94a3b8", fontSize: 11 }}>{errorMsg || "Connection failed"}</span>
        </div>
      )}
      {status === "connected" && hovered && (
        <button
          style={{
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
            zIndex: 20,
            outline: "none",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
          }}
          onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }}
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

export default memo(HlsPlayer);
