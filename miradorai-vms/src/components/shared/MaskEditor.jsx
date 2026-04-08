import { useRef, useEffect, useCallback, useState } from "react";
import WebRTCPlayer from "./WebRTCPlayer";
import "./MaskEditor.css";

/**
 * MaskEditor
 * ──────────
 * Used in SETUP tab only.
 * - Renders raw stream via WebRTCPlayer
 * - Canvas overlay shows saved zone boundaries (reference while drawing)
 * - Drag to draw a new zone → calls onRectDrawn(rect) with normalized coords
 * - Does NOT render on the live view tab (that uses a plain WebRTCPlayer
 *   pointed at the masked stream URL from OME)
 */
export default function MaskEditor({
  streamUrl,
  masks          = [],
  drawingMode    = false,
  pendingRect    = null,   // already drawn, waiting for Save
  pendingColor   = "#378ADD",
  onRectDrawn,             // (rect) => void
}) {
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const animRef      = useRef(null);

  const [dragging,  setDragging]  = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [liveRect,  setLiveRect]  = useState(null);  // rect while mouse is held

  // ── Canvas resize ────────────────────────────────────────────
  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ro = new ResizeObserver(() => {
      canvas.width  = container.offsetWidth;
      canvas.height = container.offsetHeight;
    });
    ro.observe(container);
    canvas.width  = container.offsetWidth;
    canvas.height = container.offsetHeight;
    return () => ro.disconnect();
  }, []);

  // ── Draw loop ────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W   = canvas.width;
    const H   = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Saved zone boundaries (thin colored outlines for reference)
    masks.forEach((mask) => {
      if (!mask.enabled) return;
      mask.polygons?.forEach((poly) => {
        const pts = poly.points;
        if (!pts?.length) return;
        ctx.beginPath();
        pts.forEach((p, i) =>
          i === 0 ? ctx.moveTo(p.x * W, p.y * H) : ctx.lineTo(p.x * W, p.y * H)
        );
        ctx.closePath();
        ctx.strokeStyle = mask.color || "#378ADD";
        ctx.lineWidth   = 2;
        ctx.globalAlpha = 0.8;
        ctx.stroke();

        // Dashed fill so user can see zone area
        ctx.fillStyle   = mask.color || "#378ADD";
        ctx.globalAlpha = 0.15;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Label
        if (mask.label && pts.length >= 2) {
          const xs = pts.map(p => p.x * W);
          const ys = pts.map(p => p.y * H);
          const lx = Math.min(...xs);
          const ly = Math.min(...ys);
          const tw = ctx.measureText(mask.label).width + 10;
          ctx.fillStyle   = "rgba(0,0,0,0.55)";
          ctx.globalAlpha = 1;
          ctx.fillRect(lx + 2, ly + 2, tw, 18);
          ctx.fillStyle = "#fff";
          ctx.font      = "11px sans-serif";
          ctx.fillText(mask.label, lx + 6, ly + 14);
        }
      });
    });

    // Pending rect (drawn but not saved yet) — solid preview
    const showRect = liveRect || pendingRect;
    if (showRect) {
      const { x, y, w, h } = showRect;
      ctx.fillStyle   = pendingColor;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x * W, y * H, w * W, h * H);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pendingColor;
      ctx.lineWidth   = 2;
      ctx.setLineDash(liveRect ? [5, 4] : []);
      ctx.strokeRect(x * W, y * H, w * W, h * H);
      ctx.setLineDash([]);
    }
  }, [masks, pendingRect, liveRect, pendingColor]);

  useEffect(() => {
    const loop = () => { draw(); animRef.current = requestAnimationFrame(loop); };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  // ── Mouse handlers ───────────────────────────────────────────
  const norm = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onMouseDown = (e) => {
    if (!drawingMode) return;
    const pt = norm(e);
    setDragStart(pt);
    setLiveRect({ x: pt.x, y: pt.y, w: 0, h: 0 });
    setDragging(true);
  };

  const onMouseMove = (e) => {
    if (!dragging || !dragStart) return;
    const pt = norm(e);
    setLiveRect({
      x: Math.min(dragStart.x, pt.x),
      y: Math.min(dragStart.y, pt.y),
      w: Math.abs(pt.x - dragStart.x),
      h: Math.abs(pt.y - dragStart.y),
    });
  };

  const onMouseUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (liveRect && liveRect.w > 0.02 && liveRect.h > 0.02) {
      onRectDrawn?.(liveRect);
    }
    setLiveRect(null);
    setDragStart(null);
  };

  return (
    <div className="mask-editor" ref={containerRef}>
      <div className="mask-editor__video">
        <WebRTCPlayer serverUrl={streamUrl} />
      </div>
      <canvas
        ref={canvasRef}
        className="mask-editor__canvas"
        style={{ cursor: drawingMode ? "crosshair" : "default" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      />
      {drawingMode && (
        <div className="mask-editor__hint">Click and drag to draw a blur zone</div>
      )}
      {pendingRect && !drawingMode && (
        <div className="mask-editor__hint mask-editor__hint--save">
          Zone drawn — fill in details and click Save Zone
        </div>
      )}
    </div>
  );
}