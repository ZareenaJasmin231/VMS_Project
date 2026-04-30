import { useState, useEffect, useRef } from "react";

const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap');

  .msm-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(6,8,14,0.82);
    backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    animation: fadeIn .18s ease;
  }
  @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }

  .msm-card {
    font-family: 'DM Mono', monospace;
    background: #0d1117;
    border: 1px solid #1e2a3a;
    border-radius: 14px;
    width: 480px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 32px 80px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.03);
    animation: slideUp .22s cubic-bezier(.22,1,.36,1);
    overflow: hidden;
  }
  @keyframes slideUp { from { transform:translateY(24px); opacity:0 } to { transform:translateY(0); opacity:1 } }

  .msm-header {
    padding: 22px 24px 18px;
    border-bottom: 1px solid #1e2a3a;
    display: flex; align-items: flex-start; justify-content: space-between;
    flex-shrink: 0;
  }
  .msm-eyebrow {
    font-size: 10px; letter-spacing: .14em; text-transform: uppercase;
    color: #3b82f6; font-weight: 500; margin-bottom: 4px;
  }
  .msm-title {
    font-family: 'Syne', sans-serif;
    font-size: 18px; font-weight: 700; color: #e8edf5; margin: 0;
  }
  .msm-close {
    background: none; border: none; cursor: pointer;
    color: #4a5568; padding: 2px; transition: color .15s;
  }
  .msm-close:hover { color: #e8edf5; }

  .msm-body {
    padding: 24px;
    display: flex; flex-direction: column; gap: 16px;
    overflow-y: auto;
    flex: 1;
  }

  .msm-body::-webkit-scrollbar { width: 6px; }
  .msm-body::-webkit-scrollbar-track { background: transparent; }
  .msm-body::-webkit-scrollbar-thumb { background: #1e2a3a; border-radius: 3px; }
  .msm-body::-webkit-scrollbar-thumb:hover { background: #2e3d55; }

  .msm-row { display: flex; gap: 12px; }
  .msm-field { display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .msm-field--port { flex: 0 0 160px; }

  .msm-label {
    font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
    color: #6b7a99; font-weight: 500;
  }
  .msm-input {
    background: #080c12; border: 1px solid #1e2a3a; border-radius: 8px;
    color: #c9d4e8; font-family: 'DM Mono', monospace; font-size: 13px;
    padding: 10px 13px; outline: none;
    transition: border-color .15s, box-shadow .15s;
    width: 100%; box-sizing: border-box;
  }
  .msm-input::placeholder { color: #2e3d55; }
  .msm-input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.18); }
  .msm-input.error { border-color: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,.15); }

  .msm-custom-select { position: relative; width: 100%; }
  .msm-select-btn {
    background: #080c12; border: 1px solid #1e2a3a; border-radius: 8px;
    color: #c9d4e8; font-family: 'DM Mono', monospace; font-size: 13px;
    padding: 10px 13px; outline: none; width: 100%; text-align: left;
    display: flex; justify-content: space-between; align-items: center;
    cursor: pointer; transition: border-color .15s, box-shadow .15s;
  }
  .msm-select-btn:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.18); }
  .msm-dropdown-menu {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0;
    background: #0d1117; border: 1px solid #1e2a3a; border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.6); z-index: 999;
    padding: 6px; list-style: none; margin: 0;
    max-height: 200px; overflow-y: auto;
  }
  .msm-dropdown-menu::-webkit-scrollbar { width: 6px; }
  .msm-dropdown-menu::-webkit-scrollbar-track { background: transparent; }
  .msm-dropdown-menu::-webkit-scrollbar-thumb { background: #1e2a3a; border-radius: 3px; }
  .msm-dropdown-menu::-webkit-scrollbar-thumb:hover { background: #2e3d55; }
  .msm-dropdown-item {
    padding: 8px 12px; color: #8b99b3; font-size: 13px; cursor: pointer;
    border-radius: 4px; display: flex; align-items: center; transition: all .15s;
  }
  .msm-dropdown-item:hover { background: #1e2a3a; color: #c9d4e8; }
  .msm-dropdown-item.active { background: #1a253a; color: #3b82f6; font-weight: 500; }

  .msm-password-wrapper {
    position: relative;
  }
  .msm-password-input {
    padding-right: 40px;
  }
  .msm-eye-btn {
    position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer;
    color: #6b7a99; padding: 2px; transition: color .15s;
  }
  .msm-eye-btn:hover { color: #c9d4e8; }

  .msm-divider {
    display: flex; align-items: center; gap: 10px;
    color: #2e3d55; font-size: 11px;
  }
  .msm-divider::before, .msm-divider::after {
    content: ''; flex: 1; height: 1px; background: #1e2a3a;
  }

  .msm-probe {
    background: #080c12; border: 1px solid #1e2a3a;
    border-radius: 8px; padding: 12px 14px;
    display: flex; align-items: center; gap: 10px;
    font-size: 12px; color: #4a5568; min-height: 44px;
  }
  .msm-probe.probing { color: #3b82f6; border-color: #1e3a5f; }
  .msm-probe.success { color: #22c55e; border-color: #14532d; background: #0a1a10; }
  .msm-probe.fail    { color: #f87171; border-color: #4c1d1d; background: #130a0a; }

  .msm-spinner {
    width: 14px; height: 14px; border: 2px solid #1e3a5f;
    border-top-color: #3b82f6; border-radius: 50%;
    animation: spin .7s linear infinite; flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg) } }

  .msm-probe-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: currentColor; }

  .msm-info-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
    background: #080c12; border: 1px solid #14532d;
    border-radius: 8px; padding: 12px 14px;
  }
  .msm-info-item { display: flex; flex-direction: column; gap: 2px; }
  .msm-info-key  { font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: #4a5568; }
  .msm-info-val  { font-size: 12px; color: #c9d4e8; }
  .msm-info-val--highlight { color: #3b82f6; font-weight: 500; }

  .msm-profiles { border: 1px solid #1e2a3a; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; }
  .msm-profiles-scroll {
    max-height: 180px;
    overflow-y: auto;
  }
  .msm-profiles-scroll::-webkit-scrollbar { width: 6px; }
  .msm-profiles-scroll::-webkit-scrollbar-track { background: transparent; }
  .msm-profiles-scroll::-webkit-scrollbar-thumb { background: #1e2a3a; border-radius: 3px; }
  .msm-profiles-scroll::-webkit-scrollbar-thumb:hover { background: #2e3d55; }
  .msm-profiles-header {
    background: #0d1117; padding: 7px 12px;
    font-size: 9px; letter-spacing: .12em; text-transform: uppercase;
    color: #4a5568; border-bottom: 1px solid #1e2a3a;
    display: flex; justify-content: space-between; align-items: center;
  }
  .msm-profiles-badge {
    background: #0f1f3d; color: #3b82f6;
    border: 1px solid #2563eb; border-radius: 4px;
    padding: 2px 7px; font-size: 10px; font-weight: 500; letter-spacing: .05em;
  }
  .msm-profile-row {
    background: #080c12; padding: 9px 12px;
    display: grid; grid-template-columns: 1fr 80px 55px 58px;
    gap: 8px; align-items: center;
    border-bottom: 1px solid #111923; font-size: 11px;
  }
  .msm-profile-row:last-child { border-bottom: none; }
  .msm-profile-name { color: #c9d4e8; font-weight: 500; }
  .msm-profile-res  { color: #6b7a99; font-size: 10px; margin-top: 2px; }
  .msm-profile-meta { color: #4a5568; font-size: 10px; }
  .msm-profile-tag {
    font-size: 9px; padding: 2px 6px; border-radius: 4px;
    text-align: center; font-weight: 500;
    letter-spacing: .04em; text-transform: uppercase;
  }
  .msm-profile-tag--main  { background: #0f1f3d; color: #3b82f6; border: 1px solid #1e3a5f; }
  .msm-profile-tag--sub   { background: #1a0f2e; color: #a78bfa; border: 1px solid #3b1f6e; }
  .msm-profile-tag--extra { background: #0d1f13; color: #4ade80; border: 1px solid #1a4230; }

  .msm-routing-hint {
    background: #0a0f1a; border: 1px solid #1a2a3a;
    border-left: 2px solid #2563eb;
    border-radius: 0 6px 6px 0;
    padding: 8px 12px; font-size: 11px;
    color: #4a6a99; line-height: 1.5;
  }
  .msm-routing-hint span { color: #60a5fa; }

  .msm-footer {
    padding: 16px 24px 20px; border-top: 1px solid #1e2a3a;
    display: flex; justify-content: flex-end; gap: 10px;
    flex-shrink: 0;
  }

  input[type="password"]::-ms-reveal,
  input[type="password"]::-ms-clear { display: none; }
  input[type="password"]::-webkit-credentials-auto-fill-button,
  input[type="password"]::-webkit-textfield-decoration-container { display: none !important; }
  input[type="password"]::-webkit-contacts-auto-fill-button { display: none !important; }

  .msm-btn {
    font-family: 'DM Mono', monospace; font-size: 12px; font-weight: 500;
    padding: 9px 18px; border-radius: 8px; cursor: pointer;
    border: 1px solid transparent; transition: all .15s;
  }
  .msm-btn--ghost  { background: transparent; border-color: #1e2a3a; color: #6b7a99; }
  .msm-btn--ghost:hover { border-color: #2e3d55; color: #c9d4e8; }
  .msm-btn--probe  { background: #0f1f3d; border-color: #2563eb; color: #3b82f6; }
  .msm-btn--probe:hover:not(:disabled) { background: #1a3260; }
  .msm-btn--enroll { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
  .msm-btn--enroll:hover:not(:disabled) { background: #2563eb; }
  .msm-btn:disabled { opacity: .35; cursor: not-allowed; }

  .msm-error-msg { font-size: 11px; color: #f87171; margin-top: -8px; }
`;

const PROFILE_TAGS = ["main", "sub", "extra"];

function getRoutingHint(profiles) {
  if (!profiles || profiles.length === 0) return null;
  if (profiles.length === 1) {
    return (
      <>
        <span>Live, Record & Remote</span> will all share the single available stream.
      </>
    );
  }
  if (profiles.length === 2) {
    return (
      <>
        <span>Live + Record</span> → {profiles[0].name} ({profiles[0].resolution})
        &nbsp;·&nbsp;
        <span>Remote Access</span> → {profiles[1].name} ({profiles[1].resolution})
      </>
    );
  }
  return (
    <>
      <span>Record</span> → {profiles[0].name} &nbsp;·&nbsp;
      <span>Live</span> → {profiles[1].name} &nbsp;·&nbsp;
      <span>Remote</span> → {profiles[2].name}
    </>
  );
}

function validateIP(ip) {
  return (
    /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
    ip.split(".").every((n) => +n >= 0 && +n <= 255)
  );
}

export default function ManualSearchModal({
  onClose,
  onEnroll,
  groups,
  selectedGroupId,
  setSelectedGroupId
}) {
  // ✅ FIX 3 STEP 1: Added cameraName state
  const [cameraName, setCameraName] = useState("");
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("80");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rtspUrl, setRtspUrl] = useState("");
  const [urlLabel, setUrlLabel] = useState("");
  const [mode] = useState("onvif");
  const [probe, setProbe] = useState("idle");
  const [discovered, setDiscovered] = useState(null);
  const [detectedPort, setDetectedPort] = useState(null);
  const [errors, setErrors] = useState({});
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName !== 'INPUT') return;
      const inputs = document.querySelectorAll('.msm-card input[tabindex]');
      const currentIndex = Array.from(inputs).findIndex(input => input === e.target);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % inputs.length;
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + inputs.length) % inputs.length;
      } else {
        return;
      }
      e.preventDefault();
      inputs[nextIndex].focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const validate = () => {
    const e = {};
    if (!ip) e.ip = "IP address is required";
    else if (!validateIP(ip)) e.ip = "Invalid IP address";
    if (port && (isNaN(port) || +port < 1 || +port > 65535)) e.port = "1–65535";
    return e;
  };

  const validateDirectUrl = () => {
    const e = {};
    if (!rtspUrl.trim()) e.rtspUrl = "RTSP URL is required";
    else if (!rtspUrl.toLowerCase().startsWith("rtsp://")) e.rtspUrl = "URL must start with rtsp://";
    return e;
  };

  const handleProbe = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setProbe("probing");
    setDiscovered(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const res = await fetch("http://localhost:8000/api/onvif/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip,
          port: port ? Number(port) : null,
          username: user,
          password: pass,
          group_id: selectedGroupId
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const json = await res.json();
      if (!res.ok) {
        alert(json.detail || "Camera limit exceeded");
        setProbe("fail");
        setErrors({ ip: json.detail || "Camera limit exceeded" });
        return;
      }
      if (json.success) {
        setProbe("success");
        setDetectedPort(json.port || port);
        setDiscovered({
          manufacturer: json.manufacturer,
          model: json.model,
          firmware: json.firmware,
          serial: json.serial,
          ptz: json.ptz ? "Yes" : "No",
          profiles: json.profiles || [],
          stream_count: json.stream_count ?? (json.profiles?.length || 0),
          ws_url: json.ws_url || null,
          rtsp_url: json.rtsp_url || null,
          stream_key: json.stream_key || json.ome_stream || null,
        });
      } else {
        setProbe("fail");
        setDetectedPort(null);
      }
    } catch (error) {
      setProbe("fail");
      if (error.name === "AbortError") {
        setErrors({ ip: "Probe timeout — camera may be offline or not responding" });
      } else {
        setErrors({ ip: "Failed to connect to camera" });
      }
    }
  };

  const handleDirectUrl = async () => {
    const e = validateDirectUrl();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setProbe("probing");
    setDiscovered(null);

    try {
      const res = await fetch("http://localhost:8000/api/streams/register-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rtsp_url: rtspUrl.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setProbe("success");
        setDiscovered({
          manufacturer: "Manual Entry",
          model: urlLabel || "Direct Stream",
          firmware: "N/A",
          serial: json.ip || "N/A",
          ptz: "N/A",
          profiles: [],
          stream_count: 1,
          ws_url: json.ws_url || null,
          rtsp_url: rtspUrl.trim(),
          stream_key: json.stream_key || null,
        });
      } else {
        setProbe("fail");
        setErrors({ rtspUrl: json.error || "Failed to register stream" });
      }
    } catch (err) {
      setProbe("fail");
      setErrors({ rtspUrl: err.message });
    }
  };

  const handlePasswordKeyDown = (e) => {
    if (e.key === "Enter" && probe !== "probing") {
      mode === "onvif" ? handleProbe() : handleDirectUrl();
    }
  };

  const handleEnroll = () => {
    if (mode === "onvif") {
      const enrollPort = detectedPort || port || "80";
      // ✅ FIX 3 STEP 3: Pass cameraName in onEnroll payload
      onEnroll?.({
        cameraName,
        ip,
        group_id: selectedGroupId,
        port: enrollPort,
        user,
        pass,
        discovered,
        stream_profiles: discovered?.profiles || [],
        stream_count: discovered?.stream_count ?? 0,
        ws_url: discovered?.ws_url || null,
        rtsp_url: discovered?.rtsp_url || null,
        stream_key: discovered?.stream_key || null,
      });
    } else {
      onEnroll?.({
        cameraName,
        rtspUrl,
        group_id: selectedGroupId,
        label: urlLabel,
        discovered,
        stream_profiles: discovered?.profiles || [],
        stream_count: discovered?.stream_count ?? 0,
        ws_url: discovered?.ws_url || null,
        rtsp_url: discovered?.rtsp_url || rtspUrl,
        stream_key: discovered?.stream_key || null,
      });
    }
    onClose?.();
  };

  const infoFields = ["manufacturer", "model", "firmware", "serial", "ptz"];

  return (
    <>
      <style>{css}</style>

      <div className="msm-overlay">
        <div className="msm-card">

          {/* Header */}
          <div className="msm-header">
            <div>
              <div className="msm-eyebrow">ONVIF Discovery</div>
              <h2 className="msm-title">Manual Camera Search</h2>
            </div>
            <button className="msm-close" onClick={onClose} tabIndex={9}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="msm-body">

            {/* Camera Name */}
            <div className="msm-field">
              <label className="msm-label">
                CAMERA NAME <span style={{ textTransform: "none", opacity: 0.7 }}>(OPTIONAL)</span>
              </label>
              <input
                tabIndex={1}
                className="msm-input"
                placeholder="e.g. Front Gate Camera"
                value={cameraName}
                onChange={(e) => setCameraName(e.target.value)}
              />
            </div>

            {/* Group */}
            <div className="msm-field">
              <label className="msm-label">SELECT GROUP</label>
              <div className="msm-custom-select" ref={dropdownRef}>
                <button
                  type="button"
                  tabIndex={2}
                  className="msm-select-btn"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                >
                  <span>{selectedGroupId === "default" ? "Default" : groups?.find(g => g.id === selectedGroupId)?.name || "Default"}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7a99" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: dropdownOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s" }}>
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>
                {dropdownOpen && (
                  <ul className="msm-dropdown-menu">
                    <li
                      className={`msm-dropdown-item ${selectedGroupId === "default" ? "active" : ""}`}
                      onClick={() => { setSelectedGroupId("default"); setDropdownOpen(false); }}
                    >
                      Default
                    </li>
                    {groups?.map((g) => (
                      <li
                        key={g.id}
                        className={`msm-dropdown-item ${selectedGroupId === g.id ? "active" : ""}`}
                        onClick={() => { setSelectedGroupId(g.id); setDropdownOpen(false); }}
                      >
                        {g.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* IP + Port */}
            <div className="msm-row">
              <div className="msm-field">
                <label className="msm-label">IP Address</label>
                <input
                  tabIndex={2}
                  className={`msm-input ${errors.ip ? "error" : ""}`}
                  placeholder="192.168.1.64"
                  value={ip}
                  onChange={(e) => {
                    setIp(e.target.value);
                    setErrors((s) => ({ ...s, ip: "" }));
                    setProbe("idle");
                    setDiscovered(null);
                  }}
                />
                {errors.ip && <span className="msm-error-msg">{errors.ip}</span>}
              </div>
              <div className="msm-field msm-field--port">
                <label className="msm-label">
                  Port{" "}
                </label>
                <input
                  tabIndex={3}
                  className={`msm-input ${errors.port ? "error" : ""}`}
                  placeholder="80"
                  value={port}
                  onChange={(e) => { setPort(e.target.value); setErrors((s) => ({ ...s, port: "" })); }}
                  onBlur={() => { if (!port) setPort("80"); }}
                />
                {errors.port && <span className="msm-error-msg">{errors.port}</span>}
              </div>
            </div>

            {/* Credentials */}
            <div className="msm-divider">ONVIF Credentials</div>
            <div className="msm-row">
              <div className="msm-field">
                <label className="msm-label">Username</label>
                <input
                  tabIndex={4}
                  className="msm-input"
                  placeholder="admin"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                />
              </div>
              <div className="msm-field">
                <label className="msm-label">Password</label>
                <div className="msm-password-wrapper">
                  <input
                    tabIndex={5}
                    className="msm-input msm-password-input"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                    onKeyDown={handlePasswordKeyDown}
                  />
                  <button
                    type="button"
                    className="msm-eye-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Probe status */}
            {probe === "idle" && (
              <div className="msm-probe">
                <div className="msm-probe-dot" style={{ background: "#2e3d55" }} />
                Enter IP address and port, then probe the device.
              </div>
            )}
            {probe === "probing" && (
              <div className="msm-probe probing">
                <div className="msm-spinner" />
                {`Probing ${ip}:${port} via ONVIF…`}
              </div>
            )}
            {probe === "fail" && (
              <div className="msm-probe fail">
                <div className="msm-probe-dot" />
                {errors.ip || `No ONVIF device found at ${ip}${port ? `:${port}` : ""}`}
              </div>
            )}

            {probe === "success" && discovered && (
              <>
                <div className="msm-probe success">
                  <div className="msm-probe-dot" />
                  ONVIF device discovered — {discovered.manufacturer} {discovered.model}
                  {detectedPort && !port && (
                    <span style={{ fontSize: "11px", color: "#60a5fa", marginLeft: "8px" }}>
                      on port {detectedPort}
                    </span>
                  )}
                </div>

                <div className="msm-info-grid">
                  {infoFields.map((k) => (
                    <div key={k} className="msm-info-item">
                      <span className="msm-info-key">{k}</span>
                      <span className="msm-info-val">{discovered[k]}</span>
                    </div>
                  ))}
                  <div className="msm-info-item">
                    <span className="msm-info-key">Streams available</span>
                    <span className="msm-info-val msm-info-val--highlight">
                      {discovered.stream_count}{" "}
                      {typeof discovered.stream_count === "number"
                        ? discovered.stream_count === 1 ? "stream" : "streams"
                        : ""}
                    </span>
                  </div>
                </div>

                {discovered.profiles?.length > 0 && (
                  <div className="msm-profiles">
                    <div className="msm-profiles-header">
                      Stream profiles
                      <span className="msm-profiles-badge">
                        {discovered.profiles.length} detected
                      </span>
                    </div>
                    <div className="msm-profiles-scroll">
                      {discovered.profiles.map((p, i) => (
                        <div key={i} className="msm-profile-row">
                          <div>
                            <div className="msm-profile-name">{p.name}</div>
                            <div className="msm-profile-res">{p.resolution}</div>
                          </div>
                          <div className="msm-profile-meta">{p.encoding}</div>
                          <div className="msm-profile-meta">
                            {p.fps ? `${p.fps} fps` : "—"}
                          </div>
                          <span className={`msm-profile-tag msm-profile-tag--${PROFILE_TAGS[i] ?? "extra"}`}>
                            {PROFILE_TAGS[i] ?? `Stream ${i + 1}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {discovered.profiles?.length > 0 && (
                  <div className="msm-routing-hint">
                    {getRoutingHint(discovered.profiles)}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="msm-footer">
            <button tabIndex={6} className="msm-btn msm-btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              tabIndex={7}
              className="msm-btn msm-btn--probe"
              onClick={mode === "onvif" ? handleProbe : handleDirectUrl}
              disabled={probe === "probing"}
            >
              {probe === "probing" ? "Probing…" : "Probe via ONVIF"}
            </button>
            <button
              tabIndex={8}
              className="msm-btn msm-btn--enroll"
              onClick={handleEnroll}
              disabled={probe !== "success"}
            >
              Enroll Camera
            </button>
          </div>

        </div>
      </div>
    </>
  );
}