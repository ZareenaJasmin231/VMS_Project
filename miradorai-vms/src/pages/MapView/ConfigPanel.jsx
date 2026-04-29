import React, { useState } from "react";

const FOV_ANGLES = [40, 60, 90, 120];

/**
 * ConfigPanel
 * Shown inside the placement-confirmation modal.
 * Lets the user pick:
 *   • FOV angle  (40 / 60 / 90 / 120 — defined in backend)
 *   • Direction  (0–359° via slider, with N/E/S/W compass hint)
 *     ↳ direction is CONTROLLED — parent owns state so canvas drag stays in sync
 *
 * Props:
 *   cam          object  – camera being placed
 *   fovAngle     number  – controlled FOV value
 *   direction    number  – controlled direction value (0–359)
 *   onFovChange  fn(fovAngle)
 *   onDirChange  fn(direction)
 *   onConfirm    fn()
 *   onCancel     fn()
 */
export default function ConfigPanel({
  cam,
  fovAngle,
  direction,
  onFovChange,
  onDirChange,
  onConfirm,
  onCancel,
}) {
  if (!cam) return null;

  const compassLabel = () => {
    if (direction < 45 || direction >= 315) return "↑ North";
    if (direction < 135) return "→ East";
    if (direction < 225) return "↓ South";
    return "← West";
  };

  return (
    <div className="mv-modal-overlay">
      <div className="mv-modal mv-modal--config">

        {/* Header */}
        <div className="mv-modal__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
        </div>
        <h3 className="mv-modal__title">Configure Camera</h3>
        <p className="mv-modal__body">
          Placing <strong>{cam.name}</strong> on the map.
          Set its field of view and facing direction —
          or <strong>drag the camera on the map</strong> to rotate it live.
        </p>
        <div className="mv-modal__meta">
          <span>{cam.ip}</span>
          <span className={`mv-modal__badge mv-modal__badge--${cam.status}`}>
            {cam.status === "online" ? "● Online" : "○ Offline"}
          </span>
        </div>

        {/* FOV angle picker */}
        <div className="mv-modal__field">
          <label className="mv-modal__label">Field of View (FOV)</label>
          <div className="mv-angle-pills">
            {FOV_ANGLES.map(a => (
              <button
                key={a}
                className={`mv-angle-pill ${fovAngle === a ? "mv-angle-pill--active" : ""}`}
                onClick={() => onFovChange(a)}
                type="button"
              >
                {a}°
              </button>
            ))}
          </div>
          <p className="mv-modal__hint">
            {fovAngle === 40  && "Narrow — long-range corridor / entrance"}
            {fovAngle === 60  && "Standard — hallway or focused area"}
            {fovAngle === 90  && "Wide — room corner or open space"}
            {fovAngle === 120 && "Very wide — large open area"}
          </p>
        </div>

        {/* Direction slider */}
        <div className="mv-modal__field">
          <label className="mv-modal__label">
            Facing Direction
            <span className="mv-modal__label-value">{direction}° &nbsp;{compassLabel()}</span>
          </label>
          <input
            type="range"
            min="0" max="359" step="1"
            value={direction}
            onChange={e => onDirChange(Number(e.target.value))}
            className="mv-direction-slider"
          />
          {/* Visual compass ring */}
          <div className="mv-compass">
            {["N","NE","E","SE","S","SW","W","NW"].map((lbl, i) => {
              const deg = i * 45;
              const active =
                Math.abs(((direction - deg + 360) % 360)) < 22.5 ||
                Math.abs(((direction - deg + 360) % 360)) > 337.5;
              return (
                <span
                  key={lbl}
                  className={`mv-compass__label ${active ? "mv-compass__label--active" : ""}`}
                  style={{ "--deg": `${deg}deg` }}
                  onClick={() => onDirChange(deg)}
                >
                  {lbl}
                </span>
              );
            })}
            {/* Needle */}
            <div
              className="mv-compass__needle"
              style={{ transform: `rotate(${direction}deg)` }}
            />
            <div className="mv-compass__center" />
          </div>
        </div>

        {/* Drag hint */}
        <p className="mv-modal__hint mv-modal__hint--drag">
          💡 You can also drag the camera icon on the map to rotate it.
        </p>

        {/* Actions */}
        <div className="mv-modal__row">
          <button className="mv-modal__btn mv-modal__btn--cancel" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="mv-modal__btn mv-modal__btn--confirm"
            onClick={onConfirm}
            type="button"
          >
            Place Camera
          </button>
        </div>
      </div>
    </div>
  );
}