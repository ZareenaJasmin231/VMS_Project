import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";

/**
 * MapCanvas — professional VMS canvas renderer
 *
 * Key improvements:
 *   1. Camera icon is SMALLER  (CAM_SCALE = 0.62)
 *   2. FOV light origin = CENTRE of camera body  (m.x, m.y) — not lens tip
 *   3. FOV cone is hard-CLIPPED to the camera's zone polygon
 *      → light cannot bleed outside zone boundary
 *   4. Dark overlay punch-out also zone-clipped per camera
 *
 * New prop:
 *   zones  []  – { id, polygon:[{x,y}…], floorIndex, color }
 */
const MapCanvas = forwardRef(function MapCanvas(
  {
    cameras,
    markers,
    zones = [],
    floorImgRef,
    scaleRef,
    offsetRef,
    hoveredIdxRef,
    highlightedCamId,
    showHeatmap,
    onDraw,
    onMouseMove,
    onMouseDown,
    onMouseUp,
    onMouseLeave,
    onContextMenu,
  },
  ref
) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);

  // ── Polyfill roundRect ────────────────────────────────────────────
  function ensureRoundRect(ctx) {
    if (!ctx.roundRect) {
      ctx.roundRect = function (x, y, w, h, r) {
        this.beginPath();
        this.moveTo(x + r, y);
        this.lineTo(x + w - r, y);
        this.quadraticCurveTo(x + w, y, x + w, y + r);
        this.lineTo(x + w, y + h - r);
        this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        this.lineTo(x + r, y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - r);
        this.lineTo(x, y + r);
        this.quadraticCurveTo(x, y, x + r, y);
        this.closePath();
      };
    }
  }

  // ── Ray-cast point-in-polygon ─────────────────────────────────────
  function pointInPolygon(px, py, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      if ((yi > py) !== (yj > py) &&
          px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  // ── Find the zone a marker sits inside ───────────────────────────
  function getMarkerZone(marker) {
    return zones.find(
      z => z.polygon?.length >= 3 && pointInPolygon(marker.x, marker.y, z.polygon)
    ) || null;
  }

  // ── Build zone clip path (does NOT call ctx.save/restore) ────────
  function buildZoneClip(ctx, zone) {
    if (!zone || zone.polygon.length < 3) return false;
    ctx.beginPath();
    ctx.moveTo(zone.polygon[0].x, zone.polygon[0].y);
    for (let i = 1; i < zone.polygon.length; i++) {
      ctx.lineTo(zone.polygon[i].x, zone.polygon[i].y);
    }
    ctx.closePath();
    ctx.clip();
    return true;
  }

  // ── Trace a FOV cone path ─────────────────────────────────────────
  function traceCone(ctx, ox, oy, len, angle, halfRad) {
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.arc(ox, oy, len, angle - halfRad, angle + halfRad);
    ctx.closePath();
  }

  // ── Main draw ─────────────────────────────────────────────────────
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
    ensureRoundRect(ctx);
    ctx.clearRect(0, 0, W, H);

    const img = floorImgRef.current;
    if (!img) return;

    const { x: ox, y: oy } = offsetRef.current;
    const scale = scaleRef.current;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // ── 1. Floor plan ──────────────────────────────────────────────
    ctx.drawImage(img, 0, 0);

    // ── 2. Dark overlay + zone-clipped FOV punch-outs ──────────────
    if (markers.length > 0) {

      // Step A — global dark layer
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.70)";
      ctx.fillRect(0, 0, img.width, img.height);
      ctx.restore();

      // Step B — erase (punch out) each camera's FOV cone from dark layer
      //          clipped to zone polygon so light stays inside the zone
      markers.forEach(m => {
        const fovAngle  = m.fovAngle  || 60;
        const direction = m.direction || 0;
        const fovLen    = fovAngle * 2.2 + 40;
        const halfRad   = (fovAngle / 2) * (Math.PI / 180);
        const angle     = direction * (Math.PI / 180);

        // ★ Light starts from CENTRE of camera body
        const originX = m.x;
        const originY = m.y;

        const zone = getMarkerZone(m);

        ctx.save();
        // Hard clip to zone — light cannot escape zone boundary
        if (zone) buildZoneClip(ctx, zone);

        ctx.globalCompositeOperation = "destination-out";
        const g = ctx.createRadialGradient(originX, originY, 0, originX, originY, fovLen);
        g.addColorStop(0,    "rgba(0,0,0,1)");
        g.addColorStop(0.58, "rgba(0,0,0,0.90)");
        g.addColorStop(0.82, "rgba(0,0,0,0.45)");
        g.addColorStop(1,    "rgba(0,0,0,0)");

        traceCone(ctx, originX, originY, fovLen, angle, halfRad);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
      });

      // Step C — colour tint layer (green = online, grey = offline, blue = highlight)
      //          same zone clip applied
      markers.forEach(m => {
        const cam       = cameras.find(c => c.id === m.camId);
        const online    = cam?.status === "online";
        const isHighlit = m.camId === highlightedCamId;

        const fovAngle  = m.fovAngle  || 60;
        const direction = m.direction || 0;
        const fovLen    = fovAngle * 2.2 + 40;
        const halfRad   = (fovAngle / 2) * (Math.PI / 180);
        const angle     = direction * (Math.PI / 180);
        const originX   = m.x;
        const originY   = m.y;

        const zone = getMarkerZone(m);

        ctx.save();
        if (zone) buildZoneClip(ctx, zone);
        ctx.globalCompositeOperation = "source-over";

        let g;
        if (isHighlit) {
          // Blue highlight
          g = ctx.createRadialGradient(originX, originY, 0, originX, originY, fovLen);
          g.addColorStop(0,    "rgba(90,171,240,0.48)");
          g.addColorStop(0.55, "rgba(90,171,240,0.22)");
          g.addColorStop(1,    "rgba(90,171,240,0)");
        } else if (online) {
          // ★ Green — camera is live
          g = ctx.createRadialGradient(originX, originY, 0, originX, originY, fovLen);
          g.addColorStop(0,    "rgba(29,158,117,0.62)");
          g.addColorStop(0.50, "rgba(29,158,117,0.28)");
          g.addColorStop(1,    "rgba(29,158,117,0)");
        } else {
          // Offline — very faint, just shows the floor naturally
          g = ctx.createRadialGradient(originX, originY, 0, originX, originY, fovLen);
          g.addColorStop(0,   "rgba(110,110,110,0.14)");
          g.addColorStop(1,   "rgba(110,110,110,0)");
        }

        traceCone(ctx, originX, originY, fovLen, angle, halfRad);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
      });
    }

    // ── 3. Camera bodies + number labels + direction handles ───────
    const S = 0.62; // ★ Camera scale — smaller & cleaner

    markers.forEach((m, i) => {
      const cam    = cameras.find(c => c.id === m.camId) || {
        name: m.camName || m.camId, ip: m.camIp || "", status: "offline",
      };
      const online    = cam.status === "online";
      const isHighlit = m.camId === highlightedCamId;
      const col       = online ? (isHighlit ? "#5aabf0" : "#1D9E75") : "#555";
      const R         = 8;   // glow / hit radius
      const hov       = i === hoveredIdxRef.current;

      // ── Glow ring ──
      ctx.beginPath();
      ctx.arc(m.x, m.y, hov ? R + 4 : R + 1.5, 0, Math.PI * 2);
      ctx.fillStyle = col + (isHighlit ? "40" : "20");
      ctx.fill();

      // ── Rotated camera body (all parts relative to m.x, m.y = body centre) ──
      const angle = (m.direction || 0) * (Math.PI / 180);
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(angle);

      // Mount (back base disk)
      ctx.beginPath();
      ctx.arc(-14 * S, 0, 5 * S, 0, Math.PI * 2);
      ctx.fillStyle   = isHighlit ? "#a8ccee" : "#cecece";
      ctx.fill();
      ctx.strokeStyle = isHighlit ? "#5aabf0" : "#888";
      ctx.lineWidth   = 0.8;
      ctx.stroke();

      // Neck
      ctx.beginPath();
      ctx.roundRect(-14 * S, -2.5 * S, 7 * S, 5 * S, 1.5);
      ctx.fillStyle   = isHighlit ? "#9bbdd8" : "#c4c4c4";
      ctx.fill();
      ctx.stroke();

      // Main barrel body
      ctx.beginPath();
      ctx.roundRect(-7 * S, -5.5 * S, 17 * S, 11 * S, 5 * S);
      ctx.fillStyle   = isHighlit ? "#daeeff" : "#efefef";
      ctx.fill();
      ctx.strokeStyle = isHighlit ? "#5aabf0" : "#aaa";
      ctx.lineWidth   = 0.8;
      ctx.stroke();

      // Front bezel ring
      ctx.beginPath();
      ctx.arc(10 * S, 0, 5.5 * S, 0, Math.PI * 2);
      ctx.fillStyle   = isHighlit ? "#b8d8f0" : "#dfdfdf";
      ctx.fill();
      ctx.strokeStyle = isHighlit ? "#5aabf0" : "#aaa";
      ctx.stroke();

      // Lens (dark glass)
      ctx.beginPath();
      ctx.arc(10 * S, 0, 3.2 * S, 0, Math.PI * 2);
      ctx.fillStyle = "#0e0e0e";
      ctx.fill();

      // Lens reflection sparkle
      ctx.beginPath();
      ctx.arc(10.8 * S, -1.1 * S, 1.1 * S, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.60)";
      ctx.fill();

      ctx.restore();

      // ── Number label (sits at body centre) ──
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.fillStyle    = online ? "#fff" : "#aaa";
      ctx.font         = `bold ${hov ? 9 : 8}px monospace`;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((i + 1).toString(), -2 * S, 0);
      ctx.restore();

      // ── Hover tooltip ──
      if (hov) {
        ctx.font = "10.5px Inter, sans-serif";
        const lbl = cam.name;
        const tw  = ctx.measureText(lbl).width;
        const bx  = m.x - tw / 2 - 7;
        const by  = m.y - R - 22;
        ctx.save();
        ctx.fillStyle = "#0d1117f2";
        ctx.beginPath();
        ctx.roundRect(bx, by, tw + 14, 18, 4);
        ctx.fill();
        ctx.fillStyle    = "#e8edf5";
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(lbl, m.x, by + 9);
        ctx.restore();
      }

      // ── Direction handle ──
      const ang2 = (m.direction || 0) * (Math.PI / 180);
      const hx   = m.x + Math.cos(ang2) * (R + 9);
      const hy   = m.y + Math.sin(ang2) * (R + 9);
      ctx.beginPath();
      ctx.arc(hx, hy, 3, 0, Math.PI * 2);
      ctx.fillStyle   = online ? col : "#555";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.30)";
      ctx.lineWidth   = 1;
      ctx.stroke();
    });

    ctx.restore();
    onDraw?.();
  }, [cameras, markers, zones, floorImgRef, scaleRef, offsetRef, hoveredIdxRef, highlightedCamId, onDraw]);

  useImperativeHandle(ref, () => ({ drawAll }), [drawAll]);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(drawAll);
  }, [drawAll]);

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