import { useState, useEffect, useRef, useCallback } from "react";
import WebRTCPlayer from "../../components/shared/WebRTCPlayer";
import Hls from "hls.js";
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

const GRID_OPTIONS = [
  { id: "2x2", label: "2x2 Grid", rows: 2, cols: 2 },
  { id: "2x3", label: "2x3 Grid", rows: 2, cols: 3 },
  { id: "3x2", label: "3x2 Grid", rows: 3, cols: 2 },
  { id: "3x3", label: "3x3 Grid", rows: 3, cols: 3 },
  { id: "3x4", label: "3x4 Grid", rows: 3, cols: 4 },
  { id: "4x4", label: "4x4 Grid", rows: 4, cols: 4 }
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
// ── AlertPopup ────────────────────────────────────────────────────
function AlertPopup({ ip, alerts, onClose }) {
  const [playingAlert, setPlayingAlert] = useState(null);
  const [videoUrl,     setVideoUrl]     = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError,   setVideoError]   = useState(null);
  const [saveStatus,   setSaveStatus]   = useState({}); // { [alertKey]: "saving"|"saved"|"error" }

  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  // Revoke blob URL when it changes or on unmount
  useEffect(() => {
    return () => {
      if (videoUrl && videoUrl.startsWith("blob:")) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  // Handle HLS.js loading and binding dynamically
  useEffect(() => {
    if (!videoUrl || videoLoading) return;

    const video = videoRef.current;
    if (!video) return;

    // Clean up any existing Hls instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = videoUrl.includes(".m3u8");

    if (isHls) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        });
        hlsRef.current = hls;
        hls.loadSource(videoUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.error("[HLS] Network error, attempting to recover...");
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.error("[HLS] Media error, attempting to recover...");
                hls.recoverMediaError();
                break;
              default:
                console.error("[HLS] Unrecoverable error, destroying...");
                hls.destroy();
                hlsRef.current = null;
                setVideoError("Playback failed to stream");
                break;
            }
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS (Safari)
        video.src = videoUrl;
        video.addEventListener("loadedmetadata", () => {
          video.play().catch(() => {});
        });
      } else {
        setVideoError("HLS streaming is not supported on this browser.");
      }
    } else {
      // Non-HLS fallback (e.g. blobs, raw MP4s)
      video.src = videoUrl;
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [videoUrl, videoLoading]);

  const alertKey = (alert) =>
    `${(alert.ip || ip)}_${alert.time || alert.received_at}`;

  const handleView = async (alert) => {
    if (videoUrl) {
      if (videoUrl.startsWith("blob:")) {
        URL.revokeObjectURL(videoUrl);
      }
      setVideoUrl(null);
    }
    setPlayingAlert(alert);
    setVideoError(null);
    setVideoLoading(true);

    try {
      const time = alert.time || alert.received_at;
      if (!time) throw new Error("Alert has no timestamp");

      const normIp = (ip || "").replace(/_/g, ".");

      // Step 1 — call event-playback (no stream param) → get JSON with clip_url
      const url =
        `${API}/api/event-playback` +
        `?ip=${encodeURIComponent(normIp)}` +
        `&time=${encodeURIComponent(time)}`;

      const res = await fetch(url, { headers: getAuthHeaders() });

      if (!res.ok) {
        let errMsg = `Server error ${res.status}`;
        try { const e = await res.json(); errMsg = e.error || errMsg; } catch {}
        throw new Error(errMsg);
      }

      const data = await res.json();
      if (!data.clipUrl) throw new Error("No clip URL returned from server");

      // With HLS streaming, we do NOT fetch the whole video bytes as a Blob!
      // We pass the clipUrl straight to our player.
      setVideoUrl(data.clipUrl);

    } catch (e) {
      console.error("[AlertPopup] playback error:", e);
      setVideoError(e.message || "Playback failed");
    } finally {
      setVideoLoading(false);
    }
  };

  // ── Manual Save ───────────────────────────────────────────────
  const handleSave = async (alert) => {
    const key     = alertKey(alert);
    const normIp  = (alert.ip || ip || "").replace(/_/g, ".");
    const time    = alert.time || alert.received_at;

    if (!time) return;
    if (saveStatus[key] === "saving" || saveStatus[key] === "saved") return;

    setSaveStatus(prev => ({ ...prev, [key]: "saving" }));

    try {
      const res = await fetch(`${API}/api/event-clip/save`, {
        method:  "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body:    JSON.stringify({ ip: normIp, time }),
      });

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || `Save failed (${res.status})`);
      }

      setSaveStatus(prev => ({ ...prev, [key]: "saved" }));
    } catch (e) {
      console.error("[AlertPopup] save error:", e);
      setSaveStatus(prev => ({ ...prev, [key]: "error" }));
      // Reset error after 3s so user can retry
      setTimeout(() => {
        setSaveStatus(prev => ({ ...prev, [key]: undefined }));
      }, 3000);
    }
  };

  const handleBack = () => {
    if (videoUrl) {
      if (videoUrl.startsWith("blob:")) {
        URL.revokeObjectURL(videoUrl);
      }
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

            {videoUrl && !videoLoading && (
              <video
                key={videoUrl}
                ref={videoRef}
                className="alp-video"
                controls
                autoPlay
                playsInline
                style={{ width: "100%", display: "block", background: "#000" }}
              />
            )}

            {/* Save button shown once video is playing */}
            {videoUrl && !videoLoading && (() => {
              const key    = alertKey(playingAlert);
              const status = saveStatus[key];
              return (
                <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 0 0" }}>
                  <button
                    className={`alp-save-btn alp-save-btn--${status || "idle"}`}
                    onClick={() => handleSave(playingAlert)}
                    disabled={status === "saving" || status === "saved"}
                    title="Save encrypted clip to server"
                  >
                    {status === "saving" && (
                      <>
                        <div className="alp-spinner alp-spinner--sm" />
                        Saving…
                      </>
                    )}
                    {status === "saved" && (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Saved
                      </>
                    )}
                    {status === "error" && "⚠ Retry"}
                    {!status && (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                          <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
                          <polyline points="17 21 17 13 7 13 7 21"/>
                          <polyline points="7 3 7 8 15 8"/>
                        </svg>
                        Save Clip
                      </>
                    )}
                  </button>
                </div>
              );
            })()}

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
              alerts.map((alert, i) => {
                const key    = alertKey(alert);
                const status = saveStatus[key];
                return (
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
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      {/* Save button in list row */}
                      <button
                        className={`alp-save-btn alp-save-btn--sm alp-save-btn--${status || "idle"}`}
                        onClick={() => handleSave(alert)}
                        disabled={status === "saving" || status === "saved"}
                        title="Save encrypted clip"
                      >
                        {status === "saving" && <div className="alp-spinner alp-spinner--sm" />}
                        {status === "saved"  && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="11" height="11">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                        {status === "error"  && "⚠"}
                        {!status && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11">
                            <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
                            <polyline points="17 21 17 13 7 13 7 21"/>
                          </svg>
                        )}
                      </button>
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
                  </div>
                );
              })
            )}
          </div>
        )}

      </div>
    </div>
  );
}
// ── AlertsPanel ───────────────────────────────────────────────────
function AlertsPanel({ onAlertCountUpdate, onTotalAlertCountChange, isOpen }) {
  const [alerts,  setAlerts]  = useState([]);
  const [loading, setLoading] = useState(true);

  const normalizeIp = (ip) => (ip || "").replace(/_/g, ".");

  useEffect(() => {
    onTotalAlertCountChange?.(alerts.length);
  }, [alerts, onTotalAlertCountChange]);

  const fetchAlerts = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/alerts?limit=100`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      const filtered = (data.alerts || [])
        .filter((a) => a.status === "Active")
        .filter(isAlertAllowed);
      setAlerts(filtered);

      const counts = {};
      filtered.forEach((alert) => {
        const ip = normalizeIp(alert.ip);
        if (ip) {
          counts[ip] = (counts[ip] || 0) + 1;
        }
      });
      onAlertCountUpdate?.(counts);
    } catch (e) {
      console.error("[Alerts] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, [onAlertCountUpdate]);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  return (
    <div className={`lv-alerts-panel ${!isOpen ? "lv-alerts-panel--collapsed" : ""}`}>

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
  const [layout,       setLayout]       = useState("2x2"); // Default layout is 2x2 Grid
  const [currentPage,  setCurrentPage]  = useState(1);
  const [gridDropdownOpen, setGridDropdownOpen] = useState(false);
  const [gridFullscreen, setGridFullscreen] = useState(false);

  const [selected,     setSelected]     = useState(null);
  const [fsDevice,     setFsDevice]     = useState(null);
  const [fsLive,       setFsLive]       = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [alertCounts,  setAlertCounts]  = useState({});
  const [popupIp,      setPopupIp]      = useState(null);
  const [popupAlerts,  setPopupAlerts]  = useState([]);
  const [activeRecorders, setActiveRecorders] = useState([]);
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(true);
  const [totalAlertsCount, setTotalAlertsCount] = useState(0);
  
  const fsRef = useRef(null);
  const dropdownRef = useRef(null);
  const gridAreaRef = useRef(null);
  const showRec = localStorage.getItem("miradorai_show_rec_ind") !== "false";

  // Handle clicking outside of dropdown
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setGridDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Grid native fullscreen toggler
  const toggleGridFullscreen = () => {
    if (!gridAreaRef.current) return;
    if (!document.fullscreenElement) {
      gridAreaRef.current.requestFullscreen?.()
        .then(() => setGridFullscreen(true))
        .catch(err => console.error("Error going fullscreen:", err));
    } else {
      document.exitFullscreen?.()
        .then(() => setGridFullscreen(false))
        .catch(err => console.error("Error exiting fullscreen:", err));
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setGridFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

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

  // Fullscreen change listener for single camera fsDevice
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
        const res  = await fetch(`${API}/api/alerts?limit=100`, {
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
      const res  = await fetch(`${API}/api/alerts?limit=100`, {
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

  const currentGridOption = GRID_OPTIONS.find(o => o.id === layout) || GRID_OPTIONS[3]; // Default to 3x3
  const rows = currentGridOption.rows;
  const cols = currentGridOption.cols;
  const gridSize = rows * cols;

  const totalPages = Math.max(1, Math.ceil(activeCams.length / gridSize));
  
  // Bound currentPage
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const pageCams = activeCams.slice((currentPage - 1) * gridSize, currentPage * gridSize);

  const handleLayoutChange = (layoutId) => {
    setLayout(layoutId);
    setCurrentPage(1);
  };

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
        <div className="lv-toolbar__right" style={{ gap: "10px" }}>
          {/* Custom Grid Dropdown Selector */}
          <div className="lv-grid-dropdown-container" ref={dropdownRef}>
            <button
              className={`lv-grid-dropdown-trigger ${gridDropdownOpen ? "active" : ""}`}
              onClick={() => setGridDropdownOpen(!gridDropdownOpen)}
              type="button"
            >
              <svg className="lv-grid-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              <span>{currentGridOption.label}</span>
              <svg className={`lv-chevron-icon ${gridDropdownOpen ? "open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {gridDropdownOpen && (
              <div className="lv-grid-dropdown-menu">
                {GRID_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    className={`lv-grid-dropdown-item ${layout === opt.id ? "selected" : ""}`}
                    onClick={() => {
                      handleLayoutChange(opt.id);
                      setGridDropdownOpen(false);
                    }}
                    type="button"
                  >
                    <span className="lv-grid-dropdown-item-label">{opt.label}</span>
                    {layout === opt.id && (
                      <svg className="lv-check-icon" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="3" width="12" height="12">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Fullscreen Toggle Button */}
          <button
            className={`lv-fullscreen-toggle-btn ${gridFullscreen ? "active" : ""}`}
            onClick={toggleGridFullscreen}
            title={gridFullscreen ? "Exit Fullscreen" : "Fullscreen Grid"}
            type="button"
          >
            {gridFullscreen ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3" />
              </svg>
            )}
            <span>Fullscreen</span>
          </button>

          {/* Alerts Toggle Bell Button */}
          <button
            className={`lv-alerts-toggle-btn ${alertsPanelOpen ? "active" : ""}`}
            onClick={() => setAlertsPanelOpen(!alertsPanelOpen)}
            title={alertsPanelOpen ? "Hide Alerts Panel" : "Show Alerts Panel"}
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="14" height="14">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            {totalAlertsCount > 0 && (
              <span className="lv-alerts-bell-badge">
                {totalAlertsCount}
              </span>
            )}
          </button>
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
        <div className="lv-grid-area" ref={gridAreaRef}>
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

          ) : (
            <>
              <div
                className="lv-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                  gridTemplateRows: `repeat(${rows}, 1fr)`,
                  gap: "1px"
                }}
              >
                {Array.from({ length: gridSize }).map((_, i) => {
                  const cam = pageCams[i];
                  const absIndex = (currentPage - 1) * gridSize + i;
                  return (
                    <div
                      key={i}
                      className={`lv-cell ${selected === absIndex ? "lv-cell--selected" : ""}`}
                      onClick={() => setSelected(selected === absIndex ? null : absIndex)}
                    >
                      {cam
                        ? <CameraCell
                            device={cam}
                            onFullscreen={(e) => openFullscreen(cam, e)}
                            alertCount={alertCounts[cam?.ip] || 0}
                            onBadgeClick={() => openAlertPopup(cam.ip)}
                            isRecording={cam && (activeRecorders.includes(cam.stream_key) || activeRecorders.includes(cam.ome_stream))}
                          />
                        : <EmptyCell index={i} />
                      }
                    </div>
                  );
                })}
              </div>

              {/* Pagination Bar */}
              {activeCams.length > 0 && (
                <div className="lv-pagination">
                  <button
                    className="lv-page-btn"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    type="button"
                  >
                    &lt; Prev
                  </button>
                  <span className="lv-page-info">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    className="lv-page-btn"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    type="button"
                  >
                    Next &gt;
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Alerts panel ── */}
        <AlertsPanel
          onAlertCountUpdate={setAlertCounts}
          onTotalAlertCountChange={setTotalAlertsCount}
          isOpen={alertsPanelOpen}
        />

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