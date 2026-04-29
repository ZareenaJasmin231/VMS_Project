import React from "react";

/**
 * CameraItem
 * Single camera card in the sidebar list.
 * Supports:
 *   - click to select for placement
 *   - drag-and-drop onto canvas
 *   - shows online/offline status
 *   - shows "placed" badge if already on map
 *
 * Props:
 *   cam        object
 *   isPlaced   bool
 *   isActive   bool   – currently selected for placement
 *   onSelect   fn(cam)
 *   onDragStart fn(cam)
 */
export default function CameraItem({ cam, isPlaced, isActive, onSelect, onDragStart }) {
  return (
    <div
      className={[
        "mv-cam-item",
        isPlaced  ? "mv-cam-item--placed" : "",
        isActive  ? "mv-cam-item--active" : "",
      ].join(" ")}
      draggable
      onDragStart={() => onDragStart(cam)}
      onClick={() => onSelect(cam)}
      title={`${cam.name} — ${cam.ip} — ${cam.status}`}
    >
      <span className={`mv-cam-dot mv-cam-dot--${cam.status}`} />
      <div className="mv-cam-info">
        <span className="mv-cam-name">{cam.name}</span>
        <span className="mv-cam-ip">{cam.ip}</span>
      </div>
      {isPlaced && <span className="mv-cam-badge">placed</span>}
    </div>
  );
}