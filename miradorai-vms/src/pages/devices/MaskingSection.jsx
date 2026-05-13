/**
 * MaskingSection.jsx
 *
 * Drop-in masking panel for CameraFeaturesPage.jsx
 *
 * HOW TO INTEGRATE:
 * 1. Copy the CSS block into the CSS const in CameraFeaturesPage.jsx
 * 2. Import / paste MaskingSection component
 * 3. Add nav item to NAV_SECTIONS (see comment below)
 * 4. Add case "masking": return <MaskingSection {...props} />; in renderContent()
 *
 * NAV item to add inside the "Intelligence" section items array:
 *   { id: "masking", label: "Privacy Masks", icon: "▣", capKey: null },
 *
 * Backend: use masks_router.py (provided separately)
 */

// ── MASKING CSS — append to your existing CSS const ───────────────
export const MASKING_CSS = `
/* ── Masking container ── */
.cfp-mask-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-top: 16px;
  box-shadow: var(--shadow-sm);
}

/* ── Masking canvas ── */
.cfp-mask-wrap {
  position: relative;
  background: #000;
  overflow: hidden;
  user-select: none;
  touch-action: none;
  aspect-ratio: 16 / 9;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cfp-mask-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}
.cfp-mask-canvas.dragging { cursor: grabbing; }
.cfp-mask-canvas.move-mode { cursor: grab; }

/* ── Toolbar ── */
.cfp-mask-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.cfp-mask-tool-group {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-surface);
  padding: 4px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
}

.cfp-mask-tool-btn {
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 500;
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  transition: var(--transition);
  display: flex;
  align-items: center;
  gap: 6px;
}

.cfp-mask-tool-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.cfp-mask-tool-btn.active {
  background: var(--bg-active);
  color: var(--teal);
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.cfp-mask-tool-btn.danger { color: var(--red); }
.cfp-mask-tool-btn.danger:hover { background: rgba(255,77,106,0.1); }

.cfp-mask-tool-btn.success {
  background: var(--teal);
  color: white;
}
.cfp-mask-tool-btn.success:hover { background: var(--teal-dim); }
.cfp-mask-tool-btn.success:disabled { opacity: 0.5; cursor: not-allowed; }

.cfp-mask-sep { width: 1px; height: 16px; background: var(--border); margin: 0 4px; }

.cfp-mask-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
  font-style: italic;
}

/* ── List ── */
.cfp-mask-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 24px 0 12px;
  padding: 0 4px;
}

.cfp-mask-list-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.cfp-mask-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.cfp-mask-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: var(--transition);
  cursor: pointer;
  position: relative;
}

.cfp-mask-item:hover {
  border-color: var(--border-light);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.cfp-mask-item.selected {
  border-color: var(--teal);
  background: var(--bg-elevated);
}

.cfp-mask-item-color {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 2px solid rgba(255,255,255,0.1);
}

.cfp-mask-item-info {
  flex: 1;
  min-width: 0;
}

.cfp-mask-item-name-input {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  width: 100%;
  padding: 2px 0;
  outline: none;
}

.cfp-mask-item-name-input:focus {
  color: var(--teal);
}

.cfp-mask-item-meta {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 2px;
}

.cfp-mask-item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cfp-mask-item-del {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: var(--transition);
}

.cfp-mask-item-del:hover {
  background: rgba(255,77,106,0.1);
  color: var(--red);
  border-color: rgba(255,77,106,0.2);
}

/* ── Instructions ── */
.cfp-mask-info-card {
  background: var(--teal-subtle);
  border: 1px solid var(--teal-dim);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  margin-top: 24px;
}

.cfp-mask-info-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--teal);
  margin-bottom: 8px;
}

.cfp-mask-info-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cfp-mask-info-item {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  display: flex;
  gap: 8px;
}

.cfp-mask-info-num {
  font-weight: 700;
  color: var(--teal);
  opacity: 0.6;
}

.cfp-mask-saving {
  position: absolute;
  top: 16px;
  right: 16px;
  background: var(--bg-surface);
  border: 1px solid var(--teal);
  color: var(--teal);
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  animation: slideInRight 0.3s ease;
}

@keyframes slideInRight {
  from { transform: translateX(20px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.cfp-mask-wrap video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
`;
import { useState, useEffect, useRef, useCallback } from "react";
import WebRTCPlayer from "../../components/shared/WebRTCPlayer";

const API = import.meta.env.VITE_API_URL;
const CANVAS_W = 640;
const CANVAS_H = 360;

// ── MASK COLORS ───────────────────────────────────────────────────
const MASK_COLORS = [
  { fill: "rgba(59,130,246,0.3)",  stroke: "#60a5fa", label: "Deep Sea" },
  { fill: "rgba(239,68,68,0.3)",   stroke: "#f87171", label: "Critical" },
  { fill: "rgba(16,185,129,0.3)",  stroke: "#34d399", label: "Standard" },
  { fill: "rgba(245,158,11,0.3)",  stroke: "#fbbf24", label: "Caution"  },
  { fill: "rgba(139,92,246,0.3)",  stroke: "#a78bfa", label: "Mystic"   },
  { fill: "rgba(249,115,22,0.3)",  stroke: "#fb923c", label: "Warning"  },
];

export default function MaskingSection({ device, showToast }) {
  const canvasRef = useRef(null);
  const dragRef = useRef({ active: false, maskId: null, ptIdx: null });
  const wsUrl = device?.ws_url || null;

  const [masks, setMasks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState("draw"); // "draw" | "select"
  const [draftPts, setDraftPts] = useState([]);
  const [colorIdx, setColorIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load masks
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/masks/${encodeURIComponent(device.ip)}`);
        const data = await res.json();
        setMasks(data.masks || []);
      } catch (e) {
        console.error("[MASKS] Load failed:", e);
      }
      setLoading(false);
    })();
  }, [device.ip]);

  // Redraw
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // No background here — WebRTCPlayer is underneath
    // But we still draw diagnostic overlays if needed
    
    // Technical Corner Brackets (Subtle)
    const B = 18, T = 1.5, C = "rgba(255,255,255,0.2)";
    ctx.strokeStyle = C; ctx.lineWidth = T;
    // TL
    ctx.beginPath(); ctx.moveTo(10, 10+B); ctx.lineTo(10, 10); ctx.lineTo(10+B, 10); ctx.stroke();
    // TR
    ctx.beginPath(); ctx.moveTo(CANVAS_W-10-B, 10); ctx.lineTo(CANVAS_W-10, 10); ctx.lineTo(CANVAS_W-10, 10+B); ctx.stroke();
    // BL
    ctx.beginPath(); ctx.moveTo(10, CANVAS_H-10-B); ctx.lineTo(10, CANVAS_H-10); ctx.lineTo(10+B, CANVAS_H-10); ctx.stroke();
    // BR
    ctx.beginPath(); ctx.moveTo(CANVAS_W-10-B, CANVAS_H-10); ctx.lineTo(CANVAS_W-10, CANVAS_H-10); ctx.lineTo(CANVAS_W-10, CANVAS_H-10-B); ctx.stroke();

    // Center Crosshair (Very subtle)
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CANVAS_W/2 - 10, CANVAS_H/2); ctx.lineTo(CANVAS_W/2 + 10, CANVAS_H/2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(CANVAS_W/2, CANVAS_H/2 - 10); ctx.lineTo(CANVAS_W/2, CANVAS_H/2 + 10); ctx.stroke();

    // Draw saved masks
    masks.forEach(mask => {
      if (!mask.points?.length) return;
      const col = MASK_COLORS[mask.color_idx ?? 0];
      const isSel = mask.id === selectedId;

      ctx.beginPath();
      mask.points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
      ctx.closePath();

      if (!mask.enabled) {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fill();
        // Hatching
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = 1;
        for (let i = -CANVAS_H; i < CANVAS_W + CANVAS_H; i += 15) {
          ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + CANVAS_H, CANVAS_H); ctx.stroke();
        }
        ctx.restore();
        ctx.beginPath();
        mask.points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
        ctx.closePath();
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = col.fill;
        ctx.fill();
        ctx.strokeStyle = isSel ? "#fff" : col.stroke;
        ctx.lineWidth = isSel ? 2.5 : 1.5;
        ctx.stroke();
      }

      // Mask label
      const cx = mask.points.reduce((s, [x]) => s + x, 0) / mask.points.length;
      const cy = mask.points.reduce((s, [, y]) => s + y, 0) / mask.points.length;
      ctx.fillStyle = isSel ? "#fff" : "rgba(255,255,255,0.8)";
      ctx.font = `${isSel ? "600" : "500"} 10px 'DM Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(mask.name.toUpperCase(), cx, cy);

      // Vertex dots
      if (isSel && mode === "select") {
        mask.points.forEach(([x, y]) => {
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fillStyle = col.stroke;
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
      }
    });

    // Draw draft polygon
    if (draftPts.length > 0) {
      const col = MASK_COLORS[colorIdx];
      ctx.beginPath();
      draftPts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
      ctx.strokeStyle = col.stroke;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      draftPts.forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(x, y, i === 0 ? 7 : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? col.stroke : col.fill;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }
  }, [masks, selectedId, draftPts, colorIdx, mode]);

  useEffect(() => { redraw(); }, [redraw]);

  const getXY = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const sx = CANVAS_W / r.width, sy = CANVAS_H / r.height;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return [Math.round((cx - r.left) * sx), Math.round((cy - r.top) * sy)];
  };

  const handlePointerDown = (e) => {
    const [x, y] = getXY(e);
    if (mode === "select") {
      const mask = masks.find(m => m.id === selectedId);
      if (mask) {
        const pi = mask.points.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 10);
        if (pi !== -1) { dragRef.current = { active: true, maskId: selectedId, ptIdx: pi }; return; }
      }
      const hit = [...masks].reverse().find(m => pip([x, y], m.points));
      setSelectedId(hit?.id || null);
      return;
    }
    if (mode === "draw") {
      if (draftPts.length >= 3) {
        const [fx, fy] = draftPts[0];
        if (Math.hypot(fx - x, fy - y) < 14) { finalizeMask(); return; }
      }
      setDraftPts(p => [...p, [x, y]]);
    }
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current.active) return;
    const [x, y] = getXY(e);
    const { maskId, ptIdx } = dragRef.current;
    setMasks(prev => prev.map(m =>
      m.id === maskId ? { ...m, points: m.points.map((p, i) => i === ptIdx ? [x, y] : p) } : m
    ));
  };

  const handlePointerUp = async () => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    const mask = masks.find(m => m.id === dragRef.current.maskId);
    if (mask) await saveMask(mask);
  };

  const finalizeMask = async () => {
    if (draftPts.length < 3) { showToast("Need at least 3 points", "error"); setDraftPts([]); return; }
    const m = { id: `mask_${Date.now()}`, name: `Region ${masks.length + 1}`, points: draftPts, color_idx: colorIdx, enabled: true };
    setDraftPts([]);
    setMasks(p => [...p, m]);
    setSelectedId(m.id);
    await saveMask(m);
    showToast(`"${m.name}" created`, "success");
    setColorIdx(c => (c + 1) % MASK_COLORS.length);
  };

  const saveMask = async (mask) => {
    setSaving(true);
    try {
      await fetch(`${API}/api/masks/${encodeURIComponent(device.ip)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mask }),
      });
    } catch (e) { showToast("Save failed", "error"); }
    setSaving(false);
  };

  const deleteMask = async (id) => {
    setMasks(p => p.filter(m => m.id !== id));
    if (selectedId === id) setSelectedId(null);
    try {
      await fetch(`${API}/api/masks/${encodeURIComponent(device.ip)}/${id}`, { method: "DELETE" });
      showToast("Region deleted", "success");
    } catch { showToast("Delete failed", "error"); }
  };

  const toggleMask = async (id) => {
    const updated = masks.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m);
    setMasks(updated);
    await saveMask(updated.find(m => m.id === id));
  };

  const renameMask = (id, name) => setMasks(p => p.map(m => m.id === id ? { ...m, name } : m));
  const commitRename = async (id) => { const m = masks.find(m => m.id === id); if (m) await saveMask(m); };

  const saveAll = async () => {
    setSaving(true);
    try {
      await fetch(`${API}/api/masks/${encodeURIComponent(device.ip)}/all`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masks }),
      });
      showToast("All regions synchronized", "success");
    } catch { showToast("Save failed", "error"); }
    setSaving(false);
  };

  function pip([px, py], pts = []) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  const enabledCount = masks.filter(m => m.enabled).length;
  const totalVertices = masks.reduce((s, m) => s + (m.points?.length || 0), 0);

  return (
    <>
      <div className="mp-mask-card">
        {/* Toolbar */}
        <div className="mp-toolbar">
          <div className="mp-tool-group">
            <button
              className={`mp-tool-btn ${mode === "draw" ? "active" : ""}`}
              onClick={() => { setMode("draw"); setSelectedId(null); }}
            >
              Draw
            </button>
            <button
              className={`mp-tool-btn ${mode === "select" ? "active" : ""}`}
              onClick={() => { setMode("select"); setDraftPts([]); }}
            >
              Select
            </button>
          </div>

          <div className="mp-sep" />

          {/* Color Picker */}
          <div className="mp-tool-group mp-colors">
            {MASK_COLORS.map((c, i) => (
              <button
                key={i}
                className={`mp-color-dot ${colorIdx === i ? "active" : ""}`}
                style={{ background: c.stroke }}
                onClick={() => setColorIdx(i)}
                title={c.label}
              />
            ))}
          </div>

          <div className="mp-sep" />

          {/* Draft Actions */}
          {draftPts.length > 0 && (
            <div className="mp-tool-group">
              <button
                className="mp-tool-btn success"
                onClick={finalizeMask}
                disabled={draftPts.length < 3}
              >
                Close Polygon ({draftPts.length})
              </button>
              <button className="mp-tool-btn" onClick={() => setDraftPts(p => p.slice(0, -1))}>
                Undo
              </button>
              <button className="mp-tool-btn danger" onClick={() => setDraftPts([])}>
                Cancel
              </button>
            </div>
          )}

          {masks.length > 0 && draftPts.length === 0 && (
            <button className="mp-tool-btn success" onClick={saveAll}>
              Save All
            </button>
          )}

          <div className="mp-toolbar-hint">
            {mode === "draw"
              ? draftPts.length === 0
                ? "Click canvas to start drawing"
                : `${draftPts.length} points · Click 1st point to close`
              : "Drag vertices to reshape masks"}
          </div>
        </div>

        {/* Viewport (Video + Canvas) */}
        <div className="mp-viewport">
          {/* LIVE STREAM */}
          <div className="mp-video-layer">
            {wsUrl ? (
              <WebRTCPlayer serverUrl={wsUrl} cameraId={device.id} />
            ) : (
              <div className="mp-video-placeholder">
                <div className="mp-placeholder-icon"></div>
                <div>Live stream unavailable</div>
                <div className="mp-placeholder-sub">Snapshot fallback disabled</div>
              </div>
            )}
          </div>

          {/* MASK CANVAS */}
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="mp-canvas"
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
          />

          {/* Corner Labels */}
          <div className="mp-corner-label tl">A1</div>
          <div className="mp-corner-label tr">{CANVAS_W}×{CANVAS_H}</div>
          <div className="mp-corner-label bl">MASK EDITOR</div>
          <div className="mp-corner-label br">{device.ip}</div>

          {saving && <div className="mp-syncing">Synchronizing…</div>}
        </div>

        {/* Stats Strip */}
        <div className="mp-stats">
          <div className="mp-stat">
            <span className="mp-stat-label">Total Regions</span>
            <span className="mp-stat-val teal">{masks.length}</span>
          </div>
          <div className="mp-stat">
            <span className="mp-stat-label">Active</span>
            <span className="mp-stat-val">{enabledCount}</span>
          </div>
          <div className="mp-stat">
            <span className="mp-stat-label">Inactive</span>
            <span className="mp-stat-val">{masks.length - enabledCount}</span>
          </div>
          <div className="mp-stat">
            <span className="mp-stat-label">Total Vertices</span>
            <span className="mp-stat-val">{totalVertices}</span>
          </div>
          <div className="mp-stat">
            <span className="mp-stat-label">Mode</span>
            <span className="mp-stat-val" style={{ textTransform: "uppercase", fontSize: 11 }}>{mode}</span>
          </div>
        </div>
      </div>

      {/* Regions List */}
      <div className="mp-list-head">
        <h3 className="mp-list-title">Defined Regions ({masks.length})</h3>
        {selectedId && (
          <button className="mp-tool-btn danger" style={{ height: 26, fontSize: 11 }} onClick={() => deleteMask(selectedId)}>
            Delete Selected
          </button>
        )}
      </div>

      {loading ? (
        <div className="mp-list-loading">Fetching registry data…</div>
      ) : masks.length === 0 ? (
        <div className="mp-list-empty">
          No regions defined yet.
          <span>Switch to Draw mode to begin.</span>
        </div>
      ) : (
        <div className="mp-list-grid">
          {masks.map(mask => {
            const col = MASK_COLORS[mask.color_idx ?? 0];
            return (
              <div
                key={mask.id}
                className={`mp-region-card ${selectedId === mask.id ? "selected" : ""}`}
                onClick={() => setSelectedId(mask.id)}
              >
                <div className="mp-card-top">
                  <div className="mp-card-swatch" style={{ background: col.stroke }} />
                  <input
                    className="mp-card-input"
                    value={mask.name}
                    onChange={e => renameMask(mask.id, e.target.value)}
                    onBlur={() => commitRename(mask.id)}
                    onClick={e => e.stopPropagation()}
                  />
                  <label className="mp-switch" onClick={e => e.stopPropagation()}>
                    <input 
                      type="checkbox" 
                      checked={!!mask.enabled} 
                      onChange={() => toggleMask(mask.id)} 
                    />
                    <span className="mp-switch-slider" />
                  </label>
                </div>
                <div className="mp-card-meta">
                  <span>{mask.points?.length} vertices · {mask.enabled ? "Active" : "Disabled"}</span>
                  <button className="mp-card-del" onClick={e => { e.stopPropagation(); deleteMask(mask.id); }}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </>
  );
}
