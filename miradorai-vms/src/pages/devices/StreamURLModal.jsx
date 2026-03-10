import { useState } from "react";

const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap');

  .sum-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(6,8,14,0.82);
    backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    animation: sumFadeIn .18s ease;
  }
  @keyframes sumFadeIn { from { opacity:0 } to { opacity:1 } }

  .sum-card {
    font-family: 'DM Mono', monospace;
    background: #0d1117;
    border: 1px solid #1e2a3a;
    border-radius: 14px;
    width: 500px;
    box-shadow: 0 32px 80px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.03);
    animation: sumSlideUp .22s cubic-bezier(.22,1,.36,1);
    overflow: hidden;
  }
  @keyframes sumSlideUp { from { transform:translateY(24px); opacity:0 } to { transform:translateY(0); opacity:1 } }

  .sum-header {
    padding: 22px 24px 18px;
    border-bottom: 1px solid #1e2a3a;
    display: flex; align-items: flex-start; justify-content: space-between;
  }
  .sum-eyebrow {
    font-size: 10px; letter-spacing: .14em; text-transform: uppercase;
    color: #3b82f6; font-weight: 500; margin-bottom: 4px;
  }
  .sum-title {
    font-family: 'Syne', sans-serif;
    font-size: 18px; font-weight: 700; color: #e8edf5; margin: 0;
  }
  .sum-close {
    background: none; border: none; cursor: pointer;
    color: #4a5568; padding: 2px; transition: color .15s;
  }
  .sum-close:hover { color: #e8edf5; }

  .sum-body { padding: 24px; display: flex; flex-direction: column; gap: 16px; }

  .sum-desc {
    font-size: 12px; color: #4a5568; line-height: 1.6;
    background: #080c12; border: 1px solid #1e2a3a;
    border-radius: 8px; padding: 12px 14px;
    display: flex; gap: 10px; align-items: flex-start;
  }
  .sum-desc svg { flex-shrink: 0; margin-top: 1px; color: #3b82f6; }

  .sum-field { display: flex; flex-direction: column; gap: 6px; }
  .sum-label {
    font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
    color: #6b7a99; font-weight: 500;
  }
  .sum-input {
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
  .sum-input::placeholder { color: #2e3d55; }
  .sum-input:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37,99,235,.18);
  }
  .sum-input.error { border-color: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,.15); }
  .sum-error-msg { font-size: 11px; color: #f87171; }

  /* URL list */
  .sum-url-list { display: flex; flex-direction: column; gap: 8px; }
  .sum-url-item {
    display: flex; align-items: center; gap: 8px;
    background: #080c12; border: 1px solid #1e2a3a;
    border-radius: 8px; padding: 10px 12px;
  }
  .sum-url-text {
    flex: 1; font-size: 12px; color: #c9d4e8;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .sum-url-remove {
    background: none; border: none; cursor: pointer;
    color: #4a5568; padding: 2px; transition: color .15s; flex-shrink: 0;
  }
  .sum-url-remove:hover { color: #f87171; }

  /* add row */
  .sum-add-row { display: flex; gap: 8px; }
  .sum-add-row .sum-input { flex: 1; }

  .sum-btn-add {
    font-family: 'DM Mono', monospace; font-size: 12px; font-weight: 500;
    padding: 10px 16px; border-radius: 8px; cursor: pointer;
    border: 1px solid #2563eb; background: #0f1f3d; color: #3b82f6;
    white-space: nowrap; transition: all .15s; flex-shrink: 0;
  }
  .sum-btn-add:hover { background: #1a3260; }

  /* footer */
  .sum-footer {
    padding: 16px 24px 20px;
    border-top: 1px solid #1e2a3a;
    display: flex; justify-content: flex-end; gap: 10px;
  }
  .sum-btn {
    font-family: 'DM Mono', monospace; font-size: 12px; font-weight: 500;
    padding: 9px 18px; border-radius: 8px; cursor: pointer;
    border: 1px solid transparent; transition: all .15s;
  }
  .sum-btn--ghost {
    background: transparent; border-color: #1e2a3a; color: #6b7a99;
  }
  .sum-btn--ghost:hover { border-color: #2e3d55; color: #c9d4e8; }
  .sum-btn--primary {
    background: #1d4ed8; border-color: #1d4ed8; color: #fff;
  }
  .sum-btn--primary:hover:not(:disabled) { background: #2563eb; }
  .sum-btn:disabled { opacity: .35; cursor: not-allowed; }
`;

function validateURL(url) {
  return /^(rtsp|rtsps|http|https):\/\/.+/.test(url.trim());
}

export default function StreamURLModal({ onClose, onAdd }) {
  const [input, setInput]   = useState("");
  const [urls, setUrls]     = useState([]);
  const [error, setError]   = useState("");

  const handleAdd = () => {
    if (!input.trim()) { setError("Please enter a stream URL"); return; }
    if (!validateURL(input)) { setError("URL must start with rtsp://, rtsps://, http://, or https://"); return; }
    if (urls.includes(input.trim())) { setError("This URL is already added"); return; }
    setUrls((s) => [...s, input.trim()]);
    setInput("");
    setError("");
  };

  const handleRemove = (url) => setUrls((s) => s.filter((u) => u !== url));

  const handleKeyDown = (e) => { if (e.key === "Enter") handleAdd(); };

  const handleSubmit = () => {
    if (urls.length === 0) { setError("Add at least one stream URL"); return; }
    onAdd?.(urls);
    onClose?.();
  };

  return (
    <>
      <style>{css}</style>
      <div className="sum-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
        <div className="sum-card">

          {/* Header */}
          <div className="sum-header">
            <div>
              <div className="sum-eyebrow">Stream Ingestion</div>
              <h2 className="sum-title">Enter Stream URLs</h2>
            </div>
            <button className="sum-close" onClick={onClose}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="sum-body">

            {/* Info */}
            <div className="sum-desc">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 8h.01M12 12v4"/>
              </svg>
              Enter one or more stream URLs (RTSP, RTSPS, HTTP, HTTPS). Press Enter or click Add after each URL.
            </div>

            {/* Input + Add */}
            <div className="sum-field">
              <label className="sum-label">Stream URL</label>
              <div className="sum-add-row">
                <input
                  className={`sum-input ${error ? "error" : ""}`}
                  placeholder="rtsp://192.168.1.64:554/stream1"
                  value={input}
                  onChange={(e) => { setInput(e.target.value); setError(""); }}
                  onKeyDown={handleKeyDown}
                />
                <button className="sum-btn-add" onClick={handleAdd}>+ Add</button>
              </div>
              {error && <span className="sum-error-msg">{error}</span>}
            </div>

            {/* URL list */}
            {urls.length > 0 && (
              <div className="sum-field">
                <label className="sum-label">{urls.length} URL{urls.length > 1 ? "s" : ""} added</label>
                <div className="sum-url-list">
                  {urls.map((url) => (
                    <div key={url} className="sum-url-item">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                      </svg>
                      <span className="sum-url-text">{url}</span>
                      <button className="sum-url-remove" onClick={() => handleRemove(url)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="sum-footer">
            <button className="sum-btn sum-btn--ghost" onClick={onClose}>Cancel</button>
            <button className="sum-btn sum-btn--primary" onClick={handleSubmit} disabled={urls.length === 0}>
              Add {urls.length > 0 ? `${urls.length} ` : ""}Stream{urls.length > 1 ? "s" : ""}
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
