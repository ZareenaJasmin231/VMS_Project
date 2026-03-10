import { useState } from "react";

/* ─── tiny design tokens (match your existing dark VMS palette) ─── */
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
    box-shadow: 0 32px 80px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.03);
    animation: slideUp .22s cubic-bezier(.22,1,.36,1);
    overflow: hidden;
  }
  @keyframes slideUp { from { transform:translateY(24px); opacity:0 } to { transform:translateY(0); opacity:1 } }

  .msm-header {
    padding: 22px 24px 18px;
    border-bottom: 1px solid #1e2a3a;
    display: flex; align-items: flex-start; justify-content: space-between;
  }
  .msm-title-block {}
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
    color: #4a5568; padding: 2px;
    transition: color .15s;
  }
  .msm-close:hover { color: #e8edf5; }

  .msm-body { padding: 24px; display: flex; flex-direction: column; gap: 16px; }

  /* IP + Port row */
  .msm-row { display: flex; gap: 12px; }
  .msm-field { display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .msm-field--port { flex: 0 0 110px; }

  .msm-label {
    font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
    color: #6b7a99; font-weight: 500;
  }
  .msm-input {
    background: #080c12;
    border: 1px solid #1e2a3a;
    border-radius: 8px;
    color: #c9d4e8;
    font-family: 'DM Mono', monospace;
    font-size: 13px;
    padding: 10px 13px;
    outline: none;
    transition: border-color .15s, box-shadow .15s;
    width: 100%;
    box-sizing: border-box;
  }
  .msm-input::placeholder { color: #2e3d55; }
  .msm-input:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37,99,235,.18);
  }
  .msm-input.error { border-color: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,.15); }

  /* protocol tabs */
  .msm-proto-row { display: flex; gap: 8px; }
  .msm-proto-btn {
    flex: 1; padding: 7px 0; border-radius: 7px; font-size: 12px;
    font-family: 'DM Mono', monospace; font-weight: 500; cursor: pointer;
    border: 1px solid #1e2a3a; background: #080c12; color: #4a5568;
    transition: all .15s;
  }
  .msm-proto-btn.active {
    background: #0f1f3d; border-color: #2563eb; color: #3b82f6;
  }

  /* divider */
  .msm-divider {
    display: flex; align-items: center; gap: 10px; color: #2e3d55; font-size: 11px;
  }
  .msm-divider::before, .msm-divider::after {
    content: ''; flex: 1; height: 1px; background: #1e2a3a;
  }

  /* onvif probe status */
  .msm-probe {
    background: #080c12; border: 1px solid #1e2a3a;
    border-radius: 8px; padding: 12px 14px;
    display: flex; align-items: center; gap: 10px;
    font-size: 12px; color: #4a5568;
    min-height: 44px;
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

  .msm-probe-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    background: currentColor;
  }

  /* discovered info grid */
  .msm-info-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
    background: #080c12; border: 1px solid #14532d;
    border-radius: 8px; padding: 12px 14px;
  }
  .msm-info-item { display: flex; flex-direction: column; gap: 2px; }
  .msm-info-key { font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: #4a5568; }
  .msm-info-val { font-size: 12px; color: #c9d4e8; }

  /* footer */
  .msm-footer {
    padding: 16px 24px 20px;
    border-top: 1px solid #1e2a3a;
    display: flex; justify-content: flex-end; gap: 10px;
  }
  .msm-btn {
    font-family: 'DM Mono', monospace; font-size: 12px; font-weight: 500;
    padding: 9px 18px; border-radius: 8px; cursor: pointer;
    border: 1px solid transparent; transition: all .15s;
  }
  .msm-btn--ghost {
    background: transparent; border-color: #1e2a3a; color: #6b7a99;
  }
  .msm-btn--ghost:hover { border-color: #2e3d55; color: #c9d4e8; }
  .msm-btn--probe {
    background: #0f1f3d; border-color: #2563eb; color: #3b82f6;
  }
  .msm-btn--probe:hover:not(:disabled) { background: #1a3260; }
  .msm-btn--enroll {
    background: #1d4ed8; border-color: #1d4ed8; color: #fff;
  }
  .msm-btn--enroll:hover:not(:disabled) { background: #2563eb; }
  .msm-btn:disabled { opacity: .35; cursor: not-allowed; }

  .msm-error-msg { font-size: 11px; color: #f87171; margin-top: -8px; }
`;

const ONVIF_MOCK = {
  manufacturer: "Hikvision",
  model: "DS-2CD2143G2-I",
  firmware: "V5.7.15",
  serial: "DS-2CD2143G2-220817",
  streams: "RTSP / H.264+H.265",
  ptz: "No",
};

function validateIP(ip) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
    ip.split(".").every((n) => +n >= 0 && +n <= 255);
}

export default function ManualSearchModal({ onClose, onEnroll }) {
  const [ip, setIp]         = useState("");
  const [port, setPort]     = useState("80");
  const [proto, setProto]   = useState("http");
  const [user, setUser]     = useState("");
  const [pass, setPass]     = useState("");
  const [probe, setProbe]   = useState("idle"); // idle | probing | success | fail
  const [discovered, setDiscovered] = useState(null);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const e = {};
    if (!ip) e.ip = "IP address is required";
    else if (!validateIP(ip)) e.ip = "Invalid IP address";
    if (!port || isNaN(port) || +port < 1 || +port > 65535) e.port = "1–65535";
    return e;
  };

const handleProbe = async () => {
  const e = validate();
  if (Object.keys(e).length) { setErrors(e); return; }
  setErrors({});
  setProbe("probing");
  setDiscovered(null);

  try {
    const res = await fetch("http://localhost:8000/api/onvif/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, port: Number(port), username: user, password: pass }),
    });

    const json = await res.json();

    if (json.success) {
      setProbe("success");
      setDiscovered({
        manufacturer: json.manufacturer,
        model:        json.model,
        firmware:     json.firmware,
        serial:       json.serial,
        streams:      json.stream_uri,
        ptz:          json.ptz,
      });
    } else {
      setProbe("fail");
    }
  } catch {
    setProbe("fail");
  }
};



  const handleEnroll = () => {
    onEnroll?.({ ip, port, proto, user, discovered });
    onClose?.();
  };

  return (
    <>
      <style>{css}</style>
      <div className="msm-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
        <div className="msm-card">

          {/* Header */}
          <div className="msm-header">
            <div className="msm-title-block">
              <div className="msm-eyebrow">ONVIF Discovery</div>
              <h2 className="msm-title">Manual Camera Search</h2>
            </div>
            <button className="msm-close" onClick={onClose}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="msm-body">

            {/* Protocol */}
            <div className="msm-field">
              <span className="msm-label">Protocol</span>
              <div className="msm-proto-row">
                {["http", "https", "rtsp"].map((p) => (
                  <button key={p} className={`msm-proto-btn ${proto === p ? "active" : ""}`}
                    onClick={() => { setProto(p); setPort(p === "rtsp" ? "554" : p === "https" ? "443" : "80"); }}>
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* IP + Port */}
            <div className="msm-row">
              <div className="msm-field">
                <label className="msm-label">IP Address</label>
                <input className={`msm-input ${errors.ip ? "error" : ""}`}
                  placeholder="192.168.1.64" value={ip}
                  onChange={(e) => { setIp(e.target.value); setErrors((s) => ({ ...s, ip: "" })); setProbe("idle"); setDiscovered(null); }}
                />
                {errors.ip && <span className="msm-error-msg">{errors.ip}</span>}
              </div>
              <div className="msm-field msm-field--port">
                <label className="msm-label">Port</label>
                <input className={`msm-input ${errors.port ? "error" : ""}`}
                  placeholder="80" value={port}
                  onChange={(e) => { setPort(e.target.value); setErrors((s) => ({ ...s, port: "" })); }}
                />
                {errors.port && <span className="msm-error-msg">{errors.port}</span>}
              </div>
            </div>

            {/* Credentials */}
            <div className="msm-divider">ONVIF Credentials</div>
            <div className="msm-row">
              <div className="msm-field">
                <label className="msm-label">Username</label>
                <input className="msm-input" placeholder="admin" value={user}
                  onChange={(e) => setUser(e.target.value)} />
              </div>
              <div className="msm-field">
                <label className="msm-label">Password</label>
                <input className="msm-input" type="password" placeholder="••••••••" value={pass}
                  onChange={(e) => setPass(e.target.value)} />
              </div>
            </div>

            {/* Probe status */}
            {probe === "idle" && (
              <div className="msm-probe">
                <div className="msm-probe-dot" style={{ background: "#2e3d55" }} />
                Enter IP, port and credentials, then probe the device.
              </div>
            )}
            {probe === "probing" && (
              <div className="msm-probe probing">
                <div className="msm-spinner" />
                Probing {ip}:{port} via ONVIF WS-Discovery…
              </div>
            )}
            {probe === "fail" && (
              <div className="msm-probe fail">
                <div className="msm-probe-dot" />
                No ONVIF device found at {ip}:{port}. Check IP, port, or credentials.
              </div>
            )}
            {probe === "success" && discovered && (
              <>
                <div className="msm-probe success">
                  <div className="msm-probe-dot" />
                  ONVIF device discovered — {discovered.manufacturer} {discovered.model}
                </div>
                <div className="msm-info-grid">
                  {Object.entries(discovered).map(([k, v]) => (
                    <div key={k} className="msm-info-item">
                      <span className="msm-info-key">{k}</span>
                      <span className="msm-info-val">{v}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="msm-footer">
            <button className="msm-btn msm-btn--ghost" onClick={onClose}>Cancel</button>
            <button className="msm-btn msm-btn--probe" onClick={handleProbe}
              disabled={probe === "probing"}>
              {probe === "probing" ? "Probing…" : "Probe via ONVIF"}
            </button>
            <button className="msm-btn msm-btn--enroll" onClick={handleEnroll}
              disabled={probe !== "success"}>
              Enroll Camera
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
