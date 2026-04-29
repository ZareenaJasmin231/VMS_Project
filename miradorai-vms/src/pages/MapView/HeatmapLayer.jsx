import React from "react";
 import "./Heatmaplayer.css";

/**
 * HeatmapLayer
 * Overlay legend shown in bottom-left of canvas when heatmap is ON.
 * Explains what bright / dark means to the user.
 *
 * Props:
 *   markers  []    – current floor markers
 *   cameras  []    – camera list (to compute online count)
 */
export default function HeatmapLayer({ markers, cameras }) {
  const total   = markers.length;
  const online  = markers.filter(m => cameras.find(c => c.id === m.camId)?.status === "online").length;
  const offline = total - online;

  return (
    <div className="mv-heatmap-legend">
      <div className="mv-heatmap-legend__title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
        Coverage Heatmap
      </div>

      <div className="mv-heatmap-legend__row">
        <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--bright" />
        <span>Covered — camera watching</span>
      </div>
      <div className="mv-heatmap-legend__row">
        <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--dark" />
        <span>Blind spot — no coverage</span>
      </div>
      <div className="mv-heatmap-legend__row">
        <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--offline" />
        <span>Offline camera zone</span>
      </div>

      <div className="mv-heatmap-legend__stats">
        <span>{online} online</span>
        {offline > 0 && <span className="mv-heatmap-legend__offline">{offline} offline</span>}
        <span>{total} placed</span>
      </div>
    </div>
  );
}