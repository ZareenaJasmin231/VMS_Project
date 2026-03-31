import { useState, useEffect } from "react";
import WebRTCPlayer from "../../components/shared/WebRTCPlayer";
import "./LiveViewPage.css";

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

export default function LiveViewPage() {
  const [devices,    setDevices]    = useState(loadDevices);
  const [layout,     setLayout]     = useState("2x2");
  const [selected,   setSelected]   = useState(null);
  const [fullscreen, setFullscreen] = useState(null);

  useEffect(() => {
    const update = () => setDevices(loadDevices());
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);

  // ── Only show cameras that are enabled (enabled !== false) ──
  const activeCams  = devices.filter((d) => d.enabled !== false);
  const onlineCams  = activeCams.filter((d) => d.ws_url);
  const disabledCount = devices.length - activeCams.length;

  const cols   = layout === "1x1" ? 1 : layout === "2x2" ? 2 : layout === "3x3" ? 3 : 2;
  const is1plus3 = layout === "1+3";

  return (
    <div className="lv-page">

      {/* Toolbar */}
      <div className="lv-toolbar">
        <div className="lv-toolbar__left">
          <span className="lv-toolbar__title">Live View</span>
          <span className="lv-toolbar__count">
            {onlineCams.length} stream{onlineCams.length !== 1 ? "s" : ""} online
          </span>
          {/* ── Show how many cameras are disabled ── */}
          {disabledCount > 0 && (
            <span className="lv-toolbar__disabled-badge">
              {disabledCount} disabled
            </span>
          )}
        </div>
        <div className="lv-toolbar__right">
          <div className="lv-layouts">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                className={`lv-layout-btn ${layout === l.id ? "lv-layout-btn--active" : ""}`}
                title={l.label}
                onClick={() => setLayout(l.id)}>
                {l.icon}
              </button>
            ))}
          </div>
          {fullscreen && (
            <button className="lv-btn" onClick={() => setFullscreen(null)}>
              Exit Fullscreen
            </button>
          )}
        </div>
      </div>

      {/* Fullscreen view */}
      {fullscreen && (
        <div className="lv-fullscreen" onClick={() => setFullscreen(null)}>
          <div className="lv-fullscreen__inner" onClick={(e) => e.stopPropagation()}>
            <div className="lv-cell__header">
              <span className="lv-cell__name">{fullscreen.name}</span>
              <button className="lv-cell__close" onClick={() => setFullscreen(null)}>✕</button>
            </div>
            <div className="lv-fullscreen__player">
              {fullscreen.ws_url
                ? <WebRTCPlayer serverUrl={fullscreen.ws_url} />
                : <div className="lv-no-stream">No stream available</div>
              }
            </div>
          </div>
        </div>
      )}

      {/* Empty state — no cameras at all */}
      {devices.length === 0 ? (
        <div className="lv-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" width="64" height="64">
            <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
          </svg>
          <p>No cameras enrolled yet.</p>
          <p className="lv-empty__sub">Go to <strong>Add Devices</strong> to enroll cameras.</p>
        </div>

      /* ── All cameras exist but all are disabled ── */
      ) : activeCams.length === 0 ? (
        <div className="lv-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" width="64" height="64">
            <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
            <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
          <p>All cameras are disabled.</p>
          <p className="lv-empty__sub">
            Enable cameras in <strong>Camera Registry</strong> to view streams.
          </p>
        </div>

      ) : is1plus3 ? (
        <div className="lv-grid-1plus3">
          <div
            className={`lv-cell lv-cell--main ${selected === 0 ? "lv-cell--selected" : ""}`}
            onClick={() => setSelected(0)}>
            <CameraCell
              device={activeCams[0]}
              onFullscreen={() => setFullscreen(activeCams[0])}
            />
          </div>
          <div className="lv-grid-1plus3__side">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className={`lv-cell ${selected === i ? "lv-cell--selected" : ""}`}
                onClick={() => setSelected(i)}>
                {activeCams[i]
                  ? <CameraCell device={activeCams[i]} onFullscreen={() => setFullscreen(activeCams[i])} />
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
              onClick={() => setSelected(i)}>
              {activeCams[i]
                ? <CameraCell device={activeCams[i]} onFullscreen={() => setFullscreen(activeCams[i])} />
                : <EmptyCell index={i} />
              }
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CameraCell({ device, onFullscreen }) {
  return (
    <div className="lv-cam">
      <div className="lv-cell__header">
        <span className="lv-live-dot" />
        <span className="lv-cell__name">{device.name}</span>
        <div className="lv-cell__actions">
          <span className="lv-cell__ip">{device.ip}</span>
          <button
            className="lv-cell__fs-btn"
            onClick={(e) => { e.stopPropagation(); onFullscreen(); }}
            title="Fullscreen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="lv-cam__player">
        {device.ws_url
          ? <WebRTCPlayer key={device.ws_url} serverUrl={device.ws_url} />
          : <div className="lv-no-stream">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="32" height="32">
                <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
              </svg>
              <span>Stream not registered</span>
              <span className="lv-no-stream__ip">{device.ip}</span>
            </div>
        }
      </div>
    </div>
  );
}

function EmptyCell({ index }) {
  return (
    <div className="lv-empty-cell">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" width="28" height="28">
        <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
      </svg>
      <span>Empty</span>
    </div>
  );
}