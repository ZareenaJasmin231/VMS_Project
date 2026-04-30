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
function ProfileRow({ profile, index, isSelected, accentColor, onSelect }) {
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
    </div>
  );
}

/* ── Dual-lane card ──────────────────────────────────────── */
function ONVIFProfilesCard({ camera, profiles, liveIdx, recIdx, onSelectLive, onSelectRec }) {
  if (!camera || !profiles?.length) return null;

  const liveProfile = liveIdx !== null ? profiles[liveIdx] : null;
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

        {/* LIVE lane */}
        <div className="sp-lane sp-lane--live">
          <div className="sp-lane-header">
            <span className="sp-lane-dot sp-lane-dot--live" />
            <span className="sp-lane-title">Live Stream</span>
            <span className="sp-lane-hint">select profile for live view</span>
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
      isSelected={liveIdx === i} accentColor="#f87171" onSelect={onSelectLive} />
  ))}
</div>
          {liveProfile?.rtsp_url && (
            <div className="sp-onvif-rtsp">
              <span className="sp-onvif-rtsp-label">Live RTSP</span>
              <code className="sp-onvif-rtsp-url">{liveProfile.rtsp_url}</code>
            </div>
          )}
        </div>

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
      isSelected={recIdx === i} accentColor="#60a5fa" onSelect={onSelectRec} />
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

function SelectionSummary({ liveProfile, recProfile }) {
  if (!liveProfile && !recProfile) return null;
  return (
    <div className="sp-dual-summary">
      {liveProfile && (
        <div className="sp-dual-summary-card sp-dual-summary-card--live">
          <div className="sp-dual-summary-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" width="14" height="14">
              <circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" strokeDasharray="2 3"/>
            </svg>
          </div>
          <div className="sp-dual-summary-body">
            <span className="sp-dual-summary-label">Live Stream</span>
            <span className="sp-dual-summary-name">{liveProfile.name}</span>
            <span className="sp-dual-summary-meta">{profileMeta(liveProfile)}</span>
          </div>
        </div>
      )}
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

/* ── Main Page ───────────────────────────────────────────── */
export default function StreamProfilesPage() {
  const [camera,      setCamera]      = useState(null);
  const [profiles,    setProfiles]    = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [liveIdx,     setLiveIdx]     = useState(null);
  const [recIdx,      setRecIdx]      = useState(null);
  const [applying,    setApplying]    = useState(false);
  const [applyResult, setApplyResult] = useState(null);

  const selectedIp = localStorage.getItem("miradorai_selected_camera_ip") || null;
  const selectedId = localStorage.getItem("miradorai_selected_camera_id") || null;

  /* ── Core: apply camera data + restore saved selections ── */
  function applyDeviceData(data) {
    setCamera(data);
    const profs = data.stream_profiles || [];
    setProfiles(profs);

    if (!profs.length) {
      setLoading(false);
      return;
    }

    // ── Restore previously applied profile selections ──────────────────────
    // Priority: DB saved name → label heuristic → positional fallback
    // active_live_profile / active_rec_profile are set by /api/streams/assign
    const savedLive = data.active_live_profile || data.active_live_token || null;
    const savedRec  = data.active_rec_profile  || data.active_rec_token  || null;

    const liveI = resolveIdx(
      profs,
      savedLive,
      ["MAIN"],          // prefer MAIN for live if no saved selection
      0                  // final fallback: first profile
    );

    const recI = resolveIdx(
      profs,
      savedRec,
      ["SUB", "EXTRA"],  // prefer SUB then EXTRA for recording
      profs.length > 1 ? 1 : 0  // final fallback: second profile (or first if only one)
    );

    setLiveIdx(liveI);
    setRecIdx(recI);
    setLoading(false);
  }

  useEffect(() => {
    if (!selectedIp && !selectedId) return;

    setLoading(true);
    setError(null);
    setCamera(null);
    setProfiles([]);
    setLiveIdx(null);
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
  }, []);

  /* ── Apply ───────────────────────────────────────────────
     Sends both RTSPs independently.
     On success: backend saves active_live_profile +
     active_rec_profile to MongoDB so the next page load
     restores the correct selections automatically.
  ─────────────────────────────────────────────────────── */
  const handleApply = async () => {
    if (liveIdx === null || recIdx === null) return;
    const liveProfile = profiles[liveIdx];
    const recProfile  = profiles[recIdx];

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
        }),
      });

      let data = null;
      try { data = await res.json(); } catch { /* non-JSON */ }

      if (data?.success === true) {
        setApplyResult({
          ok:  true,
          msg: `Applied — Live: ${liveProfile.name} (${liveProfile.resolution || "?"}) · Recording: ${recProfile.name} (${recProfile.resolution || "?"})`,
        });

        // ── Update localStorage so LiveView picks up new ws_url immediately
        const devs = loadDevicesFromStorage();
        const idx  = devs.findIndex((d) => d.ip === camera.ip);
        if (idx !== -1) {
          if (data.ws_url)     devs[idx].ws_url     = data.ws_url;
          if (data.stream_key) devs[idx].stream_key = data.stream_key;
          // Also persist the active profile names locally so a localStorage
          // fallback (when backend is down) still restores correctly
          devs[idx].active_live_profile = liveProfile.name;
          devs[idx].active_rec_profile  = recProfile.name;
          localStorage.setItem("miradorai_devices", JSON.stringify(devs));
          window.dispatchEvent(new Event("storage")); // notify LiveViewPage
        }

        // ── Also update local camera state so the UI shows correct selections
        // even without a page refresh
        setCamera((prev) => ({
          ...prev,
          active_live_profile: liveProfile.name,
          active_rec_profile:  recProfile.name,
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

  const liveProfile = liveIdx !== null ? profiles[liveIdx] : null;
  const recProfile  = recIdx  !== null ? profiles[recIdx]  : null;
  const canApply    = !!(camera && liveIdx !== null && recIdx !== null && !applying);

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
          liveIdx={liveIdx} recIdx={recIdx}
          onSelectLive={setLiveIdx} onSelectRec={setRecIdx}
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

      <SelectionSummary liveProfile={liveProfile} recProfile={recProfile} />

      {applyResult && <ApplyToast ok={applyResult.ok} msg={applyResult.msg} />}

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