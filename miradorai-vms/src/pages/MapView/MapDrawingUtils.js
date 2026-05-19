/**
 * MapDrawingUtils.js
 * 
 * Shared drawing utilities for MapViewPage and DesignerView.
 * Ensures consistent visual style across the application.
 */

export const TYPE_ICONS = {
  dome: "⊙",
  bullet: "▶",
  ptz: "↻",
  fisheye: "◎",
  box: "▪",
  turret: "⊕",
};

/** Categorizes a camera type based on its name string */
export function getCamTypeFromName(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("bullet")) return "bullet";
  if (n.includes("ptz"))    return "ptz";
  if (n.includes("fish"))   return "fisheye";
  if (n.includes("box"))    return "box";
  if (n.includes("turret")) return "turret";
  return "dome";
}

export const TYPE_COLORS = {
  dome: "#3b82f6",
  bullet: "#f59e0b",
  ptz: "#8b5cf6",
  fisheye: "#10b981",
  box: "#f97316",
  turret: "#ec4899",
};

/** Helper to calculate FOV drawing parameters */
export function getFovParams(camera, direction = 0) {
  const hfov = camera.hfov || 60;
  const halfRad = (hfov / 2) * (Math.PI / 180);
  const angle = (direction || 0) * (Math.PI / 180);
  return { angle, halfRad };
}

/** Draws a premium camera icon and its FOV on a canvas (Design View style) */
export function drawCamera(ctx, p, ppm, options = {}) {
  const { 
    isHovered = false, 
    isSelected = false, 
    showFov = true, 
    showLabel = false,
    zones = [],
    activeZoneId = null,
  } = options;

  const { x, y, direction, camera } = p;
  const col = TYPE_COLORS[camera.type] || "#3b82f6";
  const { angle, halfRad } = getFovParams(camera, direction);
  const radius = (camera.rangeDay || 30) * ppm;
  
  const camScale = 0.62;
  const shift = 14 * camScale;
  const originX = x - Math.cos(angle) * (20 * camScale);
  const originY = y - Math.sin(angle) * (20 * camScale);

  // 1. FOV Clipping (if active zone exists)
  let clipping = false;
  if (activeZoneId) {
    const zone = zones.find(z => z.id === activeZoneId);
    if (zone && zone.polygon.length >= 3) {
      ctx.save();
      ctx.beginPath();
      zone.polygon.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath(); ctx.clip(); clipping = true;
    }
  }

  // 2. FOV Cone
  if (showFov) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.arc(originX, originY, radius, angle - halfRad, angle + halfRad);
    ctx.closePath();
    const g = ctx.createRadialGradient(originX, originY, 0, originX, originY, radius);
    g.addColorStop(0, col + (isSelected ? "88" : "55"));
    g.addColorStop(1, col + "11");
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = col + (isSelected ? "dd" : "88");
    ctx.lineWidth = isSelected ? 1.5 : 1; ctx.stroke();
    ctx.restore();
  }

  if (clipping) ctx.restore();

  // 3. Full Coverage Circle (Dashed)
  if (showFov) {
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = col + "22"; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
  }

  // 4. Camera Body (Premium Pill Shape)
  ctx.save();
  ctx.translate(x - Math.cos(angle) * shift, y - Math.sin(angle) * shift);
  ctx.rotate(angle);
  
  if (isSelected || isHovered) { 
    ctx.shadowColor = col; ctx.shadowBlur = 14; 
  }

  // Base/Mount
  ctx.beginPath(); ctx.arc(-16 * camScale, 0, 6 * camScale, 0, Math.PI * 2);
  ctx.fillStyle = "#d9d9d9"; ctx.fill(); ctx.strokeStyle = "#888"; ctx.lineWidth = 0.8; ctx.stroke();
  
  // Pivot
  ctx.beginPath(); 
  if (ctx.roundRect) ctx.roundRect(-16 * camScale, -3 * camScale, 8 * camScale, 6 * camScale, 2);
  else ctx.rect(-16 * camScale, -3 * camScale, 8 * camScale, 6 * camScale);
  ctx.fillStyle = "#cfcfcf"; ctx.fill(); ctx.stroke();
  
  // Body
  ctx.beginPath(); 
  if (ctx.roundRect) ctx.roundRect(-8 * camScale, -6 * camScale, 20 * camScale, 12 * camScale, 5);
  else ctx.rect(-8 * camScale, -6 * camScale, 20 * camScale, 12 * camScale);
  ctx.fillStyle = "#f0f0f0"; ctx.fill(); ctx.strokeStyle = "#aaa"; ctx.stroke();
  
  // Lens ring
  ctx.beginPath(); ctx.arc(12 * camScale, 0, 7 * camScale, 0, Math.PI * 2);
  ctx.fillStyle = col + "22"; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
  
  // Lens
  ctx.beginPath(); ctx.arc(12 * camScale, 0, 4 * camScale, 0, Math.PI * 2);
  ctx.fillStyle = "#111"; ctx.fill();
  
  // Reflection
  ctx.beginPath(); ctx.arc(13 * camScale, -1.5 * camScale, 1.5 * camScale, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff88"; ctx.fill();
  
  ctx.shadowBlur = 0; ctx.restore();

  // 5. Label
  if (showLabel) {
    const label = camera.model || camera.name || "";
    ctx.save();
    ctx.translate(x, y);
    
    // Label background pill for better legibility on busy maps
    ctx.font = `bold 11px Inter, sans-serif`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    if (ctx.roundRect) ctx.roundRect(-tw/2 - 6, 21, tw + 12, 16, 4);
    else ctx.rect(-tw/2 - 6, 21, tw + 12, 16);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(label, 0, 24);
    ctx.restore();
  }
}

/** 
 * Renders a full snapshot of the Map View exactly as it appears in the UI.
 * This includes the dark overlay, FOV punch-outs, and numbered camera circles.
 */
export function renderMapViewSnapshot(ctx, options) {
  const { 
    img, 
    markers, 
    cameras, 
    zones, 
    activeFloor,
    highlightedCamId = null,
    showHeatmap = false
  } = options;

  if (!img) return;

  const W = img.width;
  const H = img.height;

  // ── 1. Floor plan ──────────────────────────────────────────────
  ctx.drawImage(img, 0, 0);

  const floorZones = zones.filter(z => z.floorIndex === activeFloor);

  // Helper for point-in-polygon
  function pointInPolygon(px, py, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // ── 2. FOV Cones (Direct drawing for clarity) ──────────────────
  if (markers.length > 0) {
    markers.forEach(m => {
      const cam = cameras.find(c => c.id === m.camId);
      const online = cam?.status === "online";
      const isHighlit = m.camId === highlightedCamId;
      const fovAngle = m.fovAngle || 60;
      const direction = m.direction || 0;
      const fovLen = fovAngle * 2.2 + 40;
      const halfRad = (fovAngle / 2) * (Math.PI / 180);
      const angle = direction * (Math.PI / 180);

      const zone = floorZones.find(z => z.polygon?.length >= 3 && pointInPolygon(m.x, m.y, z.polygon));

      ctx.save();
      if (zone) {
        ctx.beginPath();
        ctx.moveTo(zone.polygon[0].x, zone.polygon[0].y);
        for (let i = 1; i < zone.polygon.length; i++) ctx.lineTo(zone.polygon[i].x, zone.polygon[i].y);
        ctx.closePath(); ctx.clip();
      }

      const camType = getCamTypeFromName(cam?.name || cam?.model);
      const typeCol = TYPE_COLORS[camType] || "#3b82f6";
      
      const hexToRgb = (hex) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `${r},${g},${b}`;
      };
      const rgb = hexToRgb(isHighlit ? "#5aabf0" : typeCol);

      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, fovLen);
      if (!online) {
        g.addColorStop(0, "rgba(110,110,110,0.30)");
        g.addColorStop(1, "rgba(110,110,110,0.05)");
      } else {
        g.addColorStop(0, `rgba(${rgb},0.45)`);
        g.addColorStop(0.6, `rgba(${rgb},0.15)`);
        g.addColorStop(1, `rgba(${rgb},0.02)`);
      }

      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.arc(m.x, m.y, fovLen, angle - halfRad, angle + halfRad);
      ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      
      ctx.strokeStyle = `rgba(${rgb},0.5)`;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();
    });
  }

  // ── 4. Camera bodies (Map View Style) ──
  const S = 0.62;
  markers.forEach((m, i) => {
    const cam = cameras.find(c => c.id === m.camId) || { status: "offline" };
    const online = cam.status === "online";
    const isHighlit = m.camId === highlightedCamId;
    const col = online ? (isHighlit ? "#5aabf0" : "#1D9E75") : "#555";
    const R = 8;
    const angle = (m.direction || 0) * (Math.PI / 180);

    // Glow
    ctx.beginPath(); ctx.arc(m.x, m.y, R + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = col + (isHighlit ? "40" : "20"); ctx.fill();

    ctx.save();
    ctx.translate(m.x, m.y); ctx.rotate(angle);

    // Mount
    ctx.beginPath(); ctx.arc(-14 * S, 0, 5 * S, 0, Math.PI * 2);
    ctx.fillStyle = isHighlit ? "#a8ccee" : "#cecece"; ctx.fill();
    ctx.strokeStyle = isHighlit ? "#5aabf0" : "#888"; ctx.lineWidth = 0.8; ctx.stroke();

    // Neck
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-14 * S, -2.5 * S, 7 * S, 5 * S, 1.5);
    else ctx.rect(-14 * S, -2.5 * S, 7 * S, 5 * S);
    ctx.fillStyle = isHighlit ? "#9bbdd8" : "#c4c4c4"; ctx.fill(); ctx.stroke();

    // Body
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-7 * S, -5.5 * S, 17 * S, 11 * S, 5 * S);
    else ctx.rect(-7 * S, -5.5 * S, 17 * S, 11 * S);
    ctx.fillStyle = isHighlit ? "#daeeff" : "#efefef"; ctx.fill();
    ctx.strokeStyle = isHighlit ? "#5aabf0" : "#aaa"; ctx.lineWidth = 0.8; ctx.stroke();

    // Bezel
    ctx.beginPath(); ctx.arc(10 * S, 0, 5.5 * S, 0, Math.PI * 2);
    ctx.fillStyle = isHighlit ? "#b8d8f0" : "#dfdfdf"; ctx.fill();
    ctx.strokeStyle = isHighlit ? "#5aabf0" : "#aaa"; ctx.stroke();

    // Lens
    ctx.beginPath(); ctx.arc(10 * S, 0, 3.2 * S, 0, Math.PI * 2);
    ctx.fillStyle = "#0e0e0e"; ctx.fill();
    
    // Sparkle
    ctx.beginPath(); ctx.arc(10.8 * S, -1.1 * S, 1.1 * S, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.60)"; ctx.fill();

    // Recording Indicator LED Dot (rotated with body)
    const showRec = localStorage.getItem("miradorai_show_rec_ind") !== "false";
    if (online && showRec) {
      ctx.beginPath();
      ctx.arc(-14 * S, -6 * S, 2 * S, 0, Math.PI * 2);
      ctx.fillStyle = "#ff4d4f";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    ctx.restore();

    // Number label
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.fillStyle = online ? "#fff" : "#aaa";
    ctx.font = `bold 8px monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText((i + 1).toString(), -2 * S, 0);
    ctx.restore();
  });
}
