import { useEffect, useRef } from "react";
import "./Heatmaplayer.css";

/**
 * HeatmapLayer
 *
 * Renders TWO canvas overlays:
 *   1. mv-heatmap-density-canvas  — the real heat map
 *      • Samples every pixel of the floor image area
 *      • Counts how many camera FOV cones cover that pixel
 *      • Maps 0 cameras → deep red (blind spot)
 *              1 camera  → green
 *              2 cameras → yellow-green
 *              3+        → bright yellow / white-hot
 *      • Offline cameras shift their zone toward amber/orange
 *
 * The legend panel is always rendered; the density canvas is only
 * painted when showHeatmap === true.
 *
 * Props:
 *   markers      []    – floor markers  { camId, x, y, fovAngle, direction }
 *   cameras      []    – normalised cam list
 *   scaleRef     ref   – current canvas scale
 *   offsetRef    ref   – current canvas offset { x, y }
 *   wrapRef      ref   – canvas wrapper element
 *   showHeatmap  bool  – toggle
 *   floorImgRef  ref   – Image object (floor plan)
 */
export default function HeatmapLayer({
  markers,
  cameras,
  scaleRef,
  offsetRef,
  wrapRef,
  showHeatmap,
  floorImgRef,
}) {
  const densityRef = useRef(null);

  const total   = markers.length;
  const online  = markers.filter(m => cameras.find(c => c.id === m.camId)?.status === "online").length;
  const offline = total - online;

  /* ── helpers ──────────────────────────────────────────────────── */

  /** Returns true if image-space point (px, py) is inside a camera's FOV cone */
  function insideCone(px, py, marker) {
    const fovAngle  = marker.fovAngle  || 60;
    const direction = marker.direction || 0;
    const fovLen    = fovAngle * 2.4 + 50;

    const angle      = direction * (Math.PI / 180);
    const lensOffset = 12;
    const ox = marker.x + Math.cos(angle) * lensOffset;
    const oy = marker.y + Math.sin(angle) * lensOffset;

    const dx = px - ox;
    const dy = py - oy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > fovLen) return false;

    // angle of the sample point relative to lens
    const sampleAngle = Math.atan2(dy, dx);
    let diff = sampleAngle - angle;
    // normalise to [-π, π]
    while (diff >  Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    const halfFov = (fovAngle / 2) * (Math.PI / 180);
    return Math.abs(diff) <= halfFov;
  }

  /* ── draw real heatmap ────────────────────────────────────────── */
  useEffect(() => {
    const canvas = densityRef.current;
    if (!canvas) return;

    const wrap = wrapRef.current;
    if (!wrap) return;

    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    canvas.width  = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    if (!showHeatmap || !floorImgRef.current || markers.length === 0) return;

    const img    = floorImgRef.current;
    const scale  = scaleRef.current;
    const offset = offsetRef.current;

    // Bounds of the floor image in screen space
    const imgX = offset.x;
    const imgY = offset.y;
    const imgW = img.width  * scale;
    const imgH = img.height * scale;

    // We sample every STEP pixels for performance
    const STEP = 3;

    // Build ImageData directly — much faster than per-pixel fillRect
    const iw = Math.ceil(imgW);
    const ih = Math.ceil(imgH);
    if (iw <= 0 || ih <= 0) return;

    const imageData = ctx.createImageData(iw, ih);
    const data = imageData.data;

    for (let sy = 0; sy < ih; sy += STEP) {
      for (let sx = 0; sx < iw; sx += STEP) {
        // Convert screen pixel → image-space coords
        const imgSpaceX = sx / scale;
        const imgSpaceY = sy / scale;

        // Count how many cameras cover this pixel
        let onlineCoverage  = 0;
        let offlineCoverage = 0;

        for (const marker of markers) {
          if (!insideCone(imgSpaceX, imgSpaceY, marker)) continue;
          const cam = cameras.find(c => c.id === marker.camId);
          if (cam?.status === "online") onlineCoverage++;
          else offlineCoverage++;
        }

        const totalCoverage = onlineCoverage + offlineCoverage;

        // ── Color mapping ──────────────────────────────────────
        // 0 cams  → deep crimson  (blind spot)
        // 1 cam   → green
        // 2 cams  → yellow-green
        // 3+ cams → bright yellow→white  (high overlap)
        // offline → shift toward orange/amber

        let r, g, b, a;

        if (totalCoverage === 0) {
          // Blind spot — deep red
          r = 180; g = 0; b = 0; a = 190;
        } else if (offlineCoverage > 0 && onlineCoverage === 0) {
          // Only offline cameras cover this spot
          r = 200; g = 90; b = 0; a = 160;
        } else {
          // Mix: t goes 0→1 as coverage 1→3+
          const t = Math.min((onlineCoverage - 1) / 2, 1); // 0..1

          if (t < 0.5) {
            // green → yellow-green
            const u = t * 2; // 0..1
            r = Math.round(0   + u * 150);  // 0 → 150
            g = Math.round(210 - u * 10);   // 210 → 200
            b = Math.round(80  - u * 80);   // 80 → 0
          } else {
            // yellow-green → bright yellow/white
            const u = (t - 0.5) * 2; // 0..1
            r = Math.round(150 + u * 100);  // 150 → 250
            g = Math.round(200 + u * 50);   // 200 → 250
            b = Math.round(0   + u * 160);  // 0 → 160
          }

          // offline cameras tint toward amber
          if (offlineCoverage > 0) {
            const blend = offlineCoverage / totalCoverage;
            r = Math.round(r + blend * (220 - r));
            g = Math.round(g + blend * (120 - g));
            b = Math.round(b + blend * (0   - b));
          }

          a = 170 + Math.min(onlineCoverage * 20, 55); // slightly brighter with more cams
        }

        // Fill a STEP×STEP block
        for (let dy = 0; dy < STEP && sy + dy < ih; dy++) {
          for (let dx = 0; dx < STEP && sx + dx < iw; dx++) {
            const idx = ((sy + dy) * iw + (sx + dx)) * 4;
            data[idx]     = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = a;
          }
        }
      }
    }

    // Paint the computed ImageData at the floor image position
    ctx.putImageData(imageData, Math.round(imgX), Math.round(imgY));

    // ── Soft edge fade at border of floor image ────────────────
    // Clip everything outside the floor rect
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "#fff";
    ctx.fillRect(imgX, imgY, imgW, imgH);
    ctx.restore();
  }, [showHeatmap, markers, cameras, scaleRef, offsetRef, wrapRef, floorImgRef]);

  /* ── render ───────────────────────────────────────────────────── */
  return (
    <>
      {/* Density heatmap canvas */}
      <canvas
        ref={densityRef}
        className="mv-heatmap-density-canvas"
        style={{ display: showHeatmap ? "block" : "none" }}
      />

      {/* Legend — only when heatmap is on */}
      {showHeatmap && (
        <div className="mv-heatmap-legend">
          <div className="mv-heatmap-legend__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
            Coverage Heatmap
          </div>

          {/* Color scale bar */}
          <div className="mv-heatmap-legend__scale">
            <div className="mv-heatmap-legend__scale-bar" />
            <div className="mv-heatmap-legend__scale-labels">
              <span>Blind spot</span>
              <span>1 cam</span>
              <span>2 cams</span>
              <span>3+ overlap</span>
            </div>
          </div>

          {/* Legend rows */}
          <div className="mv-heatmap-legend__row">
            <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--none" />
            <span>No coverage — blind spot</span>
          </div>
          <div className="mv-heatmap-legend__row">
            <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--single" />
            <span>Single camera coverage</span>
          </div>
          <div className="mv-heatmap-legend__row">
            <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--overlap" />
            <span>2-camera overlap</span>
          </div>
          <div className="mv-heatmap-legend__row">
            <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--high" />
            <span>High overlap (3+ cameras)</span>
          </div>
          <div className="mv-heatmap-legend__row">
            <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--offline" />
            <span>Offline camera zone</span>
          </div>

          {/* Stats */}
          <div className="mv-heatmap-legend__stats">
            <span className="mv-heatmap-legend__stat mv-heatmap-legend__stat--online">
              {online} online
            </span>
            {offline > 0 && (
              <span className="mv-heatmap-legend__stat mv-heatmap-legend__stat--offline">
                {offline} offline
              </span>
            )}
            <span className="mv-heatmap-legend__stat" style={{ marginLeft: "auto" }}>
              {total} placed
            </span>
          </div>
        </div>
      )}
    </>
  );
}