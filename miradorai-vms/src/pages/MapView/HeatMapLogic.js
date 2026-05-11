/**
 * HeatmapLogic.js
 *
 * ONE origin formula works for both MapView and DesignerView after the
 * drawPlacedCamera fix (see DesignerView.jsx).
 *
 * ── ORIGIN FORMULA (both views) ──────────────────────────────────────
 *   ox = marker.x + cos(angle) * (1.5 * 0.62)   →  +0.93 FORWARD
 *   oy = marker.y + sin(angle) * (1.5 * 0.62)
 *
 * This matches MapCanvas.js Step B/C exactly.
 * drawPlacedCamera in DesignerView is now updated to use the same formula.
 */

const S              = 0.62;
const ORIGIN_OFFSET  = 1.5 * S;   // 0.93 — matches MapCanvas and fixed drawPlacedCamera

/** Returns true if (px, py) is inside a camera's FOV cone */
export function insideCone(px, py, marker) {
  const fovAngle  = marker.fovAngle  || 60;
  const direction = marker.direction || 0;
  const fovLen    = fovAngle * 2.2 + 40;
  const angle     = direction * (Math.PI / 180);

  // ★ Same origin as MapCanvas AND fixed drawPlacedCamera
  const ox = marker.x + Math.cos(angle) * ORIGIN_OFFSET;
  const oy = marker.y + Math.sin(angle) * ORIGIN_OFFSET;

  const dx   = px - ox;
  const dy   = py - oy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > fovLen) return false;

  let diff = Math.atan2(dy, dx) - angle;
  while (diff >  Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;

  return Math.abs(diff) <= (fovAngle / 2) * (Math.PI / 180);
}

/** Point-in-polygon (ray-casting) */
export function pointInPolygon(px, py, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > py) !== (yj > py) &&
        px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/**
 * Renders the density heatmap onto a canvas context.
 */
export function drawHeatmapToContext(
  ctx, W, H,
  {
    markers    = [],
    cameras    = [],
    scale      = 1,
    offset     = { x: 0, y: 0 },
    activeZone = null,
    allZones   = [],
    floorImg   = null,
    step       = 3,
    clear      = true,
  }
) {
  if (clear) ctx.clearRect(0, 0, W, H);
  if (markers.length === 0 && !activeZone && allZones.length === 0) return new Set();

  const imgW = floorImg ? floorImg.width  * scale : 2000 * scale;
  const imgH = floorImg ? floorImg.height * scale : 2000 * scale;

  let sampleMinX = offset.x,        sampleMinY = offset.y;
  let sampleMaxX = offset.x + imgW, sampleMaxY = offset.y + imgH;

  const targetZones      = activeZone ? [activeZone] : (allZones.length > 0 ? allZones : []);
  const isClippedToZones = targetZones.length > 0;

  if (activeZone) {
    const sxs = activeZone.polygon.map(p => offset.x + p.x * scale);
    const sys  = activeZone.polygon.map(p => offset.y + p.y * scale);
    sampleMinX = Math.max(sampleMinX, Math.min(...sxs) - 2);
    sampleMinY = Math.max(sampleMinY, Math.min(...sys) - 2);
    sampleMaxX = Math.min(sampleMaxX, Math.max(...sxs) + 2);
    sampleMaxY = Math.min(sampleMaxY, Math.max(...sys) + 2);
  }

  const sw = Math.ceil(sampleMaxX - sampleMinX);
  const sh = Math.ceil(sampleMaxY - sampleMinY);
  if (sw <= 0 || sh <= 0) return new Set();

  const imageData   = ctx.createImageData(sw, sh);
  const data        = imageData.data;
  const foundLevels = new Set();

  for (let sy = 0; sy < sh; sy += step) {
    for (let sx = 0; sx < sw; sx += step) {

      const imgX = (sampleMinX + sx - offset.x) / scale;
      const imgY = (sampleMinY + sy - offset.y) / scale;

      if (isClippedToZones) {
        let inAny = false;
        for (const z of targetZones) {
          if (pointInPolygon(imgX, imgY, z.polygon)) { inAny = true; break; }
        }
        if (!inAny) continue;
      }

      let onlineCoverage = 0;
      for (const marker of markers) {
        if (!insideCone(imgX, imgY, marker)) continue;
        const cam = cameras.find(c => c.id === marker.camId);
        if (cam?.status === "online") onlineCoverage++;
      }

      const level = Math.min(onlineCoverage, 3);
      foundLevels.add(level);

      let r, g, b, a;
      if      (onlineCoverage === 0) { r=15;  g=15;  b=25;  a=110; }
      else if (onlineCoverage === 1) { r=34;  g=197; b=94;  a=150; }
      else if (onlineCoverage === 2) { r=234; g=179; b=8;   a=170; }
      else                           { r=220; g=38;  b=38;  a=190; }

      for (let dy = 0; dy < step && sy + dy < sh; dy++) {
        for (let dx = 0; dx < step && sx + dx < sw; dx++) {
          const idx = ((sy + dy) * sw + (sx + dx)) * 4;
          data[idx]=r; data[idx+1]=g; data[idx+2]=b; data[idx+3]=a;
        }
      }
    }
  }

  ctx.putImageData(imageData, Math.round(sampleMinX), Math.round(sampleMinY));

  if (isClippedToZones) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    targetZones.forEach(z => {
      z.polygon.forEach((pt, i) => {
        const sx = offset.x + pt.x * scale;
        const sy = offset.y + pt.y * scale;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
    });
    ctx.fill();
    ctx.restore();
  }

  return foundLevels;
}

/** Draws a heatmap legend */
export function drawHeatmapLegendToCanvas(
  ctx, canvasW, canvasH,
  { foundLevels, compact = false } = {}
) {
  const entries = [];
  if (!foundLevels || foundLevels.has(0)) entries.push({ color: "rgba(30,41,59,0.88)",  label: "Blind Spot (No Coverage)" });
  if (!foundLevels || foundLevels.has(1)) entries.push({ color: "rgba(34,197,94,0.88)", label: "Single Camera Coverage" });
  if (!foundLevels || foundLevels.has(2)) entries.push({ color: "rgba(234,179,8,0.90)", label: "2-Camera Overlap" });
  if (!foundLevels || foundLevels.has(3)) entries.push({ color: "rgba(220,38,38,0.92)", label: "High Density (3+ Overlap)" });
  if (!entries.length) return;

  const fontSize = compact ? 9 : 13,  swatchW = compact ? 16 : 30, swatchH = compact ? 8 : 14;
  const rowGap   = compact ? 14 : 26, padX = compact ? 10 : 16,    padY = compact ? 8 : 14;
  const radius   = compact ? 5 : 10,  margin = compact ? 10 : 22;

  ctx.save();
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  const maxLW = Math.max(...entries.map(e => ctx.measureText(e.label).width));
  const boxW  = padX * 2 + swatchW + 12 + maxLW;
  const boxH  = padY * 2 + entries.length * rowGap - (rowGap - swatchH);
  const bx    = canvasW - boxW - margin;
  const by    = canvasH - boxH - margin;

  ctx.fillStyle = compact ? "rgba(10,10,20,0.78)" : "rgba(255,255,255,0.94)";
  if (!compact) { ctx.shadowColor = "rgba(0,0,0,0.18)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3; }
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, boxW, boxH, radius); else ctx.rect(bx, by, boxW, boxH);
  ctx.fill();
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.strokeStyle = compact ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.08)";
  ctx.lineWidth = 1; ctx.stroke();

  entries.forEach((e, i) => {
    const ey = by + padY + i * rowGap;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx + padX, ey, swatchW, swatchH, compact ? 2 : 4);
    else ctx.rect(bx + padX, ey, swatchW, swatchH);
    ctx.fill();
    ctx.fillStyle    = compact ? "rgba(255,255,255,0.92)" : "#0f172a";
    ctx.font         = `600 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(e.label, bx + padX + swatchW + 10, ey + swatchH / 2);
  });
  ctx.restore();
}