import React, { useState, useEffect, useRef, useCallback } from "react";
import "./DesignerView.css";
import { fovDrawParams } from "./CameraModelDB";
import { drawHeatmapToContext, drawHeatmapLegendToCanvas, drawDesignLegendToCanvas, drawDoriLegendToCanvas } from "./HeatmapLogic";
import HeatmapLayer from "./HeatmapLayer";
import * as CctvCalc from "./CctvCalculators";
import { drawStorageReport } from "./ReportLogic.js";
import logoImg from "../../assets/logo.jpg";
import * as pdfjsLib from "pdfjs-dist";
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

// ── Constants ─────────────────────────────────────────────────────────────────
const API = import.meta.env.VITE_API_URL || "http://192.168.126.38:80";
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
  if (!floorPlanDataUrl) return;
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
  dome: "⊙", bullet: "▶", ptz: "↻", fisheye: "◎", box: "▪", thermal: "🌡",
};
const TYPE_COLORS = {
  dome: "#3b82f6", bullet: "#f59e0b", ptz: "#8b5cf6",
  fisheye: "#10b981", box: "#f97316", thermal: "#ef4444",

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

// ── Point-in-polygon or close-to-edge/vertex helper (Boundary matching) ────────
function pointInOrOnPolygon(px, py, polygon) {
  if (!polygon || polygon.length < 3) return false;
  if (pointInPolygon(px, py, polygon)) return true;
  for (let i = 0; i < polygon.length; i++) {
    if (Math.hypot(px - polygon[i].x, py - polygon[i].y) < 3) return true;
  }
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const x1 = polygon[i].x, y1 = polygon[i].y;
    const x2 = polygon[j].x, y2 = polygon[j].y;
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;
    let xx, yy;
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }
    const dist = Math.hypot(px - xx, py - yy);
    if (dist < 3) return true;
  }
  return false;
}


// ── Shoelace formula for polygon area (in square meters) ──────────────────────
function getPolygonArea(polygon, ppm) {
  if (!polygon || polygon.length < 3) return 0;
  let areaPx = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    areaPx += polygon[i].x * polygon[j].y;
    areaPx -= polygon[j].x * polygon[i].y;
  }
  areaPx = Math.abs(areaPx) / 2;
  return areaPx / (ppm * ppm);
}

// ── Premium Popup Component ─────────────────────────────────────────────
function PremiumPopup({ show, type, title, message, onConfirm, onCancel }) {
  if (!show) return null;
  return (
    <div className="mv-stream-overlay" style={{ zIndex: 99999 }}>
      <div className="mv-zone-name-modal" style={{ maxWidth: 400, border: "1px solid #2e3d55", background: "#0d1117ee", backdropFilter: "blur(8px)" }}>
        <div className="mv-zone-name-modal__header" style={{ color: type === "confirm" ? "#3b82f6" : "#f59e0b" }}>
          {type === "confirm" ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <circle cx="12" cy="12" r="10" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
          <span style={{ fontWeight: 700, fontSize: 18 }}>{title}</span>
        </div>
        <p className="mv-zone-name-modal__sub" style={{ color: "#e8edf5", fontSize: 17, marginTop: 8, marginBottom: 20 }}>
          {message}
        </p>
        <div className="mv-zone-name-modal__row" style={{ justifyContent: "flex-end", gap: 10 }}>
          {type === "confirm" && (
            <button className="mv-modal__btn mv-modal__btn--cancel" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button className="mv-modal__btn mv-modal__btn--confirm" style={{ background: type === "confirm" ? "#3b82f6" : "#1D9E75", borderColor: type === "confirm" ? "#3b82f6" : "#1D9E75" }} onClick={onConfirm}>
            {type === "confirm" ? "Confirm" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Automation Modal Component ──────────────────────────────────────────
// ── Automation Modal Component ──────────────────────────────────────────
function AutomationModal({ zone, ppm, cameraDB, getCameraForType, onConfirm, onCancel }) {
  const [selectedTypes, setSelectedTypes] = useState(["dome"]);
  
  // Dynamic parsing of number from zone name, or fallback to Shoelace
  const [areaSqFtVal, setAreaSqFtVal] = useState(() => {
    const match = zone.name.match(/\d+[,.\d]*/);
    if (match) {
      return match[0];
    }
    const areaSqm = getPolygonArea(zone.polygon, ppm);
    return Math.round(areaSqm * 10.7639).toString();
  });

  const parsedAreaSqm = (parseFloat(areaSqFtVal.replace(/,/g, '')) / 10.7639) || 0;

  // Extract actual unique types present in cameraDB
  const uniqueTypesInDB = [...new Set(cameraDB.map(c => c.type))].filter(Boolean);
  
  const typeLabels = {
    dome: "Dome Camera",
    bullet: "Bullet Camera",
    ptz: "PTZ (Pan-Tilt-Zoom)",
    fisheye: "Fisheye (360°)",
    box: "Box Camera",
    thermal: "Thermal Camera"
  };

  const cameraTypes = uniqueTypesInDB.map(type => ({
    type,
    label: typeLabels[type] || (type.charAt(0).toUpperCase() + type.slice(1) + " Camera")
  }));

  // State to hold the specific user-selected model for each camera type
  const [selectedModels, setSelectedModels] = useState(() => {
    const initial = {};
    uniqueTypesInDB.forEach(t => {
      initial[t] = getCameraForType(t);
    });
    return initial;
  });

  const handleToggleType = (type) => {
    setSelectedTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const handleSubmit = () => {
    if (selectedTypes.length === 0) {
      alert("Please select at least one camera type.");
      return;
    }
    const chosenModels = selectedTypes.map(type => selectedModels[type]).filter(Boolean);
    onConfirm(chosenModels);
  };

  return (
    <div className="mv-stream-overlay" onClick={onCancel}>
      <div className="mv-zone-name-modal mv-modal--config" onClick={e => e.stopPropagation()}>
        <div className="mv-zone-name-modal__header">
          <svg viewBox="0 0 24 24" fill="none" stroke="#1D9E75" strokeWidth="2" width="20" height="20">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
          <span>Automated Camera Coverage</span>
        </div>
        <p className="mv-zone-name-modal__sub" style={{ marginBottom: 12 }}>
          Automatically place and align cameras to ensure **no blind spots** in **{zone.name}**.
        </p>

        <div style={{
          background: "#0d1117",
          border: "0.5px solid #2e3d55",
          borderRadius: 8,
          padding: "10px 12px",
          marginBottom: 16,
          fontSize: 16,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>Zone Area (sq. ft.):</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="text"
                value={areaSqFtVal}
                onChange={e => setAreaSqFtVal(e.target.value)}
                style={{
                  background: "#0b0f1a",
                  border: "0.5px solid #2e3d55",
                  borderRadius: 4,
                  color: "#e8edf5",
                  fontSize: 16,
                  fontWeight: 700,
                  textAlign: "right",
                  padding: "2px 6px",
                  width: 90,
                  outline: "none",
                }}
              />
              <span style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: 14 }}>sq ft</span>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>Metric Area:</span>
            <span style={{ color: "#e8edf5", fontWeight: 600 }}>
              {parsedAreaSqm.toLocaleString(undefined, { maximumFractionDigits: 1 })} m²
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>Boundary Vertices:</span>
            <span style={{ color: "#e8edf5", fontWeight: 700 }}>{zone.polygon.length} corners</span>
          </div>
        </div>

        <div className="mv-modal__field">
          <label className="mv-modal__label">Select Camera Types & Models ({cameraTypes.length} Available)</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 200, overflowY: "auto", paddingRight: 4 }}>
            {cameraTypes.map(({ type, label }) => {
              const modelsOfType = cameraDB.filter(c => c.type === type);
              const selectedModel = selectedModels[type] || modelsOfType[0];
              const isChecked = selectedTypes.includes(type);
              return (
                <div
                  key={type}
                  onClick={() => handleToggleType(type)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    background: isChecked ? "#1D9E7514" : "#0d1117",
                    border: isChecked ? "1px solid #1D9E75" : "1px solid #2e3d55",
                    borderRadius: 6,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}} // Handled by div click
                    style={{
                      cursor: "pointer",
                      accentColor: "#1D9E75",
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#e8edf5" }}>{label}</div>
                    {modelsOfType.length > 0 ? (
                      <select
                        value={selectedModel?.id || ""}
                        onClick={e => e.stopPropagation()} // Prevent toggling checkbox
                        onChange={(e) => {
                          const found = modelsOfType.find(m => m.id === e.target.value);
                          if (found) {
                            setSelectedModels(prev => ({ ...prev, [type]: found }));
                          }
                        }}
                        style={{
                          background: "#0b0f1a",
                          border: "0.5px solid #2e3d55",
                          borderRadius: 4,
                          color: "#e8edf5",
                          fontSize: 14,
                          padding: "3px 6px",
                          marginTop: 4,
                          width: "100%",
                          outline: "none",
                          cursor: "pointer",
                          fontFamily: "inherit"
                        }}
                      >
                        {modelsOfType.map(m => (
                          <option key={m.id} value={m.id}>
                            {m.brand} {m.model} ({m.megapixels}MP · HFOV {m.hfov}° · {m.rangeDay}m)
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ fontSize: 14, color: "#8b2222", marginTop: 4 }}>Not available in DB</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mv-zone-name-modal__row" style={{ marginTop: 20 }}>
          <button className="mv-modal__btn mv-modal__btn--cancel" onClick={onCancel}>Cancel</button>
          <button className="mv-modal__btn mv-modal__btn--confirm" onClick={handleSubmit}>Automate</button>
        </div>
      </div>
    </div>
  );
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
          {camera.onboardStorage && <span className="dv-spec-pill" style={{ color: "#10b981", borderColor: "#10b98144" }}>💾 SD</span>}
        </div>
      </div>
    </div>
  );
}

// ── Spec detail panel ─────────────────────────────────────────────────────────
function SpecPanel({ camera, onClose }) {
  if (!camera) return null;
  const col = TYPE_COLORS[camera.type] || "#3b82f6";

  const codecs = camera.codecSupport?.join(", ") ?? "—";
  const bitrateH265 = camera.bitrateTypical ?? null;
  const bitrateH264 = camera.bitrateH264 ?? null;
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
    ["Frame Rate", camera.fps ? `${camera.fps} fps` : "—"],
    ["Codecs", codecs],
    ["Bitrate H.265", bitrateH265 ? `${bitrateH265} Mbps` : "—"],
    ["Bitrate H.264", bitrateH264 ? `${bitrateH264} Mbps` : "—"],
    ["Onboard SD", camera.onboardStorage ? `Yes — up to ${camera.onboardStorageMaxGB} GB` : "No"],
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
            <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>{camera.series}</span>
          </div>
        </div>
        <button className="dv-spec-panel__close" onClick={onClose}>✕</button>
      </div>
      <div style={{ padding: "10px 14px 0", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 4, background: col + "22", color: col, border: `0.5px solid ${col}55` }}>
          {TYPE_ICONS[camera.type]} {camera.type}
        </span>
        {camera.megapixels && (
          <span style={{ fontSize: 15, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "#1e2738", color: "rgba(255, 255, 255, 0.5)", border: "0.5px solid #2e3d55" }}>
            {camera.megapixels} MP
          </span>
        )}
        {camera.ir > 0 && (
          <span style={{ fontSize: 15, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "#f59e0b18", color: "#f59e0b", border: "0.5px solid #f59e0b44" }}>
            IR {camera.ir}m
          </span>
        )}
      </div>
      {camera.notes && (
        <div style={{ margin: "10px 14px 0", padding: "8px 10px", background: "#10151f", border: "0.5px solid #1e2d3e", borderRadius: 6, fontSize: 16, color: "rgba(255, 255, 255, 0.5)", lineHeight: 1.6 }}>
          {camera.notes}
        </div>
      )}

      {camera.securityBadges?.length > 0 && (
        <div style={{ padding: "8px 14px 0", display: "flex", flexWrap: "wrap", gap: 5 }}>
          {camera.securityBadges.map(badge => (
            <span key={badge} style={{
              fontSize: 14, fontWeight: 600,
              padding: "2px 7px", borderRadius: 4,
              background: badge === "Thermal" ? "#8b5cf622" : badge.startsWith("IK") ? "#f59e0b22" : badge === "PoE" ? "#3b82f622" : "#10b98122",
              color: badge === "Thermal" ? "#8b5cf6" : badge.startsWith("IK") ? "#f59e0b" : badge === "PoE" ? "#3b82f6" : "#10b981",
              border: `0.5px solid currentColor`,
            }}>
              {badge}
            </span>
          ))}
        </div>
      )}
      <div style={{ padding: "12px 14px 6px" }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "0.5px solid #1a2030" }}>
            <span style={{ fontSize: 16, color: "rgba(255, 255, 255, 0.5)" }}>{k}</span>
            <span style={{ fontSize: 16, color: "#e2e8f0", fontVariantNumeric: "tabular-nums", fontFamily: "monospace" }}>{v}</span>
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
  return <canvas ref={ref} width={220} height={130} style={{ display: "block", margin: "0 auto" }} />;
}

// ── Camera drawing ────────────────────────────────────────────────────────────
// FIX 1: clipZone now auto-detects the camera's own zone when no active zone is set.
// This ensures FOV is always clipped to its zone even after refresh.
function drawPlacedCamera(ctx, p, ppm, hovering, selected, zonesRef, activeZoneIdRef, highlightedId, showLabel = true, showPpm = false, hideBeam = false) {
  const { x, y, direction, camera } = p;
  const col = TYPE_COLORS[camera.type] || "#3b82f6";
  const isHighlit = p.id === highlightedId;
  const { angle, halfRad } = fovDrawParams(camera, direction);
  const radius = camera.rangeDay * ppm;

  const S = 0.62;

  // ★ FIX: origin matches MapCanvas (x + cos*1.5*S, forward) instead of old backward formula
  const originX = x + Math.cos(angle) * (1.5 * S);
  const originY = y + Math.sin(angle) * (1.5 * S);

  // ── Zone clip — always clip to the camera's own zone ─────────────
  let clipping = false;
  let clipZone = null;

  if (zonesRef?.current) {
    if (activeZoneIdRef?.current) {
      const activeZone = zonesRef.current.find(z => z.id === activeZoneIdRef.current);
      if (activeZone && activeZone.polygon?.length >= 3 && pointInPolygon(x, y, activeZone.polygon)) {
        clipZone = activeZone;
      } else {
        hideBeam = true;
      }
    } else {
      const containedZones = zonesRef.current.filter(
        z => z.polygon?.length >= 3 && pointInPolygon(x, y, z.polygon)
      );
      if (containedZones.length > 0) {
        containedZones.sort((a, b) => getPolygonArea(a.polygon, ppm) - getPolygonArea(b.polygon, ppm));
        clipZone = containedZones[0];
      }
    }
  }

  const startClip = () => {
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
  };
  const endClip = () => { if (clipping) { ctx.restore(); clipping = false; } };

  startClip();

  // ── FOV cone, DORI Clarity Zones, and Range circle ───────────────
  if (!hideBeam) {
    // ── FOV cone ─────────────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.arc(originX, originY, radius, angle - halfRad, angle + halfRad);
    ctx.closePath();
    if (!showPpm) {
      const g = ctx.createRadialGradient(originX, originY, 0, originX, originY, radius);
      g.addColorStop(0, col + (selected ? "77" : isHighlit ? "66" : "44"));
      g.addColorStop(1, col + "0a");
      ctx.fillStyle = g; ctx.fill();
    }
    ctx.strokeStyle = col + (selected || isHighlit ? "cc" : "66");
    ctx.lineWidth = selected || isHighlit ? 1.5 : 1; ctx.stroke();
    ctx.restore();

    // ── DORI Clarity Zones (EN 62676-4) ──────────────────────────────
    if (showPpm) {
      const resX = camera.megapixels === 12 ? 4000 :
                   camera.megapixels === 8 ? 3840 :
                   camera.megapixels === 5 ? 2592 :
                   camera.megapixels === 4 ? 2688 :
                   camera.megapixels === 2 ? 1920 :
                   Math.round(Math.sqrt((16 / 9) * (camera.megapixels || 2)) * 1000) || 1920;

      const hfovRad = (camera.hfov * Math.PI) / 180;
      const tanHalf = Math.tan(hfovRad / 2);

      const getDistForPpm = (tPpm) => {
        if (camera.type === "fisheye" || camera.hfov >= 180) {
          return (resX / (Math.PI * tPpm)) * 0.35;
        }
        return resX / (2 * tPpm * tanHalf);
      };

      const zonesPpm = [
        { d: getDistForPpm(25) * ppm, c: "#3b82f6", l: "D" },
        { d: getDistForPpm(62) * ppm, c: "#eab308", l: "O" },
        { d: getDistForPpm(125) * ppm, c: "#f97316", l: "R" },
        { d: getDistForPpm(250) * ppm, c: "#a855f7", l: "I" },
      ];

      zonesPpm.forEach(z => {
        const dVal = Math.min(z.d, radius);
        if (dVal <= 0) return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.arc(originX, originY, dVal, angle - halfRad, angle + halfRad);
        ctx.closePath();
        ctx.fillStyle = z.c + "14";
        ctx.fill();
        ctx.restore();
      });

      zonesPpm.forEach(z => {
        const dVal = Math.min(z.d, radius);
        if (z.d > radius || dVal <= 0) return;

        ctx.beginPath();
        ctx.arc(originX, originY, dVal, angle - halfRad, angle + halfRad);
        ctx.strokeStyle = z.c + "33";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.save();
        ctx.translate(originX, originY);
        ctx.rotate(angle - halfRad + 0.04);
        ctx.fillStyle = z.c;
        ctx.font = "bold 8px monospace";
        ctx.fillText(z.l, Math.max(5, dVal - 45), -3);
        ctx.restore();
      });
    }

    // ── Range circle (dashed) ─────────────────────────────────────────
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = col + "33"; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
  }

  endClip();

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
  onSelect, onDelete, onRename, onHighlightCam, onRemoveCam, sidebarExpanded,
  onContextMenu,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(zone.name);

  useEffect(() => {
    setEditName(zone.name);
  }, [zone.name]);

  const handleSave = () => {
    const trimmed = editName.trim();
    if (!trimmed) {
      alert("Zone name cannot be empty.");
      setEditName(zone.name);
      setIsEditing(false);
      return;
    }
    if (trimmed !== zone.name) {
      onRename(zone.id, trimmed);
    }
    setIsEditing(false);
  };

  const camsInZone = placed.filter(
    p => zone.polygon.length >= 3 && pointInOrOnPolygon(p.x, p.y, zone.polygon)
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
        onClick={() => !isEditing && onSelect(zone)}
        onContextMenu={onContextMenu}
        title={zone.name}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", background: "none", border: "none",
          padding: "5px 6px", cursor: "pointer", color: "#c9d1d9",
          fontSize: 15, textAlign: "left",
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: 2,
          background: zone.color, flexShrink: 0,
          border: `1px solid ${zone.color}88`,
        }} />

        {sidebarExpanded && (
          isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  handleSave();
                } else if (e.key === "Escape") {
                  setIsEditing(false);
                  setEditName(zone.name);
                }
              }}
              onBlur={handleSave}
              onClick={e => e.stopPropagation()}
              autoFocus
              style={{
                background: "#0d1117",
                border: "1px solid #185FA5",
                borderRadius: "4px",
                color: "#e8edf5",
                fontSize: "15px",
                padding: "2px 4px",
                width: "100%",
                outline: "none",
                fontFamily: "inherit"
              }}
            />
          ) : (
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 17, fontWeight: 700, color: "#e8edf5" }}>
              {zone.name}
            </span>
          )
        )}

        {sidebarExpanded && camsInZone.length > 0 && (
          <span style={{
            fontSize: 14, fontWeight: 800, borderRadius: 10,
            padding: "2px 6px", background: zone.color + "28", color: zone.color,
          }}>
            {camsInZone.length}
          </span>
        )}

        {sidebarExpanded && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", zIndex: 5 }} onClick={e => e.stopPropagation()}>
            <span
              className="dv-zone-btn__edit"
              onClick={e => { e.stopPropagation(); setIsEditing(true); }}
              title="Rename zone"
              style={{
                fontSize: "15px",
                color: "rgba(255, 255, 255, 0.5)",
                cursor: "pointer",
                padding: "2px",
                flexShrink: 0,
                display: "flex",
                alignItems: "center"
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="11" height="11">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </span>
            <span
              className="dv-zone-btn__delete"
              onClick={e => { e.stopPropagation(); onDelete(zone.id); }}
              title="Delete zone"
              style={{
                fontSize: "16px",
                color: "rgba(255, 255, 255, 0.5)",
                cursor: "pointer",
                padding: "2px",
                flexShrink: 0,
                fontWeight: "bold",
                display: "flex",
                alignItems: "center"
              }}
            >✕</span>
          </div>
        )}
      </button>

      {isActive && sidebarExpanded && camsInZone.length > 0 && (
        <div style={{ paddingBottom: 6 }}>
          {camsInZone.map((p) => {
            const col = TYPE_COLORS[p.camera.type] || "#3b82f6";
            const isHighlit = highlightedId === p.id;
            return (
              <div
                key={p.id}
                onClick={e => { e.stopPropagation(); onHighlightCam(p.id); }}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 10px 5px 20px", cursor: "pointer",
                  background: isHighlit ? zone.color + "18" : "transparent",
                  borderLeft: isHighlit ? `2.5px solid ${zone.color}` : "2.5px solid transparent",
                  transition: "all 0.1s",
                }}
              >
                <CameraIcon type={p.camera.type} size={14} color={col} />
                <span style={{
                  flex: 1, fontSize: 16, color: isHighlit ? "#ffffff" : "#cbd5e1",
                  fontWeight: isHighlit ? 600 : 400,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {p.camera.model}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); onRemoveCam(p.id); }}
                  title="Remove camera"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "rgba(255, 255, 255, 0.5)", fontSize: 13, padding: "0 2px", flexShrink: 0,
                  }}
                >✕</button>
              </div>
            );
          })}
        </div>
      )}

      {isActive && sidebarExpanded && camsInZone.length === 0 && (
        <div style={{ padding: "3px 10px 6px 18px", fontSize: 14, color: "rgba(255, 255, 255, 0.5)" }}>
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
  const jsonFileInputRef = useRef(null);
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
  const draggingDraftZoneIdRef = useRef(null);
  const draggingDraftVertexIdxRef = useRef(null);

  const [ppm, setPpm] = useState(PIXELS_PER_METRE);
  const ppmRef = useRef(ppm);
  useEffect(() => { ppmRef.current = ppm; }, [ppm]);

  const [placed, setPlaced] = useState([]);
  const placedRef = useRef([]);
  useEffect(() => { placedRef.current = placed; }, [placed]);

  // Stateful interactive pricing in Indian Rupees (INR)
  const [cameraPrices, setCameraPrices] = useState({});
  const [accessoryPrices, setAccessoryPrices] = useState({});
  const [nvrPrice, setNvrPrice] = useState(0);
  const [switchUnitPrice, setSwitchUnitPrice] = useState(0);

  useEffect(() => {
    setCameraPrices(prev => {
      const next = { ...prev };
      let changed = false;
      placed.forEach(p => {
        if (next[p.id] === undefined) {
          next[p.id] = 0;
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setAccessoryPrices(prev => {
      const next = { ...prev };
      let changed = false;
      placed.forEach(p => {
        if (next[p.id] === undefined) {
          next[p.id] = 0;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [placed]);

  const hardware = CctvCalc.getHardwareRecommendations(placed.length);
  const lastNvrRef = useRef("");
  useEffect(() => {
    if (hardware.nvr !== lastNvrRef.current) {
      setNvrPrice(0);
      lastNvrRef.current = hardware.nvr;
    }
  }, [hardware.nvr]);

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

  const [draftZones, setDraftZones] = useState([]);
  const draftZonesRef = useRef([]);
  useEffect(() => { draftZonesRef.current = draftZones; }, [draftZones]);
  const [isDetectingZones, setIsDetectingZones] = useState(false);

  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  const [slides, setSlides] = useState([]);
  const slidesRef = useRef([]);
  useEffect(() => { slidesRef.current = slides; }, [slides]);

  const [activeSlideId, setActiveSlideId] = useState(null);
  const activeSlideIdRef = useRef(null);
  useEffect(() => { activeSlideIdRef.current = activeSlideId; }, [activeSlideId]);

  const [editingSlideId, setEditingSlideId] = useState(null);
  const [editingSlideName, setEditingSlideName] = useState("");

  const recordState = useCallback((p = placedRef.current, z = zonesRef.current) => {
    const snapshot = {
      placed: JSON.parse(JSON.stringify(p)),
      zones: JSON.parse(JSON.stringify(z))
    };
    setUndoStack(prev => [...prev, snapshot]);
    setRedoStack([]);
  }, []);





  const [popupState, setPopupState] = useState({
    show: false,
    type: "alert",
    title: "",
    message: "",
    onConfirm: null,
    onCancel: null
  });

  const showAlert = (title, message) => {
    setPopupState({
      show: true,
      type: "alert",
      title,
      message,
      onConfirm: () => {
        setPopupState(prev => ({ ...prev, show: false }));
      },
      onCancel: null
    });
  };

  const showConfirm = (title, message, onConfirmCallback) => {
    setPopupState({
      show: true,
      type: "confirm",
      title,
      message,
      onConfirm: () => {
        setPopupState(prev => ({ ...prev, show: false }));
        onConfirmCallback();
      },
      onCancel: () => {
        setPopupState(prev => ({ ...prev, show: false }));
      }
    });
  };



  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [highlightedCamId, setHighlightedCamId] = useState(null);
  const highlightedCamIdRef = useRef(null);
  useEffect(() => { highlightedCamIdRef.current = highlightedCamId; }, [highlightedCamId]);

  const [contextMenu, setContextMenu] = useState(null);
  const [showAutomationModal, setShowAutomationModal] = useState(false);
  const [automationZone, setAutomationZone] = useState(null);

  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (fileDropRef.current && !fileDropRef.current.contains(e.target)) {
        setFileDropdownOpen(false);
      }
      if (modesDropRef.current && !modesDropRef.current.contains(e.target)) {
        setModesDropdownOpen(false);
      }
      if (layersDropRef.current && !layersDropRef.current.contains(e.target)) {
        setLayersDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const originalAlert = window.alert;
    window.alert = (msg) => showAlert("Designer View Alert", msg);
    return () => {
      window.alert = originalAlert;
    };
  }, []);


  const [showHeatmap, setShowHeatmap] = useState(false);
  const [hasFloor, setHasFloor] = useState(false);
  const [brandFilter, setBrandFilter] = useState(null);
  const [typeFilter, setTypeFilter] = useState(null);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
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
  const [showStats, setShowStats] = useState(false);
  const [showPpm, setShowPpm] = useState(false);
  const [showConfigDrawer, setShowConfigDrawer] = useState(false);
  const [inspectorExpanded, setInspectorExpanded] = useState(true);
  const [inspectorTab, setInspectorTab] = useState("cameras"); // "cameras" | "zones"
  const [retentionDays, setRetentionDays] = useState(30);
  const exportMenuRef = useRef(null);

  // ── Modes / Layers / File dropdown states ──
  const [modesDropdownOpen, setModesDropdownOpen] = useState(false);
  const [layersDropdownOpen, setLayersDropdownOpen] = useState(false);
  const [fileDropdownOpen, setFileDropdownOpen] = useState(false);
  const modesDropRef = useRef(null);
  const layersDropRef = useRef(null);
  const fileDropRef = useRef(null);

  // ── Calibration Tape Measure states ──
  const [calPts, setCalPts] = useState([]);
  const calPtsRef = useRef([]);
  useEffect(() => { calPtsRef.current = calPts; }, [calPts]);

  const [mouseMapPos, setMouseMapPos] = useState(null);
  const mouseMapPosRef = useRef(null);
  useEffect(() => { mouseMapPosRef.current = mouseMapPos; }, [mouseMapPos]);

  const [showCalibrateModal, setShowCalibrateModal] = useState(false);
  const [calibrateDistPx, setCalibrateDistPx] = useState(0);
  const [calibrateRealMeters, setCalibrateRealMeters] = useState("5.0");

  // ── Debounced save ────────────────────────────────────────────────────────
  const scheduleSave = useCallback((placedList, zonesList, currentPpm) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      apiSaveLayout({ placed: placedList, zones: zonesList, ppm: currentPpm });
    }, 800);
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

    // ── Visual Calibration Tape Measure ──────────────────────────────────────
    if (modeRef.current === "calibrate") {
      const pts = calPtsRef.current;
      const mousePos = mouseMapPosRef.current;
      
      ctx.save();
      // Draw first point
      if (pts.length > 0) {
        const ptA = pts[0];
        ctx.beginPath(); ctx.arc(ptA.x, ptA.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#f59e0b"; ctx.fill();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();

        // Draw crosshair lines for first point
        ctx.strokeStyle = "#f59e0baa"; ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(ptA.x - 15, ptA.y); ctx.lineTo(ptA.x + 15, ptA.y);
        ctx.moveTo(ptA.x, ptA.y - 15); ctx.lineTo(ptA.x, ptA.y + 15);
        ctx.stroke();

        // Draw live line to mouse or second point
        const ptB = pts.length > 1 ? pts[1] : mousePos;
        if (ptB) {
          ctx.beginPath();
          ctx.moveTo(ptA.x, ptA.y);
          ctx.lineTo(ptB.x, ptB.y);
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Draw second point
          ctx.beginPath(); ctx.arc(ptB.x, ptB.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = pts.length > 1 ? "#f59e0b" : "#ffffff44"; ctx.fill();
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();

          // Crosshairs for second point
          ctx.strokeStyle = "#f59e0baa"; ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(ptB.x - 15, ptB.y); ctx.lineTo(ptB.x + 15, ptB.y);
          ctx.moveTo(ptB.x, ptB.y - 15); ctx.lineTo(ptB.x, ptB.y + 15);
          ctx.stroke();

          // Distance label in pixels
          const dPx = Math.hypot(ptB.x - ptA.x, ptB.y - ptA.y);
          const midX = (ptA.x + ptB.x) / 2;
          const midY = (ptA.y + ptB.y) / 2;

          ctx.fillStyle = "#10151fec";
          const lbl = `${Math.round(dPx)} px`;
          ctx.font = "bold 10px monospace";
          const tw = ctx.measureText(lbl).width;
          ctx.fillRect(midX - tw / 2 - 5, midY - 9, tw + 10, 16);
          ctx.strokeStyle = "#f59e0b"; ctx.strokeRect(midX - tw / 2 - 5, midY - 9, tw + 10, 16);
          
          ctx.fillStyle = "#f59e0b";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(lbl, midX, midY - 1);
        }
      }
      ctx.restore();
    }

    // ── Zones ────────────────────────────────────────────────────────────────
    zonesRef.current.forEach(zone => {
      if (zone.polygon.length < 2) return;
      const isActive = zone.id === activeZoneIdRef.current;
      ctx.save();
      ctx.beginPath();
      zone.polygon.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.closePath();
      // ctx.fillStyle = zone.color + (isActive ? "28" : "14"); ctx.fill();
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

    // ── Draft (CV Detected) Zones ────────────────────────────────────────────
    draftZonesRef.current.forEach(zone => {
      if (zone.polygon.length < 2) return;

      // Calculate blink phase (opacity oscillating between 0.25 and 0.85)
      const blinkTime = Date.now() * 0.005; // speed multiplier
      const opacity = 0.35 + 0.35 * Math.sin(blinkTime);

      ctx.save();
      ctx.beginPath();
      zone.polygon.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.closePath();
      
      // Subtle constant background fill
      ctx.fillStyle = zone.color + "14";
      ctx.fill();

      ctx.strokeStyle = zone.color;
      ctx.globalAlpha = opacity;
      ctx.lineWidth = 2.0;
      ctx.setLineDash([6, 4]);
      ctx.stroke(); ctx.setLineDash([]);
      
      zone.polygon.forEach(p => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = zone.color;
        ctx.globalAlpha = opacity;
        ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke();
      });

      // Calculate center to show a nice little label
      let cx = 0, cy = 0;
      zone.polygon.forEach(p => { cx += p.x; cy += p.y; });
      cx /= zone.polygon.length;
      cy /= zone.polygon.length;
      ctx.fillStyle = zone.color;
      ctx.globalAlpha = opacity;
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("CV DRAFT", cx, cy);
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
        false,
        showPpm
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

    // ── Zone Hover Tooltip ───────────────────────────────────────────────────
    if (mouseMapPosRef.current && hoveredIdx === null) {
      const hoveredZone = zonesRef.current.find(
        z => z.polygon?.length >= 3 && pointInOrOnPolygon(mouseMapPosRef.current.x, mouseMapPosRef.current.y, z.polygon)
      );

      if (hoveredZone) {
        const lbl = `Zone: ${hoveredZone.name}`;
        ctx.font = "10.5px Inter, sans-serif";
        const tw = ctx.measureText(lbl).width;
        const tx = mouseMapPosRef.current.x;
        const ty = mouseMapPosRef.current.y - 18;
        const bx = tx - tw / 2 - 7;
        const by = ty - 9;
        ctx.save();
        ctx.fillStyle = "rgba(13, 17, 23, 0.95)";
        ctx.strokeStyle = hoveredZone.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, tw + 14, 18, 4);
        else ctx.rect(bx, by, tw + 14, 18);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#e8edf5";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(lbl, tx, ty);
        ctx.restore();
      }
    }

    ctx.restore();
  }, [ppm, hoveredIdx, selectedIdx, showPpm]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const currentState = {
      placed: JSON.parse(JSON.stringify(placedRef.current)),
      zones: JSON.parse(JSON.stringify(zonesRef.current))
    };
    setRedoStack(prev => [...prev, currentState]);
    const previousState = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    placedRef.current = previousState.placed;
    setPlaced(previousState.placed);
    zonesRef.current = previousState.zones;
    setZones(previousState.zones);
    setSelectedIdx(null);
    setActiveZoneId(null);
    activeZoneIdRef.current = null;
    draw();
    apiSaveLayout({ placed: previousState.placed, zones: previousState.zones, ppm: ppmRef.current });
  }, [undoStack, draw]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const currentState = {
      placed: JSON.parse(JSON.stringify(placedRef.current)),
      zones: JSON.parse(JSON.stringify(zonesRef.current))
    };
    setUndoStack(prev => [...prev, currentState]);
    const nextState = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    placedRef.current = nextState.placed;
    setPlaced(nextState.placed);
    zonesRef.current = nextState.zones;
    setZones(nextState.zones);
    setSelectedIdx(null);
    setActiveZoneId(null);
    activeZoneIdRef.current = null;
    draw();
    apiSaveLayout({ placed: nextState.placed, zones: nextState.zones, ppm: ppmRef.current });
  }, [redoStack, draw]);

  const downloadJson = useCallback(() => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
      placed: placedRef.current,
      zones: zonesRef.current,
      ppm: ppmRef.current
    }, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `mirador_designer_layout_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }, []);

  const handleJsonImport = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        
        recordState();
        
        if (data.ppm) {
          setPpm(data.ppm);
          ppmRef.current = data.ppm;
        }
        if (Array.isArray(data.placed)) {
          placedRef.current = data.placed;
          setPlaced(data.placed);
        }
        if (Array.isArray(data.zones)) {
          zonesRef.current = data.zones;
          setZones(data.zones);
          apiSaveZones(data.zones);
        }
        
        draw();
        
        apiSaveLayout({
          placed: data.placed || [],
          zones: data.zones || [],
          ppm: data.ppm || ppmRef.current
        });
        
        alert("Layout imported successfully!");
      } catch (err) {
        console.error("JSON parsing error: ", err);
        alert("Failed to parse JSON file. Please ensure it is a valid layout export.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [draw, recordState]);

  // ── Varifocal zoom change handler ──
  const handleVarifocalChange = useCallback((idx, focalLen) => {
    const updated = [...placedRef.current];
    const item = updated[idx];
    if (!item || !item.camera.isVarifocal) return;

    recordState();

    // Linear interpolation for HFOV based on focal length
    const fMin = item.camera.focalLength;
    const fMax = item.camera.focalLengthMax;
    const originalHfov = item.camera.originalHfov || item.camera.hfov;
    const hMin = item.camera.hfovMin || originalHfov * 0.3; // fallback

    const t = (focalLen - fMin) / (fMax - fMin);
    const interpolatedHfov = originalHfov - t * (originalHfov - hMin);

    updated[idx] = {
      ...item,
      currentFocalLength: focalLen,
      currentHfov: interpolatedHfov,
      camera: {
        ...item.camera,
        originalHfov: originalHfov, // preserve original widest HFOV
        hfov: interpolatedHfov, // dynamic override for FOV cone
      }
    };

    placedRef.current = updated;
    setPlaced(updated);
    draw();
    scheduleSave(updated, zonesRef.current, ppmRef.current);
  }, [draw, scheduleSave, recordState]);

  // ── Camera surveillance scenario & accessories configuration change handler ──
  const handleCameraConfigChange = useCallback((idx, key, value) => {
    const updated = [...placedRef.current];
    const item = updated[idx];
    if (!item) return;

    recordState();

    const newItem = {
      ...item,
      [key]: value
    };
    updated[idx] = newItem;



    placedRef.current = updated;
    setPlaced(updated);
    draw();
    scheduleSave(updated, zonesRef.current, ppmRef.current);
  }, [draw, scheduleSave, recordState]);

  // ── Restore layout on mount ───────────────────────────────────────────────
  useEffect(() => {
    const savedSlidesStr = localStorage.getItem(`miradorai_slides_${MAP_ID}`);
    const savedActiveId = localStorage.getItem(`miradorai_active_slide_${MAP_ID}`);

    if (savedSlidesStr) {
      try {
        const parsedSlides = JSON.parse(savedSlidesStr);
        setSlides(parsedSlides);
        slidesRef.current = parsedSlides;

        const activeId = (savedActiveId && parsedSlides.find(s => s.id === savedActiveId))
          ? savedActiveId
          : (parsedSlides.length > 0 ? parsedSlides[0].id : null);

        if (activeId) {
          setActiveSlideId(activeId);
          activeSlideIdRef.current = activeId;
          const activeSlide = parsedSlides.find(s => s.id === activeId);
          if (activeSlide) {
            setPpm(activeSlide.ppm || PIXELS_PER_METRE);
            ppmRef.current = activeSlide.ppm || PIXELS_PER_METRE;

            placedRef.current = activeSlide.placed || [];
            setPlaced(activeSlide.placed || []);

            zonesRef.current = activeSlide.zones || [];
            setZones(activeSlide.zones || []);

            draftZonesRef.current = activeSlide.draftZones || [];
            setDraftZones(activeSlide.draftZones || []);

            if (activeSlide.floorPlan) {
              const img = new Image();
              img.onload = () => {
                floorImgRef.current = img;
                setHasFloor(true);
                setTimeout(fitImage, 50);
              };
              img.src = activeSlide.floorPlan;
            }
          }
        }
      } catch (err) {
        console.error("Failed to load slides from localStorage", err);
      }
    } else {
      apiLoadLayout().then(data => {
        const defaultSlide = {
          id: "slide_" + Date.now(),
          name: "Floor Draft 1",
          floorPlan: (data && data.floor_plan) || null,
          placed: (data && data.placed) || [],
          zones: (data && data.zones) || [],
          draftZones: [],
          ppm: (data && data.ppm) || PIXELS_PER_METRE
        };

        setSlides([defaultSlide]);
        slidesRef.current = [defaultSlide];
        setActiveSlideId(defaultSlide.id);
        activeSlideIdRef.current = defaultSlide.id;

        if (data) {
          if (data.ppm) {
            setPpm(data.ppm);
            ppmRef.current = data.ppm;
          }
          if (data.placed?.length) {
            placedRef.current = data.placed;
            setPlaced(data.placed);
          }
          if (data.zones?.length) {
            zonesRef.current = data.zones;
            setZones(data.zones);
          }
          if (data.floor_plan) {
            const img = new Image();
            img.onload = () => {
              floorImgRef.current = img;
              setHasFloor(true);
              setTimeout(fitImage, 50);
            };
            img.src = data.floor_plan;
          }
        }
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save slides list and active slide ID to localStorage
  useEffect(() => {
    if (slides.length > 0) {
      try {
        localStorage.setItem(`miradorai_slides_${MAP_ID}`, JSON.stringify(slides));
      } catch (err) {
        console.warn("Failed to save slides to localStorage due to quota limits", err);
      }
    }
  }, [slides]);

  useEffect(() => {
    if (activeSlideId) {
      localStorage.setItem(`miradorai_active_slide_${MAP_ID}`, activeSlideId);
    }
  }, [activeSlideId]);

  // Reactive Sync: Keep active slide inside slides list in sync with current canvas editor states
  useEffect(() => {
    if (!activeSlideId) return;
    setSlides(prevSlides => {
      const idx = prevSlides.findIndex(s => s.id === activeSlideId);
      if (idx === -1) return prevSlides;
      
      const currentSlide = prevSlides[idx];
      const hasFloorImg = floorImgRef.current ? floorImgRef.current.src : null;
      if (
        currentSlide.ppm === ppm &&
        currentSlide.floorPlan === hasFloorImg &&
        JSON.stringify(currentSlide.placed) === JSON.stringify(placed) &&
        JSON.stringify(currentSlide.zones) === JSON.stringify(zones) &&
        JSON.stringify(currentSlide.draftZones) === JSON.stringify(draftZones)
      ) {
        return prevSlides;
      }
      
      const updated = [...prevSlides];
      updated[idx] = {
        ...currentSlide,
        ppm,
        placed,
        zones,
        draftZones,
        floorPlan: hasFloorImg
      };
      return updated;
    });
  }, [placed, zones, draftZones, ppm, activeSlideId]);

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
    
    // Shift camera focus point UP above the bottom settings bar (~150px)
    const bottomBarHeight = 150;
    const visibleH = H - bottomBarHeight;
    
    offsetRef.current = { 
      x: W / 2 - cam.x * targetScale, 
      y: visibleH / 2 - cam.y * targetScale 
    };
    setZoomPct(Math.round(targetScale * 100));
  }, []);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw, placed, zones, drawingPoints, activeZoneId, highlightedCamId, draftZones]);

  useEffect(() => {
    if (draftZones.length === 0) return;
    let active = true;
    const tick = () => {
      if (!active) return;
      draw();
      requestAnimationFrame(tick);
    };
    const localRaf = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(localRaf);
    };
  }, [draftZones, draw]);

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
    
    const leftMargin = 65;
    const rightPanelWidth = inspectorExpanded ? 265 : 0;
    const visibleW = W - rightPanelWidth - leftMargin;
    
    // Account for the bottom settings bar height if a camera is selected
    const bottomBarHeight = selectedIdx !== null ? 150 : 0;
    const visibleH = H - 40 - bottomBarHeight;
    
    const s = Math.min(visibleW / img.width, visibleH / img.height) * 0.96;
    scaleRef.current = s;
    offsetRef.current = {
      x: leftMargin + (visibleW - img.width * s) / 2,
      y: (visibleH - img.height * s) / 2,
    };
    setZoomPct(Math.round(s * 100)); draw();
  }, [inspectorExpanded, selectedIdx, draw]);

  useEffect(() => {
    fitImage();
  }, [inspectorExpanded, fitImage]);

  const renameSlide = useCallback((slideId, newName) => {
    setSlides(prev => prev.map(s => s.id === slideId ? { ...s, name: newName } : s));
  }, []);

  const switchSlide = useCallback((slideId) => {
    const targetSlide = slidesRef.current.find(s => s.id === slideId);
    if (!targetSlide) return;

    recordState();

    setActiveSlideId(slideId);

    setPpm(targetSlide.ppm || PIXELS_PER_METRE);
    ppmRef.current = targetSlide.ppm || PIXELS_PER_METRE;

    placedRef.current = targetSlide.placed || [];
    setPlaced(targetSlide.placed || []);

    zonesRef.current = targetSlide.zones || [];
    setZones(targetSlide.zones || []);

    draftZonesRef.current = targetSlide.draftZones || [];
    setDraftZones(targetSlide.draftZones || []);

    drawingPointsRef.current = [];
    setDrawingPoints([]);
    setSelectedIdx(null);
    setActiveZoneId(null);
    activeZoneIdRef.current = null;

    if (targetSlide.floorPlan) {
      const img = new Image();
      img.onload = () => {
        floorImgRef.current = img;
        setHasFloor(true);
        setTimeout(fitImage, 50);
      };
      img.src = targetSlide.floorPlan;
    } else {
      floorImgRef.current = null;
      setHasFloor(false);
      draw();
    }

    apiSaveFloorPlan(targetSlide.floorPlan);
    apiSaveLayout({
      placed: targetSlide.placed || [],
      zones: targetSlide.zones || [],
      ppm: targetSlide.ppm || PIXELS_PER_METRE
    });
  }, [recordState, fitImage, draw]);

  const deleteSlide = useCallback((slideId, e) => {
    if (e) e.stopPropagation();

    if (slidesRef.current.length <= 1) {
      alert("You must keep at least one floor draft.");
      return;
    }

    recordState();

    const currentSlides = slidesRef.current;
    const index = currentSlides.findIndex(s => s.id === slideId);
    const updatedSlides = currentSlides.filter(s => s.id !== slideId);
    setSlides(updatedSlides);

    if (activeSlideIdRef.current === slideId) {
      const newActiveIdx = Math.max(0, index - 1);
      const newActiveSlide = updatedSlides[newActiveIdx];
      if (newActiveSlide) {
        setActiveSlideId(newActiveSlide.id);

        setPpm(newActiveSlide.ppm || PIXELS_PER_METRE);
        ppmRef.current = newActiveSlide.ppm || PIXELS_PER_METRE;

        placedRef.current = newActiveSlide.placed || [];
        setPlaced(newActiveSlide.placed || []);

        zonesRef.current = newActiveSlide.zones || [];
        setZones(newActiveSlide.zones || []);

        draftZonesRef.current = newActiveSlide.draftZones || [];
        setDraftZones(newActiveSlide.draftZones || []);

        drawingPointsRef.current = [];
        setDrawingPoints([]);
        setSelectedIdx(null);
        setActiveZoneId(null);
        activeZoneIdRef.current = null;

        if (newActiveSlide.floorPlan) {
          const img = new Image();
          img.onload = () => {
            floorImgRef.current = img;
            setHasFloor(true);
            setTimeout(fitImage, 50);
          };
          img.src = newActiveSlide.floorPlan;
        } else {
          floorImgRef.current = null;
          setHasFloor(false);
          draw();
        }

        apiSaveFloorPlan(newActiveSlide.floorPlan);
        apiSaveLayout({
          placed: newActiveSlide.placed || [],
          zones: newActiveSlide.zones || [],
          ppm: newActiveSlide.ppm || PIXELS_PER_METRE
        });
      }
    }
  }, [recordState, fitImage, draw]);

  const addNewSlide = useCallback((floorPlan = null, floorPlanName = null) => {
    recordState();

    const newSlideId = "slide_" + Date.now();
    const newSlideName = floorPlanName || `Floor Draft ${slidesRef.current.length + 1}`;
    
    const newSlide = {
      id: newSlideId,
      name: newSlideName,
      floorPlan,
      placed: [],
      zones: [],
      draftZones: [],
      ppm: PIXELS_PER_METRE
    };

    setSlides(prev => [...prev, newSlide]);
    setActiveSlideId(newSlideId);

    setPpm(PIXELS_PER_METRE);
    ppmRef.current = PIXELS_PER_METRE;

    placedRef.current = [];
    setPlaced([]);
    zonesRef.current = [];
    setZones([]);
    draftZonesRef.current = [];
    setDraftZones([]);
    drawingPointsRef.current = [];
    setDrawingPoints([]);
    setSelectedIdx(null);
    setActiveZoneId(null);
    activeZoneIdRef.current = null;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    if (floorPlan) {
      const img = new Image();
      img.onload = () => {
        floorImgRef.current = img;
        setHasFloor(true);
        setTimeout(fitImage, 50);
      };
      img.src = floorPlan;
    } else {
      floorImgRef.current = null;
      setHasFloor(false);
      draw();
    }

    apiSaveFloorPlan(floorPlan);
    apiSaveLayout({ placed: [], zones: [], ppm: PIXELS_PER_METRE });
  }, [recordState, fitImage, draw]);

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
    recordState();
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

  // ── Context Menu triggers & Automation Placement ──────────────────────────
  const onContextMenu = useCallback(e => {
    e.preventDefault();
    const p = toImg(e.clientX, e.clientY);
    const clickedZone = zonesRef.current.find(
      z => z.polygon?.length >= 3 && pointInPolygon(p.x, p.y, z.polygon)
    );
    if (clickedZone) {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        zone: clickedZone
      });
    } else {
      setContextMenu(null);
    }
  }, []);

  const onSidebarZoneContextMenu = useCallback((e, zone) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      zone
    });
  }, []);

  const handleAutomateClick = (zone) => {
    setAutomationZone(zone);
    setShowAutomationModal(true);
    setContextMenu(null);
  };

  const getCameraForType = useCallback((type) => {
    const models = cameraDBRef.current.filter(c => c.type === type);
    if (!models.length) return null;
    return [...models].sort((a, b) => (b.megapixels || 0) - (a.megapixels || 0) || (b.rangeDay || 0) - (a.rangeDay || 0))[0];
  }, []);

  const handleAutomatePlacement = useCallback((zoneId, selectedInputs) => {
    const zone = zonesRef.current.find(z => z.id === zoneId);
    if (!zone) return;

    recordState();

    const models = selectedInputs
      .map(input => {
        if (typeof input === "string") {
          return getCameraForType(input);
        }
        return input; // Already a full camera model object
      })
      .filter(Boolean);

    if (models.length === 0) {
      alert("No camera models found in the database for the selected types.");
      return;
    }

    const poly = zone.polygon;
    const n = poly.length;
    if (n < 3) return;

    // Centroid (Center of the zone)
    let Cx = 0, Cy = 0;
    poly.forEach(p => { Cx += p.x; Cy += p.y; });
    Cx /= n;
    Cy /= n;

    const activePpm = Math.max(1, ppmRef.current || 22);

    // Calculate real-world metrics using visual tape calibration (ppm)
    let maxDistPx = 0;
    poly.forEach(vertex => {
      const d = Math.hypot(Cx - vertex.x, Cy - vertex.y);
      if (d > maxDistPx) maxDistPx = d;
    });
    const maxDistMeters = maxDistPx / activePpm;
    const areaMeters = getPolygonArea(poly, activePpm);

    const newPlaced = [];

    // 1. Fisheye / PTZ Smart Grid Distribution Check
    const fisheyeModel = models.find(m => m.type === "fisheye");
    const ptzModel = models.find(m => m.type === "ptz");
    const centerModel = fisheyeModel || ptzModel;

    const cornerModels = models.filter(m => m.type !== "fisheye" && m.type !== "ptz");
    const only360Selected = centerModel && cornerModels.length === 0;

    if (only360Selected) {
      if (centerModel.rangeDay >= maxDistMeters) {
        // If a single central Fisheye or PTZ covers the furthest corner, place just one
        newPlaced.push({
          id: `placed_${Date.now()}_center_${Math.random().toString(36).substr(2, 5)}`,
          camera: centerModel,
          x: Cx,
          y: Cy,
          direction: 0,
          recordingMode: "continuous",
          fps: 25,
          lighting: "normal",
          mounting: "default",
          includeBackbox: false,
          includePoe: false,
        });
      } else {
        // Multi-Fisheye Ceiling Grid Distribution: Place multiple 360° cameras evenly along the centerline/grid
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        poly.forEach(p => {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        });

        const W_px = maxX - minX;
        const H_px = maxY - minY;
        const W_m = W_px / activePpm;
        const H_m = H_px / activePpm;

        // Overlap coverage circles by 20% to guarantee full coverage
        const coverDiameter = centerModel.rangeDay * 1.6;
        const cols = Math.max(1, Math.ceil(W_m / coverDiameter));
        const rows = Math.max(1, Math.ceil(H_m / coverDiameter));

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const gridX = minX + ((c + 0.5) / cols) * W_px;
            const gridY = minY + ((r + 0.5) / rows) * H_px;

            if (pointInPolygon(gridX, gridY, poly)) {
              newPlaced.push({
                id: `placed_${Date.now()}_dist_${r}_${c}_${Math.random().toString(36).substr(2, 5)}`,
                camera: centerModel,
                x: gridX,
                y: gridY,
                direction: 0,
                recordingMode: "continuous",
                fps: 25,
                lighting: "normal",
                mounting: "default",
                includeBackbox: false,
                includePoe: false,
              });
            } else {
              // Find the closest point inside the polygon (useful for complex/L-shaped spaces)
              let bestPt = { x: Cx, y: Cy };
              let minPtDist = Infinity;
              for (let sx = minX; sx <= maxX; sx += W_px / 12) {
                for (let sy = minY; sy <= maxY; sy += H_px / 12) {
                  if (pointInPolygon(sx, sy, poly)) {
                    const d = Math.hypot(sx - gridX, sy - gridY);
                    if (d < minPtDist) {
                      minPtDist = d;
                      bestPt = { x: sx, y: sy };
                    }
                  }
                }
              }
              newPlaced.push({
                id: `placed_${Date.now()}_dist_${r}_${c}_${Math.random().toString(36).substr(2, 5)}`,
                camera: centerModel,
                x: bestPt.x,
                y: bestPt.y,
                direction: 0,
                recordingMode: "continuous",
                fps: 25,
                lighting: "normal",
                mounting: "default",
                includeBackbox: false,
                includePoe: false,
              });
            }
          }
        }
      }

      const outsideCameras = placedRef.current.filter(
        p => !pointInOrOnPolygon(p.x, p.y, zone.polygon)
      );
      const updatedPlaced = [...outsideCameras, ...newPlaced];
      placedRef.current = updatedPlaced;
      setPlaced(updatedPlaced);
      draw();
      apiSaveLayout({ placed: updatedPlaced, zones: zonesRef.current, ppm: ppmRef.current });
      return;
    }

    // 2. Smart Corner Placement for Directional Cameras (Dome/Bullet)
    const placementModels = cornerModels.length > 0 ? cornerModels : models;

     // Determine corner coverage indices based on room shape and area
     const cornersToPlace = [];
     const sampleCorner = placementModels[0];
     const rangeLimit = sampleCorner?.rangeDay || 20;

     if (n === 4 && (areaMeters < 350 || maxDistMeters * 2 < rangeLimit * 1.5)) {
       // Rectangular/square rooms: 2 diagonal corners are mathematically and practically sufficient
       cornersToPlace.push(0, 2);
     } else if (n === 3 && (areaMeters < 150 || maxDistMeters * 2 < rangeLimit * 1.5)) {
       // Triangular rooms: 2 corners are fully sufficient
       cornersToPlace.push(0, 2);
     } else {
       // Large or complex polygons: place on all corners
       for (let i = 0; i < n; i++) {
         cornersToPlace.push(i);
       }
     }

    // Check if room center is out of reach of the standard cameras (to flag central fallback)
    let centerOutOfReach = false;
    const sampleCornerModel = placementModels[0];
    const maxCoverageDistPx = (sampleCornerModel?.rangeDay || 20) * activePpm;

    poly.forEach((vertex, i) => {
      // Skip if this corner is not selected by our smart optimizer
      if (!cornersToPlace.includes(i)) return;

      const model = placementModels[i % placementModels.length];
      const distToCenterPx = Math.hypot(Cx - vertex.x, Cy - vertex.y);
      const distToCenterMeters = distToCenterPx / activePpm;

      if (distToCenterPx > maxCoverageDistPx) {
        centerOutOfReach = true;
      }

      // If a center camera was placed and covers this corner, skip placing a redundant corner camera
      if (centerModel && distToCenterMeters <= centerModel.rangeDay) {
        return;
      }

      // Check if this corner is already covered by an already placed directional corner camera
      let alreadyCovered = false;
      for (const p of newPlaced) {
        // Skip checking against the center camera since we already handled center-to-corner range above
        if (p.id.includes("_center")) continue;
        const distMeters = Math.hypot(vertex.x - p.x, vertex.y - p.y) / activePpm;
        // If a camera is already placed within 45% of this camera's range or within 8 meters, skip placing another
        if (distMeters < Math.max(8, model.rangeDay * 0.45)) {
          alreadyCovered = true;
          break;
        }
      }
      if (alreadyCovered) return;

      // Calculate perfect interior angle bisector pointing inwards
      const prev = poly[(i - 1 + n) % n];
      const next = poly[(i + 1) % n];

      // Vector 1 (from vertex to prev)
      const dx1 = prev.x - vertex.x;
      const dy1 = prev.y - vertex.y;
      const len1 = Math.hypot(dx1, dy1) || 1;
      const ux1 = dx1 / len1;
      const uy1 = dy1 / len1;

      // Vector 2 (from vertex to next)
      const dx2 = next.x - vertex.x;
      const dy2 = next.y - vertex.y;
      const len2 = Math.hypot(dx2, dy2) || 1;
      const ux2 = dx2 / len2;
      const uy2 = dy2 / len2;

      // Bisector vector (middle direction)
      let bx = ux1 + ux2;
      let by = uy1 + uy2;
      let lenB = Math.hypot(bx, by);

      // If collinear, point perpendicular to wall
      if (lenB < 0.01) {
        bx = -uy1;
        by = ux1;
        lenB = 1;
      }

      let ux = bx / lenB;
      let uy = by / lenB;

      // Ensure the bisector vector points inwards towards the centroid
      const dotVal = ux * (Cx - vertex.x) + uy * (Cy - vertex.y);
      if (dotVal < 0) {
        ux = -ux;
        uy = -uy;
      }

      const angleRad = Math.atan2(uy, ux);
      const direction = (angleRad * 180 / Math.PI + 360) % 360;

      newPlaced.push({
        id: `placed_${Date.now()}_corner_${i}_${Math.random().toString(36).substr(2, 5)}`,
        camera: model,
        x: vertex.x,
        y: vertex.y,
        direction: direction,
        recordingMode: "continuous",
        fps: 25,
        lighting: "normal",
        mounting: "default",
        includeBackbox: false,
        includePoe: false,
      });

      // 3. Smart Edge Midpoint (placed only if wall segment is longer than 75% of camera range)
      const nextVertex = poly[(i + 1) % n];
      const distPx = Math.hypot(nextVertex.x - vertex.x, nextVertex.y - vertex.y);
      if (distPx > maxCoverageDistPx * 0.75) {
        const Mx = (vertex.x + nextVertex.x) / 2;
        const My = (vertex.y + nextVertex.y) / 2;

        const dx = nextVertex.x - vertex.x;
        const dy = nextVertex.y - vertex.y;

        const nx1 = -dy;
        const ny1 = dx;
        const dot = (Cx - Mx) * nx1 + (Cy - My) * ny1;

        const nx = dot > 0 ? nx1 : -nx1;
        const ny = dot > 0 ? ny1 : -ny1;

        const angleNormal = Math.atan2(ny, nx);
        const dirNormal = (angleNormal * 180 / Math.PI + 360) % 360;

        newPlaced.push({
          id: `placed_${Date.now()}_edge_${i}_${Math.random().toString(36).substr(2, 5)}`,
          camera: placementModels[(i + 1) % placementModels.length],
          x: Mx,
          y: My,
          direction: dirNormal,
          recordingMode: "continuous",
          fps: 25,
          lighting: "normal",
          mounting: "default",
          includeBackbox: false,
          includePoe: false,
        });
      }
    });

    // Outside cameras retention check and save
    const outsideCameras = placedRef.current.filter(
      p => !pointInOrOnPolygon(p.x, p.y, zone.polygon)
    );

    const updatedPlaced = [...outsideCameras, ...newPlaced];

    placedRef.current = updatedPlaced;
    setPlaced(updatedPlaced);
    draw();
    apiSaveLayout({ placed: updatedPlaced, zones: zonesRef.current, ppm: ppmRef.current });
  }, [draw, getCameraForType]);

  // ── Mouse events ──────────────────────────────────────────────────────────
  const onMouseDown = useCallback(e => {
    if (e.button === 2) return;
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    const p = toImg(e.clientX, e.clientY);

    if (modeRef.current === "calibrate") {
      const pts = calPtsRef.current;
      if (pts.length === 0) {
        setCalPts([p]);
        calPtsRef.current = [p];
        draw();
      } else if (pts.length === 1) {
        const ptA = pts[0];
        const distPx = Math.hypot(p.x - ptA.x, p.y - ptA.y);
        setCalPts([ptA, p]);
        calPtsRef.current = [ptA, p];
        setCalibrateDistPx(distPx);
        setShowCalibrateModal(true);
        draw();
      }
      return;
    }

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

    if (nearRotHandle(p.x, p.y)) { recordState(); rotatingIdxRef.current = selectedIdx; return; }

    // Check if clicked near a vertex of a draft zone to start dragging it
    if (draftZonesRef.current.length > 0) {
      const grabRadius = 12 / scaleRef.current;
      let foundZoneId = null;
      let foundVertexIdx = null;
      for (const zone of draftZonesRef.current) {
        if (!zone.polygon) continue;
        for (let i = 0; i < zone.polygon.length; i++) {
          const pt = zone.polygon[i];
          if (Math.hypot(p.x - pt.x, p.y - pt.y) < grabRadius) {
            foundZoneId = zone.id;
            foundVertexIdx = i;
            break;
          }
        }
        if (foundZoneId !== null) break;
      }
      if (foundZoneId !== null) {
        draggingDraftZoneIdRef.current = foundZoneId;
        draggingDraftVertexIdxRef.current = foundVertexIdx;
        return;
      }
    }

    const idx = nearestPlaced(p.x, p.y);
    if (idx >= 0) {
      recordState();
      setSelectedIdx(idx);
      draggingIdxRef.current = idx;
      const cam = placedRef.current[idx];
      draggingCamZoneRef.current = zonesRef.current.find(
        z => z.polygon?.length >= 3 && pointInPolygon(cam.x, cam.y, z.polygon)
      ) || null;
      return;
    }
    setSelectedIdx(null);
    setActiveZoneId(null);
    activeZoneIdRef.current = null;
    setHighlightedCamId(null);

    // Check if clicked inside a draft (CV-detected) zone
    if (draftZonesRef.current.length > 0) {
      const clickedDraft = draftZonesRef.current.find(
        z => z.polygon?.length >= 3 && pointInPolygon(p.x, p.y, z.polygon)
      );
      if (clickedDraft) {
        showConfirm("Import Zone", `Import auto-detected "${clickedDraft.name}"?`, () => {
          recordState();
          const updatedDrafts = draftZonesRef.current.filter(z => z.id !== clickedDraft.id);
          setDraftZones(updatedDrafts);
          draftZonesRef.current = updatedDrafts;

          const colorIdx = zonesRef.current.length % ZONE_COLORS.length;
          const newImportedZone = {
            ...clickedDraft,
            id: "zone_" + Date.now(),
            color: ZONE_COLORS[colorIdx]
          };
          const updatedZones = [...zonesRef.current, newImportedZone];
          zonesRef.current = updatedZones;
          setZones(updatedZones);
          setActiveZoneId(newImportedZone.id);
          activeZoneIdRef.current = newImportedZone.id;
          apiSaveZones(updatedZones);
          setTimeout(() => zoomToZone(newImportedZone), 0);
          draw();
        });
        return;
      }
    }
  }, [selectedIdx, finishZoneDrawing, draw, draftZones, showConfirm, recordState]); // eslint-disable-line



  const onMouseMove = useCallback(e => {
    const p = toImg(e.clientX, e.clientY);
    setMouseMapPos(p);
    mouseMapPosRef.current = p;

    if (draggingDraftZoneIdRef.current !== null && draggingDraftVertexIdxRef.current !== null) {
      const zoneId = draggingDraftZoneIdRef.current;
      const vertexIdx = draggingDraftVertexIdxRef.current;
      const updatedDrafts = draftZonesRef.current.map(zone => {
        if (zone.id === zoneId) {
          const newPolygon = [...zone.polygon];
          newPolygon[vertexIdx] = { x: p.x, y: p.y };
          return { ...zone, polygon: newPolygon };
        }
        return zone;
      });
      draftZonesRef.current = updatedDrafts;
      setDraftZones(updatedDrafts);
      draw();
      return;
    }

    if (modeRef.current === "calibrate") {
      draw();
      return;
    }

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
    if (idx !== hoveredIdx) { setHoveredIdx(idx >= 0 ? idx : null); }
    draw();

    // Update cursor style
    if (modeRef.current !== "pan") {
      let cursor = "crosshair";
      if (draftZonesRef.current.length > 0) {
        const grabRadius = 12 / scaleRef.current;
        let nearVertex = false;
        for (const zone of draftZonesRef.current) {
          if (!zone.polygon) continue;
          for (const pt of zone.polygon) {
            if (Math.hypot(p.x - pt.x, p.y - pt.y) < grabRadius) {
              nearVertex = true;
              break;
            }
          }
          if (nearVertex) break;
        }
        if (nearVertex) {
          cursor = "move";
        }
      }
      if (e.target) {
        e.target.style.cursor = cursor;
      }
    }
  }, [draw, hoveredIdx]); // eslint-disable-line

  const onMouseUp = useCallback(() => {
    const wasDragging = draggingIdxRef.current !== null;
    const wasRotating = rotatingIdxRef.current !== null;
    draggingIdxRef.current = null;
    rotatingIdxRef.current = null;
    panStartRef.current = null;
    mouseDownPosRef.current = null;
    draggingCamZoneRef.current = null;
    draggingDraftZoneIdRef.current = null;
    draggingDraftVertexIdxRef.current = null;
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

    recordState();

    const newEntry = {
      camera,
      x: p.x,
      y: p.y,
      direction: 0,
      id: `placed_${Date.now()}`,
      recordingMode: "continuous",
      fps: 25,
      lighting: "normal",
      mounting: "default",
      includeBackbox: false,
      includePoe: false,
    };
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
    const name = file.name.replace(/\.[^/.]+$/, "");
    
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      const fileReader = new FileReader();
      fileReader.onload = async function() {
        try {
          const typedarray = new Uint8Array(this.result);
          const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 2.0 });
          
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          
          await page.render({ canvasContext: context, viewport: viewport }).promise;
          const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
          addNewSlide(dataUrl, name);
        } catch (err) {
          console.error("Failed to parse PDF", err);
          alert("Failed to parse PDF.");
        }
      };
      fileReader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = ev => {
        addNewSlide(ev.target.result, name);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  }

  // ── FIX 2: Remove floor plan — clears image and deletes from backend ──────
  function removeFloorPlan() {
    recordState();
    floorImgRef.current = null;
    setHasFloor(false);
    draw();
    apiDeleteFloorPlan();
  }

  // ── Clear all cameras from the floor (keeps floor plan image) ──────────────
  function clearFloorCameras() {
    showConfirm(
      "Clear All Cameras",
      "This will remove all placed cameras from the floor. The floor plan image will be kept. Do you want to proceed?",
      () => {
        recordState();
        placedRef.current = [];
        setPlaced([]);
        setSelectedIdx(null);
        setHighlightedCamId(null);
        highlightedCamIdRef.current = null;
        draw();
        apiSaveLayout({ placed: [], zones: zonesRef.current, ppm: ppmRef.current });
      }
    );
  }

  function removeSelected() {
    if (selectedIdx === null) return;
    recordState();
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
    recordState();
    const updated = zonesRef.current.filter(z => z.id !== id);
    zonesRef.current = updated; setZones(updated);
    if (activeZoneId === id) { setActiveZoneId(null); activeZoneIdRef.current = null; }
    draw();
    apiDeleteZone(id);
  }

  function handleRenameZone(id, newName) {
    const zone = zonesRef.current.find(z => z.id === id);
    if (!zone) return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    const exists = zonesRef.current.some(z => z.id !== id && z.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      alert("A zone with this name already exists.");
      return;
    }
    recordState();
    const updated = zonesRef.current.map(z => z.id === id ? { ...z, name: trimmed } : z);
    setZones(updated);
    zonesRef.current = updated;
    apiSaveZones(updated);
    draw();
  }

  function handleHighlightCam(camId) {
    const newId = highlightedCamId === camId ? null : camId;
    setHighlightedCamId(newId);
    highlightedCamIdRef.current = newId;
    if (newId) {
      zoomToCamera(newId);
      const idx = placedRef.current.findIndex(p => p.id === newId);
      if (idx !== -1) {
        setSelectedIdx(idx);
        setSelectedModel(placedRef.current[idx].camera);
      }
    } else {
      setSelectedIdx(null);
      setSelectedModel(null);
    }
    draw();
  }

  function handleRemoveCamFromZone(camId) {
    recordState();
    const updated = placedRef.current.filter(p => p.id !== camId);
    placedRef.current = updated; setPlaced(updated);
    if (highlightedCamId === camId) { setHighlightedCamId(null); highlightedCamIdRef.current = null; }
    if (selectedIdx !== null) setSelectedIdx(null);
    draw();
    apiSaveLayout({ placed: updated, zones: zonesRef.current, ppm: ppmRef.current });
  }

  // ── Heatmap helpers ───────────────────────────────────────────────────────
  const heatmapMarkers = placed.map(p => ({
    camId: p.id,
    x: p.x,
    y: p.y,
    fovAngle: p.camera.hfov,
    direction: p.direction,
    rangeDay: p.camera.rangeDay,
    ppm: ppm
  }));
  const heatmapCameras = placed.map(p => ({ id: p.id, status: "online" }));


  function exportPng(exportMode = "design") {
    const img = floorImgRef.current; if (!img) return;
    const oc = document.createElement("canvas");
    oc.width = img.width; oc.height = img.height;
    const ctx = oc.getContext("2d");
    ctx.drawImage(img, 0, 0);
    if (exportMode === "design") {
      // Draw zones — border only, no fill (matches live canvas)
      zonesRef.current.forEach(zone => {
        if (zone.polygon.length < 2) return;
        ctx.save(); ctx.beginPath();
        zone.polygon.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
        ctx.closePath();
        ctx.strokeStyle = zone.color + "ff";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Draw vertex dots
        zone.polygon.forEach(pt => {
          ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = zone.color; ctx.globalAlpha = 0.7; ctx.fill();
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
        });
        ctx.restore();
      });
      placedRef.current.forEach(p => drawPlacedCamera(ctx, p, ppm, false, false, zonesRef, activeZoneIdRef, null, false, showPpm));
      drawDesignLegendToCanvas(ctx, oc.width, oc.height, { placedCameras: placedRef.current, compact: true });
      // If Clarity Zones mode is active, also draw the DORI legend on the exported image
      if (showPpm) {
        drawDoriLegendToCanvas(ctx, oc.width, oc.height);
      }
    } else if (exportMode === "mapview_only_cams") {
      // Draw zones — border only, no fill (matches live canvas)
      zonesRef.current.forEach(zone => {
        if (zone.polygon.length < 2) return;
        ctx.save(); ctx.beginPath();
        zone.polygon.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
        ctx.closePath();
        ctx.strokeStyle = zone.color + "aa";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      });
      placedRef.current.forEach(p => drawPlacedCamera(ctx, p, ppm, false, false, zonesRef, activeZoneIdRef, null, false, false, true));
      // No legend drawn!
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
      placedRef.current.forEach(p => drawPlacedCamera(ctx, p, ppm, false, false, zonesRef, activeZoneIdRef, null, false, showPpm));
      drawHeatmapLegendToCanvas(ctx, oc.width, oc.height, { foundLevels, compact: true });
    }
    const a = document.createElement("a");
    a.download = exportMode === "heatmap" ? "coverage_heatmap.png" : exportMode === "mapview_only_cams" ? "map_view.png" : "designer_layout.png";
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
      background: "#161c28",
      borderRight: "1.5px solid rgba(46, 61, 85, 0.5)",
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
      borderBottom: "1px solid rgba(46, 61, 85, 0.5)",
      whiteSpace: "nowrap",
    },
    list: {
      flex: 1, overflowY: "auto", overflowX: "hidden",
      padding: "6px 4px",
    },
    sectionLabel: {
      fontSize: 13, fontWeight: 700, letterSpacing: "0.1em",
      textTransform: "uppercase", color: "#5aabf0",
      padding: "6px 6px 4px",
      whiteSpace: "nowrap",
      display: sidebarExpanded ? "block" : "none",
    },
    addBtn: {
      display: "flex", alignItems: "center", gap: 6,
      width: "100%", background: "none", border: "none",
      padding: "5px 6px", cursor: "pointer",
      color: "#5aabf0", fontSize: 15, textAlign: "left",
      borderRadius: 4,
      whiteSpace: "nowrap",
    },
    divider: {
      height: "0.5px", background: "rgba(46, 61, 85, 0.5)", margin: "6px 4px",
    },
  };
  const scaleParams = (() => {
    const sc = scaleRef.current || 1;
    const currentPpm = ppm;
    const oneMeterPx = currentPpm * sc;
    const idealWidthPx = 100;
    const rawMeters = idealWidthPx / oneMeterPx;
    const roundMetersOptions = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    let selectedMeters = roundMetersOptions[0];
    let minDiff = Math.abs(rawMeters - selectedMeters);
    for (let i = 1; i < roundMetersOptions.length; i++) {
      const diff = Math.abs(rawMeters - roundMetersOptions[i]);
      if (diff < minDiff) {
        minDiff = diff;
        selectedMeters = roundMetersOptions[i];
      }
    }
    return { meters: selectedMeters, width: selectedMeters * oneMeterPx };
  })();

  return (
    <div className="page-shell dv-root">

      {/* ── Combined Header + Top bar ── */}
      <div className="dv-topbar">
        {/* Left: Page Title */}
        <div className="dv-topbar__title-section" style={{ display: "flex", alignItems: "center", paddingRight: "20px" }}>
          <h1 className="page-title" style={{ fontSize: "28px", margin: 0 }}>Designer View</h1>
        </div>

        <div className="dv-topbar__actions" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            
            {/* ── File / Actions Dropdown ── */}
            <div className="dv-icon-drop-wrap" ref={fileDropRef}>
              <button
                className={`dv-icon-btn ${fileDropdownOpen ? "dv-icon-btn--active" : ""}`}
                onClick={() => {
                  setFileDropdownOpen(o => !o);
                  setModesDropdownOpen(false);
                  setLayersDropdownOpen(false);
                }}
                title="File & Actions"
              >
                {/* Folder/File icon */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span className="dv-icon-btn__label">File</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10" className={`dv-icon-btn__chevron ${fileDropdownOpen ? "open" : ""}`}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {fileDropdownOpen && (
                <div className="dv-dropdown-panel dv-dropdown-panel--file" style={{ minWidth: "260px" }}>
                  <div className="dv-dropdown-panel__title">Project File Actions</div>
                  
                  {/* Import Floor Plan */}
                  <button
                    className="dv-dropdown-item-btn"
                    onClick={() => { setFileDropdownOpen(false); fileInputRef.current?.click(); }}
                  >
                    <div className="dv-dropdown-item-btn__icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                      </svg>
                    </div>
                    <span>Import Floor Plan</span>
                  </button>

                  {/* Import JSON */}
                  <button
                    className="dv-dropdown-item-btn"
                    onClick={() => { setFileDropdownOpen(false); jsonFileInputRef.current?.click(); }}
                  >
                    <div className="dv-dropdown-item-btn__icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M16 8l-4-4-4 4M12 4v12" />
                      </svg>
                    </div>
                    <span>Import Layout JSON</span>
                  </button>

                  {/* Download JSON */}
                  <button
                    className="dv-dropdown-item-btn"
                    onClick={() => { setFileDropdownOpen(false); downloadJson(); }}
                  >
                    <div className="dv-dropdown-item-btn__icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 16V4M8 12l4 4 4-4" />
                      </svg>
                    </div>
                    <span>Download Layout JSON</span>
                  </button>

                  <div className="dv-dropdown-panel__title" style={{ marginTop: "10px" }}>Export Options</div>

                  {/* Export Designer View */}
                  <button
                    className="dv-dropdown-card"
                    disabled={placed.length === 0}
                    style={{ opacity: placed.length === 0 ? 0.4 : 1, cursor: placed.length === 0 ? "not-allowed" : "pointer" }}
                    onClick={() => { if (placed.length > 0) { setFileDropdownOpen(false); exportPng("design"); } }}
                  >
                    <div className="dv-dropdown-card__icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
                        <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
                      </svg>
                    </div>
                    <div className="dv-dropdown-card__body">
                      <span className="dv-dropdown-card__label">Export Designer View</span>
                      <span className="dv-dropdown-card__desc">Exact snapshot of current layout</span>
                    </div>
                  </button>

                  {/* Export Map View */}
                  <button
                    className="dv-dropdown-card"
                    disabled={placed.length === 0}
                    style={{ opacity: placed.length === 0 ? 0.4 : 1, cursor: placed.length === 0 ? "not-allowed" : "pointer" }}
                    onClick={() => { if (placed.length > 0) { setFileDropdownOpen(false); exportPng("mapview_only_cams"); } }}
                  >
                    <div className="dv-dropdown-card__icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
                        <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
                      </svg>
                    </div>
                    <div className="dv-dropdown-card__body">
                      <span className="dv-dropdown-card__label">Export Map View</span>
                      <span className="dv-dropdown-card__desc">Only cameras (no beams/legend)</span>
                    </div>
                  </button>

                  {/* Export Heatmap */}
                  <button
                    className="dv-dropdown-card"
                    disabled={placed.length === 0}
                    style={{ opacity: placed.length === 0 ? 0.4 : 1, cursor: placed.length === 0 ? "not-allowed" : "pointer" }}
                    onClick={() => { if (placed.length > 0) { setFileDropdownOpen(false); exportPng("heatmap"); } }}
                  >
                    <div className="dv-dropdown-card__icon dv-dropdown-card__icon--heatmap">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                      </svg>
                    </div>
                    <div className="dv-dropdown-card__body">
                      <span className="dv-dropdown-card__label">Export Heatmap</span>
                      <span className="dv-dropdown-card__desc">Coverage blind-spot intensity</span>
                    </div>
                  </button>

                  {hasFloor && (
                    <>
                      <div className="dv-dropdown-divider" style={{ margin: "8px 0" }} />
                      {/* Delete Floor Plan */}
                      <button
                        className="dv-dropdown-item-btn dv-dropdown-item-btn--danger"
                        onClick={() => { setFileDropdownOpen(false); removeFloorPlan(); }}
                      >
                        <div className="dv-dropdown-item-btn__icon">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/>
                          </svg>
                        </div>
                        <span>Delete Floor Plan</span>
                      </button>
                    </>
                  )}

                </div>
              )}
            </div>
            
            <input ref={fileInputRef} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={handleFileChange} />
            <input ref={jsonFileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleJsonImport} />

            {/* ── Modes Icon Button + Dropdown ── */}
            <div className="dv-icon-drop-wrap" ref={modesDropRef}>
              <button
                className={`dv-icon-btn ${
                  (modesDropdownOpen || mode !== "place") ? "dv-icon-btn--active" : ""
                }`}
                onClick={() => {
                  setModesDropdownOpen(o => !o);
                  setLayersDropdownOpen(false);
                  setFileDropdownOpen(false);
                }}
                title="Modes"
              >
                {/* Active mode icon */}
                {mode === "place" && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                    <circle cx="12" cy="12" r="3"/>
                    <circle cx="12" cy="12" r="8" strokeDasharray="3 3"/>
                  </svg>
                )}
                {mode === "pan" && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                    <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M12 3v18M3 12h18"/>
                  </svg>
                )}
                {mode === "zone" && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                  </svg>
                )}
                {mode === "calibrate" && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                    <path d="M4 19h16M4 5h16M12 5v14M8 12h8" />
                  </svg>
                )}
                
                <span className="dv-icon-btn__label">Modes</span>
                {mode !== "place" && <span className="dv-icon-btn__dot" />}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10" className={`dv-icon-btn__chevron ${modesDropdownOpen ? "open" : ""}`}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {modesDropdownOpen && (
                <div className="dv-dropdown-panel" style={{ minWidth: "250px" }}>
                  <div className="dv-dropdown-panel__title">Design Modes</div>
                  <div className="dv-dropdown-cards">

                    {/* Place Camera */}
                    <button
                      className={`dv-dropdown-card ${mode === "place" ? "dv-dropdown-card--active" : ""}`}
                      onClick={() => { setMode("place"); setCalPts([]); setModesDropdownOpen(false); draw(); }}
                    >
                      <div className="dv-dropdown-card__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <circle cx="12" cy="12" r="3"/>
                          <circle cx="12" cy="12" r="8" strokeDasharray="2 3"/>
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">Place Cam</span>
                        <span className="dv-dropdown-card__desc">Drag/click models to layout</span>
                      </div>
                      {mode === "place" && <span className="dv-dropdown-card__check">✓</span>}
                    </button>

                    {/* Pan Map */}
                    <button
                      className={`dv-dropdown-card ${mode === "pan" ? "dv-dropdown-card--active" : ""}`}
                      onClick={() => { setMode("pan"); setCalPts([]); setSelectedIdx(null); setSelectedModel(null); setModesDropdownOpen(false); draw(); }}
                    >
                      <div className="dv-dropdown-card__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M12 3v18M3 12h18"/>
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">Pan Map</span>
                        <span className="dv-dropdown-card__desc">Drag to navigate the floor layout</span>
                      </div>
                      {mode === "pan" && <span className="dv-dropdown-card__check">✓</span>}
                    </button>

                    {/* Draw Zone */}
                    <button
                      className={`dv-dropdown-card ${mode === "zone" ? "dv-dropdown-card--active" : ""}`}
                      onClick={() => { setMode("zone"); setCalPts([]); setSelectedIdx(null); setSelectedModel(null); drawingPointsRef.current = []; setDrawingPoints([]); setModesDropdownOpen(false); draw(); }}
                    >
                      <div className="dv-dropdown-card__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">Draw Zone</span>
                        <span className="dv-dropdown-card__desc">Click points to draw area boundaries</span>
                      </div>
                      {mode === "zone" && <span className="dv-dropdown-card__check">✓</span>}
                    </button>

                    {/* Calibrate */}
                    <button
                      className={`dv-dropdown-card ${mode === "calibrate" ? "dv-dropdown-card--active" : ""}`}
                      onClick={() => { setMode("calibrate"); setCalPts([]); setMouseMapPos(null); setSelectedIdx(null); setSelectedModel(null); setModesDropdownOpen(false); draw(); }}
                    >
                      <div className="dv-dropdown-card__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <path d="M4 19h16M4 5h16M12 5v14M8 12h8" />
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">Calibrate</span>
                        <span className="dv-dropdown-card__desc">Visually measure scale with tape line</span>
                      </div>
                      {mode === "calibrate" && <span className="dv-dropdown-card__check">✓</span>}
                    </button>

                    {/* Auto-Detect Zones */}
                    <button
                      className={`dv-dropdown-card ${isDetectingZones ? "dv-dropdown-card--loading" : ""}`}
                      disabled={isDetectingZones}
                      onClick={async () => {
                        setModesDropdownOpen(false);
                        if (isDetectingZones) return;
                        setIsDetectingZones(true);
                        try {
                          const r = await fetch(`${API}/api/designer/detect-zones`, {
                            method: "POST",
                            headers: getAuthHeaders(),
                            body: JSON.stringify({ map_id: MAP_ID, floor_id: FLOOR_ID, source: "designer" })
                          });
                          if (!r.ok) {
                            const errData = await r.json();
                            alert(`CV Zone detection failed: ${errData.detail || r.statusText}`);
                            return;
                          }
                          const data = await r.json();
                          if (data.success && data.zones?.length > 0) {
                            setDraftZones(data.zones);
                            draftZonesRef.current = data.zones;
                            alert(`Detected ${data.zones.length} potential zones. Hover/click inside them on the map to import!`);
                            draw();
                          } else {
                            alert("No distinct closed zones detected on this floor plan image.");
                          }
                        } catch (e) {
                          console.error(e);
                          alert("An error occurred during CV zone detection.");
                        } finally {
                          setIsDetectingZones(false);
                        }
                      }}
                    >
                      <div className="dv-dropdown-card__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">
                          {isDetectingZones ? "Detecting…" : "Auto-Detect"}
                        </span>
                        <span className="dv-dropdown-card__desc">AI detects boundaries from image</span>
                      </div>
                      {draftZones.length > 0 && !isDetectingZones && (
                        <span className="dv-dropdown-card__badge">{draftZones.length}</span>
                      )}
                      {isDetectingZones && <span className="dv-dropdown-card__spinner" />}
                    </button>

                  </div>
                </div>
              )}
            </div>

            {/* ── Layers Icon Button + Dropdown ── */}
            <div className="dv-icon-drop-wrap" ref={layersDropRef}>
              <button
                className={`dv-icon-btn ${
                  (showHeatmap || showPpm || layersDropdownOpen) ? "dv-icon-btn--active" : ""
                }`}
                onClick={() => {
                  setLayersDropdownOpen(o => !o);
                  setModesDropdownOpen(false);
                  setFileDropdownOpen(false);
                }}
                title="Layers"
              >
                {/* Layers stack icon */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                  <polyline points="2 17 12 22 22 17"/>
                  <polyline points="2 12 12 17 22 12"/>
                </svg>
                <span className="dv-icon-btn__label">Layers</span>
                {(showHeatmap || showPpm) && <span className="dv-icon-btn__dot" />}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10" className={`dv-icon-btn__chevron ${layersDropdownOpen ? "open" : ""}`}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {layersDropdownOpen && (
                <div className="dv-dropdown-panel" style={{ minWidth: "240px" }}>
                  <div className="dv-dropdown-panel__title">Map Layers</div>
                  <div className="dv-dropdown-cards">

                    {/* Heatmap */}
                    <button
                      className={`dv-dropdown-card ${showHeatmap ? "dv-dropdown-card--active" : ""}`}
                      onClick={() => { setShowHeatmap(h => !h); }}
                    >
                      <div className="dv-dropdown-card__icon dv-dropdown-card__icon--heatmap">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <circle cx="12" cy="12" r="3"/>
                          <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">Heatmap</span>
                        <span className="dv-dropdown-card__desc">Coverage blind-spot intensity overlay</span>
                      </div>
                      <div className={`dv-dropdown-card__toggle ${showHeatmap ? "dv-dropdown-card__toggle--on" : ""}`} />
                    </button>

                    {/* Clarity Zones (PPM) */}
                    <button
                      className={`dv-dropdown-card ${showPpm ? "dv-dropdown-card--active" : ""}`}
                      onClick={() => { setShowPpm(!showPpm); }}
                    >
                      <div className="dv-dropdown-card__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">Clarity Zones</span>
                        <span className="dv-dropdown-card__desc">PPM / DORI visual coverage categories</span>
                      </div>
                      <div className={`dv-dropdown-card__toggle ${showPpm ? "dv-dropdown-card__toggle--on" : ""}`} />
                    </button>

                  </div>
                </div>
              )}
            </div>

            <div className="dv-toolbar-divider" />

            {/* ── Undo / Redo ── */}
            <button className="dv-tbtn" onClick={handleUndo} disabled={undoStack.length === 0} title="Undo last action" style={{ padding: "4px 8px" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13">
                <path d="M3 7v6h6M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
              </svg>
            </button>
            <button className="dv-tbtn" onClick={handleRedo} disabled={redoStack.length === 0} title="Redo last action" style={{ padding: "4px 8px" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13">
                <path d="M21 7v6h-6M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7" />
              </svg>
            </button>

            {/* ── Hints ── */}
            {mode === "zone" && (
              <span className="dv-zone-hint" style={{ fontSize: "13px", color: "#F59E0B", background: "#F59E0B15", padding: "3px 10px", borderRadius: "99px", border: "0.5px solid #F59E0B55", whiteSpace: "nowrap" }}>
                {drawingPoints.length === 0
                  ? "Click map to start zone"
                  : drawingPoints.length < 3
                    ? `${drawingPoints.length} pt${drawingPoints.length > 1 ? "s" : ""}`
                    : "Click 1st point to close · Esc to cancel"}
              </span>
            )}

            {draftZones.length > 0 && (
              <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                <button
                  className="dv-tbtn"
                  style={{ borderColor: "#10b981", background: "#10b98122", color: "#10b981", padding: "4px 8px" }}
                  onClick={() => {
                    showConfirm("Import All Zones", `Import all ${draftZones.length} detected zones?`, () => {
                      const newImportedZones = draftZones.map((dz, idx) => {
                        const colorIdx = (zonesRef.current.length + idx) % ZONE_COLORS.length;
                        return {
                          ...dz,
                          id: "zone_" + (Date.now() + idx),
                          color: ZONE_COLORS[colorIdx]
                        };
                      });
                      const updatedZones = [...zonesRef.current, ...newImportedZones];
                      zonesRef.current = updatedZones;
                      setZones(updatedZones);
                      setDraftZones([]);
                      draftZonesRef.current = [];
                      apiSaveZones(updatedZones);
                      draw();
                      alert(`Successfully imported all ${newImportedZones.length} zones.`);
                    });
                  }}
                >
                  Import All ({draftZones.length})
                </button>
                <button
                  className="dv-tbtn"
                  style={{ borderColor: "#ef4444", background: "#ef444411", color: "#ef4444", padding: "4px 8px" }}
                  onClick={() => {
                    setDraftZones([]);
                    draftZonesRef.current = [];
                    draw();
                  }}
                >
                  Clear Drafts
                </button>
              </div>
            )}

          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>

            {/* ── Scale Widget ── */}
            <div className="dv-scale-control" style={{ display: "flex", alignItems: "center", gap: 4, marginRight: 8 }}>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>Scale:</span>
              <input type="number" min="4" max="100" value={ppm}
                onChange={e => {
                  const newPpm = Number(e.target.value) || PIXELS_PER_METRE;
                  setPpm(newPpm);
                  ppmRef.current = newPpm;
                  scheduleSave(placedRef.current, zonesRef.current, newPpm);
                  draw();
                }}
                style={{ width: "36px", padding: "3px 4px", background: "#0d1117", border: "0.5px solid #2e3d55", borderRadius: "4px", color: "#e8edf5", fontSize: "11.5px", textAlign: "center" }}
              />
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>px/m</span>
            </div>

            {selectedPlaced && (
              <button className="dv-tbtn dv-tbtn--danger" onClick={removeSelected} style={{ padding: "4px 8px" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12" style={{ marginRight: 2 }}>
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
                </svg>
                Remove
              </button>
            )}

            <button
              className={`dv-tbtn ${showStats ? "dv-tbtn--active" : ""}`}
              onClick={() => setShowStats(!showStats)}
              title="View proposal summary"
              style={{ padding: "4px 8px" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12" style={{ marginRight: 2 }}>
                <path d="M12 20V10M18 20V4M6 20v-4" />
              </svg>
              Proposal
            </button>

            <button
              className="dv-tbtn dv-tbtn--danger"
              onClick={clearFloorCameras}
              title="Remove all cameras from floor (keeps floor plan)"
              style={{ borderColor: "rgba(239, 68, 68, 0.25)", color: "#ef4444", background: "rgba(239, 68, 68, 0.05)", padding: "4px 8px" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12" style={{ marginRight: 2 }}>
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
              </svg>
              Clear Layout
            </button>

          </div>

        </div>
      </div>

      {/* ── Body ── */}
      <div className="dv-body">

        {/* ── Left Sidebar (Layout Slides like PowerPoint/Docs) ── */}
        <div 
          className="dv-slides-sidebar"
          style={{
            width: "220px",
            background: "#0d1117",
            borderRight: "0.5px solid #1e2d3e",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            overflow: "hidden",
            userSelect: "none"
          }}
        >
          <div 
            style={{
              padding: "12px 14px",
              borderBottom: "0.5px solid #1e2d3e",
              fontSize: "11px",
              fontWeight: "700",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "#7a8499",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <span>Floor Drafts ({slides.length})</span>
            <button
              onClick={() => addNewSlide(null)}
              style={{
                background: "rgba(59, 130, 246, 0.15)",
                border: "1px solid rgba(59, 130, 246, 0.4)",
                borderRadius: "4px",
                color: "#60a5fa",
                fontSize: "10px",
                padding: "2px 6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "2px",
                transition: "all 0.15s ease"
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(59, 130, 246, 0.25)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(59, 130, 246, 0.15)"; }}
              title="Add a new blank floor layout draft"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New
            </button>
          </div>

          <div 
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "10px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              scrollbarWidth: "thin",
              scrollbarColor: "#2e3d55 transparent"
            }}
          >
            {slides.map((slide, sIdx) => {
              const isActive = slide.id === activeSlideId;
              const camCount = slide.placed?.length || 0;
              const zoneCount = slide.zones?.length || 0;

              return (
                <div
                  key={slide.id}
                  onClick={() => switchSlide(slide.id)}
                  style={{
                    display: "flex",
                    gap: "8px",
                    cursor: "pointer",
                    position: "relative",
                    transition: "all 0.2s ease",
                    padding: "4px",
                    borderRadius: "6px",
                    background: isActive ? "rgba(59, 130, 246, 0.05)" : "transparent"
                  }}
                >
                  {/* Slide index number */}
                  <div 
                    style={{
                      fontSize: "11px",
                      fontWeight: "700",
                      color: isActive ? "#3b82f6" : "#4b5563",
                      width: "14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                  >
                    {sIdx + 1}
                  </div>

                  {/* Thumbnail Card Frame */}
                  <div 
                    className={`dv-slide-card ${isActive ? "active" : ""}`}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      background: "#10151f",
                      border: isActive ? "1.5px solid #3b82f6" : "1px solid #1e2d3e",
                      borderRadius: "6px",
                      overflow: "hidden",
                      transition: "all 0.15s ease",
                      boxShadow: isActive ? "0 0 10px rgba(59, 130, 246, 0.15)" : "none"
                    }}
                    onMouseEnter={e => {
                      if (!isActive) {
                        e.currentTarget.style.borderColor = "#2e3d55";
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isActive) {
                        e.currentTarget.style.borderColor = "#1e2d3e";
                      }
                    }}
                  >
                    {/* Thumbnail Image area */}
                    <div 
                      style={{
                        height: "80px",
                        background: "#070a0f",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                        borderBottom: "1px solid #1e2d3e",
                        overflow: "hidden"
                      }}
                    >
                      {slide.floorPlan ? (
                        <img 
                          src={slide.floorPlan} 
                          alt={slide.name} 
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            opacity: 0.85
                          }}
                        />
                      ) : (
                        <div 
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "4px",
                            color: "#4b5563"
                          }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                          </svg>
                          <span style={{ fontSize: "9px" }}>No Floor Plan</span>
                        </div>
                      )}

                      {/* Floating actions menu (e.g. Delete button on hover) */}
                      {slides.length > 1 && (
                        <button
                          onClick={(e) => deleteSlide(slide.id, e)}
                          style={{
                            position: "absolute",
                            top: "4px",
                            right: "4px",
                            background: "rgba(239, 68, 68, 0.8)",
                            border: "none",
                            borderRadius: "4px",
                            color: "#ffffff",
                            padding: "2px",
                            cursor: "pointer",
                            opacity: 0,
                            transition: "opacity 0.15s ease",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                          }}
                          className="dv-slide-delete-btn"
                          title="Delete layout draft"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Thumbnail description info */}
                    <div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: "2px" }}>
                      {editingSlideId === slide.id ? (
                        <input
                          type="text"
                          value={editingSlideName}
                          onChange={e => setEditingSlideName(e.target.value)}
                          onBlur={() => {
                            if (editingSlideName.trim()) {
                              renameSlide(slide.id, editingSlideName.trim());
                            }
                            setEditingSlideId(null);
                          }}
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              if (editingSlideName.trim()) {
                                renameSlide(slide.id, editingSlideName.trim());
                              }
                              setEditingSlideId(null);
                            } else if (e.key === "Escape") {
                              setEditingSlideId(null);
                            }
                          }}
                          onClick={e => e.stopPropagation()}
                          autoFocus
                          style={{
                            background: "#070a0f",
                            border: "1px solid #3b82f6",
                            borderRadius: "3px",
                            color: "#ffffff",
                            fontSize: "11px",
                            padding: "1px 4px",
                            width: "100%",
                            outline: "none"
                          }}
                        />
                      ) : (
                        <div 
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingSlideId(slide.id);
                            setEditingSlideName(slide.name);
                          }}
                          style={{
                            fontSize: "11px",
                            fontWeight: "600",
                            color: isActive ? "#60a5fa" : "#e2e8f0",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between"
                          }}
                          title="Double click to rename"
                        >
                          <span>{slide.name}</span>
                          <svg 
                            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10" 
                            style={{ opacity: 0.3, cursor: "pointer" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingSlideId(slide.id);
                              setEditingSlideName(slide.name);
                            }}
                          >
                            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                          </svg>
                        </div>
                      )}

                      {/* Counts stats line */}
                      <div style={{ fontSize: "9.5px", color: "#6b7280", marginTop: "2px" }}>
                        {camCount} Cam{camCount !== 1 ? "s" : ""} • {zoneCount} Zone{zoneCount !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Canvas ── */}
        <div className="dv-canvas-wrap" ref={wrapRef}
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
        >
          <canvas ref={canvasRef} className="dv-canvas"
            style={{ cursor: mode === "pan" ? "grab" : undefined }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onContextMenu={onContextMenu}
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

          {/* Floating Zoom HUD */}
          <div className="dv-zoom-hud">
            <button className="dv-zbtn dv-zbtn--fit" onClick={fitImage}>Fit</button>
            <div className="dv-zoom-hud-divider" style={{ width: "1px", height: "14px", background: "rgba(46, 61, 85, 0.5)", margin: "0 4px" }} />
            <button className="dv-zbtn" onClick={() => { const el = wrapRef.current; if (el) applyZoom(-0.2, el.clientWidth / 2, el.clientHeight / 2); }} title="Zoom Out">−</button>
            <span className="dv-zoom-label">{zoomPct}%</span>
            <button className="dv-zbtn" onClick={() => { const el = wrapRef.current; if (el) applyZoom(0.2, el.clientWidth / 2, el.clientHeight / 2); }} title="Zoom In">+</button>
          </div>

          {/* ── Floating DORI Legend ── */}
          {showPpm && (
            <div 
              className="dv-dori-legend"
              style={{
                position: "absolute",
                top: "14px",
                left: "14px",
                background: "rgba(13, 20, 32, 0.95)",
                border: "1px solid rgba(168, 85, 247, 0.6)",
                borderRadius: "10px",
                padding: "10px 14px",
                boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)",
                backdropFilter: "blur(10px)",
                zIndex: 9000,
                minWidth: "195px",
                userSelect: "none",
                pointerEvents: "none",
                display: "flex",
                flexDirection: "column",
                gap: "8px"
              }}
            >
              <div 
                className="dv-dori-legend__title"
                style={{
                  fontSize: "14px",
                  fontWeight: "800",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "#c084fc",
                  borderBottom: "0.5px solid rgba(255, 255, 255, 0.15)",
                  paddingBottom: "6px",
                  display: "flex",
                  alignItems: "center"
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" width="11" height="11" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4, color: "#a855f7" }}>
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
                DORI Zones 
              </div>
              <div 
                className="dv-dori-legend__items"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px"
                }}
              >
                <div 
                  className="dv-dori-legend__item"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}
                >
                  <span 
                    className="dv-dori-legend__color" 
                    style={{ 
                      width: "7px",
                      height: "7px",
                      borderRadius: "50%",
                      flexShrink: 0,
                      boxShadow: "0 0 4px #a855f7",
                      background: "#a855f7" 
                    }} 
                  />
                  <span 
                    className="dv-dori-legend__label"
                    style={{
                      fontSize: "10.5px",
                      color: "#cbd5e1"
                    }}
                  >
                    <strong style={{ color: "#ffffff", fontWeight: "700" }}>Identification</strong> (250+ px/m)
                  </span>
                </div>
                <div 
                  className="dv-dori-legend__item"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}
                >
                  <span 
                    className="dv-dori-legend__color" 
                    style={{ 
                      width: "7px",
                      height: "7px",
                      borderRadius: "50%",
                      flexShrink: 0,
                      boxShadow: "0 0 4px #f97316",
                      background: "#f97316" 
                    }} 
                  />
                  <span 
                    className="dv-dori-legend__label"
                    style={{
                      fontSize: "10.5px",
                      color: "#cbd5e1"
                    }}
                  >
                    <strong style={{ color: "#ffffff", fontWeight: "700" }}>Recognition</strong> (125+ px/m)
                  </span>
                </div>
                <div 
                  className="dv-dori-legend__item"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}
                >
                  <span 
                    className="dv-dori-legend__color" 
                    style={{ 
                      width: "7px",
                      height: "7px",
                      borderRadius: "50%",
                      flexShrink: 0,
                      boxShadow: "0 0 4px #eab308",
                      background: "#eab308" 
                    }} 
                  />
                  <span 
                    className="dv-dori-legend__label"
                    style={{
                      fontSize: "10.5px",
                      color: "#cbd5e1"
                    }}
                  >
                    <strong style={{ color: "#ffffff", fontWeight: "700" }}>Observation</strong> (62+ px/m)
                  </span>
                </div>
                <div 
                  className="dv-dori-legend__item"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}
                >
                  <span 
                    className="dv-dori-legend__color" 
                    style={{ 
                      width: "7px",
                      height: "7px",
                      borderRadius: "50%",
                      flexShrink: 0,
                      boxShadow: "0 0 4px #3b82f6",
                      background: "#3b82f6" 
                    }} 
                  />
                  <span 
                    className="dv-dori-legend__label"
                    style={{
                      fontSize: "10.5px",
                      color: "#cbd5e1"
                    }}
                  >
                    <strong style={{ color: "#ffffff", fontWeight: "700" }}>Detection</strong> (25+ px/m)
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ── Visual Scale Bar overlay ── */}
          {hasFloor && (
            <div className="dv-scale-bar-overlay" title={`Map Scale: ${ppm} px/m`}>
              <span className="dv-scale-bar-text">{scaleParams.meters} m</span>
              <div className="dv-scale-bar-line" style={{ width: scaleParams.width }} />
            </div>
          )}

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
            <div className="dv-selected-bar" style={{ pointerEvents: "auto" }}>
              {/* Column 1: Camera Basic Info */}
              <div style={{ display: "flex", flexDirection: "column", width: 250, gap: 12, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", width: "100%" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ marginTop: 2 }}>
                      <CameraIcon type={selectedPlaced.camera.type} size={18} color={TYPE_COLORS[selectedPlaced.camera.type]} />
                    </div>
                    <strong style={{ fontSize: 16, color: "#ffffff", fontWeight: "700", lineHeight: 1.3 }}>{selectedPlaced.camera.brand} {selectedPlaced.camera.model}</strong>
                  </div>
                  <button
                    onClick={() => setShowConfigDrawer(!showConfigDrawer)}
                    style={{
                      background: "none", border: "none", color: "rgba(255, 255, 255, 0.5)",
                      fontSize: showConfigDrawer ? 16 : 14, cursor: "pointer", padding: "4px",
                      display: "flex", alignItems: "center", justifyContent: "center", transition: "color 0.15s ease",
                      flexShrink: 0,
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = "#ffffff"}
                    onMouseLeave={e => e.currentTarget.style.color = "rgba(255, 255, 255, 0.5)"}
                    title={showConfigDrawer ? "Hide Configuration" : "Configure Camera"}
                  >
                    {showConfigDrawer ? "✕" : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                      </svg>
                    )}
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", background: "rgba(255,255,255,0.03)", padding: 12, borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 700, textTransform: "uppercase" }}>HFOV</span>
                    <span style={{ fontSize: 14, color: "#fff", fontWeight: 600 }}>{Math.round(selectedPlaced.camera.hfov)}°</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 700, textTransform: "uppercase" }}>Range</span>
                    <span style={{ fontSize: 14, color: "#fff", fontWeight: 600 }}>{selectedPlaced.camera.rangeDay} m</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 700, textTransform: "uppercase" }}>Direction</span>
                    <span style={{ fontSize: 14, color: "#fff", fontWeight: 600 }}>{Math.round(selectedPlaced.direction)}°</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 700, textTransform: "uppercase" }}>Zone</span>
                    {(() => {
                      const cz = zones.find(z => z.polygon.length >= 3 && pointInPolygon(selectedPlaced.x, selectedPlaced.y, z.polygon));
                      return cz ? (
                        <span style={{ fontSize: 13, color: cz.color, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 100 }}>{cz.name}</span>
                      ) : <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>None</span>;
                    })()}
                  </div>
                </div>

                {/* Varifocal zoom slider */}
                {selectedPlaced.camera.isVarifocal && (
                  <div className="dv-selected-bar__zoom" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "rgba(168, 85, 247, 0.1)", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(168, 85, 247, 0.2)" }}>
                    <label style={{ fontSize: 13, color: "#c084fc", fontWeight: 700, letterSpacing: "0.03em" }}>ZOOM</label>
                    <input
                      type="range"
                      min={selectedPlaced.camera.focalLength}
                      max={selectedPlaced.camera.focalLengthMax}
                      step="0.1"
                      value={selectedPlaced.currentFocalLength || selectedPlaced.camera.focalLength}
                      onChange={e => handleVarifocalChange(selectedIdx, Number(e.target.value))}
                      style={{ flex: 1, height: 4, cursor: "pointer", accentColor: "#a855f7", margin: "0 10px" }}
                    />
                    <span style={{ fontFamily: "monospace", fontSize: 13, color: "#c084fc", fontWeight: 600 }}>
                      {(selectedPlaced.currentFocalLength || selectedPlaced.camera.focalLength).toFixed(1)} mm
                    </span>
                  </div>
                )}
              </div>

              {/* Column 2: Collapsible Scenario & Accessories Settings */}
              {showConfigDrawer && (
                <div style={{
                  display: "flex", flexDirection: "column",
                  gap: 12, background: "#080c14", border: "0.5px solid #1e2d3e",
                  borderRadius: 8, padding: "12px 16px", width: 280,
                  animation: "dvSlideDown 0.2s ease-out forwards",
                }}>
                  {/* Column 1: Scenarios */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#3b82f6", letterSpacing: "0.05em", textTransform: "uppercase" }}>Recording Scenarios</div>
                    
                    {/* Recording Mode */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontSize: 16, color: "rgba(255, 255, 255, 0.5)", fontWeight: "500" }}>Schedule:</span>
                      <select
                        value={selectedPlaced.recordingMode || "continuous"}
                        onChange={e => handleCameraConfigChange(selectedIdx, "recordingMode", e.target.value)}
                        style={{
                          background: "#0d1117", border: "0.5px solid #2e3d55", borderRadius: 6,
                          color: "#e8edf5", fontSize: 16, padding: "4px 8px", outline: "none", width: 130, height: 28, cursor: "pointer"
                        }}
                      >
                        <option value="continuous">Continuous 24/7</option>
                        <option value="motion20">Motion (20% Act)</option>
                        <option value="motion50">Motion (50% Act)</option>
                        <option value="scheduled">Scheduled (12h)</option>
                      </select>
                    </div>

                    {/* FPS */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontSize: 16, color: "rgba(255, 255, 255, 0.5)", fontWeight: "500" }}>Frame Rate:</span>
                      <select
                        value={selectedPlaced.fps || 25}
                        onChange={e => handleCameraConfigChange(selectedIdx, "fps", Number(e.target.value))}
                        style={{
                          background: "#0d1117", border: "0.5px solid #2e3d55", borderRadius: 6,
                          color: "#e8edf5", fontSize: 16, padding: "4px 8px", outline: "none", width: 130, height: 28, cursor: "pointer"
                        }}
                      >
                        <option value="15">15 FPS</option>
                        <option value="25">25 FPS (Default)</option>
                        <option value="30">30 FPS (High)</option>
                      </select>
                    </div>

                    {/* Lighting */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontSize: 16, color: "rgba(255, 255, 255, 0.5)", fontWeight: "500" }}>Environment:</span>
                      <select
                        value={selectedPlaced.lighting || "normal"}
                        onChange={e => handleCameraConfigChange(selectedIdx, "lighting", e.target.value)}
                        style={{
                          background: "#0d1117", border: "0.5px solid #2e3d55", borderRadius: 6,
                          color: "#e8edf5", fontSize: 16, padding: "4px 8px", outline: "none", width: 130, height: 28, cursor: "pointer"
                        }}
                      >
                        <option value="normal">Daytime / Normal</option>
                        <option value="lowlight">Night / Low Light</option>
                        <option value="backlight">Backlight / WDR</option>
                      </select>
                    </div>
                  </div>

                  {/* Column 2: Mounting & Accessories */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "0.5px solid #1e2d3e", paddingTop: 16 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#f59e0b", letterSpacing: "0.05em", textTransform: "uppercase" }}>Mount & Accessories</div>
                    
                    {/* Mounting Bracket */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontSize: 16, color: "rgba(255, 255, 255, 0.5)", fontWeight: "500" }}>Bracket:</span>
                      <select
                        value={selectedPlaced.mounting || "default"}
                        onChange={e => handleCameraConfigChange(selectedIdx, "mounting", e.target.value)}
                        style={{
                          background: "#0d1117", border: "0.5px solid #2e3d55", borderRadius: 6,
                          color: "#e8edf5", fontSize: 16, padding: "4px 8px", outline: "none", width: 110, height: 28, cursor: "pointer"
                        }}
                      >
                        <option value="default">None</option>
                        <option value="wall">Wall Arm</option>
                        <option value="ceiling">Ceiling Pendant</option>
                        <option value="pole">Pole Adapter</option>
                        <option value="corner">Corner Mount</option>
                      </select>
                    </div>

                    {/* Accessories Checkboxes */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, color: "#cbd5e1", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={!!selectedPlaced.includeBackbox}
                          onChange={e => handleCameraConfigChange(selectedIdx, "includeBackbox", e.target.checked)}
                          style={{ accentColor: "#f59e0b", cursor: "pointer", width: 14, height: 14 }}
                        />
                        Weatherproof Backbox 
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, color: "#cbd5e1", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={!!selectedPlaced.includePoe}
                          onChange={e => handleCameraConfigChange(selectedIdx, "includePoe", e.target.checked)}
                          style={{ accentColor: "#f59e0b", cursor: "pointer", width: 14, height: 14 }}
                        />
                        PoE Midspan Injector 
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Spec detail panel ── */}
        {selectedModel && (
          <div style={{
            display: "flex",
            flexDirection: "column",
            width: 258,
            borderLeft: "0.5px solid #1e2d3e",
            borderRight: "0.5px solid #1e2d3e",
            background: "#0d1117",
            flexShrink: 0,
            position: "absolute",
            top: 0,
            bottom: 0,
            right: inspectorExpanded ? 252 : 48,
            zIndex: 9,
            boxShadow: "-8px 0 24px rgba(0,0,0,0.35)",
            transition: "right 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
          }}>
            <SpecPanel camera={selectedModel} onClose={() => setSelectedModel(null)} />
            <div className="dv-fov-overlay-panel">
              <div className="dv-fov-overlay__label">{selectedModel.model}</div>
              <FovVisualizer camera={selectedModel} />
            </div>
          </div>
        )}

        {/* ── Slide-out Tabbed Right Inspector Panel ── */}
        <div className={`dv-inspector ${inspectorExpanded ? "dv-inspector--expanded" : ""}`}>
          {!inspectorExpanded && (
            <button
              className="dv-inspector-toggle"
              onClick={() => setInspectorExpanded(true)}
              title="Expand Inspector"
            >
              ←
              <span className="dv-inspector-toggle__text">Inspector</span>
            </button>
          )}

          {inspectorExpanded && (
            <div className="dv-inspector-container">
              {/* Tab Selector */}
              <div className="dv-inspector-tabs" style={{ position: "relative", paddingRight: "36px" }}>
                <button
                  className={`dv-inspector-tab ${inspectorTab === "cameras" ? "dv-inspector-tab--active" : ""}`}
                  onClick={() => setInspectorTab("cameras")}
                >
                  Cameras ({filteredCameras.length})
                </button>
                <button
                  className={`dv-inspector-tab ${inspectorTab === "zones" ? "dv-inspector-tab--active" : ""}`}
                  onClick={() => setInspectorTab("zones")}
                >
                  Zones ({zones.length})
                </button>
                
                {/* Close Cross Button */}
                <button
                  className="dv-inspector-close-btn"
                  onClick={() => { setInspectorExpanded(false); setSelectedModel(null); }}
                  title="Collapse Inspector"
                  style={{
                    position: "absolute",
                    right: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "rgba(255, 255, 255, 0.5)",
                    fontSize: "18px",
                    fontWeight: "750",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "4px 6px",
                    borderRadius: "4px",
                    transition: "all 0.15s ease"
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Tab Content */}
              <div className="dv-inspector-content">
                {inspectorTab === "cameras" ? (
                  <div className="dv-inspector-flow">
                    <div className="dv-inspector-section-title">Available Devices</div>
                    
                    {/* Brand and Type Custom Dropdowns */}
                    <div className="dv-library__filters" style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
                      <input className="dv-search" placeholder="Search models…"
                        value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ padding: "6px 8px", background: "#0d1117", border: "0.5px solid #2e3d55", borderRadius: 4, color: "#e8edf5", fontSize: 15, outline: "none" }} />
                      <div className="dv-filter-row" style={{ display: "flex", gap: "5px" }}>
                        {/* Custom Brand Dropdown */}
                        <div className="dv-custom-select-wrap" style={{ position: "relative", flex: 1 }}>
                          <button
                            className="dv-select"
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", textAlign: "left" }}
                            onClick={() => { setBrandMenuOpen(!brandMenuOpen); setTypeMenuOpen(false); }}
                          >
                            <span>{brandFilter || "Brand"}</span>
                            <span style={{ fontSize: "12px", opacity: 0.7 }}>▼</span>
                          </button>
                          {brandMenuOpen && (
                            <div className="dv-custom-dropdown" style={{
                              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                              background: "#0d1117", border: "0.5px solid #2e3d55", borderRadius: "5px",
                              maxHeight: "180px", overflowY: "auto", zIndex: 100, padding: "4px",
                              boxShadow: "0 8px 24px rgba(0,0,0,0.5)"
                            }}>
                              <button
                                className="dv-custom-dropdown-item"
                                style={{
                                  width: "100%", background: "none", border: "none", color: "#cbd5e1",
                                  padding: "6px 8px", textAlign: "left", fontSize: "15px", cursor: "pointer",
                                  borderRadius: "4px", display: "block"
                                }}
                                onClick={() => { setBrandFilter(null); setBrandMenuOpen(false); }}
                              >
                                All Brands
                              </button>
                              {brands.map(b => (
                                <button
                                  key={b}
                                  className="dv-custom-dropdown-item"
                                  style={{
                                    width: "100%", background: b === brandFilter ? "rgba(24, 95, 165, 0.15)" : "none",
                                    border: "none", color: b === brandFilter ? "#5aabf0" : "#cbd5e1",
                                    padding: "6px 8px", textAlign: "left", fontSize: "15px", cursor: "pointer",
                                    borderRadius: "4px", display: "block"
                                  }}
                                  onClick={() => { setBrandFilter(b); setBrandMenuOpen(false); }}
                                >
                                  {b}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Custom Type Dropdown */}
                        <div className="dv-custom-select-wrap" style={{ position: "relative", flex: 1 }}>
                          <button
                            className="dv-select"
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", textAlign: "left" }}
                            onClick={() => { setTypeMenuOpen(!typeMenuOpen); setBrandMenuOpen(false); }}
                          >
                            <span>
                              {typeFilter ? `${TYPE_ICONS[typeFilter]} ${typeFilter.charAt(0).toUpperCase() + typeFilter.slice(1)}` : "Type"}
                            </span>
                            <span style={{ fontSize: "12px", opacity: 0.7 }}>▼</span>
                          </button>
                          {typeMenuOpen && (
                            <div className="dv-custom-dropdown" style={{
                              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                              background: "#0d1117", border: "0.5px solid #2e3d55", borderRadius: "5px",
                              zIndex: 100, padding: "4px", boxShadow: "0 8px 24px rgba(0,0,0,0.5)"
                            }}>
                              <button
                                className="dv-custom-dropdown-item"
                                style={{
                                  width: "100%", background: "none", border: "none", color: "#cbd5e1",
                                  padding: "6px 8px", textAlign: "left", fontSize: "15px", cursor: "pointer",
                                  borderRadius: "4px", display: "block"
                                }}
                                onClick={() => { setTypeFilter(null); setTypeMenuOpen(false); }}
                              >
                                All Types
                              </button>
                              {["dome", "bullet", "ptz", "fisheye", "box", "thermal"].map(t => (
                                <button
                                  key={t}
                                  className="dv-custom-dropdown-item"
                                  style={{
                                    width: "100%", background: t === typeFilter ? "rgba(24, 95, 165, 0.15)" : "none",
                                    border: "none", color: t === typeFilter ? "#5aabf0" : "#cbd5e1",
                                    padding: "6px 8px", textAlign: "left", fontSize: "15px", cursor: "pointer",
                                    borderRadius: "4px", display: "block"
                                  }}
                                  onClick={() => { setTypeFilter(t); setTypeMenuOpen(false); }}
                                >
                                  {TYPE_ICONS[t]} {t.charAt(0).toUpperCase() + t.slice(1)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Camera Model List */}
                    <div className="dv-model-list" style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}>
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

                    {!selectedModel && (
                      <div className="dv-cam-selector__hint dv-cam-selector__hint--empty"
                        style={{ padding: "6px 10px 8px", borderTop: "1px solid #1e2d3e", marginTop: 4, fontSize: 14, color: "rgba(255, 255, 255, 0.5)", textAlign: "center" }}>
                        Drag a card onto the canvas to place · Click to preview FOV
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="dv-inspector-flow">
                    <div className="dv-inspector-section-title">Floor Zones</div>
                    
                    <div className="dv-zone-scroller">
                      {zones.length === 0 ? (
                        <div style={{ padding: "10px 8px", fontSize: 14, color: "rgba(255, 255, 255, 0.5)", textAlign: "center" }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" width="22" height="22" style={{ opacity: 0.25, display: "block", margin: "0 auto 6px" }}>
                            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                          </svg>
                          No zones yet
                        </div>
                      ) : (
                        zones.map(zone => (
                          <DvZoneSidebarItem
                            key={zone.id}
                            zone={zone}
                            placed={placed}
                            isActive={activeZoneId === zone.id}
                            highlightedId={highlightedCamId}
                            onSelect={handleSelectZone}
                            onDelete={handleDeleteZone}
                            onRename={handleRenameZone}
                            onHighlightCam={handleHighlightCam}
                            onRemoveCam={handleRemoveCamFromZone}
                            sidebarExpanded={true}
                            onContextMenu={(e) => onSidebarZoneContextMenu(e, zone)}
                          />
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>

      {showZoneNameModal && (
        <ZoneNameModal
          onSave={saveZone}
          onCancel={cancelZoneDrawing}
          existingNames={zones.map(z => z.name)}
        />
      )}

      {showStats && (
        <ProjectStatsPanel
          placed={placed}
          retentionDays={retentionDays}
          setRetentionDays={setRetentionDays}
          onClose={() => setShowStats(false)}
          cameraPrices={cameraPrices}
          setCameraPrices={setCameraPrices}
          accessoryPrices={accessoryPrices}
          setAccessoryPrices={setAccessoryPrices}
          nvrPrice={nvrPrice}
          setNvrPrice={setNvrPrice}
          switchUnitPrice={switchUnitPrice}
          setSwitchUnitPrice={setSwitchUnitPrice}
        />
      )}

      {contextMenu && (
        <div
          className="dv-context-menu"
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 1000,
          }}
          onClick={e => e.stopPropagation()}
        >
          <button className="dv-ctx-item" onClick={() => handleAutomateClick(contextMenu.zone)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginRight: 6 }}>
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            Automate Placement
          </button>
        </div>
      )}

      {showAutomationModal && automationZone && (
        <AutomationModal
          zone={automationZone}
          ppm={ppm}
          cameraDB={cameraDB}
          getCameraForType={getCameraForType}
          onConfirm={(selectedModels) => {
            handleAutomatePlacement(automationZone.id, selectedModels);
            setShowAutomationModal(false);
            setAutomationZone(null);
          }}
          onCancel={() => {
            setShowAutomationModal(false);
            setAutomationZone(null);
          }}
        />
      )}


      {showCalibrateModal && (
        <div className="dv-automate-overlay">
          <div className="dv-stats-panel" style={{ width: 380, padding: 20 }}>
            <div className="dv-stats-panel__header" style={{ borderBottom: "1px solid #1e2d3e", paddingBottom: 12, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="dv-stats-panel__icon" style={{ background: "#f59e0b15", color: "#f59e0b" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <line x1="5" y1="9" x2="5" y2="15" />
                    <line x1="10" y1="9" x2="10" y2="15" />
                    <line x1="15" y1="9" x2="15" y2="15" />
                    <line x1="20" y1="9" x2="20" y2="15" />
                  </svg>
                </div>
                <div>
                  <div className="dv-stats-panel__title" style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>Calibrate Map Scale</div>
                  <div className="dv-stats-panel__sub" style={{ fontSize: 15, color: "rgba(255, 255, 255, 0.5)" }}>Define real-world distance</div>
                </div>
              </div>
              <button className="dv-stats-panel__close" onClick={() => {
                setCalPts([]);
                calPtsRef.current = [];
                setShowCalibrateModal(false);
                setMode("pan");
                draw();
              }}>✕</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ fontSize: 16, color: "rgba(255, 255, 255, 0.5)", lineHeight: 1.5 }}>
                You have drawn a line of <strong style={{ color: "#f59e0b" }}>{Math.round(calibrateDistPx)} pixels</strong> on the map.
                Specify the physical distance in meters to calculate the scale.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 15, fontWeight: 600, color: "#cbd5e1" }}>Real-World Distance (meters)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="number"
                    step="any"
                    value={calibrateRealMeters}
                    onChange={e => setCalibrateRealMeters(e.target.value)}
                    style={{
                      flex: 1,
                      background: "#0d1117",
                      border: "1px solid #2e3d55",
                      borderRadius: 4,
                      color: "#e8edf5",
                      fontSize: 17,
                      padding: "8px 10px",
                      outline: "none"
                    }}
                    placeholder="e.g. 5.0"
                    autoFocus
                  />
                  <span style={{ fontSize: 17, color: "rgba(255, 255, 255, 0.5)" }}>meters</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button
                  className="mv-modal__btn mv-modal__btn--cancel"
                  onClick={() => {
                    setCalPts([]);
                    calPtsRef.current = [];
                    setShowCalibrateModal(false);
                    setMode("pan");
                    draw();
                  }}
                  style={{
                    background: "transparent",
                    border: "1px solid #2e3d55",
                    borderRadius: 4,
                    color: "rgba(255, 255, 255, 0.5)",
                    padding: "8px 16px",
                    cursor: "pointer",
                    fontSize: 16
                  }}
                >
                  Cancel
                </button>
                <button
                  className="mv-modal__btn mv-modal__btn--confirm"
                  onClick={() => {
                    const meters = parseFloat(calibrateRealMeters);
                    if (meters > 0 && calibrateDistPx > 0) {
                      const newPpm = calibrateDistPx / meters;
                      setPpm(newPpm);
                      ppmRef.current = newPpm;
                      scheduleSave(placedRef.current, zonesRef.current, newPpm);
                    }
                    setCalPts([]);
                    calPtsRef.current = [];
                    setShowCalibrateModal(false);
                    setMode("pan");
                    draw();
                  }}
                  style={{
                    background: "#f59e0b",
                    border: "none",
                    borderRadius: 4,
                    color: "#000",
                    fontWeight: 700,
                    padding: "8px 16px",
                    cursor: "pointer",
                    fontSize: 16
                  }}
                >
                  Apply Scale
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PremiumPopup {...popupState} />
    </div>
  );
}


// ── Project Stats Panel ───────────────────────────────────────────────
function ProjectStatsPanel({
  placed,
  retentionDays,
  setRetentionDays,
  onClose,
  cameraPrices,
  setCameraPrices,
  accessoryPrices,
  setAccessoryPrices,
  nvrPrice,
  setNvrPrice,
  switchUnitPrice,
  setSwitchUnitPrice
}) {
  const [codec, setCodec] = useState("h265");
  const [activeTab, setActiveTab] = useState("perf"); // "perf" | "bom"

  const cameraCount = placed.length;

  // Use dynamic camera scenario calculations for realistic project bandwidth
  const bitrates = placed.map(p => CctvCalc.estimateCameraBitrate(p, codec));

  const totalBandwidth = bitrates.reduce((sum, b) => sum + b, 0);
  const avgBitrate = cameraCount > 0 ? totalBandwidth / cameraCount : 0;
  const totalFPS = placed.reduce((sum, p) => sum + (p.fps || 25), 0);
  const avgFPS = cameraCount > 0 ? totalFPS / cameraCount : 0;
  const totalStorageGB = cameraCount > 0
    ? (totalBandwidth * 3600 * 24 * retentionDays) / (8 * 1024)
    : 0;
  const totalStorageTB = totalStorageGB / 1024;
  const hardware = CctvCalc.getHardwareRecommendations(cameraCount);

  const typeCounts = {};
  placed.forEach(p => {
    const t = p.camera.type || "dome";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  const handleDownloadReport = () => {
    const reportData = {
      cameraCount,
      avgBitrate,
      avgFPS,
      retentionDays,
      codec: codec.toUpperCase(),
      totalBandwidth,
      totalStorageGB,
      totalStorageTB,
      dailyStoragePerCamGB: avgBitrate * 3600 * 24 / (8 * 1024),
      dailyStorageTotalGB: totalBandwidth * 3600 * 24 / (8 * 1024),
    };
    const img = new Image();
    img.onload = () => {
      reportData.logoImg = img;
      const dataUrl = drawStorageReport(reportData);
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `Storage_Report_${codec.toUpperCase()}.png`;
      link.click();
    };
    img.onerror = () => {
      const dataUrl = drawStorageReport(reportData);
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `Storage_Report_${codec.toUpperCase()}.png`;
      link.click();
    };
    img.src = logoImg;
  };

  // Helper to get base price for a placed camera
  const getCameraBaseVal = (p) => {
    return cameraPrices[p.id] !== undefined ? cameraPrices[p.id] : 0;
  };

  // Helper to get accessory price for a placed camera
  const getCameraAccVal = (p) => {
    return accessoryPrices[p.id] !== undefined ? accessoryPrices[p.id] : 0;
  };

  // Generate and download professional client-facing CSV quotation in INR
  const handleExportCSV = () => {
    const csvRows = [
      ["Item Type", "Model/Part", "Qty", "Recording Scenario", "Mounting Bracket", "Accessories Included", "Unit Price (INR)", "Accessories Price (INR)", "Total Line Cost (INR)"]
    ];
    
    // 1. Add individual camera configurations
    placed.forEach((p) => {
      const accessories = [];
      if (p.includeBackbox) accessories.push("Weatherproof Backbox");
      if (p.includePoe) accessories.push("PoE Injector");
      
      const cPrice = getCameraBaseVal(p);
      const aPrice = getCameraAccVal(p);

      csvRows.push([
        (p.camera.type || "dome").toUpperCase(),
        `${p.camera.brand} ${p.camera.model}`,
        "1",
        `Rec: ${p.recordingMode || "continuous"} · FPS: ${p.fps || 25} · Light: ${p.lighting || "normal"}`,
        p.mounting && p.mounting !== "default" ? `${p.mounting} arm` : "Standard bracket",
        accessories.join(" + ") || "None",
        `Rs. ${cPrice}`,
        `Rs. ${aPrice}`,
        `Rs. ${cPrice + aPrice}`
      ]);
    });
    
    if (cameraCount > 0) {
      // 2. Add Network Video Recorder
      csvRows.push([
        "INFRASTRUCTURE",
        hardware.nvr,
        "1",
        "Enterprise Server Config",
        "—",
        "—",
        `Rs. ${nvrPrice}`,
        "Rs. 0",
        `Rs. ${nvrPrice}`
      ]);
      
      // 3. Add PoE Switches
      csvRows.push([
        "INFRASTRUCTURE",
        "8-Port PoE Switch",
        hardware.switchesCount.toString(),
        "Gigabit Power-over-Ethernet",
        "—",
        "—",
        `Rs. ${switchUnitPrice}`,
        "Rs. 0",
        `Rs. ${switchUnitPrice * hardware.switchesCount}`
      ]);
    }
    
    // Combined calculations
    const totalCamBaseINR = placed.reduce((sum, p) => sum + getCameraBaseVal(p), 0);
    const totalCamAccINR = placed.reduce((sum, p) => sum + getCameraAccVal(p), 0);
    const totalInfraINR = cameraCount > 0 ? (nvrPrice + switchUnitPrice * hardware.switchesCount) : 0;
    const grandTotalINR = totalCamBaseINR + totalCamAccINR + totalInfraINR;
    
    csvRows.push([]);
    csvRows.push(["", "", "", "", "", "Cameras Base Subtotal", "", "", `Rs. ${totalCamBaseINR}`]);
    csvRows.push(["", "", "", "", "", "Accessories Subtotal", "", "", `Rs. ${totalCamAccINR}`]);
    csvRows.push(["", "", "", "", "", "Infrastructure Subtotal", "", "", `Rs. ${totalInfraINR}`]);
    csvRows.push(["", "", "", "", "", "GRAND SURVEILLANCE TOTAL", "", "", `Rs. ${grandTotalINR}`]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + csvRows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(",")).join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "Surveillance_Project_BOM_Quote_INR.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="dv-stats-overlay" onClick={onClose}>
      <div className="dv-stats-panel" style={{ width: activeTab === "bom" ? 720 : 560, maxWidth: "90vw", transition: "width 0.2s" }} onClick={e => e.stopPropagation()}>
        <div className="dv-stats-panel__header" style={{ borderBottom: "none", paddingBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="dv-stats-panel__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <path d="M12 20V10M18 20V4M6 20v-4" />
              </svg>
            </div>
            <div>
              <div className="dv-stats-panel__title">Proposal Summary</div>
              <div className="dv-stats-panel__sub">Automated calculations based on layout</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {activeTab === "perf" ? (
              <button className="dv-stats-panel__download" onClick={handleDownloadReport} title="Download Infographic Report">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                Download Report
              </button>
            ) : (
              <>
                <button className="dv-stats-panel__download" onClick={handleExportCSV} title="Export Bill of Materials to CSV">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Export CSV
                </button>
                <button
                  className="dv-stats-panel__download"
                  onClick={() => window.print()}
                  title="Print Sales Quote / Proposal"
                  style={{ background: "#a855f722", borderColor: "#a855f7", color: "#c084fc" }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                    <path d="M6 14h12v8H6z" />
                  </svg>
                  Print Proposal
                </button>
              </>
            )}
            <button className="dv-stats-panel__close" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Tab Buttons */}
        <div style={{ display: "flex", borderBottom: "1px solid #1e2d3e", background: "#090d13", padding: "0 20px" }}>
          <button
            onClick={() => setActiveTab("perf")}
            style={{
              padding: "12px 18px",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "perf" ? "2px solid #3b82f6" : "2px solid transparent",
              color: activeTab === "perf" ? "#3b82f6" : "rgba(255, 255, 255, 0.5)",
              fontWeight: 700,
              fontSize: 16,
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            Storage & Performance
          </button>
          {/* 
          <button
            onClick={() => setActiveTab("bom")}
            style={{
              padding: "12px 18px",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "bom" ? "2px solid #a855f7" : "2px solid transparent",
              color: activeTab === "bom" ? "#a855f7" : "rgba(255, 255, 255, 0.5)",
              fontWeight: 700,
              fontSize: 16,
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            Material & Quotation
          </button>
          */}
        </div>

        <div className="dv-stats-panel__content" style={{ maxHeight: "calc(80vh - 120px)", overflowY: "auto", padding: "16px 20px 20px" }}>
          {activeTab === "bom" ? (
            <div className="dv-bom-container" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: "#e8edf5" }}>Surveillance Proposal & Sales Quotation</span>
                <span style={{ fontSize: 15, color: "rgba(255, 255, 255, 0.5)" }}>Tax and installation calculated separately</span>
              </div>
              
              <div className="dv-bom-table-wrapper" style={{ overflowX: "auto", borderRadius: 6, border: "1px solid #1e2d3e" }}>
                <table className="dv-bom-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 15, color: "#cbd5e1" }}>
                  <thead>
                    <tr style={{ background: "#0f172a", borderBottom: "1px solid #1e2d3e", textAlign: "left" }}>
                      <th style={{ padding: "10px 12px", color: "rgba(255, 255, 255, 0.5)", fontWeight: 700 }}>Item Type</th>
                      <th style={{ padding: "10px 12px", color: "rgba(255, 255, 255, 0.5)", fontWeight: 700 }}>Model / Description</th>
                      <th style={{ padding: "10px 12px", color: "rgba(255, 255, 255, 0.5)", fontWeight: 700, textAlign: "center" }}>Qty</th>
                      <th style={{ padding: "10px 12px", color: "rgba(255, 255, 255, 0.5)", fontWeight: 700 }}>Accessories & Mount</th>
                      <th style={{ padding: "10px 12px", color: "rgba(255, 255, 255, 0.5)", fontWeight: 700, textAlign: "right" }}>Camera Price (₹)</th>
                      <th style={{ padding: "10px 12px", color: "rgba(255, 255, 255, 0.5)", fontWeight: 700, textAlign: "right" }}>Acc. Price (₹)</th>
                      <th style={{ padding: "10px 12px", color: "rgba(255, 255, 255, 0.5)", fontWeight: 700, textAlign: "right" }}>Total (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Group placed cameras by brand+model key
                      const groups = {};
                      placed.forEach((p) => {
                        const key = `${p.camera.brand}__${p.camera.model}__${p.camera.type}`;
                        if (!groups[key]) {
                          groups[key] = { p, qty: 0, ids: [] };
                        }
                        groups[key].qty += 1;
                        groups[key].ids.push(p.id);
                      });

                      return Object.values(groups).map(({ p, qty, ids }, idx) => {
                        // Use the first id as the key for price lookup
                        const groupKey = ids[0];
                        // Camera price: empty string means unset
                        const rawCamPrice = cameraPrices[groupKey];
                        const camPriceVal = rawCamPrice !== undefined ? rawCamPrice : "";
                        // Accessory price: empty string means unset
                        const rawAccPrice = accessoryPrices[groupKey];
                        const accPriceVal = rawAccPrice !== undefined ? rawAccPrice : "";

                        const camNum = camPriceVal !== "" ? Number(camPriceVal) : null;
                        const accNum = accPriceVal !== "" ? Number(accPriceVal) : null;
                        const lineTotal = (camNum !== null && accNum !== null)
                          ? (camNum + accNum) * qty
                          : camNum !== null ? camNum * qty : null;

                        const accessories = [];
                        if (p.mounting && p.mounting !== "default") accessories.push(`${p.mounting} arm`);
                        if (p.includeBackbox) accessories.push("backbox");
                        if (p.includePoe) accessories.push("PoE");

                        return (
                          <tr key={groupKey} style={{ borderBottom: "1px solid #1e2d3e", background: idx % 2 === 0 ? "#0d1117" : "#090d13" }}>
                            <td style={{ padding: "10px 12px", textTransform: "uppercase", fontWeight: 700, fontSize: 14, color: "rgba(255, 255, 255, 0.5)" }}>
                              {p.camera.type || "dome"}
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ fontWeight: 600, color: "#f8fafc" }}>{p.camera.brand} {p.camera.model}</div>
                              <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.5)", marginTop: 2 }}>
                                {p.recordingMode || "continuous"} · {p.fps || 25} FPS · {p.lighting || "normal"}
                              </div>
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700 }}>{qty}</td>
                            <td style={{ padding: "10px 12px", color: "#cbd5e1" }}>
                              {accessories.length > 0 ? accessories.join(" + ") : "None"}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                                <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>₹</span>
                                <input
                                  type="number"
                                  placeholder="—"
                                  value={camPriceVal}
                                  onChange={(e) => {
                                    const val = e.target.value === "" ? undefined : Number(e.target.value);
                                    // Apply the same unit price to all ids in this group
                                    setCameraPrices(prev => {
                                      const next = { ...prev };
                                      ids.forEach(id => {
                                        if (val === undefined) delete next[id];
                                        else next[id] = val;
                                      });
                                      return next;
                                    });
                                  }}
                                  className="dv-bom-input"
                                  style={{
                                    width: "75px",
                                    background: "#0b0f1a",
                                    border: "0.5px solid #2e3d55",
                                    borderRadius: 4,
                                    color: "#e8edf5",
                                    padding: "2px 4px",
                                    textAlign: "right",
                                    fontSize: 15,
                                    fontFamily: "monospace",
                                    outline: "none",
                                  }}
                                />
                              </div>
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                                <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>₹</span>
                                <input
                                  type="number"
                                  placeholder="—"
                                  value={accPriceVal}
                                  onChange={(e) => {
                                    const val = e.target.value === "" ? undefined : Number(e.target.value);
                                    setAccessoryPrices(prev => {
                                      const next = { ...prev };
                                      ids.forEach(id => {
                                        if (val === undefined) delete next[id];
                                        else next[id] = val;
                                      });
                                      return next;
                                    });
                                  }}
                                  className="dv-bom-input"
                                  style={{
                                    width: "65px",
                                    background: "#0b0f1a",
                                    border: "0.5px solid #2e3d55",
                                    borderRadius: 4,
                                    color: "#e8edf5",
                                    padding: "2px 4px",
                                    textAlign: "right",
                                    fontSize: 15,
                                    fontFamily: "monospace",
                                    outline: "none",
                                  }}
                                />
                              </div>
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace", color: "#a855f7", fontWeight: 700 }}>
                              {lineTotal !== null ? `₹${lineTotal.toLocaleString("en-IN")}` : "—"}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                    
                    {placed.length > 0 && (
                      <>
                        {/* Infrastructure rows */}
                        <tr style={{ borderBottom: "1px solid #1e2d3e", background: "#090d13" }}>
                          <td style={{ padding: "10px 12px", textTransform: "uppercase", fontWeight: 700, fontSize: 14, color: "#f59e0b" }}>NVR</td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ fontWeight: 600, color: "#f8fafc" }}>{hardware.nvr}</div>
                            <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.5)", marginTop: 2 }}>Storage & Central Management Server</div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700 }}>1</td>
                          <td style={{ padding: "10px 12px", color: "#cbd5e1" }}>—</td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                              <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>₹</span>
                              <input
                                type="number"
                                placeholder="—"
                                value={nvrPrice}
                                onChange={(e) => setNvrPrice(e.target.value === "" ? "" : Number(e.target.value))}
                                className="dv-bom-input"
                                style={{
                                  width: "75px",
                                  background: "#0b0f1a",
                                  border: "0.5px solid #2e3d55",
                                  borderRadius: 4,
                                  color: "#e8edf5",
                                  padding: "2px 4px",
                                  textAlign: "right",
                                  fontSize: 15,
                                  fontFamily: "monospace",
                                  outline: "none",
                                }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "rgba(255, 255, 255, 0.5)" }}>—</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace", color: "#a855f7", fontWeight: 700 }}>
                            {nvrPrice !== "" ? `₹${Number(nvrPrice).toLocaleString("en-IN")}` : "—"}
                          </td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid #1e2d3e", background: "#0d1117" }}>
                          <td style={{ padding: "10px 12px", textTransform: "uppercase", fontWeight: 700, fontSize: 14, color: "#f59e0b" }}>SWITCH</td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ fontWeight: 600, color: "#f8fafc" }}>8-Port PoE Switch</div>
                            <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.5)", marginTop: 2 }}>Power-over-Ethernet switch</div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700 }}>{hardware.switchesCount}</td>
                          <td style={{ padding: "10px 12px", color: "#cbd5e1" }}>—</td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                              <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>₹</span>
                              <input
                                type="number"
                                placeholder="—"
                                value={switchUnitPrice}
                                onChange={(e) => setSwitchUnitPrice(e.target.value === "" ? "" : Number(e.target.value))}
                                className="dv-bom-input"
                                style={{
                                  width: "75px",
                                  background: "#0b0f1a",
                                  border: "0.5px solid #2e3d55",
                                  borderRadius: 4,
                                  color: "#e8edf5",
                                  padding: "2px 4px",
                                  textAlign: "right",
                                  fontSize: 15,
                                  fontFamily: "monospace",
                                  outline: "none",
                                }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "rgba(255, 255, 255, 0.5)" }}>—</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace", color: "#a855f7", fontWeight: 700 }}>
                            {switchUnitPrice !== "" ? `₹${(Number(switchUnitPrice) * hardware.switchesCount).toLocaleString("en-IN")}` : "—"}
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Cost Summary Cards */}
              {(() => {
                // Compute totals only from filled-in prices
                const groups = {};
                placed.forEach((p) => {
                  const key = `${p.camera.brand}__${p.camera.model}__${p.camera.type}`;
                  if (!groups[key]) groups[key] = { ids: [], qty: 0 };
                  groups[key].ids.push(p.id);
                  groups[key].qty += 1;
                });
                let camTotal = 0, camHasAny = false;
                Object.values(groups).forEach(({ ids, qty }) => {
                  const gKey = ids[0];
                  const cp = cameraPrices[gKey];
                  const ap = accessoryPrices[gKey];
                  if (cp !== undefined) { camTotal += Number(cp) * qty; camHasAny = true; }
                  if (ap !== undefined) { camTotal += Number(ap) * qty; camHasAny = true; }
                });
                const nvrNum = nvrPrice !== "" ? Number(nvrPrice) : null;
                const swNum = switchUnitPrice !== "" ? Number(switchUnitPrice) : null;
                const infraTotal = (nvrNum !== null ? nvrNum : 0) + (swNum !== null ? swNum * hardware.switchesCount : 0);
                const infraHasAny = nvrNum !== null || swNum !== null;
                const grandTotal = (camHasAny ? camTotal : 0) + (infraHasAny ? infraTotal : 0);
                const showGrand = camHasAny || infraHasAny;
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 4 }}>
                    <div style={{ background: "#0d1117", border: "1px solid #1e2d3e", borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.5)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Camera & Mounts</span>
                      <span style={{ fontSize: 20, fontFamily: "monospace", color: "#f8fafc", fontWeight: 800, marginTop: 4 }}>
                        {camHasAny ? `₹${Math.round(camTotal).toLocaleString("en-IN")}` : "—"}
                      </span>
                    </div>
                    <div style={{ background: "#0d1117", border: "1px solid #1e2d3e", borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.5)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Infrastructure (NVR & PoE)</span>
                      <span style={{ fontSize: 20, fontFamily: "monospace", color: "#f8fafc", fontWeight: 800, marginTop: 4 }}>
                        {infraHasAny ? `₹${Math.round(infraTotal).toLocaleString("en-IN")}` : "—"}
                      </span>
                    </div>
                    <div style={{ background: "#1e1b4b", border: "1px solid #4338ca", borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 13, color: "#c084fc", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Grand Surveillance Total</span>
                      <span style={{ fontSize: 22, fontFamily: "monospace", color: "#c084fc", fontWeight: 900, marginTop: 2 }}>
                        {showGrand ? `₹${Math.round(grandTotal).toLocaleString("en-IN")}` : "—"}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <>
              <div className="dv-stats-grid">
                <div className="dv-stats-card">
                  <div className="dv-stats-card__label">Total Cameras</div>
                  <div className="dv-stats-card__val">{cameraCount}</div>
                  <div className="dv-stats-card__meta">Avg {avgFPS.toFixed(0)} FPS project</div>
                  <div className="dv-stats-card__list">
                    {Object.entries(typeCounts).map(([t, count]) => (
                      <div key={t} className="dv-stats-type">
                        <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
                        <span>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="dv-stats-card">
                  <div className="dv-stats-card__label">Est. Bandwidth</div>
                  <div className="dv-stats-card__val">{totalBandwidth.toFixed(1)} <small>Mbps</small></div>
                  <div style={{ display: "flex", gap: 4, margin: "6px 0 4px" }}>
                    {["h265", "h264"].map(c => (
                      <button key={c} onClick={() => setCodec(c)} style={{
                        fontSize: 13, padding: "2px 7px", borderRadius: 3,
                        cursor: "pointer", border: "0.5px solid",
                        background: codec === c ? "#3b82f622" : "transparent",
                        borderColor: codec === c ? "#3b82f6" : "#2e3d55",
                        color: codec === c ? "#3b82f6" : "#4a5568",
                      }}>
                        {c.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div className="dv-stats-card__meta">Avg {avgBitrate.toFixed(1)} Mbps/cam · from spec</div>
                </div>

                <div className="dv-stats-card">
                  <div className="dv-stats-card__label">Storage Required</div>
                  <div className="dv-stats-card__val">
                    {totalStorageTB > 1 ? totalStorageTB.toFixed(2) : totalStorageGB.toFixed(0)}
                    <small>{totalStorageTB > 1 ? " TB" : " GB"}</small>
                  </div>
                  <div className="dv-stats-card__meta" style={{ color: "#f59e0b", fontWeight: 700 }}>
                    Recommended: ≥ {Math.ceil(totalStorageTB * 1.2) || 1} TB
                  </div>

                  <div className="dv-stats-card__slider">
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "rgba(255, 255, 255, 0.5)", marginBottom: 4 }}>
                      <span>Retention Period</span>
                      <span style={{ color: "#3b82f6", fontWeight: 700 }}>{retentionDays} Days</span>
                    </div>
                    <input type="range" min="1" max="90" value={retentionDays}
                      onChange={e => setRetentionDays(Number(e.target.value))} />
                  </div>
                </div>
              </div>

              <div className="dv-stats-infra">
                <div className="dv-stats-infra__title">Recommended Infrastructure</div>
                <div className="dv-stats-infra__row">
                  <div className="dv-stats-infra__item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
                    </svg>
                    <span>{hardware.nvr}</span>
                  </div>
                  <div className="dv-stats-infra__item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <rect x="2" y="6" width="20" height="12" rx="2" />
                      <circle cx="6" cy="12" r="1" /><circle cx="10" cy="12" r="1" />
                      <circle cx="14" cy="12" r="1" /><circle cx="18" cy="12" r="1" />
                    </svg>
                    <span>{hardware.switches}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
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