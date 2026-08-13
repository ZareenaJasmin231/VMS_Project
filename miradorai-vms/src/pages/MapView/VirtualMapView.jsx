import React, { useEffect, useRef, useState, useCallback } from "react";
import "./VirtualMapView.css";
import WebRTCPlayer_MediaMTX from "../../components/shared/WebRTCPlayer_MediaMTX";

const API = import.meta.env.VITE_API_URL || "";

function getAuthHeaders() {
  const token = localStorage.getItem("miradorai_token") || localStorage.getItem("token") || "";
  return token ? { "Authorization": "Bearer " + token } : {};
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

/**
 * VirtualMapView
 * ─────────────────────────────────────────────────────────────────
 * The "Digital Twin" layer.
 * Renders LIVE FEED THUMBNAILS as HTML elements pinned to each
 * camera's map position — positioned with absolute CSS over the canvas.
 *
 * Logic:
 *   Each marker has (x, y) in IMAGE coordinates.
 *   We convert to screen coordinates using:
 *     screenX = x * scale + offsetX
 *     screenY = y * scale + offsetY
 *   Then position a thumbnail div absolutely at that point.
 *
 * Props:
 *   markers       []     – current floor markers
 *   cameras       []     – normalized camera list
 *   scaleRef      ref    – current canvas scale
 *   offsetRef     ref    – current canvas offset {x,y}
 *   wrapRef       ref    – canvas wrapper div (for bounds)
 *   expandedCamId string – which cam is currently expanded (null = none)
 *   onExpand      fn(id) – called when a thumbnail is clicked
 *   onClose       fn()   – called to close expanded view
 *   visible       bool   – show/hide whole layer
 */
export default function VirtualMapView({
  markers,
  cameras,
  scaleRef,
  offsetRef,
  wrapRef,
  expandedCamId,
  onExpand,
  onClose,
  visible,
  alertCounts = {},
}) {
  const [, forceUpdate] = useState(0);
  const rafRef = useRef(null);
  const [activeRecorders, setActiveRecorders] = useState([]);

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
        console.error("[VirtualMapView] Recording status fetch failed:", e);
      }
    };
    fetchRecordingStatus();
    const interval = setInterval(fetchRecordingStatus, 8000);
    return () => clearInterval(interval);
  }, []);

  // Re-position thumbnails whenever map pans/zooms
  // Parent calls this via the ref returned below
  const reposition = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => forceUpdate(n => n + 1));
  }, []);

  // Expose reposition so MapViewPage can call it on pan/zoom
  useEffect(() => {
    if (wrapRef?.current) {
      wrapRef.current.__vtReposition = reposition;
    }
  }, [wrapRef, reposition]);

  if (!visible || !markers.length) return null;

  const wrap = wrapRef?.current;
  if (!wrap) return null;

  const scale  = scaleRef.current;
  const offset = offsetRef.current;

  return (
    <>
      {markers.map((m, i) => {
        const cam = cameras.find(c => c.id === m.camId);
        if (!cam) return null;

        // Convert image coords → screen coords inside the wrap div
        const sx = m.x * scale + offset.x;
        const sy = m.y * scale + offset.y;

        // Clamp so thumbnails don't disappear off the edges
        const wW = wrap.clientWidth;
        const wH = wrap.clientHeight;
        if (sx < -20 || sx > wW + 20 || sy < -20 || sy > wH + 20) return null;

        const isExpanded = expandedCamId === cam.id;
        const isOnline   = cam.status === "online";

        const isRecording = activeRecorders.includes(cam.stream_key) || activeRecorders.includes(cam.stream_key) || activeRecorders.includes(cam.id);
        return (
          <CamThumbnail
            key={cam.id}
            cam={cam}
            marker={m}
            index={i}
            sx={sx}
            sy={sy}
            isExpanded={isExpanded}
            isOnline={isOnline}
            isRecording={isRecording}
            alertCount={isOnline ? (alertCounts[cam.ip] || 0) : 0}
            onExpand={() => onExpand(cam.id)}
            onClose={onClose}
            wrap={wrap}
          />
        );
      })}

      {/* Expanded full-feed overlay */}
      {expandedCamId && (() => {
        const m   = markers.find(mk => mk.camId === expandedCamId);
        const cam = cameras.find(c  => c.id   === expandedCamId);
        if (!m || !cam) return null;
        return (
          <ExpandedFeed
            cam={cam}
            marker={m}
            onClose={onClose}
          />
        );
      })()}
    </>
  );
}

// ── Single camera thumbnail pinned to map position ────────────────
function CamThumbnail({ cam, marker, index, sx, sy, isExpanded, isOnline, isRecording, alertCount, onExpand, onClose, wrap }) {
  const THUMB_W = 160;
  const THUMB_H = 90;
  const [thumbLive, setThumbLive] = useState(false);

  // Position thumbnail so its bottom-centre aligns with the camera dot
  // Clamp to ensure it doesn't get cut off or go off the top/sides of the canvas wrap
  const wrapW = wrap ? wrap.clientWidth : 1000;
  const wrapH = wrap ? wrap.clientHeight : 1000;

  const left = Math.max(8, Math.min(wrapW - THUMB_W - 8, sx - THUMB_W / 2));
  const top  = Math.max(8, Math.min(wrapH - THUMB_H - 8, sy - THUMB_H - 28)); // 28px above the dot

  return (
    <div
      className={`vt-thumb ${isOnline ? "vt-thumb--online" : "vt-thumb--offline"} ${isExpanded ? "vt-thumb--expanded" : ""} ${alertCount > 0 ? "vt-thumb--alert" : ""}`}
      style={{ left, top, width: THUMB_W, height: THUMB_H }}
      onClick={e => { e.stopPropagation(); isExpanded ? onClose() : onExpand(); }}
      title={`${cam.name} — click to expand`}
    >
      {/* Connector line from thumbnail down to camera dot */}
      <div className="vt-thumb__connector" />

      {/* Alert Badge */}
      {alertCount > 0 && (
        <div className="vt-thumb__alert-badge" title={`${alertCount} alert${alertCount !== 1 ? "s" : ""} — click to view`}>
          {alertCount > 99 ? "99+" : alertCount}
        </div>
      )}

      {/* Live feed or offline placeholder */}
      {isOnline ? (
        <div className="vt-thumb__feed">
          <WebRTCPlayer_MediaMTX
            key={cam.stream_key || cam.id}
            streamKey={cam.stream_key || cam.id}
            cameraId={cam.id}
            onConnectChange={setThumbLive}
            hideBandwidth={true}
          />
        </div>
      ) : (
        <div className="vt-thumb__offline">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="22" height="22">
            <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            <line x1="1" y1="1" x2="23" y2="23" stroke="#ff4444" strokeWidth="2"/>
          </svg>
          <span>Offline</span>
        </div>
      )}

      {/* Header bar */}
      <div className="vt-thumb__bar">
        <span className={`vt-thumb__dot ${thumbLive ? "vt-thumb__dot--online" : "vt-thumb__dot--offline"}`} />
        <span className="vt-thumb__name">{cam.name}</span>
        {thumbLive && localStorage.getItem("miradorai_show_rec_ind") !== "false" && isRecording && (
          <span className="vt-rec-dot" />
        )}
        <span className="vt-thumb__num">#{index + 1}</span>
        <button
          className="vt-thumb__expand"
          onClick={e => { e.stopPropagation(); isExpanded ? onClose() : onExpand(); }}
          title="Expand"
        >
          {isExpanded ? "✕" : "⛶"}
        </button>
      </div>
    </div>
  );
}

// ── Full expanded feed overlay ────────────────────────────────────
function ExpandedFeed({ cam, marker, onClose }) {
  const [tab, setTab]       = useState("stream");
  const [alerts, setAlerts] = useState([]);
  const [loadingA, setLA]   = useState(false);

  useEffect(() => {
    if (tab !== "alerts") return;
    setLA(true);
    const token = localStorage.getItem("miradorai_token") || localStorage.getItem("token") || "";
    fetch(`${API}/api/alerts?camera_ip=${cam.ip}&limit=100`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const all = d?.alerts || [];
        const filtered = all
          .filter(a => a.status === "Active")
          .filter(isAlertAllowed);
        setAlerts(filtered);
      })
      .catch(() => {})
      .finally(() => setLA(false));
  }, [tab, cam.ip]);

  return (
    <div className="vt-expanded-overlay" onClick={onClose}>
      <div className="vt-expanded-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="vt-expanded-header">
          <div className="vt-expanded-meta">
            <span className={`vt-thumb__dot ${cam.status === "online" ? "vt-thumb__dot--online" : "vt-thumb__dot--offline"}`} style={{ width: 10, height: 10 }} />
            <span className="vt-expanded-name">{cam.name}</span>
            <span className="vt-expanded-ip">{cam.ip}</span>
            <span className="vt-expanded-fov">FOV {marker.fovAngle || 60}° · {Math.round(marker.direction || 0)}°</span>
          </div>
          <button className="vt-expanded-close" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="vt-expanded-tabs">
          <button className={`vt-expanded-tab ${tab === "stream" ? "active" : ""}`} onClick={() => setTab("stream")}>
            📹 Live Feed
          </button>
          <button className={`vt-expanded-tab ${tab === "alerts" ? "active" : ""}`} onClick={() => setTab("alerts")}>
            🔔 Alerts
          </button>
          <button className={`vt-expanded-tab ${tab === "info" ? "active" : ""}`} onClick={() => setTab("info")}>
            ℹ Info
          </button>
        </div>

        {/* Content */}
        <div className="vt-expanded-body">
          {tab === "stream" && (
            <>
              {cam.status === "online" ? (
                <WebRTCPlayer_MediaMTX
                  key={(cam.stream_key || cam.id) + "_expanded"}
                  streamKey={cam.stream_key || cam.id}
                  cameraId={cam.id}
                  hideBandwidth={true}
                />
              ) : (
                <div className="vt-expanded-offline">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
                    <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                    <line x1="1" y1="1" x2="23" y2="23" stroke="#ff4444" strokeWidth="2"/>
                  </svg>
                  <p>Camera is offline</p>
                  <span>{cam.ip}</span>
                </div>
              )}
            </>
          )}

          {tab === "alerts" && (
            <div className="vt-alerts">
              {loadingA ? (
                <div className="vt-alerts-loading">Loading alerts…</div>
              ) : alerts.length === 0 ? (
                <div className="vt-alerts-empty">No recent alerts for this camera</div>
              ) : (
                alerts.map((a, i) => (
                  <div key={i} className="vt-alert-item">
                    <span className={`vt-alert-type vt-alert-type--${(a.type || a.scenario || "").toLowerCase().includes("motion") ? "motion" : "other"}`}>
                      {a.scenario || a.type || "Event"}
                    </span>
                    <span className="vt-alert-time">
                      {a.time ? new Date(a.time).toLocaleString()
                        : a.received_at ? new Date(a.received_at).toLocaleString() : "—"}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "info" && (() => {
            const groups = (() => { try { return JSON.parse(localStorage.getItem("miradorai_groups") || "[]"); } catch { return []; } })();
            const groupName = cam.group_id && cam.group_id !== "default"
              ? (groups.find(g => g.id === cam.group_id)?.name || "Default")
              : "Default";
            return (
            <div className="vt-info">
              <div className="vt-info-row"><span>Camera Name</span><strong>{cam.name}</strong></div>
              <div className="vt-info-row"><span>Camera Group</span><strong>{groupName}</strong></div>
              <div className="vt-info-row"><span>IP Address</span><strong>{cam.ip}</strong></div>
              <div className="vt-info-row"><span>Status</span>
                <strong className={cam.status === "online" ? "vt-info-online" : "vt-info-offline"}>
                  {cam.status === "online" ? "● Online" : "○ Offline"}
                </strong>
              </div>
              <div className="vt-info-row"><span>FOV Angle</span><strong>{marker.fovAngle || 60}°</strong></div>
              <div className="vt-info-row"><span>Direction</span><strong>{Math.round(marker.direction || 0)}°</strong></div>
              <div className="vt-info-row"><span>Map Position</span><strong>x:{Math.round(marker.x)}, y:{Math.round(marker.y)}</strong></div>
              <div className="vt-info-row"><span>Stream URL</span><strong className="vt-info-url">{cam.ws_url || "—"}</strong></div>
            </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}