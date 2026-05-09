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
/* ── Masking canvas ── */
.cfp-mask-wrap {
  position: relative;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  user-select: none;
  touch-action: none;
}
.cfp-mask-canvas {
  display: block;
  width: 100%;
  cursor: crosshair;
}
.cfp-mask-canvas.dragging { cursor: grabbing; }
.cfp-mask-canvas.move-mode { cursor: grab; }

.cfp-mask-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.cfp-mask-tool-btn {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  transition: var(--transition);
}
.cfp-mask-tool-btn:hover { border-color: var(--teal-dim); color: var(--text-primary); }
.cfp-mask-tool-btn.active { border-color: var(--teal); background: var(--teal-subtle); color: var(--teal); }
.cfp-mask-tool-btn.danger { border-color: var(--red); background: rgba(255,77,106,0.1); color: var(--red); }
.cfp-mask-tool-btn.danger:hover { background: rgba(255,77,106,0.15); }
.cfp-mask-tool-btn.success { border-color: var(--teal); background: var(--teal-subtle); color: var(--teal); }
.cfp-mask-tool-btn.success:hover { background: var(--teal-glow); }
.cfp-mask-tool-btn:disabled { opacity: .35; cursor: not-allowed; }

.cfp-mask-sep { width: 1px; height: 20px; background: var(--border); }

.cfp-mask-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
}

.cfp-mask-list { margin-top: 16px; display: flex; flex-direction: column; gap: 8px; }
.cfp-mask-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: var(--transition);
}
.cfp-mask-item:hover { border-color: var(--border-light); background: var(--bg-hover); }
.cfp-mask-item.selected { border-color: var(--teal); background: var(--teal-subtle); color: var(--text-primary); }
.cfp-mask-item-color {
  width: 14px; height: 14px;
  border-radius: 3px;
  flex-shrink: 0;
  border: 1px solid var(--border-light);
}
.cfp-mask-item-name { flex: 1; color: var(--text-primary); }
.cfp-mask-item-pts { font-size: 10px; color: var(--text-muted); }
.cfp-mask-item-del {
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 4px; border: 1px solid transparent;
  cursor: pointer; color: var(--text-muted); font-size: 14px;
  transition: var(--transition); background: none;
}
.cfp-mask-item-del:hover { border-color: var(--red); color: var(--red); background: rgba(255,77,106,0.1); }

.cfp-mask-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
  padding: 32px 0;
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  margin-top: 16px;
}

.cfp-mask-saving {
  position: absolute;
  top: 12px; right: 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--teal-dim);
  border-radius: 6px;
  color: var(--teal);
  font-size: 11px;
  padding: 4px 12px;
  box-shadow: var(--shadow-sm);
}
`;

// ── MASK COLORS ───────────────────────────────────────────────────
const MASK_COLORS = [
  { fill: "rgba(37,99,235,0.45)",  stroke: "#2563eb", label: "Blue"   },
  { fill: "rgba(220,38,38,0.45)",  stroke: "#dc2626", label: "Red"    },
  { fill: "rgba(34,197,94,0.45)",  stroke: "#22c55e", label: "Green"  },
  { fill: "rgba(234,179,8,0.45)",  stroke: "#eab308", label: "Yellow" },
  { fill: "rgba(168,85,247,0.45)", stroke: "#a855f7", label: "Purple" },
  { fill: "rgba(249,115,22,0.45)", stroke: "#f97316", label: "Orange" },
];

// ── MAIN COMPONENT ────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";

const API = "http://192.168.126.200:8000";

export default function MaskingSection({ device, showToast }) {
  const canvasRef    = useRef(null);
  const streamImgRef = useRef(null); // snapshot background

  // Masks saved in backend: [{ id, name, points: [[x,y],...], color_idx, enabled }]
  const [masks,       setMasks]       = useState([]);
  const [selectedId,  setSelectedId]  = useState(null);

  // Drawing state
  const [mode,        setMode]        = useState("draw"); // "draw" | "select"
  const [drawing,     setDrawing]     = useState(false);
  const [draftPts,    setDraftPts]    = useState([]);     // current polygon in progress
  const [colorIdx,    setColorIdx]    = useState(0);

  // Drag state (for moving points in select mode)
  const dragRef = useRef({ active: false, maskId: null, ptIdx: null, startX: 0, startY: 0 });

  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState(null); // base64 frame

  // ── Canvas size ──────────────────────────────────────────────
  const CANVAS_W = 640;
  const CANVAS_H = 360;

  // ── Load masks from backend ──────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res  = await fetch(`${API}/api/masks/${encodeURIComponent(device.ip)}`);
        const data = await res.json();
        setMasks(data.masks || []);
      } catch (e) {
        console.error("[MASKS] Load failed:", e);
      }
      setLoading(false);
    })();
  }, [device.ip]);

  // ── Grab a snapshot frame from OME/stream ────────────────────
  useEffect(() => {
    if (!device.ome_stream) return;
    // Try to fetch a thumbnail snapshot
    const snapshotUrl = `${API}/api/streams/${device.ome_stream}/snapshot`;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => setSnapshot(snapshotUrl);
    img.onerror = () => setSnapshot(null); // will fall back to grid background
    img.src = snapshotUrl;
  }, [device.ome_stream]);

  // ── Render canvas ────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Background — use snapshot if available, else dark grid
    if (snapshot && streamImgRef.current?.complete) {
      ctx.drawImage(streamImgRef.current, 0, 0, CANVAS_W, CANVAS_H);
    } else {
      // Dark grid placeholder
      ctx.fillStyle = "#060a10";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.strokeStyle = "#111923";
      ctx.lineWidth = 1;
      for (let x = 0; x <= CANVAS_W; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
      }
      for (let y = 0; y <= CANVAS_H; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
      }
      // Camera icon in center
      ctx.fillStyle = "#1a2332";
      ctx.font = "32px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⬜", CANVAS_W / 2, CANVAS_H / 2 - 10);
      ctx.font = "11px 'DM Mono', monospace";
      ctx.fillStyle = "#2e3d55";
      ctx.fillText("Live preview not available — masks will still apply", CANVAS_W / 2, CANVAS_H / 2 + 28);
    }

    // Draw saved masks
    masks.forEach(mask => {
      if (!mask.points?.length) return;
      const col   = MASK_COLORS[mask.color_idx ?? 0];
      const isSel = mask.id === selectedId;

      ctx.beginPath();
      mask.points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
      ctx.closePath();

      if (!mask.enabled) {
        // Disabled mask — hatched
        ctx.save();
        ctx.clip();
        ctx.fillStyle = "rgba(30,45,66,0.3)";
        ctx.fill();
        // Hatch
        ctx.strokeStyle = "rgba(30,45,66,0.5)";
        ctx.lineWidth = 1;
        for (let i = -CANVAS_H; i < CANVAS_W + CANVAS_H; i += 12) {
          ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + CANVAS_H, CANVAS_H); ctx.stroke();
        }
        ctx.restore();
        ctx.beginPath();
        mask.points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
        ctx.closePath();
        ctx.strokeStyle = "#2e3d55";
        ctx.lineWidth = isSel ? 2 : 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = col.fill;
        ctx.fill();
        ctx.strokeStyle = isSel ? "#fff" : col.stroke;
        ctx.lineWidth   = isSel ? 2.5 : 1.5;
        ctx.stroke();
      }

      // Mask name label
      const cx = mask.points.reduce((s, [x]) => s + x, 0) / mask.points.length;
      const cy = mask.points.reduce((s, [, y]) => s + y, 0) / mask.points.length;
      ctx.fillStyle = isSel ? "#fff" : "#c9d4e8";
      ctx.font      = `${isSel ? "500 " : ""}11px 'DM Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(mask.name, cx, cy);

      // Vertex dots in select mode
      if (isSel && mode === "select") {
        mask.points.forEach(([x, y]) => {
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fillStyle = "#2563eb";
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
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      draftPts.forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(x, y, i === 0 ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? col.stroke : col.fill;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
  }, [masks, selectedId, draftPts, colorIdx, mode, snapshot]);

  useEffect(() => { redraw(); }, [redraw]);

  // ── Canvas coords helper ──────────────────────────────────────
  const getCanvasXY = (e) => {
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return [
      Math.round((clientX - rect.left) * scaleX),
      Math.round((clientY - rect.top)  * scaleY),
    ];
  };

  // ── Pointer down ──────────────────────────────────────────────
  const handlePointerDown = (e) => {
    const [x, y] = getCanvasXY(e);

    if (mode === "select") {
      // Check if clicking a vertex of selected mask
      const mask = masks.find(m => m.id === selectedId);
      if (mask) {
        const ptIdx = mask.points.findIndex(([px, py]) =>
          Math.hypot(px - x, py - y) < 10
        );
        if (ptIdx !== -1) {
          dragRef.current = { active: true, maskId: selectedId, ptIdx, startX: x, startY: y };
          return;
        }
      }
      // Click on a mask body — select it
      const hit = [...masks].reverse().find(m => isPointInPolygon([x, y], m.points));
      setSelectedId(hit?.id || null);
      return;
    }

    // Draw mode — add point
    if (mode === "draw") {
      // If clicking near first point of draft → close polygon
      if (draftPts.length >= 3) {
        const [fx, fy] = draftPts[0];
        if (Math.hypot(fx - x, fy - y) < 14) {
          finalizeMask();
          return;
        }
      }
      setDraftPts(p => [...p, [x, y]]);
    }
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current.active) return;
    const [x, y] = getCanvasXY(e);
    const { maskId, ptIdx } = dragRef.current;
    setMasks(prev => prev.map(m =>
      m.id === maskId
        ? { ...m, points: m.points.map((p, i) => i === ptIdx ? [x, y] : p) }
        : m
    ));
  };

  const handlePointerUp = async () => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    // Auto-save moved vertex
    const mask = masks.find(m => m.id === dragRef.current.maskId);
    if (mask) await saveMask(mask);
  };

  // ── Finalize drawn polygon ────────────────────────────────────
  const finalizeMask = async () => {
    if (draftPts.length < 3) {
      showToast("Need at least 3 points", "error");
      setDraftPts([]);
      return;
    }
    const newMask = {
      id:        `mask_${Date.now()}`,
      name:      `Mask ${masks.length + 1}`,
      points:    draftPts,
      color_idx: colorIdx,
      enabled:   true,
    };
    setDraftPts([]);
    setMasks(p => [...p, newMask]);
    setSelectedId(newMask.id);
    await saveMask(newMask);
    showToast(`Mask "${newMask.name}" created`, "success");
    // Cycle color for next mask
    setColorIdx(c => (c + 1) % MASK_COLORS.length);
  };

  // ── Save mask to backend ──────────────────────────────────────
  const saveMask = async (mask) => {
    setSaving(true);
    try {
      await fetch(`${API}/api/masks/${encodeURIComponent(device.ip)}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ mask }),
      });
    } catch (e) {
      showToast("Save failed: " + e.message, "error");
    }
    setSaving(false);
  };

  // ── Delete mask ───────────────────────────────────────────────
  const deleteMask = async (id) => {
    setMasks(p => p.filter(m => m.id !== id));
    if (selectedId === id) setSelectedId(null);
    try {
      await fetch(`${API}/api/masks/${encodeURIComponent(device.ip)}/${id}`, {
        method: "DELETE",
      });
      showToast("Mask deleted", "success");
    } catch (e) {
      showToast("Delete failed", "error");
    }
  };

  // ── Toggle mask enabled ───────────────────────────────────────
  const toggleMask = async (id) => {
    const updated = masks.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m);
    setMasks(updated);
    const mask = updated.find(m => m.id === id);
    await saveMask(mask);
  };

  // ── Rename mask ───────────────────────────────────────────────
  const renameMask = (id, name) => {
    setMasks(p => p.map(m => m.id === id ? { ...m, name } : m));
  };

  const commitRename = async (id) => {
    const mask = masks.find(m => m.id === id);
    if (mask) await saveMask(mask);
  };

  // ── Save all ──────────────────────────────────────────────────
  const saveAll = async () => {
    setSaving(true);
    try {
      await fetch(`${API}/api/masks/${encodeURIComponent(device.ip)}/all`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ masks }),
      });
      showToast("All masks saved", "success");
    } catch (e) {
      showToast("Save failed: " + e.message, "error");
    }
    setSaving(false);
  };

  // ── Undo last draft point ─────────────────────────────────────
  const undoPoint = () => setDraftPts(p => p.slice(0, -1));

  // ── Cancel draft ─────────────────────────────────────────────
  const cancelDraft = () => setDraftPts([]);

  // ── Point-in-polygon test ─────────────────────────────────────
  function isPointInPolygon([px, py], points = []) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  }

  return (
    <>
      {/* Hidden img for snapshot background */}
      {snapshot && (
        <img
          ref={streamImgRef}
          src={snapshot}
          style={{ display: "none" }}
          onLoad={redraw}
          alt=""
        />
      )}

      <div className="cfp-section-title">Privacy Masks</div>
      <div className="cfp-section-desc">
        Draw polygonal regions to permanently black-out areas of the video feed
      </div>

      <div className="cfp-card" style={{ padding: 0, overflow: "hidden" }}>

        {/* Toolbar */}
        <div className="cfp-mask-toolbar">
          <button
            className={`cfp-mask-tool-btn ${mode === "draw" ? "active" : ""}`}
            onClick={() => { setMode("draw"); setSelectedId(null); }}
          >
            ✏ Draw
          </button>
          <button
            className={`cfp-mask-tool-btn ${mode === "select" ? "active" : ""}`}
            onClick={() => { setMode("select"); setDraftPts([]); }}
          >
            ↖ Select
          </button>

          <div className="cfp-mask-sep" />

          {/* Color picker */}
          {MASK_COLORS.map((c, i) => (
            <button
              key={i}
              title={c.label}
              onClick={() => setColorIdx(i)}
              style={{
                width: 20, height: 20,
                borderRadius: 4,
                border: `2px solid ${colorIdx === i ? "#fff" : c.stroke}`,
                background: c.fill,
                cursor: "pointer",
                padding: 0,
                transition: "all .12s",
                transform: colorIdx === i ? "scale(1.2)" : "scale(1)",
              }}
            />
          ))}

          <div className="cfp-mask-sep" />

          {/* Draft controls */}
          {draftPts.length > 0 && (
            <>
              <button
                className="cfp-mask-tool-btn success"
                onClick={finalizeMask}
                disabled={draftPts.length < 3}
              >
                ✓ Close ({draftPts.length} pts)
              </button>
              <button className="cfp-mask-tool-btn" onClick={undoPoint}>
                ↩ Undo
              </button>
              <button className="cfp-mask-tool-btn danger" onClick={cancelDraft}>
                ✕ Cancel
              </button>
            </>
          )}

          {masks.length > 0 && draftPts.length === 0 && (
            <button className="cfp-mask-tool-btn success" onClick={saveAll}>
              ↑ Save All
            </button>
          )}

          <span className="cfp-mask-hint">
            {mode === "draw"
              ? draftPts.length === 0
                ? "Click to place points · Click 1st point to close"
                : `${draftPts.length} point${draftPts.length > 1 ? "s" : ""} · click 1st point or ✓ to close`
              : "Click a mask to select · Drag vertices to reshape"}
          </span>
        </div>

        {/* Canvas */}
        <div className="cfp-mask-wrap" style={{ border: "none", borderRadius: 0 }}>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className={`cfp-mask-canvas${
              dragRef.current.active ? " dragging" :
              mode === "select" ? " move-mode" : ""
            }`}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
          />
          {saving && <div className="cfp-mask-saving">Saving…</div>}
        </div>
      </div>

      {/* Mask list */}
      <div style={{ marginTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span className="cfp-info-key" style={{ fontSize: 10 }}>
            {masks.length} mask{masks.length !== 1 ? "s" : ""} defined
          </span>
          {selectedId && (
            <button
              className="cfp-mask-tool-btn danger"
              style={{ fontSize: 10, padding: "4px 10px" }}
              onClick={() => deleteMask(selectedId)}
            >
              ✕ Delete Selected
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ color: "#4a5a72", fontSize: 12, padding: "12px 0" }}>Loading masks…</div>
        ) : masks.length === 0 ? (
          <div className="cfp-mask-empty">
            No masks defined yet.<br />
            <span style={{ color: "#1a2332" }}>Switch to Draw mode and click the canvas to start.</span>
          </div>
        ) : (
          <div className="cfp-mask-list">
            {masks.map(mask => {
              const col = MASK_COLORS[mask.color_idx ?? 0];
              return (
                <div
                  key={mask.id}
                  className={`cfp-mask-item ${selectedId === mask.id ? "selected" : ""}`}
                  onClick={() => setSelectedId(mask.id)}
                >
                  <div
                    className="cfp-mask-item-color"
                    style={{ background: col.fill, borderColor: col.stroke }}
                  />
                  <input
                    className="cfp-preset-input"
                    style={{ flex: 1, padding: "3px 8px", fontSize: 11, height: "auto" }}
                    value={mask.name}
                    onChange={e => renameMask(mask.id, e.target.value)}
                    onBlur={() => commitRename(mask.id)}
                    onClick={e => e.stopPropagation()}
                  />
                  <span className="cfp-mask-item-pts">
                    {mask.points?.length} pts
                  </span>

                  {/* Enable/disable toggle */}
                  <label
                    className="cfp-switch"
                    style={{ width: 32, height: 18 }}
                    onClick={e => { e.stopPropagation(); toggleMask(mask.id); }}
                  >
                    <input type="checkbox" checked={!!mask.enabled} readOnly />
                    <span className="cfp-switch-slider" />
                  </label>

                  <button
                    className="cfp-mask-item-del"
                    onClick={e => { e.stopPropagation(); deleteMask(mask.id); }}
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Instructions card */}
      <div className="cfp-card" style={{ marginTop: 14 }}>
        <div className="cfp-card-title">How Privacy Masks Work</div>
        <div style={{ fontSize: 11, color: "#4a5a72", lineHeight: 1.7 }}>
          <div>① Switch to <strong style={{ color: "#3b82f6" }}>Draw</strong> mode and click the canvas to place polygon vertices.</div>
          <div>② Click the first point (or press ✓) to close and save the polygon.</div>
          <div>③ Switch to <strong style={{ color: "#3b82f6" }}>Select</strong> mode to reposition vertices by dragging.</div>
          <div>④ Toggle the switch on each mask row to enable or disable without deleting.</div>
          <div>⑤ Masks are applied by the recording pipeline — they black-out the region in both live and recorded streams.</div>
        </div>
      </div>
    </>
  );
}