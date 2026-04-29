import React, { useState, useEffect, useRef, useCallback } from "react";
import "./MapViewPage.css";
import WebRTCPlayer   from "../../components/shared/WebRTCPlayer";
import MapCanvas      from "./MapCanvas";
import ConfigPanel    from "./ConfigPanel";
import HeatmapLayer   from "./HeatmapLayer";
import CameraItem     from "./CameraItem";
import VirtualMapView from "./VirtualMapView";

const API    = "http://192.168.126.200:8000";
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
const LS_KEY = "miradorai_map_floors_v2_" + MAP_ID;
function lsSave(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch {} }
function lsLoad()  { try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; } }

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
async function apiDeleteMap() {
  await fetch(`${API}/api/maps?map_id=${MAP_ID}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
}

// ── Normalise camera list from /api/discover-devices ─────────────────
function normalizeCams(data) {
  return (Array.isArray(data) ? data : []).map(d => ({
    id:     d.stream_key || d.ome_stream || d.ip,
    name:   d.device_name || d.name || `Camera @ ${d.ip}`,
    ip:     d.ip,
    ws_url: d.ws_url,
    status: d.stream_status === "streaming" ? "online" : "offline",
  }));
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

// ── Stream + Alerts Modal ─────────────────────────────────────────────
const StreamModal = React.memo(function StreamModal({ cam, onClose }) {
  const ref = useRef(cam);
  const [tab,    setTab]   = useState("stream");
  const [alerts, setAlerts] = useState({ motion: [], lineCrossing: [], idle: [] });
  const [loading, setLoad]  = useState(false);

  useEffect(() => {
    if (tab !== "alerts") return;
    setLoad(true);
    fetch(`${API}/api/alerts?camera_ip=${ref.current.ip}&limit=50`, {
      headers: getAuthHeaders(),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return;
        const all = d.alerts || [];
        setAlerts({
          motion:       all.filter(a => (a.type || a.scenario || "").toLowerCase().includes("motion")),
          lineCrossing: all.filter(a => (a.type || a.scenario || "").toLowerCase().includes("line")),
          idle:         all.filter(a => (a.type || a.scenario || "").toLowerCase().includes("idle")),
        });
      })
      .catch(() => {})
      .finally(() => setLoad(false));
  }, [tab]);

  return (
    <div className="mv-stream-overlay" onClick={onClose}>
      <div className="mv-stream-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="mv-stream-header">
          <div>
            <div className="mv-stream-title">{ref.current.name}</div>
            <div className="mv-stream-sub">
              {ref.current.ip}
              <span
                className={`mv-modal__badge mv-modal__badge--${ref.current.status}`}
                style={{ marginLeft: 8 }}
              >
                {ref.current.status === "online" ? "● Online" : "○ Offline"}
              </span>
            </div>
          </div>
          <button className="mv-stream-close" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="mv-stream-tabs">
          <button
            className={`mv-stream-tab ${tab === "stream" ? "mv-stream-tab--active" : ""}`}
            onClick={() => setTab("stream")}
          >
            📹 Live Stream
          </button>
          <button
            className={`mv-stream-tab ${tab === "alerts" ? "mv-stream-tab--active" : ""}`}
            onClick={() => setTab("alerts")}
          >
            🔔 Alerts
          </button>
        </div>

        {/* Body */}
        {tab === "stream" ? (
          <div className="mv-stream-body">
            {ref.current.status === "online" ? (
              <WebRTCPlayer
                key={ref.current.id}
                serverUrl={ref.current.ws_url}
                cameraId={ref.current.id}
              />
            ) : (
              <div className="mv-stream-offline">
                <div style={{ fontSize: 48 }}>📷</div>
                <div style={{ marginTop: 8, color: "#888" }}>Camera offline</div>
              </div>
            )}
          </div>
        ) : (
          <div className="mv-alerts-body">
            {loading ? (
              <div className="mv-alerts-loading">Loading alerts…</div>
            ) : (
              <>
                <AlertSection label="🏃 Motion"       items={alerts.motion} />
                <AlertSection label="⚡ Line Crossing" items={alerts.lineCrossing} />
                <AlertSection label="💤 Idle"          items={alerts.idle} />
                {!alerts.motion.length && !alerts.lineCrossing.length && !alerts.idle.length && (
                  <div className="mv-alerts-empty">No recent alerts</div>
                )}
              </>
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

// ── Main ──────────────────────────────────────────────────────────────
export default function MapViewPage() {

  // ── Canvas interaction refs (never cause re-renders) ─────────────
  const wrapRef         = useRef(null);
  const fileInputRef    = useRef(null);
  const floorImgRef     = useRef(null);
  const scaleRef        = useRef(1);
  const offsetRef       = useRef({ x: 0, y: 0 });
  const modeRef         = useRef("place");
  const draggingRef     = useRef(null);
  const rotatingRef     = useRef(null);
  const panStartRef     = useRef(null);
  const hoveredIdxRef   = useRef(-1);
  const dragCamRef      = useRef(null);
  const markersRef      = useRef([]);
  const selectedCamRef  = useRef(null);
  const saveTimerRef    = useRef(null);
  const mouseDownPosRef = useRef(null);
  const authFailedRef   = useRef(false);
  const canvasApiRef    = useRef(null);
  const floorsRef       = useRef([]);

  // ── React state ───────────────────────────────────────────────────
  const [cameras,          setCameras]          = useState([]);
  const [markers,          setMarkers]          = useState([]);
  const [floors,           setFloors]           = useState(() => [makeFloor(1)]);
  const [activeFloor,      setActiveFloor]      = useState(0);
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

  // Keep refs in sync
  useEffect(() => { floorsRef.current    = floors;      }, [floors]);
  useEffect(() => { selectedCamRef.current = selectedCam; }, [selectedCam]);

  const pendingDirectionRef = useRef(0);
  useEffect(() => { pendingDirectionRef.current = pendingDirection; }, [pendingDirection]);

  // Preview marker shown on canvas while placement modal is open
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

  const canvasMarkers = [...markers, ...previewMarker];

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
  }, []); // eslint-disable-line

  // ── Fit image to canvas ───────────────────────────────────────────
  const fitImage = useCallback(() => {
    const wrap = wrapRef.current;
    const img  = floorImgRef.current;
    if (!wrap || !img) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const s = Math.min(W / img.width, H / img.height) * 0.92;
    scaleRef.current  = s;
    offsetRef.current = {
      x: (W - img.width  * s) / 2,
      y: (H - img.height * s) / 2,
    };
    setZoomPct(Math.round(s * 100));
    canvasApiRef.current?.drawAll();
  }, []);

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

  // ── Persist ───────────────────────────────────────────────────────
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

  // ── Init on mount ─────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const cached = lsLoad();
      if (cached?.length) {
        setFloors(cached);
        floorsRef.current = cached;
        loadFloor(0, cached);
      }

      let cams = [];
      try {
        const r = await fetch(`${API}/api/discover-devices`, { headers: getAuthHeaders() });
        if (r.status === 401) { authFailedRef.current = true; }
        else if (r.ok) {
          const j = await r.json();
          cams = normalizeCams(j.devices || []);
        }
      } catch {}
      if (!cams.length) {
        try { cams = normalizeCams(JSON.parse(localStorage.getItem("miradorai_devices") || "[]")); }
        catch {}
      }
      setCameras(cams);

      try {
        const data = await apiGetMap();
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

    const poll = setInterval(async () => {
      if (authFailedRef.current) return;
      try {
        const r = await fetch(`${API}/api/discover-devices`, { headers: getAuthHeaders() });
        if (r.status === 401) { authFailedRef.current = true; return; }
        if (r.ok) {
          const j = await r.json();
          if (j.devices?.length) { setCameras(normalizeCams(j.devices)); return; }
        }
      } catch {}
      try {
        setCameras(normalizeCams(JSON.parse(localStorage.getItem("miradorai_devices") || "[]")));
      } catch {}
    }, 15000);

    return () => clearInterval(poll);
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
    const thr = 12 / scaleRef.current;
    let best = -1, bestD = thr;
    const all = [...markersRef.current, ...previewMarker];
    all.forEach((m, i) => {
      const r2    = 13;
      const angle = (m.direction || 0) * (Math.PI / 180);
      const hx    = m.x + Math.cos(angle) * (r2 + 12);
      const hy    = m.y + Math.sin(angle) * (r2 + 12);
      const d     = Math.hypot(ix - hx, iy - hy);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  // ── Canvas mouse events ───────────────────────────────────────────
  const onMouseMove = useCallback(e => {
    if (!floorImgRef.current) return;
    const p = toImg(e.clientX, e.clientY);

    // Rotating
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

    // Dragging marker
    if (draggingRef.current !== null && modeRef.current === "place") {
      markersRef.current[draggingRef.current].x = p.x;
      markersRef.current[draggingRef.current].y = p.y;
      setMarkers([...markersRef.current]);
      canvasApiRef.current?.drawAll();
      return;
    }

    // Panning
    if (panStartRef.current && modeRef.current === "pan") {
      offsetRef.current = {
        x: e.clientX - panStartRef.current.mx,
        y: e.clientY - panStartRef.current.my,
      };
      canvasApiRef.current?.drawAll();
      wrapRef.current?.__vtReposition?.();
      return;
    }

    // Hover tooltip
    const idx = nearestMarker(p.x, p.y);
    if (idx !== hoveredIdxRef.current) {
      hoveredIdxRef.current = idx;
      canvasApiRef.current?.drawAll();
    }
    if (idx >= 0) {
      const m   = markersRef.current[idx];
      const cam = cameras.find(c => c.id === m.camId) || {
        name:   m.camId,
        ip:     "",
        status: "offline",
      };
      setTooltip({
        visible: true,
        x:       e.nativeEvent.offsetX + 14,
        y:       e.nativeEvent.offsetY - 36,
        text:    `${cam.name}  •  ${cam.ip}  •  ${cam.status === "online" ? "🟢 Online" : "⚫ Offline"}  •  FOV ${m.fovAngle || 60}°  •  Dir ${Math.round(m.direction || 0)}°`,
      });
    } else {
      setTooltip(t => ({ ...t, visible: false }));
    }
  }, [cameras]); // eslint-disable-line

  const onMouseDown = useCallback(e => {
    if (!floorImgRef.current || e.button === 2) return;
    setCtxMenu(c => ({ ...c, visible: false }));
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    const p = toImg(e.clientX, e.clientY);

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
      draggingRef.current = idx;
      return;
    }
    if (selectedCamRef.current && modeRef.current === "place") {
      setPendingFov(60);
      setPendingDirection(0);
      setPendingPos(p);
      setPendingCam(selectedCamRef.current);
      setShowModal(true);
    }
  }, []); // eslint-disable-line

  const onMouseUp = useCallback(e => {
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
    setPendingFov(60);
    setPendingDirection(0);
    setPendingPos(toImg(e.clientX, e.clientY));
    setPendingCam(dragCamRef.current);
    setShowModal(true);
    dragCamRef.current = null;
  }, []);

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
  }

  // ── Mode helpers ──────────────────────────────────────────────────
  function setPlaceMode() {
    modeRef.current = "place";
    setMode("place");
    setStatus("Select a camera then click the map to place");
  }
  function setPanMode() {
    modeRef.current = "pan";
    setMode("pan");
    setStatus("Drag to pan");
    setSelectedCam(null);
    selectedCamRef.current = null;
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

  function removeMarker(idx) {
    updateMarkers(markersRef.current.filter((_, i) => i !== idx));
    setCtxMenu(c => ({ ...c, visible: false }));
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
    if (!window.confirm(`Remove all cameras from ${floors[activeFloor]?.name}?`)) return;
    updateMarkers([]);
    setStatus("Floor cleared");
  }

  // ── Computed ──────────────────────────────────────────────────────
  const placedIds   = new Set(markers.map(m => m.camId));
  const totalPlaced = floors.reduce((s, f) => s + (f.markers?.length || 0), 0);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div
      className="mv-page"
      onClick={() => {
        setCtxMenu(c => ({ ...c, visible: false }));
        setExpandedCamId(null);
      }}
    >

      {/* ── Toolbar ── */}
      <div className="mv-toolbar">
        <div className="mv-toolbar__left">
          <span className="mv-toolbar__title">Map View</span>
          <div className="mv-sep" />

          {/* Import */}
          <button className="mv-tbtn" onClick={() => fileInputRef.current?.click()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
            Import Floor Plan
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />

          <div className="mv-sep" />

          {/* Place mode */}
          <button
            className={`mv-tbtn ${mode === "place" ? "mv-tbtn--active" : ""}`}
            onClick={setPlaceMode}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13">
              <circle cx="12" cy="12" r="3"/>
              <circle cx="12" cy="12" r="8" strokeDasharray="2 3"/>
            </svg>
            Place
          </button>

          {/* Pan mode */}
          <button
            className={`mv-tbtn ${mode === "pan" ? "mv-tbtn--active" : ""}`}
            onClick={setPanMode}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13">
              <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M12 3v18M3 12h18"/>
            </svg>
            Pan
          </button>

          {/* Blind spots / heatmap */}
          <button
            className={`mv-tbtn ${showHeatmap ? "mv-tbtn--active" : ""}`}
            onClick={() => setShowHeatmap(h => !h)}
            title="Toggle blind-spot heatmap"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
            {showHeatmap ? "Hide Heatmap" : "Blind Spots"}
          </button>

          {/* Virtual map view */}
          <button
            className={`mv-tbtn ${virtualMode ? "mv-tbtn--virtual" : ""}`}
            onClick={() => { setVirtualMode(v => !v); setExpandedCamId(null); }}
            title="Toggle Virtual Map View — live feeds pinned to camera positions"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <path d="M8 21h8M12 17v4"/>
              <circle cx="8"  cy="10" r="2"/>
              <circle cx="16" cy="10" r="2"/>
              <path d="M6 10h2M16 10h2"/>
            </svg>
            {virtualMode ? "Exit View" : "Map View"}
          </button>

          {/* Clear floor */}
          <button className="mv-tbtn mv-tbtn--danger" onClick={clearFloor}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/>
            </svg>
            Clear Floor
          </button>
        </div>

        <div className="mv-toolbar__right">
          {saving  && <span className="mv-saving">● Saving…</span>}
          {saveErr && (
            <span className="mv-save-err" title="Auth failed — saved to cache only">
              ⚠ Cached locally
            </span>
          )}
          <span className="mv-status-txt">{statusTxt}</span>
          <span className="mv-status-count">
            {totalPlaced} cam{totalPlaced !== 1 ? "s" : ""} / {floors.length} floor{floors.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── Main area (toolbar ▸ floor sidebar + canvas + camera sidebar) ── */}
      <div className="mv-main">

        {/* ════════════════════════════════════════
            Floor Sidebar  (left)
            Collapses to 52 px; expands on hover.
            ════════════════════════════════════════ */}
        <div className="mv-floor-sidebar">

          {/* Header */}
          <div className="mv-floor-sidebar__head">
            <svg
              className="mv-floor-sidebar__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              width="16"
              height="16"
            >
              <polygon points="12 2 2 7 12 12 22 7 12 2"/>
              <polyline points="2 17 12 22 22 17"/>
              <polyline points="2 12 12 17 22 12"/>
            </svg>
            <span className="mv-floor-sidebar__label">Floors</span>
          </div>

          {/* Floor list */}
          <div className="mv-floor-sidebar__list">
            {floors.map((f, i) => (
              <button
                key={f.id}
                className={`mv-floor-btn ${i === activeFloor ? "mv-floor-btn--active" : ""}`}
                onClick={() => switchFloor(i)}
                title={f.name}
              >
                {/* Number badge — always visible */}
                <span className="mv-floor-btn__num">{i + 1}</span>
                {/* Name — revealed on sidebar hover */}
                <span className="mv-floor-btn__name">{f.name}</span>
                {/* Camera count chip */}
                {f.markers?.length > 0 && (
                  <span className="mv-floor-btn__badge">{f.markers.length}</span>
                )}
              </button>
            ))}

            {/* Add floor */}
            <button
              className="mv-floor-btn mv-floor-btn--add"
              onClick={addFloor}
              title="Add Floor"
            >
              <span className="mv-floor-btn__num">+</span>
              <span className="mv-floor-btn__name">Add Floor</span>
            </button>
          </div>
        </div>
        {/* ════════════ end floor sidebar ════════════ */}

        {/* ── Canvas ── */}
        <div
          ref={wrapRef}
          className={`mv-canvas-wrap ${mode === "pan" ? "mv-pan-mode" : ""} ${selectedCam ? "mv-place-mode" : ""}`}
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
              cameras={cameras}
              markers={canvasMarkers}
              floorImgRef={floorImgRef}
              scaleRef={scaleRef}
              offsetRef={offsetRef}
              hoveredIdxRef={hoveredIdxRef}
              showHeatmap={showHeatmap}
              onMouseMove={onMouseMove}
              onMouseDown={onMouseDown}
              onMouseUp={onMouseUp}
              onMouseLeave={() => {
                setTooltip(t => ({ ...t, visible: false }));
                hoveredIdxRef.current = -1;
                canvasApiRef.current?.drawAll();
              }}
              onContextMenu={onContextMenu}
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
              <p className="mv-hint__title">No floor plan for {floors[activeFloor]?.name}</p>
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
          {showHeatmap && (
            <HeatmapLayer markers={markers} cameras={cameras} />
          )}

          {/* Virtual Map View */}
          <VirtualMapView
            markers={markers}
            cameras={cameras}
            scaleRef={scaleRef}
            offsetRef={offsetRef}
            wrapRef={wrapRef}
            expandedCamId={expandedCamId}
            onExpand={id => setExpandedCamId(prev => (prev === id ? null : id))}
            onClose={() => setExpandedCamId(null)}
            visible={virtualMode && hasFloor}
          />

          {/* Placement config modal */}
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
        </div>
        {/* ── end canvas ── */}

        {/* ── Camera sidebar (right) ── */}
        <div className="mv-sidebar">
          <div className="mv-sidebar__head">
            <span>Available Cameras</span>
            <span className="mv-sidebar__count">{cameras.length}</span>
          </div>

          <div className="mv-cam-list">
            {pageLoading ? (
              <div className="mv-cam-empty">Loading cameras…</div>
            ) : cameras.length === 0 ? (
              <div className="mv-cam-empty">No cameras found.<br />Add devices first.</div>
            ) : (
              cameras.map(cam => (
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

          {/* Legend */}
          {markers.length > 0 && (
            <div className="mv-legend">
              <div className="mv-legend__head">
                {floors[activeFloor]?.name} — {markers.length} placed
              </div>
              {markers.map((m, i) => {
                const cam = cameras.find(c => c.id === m.camId) || {
                  name:   m.camName,
                  status: "offline",
                };
                return (
                  <div key={i} className="mv-legend__item">
                    <span className="mv-legend__num">{i + 1}</span>
                    <span className={`mv-cam-dot mv-cam-dot--${cam.status}`} />
                    <div className="mv-legend__info">
                      <span className="mv-legend__name">{cam.name}</span>
                      <span className="mv-legend__meta">
                        FOV {m.fovAngle || 60}° · {Math.round(m.direction || 0)}°
                      </span>
                    </div>
                    <button
                      className="mv-legend__remove"
                      onClick={() => removeMarker(i)}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Zoom controls */}
          <div className="mv-zoom-bar">
            <button
              className="mv-zbtn"
              onClick={() => {
                const el = wrapRef.current;
                if (el) applyZoom(-0.2, el.clientWidth / 2, el.clientHeight / 2);
              }}
            >
              −
            </button>
            <span className="mv-zoom-label">{zoomPct}%</span>
            <button
              className="mv-zbtn"
              onClick={() => {
                const el = wrapRef.current;
                if (el) applyZoom(0.2, el.clientWidth / 2, el.clientHeight / 2);
              }}
            >
              +
            </button>
            <button className="mv-zbtn mv-zbtn--fit" onClick={fitImage}>
              Fit
            </button>
          </div>
        </div>
        {/* ── end camera sidebar ── */}

      </div>
      {/* ── end mv-main ── */}

      {/* Stream / Alerts modal */}
      {streamCam && (
        <StreamModal cam={streamCam} onClose={() => setStreamCam(null)} />
      )}
    </div>
  );
}