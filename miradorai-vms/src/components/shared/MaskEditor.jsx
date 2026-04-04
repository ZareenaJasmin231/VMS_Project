import { useRef, useEffect, useCallback } from "react";
import WebRTCPlayer from "./WebRTCPlayer";
import "./MaskEditor.css";

export default function MaskEditor({
  streamUrl, masks, drawingMode, activePoints, onAddPoint, onDoubleClick,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    masks.forEach((mask) => {
      if (!mask.enabled) return;
      mask.polygons.forEach((polygon) => {
        if (polygon.points.length < 2) return;
        ctx.beginPath();
        ctx.fillStyle = mask.color || "#000000";
        ctx.globalAlpha = mask.opacity ?? 1;
        polygon.points.forEach((pt, i) => {
          // pt is normalized 0-1, scale to canvas size
          const x = pt.x * W;
          const y = pt.y * H;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    });

    if (drawingMode && activePoints.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = "#00ff88";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      activePoints.forEach((pt, i) => {
        const x = pt.x * W;
        const y = pt.y * H;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      activePoints.forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt.x * W, pt.y * H, 4, 0, Math.PI * 2);
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
    // Store as normalized 0-1 values
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    onAddPoint(x, y);
  };

  const handleDoubleClick = () => {
    if (drawingMode && activePoints.length >= 3) onDoubleClick();
  };

  return (
    <div className="mask-editor" ref={containerRef}>
      <div className="mask-editor__video">
        <WebRTCPlayer serverUrl={streamUrl} />
      </div>
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