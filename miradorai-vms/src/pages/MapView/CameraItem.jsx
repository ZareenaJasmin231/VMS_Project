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
      style={{ flexDirection: "column", alignItems: "stretch", paddingBottom: isActive ? "12px" : "" }}
      draggable
      onDragStart={() => onDragStart(cam)}
      onClick={() => onSelect(cam)}
      title={`${cam.name} — ${cam.ip} — ${cam.status}`}
    >
      <div style={{ display: "flex", alignItems: "center", width: "100%", gap: "8px" }}>
        <span className={`mv-cam-dot mv-cam-dot--${cam.status}`} />
        <div className="mv-cam-info">
          <span className="mv-cam-name">{cam.name}</span>
          <span className="mv-cam-ip">{cam.ip}</span>
        </div>
        {isPlaced && <span className="mv-cam-badge">placed</span>}
        {cam.specs && (
          <span style={{ marginLeft: "auto", fontSize: "10px", color: isActive ? "#10b981" : "#718096", transition: "transform 0.2s ease", transform: isActive ? "rotate(180deg)" : "rotate(0deg)" }}>
            ▼
          </span>
        )}
      </div>
      
      {/* Show Model Specs ONLY when camera is clicked/active */}
      {cam.specs && isActive && (
        <div className="mv-cam-specs" style={{ marginTop: "8px", fontSize: "11.5px", color: "#a0aabf", borderTop: "1px solid #2d3748", paddingTop: "10px", width: "100%", animation: "fadeIn 0.2s ease-in-out" }}>
          <div style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: "16px", rowGap: "6px" }}>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ color: "#718096", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Model</strong>
              <span style={{ color: "#e2e8f0" }}>{cam.specs.model}</span>
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ color: "#718096", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Type</strong>
              <span style={{ color: "#e2e8f0" }}>{cam.specs.type || "N/A"}</span>
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ color: "#718096", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>FOV</strong>
              <span style={{ color: "#e2e8f0" }}>{cam.specs.hfov || "N/A"}°</span>
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ color: "#718096", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Range</strong>
              <span style={{ color: "#e2e8f0" }}>{cam.specs.rangeDay || "N/A"}m</span>
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ color: "#718096", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Sensor</strong>
              <span style={{ color: "#e2e8f0" }}>{cam.specs.sensor || "N/A"}</span>
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ color: "#718096", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Resolution</strong>
              <span style={{ color: "#e2e8f0" }}>{cam.specs.megapixels ? `${cam.specs.megapixels}MP` : "N/A"}</span>
            </span>
          </div>
          <div style={{ marginTop: "10px", fontStyle: "italic", color: "#10b981", fontSize: "10.5px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "#10b981" }}></span>
            Beam matched to datasheet
          </div>
        </div>
      )}
    </div>
  );
}