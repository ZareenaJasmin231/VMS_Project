import { useState } from "react";
import { useMask } from "../../hooks/useMask";
import MaskEditor from "../../components/shared/MaskEditor";
import "./MaskingPage.css";

export default function MaskingPage({ camera }) {
  const {
    masks,
    loading,
    error,
    drawingMode,
    activePoints,
    setDrawingMode,
    addPoint,
    cancelDrawing,
    saveCurrentMask,
    toggleMask,
    removeMask,
  } = useMask(camera?.id);

  const [newLabel, setNewLabel] = useState("Zone 1");
  const [newColor, setNewColor] = useState("#000000");
  const [newOpacity, setNewOpacity] = useState(1.0);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const handleSave = async () => {
    if (activePoints.length < 3) return;
    await saveCurrentMask(newLabel, newColor, newOpacity);
    setNewLabel(`Zone ${masks.length + 2}`);
  };

  const handleDelete = async (maskId) => {
    await removeMask(maskId);
    setConfirmDelete(null);
  };

  if (!camera) {
    return (
      <div className="masking-page__empty">
        <p>Select a camera to configure masking.</p>
      </div>
    );
  }

  return (
    <div className="masking-page">
      <div className="masking-page__header">
        <h2 className="masking-page__title">Privacy Masking</h2>
        <p className="masking-page__subtitle">
          {camera.name || camera.address}
        </p>
      </div>

      <div className="masking-page__preview">
        <MaskEditor
          streamUrl={camera.ws_url}
          masks={masks}
          drawingMode={drawingMode}
          activePoints={activePoints}
          onAddPoint={addPoint}
          onDoubleClick={handleSave}
        />
      </div>

      {!drawingMode ? (
        <button
          className="masking-page__btn masking-page__btn--primary"
          onClick={() => setDrawingMode(true)}
        >
          + Add Zone
        </button>
      ) : (
        <div className="masking-page__draw-controls">
          <div className="masking-page__draw-row">
            <input
              type="text"
              className="masking-page__input"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Zone label"
            />
            <div className="masking-page__color-wrap">
              <label className="masking-page__color-label">Color</label>
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="masking-page__color-picker"
              />
            </div>
          </div>

          <div className="masking-page__draw-row">
            <label className="masking-page__opacity-label">
              Opacity: {Math.round(newOpacity * 100)}%
            </label>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={newOpacity}
              onChange={(e) => setNewOpacity(parseFloat(e.target.value))}
              className="masking-page__slider"
            />
          </div>

          <div className="masking-page__draw-row">
            <span className="masking-page__points-count">
              {activePoints.length} point{activePoints.length !== 1 ? "s" : ""} placed
              {activePoints.length < 3 && " — need at least 3"}
            </span>
          </div>

          <div className="masking-page__draw-actions">
            <button
              className="masking-page__btn masking-page__btn--primary"
              disabled={activePoints.length < 3}
              onClick={handleSave}
            >
              Save Zone
            </button>
            <button
              className="masking-page__btn masking-page__btn--ghost"
              onClick={cancelDrawing}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="masking-page__list-header">
        <span className="masking-page__list-title">Saved Zones</span>
        <span className="masking-page__list-count">{masks.length}</span>
      </div>

      {loading && <p className="masking-page__status">Loading...</p>}
      {error && <p className="masking-page__status masking-page__status--error">{error}</p>}

      {masks.length === 0 && !loading && (
        <p className="masking-page__empty-list">
          No zones added yet. Click Add Zone to draw one.
        </p>
      )}

      <div className="masking-page__list">
        {masks.map((mask) => (
          <div key={mask.id} className="masking-page__mask-item">
            <div
              className="masking-page__mask-swatch"
              style={{ background: mask.color, opacity: mask.opacity }}
            />
            <span className="masking-page__mask-label">{mask.label}</span>

            <label className="masking-page__toggle">
              <input
                type="checkbox"
                checked={mask.enabled}
                onChange={(e) => toggleMask(mask.id, e.target.checked)}
              />
              <span className="masking-page__toggle-track" />
            </label>

            {confirmDelete === mask.id ? (
              <div className="masking-page__confirm">
                <button
                  className="masking-page__btn masking-page__btn--danger"
                  onClick={() => handleDelete(mask.id)}
                >
                  Confirm
                </button>
                <button
                  className="masking-page__btn masking-page__btn--ghost"
                  onClick={() => setConfirmDelete(null)}
                >
                  No
                </button>
              </div>
            ) : (
              <button
                className="masking-page__btn masking-page__btn--icon"
                onClick={() => setConfirmDelete(mask.id)}
                title="Delete zone"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}