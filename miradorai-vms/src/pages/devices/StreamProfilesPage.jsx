import { useState, useEffect } from "react";
import "./StreamProfilesPage.css";

const API = "http://localhost:8000";

const LABEL_STYLES = {
  MAIN:  { bg: "#0f1f3d", color: "#3b82f6", border: "#1e3a5f" },
  SUB:   { bg: "#1a0f2e", color: "#a78bfa", border: "#3b1f6e" },
  EXTRA: { bg: "#0d1f13", color: "#4ade80", border: "#1a4230" },
};

function getLabelStyle(label) {
  if (!label) return { bg: "#1a1a2e", color: "#94a3b8", border: "#334155" };
  return LABEL_STYLES[label.toUpperCase()] || { bg: "#1a1a2e", color: "#94a3b8", border: "#334155" };
}

function loadDevicesFromStorage() {
  try { return JSON.parse(localStorage.getItem("miradorai_devices") || "[]"); }
  catch { return []; }
}

/* ── ONVIF Profiles Card ─────────────────────────────────────── */
function ONVIFProfilesCard({ camera, profiles, selectedIdx, onSelect }) {
  if (!camera || !profiles || profiles.length === 0) return null;

  return (
    <div className="sp-onvif-card">
      <div className="sp-onvif-header">
        <div className="sp-onvif-header-left">
          <div className="sp-onvif-eyebrow">ONVIF Detected · Live from Database</div>
          <div className="sp-onvif-title">
            {camera.manufacturer || "Unknown"} {camera.model || ""}
            <span className="sp-onvif-ip">{camera.ip}</span>
            {camera.ptz === "Yes" && <span className="sp-onvif-ptz-badge">PTZ</span>}
          </div>
        </div>
        <div className="sp-onvif-badge">
          {profiles.length} stream{profiles.length !== 1 ? "s" : ""} detected
        </div>
      </div>

      {/* Camera meta */}
      <div className="sp-onvif-meta">
        {[
          { k: "Firmware",      v: camera.firmware },
          { k: "Serial",        v: camera.serial },
          { k: "MAC",           v: camera.mac !== "—" ? camera.mac : null },
          { k: "Total Streams", v: camera.stream_count, blue: true },
          { k: "PTZ",           v: camera.ptz },
        ].filter((x) => x.v).map(({ k, v, blue }) => (
          <div key={k} className="sp-onvif-meta-item">
            <span className="sp-onvif-meta-key">{k}</span>
            <span className={`sp-onvif-meta-val${blue ? " sp-onvif-meta-val--blue" : ""}`}>{v}</span>
          </div>
        ))}
      </div>

      {/* Profile table — rows are now selectable */}
      <div className="sp-onvif-profiles">
        <div className="sp-onvif-profiles-head">
          <span style={{ width: 20 }} />
          <span>Profile Name</span>
          <span>Resolution</span>
          <span>Encoding</span>
          <span>FPS</span>
          <span>Bitrate</span>
          <span>Role</span>
        </div>

        {profiles.map((p, i) => {
          const ls        = getLabelStyle(p.label);
          const isSelected = selectedIdx === i;

          return (
            <div
              key={i}
              className={`sp-onvif-profile-row sp-onvif-profile-row--selectable${isSelected ? " sp-onvif-profile-row--active" : ""}`}
              onClick={() => onSelect(i)}
            >
              {/* Radio indicator */}
              <span className="sp-profile-radio">
                <span className={`sp-profile-radio-dot${isSelected ? " sp-profile-radio-dot--on" : ""}`} />
              </span>

              <span className="sp-onvif-profile-name">{p.name || `Profile ${i + 1}`}</span>
              <span className="sp-onvif-profile-res">{p.resolution || "—"}</span>
              <span className="sp-onvif-profile-enc">{p.encoding || "—"}</span>
              <span className="sp-onvif-profile-fps">{p.fps ? `${p.fps} fps` : "—"}</span>
              <span className="sp-onvif-profile-bitrate">{p.bitrate ? `${p.bitrate} kbps` : "—"}</span>
              <span
                className="sp-onvif-profile-label"
                style={{ background: ls.bg, color: ls.color, border: `1px solid ${ls.border}` }}
              >
                {p.label || `STREAM ${i + 1}`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Show selected profile's RTSP URL */}
      {selectedIdx !== null && profiles[selectedIdx]?.rtsp_url && (
        <div className="sp-onvif-rtsp">
          <span className="sp-onvif-rtsp-label">Selected RTSP</span>
          <code className="sp-onvif-rtsp-url">{profiles[selectedIdx].rtsp_url}</code>
        </div>
      )}
    </div>
  );
}

function NoCameraState() {
  return (
    <div className="sp-no-camera-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" width="56" height="56">
        <path d="M23 7l-7 5 7 5V7z"/>
        <rect x="1" y="5" width="15" height="14" rx="2"/>
        <path d="M8 10h5M8 14h3" strokeLinecap="round" strokeWidth="1.2"/>
      </svg>
      <p className="sp-no-camera-title">No camera selected</p>
      <p className="sp-no-camera-sub">
        Go to <strong>Camera Registry</strong>, select a camera from the list,
        and click <strong>Stream Profiles</strong> in the side panel.
      </p>
    </div>
  );
}

/* ── Apply result toast ──────────────────────────────────────── */
function ApplyToast({ msg, ok }) {
  return (
    <div className={`sp-apply-toast${ok ? " sp-apply-toast--ok" : " sp-apply-toast--err"}`}>
      {ok
        ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="15" height="15"><polyline points="20 6 9 17 4 12"/></svg>
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      }
      {msg}
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────── */
export default function StreamProfilesPage() {
  const [camera,       setCamera]       = useState(null);
  const [profiles,     setProfiles]     = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [selectedIdx,  setSelectedIdx]  = useState(null);  // which profile row is selected
  const [applying,     setApplying]     = useState(false);
  const [applyResult,  setApplyResult]  = useState(null);  // { ok, msg }

  const selectedIp = localStorage.getItem("miradorai_selected_camera_ip") || null;
  const selectedId = localStorage.getItem("miradorai_selected_camera_id") || null;

  useEffect(() => {
    if (!selectedIp && !selectedId) return;

    setLoading(true);
    setError(null);
    setCamera(null);
    setProfiles([]);
    setSelectedIdx(null);
    setApplyResult(null);

    if (selectedIp) {
      fetch(`${API}/api/cameras/by-ip/${encodeURIComponent(selectedIp)}`)
        .then((r) => { if (!r.ok) throw new Error("not found"); return r.json(); })
        .then((data) => {
          setCamera(data);
          const profs = data.stream_profiles || [];
          setProfiles(profs);
          // Auto-select the MAIN profile if present
          const mainIdx = profs.findIndex(
            (p) => p.label?.toUpperCase() === "MAIN" || p.label?.toUpperCase() === "STREAM 1"
          );
          setSelectedIdx(mainIdx >= 0 ? mainIdx : profs.length > 0 ? 0 : null);
          setLoading(false);
        })
        .catch(() => fallbackToLocalStorage());
    } else {
      fallbackToLocalStorage();
    }

    function fallbackToLocalStorage() {
      const devices = loadDevicesFromStorage();
      const dev = selectedIp
        ? devices.find((d) => d.ip === selectedIp)
        : devices.find((d) => String(d.id) === String(selectedId));

      if (dev) {
        setCamera(dev);
        const profs = dev.stream_profiles || [];
        setProfiles(profs);
        const mainIdx = profs.findIndex((p) => p.label?.toUpperCase() === "MAIN");
        setSelectedIdx(mainIdx >= 0 ? mainIdx : profs.length > 0 ? 0 : null);
      } else {
        setError("Camera not found. Make sure the backend is running.");
      }
      setLoading(false);
    }
  }, []);

  /* ── Apply: re-register OME with the selected profile's RTSP ── */
  const handleApply = async () => {
    if (selectedIdx === null || !profiles[selectedIdx]) return;

    const profile  = profiles[selectedIdx];
    const rtspUrl  = profile.rtsp_url;

    if (!rtspUrl) {
      setApplyResult({ ok: false, msg: "Selected profile has no RTSP URL." });
      setTimeout(() => setApplyResult(null), 4000);
      return;
    }

    setApplying(true);
    setApplyResult(null);

    try {
      const res  = await fetch(`${API}/api/streams/register`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          rtsp_url:     rtspUrl,
          ip:           camera.ip,
          port:         camera.port || 80,
          username:     camera.username || "",
          manufacturer: camera.manufacturer || "",
          model:        camera.model || "",
          mac:          camera.mac || "—",
          device_name:  camera.name || "",
        }),
      });

      const data = res.ok ? await res.json() : null;

      if (data?.success) {
        setApplyResult({
          ok:  true,
          msg: `Stream switched to ${profile.name || `Profile ${selectedIdx + 1}`} (${profile.resolution || ""} ${profile.encoding || ""})`,
        });
        // Persist the active profile label back into localStorage
        const devices = loadDevicesFromStorage();
        const idx = devices.findIndex((d) => d.ip === camera.ip);
        if (idx !== -1) {
          devices[idx].ws_url       = data.ws_url;
          devices[idx].stream_key   = data.stream_key;
          devices[idx].active_profile = profile.name;
          localStorage.setItem("miradorai_devices", JSON.stringify(devices));
        }
      } else {
        setApplyResult({ ok: false, msg: data?.error || "OME registration failed." });
      }
    } catch (e) {
      setApplyResult({ ok: false, msg: `Network error: ${e.message}` });
    } finally {
      setApplying(false);
      setTimeout(() => setApplyResult(null), 5000);
    }
  };

  const selectedProfile = selectedIdx !== null ? profiles[selectedIdx] : null;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Stream <span>Profiles</span></h1>
          <p className="page-desc">
            {camera
              ? `ONVIF stream profiles for ${[camera.manufacturer, camera.model].filter(Boolean).join(" ") || camera.ip} · ${camera.ip}`
              : "Select a camera from Camera Registry to view its stream profiles."}
          </p>
        </div>
      </div>

      {loading && (
        <div className="sp-loading">
          <div className="sp-loading-spinner" />
          Fetching stream profiles from database…
        </div>
      )}

      {error && !loading && (
        <div className="sp-error-banner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4M12 16h.01"/>
          </svg>
          {error}
        </div>
      )}

      {!selectedIp && !selectedId && !loading && <NoCameraState />}

      {!loading && camera && (
        <ONVIFProfilesCard
          camera={camera}
          profiles={profiles}
          selectedIdx={selectedIdx}
          onSelect={setSelectedIdx}
        />
      )}

      {!loading && camera && profiles.length === 0 && (
        <div className="sp-no-profiles">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" width="24" height="24">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8h.01M12 12v4"/>
          </svg>
          No ONVIF stream profiles found. Re-probe this camera via
          <strong> Add Devices → Manual Search</strong> to discover streams.
        </div>
      )}

      {/* Selected profile summary */}
      {selectedProfile && (
        <div className="sp-selected-summary">
          <div className="sp-selected-summary-left">
            <span className="sp-selected-summary-label">Active selection</span>
            <span className="sp-selected-summary-name">{selectedProfile.name}</span>
            <span className="sp-selected-summary-meta">
              {[selectedProfile.resolution, selectedProfile.encoding,
                selectedProfile.fps ? `${selectedProfile.fps} fps` : null,
                selectedProfile.bitrate ? `${selectedProfile.bitrate} kbps` : null
              ].filter(Boolean).join(" · ")}
            </span>
          </div>
          <div className="sp-selected-summary-hint">
            Click a profile row to switch streams, then press Apply.
          </div>
        </div>
      )}

      {/* Toast result */}
      {applyResult && <ApplyToast ok={applyResult.ok} msg={applyResult.msg} />}

      <div className="page-footer">
        <span />
        <button
          className={`sp-apply-btn${applying ? " sp-apply-btn--loading" : ""}`}
          disabled={!camera || selectedIdx === null || applying}
          onClick={handleApply}
        >
          {applying ? (
            <>
              <span className="sp-apply-spinner" />
              Applying…
            </>
          ) : "Apply"}
        </button>
      </div>
    </div>
  );
}