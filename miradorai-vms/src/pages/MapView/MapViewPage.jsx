import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import "./MapViewPage.css";
import SearchBar from "../../components/shared/SearchBar";
import MapCanvas      from "./MapCanvas";
import ConfigPanel    from "./ConfigPanel";
import HeatmapLayer   from "./HeatmapLayer";
import CameraItem     from "./CameraItem";
import VirtualMapView from "./VirtualMapView";
import { drawHeatmapToContext, drawHeatmapLegendToCanvas } from "./HeatmapLogic";
import { drawCamera, getCamTypeFromName, renderMapViewSnapshot } from "./MapDrawingUtils";
import WebRTCPlayer_MediaMTX from "../../components/shared/WebRTCPlayer_MediaMTX";
import { AlertPopup } from "../LiveView/LiveViewPage";
import "../LiveView/LiveViewPage.css";

const API = import.meta.env.VITE_API_URL;
const MAP_ID = "default";

// ── Auth ──────────────────────────────────────────────────────────────
function getToken() {
  return (
    localStorage.getItem("miradorai_token") ||
    localStorage.getItem("token")           ||
    localStorage.getItem("authToken")       ||
    localStorage.getItem("access_token")    ||
    sessionStorage.getItem("token")         ||
    sessionStorage.getItem("authToken")     ||
    ""
  );
}
function getAuthHeaders() {
  const t = getToken();
  return t
    ? { Authorization: "Bearer " + t, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

// ── LocalStorage ──────────────────────────────────────────────────────
const LS_KEY      = "miradorai_map_floors_v2_" + MAP_ID;
const LS_ZONE_KEY = "miradorai_map_zones_v1_" + MAP_ID;
function lsSave(v)     { try { localStorage.setItem(LS_KEY,      JSON.stringify(v)); } catch {} }
function lsLoad()      { try { return JSON.parse(localStorage.getItem(LS_KEY)      || "null"); } catch { return null; } }
function lsZoneSave(v) { try { localStorage.setItem(LS_ZONE_KEY, JSON.stringify(v)); } catch {} }
function lsZoneLoad()  { try { return JSON.parse(localStorage.getItem(LS_ZONE_KEY) || "null"); } catch { return null; } }

// ── API ───────────────────────────────────────────────────────────────
async function apiGetMap() {
  const r = await fetch(`${API}/api/maps?map_id=${MAP_ID}`, { headers: getAuthHeaders() });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
async function apiSaveMap(floors) {
  const r = await fetch(`${API}/api/maps`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ map_id: MAP_ID, floors }),
  });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function apiDeleteFloor(floorId) {
  const r = await fetch(`${API}/api/maps/floor?map_id=${MAP_ID}&floor_id=${floorId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

// ── NEW: Save zones to backend ────────────────────────────────────────
async function apiSaveZones(zones) {
  const r = await fetch(`${API}/api/maps/zones`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ map_id: MAP_ID, zones }),
  });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

// ── Normalise camera list ─────────────────────────────────────────────
function normalizeCams(data) {
  return (Array.isArray(data) ? data : []).map(d => ({
    id:     d.stream_key || d.ome_stream || d.ip,
    name:   d.device_name || d.name || `Camera @ ${d.ip}`,
    ip:     d.ip,
    ws_url: d.ws_url,
    status: (d.stream_status === "offline" || d.status === "offline") ? "offline" : "online",
    group_id: d.group_id || "default",
    stream_key: d.stream_key || d.ome_stream,
  }));
}

// ── Read enabled alert types from Action Rules ────────────────────
function getEnabledAlertTypes() {
  try {
    const rules = JSON.parse(localStorage.getItem("miradorai_action_rules") || "[]");
    if (rules.length === 0) {
      return ["motion", "object", "device", "occupancy", "linecrossing", "objectinarea", "tampering"];
    }
    return rules
      .filter((r) => r.enabled)
      .map((r) => (r.trigger || "").toLowerCase());
  } catch {
    return ["motion", "object", "device", "occupancy", "linecrossing", "objectinarea", "tampering"];
  }
}

// ── Check if a single alert passes the enabled filter ─────────────
function isAlertAllowed(alert) {
  const enabledTypes = getEnabledAlertTypes();
  const type     = (alert.type     || "").toLowerCase();
  const scenario = (alert.scenario || "").toLowerCase();

  if (enabledTypes.length === 0) return true;

  return enabledTypes.some((t) => {
    const key = t.toLowerCase();
    if (key.includes("motion"))       return type.includes("motion")       || scenario.includes("motion");
    if (key.includes("tamper"))       return type.includes("tamper")       || scenario.includes("tamper");
    if (key.includes("object"))       return type.includes("object")       || type.includes("objectinarea");
    if (key.includes("occupancy"))    return type.includes("occupancy")    || scenario.includes("occupancy");
    if (key.includes("linecrossing")) return type.includes("linecrossing") || type.includes("crossing");
    return true;
  });
}

// ── Default floors shape ──────────────────────────────────────────────
function makeFloor(n) {
  return {
    id:           `floor_${Date.now()}_${n}`,
    name:         `Floor ${n}`,
    imageDataUrl: null,
    markers:      [],
  };
}

// ── Zone helpers ──────────────────────────────────────────────────────
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

function polygonBounds(polygon) {
  const xs = polygon.map(p => p.x);
  const ys = polygon.map(p => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

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

// Bright distinct zone colors
const ZONE_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#14B8A6", "#F97316",
];

// ── Stream + Alerts Modal ─────────────────────────────────────────────
const StreamModal = React.memo(function StreamModal({ cam, onClose }) {
  const ref = useRef(cam);
  const [tab,    setTab]   = useState("stream");
  const [alertsList, setAlertsList] = useState([]);
  const [loading, setLoad]  = useState(false);

  useEffect(() => {
    if (tab !== "alerts") return;
    if (ref.current.isDeleted) {
      setAlertsList([]);
      setLoad(false);
      return;
    }
    setLoad(true);
    fetch(`${API}/api/alerts?camera_ip=${ref.current.ip}&limit=50`, {
      headers: getAuthHeaders(),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return;
        const all = d.alerts || [];
        const filtered = all.filter(a => {
           const t = (a.type || "").toLowerCase();
           const s = (a.scenario || "").toLowerCase();
           return !t.includes("motion") && !s.includes("motion") && t !== "unknown" && t !== "" && !t.includes("tns1:");
        });
        setAlertsList(filtered);
      })
      .catch(() => {})
      .finally(() => setLoad(false));
  }, [tab]);

  return (
    <div className="mv-stream-overlay" onClick={onClose}>
      <div className="mv-stream-modal" onClick={e => e.stopPropagation()}>
        <div className="mv-stream-header">
          <div>
            <div className="mv-stream-title">{ref.current.name}</div>
            <div className="mv-stream-sub">
              {ref.current.ip}
              <span
                className={`mv-modal__badge mv-modal__badge--${ref.current.isDeleted ? "offline" : ref.current.status}`}
                style={{ marginLeft: 8 }}
              >
                {ref.current.isDeleted ? "○ Deleted" : (ref.current.status === "online" ? "● Online" : "○ Offline")}
              </span>
            </div>
          </div>
          <button className="mv-stream-close" onClick={onClose}>✕</button>
        </div>
        <div className="mv-stream-tabs">
          <button
            className={`mv-stream-tab ${tab === "stream" ? "mv-stream-tab--active" : ""}`}
            onClick={() => setTab("stream")}
          >📹 Live Stream</button>
          <button
            className={`mv-stream-tab ${tab === "alerts" ? "mv-stream-tab--active" : ""}`}
            onClick={() => setTab("alerts")}
          >🔔 Alerts</button>
        </div>
        {tab === "stream" ? (
          <div className="mv-stream-body">
            {ref.current.status === "online" && !ref.current.isDeleted ? (
              <WebRTCPlayer_MediaMTX
                key={ref.current.id}
                streamKey={ref.current.id}
                cameraId={ref.current.id}
              />
            ) : ref.current.isDeleted ? (
              <div className="mv-stream-offline">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="52" height="52" style={{ opacity: 0.5 }}>
                  <path d="M23 7l-7 5 7 5V7z"/>
                  <rect x="1" y="5" width="15" height="14" rx="2"/>
                </svg>
                <div style={{ marginTop: 8, color: "rgba(255, 255, 255, 0.5)" }}>Stream not registered</div>
              </div>
            ) : (
              <div className="mv-stream-offline">
                <div style={{ fontSize: 52 }}>📷</div>
                <div style={{ marginTop: 8, color: "rgba(255, 255, 255, 0.5)" }}>Camera offline</div>
              </div>
            )}
          </div>
        ) : (
          <div className="mv-alerts-body">
            {loading ? (
              <div className="mv-alerts-loading">Loading alerts…</div>
            ) : (
              <AlertPopup 
                ip={ref.current.ip} 
                alerts={alertsList} 
                onClose={() => setTab("stream")} 
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
});

function AlertSection({ label, items }) {
  if (!items.length) return null;
  return (
    <div className="mv-alert-group">
      <div className="mv-alert-group-title">
        {label}
        <span className="mv-alert-badge">{items.length}</span>
      </div>
      {items.map((a, i) => (
        <div key={i} className="mv-alert-item">
          <span className="mv-alert-time">
            {a.time
              ? new Date(a.time).toLocaleTimeString()
              : a.received_at
              ? new Date(a.received_at).toLocaleTimeString()
              : "—"}
          </span>
          <span>{a.scenario || a.type || "Event"}</span>
        </div>
      ))}
    </div>
  );
}

// ── Zone Name Modal ───────────────────────────────────────────────────
function ZoneNameModal({ onSave, onCancel, existingNames }) {
  const [name, setName] = useState("");
  const [err,  setErr]  = useState("");
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed)                           { setErr("Zone name is required."); return; }
    if (existingNames.includes(trimmed))    { setErr("A zone with this name already exists."); return; }
    onSave(trimmed);
  }

  return (
    <div className="mv-stream-overlay" onClick={onCancel}>
      <div className="mv-zone-name-modal" onClick={e => e.stopPropagation()}>
        <div className="mv-zone-name-modal__header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
            <line x1="8" y1="2" x2="8" y2="18"/>
            <line x1="16" y1="6" x2="16" y2="22"/>
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


// ── Zone Alert Toast ──────────────────────────────────────────────────
function ZoneAlert({ message, onDismiss }) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const t = setTimeout(() => {
      dismissRef.current?.();
    }, 3500);
    return () => clearTimeout(t);
  }, [message]);

  return (
    <div className="mv-zone-alert">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span style={{ marginRight: "8px" }}>{message}</span>
      <button 
        onClick={onDismiss} 
        className="mv-zone-alert__close"
        title="Dismiss warning"
      >
        ✕
      </button>
    </div>
  );
}

// ── Zone Camera Sub-item ──────────────────────────────────────────────
function ZoneCameraItem({ marker, cameras, isHighlighted, onHighlight, onRemove, zoneColor }) {
  const cam = cameras.find(c => c.id === marker.camId) || {
    name:   marker.camName || marker.camId,
    ip:     marker.camIp || "",
    status: "offline",
    isDeleted: true,
  };

  return (
    <div
      className={`mv-zone-cam-item ${isHighlighted ? "mv-zone-cam-item--highlight" : ""}`}
      style={isHighlighted ? { borderLeft: `2px solid ${zoneColor}`, background: `${zoneColor}14` } : {}}
      onClick={e => { e.stopPropagation(); onHighlight(marker.camId); }}
      title={`${cam.name} • ${cam.ip}`}
    >
      <span className={`mv-cam-dot mv-cam-dot--${cam.status}`} style={{ flexShrink: 0 }} />
      <span className="mv-zone-cam-item__name">{cam.name}</span>
      <button
        className="mv-zone-cam-item__remove"
        onClick={e => { e.stopPropagation(); onRemove(marker.camId); }}
        title="Remove camera from map"
      >✕</button>
    </div>
  );
}

// ── Zone Sidebar Item (zone + cameras inside) ─────────────────────────
function ZoneSidebarItem({
  zone,
  markers,
  cameras,
  isActive,
  highlightedCamId,
  onSelect,
  onDelete,
  onRename,
  onHighlightCam,
  onRemoveCam,
  sidebarExpanded,
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

  const camsInZone = markers.filter(
    m => zone.polygon.length >= 3 && pointInPolygon(m.x, m.y, zone.polygon)
  );

  return (
    <div className={`mv-zone-sidebar-item ${isActive ? "mv-zone-sidebar-item--active" : ""}`}>
      <button
        className="mv-zone-header-btn"
        onClick={() => !isEditing && onSelect(zone)}
        title={zone.name}
        style={isActive ? { borderLeft: `2.5px solid ${zone.color}` } : {}}
      >
        <span
          className="mv-zone-btn__swatch"
          style={{ background: zone.color, flexShrink: 0 }}
        />
        {isEditing ? (
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
          <span className="mv-zone-header-btn__name">{zone.name}</span>
        )}
        {camsInZone.length > 0 && (
          <span className="mv-zone-header-btn__count" style={{ background: `${zone.color}28`, color: zone.color }}>
            {camsInZone.length}
          </span>
        )}
        {sidebarExpanded && camsInZone.length > 0 && (
          <svg
            className={`mv-zone-chevron ${isActive ? "mv-zone-chevron--open" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            width="10" height="10"
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", zIndex: 5 }} onClick={e => e.stopPropagation()}>
          <span
            className="mv-zone-btn__edit"
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
            className="mv-zone-btn__delete"
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
      </button>

      {isActive && sidebarExpanded && camsInZone.length > 0 && (
        <div className="mv-zone-cam-list">
          {camsInZone.map((m, i) => (
            <ZoneCameraItem
              key={m.camId + i}
              marker={m}
              cameras={cameras}
              isHighlighted={highlightedCamId === m.camId}
              onHighlight={onHighlightCam}
              onRemove={onRemoveCam}
              zoneColor={zone.color}
            />
          ))}
        </div>
      )}

      {isActive && sidebarExpanded && camsInZone.length === 0 && (
        <div className="mv-zone-cam-empty">No cameras in zone</div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────
export default function MapViewPage() {
  const { user } = useAuth();

  // Canvas refs
  const wrapRef         = useRef(null);
  const fileInputRef    = useRef(null);
  const floorImgRef     = useRef(null);
  const scaleRef        = useRef(1);
  const offsetRef       = useRef({ x: 0, y: 0 });
  const modeRef         = useRef("place");
  const draggingRef     = useRef(null);
  const draggingCamZoneRef = useRef(null);
  const rotatingRef     = useRef(null);
  const panStartRef     = useRef(null);
  const hoveredIdxRef   = useRef(-1);
  const dragCamRef      = useRef(null);
  const markersRef      = useRef([]);
  const selectedCamRef  = useRef(null);
  const saveTimerRef    = useRef(null);
  const zoneTimerRef    = useRef(null);
  const mouseDownPosRef = useRef(null);
  const authFailedRef   = useRef(false);
  const canvasApiRef    = useRef(null);
  const floorsRef       = useRef([]);

  // Zone drawing refs
  const zonesRef           = useRef([]);
  const drawingPointsRef   = useRef([]);
  const activeZoneIdRef    = useRef(null);

  const highlightedCamIdRef = useRef(null);

  // React state
  const [cameras,          setCameras]          = useState([]);
  const [markers,          setMarkers]          = useState([]);
  const [camFilter,        setCamFilter]        = useState("");

  const filteredCameras = useMemo(() => {
    if (user?.role === "admin" || !user?.allowedCameras || user?.allowedCameras.length === 0) {
      return cameras;
    }
    return cameras.filter(c => user.allowedCameras.includes(String(c.id)));
  }, [cameras, user]);

  const filteredMarkers = useMemo(() => {
    if (user?.role === "admin" || !user?.allowedCameras || user?.allowedCameras.length === 0) {
      return markers;
    }
    return markers.filter(m => user.allowedCameras.includes(String(m.camId)));
  }, [markers, user]);
  const [floors,           setFloors]           = useState(() => [makeFloor(1)]);
  const [activeFloor, setActiveFloor] = useState(0);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef(null);

  // Toolbox / Scale / Selection States
  const [iconScale, setIconScale] = useState(() => {
    const s = localStorage.getItem("miradorai_iconScale");
    return s ? Number(s) : 1.20;
  });
  useEffect(() => {
    localStorage.setItem("miradorai_iconScale", String(iconScale));
  }, [iconScale]);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const selectedIdxRef = useRef(null);
  useEffect(() => { selectedIdxRef.current = selectedIdx; }, [selectedIdx]);
  const [toolboxOpen, setToolboxOpen] = useState(false);

  // ── Modes / Layers dropdown state ────────────────────────────────
  const [modesDropdownOpen,  setModesDropdownOpen]  = useState(false);
  const [layersDropdownOpen, setLayersDropdownOpen] = useState(false);
  const modesDropRef  = useRef(null);
  const layersDropRef = useRef(null);
  const toolboxDropRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setShowExportMenu(false);
      }
      if (modesDropRef.current && !modesDropRef.current.contains(e.target)) {
        setModesDropdownOpen(false);
      }
      if (layersDropRef.current && !layersDropRef.current.contains(e.target)) {
        setLayersDropdownOpen(false);
      }
      if (toolboxDropRef.current && !toolboxDropRef.current.contains(e.target)) {
        setToolboxOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  const [mode,             setMode]             = useState("place");
  const [zoomPct,          setZoomPct]          = useState(100);
  const [statusTxt,        setStatus]           = useState("Loading map…");
  const [hasFloor,         setHasFloor]         = useState(false);
  const [pageLoading,      setPageLoad]         = useState(true);
  const [saving,           setSaving]           = useState(false);
  const [saveErr,          setSaveErr]          = useState(false);
  const [showModal,        setShowModal]        = useState(false);
  const [pendingPos,       setPendingPos]       = useState(null);
  const [pendingCam,       setPendingCam]       = useState(null);
  const [pendingFov,       setPendingFov]       = useState(60);
  const [pendingDirection, setPendingDirection] = useState(0);
  const [selectedCam,      setSelectedCam]      = useState(null);
  const [tooltip,          setTooltip]          = useState({ visible: false, x: 0, y: 0, text: "" });
  const [ctxMenu,          setCtxMenu]          = useState({ visible: false, x: 0, y: 0, idx: -1 });
  const [streamCam,        setStreamCam]        = useState(null);
  const [showHeatmap,      setShowHeatmap]      = useState(false);
  const [virtualMode,      setVirtualMode]      = useState(false);
  const [expandedCamId,    setExpandedCamId]    = useState(null);
  const [inspectorExpanded, setInspectorExpanded] = useState(true);
  const [inspectorTab,      setInspectorTab]      = useState("cameras");

  // Zone state
  const [zones,            setZones]            = useState([]);
  const [drawingPoints,    setDrawingPoints]    = useState([]);
  const [pendingZonePoly,  setPendingZonePoly]  = useState(null);
  const [showZoneNameModal, setShowZoneNameModal] = useState(false);
  const [activeZoneId,     setActiveZoneId]     = useState(null);
  const [zoneAlert,        setZoneAlert]        = useState(null);

  const [draftZones, setDraftZones] = useState([]);
  const draftZonesRef = useRef([]);
  useEffect(() => { draftZonesRef.current = draftZones; }, [draftZones]);
  const [isDetectingZones, setIsDetectingZones] = useState(false);

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

  useEffect(() => {
    const originalAlert = window.alert;
    window.alert = (msg) => showAlert("Map View Alert", msg);
    return () => {
      window.alert = originalAlert;
    };
  }, []);

  const [alertCounts, setAlertCounts] = useState({});
  const camerasRef = useRef(cameras);
  useEffect(() => { camerasRef.current = cameras; }, [cameras]);

  // Fetch active alert counts periodically (replaces websocket)
  useEffect(() => {
    const loadCounts = async () => {
      try {
        const res = await fetch(`${API}/api/alerts?limit=1000`, {
          headers: getAuthHeaders()
        });
        const data = await res.json();
        const counts = {};
        
        const validIps = new Set(camerasRef.current.map(c => (c.ip || "").replace(/_/g, ".")));

        (data.alerts || [])
          .filter((a) => {
             const t = (a.type || "").toLowerCase();
             const s = (a.scenario || "").toLowerCase();
             return !t.includes("motion") && !s.includes("motion") && t !== "unknown" && t !== "" && !t.includes("tns1:");
          })
          .filter((a) => a.status === "Active")
          .filter(isAlertAllowed)
          .forEach((alert) => {
            const ip = (alert.ip || "").replace(/_/g, ".");
            if (ip && validIps.has(ip)) {
              counts[ip] = (counts[ip] || 0) + 1;
            }
          });
        setAlertCounts(counts);
      } catch (e) {
        console.error("[AlertCounts] load failed:", e);
      }
    };
    loadCounts();

    const interval = setInterval(loadCounts, 5000);
    return () => clearInterval(interval);
  }, []);



  const [highlightedCamId, setHighlightedCamId] = useState(null);
  const [sidebarExpanded,  setSidebarExpanded]  = useState(false);

  // Keep refs in sync
  useEffect(() => { floorsRef.current   = floors; }, [floors]);
  useEffect(() => { zonesRef.current    = zones;  }, [zones]);
  useEffect(() => { drawingPointsRef.current = drawingPoints; }, [drawingPoints]);
  useEffect(() => { activeZoneIdRef.current  = activeZoneId;  }, [activeZoneId]);
  useEffect(() => { selectedCamRef.current = selectedCam; }, [selectedCam]);
  useEffect(() => { highlightedCamIdRef.current = highlightedCamId; }, [highlightedCamId]);

  const pendingDirectionRef = useRef(0);
  useEffect(() => { pendingDirectionRef.current = pendingDirection; }, [pendingDirection]);

  const previewMarker =
    showModal && pendingCam && pendingPos
      ? [{
          camId:      pendingCam.id,
          camName:    pendingCam.name,
          camIp:      pendingCam.ip,
          x:          pendingPos.x,
          y:          pendingPos.y,
          fovAngle:   pendingFov,
          direction:  pendingDirection,
          _isPreview: true,
        }]
      : [];

  const canvasMarkers = [...filteredMarkers, ...previewMarker];

  // ── Fit image ────────────────────────────────────────────────────
  const fitImage = useCallback(() => {
    const wrap = wrapRef.current;
    const img  = floorImgRef.current;
    if (!wrap || !img) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    
    const leftMargin = 65;
    const rightPanelWidth = inspectorExpanded ? 265 : 0;
    const visibleW = W - rightPanelWidth - leftMargin;
    
    const s = Math.min(visibleW / img.width, (H - 40) / img.height) * 0.96;
    scaleRef.current  = s;
    offsetRef.current = {
      x: leftMargin + (visibleW - img.width * s) / 2,
      y: (H - img.height * s) / 2,
    };
    setZoomPct(Math.round(s * 100));
    canvasApiRef.current?.drawAll();
  }, [inspectorExpanded]);

  // ── Switch active floor ───────────────────────────────────────────
  const loadFloor = useCallback((idx, floorList) => {
    const fl = (floorList || floorsRef.current)[idx];
    if (!fl) return;
    markersRef.current = fl.markers || [];
    setMarkers([...(fl.markers || [])]);
    if (fl.imageDataUrl) {
      const img   = new Image();
      img.onload  = () => { floorImgRef.current = img; setHasFloor(true); fitImage(); };
      img.src     = fl.imageDataUrl;
    } else {
      floorImgRef.current = null;
      setHasFloor(false);
      canvasApiRef.current?.drawAll();
    }
  }, [fitImage]); // eslint-disable-line

  // Auto-refit floor image when inspector collapses/expands for smooth responsive canvas layout
  useEffect(() => {
    if (floorImgRef.current) {
      fitImage();
    }
  }, [inspectorExpanded, fitImage]);

  const applyZoom = useCallback((delta, cx, cy) => {
    const prev = scaleRef.current;
    const next = Math.min(8, Math.max(0.08, prev + delta));
    scaleRef.current  = next;
    offsetRef.current = {
      x: cx - (cx - offsetRef.current.x) * (next / prev),
      y: cy - (cy - offsetRef.current.y) * (next / prev),
    };
    setZoomPct(Math.round(next * 100));
    canvasApiRef.current?.drawAll();
    wrapRef.current?.__vtReposition?.();
  }, []);

  // ── Persist floors ────────────────────────────────────────────────
  const persistFloors = useCallback((updated) => {
    lsSave(updated);
    if (authFailedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true); setSaveErr(false);
      try { await apiSaveMap(updated); }
      catch (e) {
        if (e.message === "401") { authFailedRef.current = true; setSaveErr(true); }
      }
      finally { setSaving(false); }
    }, 800);
  }, []);

  // ── Persist zones to backend ──────────────────────────────────────
  const persistZones = useCallback((updated) => {
    lsZoneSave(updated);
    if (authFailedRef.current) return;
    if (zoneTimerRef.current) clearTimeout(zoneTimerRef.current);
    zoneTimerRef.current = setTimeout(async () => {
      try { await apiSaveZones(updated); }
      catch (e) {
        if (e.message === "401") { authFailedRef.current = true; setSaveErr(true); }
      }
    }, 800);
  }, []);

  const updateMarkers = useCallback((next) => {
    markersRef.current = next;
    setMarkers([...next]);
    const updated = floorsRef.current.map((f, i) =>
      i === activeFloor ? { ...f, markers: next } : f
    );
    setFloors(updated);
    floorsRef.current = updated;
    persistFloors(updated);
  }, [activeFloor, persistFloors]);

  // ── Init ─────────────────────────────────────────────────────────
  useEffect(() => {
    const cachedZones = lsZoneLoad();
    if (cachedZones?.length) {
      setZones(cachedZones);
      zonesRef.current = cachedZones;
    }

    async function init() {
      const cached = lsLoad();
      if (cached?.length) {
        setFloors(cached);
        floorsRef.current = cached;
        loadFloor(0, cached);
      }

      let cams = [];
      try {
        const r = await fetch(`${API}/api/cameras`, { headers: getAuthHeaders() });
        if (r.status === 401) { authFailedRef.current = true; }
        else if (r.ok) {
          const j = await r.json();
          cams = normalizeCams(j.devices || j.cameras || []);
        }
      } catch {}
      if (!cams.length) {
        try { cams = normalizeCams(JSON.parse(localStorage.getItem("miradorai_devices") || "[]")); }
        catch {}
      }
      setCameras(cams);

      try {
        const data = await apiGetMap();

        if (data.zones?.length && !cachedZones?.length) {
          setZones(data.zones);
          zonesRef.current = data.zones;
          lsZoneSave(data.zones);
        }

        if (data.floors?.length) {
          setFloors(data.floors);
          floorsRef.current = data.floors;
          lsSave(data.floors);
          loadFloor(0, data.floors);
          setStatus("Map restored — select a camera then click to place");
        } else if (data.markers?.length || data.floor_plan) {
          const migrated = [{
            id:           "floor_1",
            name:         "Floor 1",
            imageDataUrl: data.floor_plan || null,
            markers:      (data.markers || []).map(m => ({
              ...m,
              fovAngle:  m.fovAngle  || 60,
              direction: m.direction || 0,
            })),
          }];
          setFloors(migrated);
          floorsRef.current = migrated;
          lsSave(migrated);
          loadFloor(0, migrated);
          setStatus("Map restored — select a camera then click to place");
        } else if (!cached) {
          setStatus("Import a floor plan to start placing cameras");
        } else {
          setStatus("Map restored from cache — select a camera then click to place");
        }
      } catch (e) {
        if (e.message === "401") authFailedRef.current = true;
        setStatus(cached ? "Map restored from cache" : "Import a floor plan to start");
      } finally {
        setPageLoad(false);
      }
    }
    init();
  }, []); // eslint-disable-line

  // ── Wheel zoom ────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const h = e => {
      if (!floorImgRef.current) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      applyZoom(e.deltaY < 0 ? 0.15 : -0.15, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [applyZoom]);

  // ── Coord helpers ─────────────────────────────────────────────────
  function toImg(ex, ey) {
    const el = wrapRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: (ex - r.left  - offsetRef.current.x) / scaleRef.current,
      y: (ey - r.top   - offsetRef.current.y) / scaleRef.current,
    };
  }

  function nearestMarker(ix, iy) {
    const thr = 28 / scaleRef.current;
    let best = -1, bestD = thr;
    markersRef.current.forEach((m, i) => {
      const d = Math.hypot(m.x - ix, m.y - iy);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function nearDirectionHandle(ix, iy) {
    const thr = Math.max(12 / scaleRef.current, 6);
    let best = -1, bestD = thr;
    const all = [...markersRef.current, ...previewMarker];
    all.forEach((m, i) => {
      const handleDistance = 17; // R (8) + 9 = 17 to match MapCanvas.jsx
      const angle = (m.direction || 0) * (Math.PI / 180);
      const hx    = m.x + Math.cos(angle) * handleDistance;
      const hy    = m.y + Math.sin(angle) * handleDistance;
      const d     = Math.hypot(ix - hx, iy - hy);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  // ── Zone: check if a point is inside the active zone ─────────────
  function isInsideActiveZone(px, py) {
    const azId = activeZoneIdRef.current;
    if (!azId) return true;
    const zone = zonesRef.current.find(z => z.id === azId);
    if (!zone || zone.polygon.length < 3) return true;
    return pointInPolygon(px, py, zone.polygon);
  }

  // ── Zoom to zone ──────────────────────────────────────────────────
  function zoomToZone(zone) {
    const wrap = wrapRef.current;
    if (!wrap || zone.polygon.length < 2) return;
    const bounds = polygonBounds(zone.polygon);
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const pw = bounds.maxX - bounds.minX;
    const ph = bounds.maxY - bounds.minY;
    if (pw < 1 || ph < 1) return;
    const pad = 80;
    const s   = Math.min((W - pad * 2) / pw, (H - pad * 2) / ph, 8);
    const cx  = (bounds.minX + bounds.maxX) / 2;
    const cy  = (bounds.minY + bounds.maxY) / 2;
    scaleRef.current  = s;
    offsetRef.current = {
      x: W / 2 - cx * s,
      y: H / 2 - cy * s,
    };
    setZoomPct(Math.round(s * 100));
    canvasApiRef.current?.drawAll();
    wrapRef.current?.__vtReposition?.();
  }

  // ── Zoom to a specific camera marker ─────────────────────────────
  function zoomToCamera(camId) {
    const marker = markersRef.current.find(m => m.camId === camId);
    if (!marker) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const targetScale = Math.max(scaleRef.current, 2);
    scaleRef.current  = targetScale;
    offsetRef.current = {
      x: W / 2 - marker.x * targetScale,
      y: H / 2 - marker.y * targetScale,
    };
    setZoomPct(Math.round(targetScale * 100));
    canvasApiRef.current?.drawAll();
    wrapRef.current?.__vtReposition?.();
  }

  // ── Canvas mouse events ───────────────────────────────────────────
  const onMouseMove = useCallback(e => {
    if (!floorImgRef.current) return;
    const p = toImg(e.clientX, e.clientY);

    if (modeRef.current === "zone") {
      canvasApiRef.current?.drawAll();
      return;
    }

    if (rotatingRef.current !== null) {
      const previewIdx = markersRef.current.length;
      const isPreview  = rotatingRef.current === previewIdx;
      if (isPreview) {
        const m = previewMarker[0];
        if (!m) return;
        const deg = (Math.atan2(p.y - m.y, p.x - m.x) * (180 / Math.PI) + 360) % 360;
        setPendingDirection(deg);
        canvasApiRef.current?.drawAll();
      } else {
        const m   = markersRef.current[rotatingRef.current];
        const deg = (Math.atan2(p.y - m.y, p.x - m.x) * (180 / Math.PI) + 360) % 360;
        markersRef.current[rotatingRef.current] = { ...m, direction: deg };
        setMarkers([...markersRef.current]);
        canvasApiRef.current?.drawAll();
      }
      return;
    }

    if (draggingRef.current !== null && modeRef.current === "place") {
      const nx = p.x, ny = p.y;
      const constraintZone = activeZoneIdRef.current
        ? zonesRef.current.find(z => z.id === activeZoneIdRef.current)
        : draggingCamZoneRef.current;

      if (constraintZone && constraintZone.polygon.length >= 3) {
        if (!pointInPolygon(nx, ny, constraintZone.polygon)) {
          setZoneAlert(`⚠ Camera cannot be placed outside zone "${constraintZone.name}".`);
          return;
        }
      }
      markersRef.current[draggingRef.current].x = nx;
      markersRef.current[draggingRef.current].y = ny;
      setMarkers([...markersRef.current]);
      canvasApiRef.current?.drawAll();
      return;
    }

    if (panStartRef.current && modeRef.current === "pan") {
      offsetRef.current = {
        x: e.clientX - panStartRef.current.mx,
        y: e.clientY - panStartRef.current.my,
      };
      canvasApiRef.current?.drawAll();
      wrapRef.current?.__vtReposition?.();
      return;
    }

    const idx = nearestMarker(p.x, p.y);
    if (idx !== hoveredIdxRef.current) {
      hoveredIdxRef.current = idx;
      canvasApiRef.current?.drawAll();
    }
    if (idx >= 0) {
      const m   = markersRef.current[idx];
      const cam = cameras.find(c => c.id === m.camId) || {
        id:     m.camId,
        name:   m.camName || m.camId,
        ip:     m.camIp || "",
        status: "offline",
        isDeleted: true
      };
      setTooltip({
        visible: true,
        x:       e.nativeEvent.offsetX + 14,
        y:       e.nativeEvent.offsetY - 36,
        text:    `${cam.name}  •  ${cam.ip}  •  ${cam.status === "online" ? "🟢 Online" : "⚫ Offline"}  •  FOV ${m.fovAngle || 60}°  •  Dir ${Math.round(m.direction || 0)}°`,
      });
    } else {
      const hoveredZone = zonesRef.current
        .filter(z => z.floorIndex === activeFloor)
        .find(z => z.polygon?.length >= 3 && pointInPolygon(p.x, p.y, z.polygon));

      if (hoveredZone) {
        setTooltip({
          visible: true,
          x:       e.nativeEvent.offsetX + 14,
          y:       e.nativeEvent.offsetY - 36,
          text:    `Zone: ${hoveredZone.name}`,
        });
      } else {
        setTooltip(t => ({ ...t, visible: false }));
      }
    }
  }, [cameras, activeFloor]); // eslint-disable-line

  const onMouseDown = useCallback(e => {
    if (!floorImgRef.current || e.button === 2) return;
    setCtxMenu(c => ({ ...c, visible: false }));
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    const p = toImg(e.clientX, e.clientY);

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
      setDrawingPoints([...updated]);
      return;
    }

    const rotIdx = nearDirectionHandle(p.x, p.y);
    if (rotIdx >= 0 && modeRef.current === "place") {
      rotatingRef.current = rotIdx;
      return;
    }

    const idx = nearestMarker(p.x, p.y);
    if (modeRef.current === "pan") {
      panStartRef.current = {
        mx: e.clientX - offsetRef.current.x,
        my: e.clientY - offsetRef.current.y,
      };
      return;
    }
    if (idx >= 0) {
      setSelectedIdx(idx);
      draggingRef.current = idx;
      const cam = markersRef.current[idx];
      const containedZones = zonesRef.current.filter(
        z => z.floorIndex === activeFloor && z.polygon?.length >= 3 && pointInPolygon(cam.x, cam.y, z.polygon)
      );
      if (containedZones.length > 0) {
        containedZones.sort((a, b) => getPolygonArea(a.polygon) - getPolygonArea(b.polygon));
        draggingCamZoneRef.current = containedZones[0];
      } else {
        draggingCamZoneRef.current = null;
      }
      return;
    }
    setSelectedIdx(null);
    if (selectedCamRef.current && modeRef.current === "place") {
      if (!isInsideActiveZone(p.x, p.y)) {
        setZoneAlert("⚠ Camera cannot be placed outside the selected zone.");
        return;
      }
      setPendingFov(60);
      setPendingDirection(0);
      setPendingPos(p);
      setPendingCam(selectedCamRef.current);
      setShowModal(true);
      return;
    }

    // Check if clicked inside a draft (CV-detected) zone
    if (draftZonesRef.current.length > 0) {
      const clickedDraft = draftZonesRef.current.find(
        z => z.floorIndex === activeFloor && z.polygon?.length >= 3 && pointInPolygon(p.x, p.y, z.polygon)
      );
      if (clickedDraft) {
        showConfirm("Import Zone", `Import auto-detected "${clickedDraft.name}"?`, () => {
          const updatedDrafts = draftZonesRef.current.filter(z => z.id !== clickedDraft.id);
          setDraftZones(updatedDrafts);
          draftZonesRef.current = updatedDrafts;

          const colorIdx = zonesRef.current.length % ZONE_COLORS.length;
          const newImportedZone = {
            ...clickedDraft,
            id: "zone_" + Date.now(),
            floorIndex: activeFloor,
            color: ZONE_COLORS[colorIdx]
          };
          const updatedZones = [...zonesRef.current, newImportedZone];
          zonesRef.current = updatedZones;
          setZones(updatedZones);
          setActiveZoneId(newImportedZone.id);
          activeZoneIdRef.current = newImportedZone.id;
          persistZones(updatedZones);
          setTimeout(() => zoomToZone(newImportedZone), 0);
          canvasApiRef.current?.drawAll();
        });
        return;
      }
    }
  }, [activeFloor, persistZones, showConfirm]); // eslint-disable-line



  const onMouseUp = useCallback(e => {
    if (modeRef.current === "zone") return;

    if (rotatingRef.current !== null) {
      const previewIdx = markersRef.current.length;
      if (rotatingRef.current !== previewIdx) {
        updateMarkers([...markersRef.current]);
      }
      rotatingRef.current = null;
      return;
    }

    const wasDragging = draggingRef.current !== null;
    if (wasDragging) updateMarkers([...markersRef.current]);
    draggingRef.current = null;
    draggingCamZoneRef.current = null;
    panStartRef.current = null;

    const down = mouseDownPosRef.current;
    mouseDownPosRef.current = null;
    if (!down) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    if (selectedCamRef.current) return;

    const p   = toImg(e.clientX, e.clientY);
    const idx = nearestMarker(p.x, p.y);
    if (idx >= 0) {
      const m   = markersRef.current[idx];
      const cam = cameras.find(c => c.id === m.camId) || {
        id:     m.camId,
        name:   m.camName || m.camId,
        ip:     m.camIp || "",
        status: "offline",
        isDeleted: true
      };
      setStreamCam(null);
      setTimeout(() => setStreamCam(cam), 50);
    }
  }, [cameras, updateMarkers]);

  const onContextMenu = useCallback(e => {
    e.preventDefault();
    if (!floorImgRef.current) return;
    const p   = toImg(e.clientX, e.clientY);
    const idx = nearestMarker(p.x, p.y);
    if (idx >= 0) {
      setCtxMenu({ visible: true, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, idx });
    }
  }, []);

  const onDrop = useCallback(e => {
    e.preventDefault();
    if (!floorImgRef.current || !dragCamRef.current) return;
    const p = toImg(e.clientX, e.clientY);
    if (!isInsideActiveZone(p.x, p.y)) {
      setZoneAlert("⚠ Camera cannot be dropped outside the selected zone.");
      dragCamRef.current = null;
      return;
    }
    setPendingFov(60);
    setPendingDirection(0);
    setPendingPos(p);
    setPendingCam(dragCamRef.current);
    setShowModal(true);
    dragCamRef.current = null;
  }, []); // eslint-disable-line

  // ── Zone drawing ──────────────────────────────────────────────────
  function finishZoneDrawing(pts) {
    if (pts.length < 3) {
      setZoneAlert("Draw at least 3 points to create a zone.");
      cancelZoneDrawing();
      return;
    }
    setPendingZonePoly(pts);
    setDrawingPoints([]);
    drawingPointsRef.current = [];
    setShowZoneNameModal(true);
  }

  function cancelZoneDrawing() {
    setDrawingPoints([]);
    drawingPointsRef.current = [];
    setPendingZonePoly(null);
    setShowZoneNameModal(false);
    modeRef.current = "place";
    setMode("place");
    setStatus("Select a camera then click the map to place");
  }

  function saveZone(name) {
    const color   = ZONE_COLORS[zonesRef.current.length % ZONE_COLORS.length];
    const newZone = {
      id:      `zone_${Date.now()}`,
      name,
      color,
      polygon: pendingZonePoly,
      floorIndex: activeFloor,
    };
    const updated = [...zonesRef.current, newZone];
    setZones(updated);
    zonesRef.current = updated;
    setActiveZoneId(newZone.id);
    activeZoneIdRef.current = newZone.id;
    persistZones(updated);
    setPendingZonePoly(null);
    setShowZoneNameModal(false);
    modeRef.current = "place";
    setMode("place");
    setStatus(`Zone "${name}" created`);
    setTimeout(() => zoomToZone(newZone), 0);
    canvasApiRef.current?.drawAll();
  }

  function deleteZone(id) {
    const updated = zonesRef.current.filter(z => z.id !== id);
    setZones(updated);
    zonesRef.current = updated;
    persistZones(updated);
    if (activeZoneIdRef.current === id) {
      setActiveZoneId(null);
      activeZoneIdRef.current = null;
    }
    canvasApiRef.current?.drawAll();
  }

  function renameZone(id, newName) {
    const zone = zonesRef.current.find(z => z.id === id);
    if (!zone) return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    const exists = zonesRef.current.some(z => z.id !== id && z.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      alert("A zone with this name already exists.");
      return;
    }
    const updated = zonesRef.current.map(z => z.id === id ? { ...z, name: trimmed } : z);
    setZones(updated);
    zonesRef.current = updated;
    persistZones(updated);
    canvasApiRef.current?.drawAll();
    setStatus(`Zone renamed to "${trimmed}"`);
  }

  function selectZone(zone) {
    const newId = activeZoneId === zone.id ? null : zone.id;
    setActiveZoneId(newId);
    activeZoneIdRef.current = newId;
    setHighlightedCamId(null);
    if (newId) {
      zoomToZone(zone);
      setStatus(`Zone "${zone.name}" active`);
    } else {
      setStatus("Zone deselected");
    }
  }

  function handleHighlightCam(camId) {
    const newId = highlightedCamId === camId ? null : camId;
    setHighlightedCamId(newId);
    highlightedCamIdRef.current = newId;
    if (newId) {
      zoomToCamera(newId);
      canvasApiRef.current?.drawAll();
    }
  }

  function removeCamFromZone(camId) {
    const next = markersRef.current.filter(m => m.camId !== camId);
    updateMarkers(next);
    if (highlightedCamId === camId) {
      setHighlightedCamId(null);
      highlightedCamIdRef.current = null;
    }
    setStatus("Camera removed");
  }

  // ── Floor plan import ─────────────────────────────────────────────
  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target.result;
      const img     = new Image();
      img.onload    = () => {
        floorImgRef.current = img;
        setHasFloor(true);
        setStatus("Floor plan loaded — select a camera then click to place");
        fitImage();
      };
      img.src = dataUrl;
      const updated = floorsRef.current.map((f, i) =>
        i === activeFloor ? { ...f, imageDataUrl: dataUrl } : f
      );
      setFloors(updated);
      floorsRef.current = updated;
      persistFloors(updated);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  // ── Floor management ──────────────────────────────────────────────
  function addFloor() {
    const updated = [...floorsRef.current, makeFloor(floorsRef.current.length + 1)];
    setFloors(updated);
    floorsRef.current = updated;
    persistFloors(updated);
    setActiveFloor(updated.length - 1);
    loadFloor(updated.length - 1, updated);
  }

  function switchFloor(idx) {
    if (idx === activeFloor) return;
    setActiveFloor(idx);
    loadFloor(idx);
    setActiveZoneId(null);
    activeZoneIdRef.current = null;
    setHighlightedCamId(null);
  }

  function deleteFloor(idx) {
    if (floors.length === 1) {
      alert("Cannot delete the last floor.");
      return;
    }
    const deletedFloorId = floors[idx]?.id;
    showConfirm("Delete Floor", `Delete ${floors[idx]?.name} and all its cameras?`, () => {
      const updatedZones = zones
        .filter(z => z.floorIndex !== idx)
        .map(z => z.floorIndex > idx ? { ...z, floorIndex: z.floorIndex - 1 } : z);
      setZones(updatedZones);
      zonesRef.current = updatedZones;
      persistZones(updatedZones);

      const updatedFloors = floors.filter((_, i) => i !== idx);
      const newActiveFloor = activeFloor >= updatedFloors.length
        ? updatedFloors.length - 1
        : activeFloor === idx ? 0 : activeFloor > idx ? activeFloor - 1 : activeFloor;

      setFloors(updatedFloors);
      floorsRef.current = updatedFloors;
      persistFloors(updatedFloors);
      
      if (deletedFloorId) {
        apiDeleteFloor(deletedFloorId).catch(console.error);
      }

      setActiveFloor(newActiveFloor);
      loadFloor(newActiveFloor, updatedFloors);
      setActiveZoneId(null);
      activeZoneIdRef.current = null;
      setHighlightedCamId(null);
      setStatus(`${floors[idx]?.name} deleted`);
    });
  }

  // ── Mode helpers ──────────────────────────────────────────────────
  function setPlaceMode() {
    modeRef.current = "place";
    setMode("place");
    setDrawingPoints([]);
    drawingPointsRef.current = [];
    setStatus("Select a camera then click the map to place");
  }
  function setPanMode() {
    modeRef.current = "pan";
    setMode("pan");
    setDrawingPoints([]);
    drawingPointsRef.current = [];
    setStatus("Drag to pan");
    setSelectedCam(null);
    selectedCamRef.current = null;
  }
  function setZoneMode() {
    modeRef.current = "zone";
    setMode("zone");
    setSelectedCam(null);
    selectedCamRef.current = null;
    setDrawingPoints([]);
    drawingPointsRef.current = [];
    setStatus("Click to add zone points — click near the first point to close & save");
  }

  // ── Placement confirmation ────────────────────────────────────────
  function confirmPlacement() {
    if (!pendingPos || !pendingCam) return;
    const next = [
      ...markersRef.current.filter(m => m.camId !== pendingCam.id),
      {
        camId:     pendingCam.id,
        camName:   pendingCam.name,
        camIp:     pendingCam.ip,
        x:         pendingPos.x,
        y:         pendingPos.y,
        fovAngle:  pendingFov,
        direction: pendingDirection,
      },
    ];
    updateMarkers(next);
    setStatus(`${pendingCam.name} placed — FOV ${pendingFov}°, facing ${Math.round(pendingDirection)}°`);
    setShowModal(false);
    setPendingPos(null);
    setPendingCam(null);
    setSelectedCam(null);
    selectedCamRef.current = null;
  }

  function cancelPlacement() {
    setShowModal(false);
    setPendingPos(null);
    setPendingCam(null);
  }

  function flipSelected() {
    const idx = selectedIdxRef.current;
    if (idx === null) return;
    const updated = markersRef.current.map((m, i) =>
      i === idx ? { ...m, flip: !m.flip, direction: (m.direction + 180) % 360 } : m
    );
    markersRef.current = updated;
    setMarkers(updated);
    updateMarkers(updated);
    canvasApiRef.current?.drawAll();
  }

  function removeMarker(idx) {
    updateMarkers(markersRef.current.filter((_, i) => i !== idx));
    setCtxMenu(c => ({ ...c, visible: false }));
    setSelectedIdx(null);
    setStatus("Marker removed");
  }

  function selectCamera(cam) {
    if (modeRef.current !== "place") setPlaceMode();
    setSelectedCam(prev => {
      const next = prev?.id === cam.id ? null : cam;
      selectedCamRef.current = next;
      return next;
    });
    setStatus(`${cam.name} selected — click the map to place`);
  }

  async function clearFloor() {
    showConfirm("Clear Floor", `Remove all cameras from ${floors[activeFloor]?.name}?`, () => {
      updateMarkers([]);
      setSelectedIdx(null);
      setStatus("Floor cleared");
    });
  }

  // ── FIX 1+2+3+4+5+6+7: drawCameraOnExport ────────────────────────
  // Draws a single camera onto the export canvas with:
  //  - Image-relative radius (FIX 1)
  //  - Radial gradient beam (FIX 2)
  //  - DesignerView-style camera icon (FIX 3)
  //  - Consistent zone stroke style drawn separately (FIX 4 handled in exportMapPNG)
  //  - Camera name label (FIX 5)
  //  - Zone clipping per camera (FIX 6) — caller must pass ctx already clipped if needed

  // ── Export PNG ────────────────────────────────────────────────────
  // Z-order: 1 Floor → 2 Zones → 3 Cameras (clipped) → 4 Labels
  // FIX 7: correct z-order is enforced by the sequence below.
  function exportMapPNG(exportMode = "design") {
    const img = floorImgRef.current;
    if (!img) return;

    const oc  = document.createElement("canvas");
    oc.width  = img.width;
    oc.height = img.height;
    const ctx = oc.getContext("2d");

    const floorZones = zonesRef.current.filter(z => z.floorIndex === activeFloor);

    if (exportMode === "design") {
      // ── SNAPSHOT MECHANISM: Exactly like MapCanvas ──────────────────
      renderMapViewSnapshot(ctx, {
        img,
        markers: markersRef.current,
        cameras,
        zones: zonesRef.current,
        activeFloor,
        highlightedCamId: null,
        iconScale: iconScale
      });

      // If intensity heatmap is toggled ON in the UI, include it in the snapshot
      if (showHeatmap) {
        const hcvs = document.createElement("canvas");
        hcvs.width = oc.width; hcvs.height = oc.height;
        const hctx = hcvs.getContext("2d");

        const heatmapMarkers = markersRef.current.map(m => ({
          camId: m.camId, x: m.x, y: m.y, fovAngle: m.fovAngle, direction: m.direction
        }));
        
        const foundLevels = drawHeatmapToContext(hctx, hcvs.width, hcvs.height, {
          markers: heatmapMarkers,
          cameras: cameras,
          scale: 1,
          offset: { x: 0, y: 0 },
          activeZone: zonesRef.current.find(z => z.id === activeZoneIdRef.current) || null,
          floorImg: img,
          step: 2,
          clear: true
        });

        ctx.globalAlpha = 0.85;
        ctx.drawImage(hcvs, 0, 0);
        ctx.globalAlpha = 1.0;
        
        // Draw legend for intensity heatmap
        drawHeatmapLegendToCanvas(ctx, oc.width, oc.height, { foundLevels, compact: true });
      }

      // Also draw zones (UI style)
      floorZones.forEach(zone => {
        if (zone.polygon.length < 2) return;
        ctx.save();
        ctx.beginPath();
        zone.polygon.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.closePath();
        const isActive = zone.id === activeZoneIdRef.current;
        ctx.fillStyle = zone.color + (isActive ? "1a" : "0d");
        ctx.fill();
        ctx.strokeStyle = zone.color;
        ctx.lineWidth   = isActive ? 2.5 : 1.5;
        ctx.globalAlpha = isActive ? 1.0 : 0.55;
        if (!isActive) ctx.setLineDash([6, 3]);
        ctx.stroke();
        ctx.globalAlpha = 1.0;
        ctx.setLineDash([]); 

        // Vertex dots
        zone.polygon.forEach(p => {
          ctx.beginPath(); ctx.arc(p.x, p.y, isActive ? 4 : 3, 0, Math.PI * 2);
          ctx.fillStyle = zone.color; ctx.globalAlpha = isActive ? 0.9 : 0.5; ctx.fill();
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
        });

        // Zone label badge removed per user request

        ctx.restore();
      });

    } else if (exportMode === "heatmap") {
      // 0. Base floor plan
      ctx.drawImage(img, 0, 0);

      // 1. Draw Heatmap to a temporary canvas
      const hcvs = document.createElement("canvas");
      hcvs.width = oc.width; hcvs.height = oc.height;
      const hctx = hcvs.getContext("2d");

      const heatmapMarkers = markersRef.current.map(m => ({
        camId: m.camId, x: m.x, y: m.y, fovAngle: m.fovAngle, direction: m.direction
      }));
      
      const foundLevels = drawHeatmapToContext(hctx, hcvs.width, hcvs.height, {
        markers: heatmapMarkers,
        cameras: cameras,
        scale: 1,
        offset: { x: 0, y: 0 },
        activeZone: zonesRef.current.find(z => z.id === activeZoneIdRef.current) || null,
        allZones: floorZones,
        floorImg: img,
        step: 2,
        clear: true
      });

      // 2. Composite heatmap onto the floor plan
      ctx.globalAlpha = 0.85; 
      ctx.drawImage(hcvs, 0, 0);
      ctx.globalAlpha = 1.0;

      // 3. Draw Zones (Dashed lines, matching Designer View)
      floorZones.forEach(zone => {
        if (zone.polygon.length < 2) return;
        ctx.save(); ctx.beginPath();
        zone.polygon.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.closePath();
        ctx.strokeStyle = zone.color; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.restore();
      });

      // 4. Draw Cameras on top (Premium pill style for Heatmap)
      markersRef.current.forEach(m => {
        const cameraObj = cameras.find(c => c.id === m.camId) || {
          name: m.camName || m.camId,
          type: getCamTypeFromName(m.camName),
          rangeDay: 30,
          hfov: m.fovAngle || 60
        };
      drawCamera(ctx, {
        x: m.x, y: m.y, direction: m.direction,
        camera: { ...cameraObj, model: cameraObj.name || cameraObj.model }
      }, 8, {                        // ← radius 22 → 13 (smaller icon)
        showLabel: false,             // ← no camera name
        zones: floorZones,
        activeZoneId: activeZoneIdRef.current,
        showFov: false,
      });
      });

      // 5. Draw Legend at top-right
      drawHeatmapLegendToCanvas(ctx, oc.width, oc.height, { foundLevels, compact: true });
    }

    // ── Watermark: floor name ─────────────────────────────────────
    const floorName = floorsRef.current[activeFloor]?.name || "Floor";
    ctx.font         = "600 15px Inter, system-ui, sans-serif";
    ctx.textAlign    = "left";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(floorName, 16, oc.height - 12);
    ctx.fillStyle = "rgba(255,255,255,0.90)";
    ctx.fillText(floorName, 14, oc.height - 14);

    // ── Download ──────────────────────────────────────────────────
    const a    = document.createElement("a");
    a.download = exportMode === "heatmap" ? `${floorName.replace(/\s+/g, "_")}_heatmap.png` : `${floorName.replace(/\s+/g, "_")}_design.png`;
    a.href     = oc.toDataURL("image/png");
    a.click();
    setShowExportMenu(false);
  }

  // Computed
  const placedIds   = new Set(filteredMarkers.map(m => m.camId));
  const totalPlaced = floors.reduce((s, f) => s + (f.markers?.length || 0), 0);
  const activeZone  = zones.find(z => z.id === activeZoneId) || null;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div
      className="page-shell mv-page"
      onClick={() => {
        setCtxMenu(c => ({ ...c, visible: false }));
        setExpandedCamId(null);
      }}
    >

      {/* ── Combined Header + Toolbar ── */}
      <div className="mv-toolbar">
        {/* Left: Page Title */}
        <div className="mv-toolbar__title-section">
          <h1 className="page-title" style={{ fontSize: "28px", margin: 0 }}>Map View</h1>
        </div>

        {/* Right Side: All Controls */}
        <div className="mv-toolbar__right-section">

          {/* ── Modes Icon Button + Dropdown ── */}
          <div className="mv-icon-drop-wrap" ref={modesDropRef}>
            <button
              className={`mv-icon-btn ${
                mode !== "place" || modesDropdownOpen ? "mv-icon-btn--active" : ""
              }`}
              onClick={() => {
                setModesDropdownOpen(o => !o);
                setLayersDropdownOpen(false);
              }}
              title="Modes"
            >
              {/* Tool/Cursor icon */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/>
              </svg>
              <span className="mv-icon-btn__label">Modes</span>
              {/* Active mode dot */}
              {mode !== "place" && <span className="mv-icon-btn__dot" />}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10" className={`mv-icon-btn__chevron ${modesDropdownOpen ? "open" : ""}`}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {modesDropdownOpen && (
              <div className="mv-dropdown-panel mv-dropdown-panel--modes">
                <div className="mv-dropdown-panel__title">Map Modes</div>
                <div className="mv-dropdown-cards">

                  {/* Place Cam */}
                  <button
                    className={`mv-dropdown-card ${mode === "place" ? "mv-dropdown-card--active" : ""}`}
                    onClick={() => { setPlaceMode(); setModesDropdownOpen(false); }}
                  >
                    <div className="mv-dropdown-card__icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26">
                        <circle cx="12" cy="12" r="3"/>
                        <circle cx="12" cy="12" r="8" strokeDasharray="3 3"/>
                        <line x1="12" y1="2" x2="12" y2="5"/>
                        <line x1="12" y1="19" x2="12" y2="22"/>
                        <line x1="2" y1="12" x2="5" y2="12"/>
                        <line x1="19" y1="12" x2="22" y2="12"/>
                      </svg>
                    </div>
                    <div className="mv-dropdown-card__body">
                      <span className="mv-dropdown-card__label">Place Cam</span>
                      <span className="mv-dropdown-card__desc">Click map to place a camera</span>
                    </div>
                    {mode === "place" && <span className="mv-dropdown-card__check">✓</span>}
                  </button>

                  {/* Pan Map */}
                  <button
                    className={`mv-dropdown-card ${mode === "pan" ? "mv-dropdown-card--active" : ""}`}
                    onClick={() => { setPanMode(); setModesDropdownOpen(false); }}
                  >
                    <div className="mv-dropdown-card__icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26">
                        <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M12 3v18M3 12h18"/>
                      </svg>
                    </div>
                    <div className="mv-dropdown-card__body">
                      <span className="mv-dropdown-card__label">Pan Map</span>
                      <span className="mv-dropdown-card__desc">Drag to navigate the floor plan</span>
                    </div>
                    {mode === "pan" && <span className="mv-dropdown-card__check">✓</span>}
                  </button>

                  {/* Draw Zone */}
                  <button
                    className={`mv-dropdown-card ${mode === "zone" ? "mv-dropdown-card--active" : ""}`}
                    onClick={() => {
                      if (mode === "zone") cancelZoneDrawing();
                      else setZoneMode();
                      setModesDropdownOpen(false);
                    }}
                  >
                    <div className="mv-dropdown-card__icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26">
                        <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                      </svg>
                    </div>
                    <div className="mv-dropdown-card__body">
                      <span className="mv-dropdown-card__label">Draw Zone</span>
                      <span className="mv-dropdown-card__desc">Click points to draw area zones</span>
                    </div>
                    {mode === "zone" && <span className="mv-dropdown-card__check">✓</span>}
                  </button>

                  {/* Auto-Detect */}
                  <button
                    className={`mv-dropdown-card ${draftZones.length > 0 ? "mv-dropdown-card--draft" : ""} ${isDetectingZones ? "mv-dropdown-card--loading" : ""}`}
                    disabled={isDetectingZones}
                    onClick={async () => {
                      setModesDropdownOpen(false);
                      if (isDetectingZones) return;
                      const floorId = floors[activeFloor]?.id || "floor_1";
                      const currentFloorPlan = floors[activeFloor]?.imageDataUrl || null;
                      setIsDetectingZones(true);
                      try {
                        const r = await fetch(`${API}/api/designer/detect-zones`, {
                          method: "POST",
                          headers: getAuthHeaders(),
                          body: JSON.stringify({
                            map_id: MAP_ID,
                            floor_id: floorId,
                            source: "map",
                            floor_plan: currentFloorPlan
                          })
                        });
                        if (!r.ok) {
                          const errData = await r.json();
                          alert(`CV Zone detection failed: ${errData.detail || r.statusText}`);
                          return;
                        }
                        const data = await r.json();
                        if (data.success && data.zones?.length > 0) {
                          const draftWithFloor = data.zones.map(z => ({ ...z, floorIndex: activeFloor }));
                          setDraftZones(draftWithFloor);
                          draftZonesRef.current = draftWithFloor;
                          alert(`Detected ${data.zones.length} potential zones. Hover/click inside them on the map to import!`);
                          canvasApiRef.current?.drawAll();
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
                    title="Automatically extract zones using CV"
                  >
                    <div className="mv-dropdown-card__icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26">
                        <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    </div>
                    <div className="mv-dropdown-card__body">
                      <span className="mv-dropdown-card__label">
                        {isDetectingZones ? "Detecting…" : "Auto-Detect"}
                      </span>
                      <span className="mv-dropdown-card__desc">AI detects zones from floor image</span>
                    </div>
                    {draftZones.length > 0 && !isDetectingZones && (
                      <span className="mv-dropdown-card__badge">{draftZones.length}</span>
                    )}
                    {isDetectingZones && <span className="mv-dropdown-card__spinner" />}
                  </button>

                </div>
              </div>
            )}
          </div>

          {/* ── Layers Icon Button + Dropdown ── */}
          <div className="mv-icon-drop-wrap" ref={layersDropRef}>
            <button
              className={`mv-icon-btn ${
                (showHeatmap || virtualMode || layersDropdownOpen) ? "mv-icon-btn--active" : ""
              }`}
              onClick={() => {
                setLayersDropdownOpen(o => !o);
                setModesDropdownOpen(false);
              }}
              title="Layers"
            >
              {/* Layers stack icon */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                <polyline points="2 17 12 22 22 17"/>
                <polyline points="2 12 12 17 22 12"/>
              </svg>
              <span className="mv-icon-btn__label">Layers</span>
              {(showHeatmap || virtualMode) && <span className="mv-icon-btn__dot" />}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10" className={`mv-icon-btn__chevron ${layersDropdownOpen ? "open" : ""}`}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {layersDropdownOpen && (
              <div className="mv-dropdown-panel mv-dropdown-panel--layers">
                <div className="mv-dropdown-panel__title">Map Layers</div>
                <div className="mv-dropdown-cards">

                  {/* Heatmap */}
                  <button
                    className={`mv-dropdown-card ${showHeatmap ? "mv-dropdown-card--active" : ""}`}
                    onClick={() => { setShowHeatmap(h => !h); }}
                  >
                    <div className="mv-dropdown-card__icon mv-dropdown-card__icon--heatmap">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                      </svg>
                    </div>
                    <div className="mv-dropdown-card__body">
                      <span className="mv-dropdown-card__label">Heatmap</span>
                      <span className="mv-dropdown-card__desc">Coverage blind-spot intensity</span>
                    </div>
                    <div className={`mv-dropdown-card__toggle ${showHeatmap ? "mv-dropdown-card__toggle--on" : ""}`} />
                  </button>

                  {/* Virtual View */}
                  <button
                    className={`mv-dropdown-card ${virtualMode ? "mv-dropdown-card--active mv-dropdown-card--virtual" : ""}`}
                    onClick={() => { setVirtualMode(v => !v); setExpandedCamId(null); }}
                  >
                    <div className="mv-dropdown-card__icon mv-dropdown-card__icon--virtual">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26">
                        <rect x="2" y="3" width="20" height="14" rx="2"/>
                        <path d="M8 21h8M12 17v4"/>
                        <circle cx="8"  cy="10" r="2"/>
                        <circle cx="16" cy="10" r="2"/>
                      </svg>
                    </div>
                    <div className="mv-dropdown-card__body">
                      <span className="mv-dropdown-card__label">
                        {virtualMode ? "Exit View" : "Virtual View"}
                      </span>
                      <span className="mv-dropdown-card__desc">3D virtual camera positions</span>
                    </div>
                    <div className={`mv-dropdown-card__toggle ${virtualMode ? "mv-dropdown-card__toggle--on mv-dropdown-card__toggle--purple" : ""}`} />
                  </button>

                </div>
              </div>
            )}
          </div>

          {draftZones.filter(z => z.floorIndex === activeFloor).length > 0 && (
            <div className="mv-toolbar-draft-actions">
              <button
                className="mv-tbtn-new success"
                onClick={() => {
                  const activeDrafts = draftZones.filter(z => z.floorIndex === activeFloor);
                  showConfirm("Import All Zones", `Import all ${activeDrafts.length} detected zones?`, () => {
                    const newImportedZones = activeDrafts.map((dz, idx) => {
                      const colorIdx = (zonesRef.current.length + idx) % ZONE_COLORS.length;
                      return {
                        ...dz,
                        id: "zone_" + (Date.now() + idx),
                        floorIndex: activeFloor,
                        color: ZONE_COLORS[colorIdx]
                      };
                    });
                    const updatedZones = [...zonesRef.current, ...newImportedZones];
                    zonesRef.current = updatedZones;
                    setZones(updatedZones);
                    
                    const remainingDrafts = draftZones.filter(z => z.floorIndex !== activeFloor);
                    setDraftZones(remainingDrafts);
                    draftZonesRef.current = remainingDrafts;
                    
                    persistZones(updatedZones);
                    canvasApiRef.current?.drawAll();
                    alert(`Successfully imported all ${newImportedZones.length} zones.`);
                  });
                }}
              >
                Import ({draftZones.filter(z => z.floorIndex === activeFloor).length})
              </button>
              <button
                className="mv-tbtn-new danger"
                onClick={() => {
                  const remainingDrafts = draftZones.filter(z => z.floorIndex !== activeFloor);
                  setDraftZones(remainingDrafts);
                  draftZonesRef.current = remainingDrafts;
                  canvasApiRef.current?.drawAll();
                }}
              >
                Clear Drafts
              </button>
            </div>
          )}

          {saving  && <span className="mv-saving">● Saving…</span>}
          {saveErr && (
            <span className="mv-save-err" title="Auth failed — saved to cache only">
              ⚠ Cached locally
            </span>
          )}

          {mode === "zone" && drawingPoints.length > 0 && (
            <span className="mv-zone-draw-hint">
              {drawingPoints.length} pts
              <button
                className="mv-zone-draw-done"
                onClick={() => drawingPoints.length >= 3 && finishZoneDrawing(drawingPoints)}
                disabled={drawingPoints.length < 3}
              >
                Finish
              </button>
            </span>
          )}

          <div className="mv-toolbar-group-actions" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button className="mv-tbtn-new secondary" onClick={() => fileInputRef.current?.click()} title="Import Plan">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
              Import Plan
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />

            <div className="mv-export-group" ref={exportMenuRef}>
              <button
                className={`mv-tbtn-new secondary ${showExportMenu ? "active" : ""}`}
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={!hasFloor}
                title="Export PNG snapshot"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
                Export
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10" style={{ marginLeft: 2, opacity: 0.6 }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {showExportMenu && (
                <div className="mv-export-menu">
                  <button className="mv-export-item" onClick={() => exportMapPNG("design")}>
                    <div className="mv-export-item__icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                        <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
                      </svg>
                    </div>
                    <div className="mv-export-item__label">
                      <span>Download Design</span>
                      <small>Exact snapshot of current layout</small>
                    </div>
                  </button>
                  <button className="mv-export-item" onClick={() => exportMapPNG("heatmap")}>
                    <div className="mv-export-item__icon mv-export-item__icon--heatmap">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                      </svg>
                    </div>
                    <div className="mv-export-item__label">
                      <span>Download Heatmap</span>
                      <small>Coverage intensity map</small>
                    </div>
                  </button>
                </div>
              )}
            </div>

            <button className="mv-tbtn-new danger" onClick={clearFloor} title="Clear Map Floor Plan">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/>
              </svg>
              Clear
            </button>

            {/* ── Toolbox Dropdown ── */}
            <div style={{ position: "relative" }} ref={toolboxDropRef}>
              <button
                className={`mv-tbtn-new secondary ${toolboxOpen ? "active" : ""}`}
                onClick={() => setToolboxOpen(!toolboxOpen)}
                title="Open Toolbox"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13" style={{ marginRight: 4 }}>
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                </svg>
                Toolbox
              </button>
             
              {toolboxOpen && (
                <div className="mv-export-menu" style={{
                  position: 'absolute',
                  top: "calc(100% + 4px)",
                  right: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  background: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: 8,
                  padding: '12px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  zIndex: 100,
                  width: 200,
                  pointerEvents: 'auto',
                  textAlign: 'left'
                }}>
                  {/* Camera Icon Size */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase" }}>Camera Icon Size</div>
                    <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", borderRadius: 4, overflow: "hidden", alignItems: "center", height: 28, border: '1px solid rgba(255,255,255,0.1)', justifyContent: "space-between" }}>
                      <button className="mv-export-item" onClick={() => { setIconScale(s => Math.max(0.4, s - 0.2)); setTimeout(() => canvasApiRef.current?.drawAll(), 0); }} style={{ padding: "4px 8px", background: "transparent", border: "none", height: "100%", width: "auto" }} title="Decrease Icon Size">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      </button>
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>{Math.round(iconScale * 100)}%</span>
                      <button className="mv-export-item" onClick={() => { setIconScale(s => Math.min(2.0, s + 0.2)); setTimeout(() => canvasApiRef.current?.drawAll(), 0); }} style={{ padding: "4px 8px", background: "transparent", border: "none", height: "100%", width: "auto" }} title="Increase Icon Size">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      </button>
                    </div>
                  </div>

                  {/* Flip Cam */}
                  {selectedIdx !== null && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                      <button className="mv-tbtn-new secondary" onClick={flipSelected} style={{ padding: "6px 8px", width: "100%", justifyContent: "center", background: "rgba(255,255,255,0.05)", border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4 }} title="Flip Camera Mount">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12" style={{ marginRight: 6 }}><path d="M21 9V3h-6M3 15v6h6M21 3l-7.5 7.5M3 21l7.5-7.5" /></svg>
                        Flip Cam
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Canvas Workspace ── */}
      <div className="mv-main">

        {/* ── Map Workspace Container ── */}
        <div
          ref={wrapRef}
          className={`mv-canvas-wrap ${mode === "pan" ? "mv-pan-mode" : ""} ${selectedCam ? "mv-place-mode" : ""} ${mode === "zone" ? "mv-zone-mode" : ""}`}
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
        >
          {pageLoading ? (
            <div className="mv-hint">
              <p className="mv-hint__title">Loading map…</p>
            </div>
          ) : (
            <MapCanvas
              ref={canvasApiRef}
              cameras={filteredCameras}
              markers={canvasMarkers}
              floorImgRef={floorImgRef}
              zones={zones.filter(z => z.floorIndex === activeFloor)}
              scaleRef={scaleRef}
              offsetRef={offsetRef}
              hoveredIdxRef={hoveredIdxRef}
              highlightedCamId={highlightedCamId}
              showHeatmap={showHeatmap}
              alertCounts={alertCounts}
              onMouseMove={onMouseMove}
              onMouseDown={onMouseDown}
              onMouseUp={onMouseUp}
              onMouseLeave={() => {
                setTooltip(t => ({ ...t, visible: false }));
                hoveredIdxRef.current = -1;
                canvasApiRef.current?.drawAll();
              }}
              onContextMenu={onContextMenu}
              iconScale={iconScale}
              selectedIdx={selectedIdx}
            />
          )}

          {/* Zone SVG overlay */}
          {!pageLoading && hasFloor && (
            <ZoneOverlay
              zones={zones.filter(z => z.floorIndex === activeFloor)}
              draftZones={draftZones.filter(z => z.floorIndex === activeFloor)}
              drawingPoints={drawingPoints}
              activeZoneId={activeZoneId}
              scaleRef={scaleRef}
              offsetRef={offsetRef}
              wrapRef={wrapRef}
              mode={mode}
            />
          )}

          {/* Empty-floor hint */}
          {!hasFloor && !pageLoading && (
            <div className="mv-hint">
              <div className="mv-hint__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="56" height="56">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <path d="M3 9h18M9 21V9"/>
                </svg>
              </div>
              <p className="mv-hint__title">No floor plan loaded</p>
              <p className="mv-hint__sub">
                Click <strong>Import Floor Plan</strong> above to upload a JPEG or PNG
              </p>
            </div>
          )}

          {/* Tooltip */}
          {tooltip.visible && (
            <div className="mv-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
              {tooltip.text}
            </div>
          )}

          {/* Context menu */}
          {ctxMenu.visible && (
            <div
              className="mv-ctx-menu"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onClick={e => e.stopPropagation()}
            >
              <button
                className="mv-ctx-item"
                onClick={() => {
                  setSelectedIdx(ctxMenu.idx);
                  // Execute flip in next tick after setting selected index
                  setTimeout(() => {
                    flipSelected();
                    setCtxMenu(c => ({ ...c, visible: false }));
                  }, 0);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" style={{ marginRight: 6 }}>
                  <path d="M21 9V3h-6M3 15v6h6M21 3l-7.5 7.5M3 21l7.5-7.5" />
                </svg>
                Flip Cam
              </button>
              <button
                className="mv-ctx-item mv-ctx-item--danger"
                onClick={() => removeMarker(ctxMenu.idx)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14H6L5 6"/>
                </svg>
                Remove camera
              </button>
            </div>
          )}

          {/* Heatmap overlay */}
          <HeatmapLayer
            markers={filteredMarkers}
            cameras={filteredCameras}
            scaleRef={scaleRef}
            offsetRef={offsetRef}
            wrapRef={wrapRef}
            showHeatmap={showHeatmap}
            floorImgRef={floorImgRef}
            activeZone={activeZoneId ? zones.find(z => z.id === activeZoneId) : null}
            zones={zones.filter(z => z.floorIndex === activeFloor)}
          />

          {/* Virtual Map View */}
          <VirtualMapView
            markers={filteredMarkers}
            cameras={filteredCameras}
            scaleRef={scaleRef}
            offsetRef={offsetRef}
            wrapRef={wrapRef}
            visible={virtualMode}
            floorImgRef={floorImgRef}
            expandedCamId={expandedCamId}
            onClose={() => setExpandedCamId(null)}
            onExpand={setExpandedCamId}
            alertCounts={alertCounts}
          />

          {/* Configuration panel modal */}
          {showModal && pendingCam && (
            <ConfigPanel
              cam={pendingCam}
              fovAngle={pendingFov}
              direction={pendingDirection}
              onFovChange={setPendingFov}
              onDirChange={setPendingDirection}
              onConfirm={confirmPlacement}
              onCancel={cancelPlacement}
            />
          )}

          {/* Zone alert toast */}
          {zoneAlert && (
            <ZoneAlert message={zoneAlert} onDismiss={() => setZoneAlert(null)} />
          )}

          {/* Active zone HUD indicator */}
          {activeZone && (
            <div className="mv-active-zone-badge" style={{ borderColor: activeZone.color }}>
              <span className="mv-active-zone-badge__dot" style={{ background: activeZone.color }} />
              Zone: {activeZone.name}
              <button
                className="mv-active-zone-badge__clear"
                onClick={() => {
                  setActiveZoneId(null);
                  activeZoneIdRef.current = null;
                  setStatus("Zone deselected");
                }}
              >✕</button>
            </div>
          )}

          {/* Zone drawing HUD overlay */}
          {mode === "zone" && (
            <div className="mv-zone-draw-overlay">
              {drawingPoints.length === 0
                ? "Click anywhere on the map to start drawing a zone"
                : `${drawingPoints.length} point${drawingPoints.length !== 1 ? "s" : ""} — click start point to close`
              }
            </div>
          )}

          {/* ── Floating Floor Selector HUD (Left Center) ── */}
          {hasFloor && floors.length > 0 && (
            <div className="mv-floor-hud">
              <div className="mv-floor-hud__label">Floors</div>
              {floors.map((f, i) => (
                <button
                  key={f.id}
                  className={`mv-floor-hud-btn ${i === activeFloor ? "mv-floor-hud-btn--active" : ""}`}
                  onClick={() => switchFloor(i)}
                  title={f.name}
                >
                  <span className="mv-floor-hud-btn__text">{i + 1}</span>
                  {f.markers?.length > 0 && (
                    <span className="mv-floor-hud-btn__badge">{f.markers.length}</span>
                  )}
                  {floors.length > 1 && (
                    <span
                      className="mv-floor-hud-btn__del"
                      onClick={e => { e.stopPropagation(); deleteFloor(i); }}
                      title="Delete floor"
                    >✕</span>
                  )}
                </button>
              ))}
              <button
                className="mv-floor-hud-btn mv-floor-hud-btn--add"
                onClick={addFloor}
                title="Add Floor"
              >
                +
              </button>
            </div>
          )}

          {/* ── Slide-out Tabbed Right Inspector Panel ── */}
          <div className={`mv-inspector ${inspectorExpanded ? "mv-inspector--expanded" : ""}`}>
            {!inspectorExpanded && (
              <button
                className="mv-inspector-toggle"
                onClick={() => setInspectorExpanded(true)}
                title="Expand Inspector"
              >
                ←
                <span className="mv-inspector-toggle__text">Inspector</span>
              </button>
            )}

            {inspectorExpanded && (
              <div className="mv-inspector-container">
                {/* Modern Tab Selector */}
                <div className="mv-inspector-tabs" style={{ position: "relative", paddingRight: "36px" }}>
                  <button
                    className={`mv-inspector-tab ${inspectorTab === "cameras" ? "mv-inspector-tab--active" : ""}`}
                    onClick={() => setInspectorTab("cameras")}
                  >
                    Cameras ({filteredCameras.length})
                  </button>
                  <button
                    className={`mv-inspector-tab ${inspectorTab === "zones" ? "mv-inspector-tab--active" : ""}`}
                    onClick={() => setInspectorTab("zones")}
                  >
                    Zones ({zones.filter(z => z.floorIndex === activeFloor).length})
                  </button>
                  
                  {/* Premium Close Cross Button */}
                  <button
                    className="mv-inspector-close-btn"
                    onClick={() => setInspectorExpanded(false)}
                    title="Collapse Inspector"
                    style={{
                      position: "absolute",
                      right: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      color: "#7a8499",
                      fontSize: "18px",
                      fontWeight: "700",
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

                {/* Tab content area */}
                <div className="mv-inspector-content">
                  {inspectorTab === "cameras" ? (
                    <div className="mv-inspector-flow">
                      <div className="mv-inspector-section-title">Available Devices</div>
                      {activeZone && (
                        <div className="mv-sidebar-zone-notice" style={{ borderColor: activeZone.color + "50" }}>
                          <span style={{ color: activeZone.color }}>●</span>
                          &nbsp;Place inside <strong>{activeZone.name}</strong>
                        </div>
                      )}
                      <div className="mv-sidebar-search" style={{ paddingBottom: "12px" }}>
                        <SearchBar value={camFilter} onChange={setCamFilter} placeholder="Filter devices..." />
                      </div>

                      <div className="mv-cam-list">
                        {pageLoading ? (
                          <div className="mv-cam-empty">Loading cameras…</div>
                        ) : filteredCameras.filter(cam => (cam.name || "Unnamed").toLowerCase().includes(camFilter.toLowerCase()) || (cam.ip || "").toLowerCase().includes(camFilter.toLowerCase())).length === 0 ? (
                          <div className="mv-cam-empty">No cameras found.<br />Add devices first.</div>
                        ) : (
                          filteredCameras.filter(cam => (cam.name || "Unnamed").toLowerCase().includes(camFilter.toLowerCase()) || (cam.ip || "").toLowerCase().includes(camFilter.toLowerCase())).map(cam => (
                            <CameraItem
                              key={cam.id}
                              cam={cam}
                              isPlaced={placedIds.has(cam.id)}
                              isActive={selectedCam?.id === cam.id}
                              onSelect={selectCamera}
                              onDragStart={c => { dragCamRef.current = c; }}
                            />
                          ))

                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mv-inspector-flow">
                      <div className="mv-inspector-section-title">Floor Zones</div>

                      <div className="mv-zone-scroller">
                        {zones.filter(z => z.floorIndex === activeFloor).length === 0 ? (
                          <div className="mv-zone-empty-hint">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" width="22" height="22" style={{ opacity: 0.3 }}>
                              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                            </svg>
                            <span className="mv-zone-empty-hint__text">No zones on this floor</span>
                          </div>
                        ) : (
                          zones.filter(z => z.floorIndex === activeFloor).map((zone) => (
                            <ZoneSidebarItem
                              key={zone.id}
                              zone={zone}
                              markers={filteredMarkers}
                              cameras={filteredCameras}
                              isActive={activeZoneId === zone.id}
                              highlightedCamId={highlightedCamId}
                              onSelect={selectZone}
                              onDelete={deleteZone}
                              onRename={renameZone}
                              onHighlightCam={handleHighlightCam}
                              onRemoveCam={removeCamFromZone}
                              sidebarExpanded={true}
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

          {/* ── Glassmorphic HUD Zoom Controls (Bottom Right) ── */}
          <div className="mv-zoom-hud">
            <button
              className="mv-zoom-hud-btn"
              onClick={() => {
                const el = wrapRef.current;
                if (el) applyZoom(-0.2, el.clientWidth / 2, el.clientHeight / 2);
              }}
              title="Zoom out"
            >
              −
            </button>
            <span className="mv-zoom-hud-pct">{zoomPct}%</span>
            <button
              className="mv-zoom-hud-btn"
              onClick={() => {
                const el = wrapRef.current;
                if (el) applyZoom(0.2, el.clientWidth / 2, el.clientHeight / 2);
              }}
              title="Zoom in"
            >
              +
            </button>
            <div className="mv-zoom-hud-divider" />
            <button className="mv-zoom-hud-btn mv-zoom-hud-btn--fit" onClick={fitImage}>
              Fit
            </button>
          </div>

        </div>
      </div>

      {/* Stream / Alerts modal */}
      {streamCam && (
        <StreamModal cam={streamCam} onClose={() => setStreamCam(null)} />
      )}

      {/* Zone name modal */}
      {showZoneNameModal && (
        <ZoneNameModal
          onSave={saveZone}
          onCancel={cancelZoneDrawing}
          existingNames={zones.map(z => z.name)}
        />
      )}

      <PremiumPopup {...popupState} />
    </div>
  );
}

// ── Zone SVG Overlay ──────────────────────────────────────────────────
function ZoneOverlay({ zones, draftZones = [], drawingPoints, activeZoneId, scaleRef, offsetRef, wrapRef, mode }) {
  const [, forceRender] = useState(0);

  useEffect(() => {
    let raf;
    function tick() {
      forceRender(n => n + 1);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const wrap = wrapRef.current;
  if (!wrap) return null;
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;

  function toPx(ix, iy) {
    return [
      ix * scaleRef.current + offsetRef.current.x,
      iy * scaleRef.current + offsetRef.current.y,
    ];
  }

  function polyPoints(polygon) {
    return polygon.map(p => toPx(p.x, p.y).join(",")).join(" ");
  }

  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: W,
        height: H,
        pointerEvents: "none",
        zIndex: 4,
      }}
    >
      <defs>
        {zones.map(z => (
          <pattern
            key={`pat-${z.id}`}
            id={`hatch-${z.id}`}
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1="0" y1="0" x2="0" y2="10"
              stroke={z.color}
              strokeWidth="1.5"
              strokeOpacity="0.18"
            />
          </pattern>
        ))}
      </defs>

      {zones.map(z => {
        if (z.polygon.length < 3) return null;
        const pts      = polyPoints(z.polygon);
        const isActive = z.id === activeZoneId;
        const cx = z.polygon.reduce((s, p) => s + p.x, 0) / z.polygon.length;
        const cy = z.polygon.reduce((s, p) => s + p.y, 0) / z.polygon.length;
        const [lx, ly] = toPx(cx, cy);

        return (
          <g key={z.id}>
            <polygon
              points={pts}
              fill="none"
              stroke={z.color}
              strokeWidth={isActive ? 2.5 : 1.5}
              strokeOpacity={isActive ? 1 : 0.55}
              strokeDasharray={isActive ? "none" : "6 3"}
            />
            {/* <polygon
              points={pts}
              fill={z.color}
              fillOpacity={isActive ? 0.1 : 0.05}
              stroke="none"
            /> */}
            {z.polygon.map((p, i) => {
              const [vx, vy] = toPx(p.x, p.y);
              return (
                <circle
                  key={i}
                  cx={vx} cy={vy}
                  r={isActive ? 4 : 3}
                  fill={z.color}
                  fillOpacity={isActive ? 0.9 : 0.5}
                  stroke="#fff"
                  strokeWidth="1"
                  strokeOpacity="0.4"
                />
              );
            })}
            {/* Zone label removed per user request */}

          </g>
        );
      })}

      {draftZones.map(z => {
        if (z.polygon.length < 3) return null;
        const pts = polyPoints(z.polygon);
        const cx = z.polygon.reduce((s, p) => s + p.x, 0) / z.polygon.length;
        const cy = z.polygon.reduce((s, p) => s + p.y, 0) / z.polygon.length;
        const [lx, ly] = toPx(cx, cy);

        return (
          <g key={z.id}>
            <polygon
              points={pts}
              fill="none"
              stroke={z.color}
              strokeWidth={1.5}
              strokeOpacity={0.65}
              strokeDasharray="4 4"
            />
            {/* <polygon
              points={pts}
              fill={z.color}
              fillOpacity={0.06}
              stroke="none"
            /> */}
            {z.polygon.map((p, i) => {
              const [vx, vy] = toPx(p.x, p.y);
              return (
                <circle
                  key={i}
                  cx={vx} cy={vy}
                  r={3}
                  fill={z.color}
                  fillOpacity={0.4}
                  stroke="#fff"
                  strokeWidth="1"
                  strokeOpacity="0.4"
                />
              );
            })}
            <text
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={z.color}
              fontSize={9}
              fontWeight="bold"
              fontFamily="monospace"
            >
              CV DRAFT
            </text>
          </g>
        );
      })}


      {mode === "zone" && drawingPoints.length > 0 && (
        <g>
          {drawingPoints.length > 1 && (
            <polyline
              points={drawingPoints.map(p => toPx(p.x, p.y).join(",")).join(" ")}
              fill="none"
              stroke="#F59E0B"
              strokeWidth="2"
              strokeDasharray="6 3"
              strokeOpacity="0.9"
            />
          )}
          {drawingPoints.map((p, i) => {
            const [vx, vy] = toPx(p.x, p.y);
            return (
              <circle
                key={i}
                cx={vx} cy={vy}
                r={i === 0 ? 6 : 4}
                fill={i === 0 ? "#F59E0B" : "#fff"}
                stroke="#F59E0B"
                strokeWidth="2"
                fillOpacity={i === 0 ? 1 : 0.85}
              />
            );
          })}
          {(() => {
            const [fx, fy] = toPx(drawingPoints[0].x, drawingPoints[0].y);
            return (
              <text x={fx + 8} y={fy - 8} fontSize={9} fill="#F59E0B" fontFamily="Inter, sans-serif" fontWeight={700}>
                start
              </text>
            );
          })()}
        </g>
      )}
    </svg>
  );
}