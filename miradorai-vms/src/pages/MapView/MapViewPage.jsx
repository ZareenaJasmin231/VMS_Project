import React, { useState, useEffect, useRef, useCallback } from "react";
import "./MapViewPage.css";
import WebRTCPlayer from "../../components/shared/WebRTCPlayer";

const API    = "http://192.168.126.200:8000";
const MAP_ID = "default";

// ── Auth ──────────────────────────────────────────────────────────
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
  const token = getToken();
  return token
    ? { Authorization: "Bearer " + token, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}
function isAuthed() { return !!getToken(); }

// ── LocalStorage persistence ──────────────────────────────────────
const LS_MARKERS = "miradorai_map_markers_" + MAP_ID;
const LS_FLOOR   = "miradorai_map_floor_"   + MAP_ID;

function lsSaveMarkers(m) { try { localStorage.setItem(LS_MARKERS, JSON.stringify(m)); } catch {} }
function lsLoadMarkers()  { try { return JSON.parse(localStorage.getItem(LS_MARKERS) || "[]"); } catch { return []; } }
function lsSaveFloor(d)   { try { localStorage.setItem(LS_FLOOR, d); } catch {} }
function lsLoadFloor()    { return localStorage.getItem(LS_FLOOR) || null; }

// ── API helpers ───────────────────────────────────────────────────
async function apiGetMap() {
  const res = await fetch(`${API}/api/maps?map_id=${MAP_ID}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}
async function apiSaveMarkers(markers) {
  const res = await fetch(`${API}/api/maps`, {
    method: "POST", headers: getAuthHeaders(),
    body: JSON.stringify({ map_id: MAP_ID, markers, floor_plan: null }),
  });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}
async function apiSaveFloorPlan(dataUrl) {
  const res = await fetch(`${API}/api/maps/floor-plan`, {
    method: "POST", headers: getAuthHeaders(),
    body: JSON.stringify({ map_id: MAP_ID, floor_plan: dataUrl }),
  });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}
async function apiDeleteMap() {
  await fetch(`${API}/api/maps?map_id=${MAP_ID}`, { method: "DELETE", headers: getAuthHeaders() });
}

// ── Stream + Alerts Modal ─────────────────────────────────────────
const StreamModal = React.memo(function StreamModal({ cam, onClose }) {
  const stableCam = useRef(cam);

  const [tab, setTab]         = useState("stream");
  const [alerts, setAlerts]   = useState({ motion: [], lineCrossing: [], idle: [] });
  const [alertLoading, setAL] = useState(false);

  useEffect(() => {
    if (tab !== "alerts") return;
    setAL(true);
    fetch(`${API}/api/alerts?camera_ip=${stableCam.current.ip}&limit=50`, { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const all = data.alerts || [];
        setAlerts({
          motion:       all.filter(a => (a.type || a.scenario || "").toLowerCase().includes("motion")),
          lineCrossing: all.filter(a => (a.type || a.scenario || "").toLowerCase().includes("line")),
          idle:         all.filter(a => (a.type || a.scenario || "").toLowerCase().includes("idle")),
        });
      })
      .catch(() => {})
      .finally(() => setAL(false));
  }, [tab]);

  return (
    <div className="mv-stream-overlay" onClick={onClose}>
      <div className="mv-stream-modal" onClick={e => e.stopPropagation()}>
        <div className="mv-stream-header">
          <div>
            <div className="mv-stream-title">{stableCam.current.name}</div>
            <div className="mv-stream-sub">
              {stableCam.current.ip}
              <span className={`mv-modal__badge mv-modal__badge--${stableCam.current.status}`} style={{ marginLeft: 8 }}>
                {stableCam.current.status === "online" ? "● Online" : "○ Offline"}
              </span>
            </div>
          </div>
          <button className="mv-stream-close" onClick={onClose}>✕</button>
        </div>

        <div className="mv-stream-tabs">
          <button className={`mv-stream-tab ${tab === "stream" ? "mv-stream-tab--active" : ""}`} onClick={() => setTab("stream")}>📹 Live Stream</button>
          <button className={`mv-stream-tab ${tab === "alerts" ? "mv-stream-tab--active" : ""}`} onClick={() => setTab("alerts")}>🔔 Alerts</button>
        </div>

        {tab === "stream" ? (
          <div className="mv-stream-body">
            {/* CHANGE 4: WebRTCPlayer uses stableCam.current.ws_url */}
            {stableCam.current.status === "online" && (
              <WebRTCPlayer
                key={stableCam.current.id}
                serverUrl={stableCam.current.ws_url}
                cameraId={stableCam.current.id}
              />
            )}
            <div className="mv-stream-offline" style={{ display: stableCam.current.status === "online" ? "none" : "flex" }}>
              <div style={{ fontSize: 48 }}>📷</div>
              <div style={{ marginTop: 8, color: "#888" }}>Camera offline</div>
            </div>
          </div>
        ) : (
          <div className="mv-alerts-body">
            {alertLoading ? (
              <div className="mv-alerts-loading">Loading alerts…</div>
            ) : (
              <>
                <AlertSection label="🏃 Motion"       items={alerts.motion} />
                <AlertSection label="⚡ Line Crossing" items={alerts.lineCrossing} />
                <AlertSection label="💤 Idle"          items={alerts.idle} />
                {!alerts.motion.length && !alerts.lineCrossing.length && !alerts.idle.length && (
                  <div className="mv-alerts-empty">No recent alerts for this camera</div>
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
            {a.time ? new Date(a.time).toLocaleTimeString()
              : a.received_at ? new Date(a.received_at).toLocaleTimeString() : "—"}
          </span>
          <span>{a.scenario || a.type || "Event"}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────
export default function MapViewPage() {
  const canvasRef       = useRef(null);
  const wrapRef         = useRef(null);
  const fileInputRef    = useRef(null);
  const floorImgRef     = useRef(null);
  const scaleRef        = useRef(1);
  const offsetRef       = useRef({ x: 0, y: 0 });
  const modeRef         = useRef("place");
  const draggingRef     = useRef(null);
  const panStartRef     = useRef(null);
  const hoveredIdxRef   = useRef(-1);
  const dragCamRef      = useRef(null);
  const markersRef      = useRef([]);
  const selectedCamRef  = useRef(null);
  const animFrameRef    = useRef(null);
  const saveTimerRef    = useRef(null);
  const mouseDownPosRef = useRef(null);
  const authFailedRef   = useRef(false);

  const [cameras,     setCameras]      = useState([]);
  const [markers,     setMarkersState] = useState([]);
  const [mode,        setMode]         = useState("place");
  const [zoomPct,     setZoomPct]      = useState(100);
  const [statusTxt,   setStatusTxt]    = useState("Loading map…");
  const [hasFloor,    setHasFloor]     = useState(false);
  const [pageLoading, setPageLoading]  = useState(true);
  const [saving,      setSaving]       = useState(false);
  const [saveErr,     setSaveErr]      = useState(false);
  const [showModal,   setShowModal]    = useState(false);
  const [pendingPos,  setPendingPos]   = useState(null);
  const [pendingCam,  setPendingCam]   = useState(null);
  const [selectedCam, setSelectedCam]  = useState(null);
  const [tooltip,     setTooltip]      = useState({ visible: false, x: 0, y: 0, text: "" });
  const [ctxMenu,     setCtxMenu]      = useState({ visible: false, x: 0, y: 0, idx: -1 });
  const [streamCam,   setStreamCam]    = useState(null);

  // ── Load on mount ─────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const lsMarkers = lsLoadMarkers();
      const lsFloor   = lsLoadFloor();

      if (lsMarkers.length) {
        markersRef.current = lsMarkers;
        setMarkersState([...lsMarkers]);
      }
      if (lsFloor) {
        const img = new Image();
        img.onload = () => { floorImgRef.current = img; setHasFloor(true); fitImage(); };
        img.src = lsFloor;
      }

      let camJson = [];
      try {
        // CHANGE 1: Use /api/discover-devices instead of /api/cameras
        const camRes = await fetch(`${API}/api/discover-devices`, { headers: getAuthHeaders() });
        if (camRes.status === 401) {
          authFailedRef.current = true;
          console.warn("[MapView] 401 on /api/discover-devices — token key:", Object.keys(localStorage).join(", "));
        } else if (camRes.ok) {
          // CHANGE 2: Parse camJson.devices instead of raw array
          const camJson = await camRes.json();
          camJson = normalizeCams(camJson.devices || []);
        }
      } catch {}

      if (!Array.isArray(camJson) || camJson.length === 0) {
        try { camJson = JSON.parse(localStorage.getItem("miradorai_devices") || "[]"); }
        catch { camJson = []; }
      }
      setCameras(normalizeCams(camJson));

      try {
        const mapData = await apiGetMap();
        const saved   = mapData.markers || [];
        if (saved.length) {
          markersRef.current = saved;
          setMarkersState([...saved]);
          lsSaveMarkers(saved);
        }
        if (mapData.floor_plan) {
          const img = new Image();
          img.onload = () => {
            floorImgRef.current = img;
            setHasFloor(true);
            setStatusTxt("Map restored — select a camera then click to place");
            fitImage();
          };
          img.src = mapData.floor_plan;
          lsSaveFloor(mapData.floor_plan);
        } else if (!lsFloor) {
          setStatusTxt("Import a floor plan to start placing cameras");
        } else {
          setStatusTxt("Map restored — select a camera then click to place");
        }
      } catch (e) {
        if (e.message === "401") authFailedRef.current = true;
        console.warn("[MapView] backend load failed:", e.message);
        setStatusTxt(lsFloor
          ? "Map restored from cache — select a camera then click to place"
          : "Import a floor plan to start placing cameras"
        );
      } finally {
        setPageLoading(false);
      }
    }
    init();

    const poll = setInterval(async () => {
      if (authFailedRef.current) return;
      try {
        // CHANGE 1 (poll): Use /api/discover-devices instead of /api/cameras
        const res = await fetch(`${API}/api/discover-devices`, { headers: getAuthHeaders() });
        if (res.status === 401) { authFailedRef.current = true; return; }
        if (res.ok) {
          const json = await res.json();
          // CHANGE 2 (poll): Parse json.devices instead of raw array
          const devices = json.devices || [];
          if (Array.isArray(devices) && devices.length > 0) { setCameras(normalizeCams(devices)); return; }
        }
      } catch {}
      try {
        const local = JSON.parse(localStorage.getItem("miradorai_devices") || "[]");
        setCameras(normalizeCams(local));
      } catch {}
    }, 15000);

    return () => clearInterval(poll);
  }, []);

  // CHANGE 3: normalizeCams includes ws_url and uses stream_key + stream_status
  function normalizeCams(data) {
    return (Array.isArray(data) ? data : []).map((d) => ({
      id:     d.stream_key || d.ome_stream || d.ip,
      name:   d.device_name || d.name || `Camera @ ${d.ip}`,
      ip:     d.ip,
      ws_url: d.ws_url,   // 🔥 IMPORTANT
      status: d.stream_status === "streaming" ? "online" : "offline",
    }));
  }

  // ── Persist ───────────────────────────────────────────────────
  const persistMarkers = useCallback((next) => {
    lsSaveMarkers(next);
    if (authFailedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      setSaveErr(false);
      try {
        await apiSaveMarkers(next);
        console.log("[MapView] ✅ Markers saved to MongoDB:", next.length);
      } catch (e) {
        if (e.message === "401") {
          authFailedRef.current = true;
          setSaveErr(true);
          console.warn("[MapView] 401 saving markers — check token. localStorage has a copy.");
        } else {
          console.warn("[MapView] save failed:", e.message);
        }
      } finally {
        setSaving(false);
      }
    }, 800);
  }, []);

  const updateMarkers = useCallback((next) => {
    markersRef.current = next;
    setMarkersState([...next]);
    persistMarkers(next);
  }, [persistMarkers]);

  // ── Draw ──────────────────────────────────────────────────────
  const drawAll = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap   = wrapRef.current;
    if (!canvas || !wrap) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    const img = floorImgRef.current;
    if (!img) return;
    const { x: ox, y: oy } = offsetRef.current;
    const scale = scaleRef.current;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);

    markersRef.current.forEach((m, i) => {
      const cam = cameras.find((c) => c.id === m.camId) || { name: m.camName || m.camId, ip: m.camIp || "", status: "offline" };
      const col = cam.status === "online" ? "#1D9E75" : "#888780";
      const r   = 13;
      const hov = i === hoveredIdxRef.current;

      ctx.beginPath(); ctx.arc(m.x, m.y, hov ? r + 5 : r + 2, 0, Math.PI * 2);
      ctx.fillStyle = col + "28"; ctx.fill();

      ctx.beginPath(); ctx.arc(m.x, m.y, hov ? r + 1 : r, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = hov ? 10 : 4;
      ctx.fill(); ctx.shadowBlur = 0;

      ctx.save(); ctx.translate(m.x, m.y);
      ctx.fillStyle = "#fff"; ctx.font = `bold ${hov ? 12 : 11}px monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText((i + 1).toString(), 0, 0); ctx.restore();

      if (hov) {
        const lbl = cam.name;
        ctx.font = "11px sans-serif";
        const tw = ctx.measureText(lbl).width;
        const bx = m.x - tw / 2 - 8, by = m.y - r - 28;
        ctx.fillStyle = "#0d1117ee";
        ctx.beginPath(); ctx.roundRect(bx, by, tw + 16, 20, 4); ctx.fill();
        ctx.fillStyle = "#e8edf5"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(lbl, m.x, by + 10);
      }
    });
    ctx.restore();
  }, [cameras]);

  useEffect(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(drawAll);
  }, [drawAll, markers]);

  // ── Fit / Zoom ────────────────────────────────────────────────
  const fitImage = useCallback(() => {
    const wrap = wrapRef.current, img = floorImgRef.current;
    if (!wrap || !img) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const s = Math.min(W / img.width, H / img.height) * 0.92;
    scaleRef.current  = s;
    offsetRef.current = { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2 };
    setZoomPct(Math.round(s * 100));
    drawAll();
  }, [drawAll]);

  const applyZoom = useCallback((delta, cx, cy) => {
    const prev = scaleRef.current;
    const next = Math.min(8, Math.max(0.08, prev + delta));
    scaleRef.current  = next;
    offsetRef.current = { x: cx - (cx - offsetRef.current.x) * (next / prev), y: cy - (cy - offsetRef.current.y) * (next / prev) };
    setZoomPct(Math.round(next * 100));
    drawAll();
  }, [drawAll]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const h = (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); applyZoom(e.deltaY < 0 ? 0.15 : -0.15, e.clientX - r.left, e.clientY - r.top); };
    canvas.addEventListener("wheel", h, { passive: false });
    return () => canvas.removeEventListener("wheel", h);
  }, [applyZoom]);

  useEffect(() => {
    const obs = new ResizeObserver(drawAll);
    if (wrapRef.current) obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, [drawAll]);

  // ── Helpers ───────────────────────────────────────────────────
  function toImgCoords(ex, ey) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return { x: (ex - r.left - offsetRef.current.x) / scaleRef.current, y: (ey - r.top - offsetRef.current.y) / scaleRef.current };
  }
  function nearestMarker(ix, iy) {
    const thr = 20 / scaleRef.current;
    let best = -1, bestD = thr;
    markersRef.current.forEach((m, i) => { const d = Math.hypot(m.x - ix, m.y - iy); if (d < bestD) { bestD = d; best = i; } });
    return best;
  }

  // ── Canvas events ─────────────────────────────────────────────
  const onMouseMove = useCallback((e) => {
    if (!floorImgRef.current) return;
    const p = toImgCoords(e.clientX, e.clientY);
    if (draggingRef.current !== null && modeRef.current === "place") { markersRef.current[draggingRef.current].x = p.x; markersRef.current[draggingRef.current].y = p.y; drawAll(); return; }
    if (panStartRef.current && modeRef.current === "pan") { offsetRef.current = { x: e.clientX - panStartRef.current.mx, y: e.clientY - panStartRef.current.my }; drawAll(); return; }
    const idx = nearestMarker(p.x, p.y);
    if (idx !== hoveredIdxRef.current) { hoveredIdxRef.current = idx; drawAll(); }
    if (idx >= 0) {
      const m = markersRef.current[idx];
      const cam = cameras.find((c) => c.id === m.camId) || { name: m.camId, ip: "", status: "offline" };
      setTooltip({ visible: true, x: e.nativeEvent.offsetX + 14, y: e.nativeEvent.offsetY - 32, text: `${cam.name}  •  ${cam.ip}  •  ${cam.status === "online" ? "🟢 Online" : "⚫ Offline"}` });
    } else { setTooltip((t) => ({ ...t, visible: false })); }
  }, [cameras, drawAll]);

  const onMouseDown = useCallback((e) => {
    if (!floorImgRef.current || e.button === 2) return;
    setCtxMenu((c) => ({ ...c, visible: false }));
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    const p   = toImgCoords(e.clientX, e.clientY);
    const idx = nearestMarker(p.x, p.y);
    if (modeRef.current === "pan") { panStartRef.current = { mx: e.clientX - offsetRef.current.x, my: e.clientY - offsetRef.current.y }; return; }
    if (idx >= 0) { draggingRef.current = idx; return; }
    if (selectedCamRef.current && modeRef.current === "place") { setPendingPos(p); setPendingCam(selectedCamRef.current); setShowModal(true); }
  }, []);

  const onMouseUp = useCallback((e) => {
    const wasDragging = draggingRef.current !== null;
    if (wasDragging) persistMarkers([...markersRef.current]);
    draggingRef.current = null;
    panStartRef.current = null;

    const down = mouseDownPosRef.current;
    mouseDownPosRef.current = null;
    if (!down) return;
    const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);

    if (dist <= 5 && !selectedCamRef.current) {
      const p   = toImgCoords(e.clientX, e.clientY);
      const idx = nearestMarker(p.x, p.y);
      if (idx >= 0) {
        const m   = markersRef.current[idx];
        const cam = cameras.find((c) => c.id === m.camId) || { id: m.camId, name: m.camName || m.camId, ip: m.camIp || "", status: "offline" };
        setStreamCam(null);
        setTimeout(() => setStreamCam(cam), 50);
      }
    }
  }, [cameras, persistMarkers]);

  const onContextMenu = useCallback((e) => {
    e.preventDefault();
    if (!floorImgRef.current) return;
    const p   = toImgCoords(e.clientX, e.clientY);
    const idx = nearestMarker(p.x, p.y);
    if (idx >= 0) setCtxMenu({ visible: true, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, idx });
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    if (!floorImgRef.current || !dragCamRef.current) return;
    const p = toImgCoords(e.clientX, e.clientY);
    setPendingPos(p); setPendingCam(dragCamRef.current); setShowModal(true); dragCamRef.current = null;
  }, []);

  // ── File import ───────────────────────────────────────────────
  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      const img = new Image();
      img.onload = () => { floorImgRef.current = img; setHasFloor(true); setStatusTxt("Floor plan loaded — select a camera then click to place"); fitImage(); };
      img.src = dataUrl;
      lsSaveFloor(dataUrl);
      if (!authFailedRef.current) {
        setSaving(true);
        try { await apiSaveFloorPlan(dataUrl); console.log("[MapView] ✅ Floor plan saved to MongoDB"); }
        catch (e) { if (e.message === "401") { authFailedRef.current = true; setSaveErr(true); } console.warn("[MapView] floor plan save failed:", e.message); }
        finally { setSaving(false); }
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  // ── Modes ─────────────────────────────────────────────────────
  function setPlaceMode() { modeRef.current = "place"; setMode("place"); setStatusTxt("Select a camera then click the map"); }
  function setPanMode()   { modeRef.current = "pan";   setMode("pan");   setStatusTxt("Drag to pan the map"); setSelectedCam(null); selectedCamRef.current = null; }
  async function clearAll() {
    if (!window.confirm("Remove all camera markers from the map?")) return;
    updateMarkers([]);
    lsSaveMarkers([]);
    setStatusTxt("All markers cleared");
    try { await apiDeleteMap(); } catch {}
  }

  function confirmPlacement() {
    if (!pendingPos || !pendingCam) return;
    const next = [
      ...markersRef.current.filter((m) => m.camId !== pendingCam.id),
      { camId: pendingCam.id, camName: pendingCam.name, camIp: pendingCam.ip, x: pendingPos.x, y: pendingPos.y },
    ];
    updateMarkers(next);
    setStatusTxt(`${pendingCam.name} placed on map`);
    setShowModal(false); setPendingPos(null); setPendingCam(null); setSelectedCam(null); selectedCamRef.current = null;
  }

  function removeMarker(idx) {
    updateMarkers(markersRef.current.filter((_, i) => i !== idx));
    setCtxMenu((c) => ({ ...c, visible: false }));
    setStatusTxt("Marker removed"); drawAll();
  }

  useEffect(() => { selectedCamRef.current = selectedCam; }, [selectedCam]);

  function selectCamera(cam) {
    if (modeRef.current !== "place") setPlaceMode();
    setSelectedCam((prev) => { const next = prev?.id === cam.id ? null : cam; selectedCamRef.current = next; return next; });
    setStatusTxt(`${cam.name} selected — click the map to place`);
  }

  const placedIds = new Set(markers.map((m) => m.camId));

  useEffect(() => {
    console.log("[MapView] localStorage keys:", Object.keys(localStorage));
    console.log("[MapView] token found:", getToken() ? "YES ✅" : "NO ❌ — check key name");
  }, []);

  return (
    <div className="mv-page" onClick={() => setCtxMenu((c) => ({ ...c, visible: false }))}>

      {/* Toolbar */}
      <div className="mv-toolbar">
        <div className="mv-toolbar__left">
          <span className="mv-toolbar__title">Map View</span>
          <div className="mv-sep" />
          <button className="mv-tbtn" onClick={() => fileInputRef.current?.click()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
            Import Floor Plan
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileChange} />
          <div className="mv-sep" />
          <button className={`mv-tbtn ${mode === "place" ? "mv-tbtn--active" : ""}`} onClick={setPlaceMode}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" strokeDasharray="2 3"/></svg>
            Place
          </button>
          <button className={`mv-tbtn ${mode === "pan" ? "mv-tbtn--active" : ""}`} onClick={setPanMode}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M12 3v18M3 12h18"/></svg>
            Pan
          </button>
          <button className="mv-tbtn mv-tbtn--danger" onClick={clearAll}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
            Clear All
          </button>
        </div>
        <div className="mv-toolbar__right">
          {saving && <span className="mv-saving">● Saving…</span>}
          {saveErr && <span className="mv-save-err" title="Token missing — data saved to browser cache only">⚠ Auth error — cached locally</span>}
          <span className="mv-status-txt">{statusTxt}</span>
        </div>
      </div>

      {/* Main */}
      <div className="mv-main">
        <div ref={wrapRef}
          className={`mv-canvas-wrap ${mode === "pan" ? "mv-pan-mode" : ""} ${selectedCam ? "mv-place-mode" : ""}`}
          onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>

          {pageLoading ? (
            <div className="mv-hint"><p className="mv-hint__title">Loading map…</p></div>
          ) : (
            <canvas ref={canvasRef}
              onMouseMove={onMouseMove}
              onMouseDown={onMouseDown}
              onMouseUp={onMouseUp}
              onMouseLeave={() => { setTooltip((t) => ({ ...t, visible: false })); hoveredIdxRef.current = -1; drawAll(); }}
              onContextMenu={onContextMenu}
            />
          )}

          {!hasFloor && !pageLoading && (
            <div className="mv-hint">
              <div className="mv-hint__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="56" height="56"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
              </div>
              <p className="mv-hint__title">No floor plan imported</p>
              <p className="mv-hint__sub">Click <strong>Import Floor Plan</strong> to upload a JPEG or PNG</p>
            </div>
          )}

          {tooltip.visible && <div className="mv-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>{tooltip.text}</div>}

          {ctxMenu.visible && (
            <div className="mv-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
              <button className="mv-ctx-item mv-ctx-item--danger" onClick={() => removeMarker(ctxMenu.idx)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                Remove marker
              </button>
            </div>
          )}

          {showModal && (
            <div className="mv-modal-overlay">
              <div className="mv-modal">
                <div className="mv-modal__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                </div>
                <h3 className="mv-modal__title">Confirm camera location</h3>
                <p className="mv-modal__body">Link <strong>{pendingCam?.name}</strong> to this position on the map?</p>
                <div className="mv-modal__meta">
                  <span>{pendingCam?.ip}</span>
                  <span className={`mv-modal__badge mv-modal__badge--${pendingCam?.status}`}>
                    {pendingCam?.status === "online" ? "● Online" : "○ Offline"}
                  </span>
                </div>
                <div className="mv-modal__row">
                  <button className="mv-modal__btn mv-modal__btn--cancel" onClick={() => { setShowModal(false); setPendingPos(null); setPendingCam(null); }}>Cancel</button>
                  <button className="mv-modal__btn mv-modal__btn--confirm" onClick={confirmPlacement}>Confirm</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
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
            ) : cameras.map((cam) => {
              const placed   = placedIds.has(cam.id);
              const isActive = selectedCam?.id === cam.id;
              return (
                <div key={cam.id}
                  className={`mv-cam-item ${placed ? "mv-cam-item--placed" : ""} ${isActive ? "mv-cam-item--active" : ""}`}
                  draggable onDragStart={() => { dragCamRef.current = cam; }}
                  onClick={() => selectCamera(cam)}>
                  <span className={`mv-cam-dot mv-cam-dot--${cam.status}`} />
                  <div className="mv-cam-info">
                    <span className="mv-cam-name">{cam.name}</span>
                    <span className="mv-cam-ip">{cam.ip}</span>
                  </div>
                  {placed && <span className="mv-cam-badge">placed</span>}
                </div>
              );
            })}
          </div>

          {markers.length > 0 && (
            <div className="mv-legend">
              <div className="mv-legend__head">Placed ({markers.length})</div>
              {markers.map((m, i) => {
                const cam = cameras.find((c) => c.id === m.camId) || { name: m.camName, status: "offline" };
                return (
                  <div key={i} className="mv-legend__item">
                    <span className="mv-legend__num">{i + 1}</span>
                    <span className={`mv-cam-dot mv-cam-dot--${cam.status}`} />
                    <span className="mv-legend__name">{cam.name}</span>
                    <button className="mv-legend__remove" onClick={() => removeMarker(i)} title="Remove">✕</button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mv-zoom-bar">
            <button className="mv-zbtn" onClick={() => { const W = (wrapRef.current?.clientWidth || 0) / 2; const H = (wrapRef.current?.clientHeight || 0) / 2; applyZoom(-0.2, W, H); }}>−</button>
            <span className="mv-zoom-label">{zoomPct}%</span>
            <button className="mv-zbtn" onClick={() => { const W = (wrapRef.current?.clientWidth || 0) / 2; const H = (wrapRef.current?.clientHeight || 0) / 2; applyZoom(0.2, W, H); }}>+</button>
            <button className="mv-zbtn mv-zbtn--fit" onClick={fitImage}>Fit</button>
          </div>
        </div>
      </div>

      {streamCam && <StreamModal cam={streamCam} onClose={() => setStreamCam(null)} />}
    </div>
  );
}