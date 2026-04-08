import { useState } from "react";
import { useMask } from "../../hooks/useMask";
import MaskEditor from "../../components/shared/MaskEditor";
import WebRTCPlayer from "../../components/shared/WebRTCPlayer";
import "./MaskingPage.css";

const ZONE_COLORS = [
  "#378ADD", "#1D9E75", "#D85A30", "#BA7517",
  "#993556", "#533AB7", "#639922", "#E24B4A",
];

export default function MaskingPage({ camera }) {
  // camera.stream_key / camera.ome_stream = "192_168_126_235"
  const cameraId = camera?.stream_key || camera?.ome_stream;

  const {
    masks, loading, error,
    saving, deletingId, togglingId,
    drawingMode, pendingRect,
    pipelineRunning, maskedWsUrl,
    startDrawing, cancelDrawing, onRectDrawn, saveZone,
    toggleMask, removeMask,
  } = useMask(cameraId, camera?.ws_url);

  // Zone form state (shown after drawing)
  const [label,   setLabel]   = useState("Zone 1");
  const [opacity, setOpacity] = useState(0.85);
  const autoColor = ZONE_COLORS[masks.length % ZONE_COLORS.length];

  const [tab,          setTab]          = useState("setup");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError,  setDeleteError]  = useState(null);

  const handleSaveZone = async () => {
    try {
      await saveZone({ label, color: autoColor, opacity });
      setLabel(`Zone ${masks.length + 2}`);
    } catch { /* error shown from hook */ }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await removeMask(deleteTarget.id);
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(e.message || "Delete failed — check backend logs.");
    }
  };

  if (!camera || !cameraId) {
    return (
      <div className="masking-page masking-page--empty">
        <p>Select a camera to configure masking.</p>
      </div>
    );
  }

  return (
    <>
      <div className="masking-page">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="masking-page__header">
          <h2 className="masking-page__title">Privacy Masking</h2>
          <p className="masking-page__subtitle">
            {camera.name || camera.device_name || cameraId}
          </p>
        </div>

        <div className="masking-page__banner">
          <span>🔒</span>
          Blur is burned server-side by FFmpeg — recorded and streamed with masking applied.
        </div>

        {/* ── Tabs ───────────────────────────────────────── */}
        <div className="masking-page__tabs">
          <button
            className={`masking-page__tab ${tab === "setup" ? "masking-page__tab--active" : ""}`}
            onClick={() => setTab("setup")}
          >
            Zone Setup
          </button>
          <button
            className={`masking-page__tab ${tab === "live" ? "masking-page__tab--active" : ""}`}
            onClick={() => setTab("live")}
          >
            Live Preview
            {pipelineRunning && <span className="masking-page__tab-dot" />}
          </button>
        </div>

        {/* ── Setup tab ──────────────────────────────────── */}
        {tab === "setup" && (
          <>
            {/* Raw stream + draw canvas */}
            <div className="masking-page__preview">
              <MaskEditor
                streamUrl={camera.ws_url}
                masks={masks}
                drawingMode={drawingMode}
                pendingRect={pendingRect}
                pendingColor={autoColor}
                onRectDrawn={onRectDrawn}
              />
            </div>

            {/* State machine:
                  no pending rect + not drawing  → "Draw Zone" button
                  drawing mode                   → hint only (canvas shows crosshair)
                  pending rect + not drawing     → zone form + Save button
            */}
            {!drawingMode && !pendingRect && (
              <button
                className="masking-page__btn masking-page__btn--add"
                onClick={startDrawing}
              >
                + Draw Zone
              </button>
            )}

            {/* Zone details form — appears after drawing */}
            {pendingRect && !drawingMode && (
              <div className="masking-page__zone-form">
                <div className="masking-page__zone-form-title">
                  <div className="masking-page__color-dot" style={{ background: autoColor }} />
                  New zone
                </div>

                <div className="masking-page__form-row">
                  <label className="masking-page__form-label">Label</label>
                  <input
                    className="masking-page__input"
                    value={label}
                    onChange={e => setLabel(e.target.value)}
                    placeholder="Zone label"
                  />
                </div>

                <div className="masking-page__form-row">
                  <label className="masking-page__form-label">
                    Blur opacity — {Math.round(opacity * 100)}%
                  </label>
                  <input
                    type="range" min="0.1" max="1" step="0.05"
                    value={opacity}
                    onChange={e => setOpacity(parseFloat(e.target.value))}
                    className="masking-page__slider"
                  />
                </div>

                <div className="masking-page__form-hint">
                  This zone will be blurred in the live stream and in all recordings.
                </div>

                <div className="masking-page__form-actions">
                  <button
                    className="masking-page__btn masking-page__btn--ghost"
                    onClick={cancelDrawing}
                    disabled={saving}
                  >
                    Discard
                  </button>
                  <button
                    className="masking-page__btn masking-page__btn--redraw"
                    onClick={startDrawing}
                    disabled={saving}
                  >
                    Redraw
                  </button>
                  <button
                    className="masking-page__btn masking-page__btn--save"
                    onClick={handleSaveZone}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save Zone"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Live Preview tab ────────────────────────────── */}
        {tab === "live" && (
          <div className="masking-page__preview masking-page__preview--live">
            {pipelineRunning && maskedWsUrl ? (
              <>
                <div className="masking-page__live-badge">MASKED STREAM</div>
                {/* Plain WebRTCPlayer — no canvas, blur is IN the stream */}
                <WebRTCPlayer serverUrl={maskedWsUrl} />
              </>
            ) : (
              <div className="masking-page__pipeline-wait">
                {masks.filter(m => m.enabled).length === 0 ? (
                  <p>Add an active zone to start the masked stream.</p>
                ) : (
                  <>
                    <div className="masking-page__spinner" />
                    <p>Starting masked stream…</p>
                    <span>FFmpeg is encoding and pushing to OME</span>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Error notice ────────────────────────────────── */}
        {error && (
          <div className="masking-page__notice masking-page__notice--error">{error}</div>
        )}

        {/* ── Saved zones list ────────────────────────────── */}
        <div className="masking-page__list-header">
          <span className="masking-page__list-title">Saved Zones</span>
          <span className="masking-page__list-count">{masks.length}</span>
        </div>

        {loading && <p className="masking-page__status">Loading…</p>}

        {!loading && masks.length === 0 && (
          <p className="masking-page__empty-list">
            No zones yet — draw one above.
          </p>
        )}

        <div className="masking-page__list">
          {masks.map((mask) => (
            <div key={mask.id} className="masking-page__mask-item">
              <div
                className="masking-page__mask-swatch"
                style={{ background: mask.color }}
              />
              <span className="masking-page__mask-label">{mask.label}</span>

              <label className="masking-page__toggle">
                <input
                  type="checkbox"
                  checked={mask.enabled}
                  disabled={togglingId === mask.id}
                  onChange={e => toggleMask(mask.id, e.target.checked)}
                />
                <span className="masking-page__toggle-track" />
              </label>

              <button
                className="masking-page__btn masking-page__btn--icon"
                disabled={deletingId === mask.id}
                onClick={() => { setDeleteError(null); setDeleteTarget({ id: mask.id, label: mask.label }); }}
                title="Delete zone"
              >
                {deletingId === mask.id ? "…" : "✕"}
              </button>
            </div>
          ))}
        </div>

        {/* ── Pipeline status footer ──────────────────────── */}
        <div className="masking-page__pipeline-status">
          <span className={`masking-page__pipeline-dot ${pipelineRunning ? "masking-page__pipeline-dot--on" : ""}`} />
          {pipelineRunning
            ? `Pipeline active — recording & streaming masked`
            : "Pipeline inactive — no active zones"}
        </div>

      </div>

      {/* ── Delete confirmation modal ────────────────────── */}
      {deleteTarget && (
        <div
          className="masking-page__modal-overlay"
          onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
        >
          <div className="masking-page__modal" onClick={e => e.stopPropagation()}>
            <h3 className="masking-page__modal-title">Delete mask zone?</h3>
            <p className="masking-page__modal-body">
              <strong>"{deleteTarget.label}"</strong> will be removed permanently.
              The area becomes visible in live stream and recordings immediately.
            </p>
            {deleteError && (
              <p className="masking-page__modal-error">{deleteError}</p>
            )}
            <div className="masking-page__modal-actions">
              <button
                className="masking-page__btn masking-page__btn--ghost"
                disabled={deletingId === deleteTarget.id}
                onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
              >
                Cancel
              </button>
              <button
                className="masking-page__btn masking-page__btn--danger"
                disabled={deletingId === deleteTarget.id}
                onClick={handleDeleteConfirm}
              >
                {deletingId === deleteTarget.id ? "Deleting…" : "Delete zone"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}