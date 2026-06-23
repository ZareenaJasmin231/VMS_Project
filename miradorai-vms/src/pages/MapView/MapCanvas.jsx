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
    alertCounts = {},
    onDraw,
    onMouseMove,
    onMouseDown,
    onMouseUp,
    onMouseLeave,
    onContextMenu,
    iconScale = 1.20,
    selectedIdx = null,
  },
  ref
) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const TYPE_COLORS = {
    dome: "#3b82f6",  // blue
    bullet: "#f59e0b",  // amber
    ptz: "#8b5cf6",  // purple
    fisheye: "#10b981",  // green
    box: "#f97316",  // orange
    turret: "#ec4899",  // pink
  };

  function getCamType(cam) {
    if (!cam) return "dome";
    const name = (cam.name || cam.model || "").toLowerCase();
    if (name.includes("bullet") || name.includes("bllt")) return "bullet";
    if (name.includes("ptz")) return "ptz";
    if (name.includes("fish")) return "fisheye";
    if (name.includes("box")) return "box";
    if (name.includes("turret")) return "turret";
    return "dome";
  }

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

  // ── Shoelace formula for polygon area ─────────────────────────────
  function getPolygonArea(polygon) {
    if (!polygon || polygon.length < 3) return 0;
    let area = 0;
    const n = polygon.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += polygon[i].x * polygon[j].y;
      area -= polygon[j].x * polygon[i].y;
    }
    return Math.abs(area) / 2;
  }

  // ── Find the zone a marker sits inside ───────────────────────────
  function getMarkerZone(marker) {
    const containedZones = zones.filter(
      z => z.polygon?.length >= 3 && pointInPolygon(marker.x, marker.y, z.polygon)
    );
    if (containedZones.length === 0) return null;
    containedZones.sort((a, b) => getPolygonArea(a.polygon) - getPolygonArea(b.polygon));
    return containedZones[0];
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
    canvas.width = W;
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
        const fovAngle = m.fovAngle || 60;
        const direction = m.direction || 0;
        const fovLen = fovAngle * 2.2 + 40;
        const halfRad = (fovAngle / 2) * (Math.PI / 180);
        const angle = direction * (Math.PI / 180);

        // ★ Light starts from CENTRE of camera body
        const S = 0.62;
        const originX = m.x + Math.cos(angle) * (1.5 * S);
        const originY = m.y + Math.sin(angle) * (1.5 * S);

        const zone = getMarkerZone(m);

        ctx.save();
        // Hard clip to zone — light cannot escape zone boundary
        if (zone) buildZoneClip(ctx, zone);

        ctx.globalCompositeOperation = "destination-out";
        const g = ctx.createRadialGradient(originX, originY, 0, originX, originY, fovLen);
        g.addColorStop(0, "rgba(0,0,0,1)");
        g.addColorStop(0.58, "rgba(0,0,0,0.90)");
        g.addColorStop(0.82, "rgba(0,0,0,0.45)");
        g.addColorStop(1, "rgba(0,0,0,0)");

        traceCone(ctx, originX, originY, fovLen, angle, halfRad);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
      });

      // Step C — colour tint layer (green = online, grey = offline, blue = highlight)
      //          same zone clip applied
      markers.forEach(m => {
        const cam = cameras.find(c => c.id === m.camId);
        const online = cam?.status === "online";
        const isHighlit = m.camId === highlightedCamId;

        const fovAngle = m.fovAngle || 60;
        const direction = m.direction || 0;
        const fovLen = fovAngle * 2.2 + 40;
        const halfRad = (fovAngle / 2) * (Math.PI / 180);
        const angle = direction * (Math.PI / 180);
        const S = 0.62;

        const originX = m.x + Math.cos(angle) * (1.5 * S);
        const originY = m.y + Math.sin(angle) * (1.5 * S);

        const zone = getMarkerZone(m);

        ctx.save();
        if (zone) buildZoneClip(ctx, zone);
        ctx.globalCompositeOperation = "source-over";

        const camType = getCamType(cam);
        const typeCol = TYPE_COLORS[camType] || "#3b82f6";
        const col = online ? (isHighlit ? "#5aabf0" : typeCol) : "#555";


        // Parse hex color to rgb for gradient
        function hexToRgb(hex) {
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          return `${r},${g},${b}`;
        }
        const rgb = hexToRgb(isHighlit ? "#5aabf0" : typeCol);

        let g;
        if (!online) {
          g = ctx.createRadialGradient(originX, originY, 0, originX, originY, fovLen);
          g.addColorStop(0, "rgba(110,110,110,0.14)");
          g.addColorStop(1, "rgba(110,110,110,0)");
        } else {
          g = ctx.createRadialGradient(originX, originY, 0, originX, originY, fovLen);
          g.addColorStop(0, `rgba(${rgb},0.60)`);
          g.addColorStop(0.55, `rgba(${rgb},0.26)`);
          g.addColorStop(1, `rgba(${rgb},0)`);
        }

        traceCone(ctx, originX, originY, fovLen, angle, halfRad);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
      });
    }

    // ── 3. Camera bodies + number labels + direction handles ───────
    const S = iconScale; // ★ Custom camera scale from Toolbox

    markers.forEach((m, i) => {
      const cam = cameras.find(c => c.id === m.camId) || {
        name: m.camName || m.camId, ip: m.camIp || "", status: "offline",
      };
      const online = cam.status === "online";
      const hasAlert = alertCounts && alertCounts[cam.ip] > 0;
      const isHighlit = m.camId === highlightedCamId || i === selectedIdx;
      const col = hasAlert ? "#E24B4A" : (online ? (isHighlit ? "#5aabf0" : "#1D9E75") : "#555");
      const R = 8;   // glow / hit radius
      const hov = i === hoveredIdxRef.current;

      // ── Glow ring ──
      ctx.beginPath();
      let ringRadius = hov ? R + 4 : R + 1.5;
      if (hasAlert) {
        const pulse = Math.sin(Date.now() / 150) * 2.5 + 2.5;
        ringRadius += pulse;
      }
      ctx.arc(m.x, m.y, ringRadius, 0, Math.PI * 2);
      ctx.fillStyle = col + (hasAlert ? "60" : (isHighlit ? "40" : "20"));
      ctx.fill();

      // ── Rotated camera body (type-specific shapes relative to m.x, m.y) ──
      const angle = (m.direction || 0) * (Math.PI / 180);
      const type = getCamType(cam);
      ctx.save();
      ctx.translate(m.x, m.y);

      if (hov || isHighlit) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
      }

      if (type === "bullet") {
        const bS = S * 0.9;
        
        // --- FIXED MOUNT & ARM ---
        ctx.save();
        if (m.flip) ctx.scale(-1, 1);
        
        // Wall Plate
        ctx.beginPath();
        ctx.moveTo(5*bS, 10*bS);
        ctx.lineTo(10*bS, 8*bS);
        ctx.lineTo(10*bS, 18*bS);
        ctx.lineTo(5*bS, 20*bS);
        ctx.closePath();
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
        
        // Wall plate side
        ctx.beginPath();
        ctx.moveTo(5*bS, 10*bS);
        ctx.lineTo(2*bS, 11*bS);
        ctx.lineTo(2*bS, 21*bS);
        ctx.lineTo(5*bS, 20*bS);
        ctx.closePath();
        ctx.fillStyle = "#f5f5f5"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.stroke();

        // Horizontal Arm
        ctx.beginPath();
        ctx.moveTo(-2*bS, 14*bS);
        ctx.lineTo(5*bS, 12*bS);
        ctx.lineTo(5*bS, 15*bS);
        ctx.lineTo(-2*bS, 17*bS);
        ctx.closePath();
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.stroke();
        
        // Vertical Arm
        ctx.beginPath();
        ctx.moveTo(-4*bS, 0);
        ctx.lineTo(0*bS, -1*bS);
        ctx.lineTo(0*bS, 14*bS);
        ctx.lineTo(-4*bS, 15*bS);
        ctx.closePath();
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.stroke();

        ctx.restore();

        // --- ROTATING CAMERA BODY ---
        ctx.rotate(angle);
        if (Math.cos(angle) < 0) ctx.scale(1, -1);
        
        // Body Cylinder
        ctx.beginPath();
        ctx.moveTo(-12*bS, -7*bS);
        ctx.lineTo(8*bS, -7*bS);
        ctx.bezierCurveTo(12*bS, -7*bS, 12*bS, 7*bS, 8*bS, 7*bS);
        ctx.lineTo(-12*bS, 7*bS);
        ctx.bezierCurveTo(-8*bS, 7*bS, -8*bS, -7*bS, -12*bS, -7*bS);
        ctx.closePath();
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

        // Sunshield
        ctx.beginPath();
        ctx.moveTo(-14*bS, -8*bS);
        ctx.lineTo(10*bS, -8*bS);
        ctx.bezierCurveTo(16*bS, -8*bS, 16*bS, -1*bS, 10*bS, -1*bS);
        ctx.lineTo(-14*bS, -1*bS);
        ctx.closePath();
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.stroke();

        // Front Face (Dark oval)
        ctx.beginPath();
        ctx.ellipse(8*bS, 0, 2.5*bS, 6.5*bS, 0, 0, Math.PI*2);
        ctx.fillStyle = "#1b3039"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.stroke();

        // Lens Outer White Ring
        ctx.beginPath();
        ctx.ellipse(8*bS, 0, 1.2*bS, 3.5*bS, 0, 0, Math.PI*2);
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.stroke();
        
        // Lens Inner Dark Center
        ctx.beginPath();
        ctx.ellipse(8*bS, 0, 0.5*bS, 1.5*bS, 0, 0, Math.PI*2);
        ctx.fillStyle = "#000000"; ctx.fill();

      } else if (type === "ptz") {
        const pS = S * 0.9;
        
        // --- FIXED MOUNT & ARM ---
        ctx.save();
        if (m.flip) ctx.scale(-1, 1);
        
        // Wall Plate (Left side)
        ctx.beginPath();
        ctx.moveTo(-10*pS, -6*pS);
        ctx.lineTo(-10*pS, 10*pS);
        ctx.lineTo(-14*pS, 12*pS);
        ctx.lineTo(-14*pS, -8*pS);
        ctx.closePath();
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

        // Arm
        ctx.beginPath();
        ctx.moveTo(-10*pS, 0);
        ctx.lineTo(-4*pS, -2*pS);
        ctx.lineTo(-4*pS, 2*pS);
        ctx.lineTo(-10*pS, 4*pS);
        ctx.closePath();
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.stroke();
        
        ctx.restore();

        // --- ROTATING CAMERA BODY ---
        ctx.rotate(angle);
        
        // Top cap
        ctx.beginPath();
        ctx.moveTo(-4*pS, -3*pS);
        ctx.lineTo(-4*pS, 3*pS);
        ctx.lineTo(-2*pS, 3*pS);
        ctx.lineTo(-2*pS, -3*pS);
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

        // Main Bell Housing
        ctx.beginPath();
        ctx.moveTo(-2*pS, -3*pS);
        ctx.lineTo(-2*pS, 3*pS);  
        ctx.bezierCurveTo(4*pS, 8*pS, 6*pS, 9*pS, 8*pS, 9*pS);
        ctx.lineTo(8*pS, -9*pS);
        ctx.bezierCurveTo(6*pS, -9*pS, 4*pS, -8*pS, -2*pS, -3*pS);
        ctx.closePath();
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.stroke();

        // Lower Dome (Dark glass)
        ctx.beginPath();
        ctx.moveTo(8*pS, -8*pS);
        ctx.lineTo(8*pS, 8*pS);
        ctx.bezierCurveTo(14*pS, 8*pS, 16*pS, 4*pS, 16*pS, 0);
        ctx.bezierCurveTo(16*pS, -4*pS, 14*pS, -8*pS, 8*pS, -8*pS);
        ctx.closePath();
        ctx.fillStyle = "#1a1a1a"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.stroke();

        // Lens housing
        ctx.beginPath();
        ctx.roundRect(8*pS, -3*pS, 4*pS, 6*pS, 1);
        ctx.fillStyle = "#262626"; ctx.fill();
        
        // Lens
        ctx.beginPath();
        ctx.arc(10*pS, 0, 1.8*pS, 0, Math.PI*2);
        ctx.fillStyle = "#000000"; ctx.fill();

      } else {
        // For all other types, we rotate first
        ctx.rotate(angle);

        if (type === "dome" || type === "turret") {
          // Top white cover (hemisphere)
          ctx.beginPath();
          ctx.arc(0, 0, 11 * S, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff"; ctx.fill();
          ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
          
          // Cutout for the black dome
          ctx.beginPath();
          ctx.arc(3 * S, 0, 8.5 * S, 0, Math.PI * 2);
          ctx.fillStyle = "#222222"; ctx.fill();
          ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
          
          // White rim
          ctx.beginPath();
          ctx.arc(3 * S, 0, 8.5 * S, 0, Math.PI * 2);
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();
          
          // Inner lens housing
          ctx.beginPath();
          ctx.arc(4 * S, 0, 5 * S, 0, Math.PI * 2);
          ctx.fillStyle = "#111111"; ctx.fill();
          ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

          // IR LED ring
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            const lx = 4 * S + Math.cos(a) * 3.8 * S;
            const ly = Math.sin(a) * 3.8 * S;
            ctx.beginPath();
            ctx.arc(lx, ly, 0.6 * S, 0, Math.PI * 2);
            ctx.fillStyle = "#dddddd"; ctx.fill();
          }

          // Center Lens
          ctx.beginPath();
          ctx.arc(4 * S, 0, 2 * S, 0, Math.PI * 2);
          ctx.fillStyle = "#000000"; ctx.fill();
          
          // Lens glint
          ctx.beginPath();
          ctx.arc(4.5 * S, -0.5 * S, 0.5 * S, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fill();
        }
        else if (type === "fisheye") {
          ctx.beginPath(); ctx.arc(0, 0, 12 * S, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff"; ctx.fill();
          ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      
          ctx.beginPath(); ctx.arc(0, 0, 8 * S, 0, Math.PI * 2);
          ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      
          ctx.beginPath(); ctx.arc(0, 0, 3.5 * S, 0, Math.PI * 2);
          ctx.fillStyle = "#0e0e0e"; ctx.fill();
          ctx.strokeStyle = "#000000"; ctx.stroke();
      
          ctx.beginPath(); ctx.arc(0, 0, 1.5 * S, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.stroke();
        }
        else {
          // BOX / THERMAL / OTHER
          const shift = 14 * S;
          ctx.translate(-shift, 0);
      
          // Mount
          ctx.beginPath(); ctx.arc(-14 * S, 0, 5 * S, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff"; ctx.fill();
          ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      
          // Neck
          ctx.beginPath();
          ctx.roundRect(-14 * S, -2.5 * S, 7 * S, 5 * S, 1.5);
          ctx.fillStyle = "#ffffff"; ctx.fill();
          ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      
          // Main barrel body
          ctx.beginPath();
          ctx.roundRect(-7 * S, -5.5 * S, 17 * S, 11 * S, 5 * S);
          ctx.fillStyle = "#ffffff"; ctx.fill();
          ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      
          // Front bezel ring
          ctx.beginPath(); ctx.arc(10 * S, 0, 5.5 * S, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff"; ctx.fill();
          ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      
          // Lens
          ctx.beginPath(); ctx.arc(10 * S, 0, 3.2 * S, 0, Math.PI * 2);
          ctx.fillStyle = "#0e0e0e"; ctx.fill();
      
          // Lens reflection
          ctx.beginPath(); ctx.arc(10.8 * S, -1.1 * S, 1.1 * S, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.60)"; ctx.fill();
        }
      }

      // Recording LED dot
      const showRec = localStorage.getItem("miradorai_show_rec_ind") !== "false";
      if (online && showRec) {
        ctx.beginPath();
        if (type === "bullet" || type === "ptz" || type === "box" || type === "thermal") {
          ctx.arc(-14 * S, -6 * S, 2 * S, 0, Math.PI * 2);
        } else {
          ctx.arc(-8 * S, -8 * S, 2 * S, 0, Math.PI * 2);
        }
        ctx.fillStyle = "#ff4d4f";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      ctx.shadowBlur = 0;
      ctx.restore();

      // ── Number label ──
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.fillStyle = online ? "#000000" : "#666666"; // Contrasting color since body is white
      ctx.font = `bold ${hov ? 9 : 8}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((i + 1).toString(), -2 * S, 0);
      ctx.restore();

      // ── Hover tooltip ──
      if (hov) {
        ctx.font = "10.5px Inter, sans-serif";
        const lbl = cam.name;
        const tw = ctx.measureText(lbl).width;
        const bx = m.x - tw / 2 - 7;
        const by = m.y - R - 22;
        ctx.save();
        ctx.fillStyle = "#0d1117f2";
        ctx.beginPath();
        ctx.roundRect(bx, by, tw + 14, 18, 4);
        ctx.fill();
        ctx.fillStyle = "#e8edf5";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(lbl, m.x, by + 9);
        ctx.restore();
      }

      // ── Direction handle ──
      const ang2 = (m.direction || 0) * (Math.PI / 180);
      const hx = m.x + Math.cos(ang2) * (R + 9);
      const hy = m.y + Math.sin(ang2) * (R + 9);
      ctx.beginPath();
      ctx.arc(hx, hy, 3, 0, Math.PI * 2);
      ctx.fillStyle = online ? col : "#555";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.30)";
      ctx.lineWidth = 1;
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
    const el = canvasRef.current?.parentElement;
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