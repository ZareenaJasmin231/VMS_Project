import { useState, useEffect, useRef, useCallback } from "react";
import WebRTCPlayer from "../../components/shared/WebRTCPlayer";
import "./LiveViewPage.css";

const API = import.meta.env.VITE_API_URL;

function getAuthHeaders() {
  const token = localStorage.getItem("miradorai_token");
  return token ? { "Authorization": "Bearer " + token } : {};
}

function loadDevices() {
  try { return JSON.parse(localStorage.getItem("miradorai_devices") || "[]"); }
  catch { return []; }
}

const LAYOUTS = [
  { id: "1x1", label: "1×1", cols: 1, icon: "▣" },
  { id: "2x2", label: "2×2", cols: 2, icon: "⊞" },
  { id: "3x3", label: "3×3", cols: 3, icon: "⊟" },
  { id: "1+3", label: "1+3", cols: "1+3", icon: "▤" },
];

const MASK_CANVAS_W = 640;
const MASK_CANVAS_H = 360;

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

// ── MaskOverlay ───────────────────────────────────────────────────
function MaskOverlay({ ip }) {
  const [masks, setMasks] = useState([]);

  useEffect(() => {
    if (!ip) return;
    fetch(`${API}/api/masks/${encodeURIComponent(ip)}`)
      .then(r => r.json())
      .then(data => setMasks((data.masks || []).filter(m => m.enabled !== false)))
      .catch(() => {});
  }, [ip]);

  useEffect(() => {
    if (!ip) return;
    const interval = setInterval(() => {
      fetch(`${API}/api/masks/${encodeURIComponent(ip)}`)
        .then(r => r.json())
        .then(data => setMasks((data.masks || []).filter(m => m.enabled !== false)))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [ip]);

  if (!masks.length) return null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${MASK_CANVAS_W} ${MASK_CANVAS_H}`}
      preserveAspectRatio="none"
      style={{
        position:      "absolute",
        top:           0,
        left:          0,
        width:         "100%",
        height:        "100%",
        pointerEvents: "none",
        zIndex:        10,
      }}
    >
      {masks.map(mask => {
        if (!mask.points?.length) return null;
        const pointsStr = mask.points.map(([x, y]) => `${x},${y}`).join(" ");
        return (
          <polygon
            key={mask.id}
            points={pointsStr}
            fill="black"
          />
        );
      })}
    </svg>
  );
}

// ── AlertPopup ────────────────────────────────────────────────────
function AlertPopup({ ip, alerts, onClose }) {
  const [playingAlert, setPlayingAlert] = useState(null);
  const [videoUrl,     setVideoUrl]     = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError,   setVideoError]   = useState(null);
 
  // Revoke blob URL when it changes or on unmount
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);
 
  const handleView = async (alert) => {
    // Revoke any previous blob URL before creating a new one
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
 
    setPlayingAlert(alert);
    setVideoError(null);
    setVideoLoading(true);
 
    try {
      const time = alert.time || alert.received_at;
      if (!time) throw new Error("Alert has no timestamp");
 
      // Normalise IP: strip underscores so the backend query matches
      const normIp = (ip || "").replace(/_/g, ".");
 
      const url =
        `${API}/api/event-playback` +
        `?ip=${encodeURIComponent(normIp)}` +
        `&time=${encodeURIComponent(time)}`;
 
      const res = await fetch(url, { headers: getAuthHeaders() });
 
      if (!res.ok) {
        // Try to parse JSON error, fall back to status text
        let errMsg = `Server error ${res.status}`;
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          try { const e = await res.json(); errMsg = e.error || errMsg; } catch {}
        } else {
          errMsg = `Playback failed (${res.status} ${res.statusText})`;
        }
        throw new Error(errMsg);
      }
 
      const blob = await res.blob();
      if (!blob || blob.size === 0) throw new Error("Server returned an empty video");
 
      const blobUrl = URL.createObjectURL(blob);
      setVideoUrl(blobUrl);
 
    } catch (e) {
      console.error("[AlertPopup] playback error:", e);
      setVideoError(e.message || "Playback failed");
    } finally {
      setVideoLoading(false);
    }
  };
 
  const handleBack = () => {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
    setPlayingAlert(null);
    setVideoError(null);
  };
 
  return (
    <div className="alp-overlay" onClick={onClose}>
      <div className="alp-modal" onClick={(e) => e.stopPropagation()}>
 
        {/* Header */}
        <div className="alp-header">
          <div className="alp-header__left">
            {playingAlert && (
              <button className="alp-back-btn" onClick={handleBack}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path d="M15 18l-6-6 6-6"/>
                </svg>
                Back
              </button>
            )}
            <span className="alp-title">
              {playingAlert
                ? "Event Playback"
                : `Alerts — ${(ip || "").replace(/_/g, ".")}`}
            </span>
          </div>
          <button className="alp-close-btn" onClick={onClose}>✕</button>
        </div>
 
        {/* ── Video Player View ── */}
        {playingAlert && (
          <div className="alp-player-area">
 
            {videoLoading && (
              <div className="alp-video-state">
                <div className="alp-spinner" />
                <span>Loading clip&hellip; (decrypting ±10 s around alert)</span>
              </div>
            )}
 
            {videoError && !videoLoading && (
              <div className="alp-video-state alp-video-state--error">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 8v4M12 16h.01"/>
                </svg>
                <span>{videoError}</span>
              </div>
            )}
 
            {/* key={videoUrl} forces React to remount <video> on every new clip  */}
            {videoUrl && !videoLoading && (
              <video
                key={videoUrl}
                className="alp-video"
                src={videoUrl}
                controls
                autoPlay
                playsInline
                style={{ width: "100%", display: "block", background: "#000" }}
              />
            )}
 
            <div className="alp-playback-meta">
              <span className="alp-meta-chip">{playingAlert.type || "—"}</span>
              <span className="alp-meta-chip">{playingAlert.scenario || "—"}</span>
              <span className="alp-meta-time">
                {playingAlert.time
                  ? playingAlert.time.split("T")[1]?.split("+")[0]
                  : playingAlert.received_at}
              </span>
            </div>
          </div>
        )}
 
        {/* ── Alert List View ── */}
        {!playingAlert && (
          <div className="alp-list">
            {alerts.length === 0 ? (
              <div className="alp-empty">No alerts for this camera</div>
            ) : (
              alerts.map((alert, i) => (
                <div key={i} className="alp-row">
                  <div className="alp-row__info">
                    <span className="alp-row__type">{alert.type || "Unknown"}</span>
                    <span className="alp-row__scenario">{alert.scenario || "—"}</span>
                    <span className="alp-row__time">
                      {alert.time
                        ? alert.time.split("T")[1]?.split("+")[0]
                        : alert.received_at}
                    </span>
                  </div>
                  <button
                    className="alp-view-btn"
                    onClick={() => handleView(alert)}
                    title="Play ±10 s around this alert"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    View
                  </button>
                </div>
              ))
            )}
          </div>
        )}
 
      </div>
    </div>
  );
}
// ── AlertsPanel ───────────────────────────────────────────────────
function AlertsPanel({ onAlertCountUpdate }) {
  const [alerts,  setAlerts]  = useState([]);
  const [loading, setLoading] = useState(true);
  const wsRef = useRef(null);

  const normalizeIp = (ip) => (ip || "").replace(/_/g, ".");

  const fetchAlerts = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/alerts?limit=50`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      const filtered = (data.alerts || [])
        .filter((a) => a.status === "Active")
        .filter(isAlertAllowed);
      setAlerts(filtered);
    } catch (e) {
      console.error("[Alerts] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  useEffect(() => {
    if (wsRef.current) return;

    const ws = new WebSocket(`${import.meta.env.VITE_WS_URL}/ws/events`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("✅ WS CONNECTED");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!isAlertAllowed(data)) return;

        const normIp = normalizeIp(data.ip);

        setAlerts((prev) => {
          const exists = prev.some((e) => e.received_at === data.received_at);
          if (exists) return prev;
          return [data, ...prev];
        });

        onAlertCountUpdate?.((prev) => ({
          ...prev,
          [normIp]: (prev[normIp] || 0) + 1,
        }));

        setLoading(false);
      } catch (err) {
        console.error("[WS] parse error:", err);
      }
    };

    ws.onerror = (err) => {
      console.error("[WS] error:", err);
    };

    ws.onclose = () => {
      console.log("❌ WS CLOSED");
      wsRef.current = null;
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  return (
    <div className="lv-alerts-panel">

      {/* Header */}
      <div className="lv-alerts-panel__header">
        <div className="lv-alerts-panel__title">
          <span className="lv-alerts-panel__dot" />
          Alerts
          <span className="lv-alerts-panel__count">{alerts.length}</span>
        </div>
      </div>

      {/* Alert list */}
      <div className="lv-alerts-panel__list">
        {loading ? (
          <div className="lv-alerts-panel__empty">Loading...</div>
        ) : alerts.length === 0 ? (
          <div className="lv-alerts-panel__empty">No alerts yet</div>
        ) : (
          alerts.map((alert, i) => {
            const isActive = alert.status === "Active";
            const type     = (alert.type || "").toLowerCase();

            let typeClass = "lv-alert-card--other";
            if      (type.includes("motion"))                                    typeClass = "lv-alert-card--motion";
            else if (type.includes("tamper"))                                    typeClass = "lv-alert-card--motion";
            else if (type.includes("linecrossing") || type.includes("crossing")) typeClass = "lv-alert-card--crossing";
            else if (type.includes("object") || type.includes("objectinarea"))   typeClass = "lv-alert-card--object";
            else if (type.includes("occupancy"))                                 typeClass = "lv-alert-card--object";

            const timeOnly = alert.time
              ? alert.time.split("T")[1]?.split("+")[0]
              : null;

            return (
              <div
                key={i}
                className={`lv-alert-card ${typeClass} ${isActive ? "lv-alert-card--active" : ""}`}
              >
                <div className="lv-alert-card__top">
                  <span className="lv-alert-card__serial">
                    {alert.serial || "Unknown"}
                  </span>
                  <span className={`lv-alert-card__badge ${isActive ? "lv-alert-card__badge--on" : "lv-alert-card__badge--off"}`}>
                    {isActive ? "● Active" : "○ Inactive"}
                  </span>
                </div>

                <div className="lv-alert-card__row">
                  <span className="lv-alert-card__label">Type</span>
                  <span className="lv-alert-card__value">{alert.type || "—"}</span>
                </div>

                <div className="lv-alert-card__row">
                  <span className="lv-alert-card__label">Event</span>
                  <span className="lv-alert-card__value">{alert.scenario || "—"}</span>
                </div>

                {(alert.type === "OccupancyCount" || alert.scenario === "OccupancyCount") && (
                  <div className="lv-alert-card__row">
                    <span className="lv-alert-card__label">People</span>
                    <span className="lv-alert-card__value">
                      👥 {alert.human ?? alert.total ?? "—"}
                    </span>
                  </div>
                )}

                {timeOnly && (
                  <div className="lv-alert-card__row">
                    <span className="lv-alert-card__label">Time</span>
                    <span className="lv-alert-card__value lv-alert-card__value--time">
                      {timeOnly}
                    </span>
                  </div>
                )}

                {alert.class && (
                  <div className="lv-alert-card__row">
                    <span className="lv-alert-card__label">Class</span>
                    <span className="lv-alert-card__value lv-alert-card__value--human">
                      👤 {alert.class}
                    </span>
                  </div>
                )}

                {alert.object_id && (
                  <div className="lv-alert-card__row">
                    <span className="lv-alert-card__label">Object ID</span>
                    <span className="lv-alert-card__value">{alert.object_id}</span>
                  </div>
                )}

                <div className="lv-alert-card__time">{alert.received_at}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── CameraCell ────────────────────────────────────────────────────
function CameraCell({ device, onFullscreen, alertCount, onBadgeClick, isRecording }) {
  const showRec = localStorage.getItem("miradorai_show_rec_ind") !== "false";
  const [isLive, setIsLive] = useState(false);
  return (
    <div
      className={`lv-cam ${alertCount > 0 ? "lv-cam--alert" : ""}`}
      style={{ position: "relative" }}
    >
      {/* CRITICAL: badge is rendered OUTSIDE lv-cam__player so it sits
          on top of the video; pointer-events: auto in CSS makes it clickable.
          We stop propagation so the parent lv-cell onClick (setSelected) doesn't fire. */}
      {alertCount > 0 && (
        <div
          className="lv-cam__alert-badge"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onBadgeClick?.();
          }}
          title={`${alertCount} alert${alertCount !== 1 ? "s" : ""} — click to view`}
        >
          {alertCount > 99 ? "99+" : alertCount}
        </div>
      )}

      <div className="lv-cell__header">
        {isLive && <span className="lv-live-dot" />}
        <span className="lv-cell__name">{device.name}</span>
        {isLive && showRec && isRecording && (
          <span className="lv-rec-dot" />
        )}
        <div className="lv-cell__actions">
          <span className="lv-cell__ip">{device.ip}</span>
          <button
            className="lv-cell__fs-btn"
            onClick={onFullscreen}
            title="Expand fullscreen"
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="lv-cam__player" style={{ position: "relative" }}>
        {device.ws_url ? (
          <>
            <WebRTCPlayer key={device.ws_url} serverUrl={device.ws_url} cameraId={device.id} onConnectChange={setIsLive} />
            <MaskOverlay ip={device.ip} />
          </>
        ) : (
          <div className="lv-no-stream">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="32" height="32">
              <path d="M23 7l-7 5 7 5V7z"/>
              <rect x="1" y="5" width="15" height="14" rx="2"/>
            </svg>
            <span>Stream not registered</span>
            <span className="lv-no-stream__ip">{device.ip}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── EmptyCell ─────────────────────────────────────────────────────
function EmptyCell() {
  return (
    <div className="lv-empty-cell">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" width="28" height="28">
        <path d="M23 7l-7 5 7 5V7z"/>
        <rect x="1" y="5" width="15" height="14" rx="2"/>
      </svg>
      <span>No Camera</span>
    </div>
  );
}

// ── LiveViewPage ──────────────────────────────────────────────────
export default function LiveViewPage() {
  const [devices,      setDevices]      = useState(loadDevices);
  const [layout,       setLayout]       = useState("2x2");
  const [selected,     setSelected]     = useState(null);
  const [fsDevice,     setFsDevice]     = useState(null);
  const [fsLive,       setFsLive]       = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [alertCounts,  setAlertCounts]  = useState({});
  const [popupIp,      setPopupIp]      = useState(null);
  const [popupAlerts,  setPopupAlerts]  = useState([]);
  const [activeRecorders, setActiveRecorders] = useState([]);
  const fsRef = useRef(null);
  const showRec = localStorage.getItem("miradorai_show_rec_ind") !== "false";

  // Poll active recording status from backend
  useEffect(() => {
    const fetchRecordingStatus = async () => {
      try {
        const res = await fetch(`${API}/api/recordings/status`, {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          setActiveRecorders(data.active_recorders || []);
        }
      } catch (e) {
        console.error("[LiveView] Recording status fetch failed:", e);
      }
    };
    fetchRecordingStatus();
    const interval = setInterval(fetchRecordingStatus, 8000);
    return () => clearInterval(interval);
  }, []);

  // Sync devices from localStorage
  useEffect(() => {
    const update = () => setDevices(loadDevices());
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);

  // Fullscreen change listener
  useEffect(() => {
    const onChange = () => {
      const active = !!(
        document.fullscreenElement       ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement
      );
      setIsFullscreen(active);
      if (!active) {
        setFsDevice(null);
        setFsLive(false);
      }
    };
    document.addEventListener("fullscreenchange",       onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    document.addEventListener("mozfullscreenchange",    onChange);
    return () => {
      document.removeEventListener("fullscreenchange",       onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      document.removeEventListener("mozfullscreenchange",    onChange);
    };
  }, []);

  // Pre-populate alert counts from DB on page load
  useEffect(() => {
    const loadInitialCounts = async () => {
      try {
        const res  = await fetch(`${API}/api/alerts?limit=50`, {
          headers: getAuthHeaders()
        });
        const data = await res.json();
        const counts = {};
        (data.alerts || [])
          .filter((a) => a.status === "Active")
          .filter(isAlertAllowed)
          .forEach((alert) => {
            const ip = (alert.ip || "").replace(/_/g, ".");
            if (ip) counts[ip] = (counts[ip] || 0) + 1;
          });
        setAlertCounts(counts);
      } catch (e) {
        console.error("[AlertCounts] load failed:", e);
      }
    };
    loadInitialCounts();
  }, []);

  // Request fullscreen when fsDevice is set
  useEffect(() => {
    if (!fsDevice || !fsRef.current) return;
    const el  = fsRef.current;
    const req = el.requestFullscreen
      || el.webkitRequestFullscreen
      || el.mozRequestFullScreen
      || el.msRequestFullscreen;
    if (req) {
      req.call(el).catch((err) => {
        console.warn("[LiveView] requestFullscreen failed:", err.message);
        setIsFullscreen(true);
      });
    } else {
      setIsFullscreen(true);
    }
  }, [fsDevice]);

  const openFullscreen = useCallback((device, e) => {
    e.stopPropagation();
    e.preventDefault();
    setFsLive(false);
    setFsDevice(device);
  }, []);

  const exitFullscreen = useCallback(() => {
    const exit = document.exitFullscreen
      || document.webkitExitFullscreen
      || document.mozCancelFullScreen
      || document.msExitFullscreen;
    if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) {
      exit.call(document).catch(() => {});
    } else {
      setFsDevice(null);
      setFsLive(false);
      setIsFullscreen(false);
    }
  }, []);

  // ── Open alert popup for a specific camera IP ─────────────────
  const openAlertPopup = useCallback(async (ip) => {
    try {
      const res  = await fetch(`${API}/api/alerts?limit=50`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      const normIp = (ip || "").replace(/_/g, ".");
      const filtered = (data.alerts || [])
        .filter((a) => a.status === "Active")
        .filter(isAlertAllowed)
        .filter((a) => (a.ip || "").replace(/_/g, ".") === normIp);
      setPopupAlerts(filtered);
      setPopupIp(ip);
    } catch (e) {
      console.error("[Popup] fetch failed:", e);
    }
  }, []);

  const closePopup = useCallback(() => {
    setPopupIp(null);
    setPopupAlerts([]);
  }, []);

  const activeCams    = devices.filter((d) => d.enabled !== false);
  const onlineCams    = activeCams.filter((d) => d.ws_url);
  const disabledCount = devices.length - activeCams.length;
  const cols          = layout === "1x1" ? 1 : layout === "2x2" ? 2 : layout === "3x3" ? 3 : 2;
  const is1plus3      = layout === "1+3";

  return (
    <div className="lv-page">

      {/* ── Toolbar ── */}
      <div className="lv-toolbar">
        <div className="lv-toolbar__left">
          <h1 className="lv-page-title">Live View</h1>
          <div className="lv-toolbar__stats">
            <span className="lv-toolbar__count">
              {onlineCams.length} stream{onlineCams.length !== 1 ? "s" : ""} online
            </span>
            {disabledCount > 0 && (
              <span className="lv-toolbar__disabled-badge">
                {disabledCount} disabled
              </span>
            )}
          </div>
        </div>
        <div className="lv-toolbar__right">
          <div className="lv-layouts">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                className={`lv-layout-btn ${layout === l.id ? "lv-layout-btn--active" : ""}`}
                title={l.label}
                onClick={() => setLayout(l.id)}
              >
                {l.icon}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main area ── */}
      <div className="lv-main-area">

        {/* ── Fullscreen overlay ── */}
        {fsDevice && (
          <div ref={fsRef} className="lv-fullscreen-overlay" tabIndex={-1}>
            <div className="lv-fullscreen-overlay__bar">
              <div className="lv-fullscreen-overlay__info">
                {fsLive && <span className="lv-live-dot" />}
                <span className="lv-fullscreen-overlay__name">{fsDevice.name}</span>
                {fsLive && showRec && (activeRecorders.includes(fsDevice?.stream_key) || activeRecorders.includes(fsDevice?.ome_stream)) && (
                  <span className="lv-rec-dot" />
                )}
                <span className="lv-fullscreen-overlay__ip">{fsDevice.ip}</span>
              </div>
              <button
                className="lv-fullscreen-overlay__exit"
                onClick={exitFullscreen}
                type="button"
                title="Exit fullscreen (Esc)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                  <path d="M8 3v3a2 2 0 01-2 2H3M21 8h-3a2 2 0 01-2-2V3M3 16h3a2 2 0 012 2v3M16 21v-3a2 2 0 012-2h3"/>
                </svg>
                Exit Fullscreen
              </button>
            </div>
            <div className="lv-fullscreen-overlay__player" style={{ position: "relative" }}>
              {fsDevice.ws_url ? (
                <>
                  <WebRTCPlayer key={`fs-${fsDevice.ws_url}`} serverUrl={fsDevice.ws_url} cameraId={fsDevice.id} onConnectChange={setFsLive} />
                  <MaskOverlay ip={fsDevice.ip} />
                </>
              ) : (
                <div className="lv-no-stream">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="48" height="48">
                    <path d="M23 7l-7 5 7 5V7z"/>
                    <rect x="1" y="5" width="15" height="14" rx="2"/>
                  </svg>
                  <span>No stream available</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Camera grid ── */}
        <div className="lv-grid-area">
          {devices.length === 0 ? (
            <div className="lv-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" width="64" height="64">
                <path d="M23 7l-7 5 7 5V7z"/>
                <rect x="1" y="5" width="15" height="14" rx="2"/>
              </svg>
              <p>No cameras enrolled yet.</p>
              <p className="lv-empty__sub">Go to <strong>Add Devices</strong> to enroll cameras.</p>
            </div>

          ) : activeCams.length === 0 ? (
            <div className="lv-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" width="64" height="64">
                <path d="M23 7l-7 5 7 5V7z"/>
                <rect x="1" y="5" width="15" height="14" rx="2"/>
                <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
              <p>All cameras are disabled.</p>
              <p className="lv-empty__sub">
                Enable cameras in <strong>Manage Camera Groups</strong> to view streams.
              </p>
            </div>

          ) : is1plus3 ? (
            <div className="lv-grid-1plus3">
              <div
                className={`lv-cell lv-cell--main ${selected === 0 ? "lv-cell--selected" : ""}`}
                onClick={() => setSelected(selected === 0 ? null : 0)}
              >
                <CameraCell
                  device={activeCams[0]}
                  onFullscreen={(e) => openFullscreen(activeCams[0], e)}
                  alertCount={alertCounts[activeCams[0]?.ip] || 0}
                  onBadgeClick={() => openAlertPopup(activeCams[0].ip)}
                  isRecording={activeCams[0] && (activeRecorders.includes(activeCams[0].stream_key) || activeRecorders.includes(activeCams[0].ome_stream))}
                />
              </div>
              <div className="lv-grid-1plus3__side">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`lv-cell ${selected === i ? "lv-cell--selected" : ""}`}
                    onClick={() => setSelected(selected === i ? null : i)}
                  >
                    {activeCams[i]
                      ? <CameraCell
                          device={activeCams[i]}
                          onFullscreen={(e) => openFullscreen(activeCams[i], e)}
                          alertCount={alertCounts[activeCams[i]?.ip] || 0}
                          onBadgeClick={() => openAlertPopup(activeCams[i].ip)}
                          isRecording={activeCams[i] && (activeRecorders.includes(activeCams[i].stream_key) || activeRecorders.includes(activeCams[i].ome_stream))}
                        />
                      : <EmptyCell />
                    }
                  </div>
                ))}
              </div>
            </div>

          ) : (
            <div className="lv-grid" style={{ "--cols": cols }}>
              {Array.from({ length: cols * cols }).map((_, i) => (
                <div
                  key={i}
                  className={`lv-cell ${selected === i ? "lv-cell--selected" : ""}`}
                  onClick={() => setSelected(selected === i ? null : i)}
                >
                  {activeCams[i]
                    ? <CameraCell
                        device={activeCams[i]}
                        onFullscreen={(e) => openFullscreen(activeCams[i], e)}
                        alertCount={alertCounts[activeCams[i]?.ip] || 0}
                        onBadgeClick={() => openAlertPopup(activeCams[i].ip)}
                        isRecording={activeCams[i] && (activeRecorders.includes(activeCams[i].stream_key) || activeRecorders.includes(activeCams[i].ome_stream))}
                      />
                    : <EmptyCell index={i} />
                  }
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Alerts panel ── */}
        <AlertsPanel onAlertCountUpdate={setAlertCounts} />

      </div>

      {/* ── Alert Popup — outside lv-main-area so it overlays everything ── */}
      {popupIp && (
        <AlertPopup
          ip={popupIp}
          alerts={popupAlerts}
          onClose={closePopup}
        />
      )}

    </div>
  );
}