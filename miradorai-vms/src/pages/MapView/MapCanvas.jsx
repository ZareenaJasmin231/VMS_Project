import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";

/**
 * MapCanvas
 * Handles ALL canvas drawing:
 *   - Floor plan image
 *   - FOV cones per camera (direction-aware, starting from lens)
 *   - Blind-spot heatmap (dark overlay, bright = covered)
 *   - Camera dot markers with hover labels
 *   - Direction handle dots (for rotation drag)
 *
 * Props:
 *   cameras       []      – normalised camera list
 *   markers       []      – { camId, camName, camIp, x, y, fovAngle, direction }
 *   floorImgRef   ref     – Image object ref
 *   scaleRef      ref
 *   offsetRef     ref
 *   hoveredIdxRef ref
 *   showHeatmap   bool
 *   onDraw        fn      – called after every draw (optional)
 */
const MapCanvas = forwardRef(function MapCanvas(
  {
    cameras, markers, floorImgRef, scaleRef, offsetRef, hoveredIdxRef, showHeatmap, onDraw,
    // Mouse event handlers forwarded from MapViewPage
    onMouseMove, onMouseDown, onMouseUp, onMouseLeave, onContextMenu,
  },
  ref
) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);

  // expose drawAll to parent via ref
  const drawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wrap = canvas.parentElement;
    if (!wrap) return;

    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    canvas.width  = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    const img = floorImgRef.current;
    if (!img) return;

    const { x: ox, y: oy } = offsetRef.current;
    const scale = scaleRef.current;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // ── 1. Floor plan ────────────────────────────────────────────
    ctx.drawImage(img, 0, 0);

    // ── 2. Blind-spot heatmap ────────────────────────────────────
    // Logic:
    //   • Draw dark overlay over entire floor  → everything is a blind spot by default
    //   • Punch out each camera's FOV cone     → reveals the floor = "bright / covered"
    //   • Remaining dark areas                 → TRUE BLIND SPOTS (no camera coverage)
    if (showHeatmap) {
      ctx.save();

      // 2a. Dark overlay = entire floor is uncovered / blind spot
      ctx.fillStyle = "rgba(0, 0, 0, 0.74)";
      ctx.fillRect(0, 0, img.width, img.height);

      // 2b. Punch coverage cones out of the dark overlay (from lens origin)
      markers.forEach(m => {
        const fovAngle  = m.fovAngle  || 60;
        const direction = m.direction || 0;
        const fovLen    = fovAngle * 2.4 + 50;
        const halfRad   = (fovAngle / 2) * (Math.PI / 180);

        const angle      = (direction) * (Math.PI / 180);
        const arcCenter  = angle;

        // lens is drawn at +12*camScale from body center; shift matches exactly
        const camScale   = 1;
        const lensOffset = 12 * camScale;
        const originX = m.x + Math.cos(angle) * lensOffset;
        const originY = m.y + Math.sin(angle) * lensOffset;

        ctx.save();
        ctx.globalCompositeOperation = "destination-out";

        // Radial gradient so the erase is smooth (bright centre → fades at edge)
        const g = ctx.createRadialGradient(originX, originY, 0, originX, originY, fovLen);
        g.addColorStop(0,   "rgba(0,0,0,1)");
        g.addColorStop(0.65,"rgba(0,0,0,0.85)");
        g.addColorStop(1,   "rgba(0,0,0,0)");

        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.arc(originX, originY, fovLen, arcCenter - halfRad, arcCenter + halfRad);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
      });

      // 2c. Warm yellow tint on online-camera coverage zones (from lens origin)
      markers.forEach(m => {
        const cam = cameras.find(c => c.id === m.camId);
        if (cam?.status !== "online") return;

        const fovAngle  = m.fovAngle  || 60;
        const direction = m.direction || 0;
        const fovLen    = fovAngle * 2.4 + 50;
        const halfRad   = (fovAngle / 2) * (Math.PI / 180);

        const angle      = (direction) * (Math.PI / 180);
        const arcCenter  = angle;

        // lens is drawn at +12*camScale from body center; shift matches exactly
        const camScale   = 1;
        const lensOffset = 12 * camScale;
        const originX = m.x + Math.cos(angle) * lensOffset;
        const originY = m.y + Math.sin(angle) * lensOffset;

        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        const g = ctx.createRadialGradient(originX, originY, 0, originX, originY, fovLen);
        g.addColorStop(0,   "rgba(255,220,60,0.30)");
        g.addColorStop(0.6, "rgba(255,180,20,0.12)");
        g.addColorStop(1,   "rgba(255,140,0,0)");

        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.arc(originX, originY, fovLen, arcCenter - halfRad, arcCenter + halfRad);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
      });

      ctx.restore();
    }

    // ── 3. FOV cones (always visible, not just heatmap mode) ─────
    markers.forEach(m => {
      const cam     = cameras.find(c => c.id === m.camId) || { status: "offline" };
      const online  = cam.status === "online";
      const col     = online ? "#1D9E75" : "#444444";

      const fovAngle  = m.fovAngle  || 60;
      const direction = m.direction || 0;
      const fovLen    = fovAngle * 1.5 + 30;
      const halfRad   = (fovAngle / 2) * (Math.PI / 180);

      // angle = camera body rotation (lens faces this direction in world space)
      const angle      = (direction) * (Math.PI / 180);
      // FOV arc fans around the same direction the lens faces
      const arcCenter  = angle;

      // Lens is at +12px along the camera's facing direction from m.x,m.y
      const camScale   = 1;
      const lensOffset = 12 * camScale;
      const originX = m.x + Math.cos(angle) * lensOffset;
      const originY = m.y + Math.sin(angle) * lensOffset;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.arc(originX, originY, fovLen, arcCenter - halfRad, arcCenter + halfRad);
      ctx.closePath();

      if (online) {
        const g = ctx.createRadialGradient(originX, originY, 0, originX, originY, fovLen);
        g.addColorStop(0, col + "55");
        g.addColorStop(1, col + "11");
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = "#33333322";
      }
      ctx.fill();
      ctx.strokeStyle = online ? col + "88" : "#44444444";
      ctx.lineWidth   = 1;
      ctx.stroke();
      ctx.restore();
    });

    // ── 4. Camera dots + labels + direction handles ───────────────
    markers.forEach((m, i) => {
      const cam    = cameras.find(c => c.id === m.camId) || { name: m.camName || m.camId, ip: m.camIp || "", status: "offline" };
      const online = cam.status === "online";
      const col    = online ? "#1D9E75" : "#444444";
      const r      = 13;
      const hov    = i === hoveredIdxRef.current;

      // Outer glow ring
      ctx.beginPath();
      ctx.arc(m.x, m.y, hov ? r + 5 : r + 2, 0, Math.PI * 2);
      ctx.fillStyle = col + "28";
      ctx.fill();

      // CAMERA ROTATION
      const angle = (m.direction || 0) * (Math.PI / 180);

      ctx.save();

      // FIX 2: shift body back by exactly the lens x-offset so lens face sits at m.x, m.y
      const camScale = 1;
      const shift    = 12 * camScale;
      ctx.translate(
        m.x - Math.cos(angle) * shift,
        m.y - Math.sin(angle) * shift
      );
      ctx.rotate(angle);

      // camScale already declared above — used for all part dimensions below

      // =======================
      // 🔹 1. Mount (back base)
      // =======================
      ctx.beginPath();
      ctx.arc(-16 * camScale, 0, 6 * camScale, 0, Math.PI * 2);
      ctx.fillStyle = "#d9d9d9";
      ctx.fill();
      ctx.strokeStyle = "#888";
      ctx.stroke();

      // =======================
      // 🔹 2. Neck (connector)
      // =======================
      ctx.beginPath();
      ctx.roundRect(-16 * camScale, -3 * camScale, 8 * camScale, 6 * camScale, 2);
      ctx.fillStyle = "#cfcfcf";
      ctx.fill();
      ctx.stroke();

      // =======================
      // 🔹 3. Body (cylinder)
      // =======================
      ctx.beginPath();
      ctx.roundRect(-8 * camScale, -6 * camScale, 20 * camScale, 12 * camScale, 6);
      ctx.fillStyle = "#f5f5f5";
      ctx.fill();
      ctx.strokeStyle = "#999";
      ctx.stroke();

      // =======================
      // 🔹 4. Front ring
      // =======================
      ctx.beginPath();
      ctx.arc(12 * camScale, 0, 7 * camScale, 0, Math.PI * 2);
      ctx.fillStyle = "#e6e6e6";
      ctx.fill();
      ctx.stroke();

      // =======================
      // 🔹 5. Lens (inner)
      // =======================
      ctx.beginPath();
      ctx.arc(12 * camScale, 0, 4 * camScale, 0, Math.PI * 2);
      ctx.fillStyle = "#111";
      ctx.fill();

      // =======================
      // 🔹 6. Lens reflection
      // =======================
      ctx.beginPath();
      ctx.arc(13 * camScale, -1.5 * camScale, 1.5 * camScale, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff88";
      ctx.fill();

      ctx.restore();
      // FIX 3: removed stray ctx.fill() that was here from old circle code

      // Number label
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.fillStyle     = "#fff";
      ctx.font          = `bold ${hov ? 12 : 11}px monospace`;
      ctx.textAlign     = "center";
      ctx.textBaseline  = "middle";
      ctx.fillText((i + 1).toString(), 0, 0);
      ctx.restore();

      // Hover name tooltip on canvas
      if (hov) {
        const lbl = cam.name;
        ctx.font = "11px sans-serif";
        const tw = ctx.measureText(lbl).width;
        const bx = m.x - tw / 2 - 8;
        const by = m.y - r - 28;
        ctx.fillStyle = "#0d1117ee";
        ctx.beginPath();
        ctx.roundRect(bx, by, tw + 16, 20, 4);
        ctx.fill();
        ctx.fillStyle    = "#e8edf5";
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(lbl, m.x, by + 10);
      }

      // Direction handle dot (small knob in facing direction, used for rotation drag)
      const direction = m.direction || 0;
      const angle2    = direction * (Math.PI / 180);   // same angle as camera body
      const hx = m.x + Math.cos(angle2) * (r + 12);
      const hy = m.y + Math.sin(angle2) * (r + 12);
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.fillStyle = online ? col : "#666";
      ctx.fill();
      ctx.strokeStyle = "#fff4";
      ctx.lineWidth   = 1;
      ctx.stroke();
    });

    ctx.restore();
    onDraw?.();
  }, [cameras, markers, floorImgRef, scaleRef, offsetRef, hoveredIdxRef, showHeatmap, onDraw]);

  useImperativeHandle(ref, () => ({ drawAll }), [drawAll]);

  // Re-draw whenever inputs change
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(drawAll);
  }, [drawAll]);

  // Re-draw on container resize
  useEffect(() => {
    const obs = new ResizeObserver(drawAll);
    const el  = canvasRef.current?.parentElement;
    if (el) obs.observe(el);
    return () => obs.disconnect();
  }, [drawAll]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", width: "100%", height: "100%" }}
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onContextMenu={onContextMenu}
    />
  );
});

export default MapCanvas;