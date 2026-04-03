import { useRef, useEffect, useCallback } from "react";
import "./MaskEditor.css";

export default function MaskEditor({
  streamUrl,
  masks,
  drawingMode,
  activePoints,
  onAddPoint,
  onDoubleClick,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
  if (!streamUrl || !videoRef.current) return;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  pc.ontrack = (e) => {
    if (videoRef.current && e.streams[0]) {
      videoRef.current.srcObject = e.streams[0];
    }
  };

  const httpUrl = streamUrl.replace("ws://", "http://").replace("wss://", "https://");

  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer))
    .then(() => fetch(httpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription.sdp,
    }))
    .then((res) => res.text())
    .then((sdp) => pc.setRemoteDescription({ type: "answer", sdp }))
    .catch((err) => console.error("[MaskEditor] WebRTC error:", err));

  return () => pc.close();
}, [streamUrl]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all saved masks
    masks.forEach((mask) => {
      if (!mask.enabled) return;
      mask.polygons.forEach((polygon) => {
        if (polygon.points.length < 2) return;
        ctx.beginPath();
        ctx.fillStyle = mask.color || "#000000";
        ctx.globalAlpha = mask.opacity ?? 1;
        polygon.points.forEach((pt, i) => {
          i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    });

    // Draw in-progress polygon
    if (drawingMode && activePoints.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = "#00ff88";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      activePoints.forEach((pt, i) => {
        i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw point dots
      activePoints.forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#00ff88";
        ctx.fill();
      });
    }
  }, [masks, drawingMode, activePoints]);

  useEffect(() => {
    const id = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(id);
  }, [drawFrame]);

  const handleCanvasClick = (e) => {
    if (!drawingMode) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    onAddPoint(x, y);
  };

  const handleDoubleClick = () => {
    if (drawingMode && activePoints.length >= 3) onDoubleClick();
  };

  return (
    <div className="mask-editor">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="mask-editor__video"
      />
      <canvas
        ref={canvasRef}
        width={640}
        height={360}
        className="mask-editor__canvas"
        onClick={handleCanvasClick}
        onDoubleClick={handleDoubleClick}
        style={{ cursor: drawingMode ? "crosshair" : "default" }}
      />
      {drawingMode && (
        <div className="mask-editor__hint">
          Click to add points — double-click to close shape
        </div>
      )}
    </div>
  );
}