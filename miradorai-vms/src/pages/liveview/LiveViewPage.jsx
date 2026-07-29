import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import WebRTCPlayer_MediaMTX from "../../components/shared/WebRTCPlayer_MediaMTX";
import HlsPlayer from "../../components/shared/HlsPlayer";
import Hls from "hls.js";
import { useDigitalZoom } from "../../hooks/useDigitalZoom";
import SidePlaybackPanel from "../../components/shared/SidePlaybackPanel";
import PTZControls from "../../components/shared/PTZControls";
import { useAuth } from "../../context/AuthContext";
import "./LiveViewPage.css";
import { useWebSocket } from "../../hooks/useWebSocket";

const API = import.meta.env.VITE_API_URL || "";

function getAuthHeaders() {
  const token =
      localStorage.getItem("miradorai_token") ||
      localStorage.getItem("token") ||
      localStorage.getItem("authToken");
  return token ? { "Authorization": "Bearer " + token } : {};
}

function loadDevices() {
  try { return JSON.parse(localStorage.getItem("miradorai_devices") || "[]"); }
  catch { return []; }
}

function getCameraNameByIpOrSerial(ipOrSerial) {
  if (!ipOrSerial) return "";
  const norm = ipOrSerial.replace(/_/g, ".");
  const devices = loadDevices();
  const found = devices.find(d => 
    (d.ip && d.ip.replace(/_/g, ".") === norm) || 
    (d.serial && d.serial === ipOrSerial) ||
    String(d.id) === String(ipOrSerial)
  );
  return found ? found.name : "";
}

const GRID_OPTIONS = [
  { id: "2x2", label: "2x2 Grid", rows: 2, cols: 2 },
  { id: "2x3", label: "2x3 Grid", rows: 2, cols: 3 },
  { id: "3x2", label: "3x2 Grid", rows: 3, cols: 2 },
  { id: "3x3", label: "3x3 Grid", rows: 3, cols: 3 },
  { id: "3x4", label: "3x4 Grid", rows: 3, cols: 4 },
  { id: "4x4", label: "4x4 Grid", rows: 4, cols: 4 },
  // { id: "8x8", label: "8x8 Grid", rows: 8, cols: 8 }
  { id: "8x8", label: "8x8 Grid", rows: 8, cols: 8 },
  { id: "spotlight", label: "Spotlight", rows: 4, cols: 4, isSpotlight: true, pageSize: 8 }
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
    if (key.includes("object"))       return type.includes("object")       || type.includes("objectinarea") || type.includes("detection");
    if (key.includes("occupancy"))    return type.includes("occupancy")    || scenario.includes("occupancy");
    if (key.includes("linecrossing")) return type.includes("linecrossing") || type.includes("crossing");
    if (key.includes("loitering"))    return type.includes("loitering")    || scenario.includes("loitering");
    if (key.includes("intrusion"))    return type.includes("intrusion")    || scenario.includes("intrusion");
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
export function AlertPopup({ ip, alerts, onClose }) {
  const [playingAlert, setPlayingAlert] = useState(null);
  const [videoUrl,     setVideoUrl]     = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError,   setVideoError]   = useState(null);
  const [sharpness,    setSharpness]    = useState(0);

  const cssFilter = useMemo(() => {
    const sharpnessContrast = 1 + (sharpness / 400);
    return `contrast(${sharpnessContrast.toFixed(3)})`;
  }, [sharpness]);

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const playerWrap = useRef(null);
  const { zoom, zoomTransform, handlers } = useDigitalZoom(playerWrap, videoRef);

  useEffect(() => {
    return () => {
      if (videoUrl && videoUrl.startsWith("blob:")) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  useEffect(() => {
    if (!videoUrl || videoLoading) return;

    const video = videoRef.current;
    if (!video) return;

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
        video.src = videoUrl;
        video.addEventListener("loadedmetadata", () => {
          video.play().catch(() => {});
        });
      } else {
        setVideoError("HLS streaming is not supported on this browser.");
      }
    } else {
      video.src = videoUrl;
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [videoUrl, videoLoading]);

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

      const safeIp = (ip || "").replace(/\./g, "_");

      const url =
        `${API}/api/event-playback` +
        `?ip=${encodeURIComponent(safeIp)}` +
        `&time=${encodeURIComponent(time)}`;

      const res = await fetch(url, { headers: getAuthHeaders() });

      if (!res.ok) {
        let errMsg = `Server error ${res.status}`;
        try { const e = await res.json(); errMsg = e.error || errMsg; } catch {}
        throw new Error(errMsg);
      }

      const data = await res.json();
      setVideoUrl(data.clipUrl);

    } catch (e) {
      console.error("[AlertPopup] playback error:", e);
      setVideoError(e.message || "Playback failed");
    } finally {
      setVideoLoading(false);
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
a
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
                : (() => {
                    const name = getCameraNameByIpOrSerial(ip);
                    const formattedIp = (ip || "").replace(/_/g, ".");
                    return name ? `Alerts — ${name} (${formattedIp})` : `Alerts — ${formattedIp}`;
                  })()}
            </span>
          </div>
          <button className="alp-close-btn" onClick={onClose}>✕</button>
        </div>

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
              <>
                <div 
                  ref={playerWrap}
                  {...handlers}
                  style={{ overflow: "hidden", cursor: zoom > 1 ? "grab" : "default", position: "relative", width: "100%", background: "#000" }}
                >
                  <video
                    key={videoUrl}
                    ref={videoRef}
                    className="alp-video"
                    controls
                    autoPlay
                    playsInline
                    style={{ width: "100%", display: "block", background: "#000", transform: zoomTransform, filter: cssFilter, transition: "filter 0.1s ease" }}
                  />
                </div>

                <div className="alp-sharpness-container" style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginTop: "10px",
                  background: "rgba(255,255,255,0.03)",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid rgba(255,255,255,0.06)"
                }}>
                  <span style={{ fontSize: "11px", fontWeight: "600", color: "#94a3b8" }}>SHARPNESS:</span>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="5"
                    value={sharpness}
                    onChange={(e) => setSharpness(Number(e.target.value))}
                    style={{ flex: 1, height: "3px", accentColor: "#10b981", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "11px", fontFamily: "monospace", color: "#10b981", minWidth: "28px", textAlign: "right" }}>
                    {sharpness > 0 ? "+" : ""}{sharpness}
                  </span>
                </div>
              </>
            )}

            <div className="alp-playback-meta" style={{ marginTop: "16px" }}>
              <span className="alp-meta-chip">{playingAlert.type || "—"}</span>
              <span className="alp-meta-time">
                {playingAlert.time
                  ? playingAlert.time.split("T")[1]?.split("+")[0]
                  : playingAlert.received_at}
              </span>
            </div>
          </div>
        )}

        {!playingAlert && (
          <div className="alp-list">
            {alerts.length === 0 ? (
              <div className="alp-empty">No alerts for this camera</div>
            ) : (
              alerts.map((alert, i) => {
                return (
                  <div key={i} className="alp-row">
                    <div className="alp-row__info">
                      <span className="alp-row__type">{alert.type || "Unknown"}</span>
                      <span className="alp-row__time">
                        {alert.time
                          ? alert.time.split("T")[1]?.split("+")[0]
                          : alert.received_at}
                      </span>
                    </div>
                      <button
                        className="alp-view-btn"
                        onClick={() => handleView(alert)}
                      >
                        View
                      </button>
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
function AlertsPanel({ isOpen, onAlertCountUpdate, onTotalAlertCountChange, liveStatus, alertSource, setAlertSource, devices: devicesProp }) {
  const [alerts,     setAlerts]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [zoomedImage, setZoomedImage] = useState(null);

  useEffect(() => {
    onTotalAlertCountChange?.(alerts.length);
    const counts = {};
    alerts.forEach((alert) => {
      const ip = (alert.ip || alert.serial || "").replace(/_/g, ".");
      if (ip) {
        counts[ip] = (counts[ip] || 0) + 1;
      }
    });
    onAlertCountUpdate?.(counts);
  }, [alerts, onTotalAlertCountChange, onAlertCountUpdate]);

  const normalizeIp = (ip) => (ip || "").replace(/_/g, ".");

  const buildAlertThumbnailUrl = (alert) => {
    // Prefer persisted snapshot if present on the alert document
    if (alert?.snapshot_url) return alert.snapshot_url;
    if (alert?.snapshotUrl) return alert.snapshotUrl;
    if (alert?.snapshot) return alert.snapshot;

    const ip = normalizeIp(alert.ip || alert.serial || "");
    const time = alert.time || alert.received_at || "";
    if (!ip || !time) return null;
    return `${API}/api/event-playback/snapshot?ip=${encodeURIComponent(ip)}&time=${encodeURIComponent(time)}`;
  };

  const buildAlertThumbnailAltUrl = (alert) => {
    const ip = normalizeIp(alert.ip || alert.serial || "");
    const time = alert.time || alert.received_at || "";
    if (!ip || !time) return null;
    return `${API}/api/event-playback/snapshot?ip=${encodeURIComponent(ip)}&time=${encodeURIComponent(time)}`;
  };
 
  const fetchLiveSnapshotForIp = async (ip) => {
    if (!ip) return null;
    try {
      const ipDot = (ip || "").replace(/_/g, ".");
      const res = await fetch(`${API}/api/camera/brand/snapshot/${encodeURIComponent(ipDot)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data?.snapshot || null; // data.snapshot is a data:image/... base64 string
    } catch (e) {
      return null;
    }
  };

  const fetchAlerts = useCallback(async () => {
    try {
      if (alertSource === "builtin") {
        const res  = await fetch(`${API}/api/alerts?limit=5000`, {
          headers: getAuthHeaders()
        });
        if (!res.ok) return;
        const data = await res.json();
        const filtered = (data.alerts || [])
          .filter((a) => {
             const t = (a.type || "").toLowerCase();
             return t !== "unknown" && t !== "" && !t.includes("tns1:");
          })
          .filter(isAlertAllowed);
        const perCamCounts = {};
        const finalAlerts = [];
        filtered.forEach((alert) => {
          if (!alert.isExternal) {
            alert.thumbnailUrl = buildAlertThumbnailUrl(alert);
            alert.thumbnailAltUrl = buildAlertThumbnailAltUrl(alert);
          }
          const ip = normalizeIp(alert.ip);
          if (ip) {
            perCamCounts[ip] = (perCamCounts[ip] || 0) + 1;
            if (perCamCounts[ip] <= 50) {
              finalAlerts.push(alert);
            }
          } else {
            finalAlerts.push(alert);
          }
        });
        
        finalAlerts.sort((a, b) => {
          const tA = new Date(a.time || a.received_at).getTime() || 0;
          const tB = new Date(b.time || b.received_at).getTime() || 0;
          return tB - tA;
        });

        setAlerts(finalAlerts);

        // Fire off live snapshot fetches for the top recent alerts (non-blocking)
        (async () => {
          try {
            const toFetch = finalAlerts.slice(0, 30); // limit concurrent calls
            await Promise.all(toFetch.map(async (a) => {
              if (a.isExternal) return;
              const ip = a.ip || a.serial || "";
              const snap = await fetchLiveSnapshotForIp(ip);
              if (snap) {
                setAlerts((prev) => prev.map((p) => ((p === a) ? { ...p, liveSnapshot: snap } : p)));
              }
            }));
          } catch (e) {
            // ignore
          }
        })();

      } else {
        // External AI Alerts Mode — separate call per reader_id
        const activeCams = (devicesProp && devicesProp.length > 0) ? devicesProp : loadDevices();
        const readerIds = activeCams.map(d => d.reader_id).filter(Boolean);

        if (readerIds.length === 0) return; // no registered AI cameras yet

        const authHeader = {
          "Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ7XCJpZFwiOlwiN2MxYzVhMzYtOGM0ZS00YzdlLTlkNmEtMWE3ZjFlOWQyYTQxXCIsXCJlbWFpbFwiOlwiYWRtaW5AbWlyYWRvci5haVwiLFwidGVuYW50SWRcIjpcIjZhNWVkMmE0LWI2MTQtNDY3My1iOWUzLTFiYTEwNzM4M2VmZVwiLFwiZmlyc3ROYW1lXCI6XCJBZG1pblwiLFwibGFzdE5hbWVcIjpudWxsfSIsImlhdCI6MTc4NDY5OTc0OX0.70FwbJjKRihC_YRN3w2icZKgWxld_zKFjrMoRVDyYMQ",
          "Content-Type": "application/json"
        };

        // Fire one request per reader_id in parallel
        const responses = await Promise.all(
          readerIds.map(rid =>
            fetch(`/external-ai-api/getalert?readerIds=${encodeURIComponent(rid)}&page=1&size=50`, { headers: authHeader })
              .then(r => r.ok ? r.json() : { data: [] })
              .catch(() => ({ data: [] }))
          )
        );

        // Merge all results into one flat list
        const fixUrl = (imgUrl) => {
          if (!imgUrl) return "";
          if (imgUrl.includes("localhost:9000"))          return imgUrl.replace("http://localhost:9000",          "http://192.168.126.201:8006");
          if (imgUrl.includes("127.0.0.1:9000"))          return imgUrl.replace("http://127.0.0.1:9000",          "http://192.168.126.201:8006");
          if (imgUrl.includes("192.168.126.201:9000"))    return imgUrl.replace("http://192.168.126.201:9000",    "http://192.168.126.201:8006");
          return imgUrl;
        };

        const mapped = responses.flatMap(extData =>
          (extData.data || []).map(item => ({
            isExternal: true,
            id:     item.id,
            ip:     item.readerIp || "",
            serial: item.readerId || "",
            time:   item.detectionTime || "",
            image:  fixUrl(item.image || ""),
            status: item.statusName || "Active",
            rawData: item
          }))
        );

        mapped.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
        setAlerts(mapped);
      }
    } catch (e) {
      console.error("[Alerts] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, [onAlertCountUpdate, liveStatus, alertSource, devicesProp]);
    const { isConnected: isWsConnected, eventsByTopic } = useWebSocket(["alerts"]);

  // Listen to incoming WebSocket alerts in real time
  useEffect(() => {
    const alertEnvelope = eventsByTopic.alerts;
    if (alertEnvelope && alertEnvelope.data) {
      const payload = alertEnvelope.data;
      const newAlert = {
        ...payload,
        thumbnailUrl: buildAlertThumbnailUrl(payload),
        thumbnailAltUrl: buildAlertThumbnailAltUrl(payload)
      };

      // fetch live snapshot for real-time alert (non-blocking)
      (async () => {
        try {
          if (!newAlert.isExternal) {
            const ip = newAlert.ip || newAlert.serial || "";
            const snap = await fetchLiveSnapshotForIp(ip);
            if (snap) newAlert.liveSnapshot = snap;
          }
        } catch (e) {}
        setAlerts((prev) => {
          const exists = prev.some((a) => (a.alert_id || a._id) === (newAlert.alert_id || newAlert._id));
          if (exists) return prev;
          return [newAlert, ...prev].slice(0, 500);
        });
      })();
    }
  }, [eventsByTopic.alerts]);

  useEffect(() => {
    fetchAlerts();
    if (isWsConnected) return; // Zero HTTP polling when WebSocket is connected
    const interval = setInterval(fetchAlerts, 5000);    return () => clearInterval(interval);
  }, [fetchAlerts, isWsConnected]);

  return (
    <div className={`lv-alerts-panel ${!isOpen ? "lv-alerts-panel--collapsed" : ""}`}>

      <div className="lv-alerts-panel__header">
        <div className="lv-alerts-panel__title">
          <span className="lv-alerts-panel__dot" />
          Alerts
          <span className="lv-alerts-panel__count">{alerts.length}</span>
        </div>

        {/* Source Toggle Switch */}
        <div className="lv-alert-source-toggle" title="Switch between VMS Built-in alerts and External AI team alerts">
          <button
            type="button"
            className={`lv-source-btn ${alertSource === "builtin" ? "active" : ""}`}
            onClick={() => { setLoading(true); setAlertSource("builtin"); }}
          >
            Built-in
          </button>
          <button
            type="button"
            className={`lv-source-btn ${alertSource === "external" ? "active" : ""}`}
            onClick={() => { setLoading(true); setAlertSource("external"); }}
          >
            External AI
          </button>
        </div>
      </div>

      <div className="lv-alerts-panel__list">
        {loading ? (
          <div className="lv-alerts-panel__empty">Loading...</div>
        ) : alerts.length === 0 ? (
          <div className="lv-alerts-panel__empty">No alerts yet</div>
        ) : (
          alerts.map((alert, i) => {
            const isActive = alert.status === "Active";
            const ipStr = alert.ip || alert.serial || "";
            let typeClass = "lv-alert-card--other";
            if      (ipStr.includes("235")) typeClass = "lv-alert-card--cam235";
            else if (ipStr.includes("238")) typeClass = "lv-alert-card--cam238";
            else if (ipStr.includes("236")) typeClass = "lv-alert-card--cam236";
            else if (ipStr.includes("240")) typeClass = "lv-alert-card--cam240";

            const timeOnly = alert.time
              ? alert.time.split("T")[1]?.split("+")[0]
              : null;

            const cameraName = getCameraNameByIpOrSerial(alert.ip || alert.serial);
            const displayId = (alert.ip || alert.serial || "Unknown").replace(/_/g, ".");
            const thumbnailUrl = alert.image || alert.thumbnailUrl || null;
 
            return (
              <div
                key={i}
                className={`lv-alert-card ${typeClass} ${isActive ? "lv-alert-card--active" : ""}`}
              >
                <div className="lv-alert-card__layout">
                  <div className="lv-alert-card__info">
                    {!alert.isExternal && (
                      <div className="lv-alert-card__top">
                        <span className="lv-alert-card__serial" title={displayId}>
                          {cameraName ? `${cameraName} (${displayId})` : displayId}
                        </span>
                      </div>
                    )}

                    {alert.isExternal ? (
                      (() => {
                        const raw = alert.rawData || {};
                        
                        // Parse event subType: e.g. "fr-blacklist" -> format to "Blacklist" or "fr-blacklist"
                        let eventType = raw.subType || raw.sourceType || "AI Event";
                        if (eventType.startsWith("fr-")) {
                          eventType = eventType.substring(3); // e.g. "blacklist"
                        }
                        // Capitalize first letter
                        eventType = eventType.charAt(0).toUpperCase() + eventType.slice(1);

                        // Person/Employee name: e.g. राजेश (Rajesh) from "empName"
                        const personName = raw.empName || raw.employeeName || raw.personName || raw.name || raw.label || "";
                        let eventText = "";
                        if (!personName || personName.toLowerCase().includes("unknown")) {
                          eventText = "Unknown";
                        } else {
                          eventText = `${eventType} - ${personName}`;
                        }
                        
                        const locationText = raw.locationName || raw.location || "Tek Towers"; 
                        const cameraText = raw.readerName || raw.cameraName || raw.camera || "Mirador";

                        // Split detectionTime into date and time parts
                        const dtPart = raw.detectionTime || "";
                        const dateOnly = dtPart.split("T")[0] || "—";
                        const timeOnlyPart = dtPart.includes("T") 
                          ? dtPart.split("T")[1]?.split("+")[0] 
                          : "—";

                        return (
                          <>
                            <div className="lv-alert-card__top">
                              <span className="lv-alert-card__serial" style={{ fontWeight: "600", color: "#ffffff" }}>
                                {cameraText} ({raw.readerIp || alert.ip || "Unknown"})
                              </span>
                            </div>

                            <div className="lv-alert-card__row">
                              <span className="lv-alert-card__label">Event</span>
                              <span className="lv-alert-card__value" style={{ color: "#ff4d4f" }}>{eventText}</span>
                            </div>

                            <div className="lv-alert-card__row">
                              <span className="lv-alert-card__label">Location</span>
                              <span className="lv-alert-card__value">{locationText}</span>
                            </div>

                            <div className="lv-alert-card__row">
                              <span className="lv-alert-card__label">Time</span>
                              <span className="lv-alert-card__value lv-alert-card__value--time">{timeOnlyPart}</span>
                            </div>

                            <div className="lv-alert-card__row">
                              <span className="lv-alert-card__label">Date</span>
                              <span className="lv-alert-card__value lv-alert-card__value--date">{dateOnly}</span>
                            </div>
                          </>
                        );
                      })()
                    ) : (
                      <>
                        <div className="lv-alert-card__row">
                          <span className="lv-alert-card__label">Event</span>
                          <span className="lv-alert-card__value">{alert.type || "—"}</span>
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

                        <div className="lv-alert-card__row">
                          <span className="lv-alert-card__label">Date</span>
                          <span className="lv-alert-card__value lv-alert-card__value--date">
                            {(alert.received_at || alert.time || "").split("T")[0]}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {thumbnailUrl && (
                    <div
                      className="lv-alert-card__thumbnail-container"
                      style={{ 
                        width: "110px", 
                        height: "110px", 
                        minWidth: "110px",
                        marginLeft: "12px", 
                        cursor: "pointer", 
                        borderRadius: "8px", 
                        overflow: "hidden",
                        border: "1px solid var(--border-light)",
                        alignSelf: "center"
                      }}
                      onClick={() => setZoomedImage({
                        url: thumbnailUrl,
                        cameraName: cameraName,
                        ip: displayId,
                        type: alert.type || "—",
                        time: timeOnly || alert.received_at
                      })}
                    >
                      <img
                        src={thumbnailUrl}
                        alt="Alert snapshot"
                        className="lv-alert-card__thumbnail"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        loading="lazy"
                        onError={(e) => {
                          const altUrl = alert.thumbnailAltUrl;
                          if (altUrl && altUrl !== e.currentTarget.src) {
                            e.currentTarget.src = altUrl;
                            return;
                          }
                          e.currentTarget.style.display = "none";
                          if (e.currentTarget.parentElement) {
                            e.currentTarget.parentElement.style.display = "none";
                          }
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {zoomedImage && (
        <div className="lv-image-modal" onClick={() => setZoomedImage(null)}>
          <div className="lv-image-modal__content" onClick={(e) => e.stopPropagation()}>
            <button className="lv-image-modal__close" onClick={() => setZoomedImage(null)}>✕</button>
            <img src={zoomedImage.url} alt="Alert Zoom" className="lv-image-modal__img" />
            <div className="lv-image-modal__caption">
              <strong>{zoomedImage.cameraName || zoomedImage.ip}</strong> — {zoomedImage.type} ({zoomedImage.time})
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CameraCell ────────────────────────────────────────────────────
// maxBitrate is in Kbps — passed into WebRTCPlayer as a real SDP b=TIAS constraint.
// Grid default: 2000 Kbps (2 Mbps). Fullscreen: 10000 Kbps (10 Mbps).
function CameraCell({ device, streamMode, onFullscreen, alertCount, onBadgeClick, isRecording, onLiveChange, maxBitrate, badgeMode }) {
  const showRec = localStorage.getItem("miradorai_show_rec_ind") !== "false";
  const [isLive, setIsLive] = useState(false);
  const [localStreamMode, setLocalStreamMode] = useState(streamMode);
  const [ptzOpen, setPtzOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  useEffect(() => {
    setLocalStreamMode(streamMode);
  }, [streamMode]);

  useEffect(() => {
    onLiveChange?.(device.ip, isLive);
  }, [device.ip, isLive, onLiveChange]);

  // WebRTC errors are handled inside the player (retries automatically).
  // We no longer auto-fall back to HLS — the user chooses the mode via the toolbar.
  const handleWebRTCError = () => {};

  // Calculate the target stream key based on stored codec metadata.
  // We prefer the sub_stream_key for grid cells to save bandwidth.
  // If the camera is known to be H.265, we default to the transcoder path (_h264)
  // to avoid the initial 400 Bad Request error. The player will handle fallback.
  const baseStreamKey = device.sub_stream_key || device.stream_key || device.stream_key || device.live_stream || (device.ip ? device.ip.replace(/\./g, "_") : "");
  const activeCodec = String(device.live_codec || device.codec || "").toUpperCase();
  const isH265 = ["H.265", "H265", "HEVC"].includes(activeCodec);
  const streamKeyToUse = isH265 ? `${baseStreamKey}_h264` : baseStreamKey;

  return (
    <div
      className={`lv-cam ${alertCount > 0 ? "lv-cam--alert" : ""}`}
      style={{ position: "relative" }}
    >
      <div className="lv-cam__bottom-right-controls">
        <div className="lv-cam__mute-btn" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" id={`mute-${device.id || device.ip}`} className="muteCheckboxInput" checked={isMuted} onChange={() => setIsMuted(!isMuted)} />
          <label htmlFor={`mute-${device.id || device.ip}`} className="toggleSwitch">
            <div className="speaker">
              <svg xmlns="http://www.w3.org/2000/svg" version="1.0" viewBox="0 0 75 75">
                <path d="M39.389,13.769 L22.235,28.606 L6,28.606 L6,47.699 L21.989,47.699 L39.389,62.75 L39.389,13.769z" style={{stroke:"#fff",strokeWidth:5,strokeLinejoin:"round",fill:"#fff"}}></path>
                <path d="M48,27.6a19.5,19.5 0 0 1 0,21.4M55.1,20.5a30,30 0 0 1 0,35.6M61.6,14a38.8,38.8 0 0 1 0,48.6" style={{fill:"none",stroke:"#fff",strokeWidth:5,strokeLinecap:"round"}}></path>
              </svg>
            </div>
            <div className="mute-speaker">
              <svg version="1.0" viewBox="0 0 75 75" stroke="#fff" strokeWidth="5">
                <path d="m39,14-17,15H6V48H22l17,15z" fill="#fff" strokeLinejoin="round"></path>
                <path d="m49,26 20,24m0-24-20,24" fill="#fff" strokeLinecap="round"></path>
              </svg>
            </div>
          </label>
        </div>

        {alertCount > 0 && (
          <div
            className="lv-cam__alert-badge"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onBadgeClick?.();
            }}
            title={`${alertCount > 50 ? 50 : alertCount} alert${alertCount !== 1 ? "s" : ""} — click to view`}
          >
            {alertCount > 50 ? 50 : alertCount}
          </div>
        )}
      </div>

      <div className="lv-cell__header">
        {isLive && <span className="lv-live-dot" />}
        <span className="lv-cell__name">{device.name}</span>
        {(device.source === "AI_WEBHOOK" || device.reader_id) && (
          <span className="lv-ai-webhook-badge" title="AI Webhook Integration Camera">
            AI WEBHOOK
          </span>
        )}
        {isLive && showRec && isRecording && (
          <span className="lv-rec-dot" />
        )}
        <div className="lv-cell__actions">
          <span className="lv-cell__ip">{device.ip}</span>

          {/* PTZ Toggle Button */}
          {(device.ptz === "Yes" || device.ptz === true) && (
            <button
              className={`lv-ptz-toggle-btn ${ptzOpen ? "active" : ""}`}
              onClick={(e) => { e.stopPropagation(); setPtzOpen((v) => !v); }}
              title={ptzOpen ? "Hide PTZ Controls" : "Show PTZ Controls"}
              type="button"
            >
              {/* PTZ crosshair icon */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
              </svg>
            </button>
          )}

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
        {device.ws_url || device.rtsp_url ? (
          <>
            {localStreamMode === "webrtc" ? (
              <WebRTCPlayer_MediaMTX
                key={streamKeyToUse}
                streamKey={streamKeyToUse}
                cameraId={device.id}
                onConnectChange={setIsLive}
                maxBitrate={maxBitrate}
                badgeMode={badgeMode}
                muted={isMuted}
              />
            ) : (
              <HlsPlayer
                key={`hls-${streamKeyToUse}`}
                streamKey={streamKeyToUse}
                onConnectChange={setIsLive}
                muted={isMuted}
              />
            )}
            <MaskOverlay ip={device.ip} />
            {/* Inline PTZ Panel */}
            {ptzOpen && (
              <PTZControls
                camera={device}
                onClose={() => setPtzOpen(false)}
              />
            )}
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

function getOrCreateStationDetails() {
  let sid = sessionStorage.getItem("miradorai_workstation_id");
  if (!sid) {
    sid = "ws-" + Math.random().toString(36).substring(2, 8);
    sessionStorage.setItem("miradorai_workstation_id", sid);
  }
  let sname = sessionStorage.getItem("miradorai_workstation_name");
  if (!sname) {
    sname = "Terminal " + sid.split("-")[1].toUpperCase();
    sessionStorage.setItem("miradorai_workstation_name", sname);
  }
  return { sid, sname };
}

// ── SequenceDropdown ────────────────────────────────────────────────
function SequenceDropdown({ value, onChange, sequences }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeSeq = sequences.find(s => s.id === value);
  const label = activeSeq ? activeSeq.name : "Default (All)";

  return (
    <div className="lv-grid-dropdown-container" ref={dropdownRef}>
      <button
        className={`lv-grid-dropdown-trigger ${isOpen ? "active" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
        style={{ padding: "4px 10px", fontSize: "15px", height: "28px" }}
      >
        <span>{label}</span>
        <svg className={`lv-chevron-icon ${isOpen ? "open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div className="lv-grid-dropdown-menu">
          <button
            className={`lv-grid-dropdown-item ${value === "all" ? "selected" : ""}`}
            onClick={() => {
              onChange("all");
              setIsOpen(false);
            }}
            type="button"
          >
            <span className="lv-grid-dropdown-item-label">Default (All)</span>
            {value === "all" && (
              <svg className="lv-check-icon" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="3" width="12" height="12">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
          {sequences.map((s) => (
            <button
              key={s.id}
              className={`lv-grid-dropdown-item ${value === s.id ? "selected" : ""}`}
              onClick={() => {
                onChange(s.id);
                setIsOpen(false);
              }}
              type="button"
            >
              <span className="lv-grid-dropdown-item-label">{s.name}</span>
              {value === s.id && (
                <svg className="lv-check-icon" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="3" width="12" height="12">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── LiveViewPage ──────────────────────────────────────────────────
export default function LiveViewPage() {
  const { user } = useAuth();
  const [devices,      setDevices]      = useState(loadDevices);
  const [layout,       setLayout]       = useState(() => {
    return sessionStorage.getItem("miradorai_liveview_layout") || "2x2";
  });
  const [currentPage,  setCurrentPage]  = useState(1);
  const [gridDropdownOpen, setGridDropdownOpen] = useState(false);
  const [gridFullscreen, setGridFullscreen] = useState(false);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);

  const [streamMode, setStreamMode] = useState(() => {
    return localStorage.getItem("liveview_stream_mode") || "webrtc";
  });

  useEffect(() => {
    localStorage.setItem("liveview_stream_mode", streamMode);
  }, [streamMode]);

 

  const [stationDetails] = useState(getOrCreateStationDetails);
  const [stationName, setStationName] = useState(stationDetails.sname);
  const [isEditingName, setIsEditingName] = useState(false);
  const [appliedTimestamp, setAppliedTimestamp] = useState(() => {
    return parseFloat(sessionStorage.getItem("miradorai_applied_layout_time") || "0");
  });

  const [isTourActive, setIsTourActive] = useState(false);
  const [dwellTime, setDwellTime] = useState(() => {
    return parseInt(localStorage.getItem("miradorai_dwell_time") || "10", 10);
  });
  const [sequences, setSequences] = useState(() => {
    try {
      const saved = localStorage.getItem("miradorai_camera_sequences");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [activeSequenceId, setActiveSequenceId] = useState("all");
  const [showSequenceModal, setShowSequenceModal] = useState(false);

  const [selectedCamId, setSelectedCamId] = useState(null);
  const [liveStatus,   setLiveStatus]   = useState({});
  const [fsDevice,     setFsDevice]     = useState(null);
  const [fsLive,       setFsLive]       = useState(false);
  const [fsStreamMode, setFsStreamMode] = useState(streamMode);
  const [fsPtzOpen,    setFsPtzOpen]    = useState(false);

  useEffect(() => {
    setFsStreamMode(streamMode);
  }, [streamMode, fsDevice]);

  // WebRTC errors are handled inside the player (retries automatically).
  // No auto-fallback to HLS from fullscreen either.
  const handleFsWebRTCError = () => {};

  const [fsMenuOpen,   setFsMenuOpen]   = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [alertCounts,  setAlertCounts]  = useState({});
  const [popupIp,      setPopupIp]      = useState(null);
  const [popupAlerts,  setPopupAlerts]  = useState([]);
  const [activeRecorders, setActiveRecorders] = useState([]);
  const [alertsPanelOpen, setAlertsPanelOpenState] = useState(() => {
    return localStorage.getItem("miradorai_live_alerts_open") === "true";
  });

  const setAlertsPanelOpen = useCallback((val) => {
    setAlertsPanelOpenState(prev => {
      const newVal = typeof val === 'function' ? val(prev) : val;
      localStorage.setItem("miradorai_live_alerts_open", String(newVal));
      return newVal;
    });
  }, []);
  const [totalAlertsCount, setTotalAlertsCount] = useState(0);
  const [sidePlaybackCam, setSidePlaybackCam] = useState(null);
  const [alertSource, setAlertSource] = useState("builtin"); // 'builtin' | 'external'

  useEffect(() => {
    sessionStorage.setItem("miradorai_liveview_layout", layout);
  }, [layout]);

  useEffect(() => {
    const checkBackendStartup = async () => {
      try {
        const res = await fetch(`${API}/api/health`);
        if (res.ok) {
          const data = await res.json();
          const currentStartupId = data.startup_id;
          if (currentStartupId) {
            const savedStartupId = sessionStorage.getItem("miradorai_backend_startup_id");
            if (savedStartupId && savedStartupId !== currentStartupId) {
              setLayout("2x2");
              sessionStorage.setItem("miradorai_liveview_layout", "2x2");
            }
            sessionStorage.setItem("miradorai_backend_startup_id", currentStartupId);
          }
        }
      } catch (e) {
        console.error("[LiveView] Health check startup ID sync failed:", e);
      }
    };
    checkBackendStartup();
  }, []);

  // ── Sync sub_stream_key from backend on mount ─────────────────────────────
  // The backend is the authority for sub_stream_key/stream_key. localStorage
  // entries saved before sub-stream support was added will be missing these
  // fields. This one-time fetch merges them in without disrupting anything else.
  useEffect(() => {
    const syncStreamKeys = async () => {
      try {
        const res = await fetch(`${API}/api/cameras`, { headers: getAuthHeaders() });
        if (!res.ok) return;
        const backendCams = await res.json();
        if (!Array.isArray(backendCams) || backendCams.length === 0) return;

        // Build a lookup by IP for fast access
        const byIp = {};
        for (const cam of backendCams) {
          if (cam.ip) byIp[cam.ip] = cam;
        }

        setDevices(prev => {
          let changed = false;
          const existingIps = new Set(prev.map(d => d.ip).filter(Boolean));
          const next = prev.map(d => {
            const backend = byIp[d.ip];
            if (!backend) return d;
            const needsUpdate =
              (backend.reader_id && d.reader_id !== backend.reader_id) ||
              (backend.sub_stream_key && d.sub_stream_key !== backend.sub_stream_key) ||
              (backend.sub_stream_rtsp && d.sub_stream_rtsp !== backend.sub_stream_rtsp) ||
              (backend.stream_key && d.stream_key !== backend.stream_key) ||
              (backend.source && d.source !== backend.source);
            if (!needsUpdate) return d;
            changed = true;
            return {
              ...d,
              source:          backend.source          || d.source,
              reader_id:       backend.reader_id       || d.reader_id,
              stream_key:      backend.stream_key      || d.stream_key,
              sub_stream_key:  backend.sub_stream_key  || d.sub_stream_key  || null,
              sub_stream_rtsp: backend.sub_stream_rtsp || d.sub_stream_rtsp || null,
            };
          });

          // Also auto-append any new cameras posted directly to backend DB (like AI_WEBHOOK cameras)
          for (const cam of backendCams) {
            const camIp = cam.ip || cam.ip_address;
            if (camIp && !existingIps.has(camIp)) {
              changed = true;
              next.push({
                id: cam.id || cam._id || cam.reader_id || camIp,
                name: cam.name || cam.camera_name || `AI Cam (${camIp})`,
                ip: camIp,
                rtsp_url: cam.rtsp_url || "",
                source: cam.source || "AI_WEBHOOK",
                reader_id: cam.reader_id,
                enabled: cam.enabled !== false,
                status: cam.status || "Active",
                stream_key: cam.stream_key || camIp.replace(/\./g, "_")
              });
            }
          }

          if (changed) {
            try { localStorage.setItem("miradorai_devices", JSON.stringify(next)); } catch {}
          }
          return changed ? next : prev;
        });
      } catch (e) {
        console.error("[LiveView] Stream key sync failed:", e);
      }
    };
    syncStreamKeys();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const fsRef = useRef(null);
  const fsMenuRef = useRef(null);
  const dropdownRef = useRef(null);
  const gridAreaRef = useRef(null);
  const showRec = localStorage.getItem("miradorai_show_rec_ind") !== "false";

  const handleLiveChange = useCallback((ip, isLive) => {
    setLiveStatus(prev => {
      if (prev[ip] === isLive) return prev;
      return { ...prev, [ip]: isLive };
    });
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setGridDropdownOpen(false);
      }
      if (fsMenuRef.current && !fsMenuRef.current.contains(e.target)) {
        setFsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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
    const interval = setInterval(fetchRecordingStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const update = () => setDevices(loadDevices());
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);

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
          .filter((a) => {
             const t = (a.type || "").toLowerCase();
             return t !== "unknown" && t !== "" && !t.includes("tns1:");
          })
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
      setFsMenuOpen(false);
      setIsFullscreen(false);
    }
  }, []);

 
  const openAlertPopup = useCallback(async (ip) => {
    try {
      const res  = await fetch(`${API}/api/alerts?limit=100`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      const normIp = (ip || "").replace(/_/g, ".");
      const filtered = (data.alerts || [])
        .filter((a) => a.status === "Active")
        .filter((a) => {
           const t = (a.type || "").toLowerCase();
           return t !== "unknown" && t !== "" && !t.includes("tns1:");
        })
        .filter(isAlertAllowed)
        .filter((a) => (a.ip || "").replace(/_/g, ".") === normIp);
      
      filtered.sort((a, b) => {
        const tA = new Date(a.time || a.received_at).getTime() || 0;
        const tB = new Date(b.time || b.received_at).getTime() || 0;
        return tB - tA;
      });

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

  const activeCams = useMemo(() => {
    const enabledCams = devices.filter((d) => d.enabled !== false);
    if (user?.role === "admin" || !user?.allowedCameras || user?.allowedCameras.length === 0) {
      return enabledCams;
    }
    return enabledCams.filter(c => user.allowedCameras.includes(String(c.id)));
  }, [devices, user]);
  const onlineCams    = activeCams.filter((d) => d.ws_url || d.rtsp_url || d.source === "AI_WEBHOOK");
  const disabledCount = devices.length - activeCams.length;

  const activeSequence = useMemo(() => {
    return sequences.find(s => s.id === activeSequenceId);
  }, [activeSequenceId, sequences]);

  const filteredActiveCams = useMemo(() => {
    if (!activeSequence) return activeCams;
    return activeCams.filter(c => activeSequence.cameraIds.includes(String(c.id)));
  }, [activeCams, activeSequence]);

  useEffect(() => {
    if (activeSequenceId === "all") {
      const val = parseInt(localStorage.getItem("miradorai_dwell_time") || "10", 10);
      setDwellTime(val);
    } else if (activeSequence) {
      setDwellTime(activeSequence.dwellTime);
    }
  }, [activeSequenceId, activeSequence]);

  const sortedActiveCams = useMemo(() => {
    return [...filteredActiveCams].sort((a, b) => {
      const aCount = alertCounts[a.ip] || 0;
      const bCount = alertCounts[b.ip] || 0;

      if (aCount !== bCount) {
        return bCount - aCount;
      }

      const aIdx = devices.findIndex(d => d.id === a.id);
      const bIdx = devices.findIndex(d => d.id === b.id);
      return aIdx - bIdx;
    });
  }, [filteredActiveCams, alertCounts, devices]);

  const currentGridOption = GRID_OPTIONS.find(o => o.id === layout) || GRID_OPTIONS[3];
  const rows = currentGridOption.rows;
  const cols = currentGridOption.cols;
  // const gridSize = rows * cols;
  const isSpotlight = currentGridOption.isSpotlight;
  const gridSize = isSpotlight ? currentGridOption.pageSize : rows * cols;

  const totalPages = Math.max(1, Math.ceil(sortedActiveCams.length / gridSize));
  
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const pageCams = sortedActiveCams.slice((currentPage - 1) * gridSize, currentPage * gridSize);

  useEffect(() => {
    if (pageCams && pageCams.length > 0) {
      pageCams.forEach((cam) => {
        const isCamFullscreen = fsDevice && fsDevice.id === cam.id;
        const mode = isCamFullscreen ? "fullscreen" : "grid";
        
        fetch(`${API}/api/system/cameras/${cam.ip}/view-mode`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders()
          },
          body: JSON.stringify({ mode })
        }).catch((err) => console.error("[VMS-VIEWMODE] Error updating view mode:", err));
      });
    }
  }, [fsDevice, currentPage, layout, sortedActiveCams]);

  useEffect(() => {
    const sendHeartbeat = async () => {
      try {
        const res = await fetch(`${API}/api/viewing-stations/heartbeat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders()
          },
          body: JSON.stringify({
            station_id: stationDetails.sid,
            name: stationName,
            grid: layout,
            device_order: devices.map(d => d.id),
            applied_timestamp: appliedTimestamp,
            active_feeds_count: pageCams.length
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.pushed_layout) {
            const pushed = data.pushed_layout;

            setDevices(prevDevices => {
              const newOrder = pushed.device_order;
              const matched = [];
              const remaining = [...prevDevices];

              for (const id of newOrder) {
                if (!id) continue;
                const idx = remaining.findIndex(d => String(d.id) === String(id));
                if (idx !== -1) {
                  matched.push(remaining[idx]);
                  remaining.splice(idx, 1);
                }
              }

              const merged = [...matched, ...remaining];
              localStorage.setItem("miradorai_devices", JSON.stringify(merged));
              return merged;
            });

            setLayout(pushed.grid);
            setAppliedTimestamp(pushed.timestamp);
            sessionStorage.setItem("miradorai_applied_layout_time", String(pushed.timestamp));

            window.dispatchEvent(new Event("storage"));
          }
        }
      } catch (e) {
        console.error("[LiveView] Heartbeat layout sync failed:", e);
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 30000);
    return () => clearInterval(interval);
  }, [stationDetails.sid, stationName, layout, devices, appliedTimestamp, pageCams.length]);

  useEffect(() => {
    if (!isTourActive || totalPages <= 1) return;

    const timer = setInterval(() => {
      setCurrentPage((prev) => {
        return prev >= totalPages ? 1 : prev + 1;
      });
    }, dwellTime * 1000);

    return () => clearInterval(timer);
  }, [isTourActive, dwellTime, totalPages]);

  const dragCamId = useRef(null);

  const handleDragStart = useCallback((e, camId) => {
    dragCamId.current = camId;
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e, targetCamId, targetIndex) => {
    e.preventDefault();
    const sourceCamId = dragCamId.current;
    if (!sourceCamId) return;

    setDevices((prevDevices) => {
      const newDevices = [...prevDevices];
      const sourceIdx = newDevices.findIndex((d) => d.id === sourceCamId);
      let targetIdx = -1;

      if (targetCamId) {
        targetIdx = newDevices.findIndex((d) => d.id === targetCamId);
      } else {
        const targetCamInPage = pageCams[targetIndex];
        if (targetCamInPage) {
          targetIdx = newDevices.findIndex((d) => d.id === targetCamInPage.id);
        }
      }

      if (sourceIdx !== -1 && targetIdx !== -1 && sourceIdx !== targetIdx) {
        const temp = newDevices[sourceIdx];
        newDevices[sourceIdx] = newDevices[targetIdx];
        newDevices[targetIdx] = temp;

        localStorage.setItem("miradorai_devices", JSON.stringify(newDevices));
        window.dispatchEvent(new Event("storage"));
      }
      return newDevices;
    });

    dragCamId.current = null;
  }, [pageCams]);

  const handleLayoutChange = (layoutId) => {
    setLayout(layoutId);
    setCurrentPage(1);
  };

  return (
    <div className="lv-page">

      <div className="lv-top-bar-container">
        <div className="lv-top-header">
          <div className="lv-top-header__left">
            <h1 className="lv-page-title">Live view</h1>
            <div className="lv-online-status">
              <span className="lv-live-dot" />
              <span>{onlineCams.length} online</span>
            </div>
            
            <div className="lv-filter-group" style={{ marginLeft: "16px" }}>
              <div className="lv-filter-item">
                {isEditingName ? (
                  <input
                    type="text"
                    className="lv-station-name-input"
                    value={stationName}
                    onChange={(e) => {
                      setStationName(e.target.value);
                      sessionStorage.setItem("miradorai_workstation_name", e.target.value);
                    }}
                    onBlur={() => setIsEditingName(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setIsEditingName(false);
                    }}
                    autoFocus
                  />
                ) : (
                  <span onClick={() => setIsEditingName(true)} style={{ cursor: "pointer", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: "6px" }}>
                    {stationName}
                    <svg className="lv-chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10" style={{ marginLeft: "4px" }}>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                )}
              </div>

              <div className="lv-filter-divider" />

              <div className="lv-filter-item lv-dropdown-container">
                <span className="lv-blue-dot" style={{ background: "#3fb950", marginRight: "6px" }} />
                <span style={{ color: "#3fb950", cursor: "pointer", flex: 1, whiteSpace: "nowrap", display: "flex", alignItems: "center" }} onClick={() => setModeDropdownOpen(!modeDropdownOpen)}>
                  {streamMode === "hls" ? "Buffered" : "Real-time"}
                  <svg className={`lv-chevron-icon ${modeDropdownOpen ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10" style={{ marginLeft: '8px' }} onClick={(e) => { e.stopPropagation(); setModeDropdownOpen(!modeDropdownOpen); }}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
                {modeDropdownOpen && (
                  <div className="lv-filter-dropdown">
                    <button
                      className={`lv-filter-dropdown-item ${streamMode === "webrtc" ? "selected" : ""}`}
                      onClick={() => { setStreamMode("webrtc"); setModeDropdownOpen(false); }}
                    >
                      Real-time
                    </button>
                    <button
                      className={`lv-filter-dropdown-item ${streamMode === "hls" ? "selected" : ""}`}
                      onClick={() => { setStreamMode("hls"); setModeDropdownOpen(false); }}
                    >
                      Buffered
                    </button>
                  </div>
                )}
              </div>

              <div className="lv-filter-divider" />

              <div className="lv-filter-item lv-dropdown-container" ref={dropdownRef}>
                <span style={{ cursor: "pointer", flex: 1, whiteSpace: "nowrap", display: "flex", alignItems: "center" }} onClick={() => setGridDropdownOpen(!gridDropdownOpen)}>
                  {currentGridOption.label.replace(' Grid', '')}
                  <svg className={`lv-chevron-icon ${gridDropdownOpen ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10" style={{ marginLeft: '8px', opacity: 0.8 }} onClick={(e) => { e.stopPropagation(); setGridDropdownOpen(!gridDropdownOpen); }}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
                {gridDropdownOpen && (
                  <div className="lv-filter-dropdown">
                    {GRID_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        className={`lv-filter-dropdown-item ${layout === opt.id ? "selected" : ""}`}
                        onClick={() => { handleLayoutChange(opt.id); setGridDropdownOpen(false); }}
                      >
                        {opt.label.replace(' Grid', '')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="lv-top-header__right">
            <div className="lv-filter-group" style={{ marginRight: "12px" }}>
              <div className="lv-filter-item lv-dropdown-container" onClick={(e) => { e.stopPropagation(); setShowSequenceModal(true); }}>
                <span style={{ whiteSpace: "nowrap", cursor: "pointer" }}>
                  + Sequence
                </span>
              </div>

              <div className="lv-filter-divider" />

              <div className="lv-filter-item">
                <button
                  onClick={() => setIsTourActive(!isTourActive)}
                  title={isTourActive ? "Pause Tour" : "Start Auto Sequence Tour"}
                  type="button"
                  className={`lv-tour-btn ${isTourActive ? "active" : ""}`}
                  style={{ background: 'none', border: 'none', padding: 0, marginRight: '6px', cursor: 'pointer', color: isTourActive ? '#3fb950' : 'inherit', opacity: 0.8, display: 'flex' }}
                >
                  {isTourActive ? (
                    <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M6 4l15 8-15 8z"/></svg>
                  )}
                </button>
                <span style={{ opacity: 0.9, marginRight: '4px' }}>Dwell</span>
                <input
                  type="number"
                  className="lv-dwell-input"
                  value={dwellTime}
                  min="3"
                  max="300"
                  onChange={(e) => {
                    const val = Math.max(3, parseInt(e.target.value) || 3);
                    setDwellTime(val);
                    localStorage.setItem("miradorai_dwell_time", String(val));
                  }}
                  disabled={isTourActive || activeSequenceId !== "all"}
                />
                <span style={{ fontWeight: "500", color: "var(--text-secondary)", marginLeft: '2px' }}>s</span>
              </div>
            </div>
            <button
              className="lv-icon-btn"
              onClick={toggleGridFullscreen}
              title={gridFullscreen ? "Exit Fullscreen" : "Fullscreen Grid"}
              type="button"
            >
              {gridFullscreen ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
                </svg>
              )}
            </button>
            <button
              className={`lv-icon-btn ${alertsPanelOpen ? "active" : ""}`}
              onClick={() => setAlertsPanelOpen(!alertsPanelOpen)}
              title={alertsPanelOpen ? "Hide Alerts Panel" : "Show Alerts Panel"}
              type="button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {totalAlertsCount > 0 && <span className="lv-alert-badge-dot" />}
            </button>
          </div>
        </div>
      </div>

      <div className="lv-main-area">

        {fsDevice && (
          <div ref={fsRef} className="lv-fullscreen-overlay" tabIndex={-1}>
            <div className="lv-fullscreen-overlay__bar">
              <div className="lv-fullscreen-overlay__info">
                {fsLive && <span className="lv-live-dot" />}
                <span className="lv-fullscreen-overlay__name">{fsDevice.name}</span>
                {fsLive && showRec && (activeRecorders.includes(fsDevice?.stream_key) || activeRecorders.includes(fsDevice?.stream_key)) && (
                  <span className="lv-rec-dot" />
                )}
                <span className="lv-fullscreen-overlay__ip">{fsDevice.ip}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {/* PTZ toggle in fullscreen */}
                <button
                  className={`lv-ptz-toggle-btn ${fsPtzOpen ? "active" : ""}`}
                  onClick={() => setFsPtzOpen((v) => !v)}
                  title={fsPtzOpen ? "Hide PTZ Controls" : "PTZ Controls"}
                  type="button"
                  style={{ width: 32, height: 32 }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
                  </svg>
                </button>
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
            </div>
            <div className="lv-fullscreen-overlay__player" style={{ position: "relative" }}>
              {fsStreamMode === "webrtc" ? (() => {
                const baseFsKey = fsDevice.stream_key || fsDevice.stream_key || fsDevice.live_stream || "";
                const activeCodec = String(fsDevice.live_codec || fsDevice.codec || "").toUpperCase();
                const isH265 = ["H.265", "H265", "HEVC"].includes(activeCodec);
                const fsStreamKeyToUse = isH265 ? `${baseFsKey}_h264` : baseFsKey;
                
                return (
                  <WebRTCPlayer_MediaMTX
                    key={`fs-${fsStreamKeyToUse}`}
                    streamKey={fsStreamKeyToUse}
                    cameraId={fsDevice.id}
                    onConnectChange={setFsLive}
                    maxBitrate={10000}
                  />
                );
              })() : (
                <HlsPlayer
                  key={`fs-hls-${fsDevice.stream_key || fsDevice.stream_key || fsDevice.live_stream}`}
                  streamKey={fsDevice.stream_key || fsDevice.stream_key || fsDevice.live_stream}
                  onConnectChange={setFsLive}
                />
              )}
              <MaskOverlay ip={fsDevice.ip} />
              {/* PTZ panel in fullscreen */}
              {fsPtzOpen && (
                <PTZControls
                  camera={fsDevice}
                  onClose={() => setFsPtzOpen(false)}
                />
              )}
            </div>
          </div>
        )}

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
                  gap: "14px",
                  padding: "16px 16px 0 16px",
                  background: "transparent"
                }}
              >
                {Array.from({ length: gridSize }).map((_, i) => {
                  const cam = pageCams[i];
                  const hasAlert = cam ? (alertCounts[cam.ip] > 0) : false;
                  const isSelected = cam ? (selectedCamId === cam.id) : (selectedCamId === `empty-${i}`);
                  const spotlightStyle = (isSpotlight && i === 0) ? { gridColumn: "span 3", gridRow: "span 3" } : {};
                  return (
                    <div
                      key={cam ? cam.id : `empty-${i}`}
                      className={`lv-cell ${isSelected ? "lv-cell--selected" : ""} ${hasAlert ? "lv-cell--alert" : ""}`}
                      style={spotlightStyle}
                      onClick={() => {
                        const target = cam ? cam.id : `empty-${i}`;
                        setSelectedCamId(selectedCamId === target ? null : target);
                      }}
                      onDoubleClick={(e) => {
                        if (cam) {
                          openFullscreen(cam, e);
                        }
                      }}
                      draggable={!!cam}
                      onDragStart={(e) => cam && handleDragStart(e, cam.id)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, cam ? cam.id : null, i)}
                    >
                      {cam
                        ? <CameraCell
                            device={cam}
                            streamMode={streamMode}
                            onFullscreen={(e) => openFullscreen(cam, e)}
                            alertCount={alertCounts[cam?.ip] || 0}
                            onBadgeClick={() => {
                              setSidePlaybackCam(cam);
                              window.dispatchEvent(new Event("collapse-sidebar"));
                            }}
                            isRecording={
                              cam && (
                                activeRecorders.includes(cam.stream_key) ||
                                activeRecorders.includes(cam.stream_key) ||
                                activeRecorders.includes(cam.ip) ||
                                (cam.ip && activeRecorders.includes(cam.ip.replace(/\./g, "_"))) ||
                                activeRecorders.includes(cam.reader_id) ||
                                activeRecorders.includes(cam.id)
                              )
                            }
                            onLiveChange={handleLiveChange}
                            maxBitrate={2000}
                            badgeMode={layout === "8x8" ? "micro" : !["1x1", "2x2"].includes(layout) ? "compact" : "normal"}
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

        {/* ── Side Playback Panel ── */}
        {sidePlaybackCam && (
          <SidePlaybackPanel
            camera={sidePlaybackCam}
            onClose={() => setSidePlaybackCam(null)}
            alertSource={alertSource}
          />
        )}

        {/* ── Alerts panel ── */}
        <AlertsPanel
          onAlertCountUpdate={setAlertCounts}
          onTotalAlertCountChange={setTotalAlertsCount}
          isOpen={alertsPanelOpen}
          liveStatus={liveStatus}
          alertSource={alertSource}
          setAlertSource={setAlertSource}
          devices={devices}
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

      {/* ── Sequence Manager Modal ── */}
      {showSequenceModal && (
        <SequenceManagerModal
          sequences={sequences}
          setSequences={(next) => {
            setSequences(next);
            localStorage.setItem("miradorai_camera_sequences", JSON.stringify(next));
          }}
          activeCams={activeCams}
          onClose={() => setShowSequenceModal(false)}
        />
      )}

    </div>
  );
}

// ── SequenceManagerModal ──
import { useState as useModalState } from "react";

function SequenceManagerModal({ sequences, setSequences, activeCams, onClose }) {
  const [editingSeq, setEditingSeq] = useModalState(null); // Sequence object or "new"
  const [form, setForm] = useModalState({ name: "", dwellTime: 10, cameraIds: [] });

  const handleStartCreate = () => {
    setForm({ name: "", dwellTime: 10, cameraIds: [] });
    setEditingSeq("new");
  };

  const handleStartEdit = (seq) => {
    setForm({ name: seq.name, dwellTime: seq.dwellTime, cameraIds: [...seq.cameraIds] });
    setEditingSeq(seq);
  };

  const handleCheckboxChange = (camId, checked) => {
    setForm(prev => {
      const cameraIds = checked
        ? [...prev.cameraIds, String(camId)]
        : prev.cameraIds.filter(id => id !== String(camId));
      return { ...prev, cameraIds };
    });
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (!form.name || form.name.trim() === "") return;
    if (form.cameraIds.length === 0) {
      alert("Please select at least one camera for the sequence.");
      return;
    }

    if (editingSeq === "new") {
      const newSeq = {
        id: "seq-" + Math.random().toString(36).substring(2, 9),
        name: form.name.trim(),
        dwellTime: form.dwellTime,
        cameraIds: form.cameraIds
      };
      setSequences([...sequences, newSeq]);
    } else {
      const updated = sequences.map(s => s.id === editingSeq.id ? {
        ...s,
        name: form.name.trim(),
        dwellTime: form.dwellTime,
        cameraIds: form.cameraIds
      } : s);
      setSequences(updated);
    }
    setEditingSeq(null);
  };

  const handleDelete = (seqId) => {
    if (!window.confirm("Are you sure you want to delete this sequence?")) return;
    setSequences(sequences.filter(s => s.id !== seqId));
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 10000 }}>
      <div className="modal-box um-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "520px" }}>
        <div className="modal-header">
          <h2 className="modal-title">
            {editingSeq ? (editingSeq === "new" ? "Create Camera Sequence" : "Edit Camera Sequence") : "Manage Camera Sequences"}
          </h2>
          <button className="modal-close" onClick={editingSeq ? () => setEditingSeq(null) : onClose}>✕</button>
        </div>

        {editingSeq ? (
          <form onSubmit={handleSave}>
            <div className="modal-body" style={{ maxHeight: "60vh", overflowY: "auto" }}>
              <div className="form-group">
                <label className="form-label">Sequence Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Lobby & Entrances"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Camera Dwell Time (seconds)</label>
                <input
                  type="number"
                  className="form-input"
                  value={form.dwellTime}
                  min="3"
                  max="300"
                  onChange={(e) => setForm({ ...form, dwellTime: Math.max(3, parseInt(e.target.value) || 3) })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Select Cameras in Sequence</label>
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  background: "rgba(9, 13, 22, 0.4)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "6px",
                  padding: "12px",
                  maxHeight: "180px",
                  overflowY: "auto"
                }}>
                  {activeCams.map(cam => {
                    const isChecked = form.cameraIds.includes(String(cam.id));
                    return (
                      <label key={cam.id} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "13px", color: "var(--text-primary)" }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => handleCheckboxChange(cam.id, e.target.checked)}
                          style={{ accentColor: "var(--teal)" }}
                        />
                        <span>{cam.name} ({cam.ip})</span>
                      </label>
                    );
                  })}
                  {activeCams.length === 0 && (
                    <span style={{ fontSize: "13px", color: "var(--text-muted)", textAlign: "center" }}>No active cameras found.</span>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setEditingSeq(null)}>Back</button>
              <button type="submit" className="btn-primary">Save Sequence</button>
            </div>
          </form>
        ) : (
          <div className="modal-body">
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={handleStartCreate}
              >
                + Create Sequence
              </button>
            </div>

            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              maxHeight: "280px",
              overflowY: "auto"
            }}>
              {sequences.map(seq => (
                <div key={seq.id} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 14px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px"
                }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: "600" }}>{seq.name}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: "11.5px" }}>
                      {seq.dwellTime}s dwell | {seq.cameraIds.length} camera{seq.cameraIds.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      type="button"
                      className="seq-btn-edit"
                      onClick={() => handleStartEdit(seq)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="seq-btn-delete"
                      onClick={() => handleDelete(seq.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {sequences.length === 0 && (
                <div style={{ textAlign: "center", padding: "30px 10px", color: "var(--text-muted)", fontSize: "13.5px" }}>
                  No custom sequences created. Click Create Sequence above.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}