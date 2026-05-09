import React, { useState, useEffect, useRef, useCallback } from "react";
import "./DesignerView.css";
import { CAMERA_DB, BRANDS, filterCameras, fovDrawParams } from "./CameraModelDB";

// ── Constants ─────────────────────────────────────────────────────────────────
const PIXELS_PER_METRE = 22;
const TYPE_ICONS = {
  dome:    "⊙",
  bullet:  "▶",
  ptz:     "↻",
  fisheye: "◎",
  box:     "▪",
  turret:  "⊕",
};
const TYPE_COLORS = {
  dome:    "#3b82f6",
  bullet:  "#f59e0b",
  ptz:     "#8b5cf6",
  fisheye: "#10b981",
  box:     "#f97316",
  turret:  "#ec4899",
};

// ── Camera icon SVG ───────────────────────────────────────────────────────────
function CameraIcon({ type, size = 22, color }) {
  const c = color || TYPE_COLORS[type] || "#3b82f6";
  if (type === "ptz") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6">
      <circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
      <path d="M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>
    </svg>
  );
  if (type === "fisheye") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6">
      <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2" fill={c}/>
    </svg>
  );
  if (type === "bullet") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6">
      <rect x="2" y="9" width="14" height="6" rx="2"/>
      <path d="M16 10l6 2-6 2V10z" fill={c} stroke="none"/>
      <circle cx="5" cy="12" r="1.5" fill={c}/>
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6">
      <path d="M4 18 Q12 4 20 18Z"/>
      <line x1="4" y1="18" x2="20" y2="18"/>
      <circle cx="12" cy="16" r="2" fill={c}/>
    </svg>
  );
}

// ── Model card in the library panel ──────────────────────────────────────────
function ModelCard({ camera, onDragStart, onSelect, isSelected }) {
  const col = TYPE_COLORS[camera.type] || "#3b82f6";
  return (
    <div
      className={`dv-model-card ${isSelected ? "dv-model-card--selected" : ""}`}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData("cameraId", camera.id);
        onDragStart(camera);
      }}
      onClick={() => onSelect(camera)}
      style={{ "--brand-color": col }}
      title={`${camera.brand} ${camera.model}\nHFOV: ${camera.hfov}°\nRange: ${camera.rangeDay} m`}
    >
      <div className="dv-model-card__type-bar" style={{ background: col }} />
      <div className="dv-model-card__icon">
        <CameraIcon type={camera.type} size={26} color={col} />
      </div>
      <div className="dv-model-card__info">
        <div className="dv-model-card__model">{camera.model}</div>
        <div className="dv-model-card__brand">{camera.brand} · {camera.series}</div>
        <div className="dv-model-card__specs">
          <span className="dv-spec-pill" style={{ borderColor: col + "55", color: col }}>
            {camera.megapixels}MP
          </span>
          <span className="dv-spec-pill">HFOV {camera.hfov}°</span>
          <span className="dv-spec-pill">{camera.rangeDay}m</span>
          {camera.ir > 0 && <span className="dv-spec-pill dv-spec-pill--ir">IR {camera.ir}m</span>}
          {camera.isVarifocal && <span className="dv-spec-pill dv-spec-pill--vari">VF</span>}
        </div>
      </div>
    </div>
  );
}

// ── Spec detail panel ─────────────────────────────────────────────────────────
function SpecPanel({ camera, onClose }) {
  if (!camera) return null;
  const col = TYPE_COLORS[camera.type] || "#3b82f6";
  const rows = [
    ["Type",          camera.type.charAt(0).toUpperCase() + camera.type.slice(1)],
    ["Sensor",        camera.sensor],
    ["Resolution",    `${camera.megapixels} MP`],
    ["Focal Length",  camera.isVarifocal ? `${camera.focalLength}–${camera.focalLengthMax} mm` : `${camera.focalLength} mm`],
    ["Horizontal FOV",camera.isVarifocal ? `${camera.hfovMin}°–${camera.hfov}°` : `${camera.hfov}°`],
    ["Vertical FOV",  `${camera.vfov}°`],
    ["Diagonal FOV",  `${camera.dfov}°`],
    ["Day Range",     `${camera.rangeDay} m`],
    ["IR Range",      camera.ir > 0 ? `${camera.ir} m` : "None"],
    ["PoE",           camera.poe ? "Yes" : "No"],
    ["IP Rating",     camera.ip],
    ["Coverage Area", `≈ ${camera.coverageArea.toLocaleString()} m²`],
  ];
  return (
    <div className="dv-spec-panel">
      <div className="dv-spec-panel__header" style={{ borderBottomColor: col }}>
        <CameraIcon type={camera.type} size={28} color={col} />
        <div>
          <div className="dv-spec-panel__model">{camera.model}</div>
          <div className="dv-spec-panel__brand">{camera.brand} · {camera.series}</div>
        </div>
        <button className="dv-spec-panel__close" onClick={onClose}>✕</button>
      </div>
      <p className="dv-spec-panel__notes">{camera.notes}</p>
      <div className="dv-spec-panel__grid">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt><dd>{v}</dd>
          </React.Fragment>
        ))}
      </div>
      <div className="dv-spec-panel__fov-vis">
        <FovVisualizer camera={camera} />
      </div>
    </div>
  );
}

// ── FOV arc visualizer (small preview) ───────────────────────────────────────
function FovVisualizer({ camera }) {
  const ref = useRef(null);
  useEffect(() => {
    const cvs = ref.current; if (!cvs) return;
    const ctx = cvs.getContext("2d");
    const W = cvs.width, H = cvs.height;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2, cy = H - 16;
    const col = TYPE_COLORS[camera.type] || "#3b82f6";

    ctx.strokeStyle = "#2e3d55"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();

    if (camera.type === "fisheye") {
      const r = Math.min(W, H) / 2 - 12;
      ctx.beginPath(); ctx.arc(cx, H/2, r, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(cx, H/2, 0, cx, H/2, r);
      g.addColorStop(0, col + "66"); g.addColorStop(1, col + "11");
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = col + "aa"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = col; ctx.font = "bold 11px monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("360°", cx, H/2);
      return;
    }

    const hfov    = camera.hfov;
    const radius  = cy - 16;
    const half    = (hfov / 2) * (Math.PI / 180);
    const upAngle = -Math.PI / 2;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, upAngle - half, upAngle + half);
    ctx.closePath();
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, col + "88"); g.addColorStop(1, col + "11");
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = col + "cc"; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.fillStyle = col; ctx.font = "bold 11px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(`HFOV ${hfov}°`, cx, 4);

    if (camera.rangeDay > 0) {
      const labelR = radius * 0.72;
      const lx = cx + Math.cos(upAngle + half * 0.6) * labelR;
      const ly = cy + Math.sin(upAngle + half * 0.6) * labelR;
      ctx.fillStyle = "#7a8499"; ctx.font = "9px monospace";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(`${camera.rangeDay}m`, lx, ly);
    }

    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
  }, [camera]);
  return <canvas ref={ref} width={220} height={130} className="dv-fov-canvas" />;
}

// ── Canvas placed camera drawing ──────────────────────────────────────────────
// FIX 2: Accepts zonesRef + activeZoneIdRef to clip FOV cone to active zone
function drawPlacedCamera(ctx, p, ppm, hovering, selected, zonesRef, activeZoneIdRef) {
  const { x, y, direction, camera } = p;
  const col                = TYPE_COLORS[camera.type] || "#3b82f6";
  const { angle, halfRad } = fovDrawParams(camera, direction);
  const radius             = camera.rangeDay * ppm;
  const lensOff            = 14;
  const originX            = x + Math.cos(angle) * lensOff;
  const originY            = y + Math.sin(angle) * lensOff;

  // ── FIX 2: Apply zone clip before drawing FOV ─────────────────────────
  let clipping = false;
  if (activeZoneIdRef?.current) {
    const zone = zonesRef?.current?.find(z => z.id === activeZoneIdRef.current);
    if (zone && zone.polygon.length >= 3) {
      ctx.save();
      ctx.beginPath();
      zone.polygon.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath();
      ctx.clip();
      clipping = true;
    }
  }

  // FOV cone
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(originX, originY);
  ctx.arc(originX, originY, radius, angle - halfRad, angle + halfRad);
  ctx.closePath();
  const g = ctx.createRadialGradient(originX, originY, 0, originX, originY, radius);
  g.addColorStop(0, col + (selected ? "77" : "44"));
  g.addColorStop(1, col + "0a");
  ctx.fillStyle   = g;
  ctx.fill();
  ctx.strokeStyle = col + (selected ? "cc" : "66");
  ctx.lineWidth   = selected ? 1.5 : 1;
  ctx.stroke();
  ctx.restore();

  // Release clip after FOV — body + range ring draw unclipped
  if (clipping) ctx.restore();

  // Range circle (dashed)
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = col + "33";
  ctx.lineWidth   = 0.8;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Camera body (rotated)
  const camScale = 1.1;
  const shift    = 14 * camScale;
  ctx.save();
  ctx.translate(x - Math.cos(angle) * shift, y - Math.sin(angle) * shift);
  ctx.rotate(angle);

  if (selected || hovering) {
    ctx.shadowColor = col;
    ctx.shadowBlur  = 14;
  }

  ctx.beginPath(); ctx.arc(-16 * camScale, 0, 6 * camScale, 0, Math.PI * 2);
  ctx.fillStyle = "#d9d9d9"; ctx.fill(); ctx.strokeStyle = "#888"; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.beginPath(); ctx.roundRect?.(-16 * camScale, -3 * camScale, 8 * camScale, 6 * camScale, 2) ||
    ctx.rect(-16 * camScale, -3 * camScale, 8 * camScale, 6 * camScale);
  ctx.fillStyle = "#cfcfcf"; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.roundRect?.(-8 * camScale, -6 * camScale, 20 * camScale, 12 * camScale, 5) ||
    ctx.rect(-8 * camScale, -6 * camScale, 20 * camScale, 12 * camScale);
  ctx.fillStyle = "#f0f0f0"; ctx.fill(); ctx.strokeStyle = "#aaa"; ctx.stroke();
  ctx.beginPath(); ctx.arc(12 * camScale, 0, 7 * camScale, 0, Math.PI * 2);
  ctx.fillStyle = col + "22"; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.beginPath(); ctx.arc(12 * camScale, 0, 4 * camScale, 0, Math.PI * 2);
  ctx.fillStyle = "#111"; ctx.fill();
  ctx.beginPath(); ctx.arc(13 * camScale, -1.5 * camScale, 1.5 * camScale, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff88"; ctx.fill();

  ctx.shadowBlur = 0;
  ctx.restore();

  // Label
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle    = selected ? col : "#e8edf5";
  ctx.font         = `bold 10px monospace`;
  ctx.textAlign    = "center";
  ctx.textBaseline = "top";
  ctx.fillText(camera.model, 0, 20);
  ctx.restore();
}

// ── Point-in-polygon helper ───────────────────────────────────────────────────
function pointInPolygon(px, py, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ── Zone color palette ────────────────────────────────────────────────────────
const ZONE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#f97316", "#06b6d4"];

// ── Main DesignerView component ───────────────────────────────────────────────
export default function DesignerView({ onBack }) {
  const wrapRef         = useRef(null);
  const canvasRef       = useRef(null);
  const fileInputRef    = useRef(null);
  const floorImgRef     = useRef(null);
  const scaleRef        = useRef(1);
  const offsetRef       = useRef({ x: 0, y: 0 });
  const rafRef          = useRef(null);
  const panStartRef     = useRef(null);
  const draggingIdxRef  = useRef(null);
  const rotatingIdxRef  = useRef(null);
  const mouseDownPosRef = useRef(null);

  const [ppm, setPpm] = useState(PIXELS_PER_METRE);

  // placed cameras
  const [placed, setPlaced] = useState([]);
  const placedRef = useRef([]);
  useEffect(() => { placedRef.current = placed; }, [placed]);

  // ── Zone state ───────────────────────────────────────────────────────────
  const [zones, setZones]                 = useState([]);
  const zonesRef                          = useRef([]);
  const [drawingPoints, setDrawingPoints] = useState([]);
  const drawingPointsRef                  = useRef([]);
  const [activeZoneId, setActiveZoneId]   = useState(null);
  const activeZoneIdRef                   = useRef(null); // FIX 2: stable ref for drawPlacedCamera

  useEffect(() => { zonesRef.current = zones; }, [zones]);
  useEffect(() => { drawingPointsRef.current = drawingPoints; }, [drawingPoints]);
  useEffect(() => { activeZoneIdRef.current = activeZoneId; }, [activeZoneId]);

  // UI state
  const [hasFloor,      setHasFloor]      = useState(false);  // eslint-disable-line
  const [brandFilter,   setBrandFilter]   = useState("All");
  const [typeFilter,    setTypeFilter]    = useState("All");
  const [searchQuery,   setSearchQuery]   = useState("");
  const [selectedModel, setSelectedModel] = useState(null);
  const [dragCamera,    setDragCamera]    = useState(null);   // eslint-disable-line
  const [selectedIdx,   setSelectedIdx]   = useState(null);
  const [hoveredIdx,    setHoveredIdx]    = useState(null);
  const [zoomPct,       setZoomPct]       = useState(100);
  const [mode,          setMode]          = useState("place");
  const modeRef = useRef("place");
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const filteredCameras = filterCameras({
    brand:  brandFilter === "All" ? null : brandFilter,
    type:   typeFilter  === "All" ? null : typeFilter,
    search: searchQuery,
  });

  // ── Canvas draw ──────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const cvs = canvasRef.current; if (!cvs) return;
    const wrap = cvs.parentElement;  if (!wrap) return;
    cvs.width  = wrap.clientWidth;
    cvs.height = wrap.clientHeight;
    const ctx  = cvs.getContext("2d");
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    const { x: ox, y: oy } = offsetRef.current;
    const sc = scaleRef.current;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(sc, sc);

    // Floor plan / grid
    if (floorImgRef.current) ctx.drawImage(floorImgRef.current, 0, 0);
    else {
      ctx.fillStyle = "#0f141c";
      ctx.fillRect(0, 0, 2000, 2000);
      ctx.strokeStyle = "#1e2d3e";
      ctx.lineWidth   = 1;
      for (let gx = 0; gx < 2000; gx += 40) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, 2000); ctx.stroke();
      }
      for (let gy = 0; gy < 2000; gy += 40) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(2000, gy); ctx.stroke();
      }
      ctx.fillStyle = "#1e2d3e";
      ctx.font      = "14px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Import a floor plan or use the grid", 1000, 1000);
    }

    // Scale ruler
    const rulerPx = ppm * 5;
    const rulerY  = (floorImgRef.current?.height || 2000) - 24;
    const rulerX  = 20;
    ctx.save();
    ctx.fillStyle   = "rgba(13,17,23,0.72)";
    ctx.fillRect(rulerX - 4, rulerY - 6, rulerPx + 8, 18);
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(rulerX, rulerY + 4); ctx.lineTo(rulerX + rulerPx, rulerY + 4);
    ctx.moveTo(rulerX, rulerY);     ctx.lineTo(rulerX, rulerY + 8);
    ctx.moveTo(rulerX + rulerPx, rulerY); ctx.lineTo(rulerX + rulerPx, rulerY + 8);
    ctx.stroke();
    ctx.fillStyle = "#3b82f6"; ctx.font = "9px monospace"; ctx.textAlign = "center";
    ctx.fillText("5 m", rulerX + rulerPx / 2, rulerY + 1);
    ctx.restore();

    // Draw zones
    zonesRef.current.forEach(zone => {
      if (zone.polygon.length < 2) return;
      const isActive = zone.id === activeZoneIdRef.current;

      ctx.save();
      ctx.beginPath();
      zone.polygon.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();

      ctx.fillStyle   = zone.color + (isActive ? "33" : "18");
      ctx.fill();
      ctx.strokeStyle = zone.color + (isActive ? "ff" : "aa");
      ctx.lineWidth   = isActive ? 2.5 : 1.5;
      if (!isActive) ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Centroid label
      const cx = zone.polygon.reduce((s, p) => s + p.x, 0) / zone.polygon.length;
      const cy = zone.polygon.reduce((s, p) => s + p.y, 0) / zone.polygon.length;
      ctx.fillStyle    = zone.color;
      ctx.font         = "bold 11px monospace";
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(zone.name, cx, cy);
      ctx.restore();
    });

    // Drawing preview (in-progress zone polygon)
    if (drawingPointsRef.current.length > 0) {
      ctx.save();
      ctx.beginPath();
      drawingPointsRef.current.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth   = 2;
      ctx.setLineDash([6, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      drawingPointsRef.current.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === 0 ? 7 : 4, 0, Math.PI * 2);
        ctx.fillStyle   = i === 0 ? "#f59e0b" : "#fcd34d";
        ctx.fill();
        ctx.strokeStyle = "#fff8";
        ctx.lineWidth   = 1;
        ctx.stroke();
      });

      if (drawingPointsRef.current.length >= 3) {
        ctx.beginPath();
        ctx.arc(
          drawingPointsRef.current[0].x,
          drawingPointsRef.current[0].y,
          12 / sc, 0, Math.PI * 2
        );
        ctx.strokeStyle = "#f59e0baa";
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // Placed cameras — FIX 2: pass refs for zone FOV clipping
    placedRef.current.forEach((p, i) => {
      drawPlacedCamera(ctx, p, ppm, i === hoveredIdx, i === selectedIdx, zonesRef, activeZoneIdRef);
    });

    // Direction handle for selected camera
    if (selectedIdx !== null && selectedIdx < placedRef.current.length) {
      const p  = placedRef.current[selectedIdx];
      const { angle } = fovDrawParams(p.camera, p.direction);
      const hx = p.x + Math.cos(angle) * 36;
      const hy = p.y + Math.sin(angle) * 36;
      ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.fillStyle   = TYPE_COLORS[p.camera.type] || "#3b82f6";
      ctx.fill();
      ctx.strokeStyle = "#fff8"; ctx.lineWidth = 1.2; ctx.stroke();
    }

    ctx.restore();
  }, [ppm, hoveredIdx, selectedIdx]);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw, placed, zones, drawingPoints, activeZoneId]);

  useEffect(() => {
    const obs = new ResizeObserver(draw);
    const el  = canvasRef.current?.parentElement;
    if (el) obs.observe(el);
    return () => obs.disconnect();
  }, [draw]);

  // ── Fit floor plan ───────────────────────────────────────────────────────
  const fitImage = useCallback(() => {
    const wrap = wrapRef.current; const img = floorImgRef.current;
    if (!wrap || !img) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const s = Math.min(W / img.width, H / img.height) * 0.9;
    scaleRef.current  = s;
    offsetRef.current = { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2 };
    setZoomPct(Math.round(s * 100));
    draw();
  }, [draw]);

  const applyZoom = useCallback((delta, cx, cy) => {
    const prev = scaleRef.current;
    const next = Math.min(8, Math.max(0.08, prev + delta));
    scaleRef.current  = next;
    offsetRef.current = {
      x: cx - (cx - offsetRef.current.x) * (next / prev),
      y: cy - (cy - offsetRef.current.y) * (next / prev),
    };
    setZoomPct(Math.round(next * 100));
    draw();
  }, [draw]);

  // ── FIX 3: Zoom to zone ──────────────────────────────────────────────────
  const zoomToZone = useCallback((zone) => {
    const wrap = wrapRef.current; if (!wrap) return;

    const xs   = zone.polygon.map(p => p.x);
    const ys   = zone.polygon.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    const W  = wrap.clientWidth;
    const H  = wrap.clientHeight;
    const pw = maxX - minX;
    const ph = maxY - minY;

    if (pw < 1 || ph < 1) return; // guard degenerate polygon

    const scale = Math.min(W / pw, H / ph) * 0.8;
    scaleRef.current  = scale;
    offsetRef.current = {
      x: W / 2 - ((minX + maxX) / 2) * scale,
      y: H / 2 - ((minY + maxY) / 2) * scale,
    };
    setZoomPct(Math.round(scale * 100));
    draw();
  }, [draw]);

  // Wheel zoom
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const h = e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      applyZoom(e.deltaY < 0 ? 0.15 : -0.15, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [applyZoom]);

  // ── Coord helpers ────────────────────────────────────────────────────────
  function toImg(ex, ey) {
    const el = wrapRef.current; if (!el) return { x: 0, y: 0 };
    const r  = el.getBoundingClientRect();
    return {
      x: (ex - r.left - offsetRef.current.x) / scaleRef.current,
      y: (ey - r.top  - offsetRef.current.y) / scaleRef.current,
    };
  }

  function nearestPlaced(ix, iy) {
    const thr = 30 / scaleRef.current;
    let best = -1, bestD = thr;
    placedRef.current.forEach((p, i) => {
      const d = Math.hypot(p.x - ix, p.y - iy);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function nearRotHandle(ix, iy) {
    if (selectedIdx === null) return false;
    const p = placedRef.current[selectedIdx]; if (!p) return false;
    const { angle } = fovDrawParams(p.camera, p.direction);
    const hx = p.x + Math.cos(angle) * 36;
    const hy = p.y + Math.sin(angle) * 36;
    return Math.hypot(ix - hx, iy - hy) < 12 / scaleRef.current;
  }

  // ── Finish zone drawing ──────────────────────────────────────────────────
  const finishZoneDrawing = useCallback((points) => {
    const name = prompt("Enter zone name:");
    if (!name) return;

    const colorIdx = zonesRef.current.length % ZONE_COLORS.length;
    const newZone  = {
      id:      "zone_" + Date.now(),
      name,
      polygon: points,
      color:   ZONE_COLORS[colorIdx],
    };

    const updated = [...zonesRef.current, newZone];
    zonesRef.current = updated;
    setZones(updated);
    setActiveZoneId(newZone.id);

    drawingPointsRef.current = [];
    setDrawingPoints([]);
    setMode("place");

    // Auto-zoom into the freshly drawn zone
    setTimeout(() => zoomToZone(newZone), 0);
  }, [zoomToZone]);

  // ── Mouse events ─────────────────────────────────────────────────────────
  const onMouseDown = useCallback(e => {
    if (e.button === 2) return;
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    const p = toImg(e.clientX, e.clientY);

    // Zone drawing
    if (modeRef.current === "zone") {
      const pts = drawingPointsRef.current;

      if (pts.length >= 3) {
        const dist = Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
        if (dist < 20 / scaleRef.current) {
          finishZoneDrawing(pts);
          return;
        }
      }

      const updated = [...pts, p];
      drawingPointsRef.current = updated;
      setDrawingPoints(updated);
      draw();
      return;
    }

    if (modeRef.current === "pan") {
      panStartRef.current = { mx: e.clientX - offsetRef.current.x, my: e.clientY - offsetRef.current.y };
      return;
    }

    if (nearRotHandle(p.x, p.y)) { rotatingIdxRef.current = selectedIdx; return; }

    const idx = nearestPlaced(p.x, p.y);
    if (idx >= 0) { setSelectedIdx(idx); draggingIdxRef.current = idx; return; }

    setSelectedIdx(null);
  }, [selectedIdx, finishZoneDrawing, draw]); // eslint-disable-line

  const onMouseMove = useCallback(e => {
    const p = toImg(e.clientX, e.clientY);

    if (panStartRef.current) {
      offsetRef.current = { x: e.clientX - panStartRef.current.mx, y: e.clientY - panStartRef.current.my };
      draw(); return;
    }

    if (rotatingIdxRef.current !== null) {
      const idx = rotatingIdxRef.current;
      const cam = placedRef.current[idx]; if (!cam) return;
      const deg = (Math.atan2(p.y - cam.y, p.x - cam.x) * (180 / Math.PI) + 360) % 360;
      const updated = [...placedRef.current];
      updated[idx] = { ...updated[idx], direction: deg };
      placedRef.current = updated;
      setPlaced([...updated]); draw(); return;
    }

    // FIX 1: Block camera drag outside active zone
    if (draggingIdxRef.current !== null) {
      const idx = draggingIdxRef.current;

      if (activeZoneIdRef.current) {
        const zone = zonesRef.current.find(z => z.id === activeZoneIdRef.current);
        if (zone && !pointInPolygon(p.x, p.y, zone.polygon)) {
          return; // Hard stop — position is not updated
        }
      }

      const updated = [...placedRef.current];
      updated[idx] = { ...updated[idx], x: p.x, y: p.y };
      placedRef.current = updated;
      setPlaced([...updated]); draw(); return;
    }

    const idx = nearestPlaced(p.x, p.y);
    if (idx !== hoveredIdx) { setHoveredIdx(idx >= 0 ? idx : null); draw(); }
  }, [draw, hoveredIdx]); // eslint-disable-line

  const onMouseUp = useCallback(() => {
    draggingIdxRef.current  = null;
    rotatingIdxRef.current  = null;
    panStartRef.current     = null;
    mouseDownPosRef.current = null;
  }, []);

  // ── Drop from library ────────────────────────────────────────────────────
  const onDrop = useCallback(e => {
    e.preventDefault();
    const cameraId = e.dataTransfer.getData("cameraId");
    const camera   = CAMERA_DB.find(c => c.id === cameraId);
    if (!camera) return;

    const p = toImg(e.clientX, e.clientY);

    // Restrict drop to active zone
    if (activeZoneIdRef.current) {
      const zone = zonesRef.current.find(z => z.id === activeZoneIdRef.current);
      if (zone && !pointInPolygon(p.x, p.y, zone.polygon)) {
        alert(`Camera must be placed inside zone "${zone.name}"`);
        return;
      }
    }

    const newEntry = { camera, x: p.x, y: p.y, direction: 0, id: `placed_${Date.now()}` };
    const updated  = [...placedRef.current, newEntry];
    placedRef.current = updated;
    setPlaced(updated);
    setSelectedIdx(updated.length - 1);
    draw();
  }, [draw]); // eslint-disable-line

  // ── File import ──────────────────────────────────────────────────────────
  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => { floorImgRef.current = img; setHasFloor(true); fitImage(); };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function removeSelected() {
    if (selectedIdx === null) return;
    const updated = placedRef.current.filter((_, i) => i !== selectedIdx);
    placedRef.current = updated;
    setPlaced(updated);
    setSelectedIdx(null);
    draw();
  }

  function exportPng() {
    const img = floorImgRef.current; if (!img) return;
    const oc  = document.createElement("canvas");
    oc.width  = img.width; oc.height = img.height;
    const ctx = oc.getContext("2d");
    ctx.drawImage(img, 0, 0);
    zonesRef.current.forEach(zone => {
      if (zone.polygon.length < 2) return;
      ctx.save();
      ctx.beginPath();
      zone.polygon.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath();
      ctx.fillStyle   = zone.color + "22";
      ctx.fill();
      ctx.strokeStyle = zone.color;
      ctx.lineWidth   = 2;
      ctx.stroke();
      ctx.restore();
    });
    // Export with zone FOV clipping consistent with canvas view
    placedRef.current.forEach(p => drawPlacedCamera(ctx, p, ppm, false, false, zonesRef, activeZoneIdRef));
    const a  = document.createElement("a");
    a.download = "designer_layout.png";
    a.href     = oc.toDataURL("image/png");
    a.click();
  }

  // Cancel zone drawing on Escape
  useEffect(() => {
    const h = e => {
      if (e.key === "Escape" && modeRef.current === "zone") {
        drawingPointsRef.current = [];
        setDrawingPoints([]);
        setMode("place");
        draw();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [draw]);

  const selectedPlaced = selectedIdx !== null ? placed[selectedIdx] : null;

  return (
    <div className="dv-root">

      {/* ── Top bar ── */}
      <div className="dv-topbar">
        <button className="dv-back-btn" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Map View
        </button>

        <div className="dv-topbar__title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="15" height="15">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18M9 21V9"/>
            <circle cx="15" cy="15" r="2"/>
          </svg>
          Designer View
        </div>

        <div className="dv-topbar__actions">
          {/* Scale control */}
          <div className="dv-scale-control">
            <label>Scale</label>
            <input type="number" min="4" max="100" value={ppm}
              onChange={e => setPpm(Number(e.target.value) || PIXELS_PER_METRE)}/>
            <span>px/m</span>
          </div>

          <div className="dv-sep"/>

          <button className={`dv-tbtn ${mode === "place" ? "dv-tbtn--active" : ""}`}
            onClick={() => setMode("place")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12">
              <circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" strokeDasharray="2 3"/>
            </svg>
            Place
          </button>

          <button className={`dv-tbtn ${mode === "pan" ? "dv-tbtn--active" : ""}`}
            onClick={() => setMode("pan")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12">
              <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M12 3v18M3 12h18"/>
            </svg>
            Pan
          </button>

          <button
            className={`dv-tbtn ${mode === "zone" ? "dv-tbtn--active dv-tbtn--zone" : ""}`}
            onClick={() => {
              setMode("zone");
              drawingPointsRef.current = [];
              setDrawingPoints([]);
            }}
            title="Click points on canvas to draw a zone polygon. Click first point again to close."
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12">
              <polygon points="3,20 12,4 21,20"/>
              <circle cx="3"  cy="20" r="1.5" fill="currentColor"/>
              <circle cx="12" cy="4"  r="1.5" fill="currentColor"/>
              <circle cx="21" cy="20" r="1.5" fill="currentColor"/>
            </svg>
            Draw Zone
          </button>

          {mode === "zone" && (
            <span className="dv-zone-hint">
              {drawingPoints.length === 0
                ? "Click to place first point"
                : drawingPoints.length < 3
                ? `${drawingPoints.length} point${drawingPoints.length > 1 ? "s" : ""} — need at least 3`
                : "Click first point to close · Esc to cancel"}
            </span>
          )}

          <div className="dv-sep"/>

          <button className="dv-tbtn" onClick={() => fileInputRef.current?.click()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
            Import Floor Plan
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileChange}/>

          {selectedPlaced && (
            <button className="dv-tbtn dv-tbtn--danger" onClick={removeSelected}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14H6L5 6"/>
              </svg>
              Remove
            </button>
          )}

          <button className="dv-tbtn dv-tbtn--export" onClick={exportPng} disabled={placed.length === 0}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            Export PNG
          </button>

          <div className="dv-sep"/>
          <button className="dv-zbtn" onClick={() => { const el = wrapRef.current; if (el) applyZoom(-0.2, el.clientWidth/2, el.clientHeight/2); }}>−</button>
          <span className="dv-zoom-label">{zoomPct}%</span>
          <button className="dv-zbtn" onClick={() => { const el = wrapRef.current; if (el) applyZoom(0.2, el.clientWidth/2, el.clientHeight/2); }}>+</button>
          <button className="dv-zbtn dv-zbtn--fit" onClick={fitImage}>Fit</button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="dv-body">

        {/* Library panel */}
        <div className="dv-library">
          <div className="dv-library__head">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13">
              <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
            </svg>
            Camera Library
            <span className="dv-library__count">{filteredCameras.length}</span>
          </div>

          {/* Filters */}
          <div className="dv-library__filters">
            <input className="dv-search" placeholder="Search models…"
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}/>
            <div className="dv-filter-row">
              <select className="dv-select" value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
                <option value="All">All Brands</option>
                {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <select className="dv-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                <option value="All">All Types</option>
                {["dome","bullet","ptz","fisheye","box","turret"].map(t => (
                  <option key={t} value={t}>{TYPE_ICONS[t]} {t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Type pills */}
          <div className="dv-type-pills">
            {["All","dome","bullet","ptz","fisheye"].map(t => (
              <button key={t}
                className={`dv-type-pill ${typeFilter === t ? "dv-type-pill--active" : ""}`}
                style={typeFilter === t && t !== "All" ? { background: TYPE_COLORS[t] + "22", borderColor: TYPE_COLORS[t], color: TYPE_COLORS[t] } : {}}
                onClick={() => setTypeFilter(t)}>
                {t === "All" ? "All" : `${TYPE_ICONS[t]} ${t}`}
              </button>
            ))}
          </div>

          {/* Model list */}
          <div className="dv-model-list">
            {filteredCameras.length === 0 && (
              <div className="dv-model-empty">No cameras match your filters.</div>
            )}
            {filteredCameras.map(cam => (
              <ModelCard key={cam.id} camera={cam}
                onDragStart={setDragCamera}
                onSelect={c => setSelectedModel(prev => prev?.id === c.id ? null : c)}
                isSelected={selectedModel?.id === cam.id}/>
            ))}
          </div>

          {/* Zones list */}
          {zones.length > 0 && (
            <div className="dv-placed-list">
              <div className="dv-placed-list__head">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="11" height="11">
                  <polygon points="3,20 12,4 21,20"/>
                </svg>
                Zones
                <span className="dv-library__count">{zones.length}</span>
              </div>
              {zones.map(z => (
                <div
                  key={z.id}
                  className={`dv-placed-item ${activeZoneId === z.id ? "dv-placed-item--active" : ""}`}
                  // FIX 3: zoom to zone when activating
                  onClick={() => {
                    const newId = activeZoneId === z.id ? null : z.id;
                    setActiveZoneId(newId);
                    if (newId) zoomToZone(z);
                  }}
                  style={{ "--col": z.color }}
                  title={activeZoneId === z.id ? "Click to deactivate" : "Click to activate & zoom to zone"}
                >
                  <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: z.color, flexShrink: 0 }}/>
                  <span>{z.name}</span>
                  <span className="dv-placed-item__dir" style={{ color: z.color, fontSize: 9 }}>
                    {activeZoneId === z.id ? "ACTIVE" : `${z.polygon.length}pts`}
                  </span>
                  <button
                    title="Delete zone"
                    onClick={e => {
                      e.stopPropagation();
                      const updated = zonesRef.current.filter(zone => zone.id !== z.id);
                      zonesRef.current = updated;
                      setZones(updated);
                      if (activeZoneId === z.id) setActiveZoneId(null);
                      draw();
                    }}
                  >✕</button>
                </div>
              ))}
              {activeZoneId && (
                <div style={{ fontSize: 10, color: "#f59e0b", padding: "4px 10px 6px", opacity: 0.85 }}>
                  ⚠ Cameras must be placed &amp; stay inside the active zone
                </div>
              )}
            </div>
          )}

          {/* Placed cameras list */}
          {placed.length > 0 && (
            <div className="dv-placed-list">
              <div className="dv-placed-list__head">
                Placed on Layout
                <span className="dv-library__count">{placed.length}</span>
              </div>
              {placed.map((p, i) => {
                const col = TYPE_COLORS[p.camera.type] || "#3b82f6";
                return (
                  <div key={p.id} className={`dv-placed-item ${selectedIdx === i ? "dv-placed-item--active" : ""}`}
                    onClick={() => setSelectedIdx(i)} style={{ "--col": col }}>
                    <CameraIcon type={p.camera.type} size={14} color={col}/>
                    <span>{p.camera.model}</span>
                    <span className="dv-placed-item__dir">{Math.round(p.direction)}°</span>
                    <button onClick={e => { e.stopPropagation();
                      const u = placed.filter((_,j) => j !== i);
                      placedRef.current = u; setPlaced(u);
                      if (selectedIdx === i) setSelectedIdx(null); draw();
                    }}>✕</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Canvas */}
        <div className="dv-canvas-wrap" ref={wrapRef}
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}>
          <canvas ref={canvasRef} className="dv-canvas"
            style={{ cursor: mode === "pan" ? "grab" : "crosshair" }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />

          {/* Drop hint */}
          {placed.length === 0 && mode !== "zone" && (
            <div className="dv-drop-hint">
              <div className="dv-drop-hint__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="48" height="48">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <circle cx="12" cy="12" r="4"/>
                  <path d="M12 8v-2M12 18v-2M8 12H6M18 12h-2"/>
                </svg>
              </div>
              <p>Drag a camera model from the library onto the floor plan</p>
              <p className="dv-drop-hint__sub">or import a floor plan first</p>
            </div>
          )}

          {/* Zone drawing hint overlay */}
          {mode === "zone" && drawingPoints.length === 0 && (
            <div className="dv-drop-hint">
              <div className="dv-drop-hint__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1" width="48" height="48">
                  <polygon points="3,20 12,4 21,20"/>
                  <circle cx="3"  cy="20" r="1.5" fill="#f59e0b"/>
                  <circle cx="12" cy="4"  r="1.5" fill="#f59e0b"/>
                  <circle cx="21" cy="20" r="1.5" fill="#f59e0b"/>
                </svg>
              </div>
              <p style={{ color: "#f59e0b" }}>Click on the canvas to place zone vertices</p>
              <p className="dv-drop-hint__sub">Click the first point again to close · Press Esc to cancel</p>
            </div>
          )}

          {/* Selected camera info bar */}
          {selectedPlaced && (
            <div className="dv-selected-bar">
              <CameraIcon type={selectedPlaced.camera.type} size={16} color={TYPE_COLORS[selectedPlaced.camera.type]}/>
              <strong>{selectedPlaced.camera.brand} {selectedPlaced.camera.model}</strong>
              <span className="dv-sep-txt">·</span>
              <span>HFOV {selectedPlaced.camera.hfov}°</span>
              <span className="dv-sep-txt">·</span>
              <span>Range {selectedPlaced.camera.rangeDay} m</span>
              <span className="dv-sep-txt">·</span>
              <span>Dir {Math.round(selectedPlaced.direction)}°</span>
              <span className="dv-selected-bar__hint">Drag handle to rotate · Drag body to move</span>
            </div>
          )}
        </div>

        {/* Spec detail panel (right) */}
        {selectedModel && (
          <SpecPanel camera={selectedModel} onClose={() => setSelectedModel(null)}/>
        )}
      </div>
    </div>
  );
}