import { useState, useEffect } from "react";
import "./StreamProfilesPage.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

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

function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem("miradorai_stream_profile_overrides") || "{}");
  } catch {
    return {};
  }
}

function saveOverride(cameraKey, profileToken, fields) {
  const overrides = loadOverrides();
  if (!overrides[cameraKey]) {
    overrides[cameraKey] = {};
  }
  overrides[cameraKey][profileToken] = {
    ...(overrides[cameraKey][profileToken] || {}),
    ...fields
  };
  localStorage.setItem("miradorai_stream_profile_overrides", JSON.stringify(overrides));
}

function profileMeta(p) {
  return [
    p.resolution,
    p.encoding,
    p.fps     ? `${p.fps} fps`      : null,
    p.bitrate ? `${p.bitrate} kbps` : null,
  ].filter(Boolean).join(" · ");
}

/* ─────────────────────────────────────────────────────────
   Resolve which profile index to select, priority order:
   1. Previously saved profile name (from DB / localStorage)
   2. Label-based auto-assign (MAIN / SUB / EXTRA)
   3. Positional fallback (0 or 1)
───────────────────────────────────────────────────────── */
function resolveIdx(profs, savedName, preferredLabels, fallbackIdx) {
  // 1. Restore by saved name
  if (savedName) {
    const idx = profs.findIndex(
      (p) => p.name === savedName || p.token === savedName
    );
    if (idx !== -1) return idx;
  }
  // 2. Label-based
  for (const label of preferredLabels) {
    const idx = profs.findIndex((p) => p.label?.toUpperCase() === label);
    if (idx !== -1) return idx;
  }
  // 3. Positional fallback
  return Math.min(fallbackIdx, profs.length - 1);
}

/* ── Single profile row ──────────────────────────────────── */
function ProfileRow({ profile, index, isSelected, accentColor, onSelect, onEdit }) {
  const ls = getLabelStyle(profile.label);
  return (
    <div
      className={`sp-onvif-profile-row sp-onvif-profile-row--selectable${isSelected ? " sp-onvif-profile-row--active" : ""}`}
      style={isSelected ? { boxShadow: `inset 3px 0 0 ${accentColor}` } : {}}
      onClick={() => onSelect(index)}
    >
      <span className="sp-profile-radio" style={isSelected ? { borderColor: accentColor } : {}}>
        <span
          className={`sp-profile-radio-dot${isSelected ? " sp-profile-radio-dot--on" : ""}`}
          style={isSelected ? { background: accentColor } : {}}
        />
      </span>
      <span className="sp-onvif-profile-name">{profile.name || `Profile ${index + 1}`}</span>
      <span className="sp-onvif-profile-res">{profile.resolution || "—"}</span>
      <span className="sp-onvif-profile-enc">{profile.encoding || "—"}</span>
      <span className="sp-onvif-profile-fps">{profile.fps ? `${profile.fps} fps` : "—"}</span>
      <span className="sp-onvif-profile-bitrate">{profile.bitrate ? `${profile.bitrate} kbps` : "—"}</span>
      <span
        className="sp-onvif-profile-label"
        style={{ background: ls.bg, color: ls.color, border: `1px solid ${ls.border}` }}
      >
        {profile.label || `STREAM ${index + 1}`}
      </span>
      {onEdit && (
        <button
          className="sp-profile-edit-btn"
          title="Configure Encoder"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(profile);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      )}
    </div>
  );
}

/* ── Dual-lane card ──────────────────────────────────────── */
function ONVIFProfilesCard({ camera, profiles, recIdx, onSelectRec, onEdit }) {
  if (!camera || !profiles?.length) return null;

  const recProfile  = recIdx  !== null ? profiles[recIdx]  : null;

  return (
    <div className="sp-onvif-card">
      {/* Header */}
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

      {/* Meta */}
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

      {/* Dual-lane table */}
      <div className="sp-dual-lanes">

        {/* RECORDING lane */}
        <div className="sp-lane sp-lane--rec">
          <div className="sp-lane-header">
            <span className="sp-lane-dot sp-lane-dot--rec" />
            <span className="sp-lane-title">Recording</span>
            <span className="sp-lane-hint">select profile for recording</span>
          </div>
          <div className="sp-onvif-profiles-head">
            <span style={{ width: 20 }} />
            <span>Profile Name</span><span>Resolution</span>
            <span>Encoding</span><span>FPS</span>
            <span>Bitrate</span><span>Role</span>
          </div>
          <div className="sp-lane-profiles">
  {profiles.map((p, i) => (
    <ProfileRow key={i} profile={p} index={i}
      isSelected={recIdx === i} accentColor="#60a5fa" onSelect={onSelectRec} onEdit={onEdit} />
  ))}
</div>
          {recProfile?.rtsp_url && (
            <div className="sp-onvif-rtsp">
              <span className="sp-onvif-rtsp-label">Recording RTSP</span>
              <code className="sp-onvif-rtsp-url">{recProfile.rtsp_url}</code>
            </div>
          )}
        </div>
      </div>
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
        Go to <strong>Manage Camera Groups</strong>, select a camera,
        then click <strong>Stream Profiles</strong>.
      </p>
    </div>
  );
}

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

function SelectionSummary({ recProfile }) {
  if (!recProfile) return null;
  return (
    <div className="sp-dual-summary">
      {recProfile && (
        <div className="sp-dual-summary-card sp-dual-summary-card--rec">
          <div className="sp-dual-summary-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" width="14" height="14">
              <circle cx="12" cy="12" r="5" fill="#60a5fa"/>
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
            </svg>
          </div>
          <div className="sp-dual-summary-body">
            <span className="sp-dual-summary-label">Recording</span>
            <span className="sp-dual-summary-name">{recProfile.name}</span>
            <span className="sp-dual-summary-meta">{profileMeta(recProfile)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Configure Encoder Modal ─────────────────────────────── */
function ConfigureEncoderModal({ camera, profile, onClose, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const [codec, setCodec] = useState(profile.encoding || "H264");
  const [resolution, setResolution] = useState(profile.resolution || "1920x1080");
  const [fps, setFps] = useState(profile.fps || 15);
  const [bitrateType, setBitrateType] = useState(profile.bitrate_type || "CBR");
  const [bitrateMode, setBitrateMode] = useState("Customized");
  const [bitrate, setBitrate] = useState(profile.bitrate || 2048);
  const [iframeInterval, setIframeInterval] = useState(profile.iframe_interval || 25);

  const handleSave = (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const finalBitrate = bitrateMode === "Customized" ? parseInt(bitrate) : parseInt(bitrateMode);
    const cameraKey = camera.ip || String(camera.id);

    try {
      saveOverride(cameraKey, profile.token, {
        encoding: codec,
        resolution,
        fps: parseInt(fps),
        bitrate: finalBitrate,
        bitrate_type: bitrateType,
        iframe_interval: parseInt(iframeInterval)
      });
      onSaved();
    } catch (err) {
      setError("Failed to save configuration parameters.");
    } finally {
      setLoading(false);
    }
  };

  const resolutions = [
    "3840x2160",
    "2560x1440",
    "1920x1080",
    "1280x720",
    "704x576",
    "352x288"
  ];
  const fpsOptions = [5, 10, 15, 20, 25, 30];

  return (
    <div className="cem-modal-overlay">
      <div className="cem-modal-container">
        <div className="cem-modal-header">
          <h3>Configure Stream Encoder (VMS UI Only)</h3>
          <button className="cem-close-btn" onClick={onClose}>&times;</button>
        </div>
        
        <form onSubmit={handleSave} className="cem-modal-body">
          {error && <div className="cem-error-message">{error}</div>}
          
          <div className="cem-info-row">
            <span className="cem-info-label">Profile:</span>
            <span className="cem-info-value">{profile.name} ({profile.token})</span>
          </div>

          <div className="cem-form-group">
            <label>Encode Mode</label>
            <select value={codec} onChange={e => setCodec(e.target.value)}>
              <option value="H.264">H.264</option>
              <option value="H.265">H.265</option>
              <option value="MJPEG">MJPEG</option>
            </select>
          </div>

          <div className="cem-form-group">
            <label>Resolution</label>
            <select value={resolution} onChange={e => setResolution(e.target.value)}>
              {resolutions.map(res => (
                <option key={res} value={res}>{res}</option>
              ))}
            </select>
          </div>

          <div className="cem-form-group">
            <label>Frame Rate (FPS)</label>
            <select value={fps} onChange={e => setFps(e.target.value)}>
              {fpsOptions.map(val => (
                <option key={val} value={val}>{val}</option>
              ))}
            </select>
          </div>

          <div className="cem-form-group">
            <label>Bit Rate Type</label>
            <select value={bitrateType} onChange={e => setBitrateType(e.target.value)}>
              <option value="CBR">CBR</option>
              <option value="VBR">VBR</option>
            </select>
          </div>

          <div className="cem-form-group">
            <label>Bit Rate (Kb/S)</label>
            <select value={bitrateMode} onChange={e => setBitrateMode(e.target.value)}>
              <option value="Customized">Customized</option>
              <option value="256">256</option>
              <option value="512">512</option>
              <option value="1024">1024</option>
              <option value="2048">2048</option>
              <option value="4096">4096</option>
              <option value="8192">8192</option>
            </select>
            {bitrateMode === "Customized" && (
              <input
                type="number"
                style={{ marginTop: '8px' }}
                value={bitrate}
                min={128}
                max={16384}
                onChange={e => setBitrate(e.target.value)}
                placeholder="Enter custom bitrate"
              />
            )}
          </div>

          <div className="cem-form-group">
            <label>I Frame Interval</label>
            <input
              type="number"
              value={iframeInterval}
              min={2}
              max={150}
              onChange={e => setIframeInterval(e.target.value)}
            />
          </div>

          <div className="cem-warning-notice">
            <strong>Notice:</strong> These options configure the VMS UI stream parameters wrapper. They do not alter the encoder hardware configuration on the physical camera itself.
          </div>

          <div className="cem-modal-footer">
            <button type="button" className="cem-btn cem-btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="cem-btn cem-btn-primary" disabled={loading}>
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────── */
export default function StreamProfilesPage() {
  const [camera,      setCamera]      = useState(null);
  const [profiles,    setProfiles]    = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [recIdx,      setRecIdx]      = useState(null);
  const [applying,    setApplying]    = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [editingProfile, setEditingProfile] = useState(null);

  const selectedIp = localStorage.getItem("miradorai_selected_camera_ip") || null;
  const selectedId = localStorage.getItem("miradorai_selected_camera_id") || null;

  /* ── Core: apply camera data + restore saved selections ── */
  function applyDeviceData(data) {
    setCamera(data);
    
    const cameraKey = data.ip || String(data.id);
    const overrides = loadOverrides();
    const cameraOverrides = overrides[cameraKey] || {};

    const profs = (data.stream_profiles || []).map(p => {
      if (cameraOverrides[p.token]) {
        return {
          ...p,
          ...cameraOverrides[p.token]
        };
      }
      return p;
    });

    setProfiles(profs);

    if (!profs.length) {
      setLoading(false);
      return;
    }

    const savedRec  = data.active_rec_profile  || data.active_rec_token  || null;

    const recI = resolveIdx(
      profs,
      savedRec,
      ["SUB", "EXTRA"],  
      profs.length > 1 ? 1 : 0  
    );

    setRecIdx(recI);
    setLoading(false);
  }

  const loadCameraData = () => {
    if (!selectedIp && !selectedId) return;

    setLoading(true);
    setError(null);
    setCamera(null);
    setProfiles([]);
    setRecIdx(null);
    setApplyResult(null);

    function fallbackToLocalStorage() {
      const devs = loadDevicesFromStorage();
      const dev  = selectedIp
        ? devs.find((d) => d.ip === selectedIp)
        : devs.find((d) => String(d.id) === String(selectedId));
      if (dev) {
        applyDeviceData(dev);
      } else {
        setError("Camera not found. Make sure the backend is running.");
        setLoading(false);
      }
    }

    if (selectedIp) {
      fetch(`${API}/api/cameras/by-ip/${encodeURIComponent(selectedIp)}`)
        .then((r) => { if (!r.ok) throw new Error("not found"); return r.json(); })
        .then(applyDeviceData)
        .catch(fallbackToLocalStorage);
    } else {
      fallbackToLocalStorage();
    }
  };

  useEffect(() => {
    loadCameraData();
  }, []);

  const handleEncoderSaved = () => {
    setEditingProfile(null);
    setApplyResult({
      ok: true,
      msg: "Video encoder settings saved locally successfully. Updating profiles list..."
    });
    loadCameraData();
    setTimeout(() => setApplyResult(null), 5000);
  };

  /* ── Apply ─────────────────────────────────────────────── */
  const handleApply = async () => {
    if (recIdx === null) return;
    const recProfile  = profiles[recIdx];
    const liveProfile = recProfile;

    if (!liveProfile?.rtsp_url || !recProfile?.rtsp_url) {
      setApplyResult({ ok: false, msg: "Selected profile(s) have no RTSP URL." });
      setTimeout(() => setApplyResult(null), 4000);
      return;
    }

    setApplying(true);
    setApplyResult(null);

    try {
      const res = await fetch(`${API}/api/streams/assign`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip:                camera.ip,
          port:              camera.port || 80,
          username:          camera.username || "",
          manufacturer:      camera.manufacturer || "",
          model:             camera.model || "",
          mac:               camera.mac || "—",
          device_name:       camera.device_name || camera.name || "",
          live_rtsp:         liveProfile.rtsp_url,
          recording_rtsp:    recProfile.rtsp_url,
          live_profile:      liveProfile.name,
          recording_profile: recProfile.name,
          live_codec:        liveProfile.encoding || "H.264",
          resolution:        recProfile.resolution,
          fps:               recProfile.fps,
          bitrate:           recProfile.bitrate,
        }),
      });

      let data = null;
      try { data = await res.json(); } catch { }

      if (data?.success === true) {
        setApplyResult({
          ok:  true,
          msg: `Applied — Live: ${liveProfile.name} (${liveProfile.resolution || "?"}) · Recording: ${recProfile.name} (${recProfile.resolution || "?"})`,
        });

        const devs = loadDevicesFromStorage();
        const idx  = devs.findIndex((d) => d.ip === camera.ip);
        if (idx !== -1) {
          if (data.ws_url)     devs[idx].ws_url     = data.ws_url;
          if (data.stream_key) devs[idx].stream_key = data.stream_key;
          devs[idx].active_live_profile = liveProfile.name;
          devs[idx].active_rec_profile  = recProfile.name;
          // Also persist profile properties to the local storage device entry
          devs[idx].stream_profiles = profiles;
          localStorage.setItem("miradorai_devices", JSON.stringify(devs));
          window.dispatchEvent(new Event("storage")); 
        }

        setCamera((prev) => ({
          ...prev,
          active_live_profile: liveProfile.name,
          active_rec_profile:  recProfile.name,
          stream_profiles:     profiles
        }));

      } else {
        setApplyResult({
          ok:  false,
          msg: data?.error || `Server returned HTTP ${res.status}`,
        });
      }
    } catch (e) {
      setApplyResult({ ok: false, msg: `Network error: ${e.message}` });
    } finally {
      setApplying(false);
      setTimeout(() => setApplyResult(null), 5000);
    }
  };

  const recProfile  = recIdx  !== null ? profiles[recIdx]  : null;
  const canApply    = !!(camera && recIdx !== null && !applying);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Stream <span>Profiles</span></h1>
          <p className="page-desc">
            {camera
               ? `ONVIF stream profiles for ${[camera.manufacturer, camera.model].filter(Boolean).join(" ") || camera.ip} · ${camera.ip}`
              : "Select a camera from Manage Camera Groups to view its stream profiles."}
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
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
          </svg>
          {error}
        </div>
      )}

      {!selectedIp && !selectedId && !loading && <NoCameraState />}

      {!loading && camera && (
        <ONVIFProfilesCard
          camera={camera} profiles={profiles}
          recIdx={recIdx}
          onSelectRec={setRecIdx}
          onEdit={setEditingProfile}
        />
      )}

      {!loading && camera && profiles.length === 0 && (
        <div className="sp-no-profiles">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" width="24" height="24">
            <circle cx="12" cy="12" r="10"/><path d="M12 8h.01M12 12v4"/>
          </svg>
          No ONVIF stream profiles found. Re-probe this camera via
          <strong> Add Devices → Manual Search</strong> to discover streams.
        </div>
      )}

      <SelectionSummary recProfile={recProfile} />

      {applyResult && <ApplyToast ok={applyResult.ok} msg={applyResult.msg} />}

      {editingProfile && (
        <ConfigureEncoderModal
          camera={camera}
          profile={editingProfile}
          onClose={() => setEditingProfile(null)}
          onSaved={handleEncoderSaved}
        />
      )}

      <div className="page-footer">
        <span />
        <button
          className={`sp-apply-btn${applying ? " sp-apply-btn--loading" : applyResult?.ok ? " sp-apply-btn--success" : ""}`}
          disabled={!canApply}
          onClick={handleApply}
        >
          {applying ? (
            <><span className="sp-apply-spinner" />Applying…</>
          ) : applyResult?.ok ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Applied
            </>
          ) : "Apply"}
        </button>
      </div>
    </div>
  );
}