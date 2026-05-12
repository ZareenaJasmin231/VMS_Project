import React, { useState, useEffect, useRef, useCallback } from "react";
import "./DesignerView.css";
import { fovDrawParams } from "./CameraModelDB";
import { drawHeatmapToContext, drawHeatmapLegendToCanvas, drawDesignLegendToCanvas } from "./HeatmapLogic";
import HeatmapLayer from "./HeatmapLayer";

// ── Constants ─────────────────────────────────────────────────────────────────
const API = "http://192.168.126.200:8000";
const MAP_ID = "default";
const FLOOR_ID = "floor_1";
const PIXELS_PER_METRE = 22;

function getAuthHeaders() {
  const t = localStorage.getItem("miradorai_token") || "";
  return t
    ? { Authorization: "Bearer " + t, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiSaveLayout({ placed, zones, ppm, floorPlan = null }) {
  try {
    await fetch(`${API}/api/designer`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        map_id: MAP_ID,
        floor_id: FLOOR_ID,
        placed: placed.map(p => ({ id: p.id, x: p.x, y: p.y, direction: p.direction, camera: p.camera })),
        zones: zones.map(z => ({ id: z.id, name: z.name, color: z.color, polygon: z.polygon })),
        ppm,
        floor_plan: floorPlan,
      }),
    });
  } catch (e) {
    console.error("[DESIGNER] ❌ Save failed", e);
  }
}

async function apiSaveZones(zones) {
  try {
    await fetch(`${API}/api/designer/zones?map_id=${MAP_ID}&floor_id=${FLOOR_ID}`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(zones.map(z => ({ id: z.id, name: z.name, color: z.color, polygon: z.polygon }))),
    });
  } catch (e) {
    console.error("[DESIGNER] ❌ Zone save failed", e);
  }
}

async function apiDeleteZone(zoneId) {
  try {
    await fetch(`${API}/api/designer/zones/${zoneId}?map_id=${MAP_ID}&floor_id=${FLOOR_ID}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
  } catch (e) {
    console.error("[DESIGNER] ❌ Zone delete failed", e);
  }
}

async function apiSaveFloorPlan(floorPlanDataUrl) {
  try {
    await fetch(`${API}/api/designer/floor-plan`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ map_id: MAP_ID, floor_id: FLOOR_ID, floor_plan: floorPlanDataUrl }),
    });
  } catch (e) {
    console.error("[DESIGNER] ❌ Floor plan save failed", e);
  }
}

// ── NEW: Delete floor plan from backend ───────────────────────────────────────
async function apiDeleteFloorPlan() {
  try {
    await fetch(`${API}/api/designer/floor-plan?map_id=${MAP_ID}&floor_id=${FLOOR_ID}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
  } catch (e) {
    console.error("[DESIGNER] ❌ Floor plan delete failed", e);
  }
}

async function apiLoadLayout() {
  try {
    const r = await fetch(`${API}/api/designer?map_id=${MAP_ID}&floor_id=${FLOOR_ID}`, {
      headers: getAuthHeaders(),
    });
    if (!r.ok) return null;
    return r.json();
  } catch (e) {
    console.error("[DESIGNER] ❌ Load failed", e);
    return null;
  }
}

async function fetchCameraModels({ brand = null, type = null, search = "" } = {}) {
  const params = new URLSearchParams();
  if (brand) params.append("brand", brand);
  if (type) params.append("type", type);
  if (search) params.append("search", search);
  const r = await fetch(`${API}/api/designer/camera-models?${params}`, { headers: getAuthHeaders() });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

const TYPE_ICONS = {
  dome: "⊙", bullet: "▶", ptz: "↻", fisheye: "◎", box: "▪", turret: "⊕",
};
const TYPE_COLORS = {
  dome: "#3b82f6", bullet: "#f59e0b", ptz: "#8b5cf6",
  fisheye: "#10b981", box: "#f97316", turret: "#ec4899",
};
const ZONE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#f97316", "#06b6d4"];

// ── Point-in-polygon helper ───────────────────────────────────────────────────
function pointInPolygon(px, py, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ── CameraIcon SVG ────────────────────────────────────────────────────────────
function CameraIcon({ type, size = 22, color }) {
  const c = color || TYPE_COLORS[type] || "#3b82f6";
  if (type === "ptz") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6">
      <circle cx="12" cy="12" r="4" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      <path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M19.07 4.93l-2.83 2.83M7.76 16.24l-2.83 2.83" />
    </svg>
  );
  if (type === "fisheye") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" fill={c} />
    </svg>
  );
  if (type === "bullet") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6">
      <rect x="3" y="9" width="14" height="6" rx="2" /><path d="M17 12h4" />
      <circle cx="8" cy="12" r="1.5" fill={c} />
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6">
      <rect x="2" y="7" width="15" height="10" rx="2" /><path d="M17 9l5-2v10l-5-2V9z" />
      <circle cx="9" cy="12" r="2" fill={c + "44"} stroke={c} />
    </svg>
  );
}

// ── Model card (draggable) ────────────────────────────────────────────────────
function ModelCard({ camera, onDragStart, onSelect, isSelected }) {
  const col = TYPE_COLORS[camera.type] || "#3b82f6";
  return (
    <div
      className={`dv-model-card ${isSelected ? "dv-model-card--selected" : ""}`}
      draggable
      onDragStart={e => { e.dataTransfer.setData("cameraId", camera.id); onDragStart(camera); }}
      onClick={() => onSelect(camera)}
      style={{ "--brand-color": col }}
      title={`${camera.brand} ${camera.model}\nHFOV: ${camera.hfov}°\nRange: ${camera.rangeDay} m`}
    >
      <div className="dv-model-card__type-bar" style={{ background: col }} />
      <div className="dv-model-card__icon"><CameraIcon type={camera.type} size={18} color={col} /></div>
      <div className="dv-model-card__info">
        <div className="dv-model-card__model">{camera.model}</div>
        <div className="dv-model-card__brand">{camera.brand} · {camera.series}</div>
        <div className="dv-model-card__specs">
          <span className="dv-spec-pill" style={{ borderColor: col + "55", color: col }}>{camera.megapixels}MP</span>
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
    ["Type", camera.type.charAt(0).toUpperCase() + camera.type.slice(1)],
    ["Sensor", camera.sensor],
    ["Resolution", `${camera.megapixels} MP`],
    ["Focal Length", camera.isVarifocal ? `${camera.focalLength}–${camera.focalLengthMax} mm` : `${camera.focalLength} mm`],
    ["H-FOV", camera.isVarifocal ? `${camera.hfovMin}°–${camera.hfov}°` : `${camera.hfov}°`],
    ["V-FOV", `${camera.vfov}°`],
    ["Diagonal FOV", `${camera.dfov}°`],
    ["Day Range", `${camera.rangeDay} m`],
    ["IR Range", camera.ir > 0 ? `${camera.ir} m` : "None"],
    ["PoE", camera.poe ? "Yes" : "No"],
    ["IP Rating", camera.ip],
    ["Coverage", `≈ ${camera.coverageArea.toLocaleString()} m²`],
  ];
  return (
    <div className="dv-spec-panel">
      <div className="dv-spec-panel__header" style={{ borderBottom: `1px solid ${col}33` }}>
        <div className="dv-spec-panel__icon-badge" style={{ background: col + "22", border: `1px solid ${col}55` }}>
          <CameraIcon type={camera.type} size={20} color={col} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="dv-spec-panel__model">{camera.model}</div>
          <div className="dv-spec-panel__brand">
            <span style={{ color: col, fontWeight: 600 }}>{camera.brand}</span>
            <span style={{ color: "#2e3d55", margin: "0 4px" }}>·</span>
            <span>{camera.series}</span>
          </div>
        </div>
        <button className="dv-spec-panel__close" onClick={onClose}>✕</button>
      </div>
      <div style={{ padding: "10px 14px 0", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 4, background: col + "22", color: col, border: `0.5px solid ${col}55` }}>
          {TYPE_ICONS[camera.type]} {camera.type}
        </span>
        {camera.megapixels && (
          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "#1e2738", color: "#7a8499", border: "0.5px solid #2e3d55" }}>
            {camera.megapixels} MP
          </span>
        )}
        {camera.ir > 0 && (
          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "#f59e0b18", color: "#f59e0b", border: "0.5px solid #f59e0b44" }}>
            IR {camera.ir}m
          </span>
        )}
      </div>
      {camera.notes && (
        <div style={{ margin: "10px 14px 0", padding: "8px 10px", background: "#10151f", border: "0.5px solid #1e2d3e", borderRadius: 6, fontSize: 11, color: "#7a8499", lineHeight: 1.6 }}>
          {camera.notes}
        </div>
      )}
      <div style={{ padding: "12px 14px 6px" }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "0.5px solid #1a2030" }}>
            <span style={{ fontSize: 11, color: "#4a5568" }}>{k}</span>
            <span style={{ fontSize: 11, color: "#c9d1d9", fontVariantNumeric: "tabular-nums", fontFamily: "monospace" }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FOV arc visualizer ────────────────────────────────────────────────────────
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
      ctx.beginPath(); ctx.arc(cx, H / 2, r, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(cx, H / 2, 0, cx, H / 2, r);
      g.addColorStop(0, col + "66"); g.addColorStop(1, col + "11");
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = col + "aa"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = col; ctx.font = "bold 11px monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("360°", cx, H / 2);
      return;
    }
    const hfov = camera.hfov;
    const radius = cy - 16;
    const half = (hfov / 2) * (Math.PI / 180);
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
  return <canvas ref={ref} width={180} height={100} style={{ display: "block", margin: "0 auto" }} />;
}

// ── Camera drawing ────────────────────────────────────────────────────────────
// FIX 1: clipZone now auto-detects the camera's own zone when no active zone is set.
// This ensures FOV is always clipped to its zone even after refresh.
function drawPlacedCamera(ctx, p, ppm, hovering, selected, zonesRef, activeZoneIdRef, highlightedId, showLabel = true) {
  const { x, y, direction, camera } = p;
  const col = TYPE_COLORS[camera.type] || "#3b82f6";
  const isHighlit = p.id === highlightedId;
  const { angle, halfRad } = fovDrawParams(camera, direction);
  const radius = camera.rangeDay * ppm;

  const S = 0.62;

  // ★ FIX: origin matches MapCanvas (x + cos*1.5*S, forward) instead of old backward formula
  const originX = x + Math.cos(angle) * (1.5 * S);
  const originY = y + Math.sin(angle) * (1.5 * S);

  // ── Zone clip — use active zone OR camera's own zone ─────────────
  let clipping = false;
  let clipZone = null;

  if (activeZoneIdRef?.current) {
    clipZone = zonesRef?.current?.find(z => z.id === activeZoneIdRef.current) || null;
  }
  if (!clipZone && zonesRef?.current) {
    clipZone = zonesRef.current.find(
      z => z.polygon?.length >= 3 && pointInPolygon(x, y, z.polygon)
    ) || null;
  }

  if (clipZone && clipZone.polygon.length >= 3) {
    ctx.save();
    ctx.beginPath();
    clipZone.polygon.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
    ctx.clip();
    clipping = true;
  }

  // ── FOV cone ─────────────────────────────────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(originX, originY);
  ctx.arc(originX, originY, radius, angle - halfRad, angle + halfRad);
  ctx.closePath();
  const g = ctx.createRadialGradient(originX, originY, 0, originX, originY, radius);
  g.addColorStop(0, col + (selected ? "77" : isHighlit ? "66" : "44"));
  g.addColorStop(1, col + "0a");
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = col + (selected || isHighlit ? "cc" : "66");
  ctx.lineWidth = selected || isHighlit ? 1.5 : 1; ctx.stroke();
  ctx.restore();

  if (clipping) ctx.restore();

  // ── Range circle (dashed) ─────────────────────────────────────────
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = col + "33"; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.setLineDash([]); ctx.restore();

  // ── Camera body (Type-specific shapes, S=0.62) ──────────────────
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (selected || hovering || isHighlit) { ctx.shadowColor = col; ctx.shadowBlur = 14; }

  const type = camera.type || "dome";

  if (type === "dome" || type === "turret") {
    // ── DOME (Reference: Classic dome with base) ──
    // Base ring
    ctx.beginPath(); ctx.arc(0, 0, 11 * S, 0, Math.PI * 2);
    ctx.fillStyle = isHighlit ? "#daeeff" : "#cecece"; ctx.fill();
    ctx.strokeStyle = isHighlit ? "#5aabf0" : "#888"; ctx.lineWidth = 0.8; ctx.stroke();

    // Main housing (darker grey)
    ctx.beginPath(); ctx.arc(0, 0, 9 * S, 0, Math.PI * 2);
    ctx.fillStyle = isHighlit ? "#b8d8f0" : "#e0e0e0"; ctx.fill();
    ctx.stroke();

    // Lens "eye" (the dark window)
    ctx.beginPath(); ctx.arc(4 * S, 0, 5.5 * S, 0, Math.PI * 2);
    ctx.fillStyle = "#1a1a1a"; ctx.fill();
    
    // Glass highlight/glint
    ctx.beginPath(); ctx.arc(5.5 * S, -1.5 * S, 1.5 * S, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fill();
  } 
  else if (type === "fisheye") {
    // ── FISHEYE (Reference: Flat UFO-style ceiling mount) ──
    // Outer base
    ctx.beginPath(); ctx.arc(0, 0, 12 * S, 0, Math.PI * 2);
    ctx.fillStyle = isHighlit ? "#daeeff" : "#efefef"; ctx.fill();
    ctx.strokeStyle = isHighlit ? "#5aabf0" : "#aaa"; ctx.lineWidth = 0.8; ctx.stroke();

    // Concentric detail ring
    ctx.beginPath(); ctx.arc(0, 0, 8 * S, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.1)"; ctx.stroke();

    // Center lens
    ctx.beginPath(); ctx.arc(0, 0, 3.5 * S, 0, Math.PI * 2);
    ctx.fillStyle = "#0e0e0e"; ctx.fill();
    
    // Lens detail (inner ring)
    ctx.beginPath(); ctx.arc(0, 0, 1.5 * S, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.stroke();
  } 
  else if (type === "ptz") {
    // ── PTZ (Reference: Wall-mount bracket with hanging ball) ──
    // Wall mount plate
    ctx.beginPath(); ctx.rect(-18 * S, -6 * S, 4 * S, 12 * S);
    ctx.fillStyle = "#cecece"; ctx.fill(); ctx.stroke();

    // Bracket arm (curved style)
    ctx.beginPath();
    ctx.moveTo(-14 * S, -4 * S);
    ctx.quadraticCurveTo(-8 * S, -4 * S, -2 * S, 0);
    ctx.lineTo(-2 * S, 3 * S);
    ctx.quadraticCurveTo(-8 * S, -1 * S, -14 * S, -1 * S);
    ctx.closePath();
    ctx.fillStyle = "#dfdfdf"; ctx.fill(); ctx.stroke();

    // Main ball housing
    ctx.beginPath(); ctx.arc(0, 0, 10 * S, 0, Math.PI * 2);
    ctx.fillStyle = isHighlit ? "#daeeff" : "#efefef"; ctx.fill();
    ctx.strokeStyle = isHighlit ? "#5aabf0" : "#aaa"; ctx.stroke();

    // Lower lens section (black)
    ctx.beginPath(); ctx.arc(0, 0, 10 * S, -0.2, Math.PI + 0.2);
    ctx.fillStyle = "#222"; ctx.fill();

    // Actual lens Bezel
    ctx.beginPath(); ctx.arc(6 * S, 0, 4.5 * S, 0, Math.PI * 2);
    ctx.fillStyle = isHighlit ? "#b8d8f0" : "#dfdfdf"; ctx.fill(); ctx.stroke();

    // Lens
    ctx.beginPath(); ctx.arc(6 * S, 0, 2.5 * S, 0, Math.PI * 2);
    ctx.fillStyle = "#000"; ctx.fill();
  } 
  else {
    // ── BULLET / BOX / OTHER (Rectangular) ──
    const shift = 14 * S;
    ctx.translate(-shift, 0); // Offset for bullet style

    // Mount
    ctx.beginPath(); ctx.arc(-14 * S, 0, 5 * S, 0, Math.PI * 2);
    ctx.fillStyle = isHighlit ? "#a8ccee" : "#cecece"; ctx.fill();
    ctx.strokeStyle = isHighlit ? "#5aabf0" : "#888"; ctx.lineWidth = 0.8; ctx.stroke();

    // Neck
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-14 * S, -2.5 * S, 7 * S, 5 * S, 1.5);
    else ctx.rect(-14 * S, -2.5 * S, 7 * S, 5 * S);
    ctx.fillStyle = isHighlit ? "#9bbdd8" : "#c4c4c4"; ctx.fill(); ctx.stroke();

    // Main barrel body
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-7 * S, -5.5 * S, 17 * S, 11 * S, 5 * S);
    else ctx.rect(-7 * S, -5.5 * S, 17 * S, 11 * S);
    ctx.fillStyle = isHighlit ? "#daeeff" : "#efefef"; ctx.fill();
    ctx.strokeStyle = isHighlit ? "#5aabf0" : "#aaa"; ctx.lineWidth = 0.8; ctx.stroke();

    // Front bezel ring
    ctx.beginPath(); ctx.arc(10 * S, 0, 5.5 * S, 0, Math.PI * 2);
    ctx.fillStyle = isHighlit ? "#b8d8f0" : "#dfdfdf"; ctx.fill(); ctx.stroke();

    // Lens
    ctx.beginPath(); ctx.arc(10 * S, 0, 3.2 * S, 0, Math.PI * 2);
    ctx.fillStyle = "#0e0e0e"; ctx.fill();

    // Lens reflection
    ctx.beginPath(); ctx.arc(10.8 * S, -1.1 * S, 1.1 * S, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.60)"; ctx.fill();
  }

  ctx.shadowBlur = 0; ctx.restore();

  // ── Label ─────────────────────────────────────────────────────────
  if (showLabel) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = (selected || isHighlit) ? col : "#e8edf5";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(camera.model, 0, 14 * S + 6);
    ctx.restore();
  }

  // ── Hover tooltip ─────────────────────────────────────────────────
  if (hovering) {
    const lbl = camera.model;
    ctx.font = "10.5px Inter, sans-serif";
    const tw = ctx.measureText(lbl).width;
    const bx = x - tw / 2 - 7;
    const by = y - 24;
    ctx.save();
    ctx.fillStyle = "#0d1117f2";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, tw + 14, 18, 4);
    else ctx.rect(bx, by, tw + 14, 18);
    ctx.fill();
    ctx.fillStyle = "#e8edf5";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(lbl, x, by + 9);
    ctx.restore();
  }
}


// ── Zone Sidebar Item ─────────────────────────────────────────────────────────
function DvZoneSidebarItem({
  zone, placed, isActive, highlightedId,
  onSelect, onDelete, onHighlightCam, onRemoveCam, sidebarExpanded,
}) {
  const camsInZone = placed.filter(
    p => zone.polygon.length >= 3 && pointInPolygon(p.x, p.y, zone.polygon)
  );

  return (
    <div style={{
      borderLeft: isActive ? `2.5px solid ${zone.color}` : "2.5px solid transparent",
      background: isActive ? zone.color + "12" : "transparent",
      borderRadius: 5,
      marginBottom: 2,
      transition: "all 0.15s",
    }}>
      <button
        onClick={() => onSelect(zone)}
        title={zone.name}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", background: "none", border: "none",
          padding: "5px 6px", cursor: "pointer", color: "#c9d1d9",
          fontSize: 11, textAlign: "left",
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: 2,
          background: zone.color, flexShrink: 0,
          border: `1px solid ${zone.color}88`,
        }} />

        {sidebarExpanded && (
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
            {zone.name}
          </span>
        )}

        {sidebarExpanded && camsInZone.length > 0 && (
          <span style={{
            fontSize: 9, fontWeight: 700, borderRadius: 10,
            padding: "1px 5px", background: zone.color + "28", color: zone.color,
          }}>
            {camsInZone.length}
          </span>
        )}

        {sidebarExpanded && (
          <span
            onClick={e => { e.stopPropagation(); onDelete(zone.id); }}
            title="Delete zone"
            style={{ fontSize: 9, color: "#4a5568", cursor: "pointer", padding: "0 2px", flexShrink: 0 }}
          >✕</span>
        )}
      </button>

      {isActive && sidebarExpanded && camsInZone.length > 0 && (
        <div style={{ paddingBottom: 4 }}>
          {camsInZone.map((p) => {
            const col = TYPE_COLORS[p.camera.type] || "#3b82f6";
            const isHighlit = highlightedId === p.id;
            return (
              <div
                key={p.id}
                onClick={e => { e.stopPropagation(); onHighlightCam(p.id); }}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "3px 10px 3px 18px", cursor: "pointer",
                  background: isHighlit ? zone.color + "18" : "transparent",
                  borderLeft: isHighlit ? `2px solid ${zone.color}` : "2px solid transparent",
                  transition: "all 0.1s",
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: col, flexShrink: 0,
                }} />
                <span style={{
                  flex: 1, fontSize: 10, color: isHighlit ? "#e8edf5" : "#7a8499",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {p.camera.model}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); onRemoveCam(p.id); }}
                  title="Remove camera"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "#4a5568", fontSize: 9, padding: "0 2px", flexShrink: 0,
                  }}
                >✕</button>
              </div>
            );
          })}
        </div>
      )}

      {isActive && sidebarExpanded && camsInZone.length === 0 && (
        <div style={{ padding: "3px 10px 6px 18px", fontSize: 10, color: "#4a5568" }}>
          No cameras in zone
        </div>
      )}
    </div>
  );
}

// ── Main DesignerView ─────────────────────────────────────────────────────────
export default function DesignerView({ onBack }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const floorImgRef = useRef(null);
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef(null);
  const panStartRef = useRef(null);
  const draggingIdxRef = useRef(null);
  const rotatingIdxRef = useRef(null);
  const mouseDownPosRef = useRef(null);
  const saveTimerRef = useRef(null);
  const draggingCamZoneRef = useRef(null);

  const [ppm, setPpm] = useState(PIXELS_PER_METRE);
  const ppmRef = useRef(ppm);
  useEffect(() => { ppmRef.current = ppm; }, [ppm]);

  const [placed, setPlaced] = useState([]);
  const placedRef = useRef([]);
  useEffect(() => { placedRef.current = placed; }, [placed]);

  const [zones, setZones] = useState([]);
  const zonesRef = useRef([]);
  const [drawingPoints, setDrawingPoints] = useState([]);
  const drawingPointsRef = useRef([]);
  const [activeZoneId, setActiveZoneId] = useState(null);
  const activeZoneIdRef = useRef(null);

  useEffect(() => { zonesRef.current = zones; }, [zones]);
  useEffect(() => { drawingPointsRef.current = drawingPoints; }, [drawingPoints]);
  useEffect(() => { activeZoneIdRef.current = activeZoneId; }, [activeZoneId]);

  const [showZoneNameModal, setShowZoneNameModal] = useState(false);
  const [pendingZonePoly, setPendingZonePoly] = useState(null);

  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [highlightedCamId, setHighlightedCamId] = useState(null);
  const highlightedCamIdRef = useRef(null);
  useEffect(() => { highlightedCamIdRef.current = highlightedCamId; }, [highlightedCamId]);

  const [showHeatmap, setShowHeatmap] = useState(false);
  const [hasFloor, setHasFloor] = useState(false);
  const [brandFilter, setBrandFilter] = useState(null);
  const [typeFilter, setTypeFilter] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [cameraDB, setCameraDB] = useState([]);
  const cameraDBRef = useRef([]);
  useEffect(() => { cameraDBRef.current = cameraDB; }, [cameraDB]);
  const [brands, setBrands] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [dragCamera, setDragCamera] = useState(null); // eslint-disable-line
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [zoomPct, setZoomPct] = useState(100);
  const [mode, setMode] = useState("place");
  const modeRef = useRef("place");
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef(null);

  // ── Debounced save ────────────────────────────────────────────────────────
  const scheduleSave = useCallback((placedList, zonesList, currentPpm) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      apiSaveLayout({ placed: placedList, zones: zonesList, ppm: currentPpm });
    }, 800);
  }, []);

  // ── Restore layout on mount ───────────────────────────────────────────────
  useEffect(() => {
    apiLoadLayout().then(data => {
      if (!data) return;
      if (data.ppm) setPpm(data.ppm);
      if (data.placed?.length) { placedRef.current = data.placed; setPlaced(data.placed); }
      if (data.zones?.length) { zonesRef.current = data.zones; setZones(data.zones); }
      if (data.floor_plan) {
        const img = new Image();
        img.onload = () => { floorImgRef.current = img; setHasFloor(true); setTimeout(fitImage, 50); };
        img.src = data.floor_plan;
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Camera model fetch ────────────────────────────────────────────────────
  useEffect(() => {
    fetchCameraModels({ brand: brandFilter, type: typeFilter, search: searchQuery })
      .then(data => { setCameraDB(data.cameras); setBrands(data.brands); })
      .catch(() => { });
  }, [brandFilter, typeFilter, searchQuery]);

  useEffect(() => {
    const handleClickOutside = e => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target))
        setShowExportMenu(false);
    };
    if (showExportMenu) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showExportMenu]);

  const filteredCameras = brandFilter ? cameraDB : [];

  // ── Zoom to zone ──────────────────────────────────────────────────────────
  const zoomToZone = useCallback((zone) => {
    const wrap = wrapRef.current; if (!wrap) return;
    const xs = zone.polygon.map(p => p.x), ys = zone.polygon.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const pw = maxX - minX, ph = maxY - minY;
    if (pw < 1 || ph < 1) return;
    const pad = 80;
    const scale = Math.min((W - pad * 2) / pw, (H - pad * 2) / ph, 8);
    scaleRef.current = scale;
    offsetRef.current = { x: W / 2 - ((minX + maxX) / 2) * scale, y: H / 2 - ((minY + maxY) / 2) * scale };
    setZoomPct(Math.round(scale * 100));
  }, []);

  // ── Zoom to a camera ─────────────────────────────────────────────────────
  const zoomToCamera = useCallback((camId) => {
    const cam = placedRef.current.find(p => p.id === camId);
    if (!cam) return;
    const wrap = wrapRef.current; if (!wrap) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const targetScale = Math.max(scaleRef.current, 2);
    scaleRef.current = targetScale;
    offsetRef.current = { x: W / 2 - cam.x * targetScale, y: H / 2 - cam.y * targetScale };
    setZoomPct(Math.round(targetScale * 100));
  }, []);

  // ── Canvas draw ───────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const cvs = canvasRef.current; if (!cvs) return;
    const wrap = cvs.parentElement; if (!wrap) return;
    cvs.width = wrap.clientWidth; cvs.height = wrap.clientHeight;
    const ctx = cvs.getContext("2d");
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    const { x: ox, y: oy } = offsetRef.current;
    const sc = scaleRef.current;
    ctx.save(); ctx.translate(ox, oy); ctx.scale(sc, sc);

    if (floorImgRef.current) ctx.drawImage(floorImgRef.current, 0, 0);
    else {
      ctx.fillStyle = "#0f141c"; ctx.fillRect(0, 0, 2000, 2000);
      ctx.strokeStyle = "#1e2d3e"; ctx.lineWidth = 1;
      for (let gx = 0; gx < 2000; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, 2000); ctx.stroke(); }
      for (let gy = 0; gy < 2000; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(2000, gy); ctx.stroke(); }
      ctx.fillStyle = "#1e2d3e"; ctx.font = "14px monospace"; ctx.textAlign = "center";
      ctx.fillText("Import a floor plan or use the grid", 1000, 1000);
    }

    // ── Ruler ────────────────────────────────────────────────────────────────
    const rulerPx = ppm * 5;
    const rulerY = (floorImgRef.current?.height || 2000) - 24;
    const rulerX = 20;
    ctx.save();
    ctx.fillStyle = "rgba(13,17,23,0.72)"; ctx.fillRect(rulerX - 4, rulerY - 6, rulerPx + 8, 18);
    ctx.strokeStyle = "#3b82f6"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(rulerX, rulerY + 4); ctx.lineTo(rulerX + rulerPx, rulerY + 4);
    ctx.moveTo(rulerX, rulerY); ctx.lineTo(rulerX, rulerY + 8);
    ctx.moveTo(rulerX + rulerPx, rulerY); ctx.lineTo(rulerX + rulerPx, rulerY + 8);
    ctx.stroke();
    ctx.fillStyle = "#3b82f6"; ctx.font = "9px monospace"; ctx.textAlign = "center";
    ctx.fillText("5 m", rulerX + rulerPx / 2, rulerY + 1);
    ctx.restore();

    // ── Zones ────────────────────────────────────────────────────────────────
    zonesRef.current.forEach(zone => {
      if (zone.polygon.length < 2) return;
      const isActive = zone.id === activeZoneIdRef.current;
      ctx.save();
      ctx.beginPath();
      zone.polygon.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.closePath();
      ctx.fillStyle = zone.color + (isActive ? "28" : "14"); ctx.fill();
      ctx.strokeStyle = zone.color + (isActive ? "ff" : "aa");
      ctx.lineWidth = isActive ? 2.5 : 1.5;
      if (!isActive) ctx.setLineDash([6, 4]);
      ctx.stroke(); ctx.setLineDash([]);
      zone.polygon.forEach(p => {
        ctx.beginPath(); ctx.arc(p.x, p.y, isActive ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = zone.color; ctx.globalAlpha = isActive ? 0.9 : 0.5; ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
      });
      // Zone label removed per user request

      ctx.restore();
    });

    // ── Zone drawing in progress ──────────────────────────────────────────────
    if (drawingPointsRef.current.length > 0) {
      ctx.save();
      ctx.beginPath();
      drawingPointsRef.current.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 2; ctx.setLineDash([6, 3]); ctx.stroke(); ctx.setLineDash([]);
      drawingPointsRef.current.forEach((p, i) => {
        ctx.beginPath(); ctx.arc(p.x, p.y, i === 0 ? 7 : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? "#f59e0b" : "#fcd34d"; ctx.fill();
        ctx.strokeStyle = "#fff8"; ctx.lineWidth = 1; ctx.stroke();
      });
      if (drawingPointsRef.current.length >= 3) {
        ctx.beginPath();
        ctx.arc(drawingPointsRef.current[0].x, drawingPointsRef.current[0].y, 12 / sc, 0, Math.PI * 2);
        ctx.strokeStyle = "#f59e0baa"; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // ── Placed cameras ────────────────────────────────────────────────────────
    placedRef.current.forEach((p, i) => {
        drawPlacedCamera(
          ctx, p, ppm,
          i === hoveredIdx,
          i === selectedIdx,
          zonesRef,
          activeZoneIdRef,
          highlightedCamIdRef.current,
          false
        );
    });

    // ── Rotation handle for selected camera ───────────────────────────────────
    if (selectedIdx !== null && selectedIdx < placedRef.current.length) {
      const p = placedRef.current[selectedIdx];
      const { angle } = fovDrawParams(p.camera, p.direction);
      const hx = p.x + Math.cos(angle) * 30;
      const hy = p.y + Math.sin(angle) * 30;
      ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.fillStyle = TYPE_COLORS[p.camera.type] || "#3b82f6"; ctx.fill();
      ctx.strokeStyle = "#fff8"; ctx.lineWidth = 1.2; ctx.stroke();
    }

    ctx.restore();
  }, [ppm, hoveredIdx, selectedIdx]);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw, placed, zones, drawingPoints, activeZoneId, highlightedCamId]);

  useEffect(() => {
    const obs = new ResizeObserver(draw);
    const el = canvasRef.current?.parentElement;
    if (el) obs.observe(el);
    return () => obs.disconnect();
  }, [draw]);

  const fitImage = useCallback(() => {
    const wrap = wrapRef.current; const img = floorImgRef.current;
    if (!wrap || !img) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const s = Math.min(W / img.width, H / img.height) * 0.9;
    scaleRef.current = s;
    offsetRef.current = { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2 };
    setZoomPct(Math.round(s * 100)); draw();
  }, [draw]);

  const applyZoom = useCallback((delta, cx, cy) => {
    const prev = scaleRef.current;
    const next = Math.min(8, Math.max(0.08, prev + delta));
    scaleRef.current = next;
    offsetRef.current = {
      x: cx - (cx - offsetRef.current.x) * (next / prev),
      y: cy - (cy - offsetRef.current.y) * (next / prev),
    };
    setZoomPct(Math.round(next * 100)); draw();
  }, [draw]);

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

  function toImg(ex, ey) {
    const el = wrapRef.current; if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: (ex - r.left - offsetRef.current.x) / scaleRef.current,
      y: (ey - r.top - offsetRef.current.y) / scaleRef.current,
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
    const hx = p.x + Math.cos(angle) * 30;
    const hy = p.y + Math.sin(angle) * 30;
    return Math.hypot(ix - hx, iy - hy) < 12 / scaleRef.current;
  }

  const finishZoneDrawing = useCallback((points) => {
    setPendingZonePoly(points);
    setShowZoneNameModal(true);
  }, []);

  function saveZone(name) {
    const points = pendingZonePoly;
    const colorIdx = zonesRef.current.length % ZONE_COLORS.length;
    const newZone = { id: "zone_" + Date.now(), name, polygon: points, color: ZONE_COLORS[colorIdx] };
    const updated = [...zonesRef.current, newZone];
    zonesRef.current = updated;
    setZones(updated);
    setActiveZoneId(newZone.id);
    activeZoneIdRef.current = newZone.id;
    drawingPointsRef.current = []; setDrawingPoints([]); setMode("place");
    setPendingZonePoly(null);
    setShowZoneNameModal(false);
    setTimeout(() => zoomToZone(newZone), 0);
    apiSaveZones(updated);
  }

  function cancelZoneDrawing() {
    drawingPointsRef.current = [];
    setDrawingPoints([]);
    setPendingZonePoly(null);
    setShowZoneNameModal(false);
    setMode("place");
  }

  // ── Mouse events ──────────────────────────────────────────────────────────
  const onMouseDown = useCallback(e => {
    if (e.button === 2) return;
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    const p = toImg(e.clientX, e.clientY);

    if (modeRef.current === "zone") {
      const pts = drawingPointsRef.current;
      if (pts.length >= 3 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) < 20 / scaleRef.current) {
        finishZoneDrawing(pts); return;
      }
      const updated = [...pts, p];
      drawingPointsRef.current = updated; setDrawingPoints(updated); draw(); return;
    }

    if (modeRef.current === "pan") {
      panStartRef.current = { mx: e.clientX - offsetRef.current.x, my: e.clientY - offsetRef.current.y };
      return;
    }

    if (nearRotHandle(p.x, p.y)) { rotatingIdxRef.current = selectedIdx; return; }

    const idx = nearestPlaced(p.x, p.y);
    if (idx >= 0) {
      setSelectedIdx(idx);
      draggingIdxRef.current = idx;
      const cam = placedRef.current[idx];
      draggingCamZoneRef.current = zonesRef.current.find(
        z => z.polygon?.length >= 3 && pointInPolygon(cam.x, cam.y, z.polygon)
      ) || null;
      return;
    }
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
      placedRef.current = updated; setPlaced([...updated]); draw(); return;
    }

    if (draggingIdxRef.current !== null) {
      const activeZone = activeZoneIdRef.current
        ? zonesRef.current.find(z => z.id === activeZoneIdRef.current)
        : null;
      const constraintZone = activeZone || draggingCamZoneRef.current;

      if (constraintZone && constraintZone.polygon.length >= 3) {
        if (!pointInPolygon(p.x, p.y, constraintZone.polygon)) return;
      }

      const updated = [...placedRef.current];
      updated[draggingIdxRef.current] = { ...updated[draggingIdxRef.current], x: p.x, y: p.y };
      placedRef.current = updated; setPlaced([...updated]); draw(); return;
    }

    const idx = nearestPlaced(p.x, p.y);
    if (idx !== hoveredIdx) { setHoveredIdx(idx >= 0 ? idx : null); draw(); }
  }, [draw, hoveredIdx]); // eslint-disable-line

  const onMouseUp = useCallback(() => {
    const wasDragging = draggingIdxRef.current !== null;
    const wasRotating = rotatingIdxRef.current !== null;
    draggingIdxRef.current = null;
    rotatingIdxRef.current = null;
    panStartRef.current = null;
    mouseDownPosRef.current = null;
    draggingCamZoneRef.current = null;
    if (wasDragging || wasRotating) {
      scheduleSave(placedRef.current, zonesRef.current, ppmRef.current);
    }
  }, [scheduleSave]);

  // ── Drag-and-drop onto canvas ─────────────────────────────────────────────
  const onDrop = useCallback(e => {
    e.preventDefault();
    const cameraId = e.dataTransfer.getData("cameraId");
    const camera = cameraDBRef.current.find(c => c.id === cameraId);
    if (!camera) return;
    const p = toImg(e.clientX, e.clientY);

    if (activeZoneIdRef.current) {
      const zone = zonesRef.current.find(z => z.id === activeZoneIdRef.current);
      if (zone && zone.polygon.length >= 3 && !pointInPolygon(p.x, p.y, zone.polygon)) {
        alert(`Camera must be placed inside zone "${zone.name}"`);
        return;
      }
    }

    const newEntry = { camera, x: p.x, y: p.y, direction: 0, id: `placed_${Date.now()}` };
    const updated = [...placedRef.current, newEntry];
    placedRef.current = updated;
    setPlaced(updated);
    setSelectedIdx(updated.length - 1);
    draw();
    apiSaveLayout({ placed: updated, zones: zonesRef.current, ppm: ppmRef.current });
  }, [draw]); // eslint-disable-line

  // ── Floor plan import ─────────────────────────────────────────────────────
  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => { floorImgRef.current = img; setHasFloor(true); fitImage(); apiSaveFloorPlan(ev.target.result); };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  // ── FIX 2: Remove floor plan — clears image and deletes from backend ──────
  function removeFloorPlan() {
    floorImgRef.current = null;
    setHasFloor(false);
    draw();
    apiDeleteFloorPlan();
  }

  function removeSelected() {
    if (selectedIdx === null) return;
    const updated = placedRef.current.filter((_, i) => i !== selectedIdx);
    placedRef.current = updated; setPlaced(updated); setSelectedIdx(null); draw();
    apiSaveLayout({ placed: updated, zones: zonesRef.current, ppm: ppmRef.current });
  }

  // ── Zone sidebar handlers ─────────────────────────────────────────────────
  function handleSelectZone(zone) {
    const newId = activeZoneId === zone.id ? null : zone.id;
    setActiveZoneId(newId);
    activeZoneIdRef.current = newId;
    setHighlightedCamId(null);
    if (newId) {
      zoomToZone(zone);
    }
    draw();
  }

  function handleDeleteZone(id) {
    const updated = zonesRef.current.filter(z => z.id !== id);
    zonesRef.current = updated; setZones(updated);
    if (activeZoneId === id) { setActiveZoneId(null); activeZoneIdRef.current = null; }
    draw();
    apiDeleteZone(id);
  }

  function handleHighlightCam(camId) {
    const newId = highlightedCamId === camId ? null : camId;
    setHighlightedCamId(newId);
    highlightedCamIdRef.current = newId;
    if (newId) zoomToCamera(newId);
    draw();
  }

  function handleRemoveCamFromZone(camId) {
    const updated = placedRef.current.filter(p => p.id !== camId);
    placedRef.current = updated; setPlaced(updated);
    if (highlightedCamId === camId) { setHighlightedCamId(null); highlightedCamIdRef.current = null; }
    if (selectedIdx !== null) setSelectedIdx(null);
    draw();
    apiSaveLayout({ placed: updated, zones: zonesRef.current, ppm: ppmRef.current });
  }

  // ── Heatmap helpers ───────────────────────────────────────────────────────
  const heatmapMarkers = placed.map(p => ({ camId: p.id, x: p.x, y: p.y, fovAngle: p.camera.hfov, direction: p.direction }));
  const heatmapCameras = placed.map(p => ({ id: p.id, status: "online" }));


  function exportPng(exportMode = "design") {
    const img = floorImgRef.current; if (!img) return;
    const oc = document.createElement("canvas");
    oc.width = img.width; oc.height = img.height;
    const ctx = oc.getContext("2d");
    ctx.drawImage(img, 0, 0);
    if (exportMode === "design") {
      zonesRef.current.forEach(zone => {
        if (zone.polygon.length < 2) return;
        ctx.save(); ctx.beginPath();
        zone.polygon.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
        ctx.closePath();
        ctx.fillStyle = zone.color + "22"; ctx.fill();
        ctx.strokeStyle = zone.color; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      });
      placedRef.current.forEach(p => drawPlacedCamera(ctx, p, ppm, false, false, zonesRef, activeZoneIdRef, null, false));
      drawDesignLegendToCanvas(ctx, oc.width, oc.height, { placedCameras: placedRef.current, compact: true });
    } else if (exportMode === "heatmap") {
      const hcvs = document.createElement("canvas");
      hcvs.width = oc.width; hcvs.height = oc.height;
      const hctx = hcvs.getContext("2d");
      const foundLevels = drawHeatmapToContext(hctx, hcvs.width, hcvs.height, {
        markers: heatmapMarkers, cameras: heatmapCameras, scale: 1,
        offset: { x: 0, y: 0 }, activeZone: zones.find(z => z.id === activeZoneId) || null,
        allZones: zones,
        floorImg: img, step: 2, clear: true,
      });
      ctx.globalAlpha = 0.85; ctx.drawImage(hcvs, 0, 0); ctx.globalAlpha = 1.0;
      zonesRef.current.forEach(zone => {
        if (zone.polygon.length < 2) return;
        ctx.save(); ctx.beginPath();
        zone.polygon.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
        ctx.closePath();
        ctx.strokeStyle = zone.color; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.restore();
      });
      placedRef.current.forEach(p => drawPlacedCamera(ctx, p, ppm, false, false, zonesRef, activeZoneIdRef, null, false));
      drawHeatmapLegendToCanvas(ctx, oc.width, oc.height, { foundLevels, compact: true });
    }
    const a = document.createElement("a");
    a.download = exportMode === "heatmap" ? "coverage_heatmap.png" : "designer_layout.png";
    a.href = oc.toDataURL("image/png");
    a.click();
    setShowExportMenu(false);
  }

  useEffect(() => {
    const h = e => {
      if (e.key === "Escape" && modeRef.current === "zone") {
        drawingPointsRef.current = []; setDrawingPoints([]); setMode("place"); draw();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [draw]);

  const selectedPlaced = selectedIdx !== null ? placed[selectedIdx] : null;
  const activeZone = zones.find(z => z.id === activeZoneId) || null;

  // ── Sidebar styles ────────────────────────────────────────────────────────
  const sidebarStyles = {
    sidebar: {
      position: "relative",
      width: sidebarExpanded ? 168 : 36,
      minWidth: sidebarExpanded ? 168 : 36,
      background: "#0d1117",
      borderRight: "0.5px solid #1e2d3e",
      display: "flex",
      flexDirection: "column",
      transition: "width 0.2s ease, min-width 0.2s ease",
      overflow: "hidden",
      flexShrink: 0,
      zIndex: 10,
    },
    head: {
      display: "flex", alignItems: "center", gap: 6,
      padding: "10px 8px 8px",
      borderBottom: "0.5px solid #1e2d3e",
      whiteSpace: "nowrap",
    },
    list: {
      flex: 1, overflowY: "auto", overflowX: "hidden",
      padding: "6px 4px",
    },
    sectionLabel: {
      fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
      textTransform: "uppercase", color: "#4a5568",
      padding: "6px 6px 4px",
      whiteSpace: "nowrap",
      display: sidebarExpanded ? "block" : "none",
    },
    addBtn: {
      display: "flex", alignItems: "center", gap: 6,
      width: "100%", background: "none", border: "none",
      padding: "5px 6px", cursor: "pointer",
      color: "#3b82f6", fontSize: 11, textAlign: "left",
      borderRadius: 4,
      whiteSpace: "nowrap",
    },
    divider: {
      height: "0.5px", background: "#1e2d3e", margin: "6px 4px",
    },
  };

  return (
    <div className="dv-root">

      {/* ── Top bar ── */}
      <div className="dv-topbar">
        <button className="dv-back-btn" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Map View
        </button>
        <div className="dv-topbar__title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="15" height="15">
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
            <circle cx="15" cy="15" r="2" />
          </svg>
          Designer View
        </div>
        <div className="dv-topbar__actions">
          <div className="dv-scale-control">
            <label>Scale</label>
            <input type="number" min="4" max="100" value={ppm}
              onChange={e => setPpm(Number(e.target.value) || PIXELS_PER_METRE)} />
            <span>px/m</span>
          </div>
          <div className="dv-sep" />

          <button className={`dv-tbtn ${mode === "place" ? "dv-tbtn--active" : ""}`} onClick={() => setMode("place")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12">
              <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" strokeDasharray="2 3" />
            </svg>
            Place
          </button>
          <button className={`dv-tbtn ${mode === "pan" ? "dv-tbtn--active" : ""}`} onClick={() => setMode("pan")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12">
              <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M12 3v18M3 12h18" />
            </svg>
            Pan
          </button>
          <button
            className={`dv-tbtn ${mode === "zone" ? "dv-tbtn--active dv-tbtn--zone" : ""}`}
            onClick={() => { setMode("zone"); drawingPointsRef.current = []; setDrawingPoints([]); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12">
              <polygon points="3,20 12,4 21,20" />
              <circle cx="3" cy="20" r="1.5" fill="currentColor" />
              <circle cx="12" cy="4" r="1.5" fill="currentColor" />
              <circle cx="21" cy="20" r="1.5" fill="currentColor" />
            </svg>
            Draw Zone
          </button>
          {mode === "zone" && (
            <span className="dv-zone-hint">
              {drawingPoints.length === 0
                ? "Click to place first point"
                : drawingPoints.length < 3
                  ? `${drawingPoints.length} pt${drawingPoints.length > 1 ? "s" : ""} — need ≥3`
                  : "Click first point to close · Esc to cancel"}
            </span>
          )}

          <button
            className={`dv-tbtn ${showHeatmap ? "dv-tbtn--active dv-tbtn--heatmap" : ""}`}
            onClick={() => setShowHeatmap(v => !v)}
            disabled={placed.length === 0}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            Heatmap
          </button>
          <div className="dv-sep" />

          <button className="dv-tbtn" onClick={() => fileInputRef.current?.click()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            Import Floor Plan
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileChange} />

          {selectedPlaced && (
            <button className="dv-tbtn dv-tbtn--danger" onClick={removeSelected}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
              </svg>
              Remove
            </button>
          )}

          <div className="dv-export-group" ref={exportMenuRef}>
            <button
              className={`dv-tbtn dv-tbtn--export ${showExportMenu ? "dv-tbtn--active" : ""}`}
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={placed.length === 0}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Export PNG
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10" style={{ marginLeft: 2, opacity: 0.6 }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showExportMenu && (
              <div className="dv-export-menu">
                <button className="dv-export-item" onClick={() => exportPng("design")}>
                  <div className="dv-export-item__icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <path d="M3 9h18M9 21V9" /><rect x="3" y="3" width="18" height="18" rx="2" />
                    </svg>
                  </div>
                  <div className="dv-export-item__label">
                    <span>Download Design View</span>
                    <small>Layout with cameras &amp; zones</small>
                  </div>
                </button>
                <button className="dv-export-item" onClick={() => exportPng("heatmap")}>
                  <div className="dv-export-item__icon dv-export-item__icon--heatmap">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                    </svg>
                  </div>
                  <div className="dv-export-item__label">
                    <span>Download Heatmap</span>
                    <small>Coverage intensity map</small>
                  </div>
                </button>
              </div>
            )}
          </div>
          <div className="dv-sep" />
          <button className="dv-zbtn" onClick={() => { const el = wrapRef.current; if (el) applyZoom(-0.2, el.clientWidth / 2, el.clientHeight / 2); }}>−</button>
          <span className="dv-zoom-label">{zoomPct}%</span>
          <button className="dv-zbtn" onClick={() => { const el = wrapRef.current; if (el) applyZoom(0.2, el.clientWidth / 2, el.clientHeight / 2); }}>+</button>
          <button className="dv-zbtn dv-zbtn--fit" onClick={fitImage}>Fit</button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="dv-body">

        {/* ══════════════════════════════════════════════════════════════
            ZONE SIDEBAR
        ══════════════════════════════════════════════════════════════ */}
        <div
          style={sidebarStyles.sidebar}
          onMouseEnter={() => setSidebarExpanded(true)}
          onMouseLeave={() => setSidebarExpanded(false)}
        >
          {/* Header */}
          <div style={sidebarStyles.head}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8" width="15" height="15" style={{ flexShrink: 0 }}>
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
              <line x1="8" y1="2" x2="8" y2="18" />
              <line x1="16" y1="6" x2="16" y2="22" />
            </svg>
            {sidebarExpanded && (
              <span style={{ fontSize: 11, fontWeight: 600, color: "#7a8499", whiteSpace: "nowrap" }}>
                Zones
              </span>
            )}
          </div>

          {/* Zone list */}
          <div style={sidebarStyles.list}>

            {/* ── FIX 2: Floor plan row at top of sidebar ────────────────── */}
            <div style={{
              borderLeft: hasFloor ? "2.5px solid #3b82f6" : "2.5px solid #1e2d3e",
              background: hasFloor ? "#3b82f611" : "transparent",
              borderRadius: 5,
              marginBottom: 2,
              transition: "all 0.15s",
            }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 6px",
              }}>
                {/* floor plan icon */}
                <svg
                  viewBox="0 0 24 24" fill="none"
                  stroke={hasFloor ? "#3b82f6" : "#4a5568"}
                  strokeWidth="1.8" width="10" height="10"
                  style={{ flexShrink: 0 }}
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M9 21V9" />
                </svg>

                {sidebarExpanded && (
                  <span style={{
                    flex: 1,
                    fontSize: 11,
                    color: hasFloor ? "#c9d1d9" : "#4a5568",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    Floor 1
                  </span>
                )}

                {/* ✕ to remove floor plan image */}
                {sidebarExpanded && hasFloor && (
                  <span
                    onClick={removeFloorPlan}
                    title="Remove floor plan image"
                    style={{
                      fontSize: 9, color: "#4a5568", cursor: "pointer",
                      padding: "0 2px", flexShrink: 0,
                      transition: "color 0.1s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                    onMouseLeave={e => e.currentTarget.style.color = "#4a5568"}
                  >✕</span>
                )}

                {/* + to upload if no floor plan */}
                {sidebarExpanded && !hasFloor && (
                  <span
                    onClick={() => fileInputRef.current?.click()}
                    title="Upload floor plan"
                    style={{
                      fontSize: 12, color: "#3b82f6", cursor: "pointer",
                      padding: "0 2px", flexShrink: 0, lineHeight: 1,
                    }}
                  >+</span>
                )}
              </div>
            </div>

            <div style={sidebarStyles.divider} />

            {/* ── Section label: Zones ─────────────────────────────────── */}
            {sidebarExpanded && (
              <div style={sidebarStyles.sectionLabel}>Zones</div>
            )}

            {zones.length === 0 && sidebarExpanded && (
              <div style={{ padding: "10px 8px", fontSize: 10, color: "#4a5568", textAlign: "center" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" width="22" height="22" style={{ opacity: 0.25, display: "block", margin: "0 auto 6px" }}>
                  <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                </svg>
                No zones yet
              </div>
            )}

            {zones.map(zone => (
              <DvZoneSidebarItem
                key={zone.id}
                zone={zone}
                placed={placed}
                isActive={activeZoneId === zone.id}
                highlightedId={highlightedCamId}
                onSelect={handleSelectZone}
                onDelete={handleDeleteZone}
                onHighlightCam={handleHighlightCam}
                onRemoveCam={handleRemoveCamFromZone}
                sidebarExpanded={sidebarExpanded}
              />
            ))}

            {/* Create Zone button */}
            <button
              style={sidebarStyles.addBtn}
              onClick={() => { setMode("zone"); drawingPointsRef.current = []; setDrawingPoints([]); }}
              title="Draw a new zone"
            >
              <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>+</span>
              {sidebarExpanded && <span>Create Zone</span>}
            </button>

            {/* Active zone hint */}
            {activeZone && sidebarExpanded && (
              <div style={{
                margin: "6px 4px 0",
                padding: "6px 8px",
                background: activeZone.color + "14",
                border: `0.5px solid ${activeZone.color}44`,
                borderRadius: 5,
                fontSize: 10,
                color: activeZone.color,
                lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>Active: {activeZone.name}</div>
                <div style={{ color: "#7a8499" }}>Cameras will be constrained to this zone.</div>
                <button
                  onClick={() => { setActiveZoneId(null); activeZoneIdRef.current = null; }}
                  style={{
                    marginTop: 4, background: "none", border: `0.5px solid ${activeZone.color}55`,
                    borderRadius: 3, color: activeZone.color, cursor: "pointer",
                    fontSize: 9, padding: "2px 6px",
                  }}
                >
                  Deselect
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Camera Library (left panel) ── */}
        <div className="dv-library">
          <div className="dv-library__head">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13">
              <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
            </svg>
            Camera Library
            <span className="dv-library__count">{filteredCameras.length}</span>
          </div>

          <div className="dv-library__filters">
            <input className="dv-search" placeholder="Search models…"
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            <div className="dv-filter-row">
              <select className="dv-select" value={brandFilter || ""} onChange={e => setBrandFilter(e.target.value || null)}>
                <option value="">-- Brand --</option>
                {brands.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <select className="dv-select" value={typeFilter || ""} onChange={e => setTypeFilter(e.target.value || null)}>
                <option value="">-- Type --</option>
                {["dome", "bullet", "ptz", "fisheye", "box", "turret"].map(t => (
                  <option key={t} value={t}>{TYPE_ICONS[t]} {t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="dv-type-pills">
            {["dome", "bullet", "ptz", "fisheye"].map(t => (
              <button key={t}
                className={`dv-type-pill ${typeFilter === t ? "dv-type-pill--active" : ""}`}
                style={typeFilter === t ? { background: TYPE_COLORS[t] + "22", borderColor: TYPE_COLORS[t], color: TYPE_COLORS[t] } : {}}
                onClick={() => setTypeFilter(prev => prev === t ? null : t)}>
                {`${TYPE_ICONS[t]} ${t}`}
              </button>
            ))}
          </div>

          <div className="dv-model-list">
            {filteredCameras.length === 0 && (
              <div className="dv-model-empty">
                {brandFilter ? "No cameras match your filters." : "Please select a brand to view available camera models."}
              </div>
            )}
            {filteredCameras.map(cam => (
              <ModelCard key={cam.id} camera={cam}
                onDragStart={setDragCamera}
                onSelect={c => setSelectedModel(prev => prev?.id === c.id ? null : c)}
                isSelected={selectedModel?.id === cam.id}
              />
            ))}
          </div>

          {selectedModel && (
            <div className="dv-cam-chip"
              style={{ "--chip-col": TYPE_COLORS[selectedModel.type] || "#3b82f6", margin: "6px 10px 0" }}>
              <CameraIcon type={selectedModel.type} size={15} color={TYPE_COLORS[selectedModel.type]} />
              <div className="dv-cam-chip__info">
                <span className="dv-cam-chip__name">{selectedModel.model}</span>
                <span className="dv-cam-chip__meta">
                  {selectedModel.hfov}° HFOV · {selectedModel.rangeDay}m · {selectedModel.megapixels}MP
                </span>
              </div>
              <button className="dv-cam-chip__view" onClick={() => setSelectedModel(null)}>✕</button>
            </div>
          )}

          {!selectedModel && (
            <div className="dv-cam-selector__hint dv-cam-selector__hint--empty"
              style={{ padding: "6px 10px 8px", borderTop: "1px solid #1e2d3e", marginTop: 4 }}>
              Drag a card onto the canvas to place · Click to preview FOV
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
                const camZone = zones.find(z => z.polygon.length >= 3 && pointInPolygon(p.x, p.y, z.polygon));
                return (
                  <div key={p.id}
                    className={`dv-placed-item ${selectedIdx === i ? "dv-placed-item--active" : ""}`}
                    onClick={() => setSelectedIdx(i)}
                    style={{ "--col": col }}
                  >
                    <CameraIcon type={p.camera.type} size={14} color={col} />
                    <span style={{ flex: 1 }}>{p.camera.model}</span>
                    {camZone && (
                      <span style={{ fontSize: 9, color: camZone.color, marginRight: 4 }}>
                        ● {camZone.name}
                      </span>
                    )}
                    <span className="dv-placed-item__dir">{Math.round(p.direction)}°</span>
                    <button onClick={e => {
                      e.stopPropagation();
                      const u = placed.filter((_, j) => j !== i);
                      placedRef.current = u; setPlaced(u);
                      if (selectedIdx === i) setSelectedIdx(null); draw();
                      apiSaveLayout({ placed: u, zones: zonesRef.current, ppm: ppmRef.current });
                    }}>✕</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Canvas ── */}
        <div className="dv-canvas-wrap" ref={wrapRef}
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
        >
          <canvas ref={canvasRef} className="dv-canvas"
            style={{ cursor: mode === "pan" ? "grab" : "crosshair" }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />

          <HeatmapLayer
            // isDesignerView={true} 
            markers={heatmapMarkers}
            cameras={heatmapCameras}
            scaleRef={scaleRef}
            offsetRef={offsetRef}
            wrapRef={wrapRef}
            showHeatmap={showHeatmap}
            floorImgRef={floorImgRef}
            activeZone={activeZone}
            zones={zones}
          />

          {placed.length === 0 && mode !== "zone" && (
            <div className="dv-drop-hint">
              <div className="dv-drop-hint__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="48" height="48">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 8v-2M12 18v-2M8 12H6M18 12h-2" />
                </svg>
              </div>
              <p>Drag a camera model from the library onto the floor plan</p>
              <p className="dv-drop-hint__sub">or import a floor plan first</p>
            </div>
          )}

          {mode === "zone" && drawingPoints.length === 0 && (
            <div className="dv-drop-hint">
              <div className="dv-drop-hint__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1" width="48" height="48">
                  <polygon points="3,20 12,4 21,20" />
                  <circle cx="3" cy="20" r="1.5" fill="#f59e0b" />
                  <circle cx="12" cy="4" r="1.5" fill="#f59e0b" />
                  <circle cx="21" cy="20" r="1.5" fill="#f59e0b" />
                </svg>
              </div>
              <p style={{ color: "#f59e0b" }}>Click on the canvas to place zone vertices</p>
              <p className="dv-drop-hint__sub">Click the first point again to close · Press Esc to cancel</p>
            </div>
          )}

          {selectedPlaced && (
            <div className="dv-selected-bar">
              <CameraIcon type={selectedPlaced.camera.type} size={16} color={TYPE_COLORS[selectedPlaced.camera.type]} />
              <strong>{selectedPlaced.camera.brand} {selectedPlaced.camera.model}</strong>
              <span className="dv-sep-txt">·</span>
              <span>HFOV {selectedPlaced.camera.hfov}°</span>
              <span className="dv-sep-txt">·</span>
              <span>Range {selectedPlaced.camera.rangeDay} m</span>
              <span className="dv-sep-txt">·</span>
              <span>Dir {Math.round(selectedPlaced.direction)}°</span>
              {(() => {
                const cz = zones.find(z => z.polygon.length >= 3 && pointInPolygon(selectedPlaced.x, selectedPlaced.y, z.polygon));
                return cz ? (
                  <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 7px", borderRadius: 10, background: cz.color + "22", color: cz.color, border: `0.5px solid ${cz.color}55` }}>
                    ● {cz.name}
                  </span>
                ) : null;
              })()}
              <span className="dv-selected-bar__hint">Drag handle to rotate · Drag body to move</span>
            </div>
          )}
        </div>

        {/* ── Spec detail panel ── */}
        {selectedModel && (
          <div style={{ display: "flex", flexDirection: "column", width: 258, borderLeft: "0.5px solid #1e2d3e", background: "#0d1117", flexShrink: 0 }}>
            <SpecPanel camera={selectedModel} onClose={() => setSelectedModel(null)} />
            <div className="dv-fov-overlay-panel">
              <div className="dv-fov-overlay__label">{selectedModel.model}</div>
              <FovVisualizer camera={selectedModel} />
            </div>
          </div>
        )}
      </div>

      {showZoneNameModal && (
        <ZoneNameModal
          onSave={saveZone}
          onCancel={cancelZoneDrawing}
          existingNames={zones.map(z => z.name)}
        />
      )}
    </div>
  );
}

// ── Zone Name Modal (copied from MapViewPage) ─────────────────────────
function ZoneNameModal({ onSave, onCancel, existingNames }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { setErr("Zone name is required."); return; }
    if (existingNames.includes(trimmed)) { setErr("A zone with this name already exists."); return; }
    onSave(trimmed);
  }

  return (
    <div className="mv-stream-overlay" onClick={onCancel}>
      <div className="mv-zone-name-modal" onClick={e => e.stopPropagation()}>
        <div className="mv-zone-name-modal__header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
            <line x1="8" y1="2" x2="8" y2="18" />
            <line x1="16" y1="6" x2="16" y2="22" />
          </svg>
          <span>Name this Zone</span>
        </div>
        <p className="mv-zone-name-modal__sub">
          Give your drawn zone a name. Cameras placed inside it will be associated with this zone.
        </p>
        <input
          ref={inputRef}
          className={`mv-zone-name-input ${err ? "mv-zone-name-input--err" : ""}`}
          placeholder="e.g. Lobby, Warehouse A, Parking Lot…"
          value={name}
          onChange={e => { setName(e.target.value); setErr(""); }}
          onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }}
          maxLength={40}
        />
        {err && <p className="mv-zone-name-err">{err}</p>}
        <div className="mv-zone-name-modal__row">
          <button className="mv-modal__btn mv-modal__btn--cancel" onClick={onCancel}>Cancel</button>
          <button className="mv-modal__btn mv-modal__btn--confirm" onClick={handleSave}>Save Zone</button>
        </div>
      </div>
    </div>
  );
}
