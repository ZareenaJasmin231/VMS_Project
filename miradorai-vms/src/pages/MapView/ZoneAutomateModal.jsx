import React, { useState, useEffect } from "react";

const CAM_TYPE_META = {
  dome:    { label: "Dome",    fov: 110, range: 20, color: "#3b82f6" },
  bullet:  { label: "Bullet", fov: 80,  range: 30, color: "#f59e0b" },
  ptz:     { label: "PTZ",    fov: 60,  range: 50, color: "#8b5cf6" },
  fisheye: { label: "Fisheye",fov: 180, range: 12, color: "#10b981" },
  box:     { label: "Box",    fov: 90,  range: 25, color: "#f97316" },
  thermal: { label: "Thermal",fov: 90,  range: 35, color: "#ef4444" },
};

export default function ZoneAutomateModal({ zone, onClose, onAutomate }) {
  const [selectedTypes, setSelectedTypes] = useState(new Set(["dome"]));
  const [coverage, setCoverage] = useState(100);
  const [estCount, setEstCount] = useState(null);

  useEffect(() => {
    // Estimate camera count from zone polygon area
    const sqm = polygonAreaSqm(zone.polygon);
    let bestArea = 0;
    for (const t of selectedTypes) {
      const m = CAM_TYPE_META[t];
      const fovRad = m.fov * Math.PI / 180;
      const area = 0.5 * m.range * m.range * fovRad * 0.7;
      if (area > bestArea) bestArea = area;
    }
    if (bestArea > 0) setEstCount(Math.ceil(sqm / bestArea));
  }, [selectedTypes, zone]);

  function toggleType(t) {
    setSelectedTypes(prev => {
      const n = new Set(prev);
      if (n.has(t)) { if (n.size > 1) n.delete(t); }
      else n.add(t);
      return n;
    });
  }

  return (
    <div className="dv-automate-overlay" onClick={onClose}>
      <div className="dv-automate-modal" onClick={e => e.stopPropagation()}>
        <div className="dv-automate-header">
          <div className="dv-automate-header__icon">✦</div>
          <div>
            <div className="dv-automate-title">Automate Zone — {zone.name}</div>
            <div className="dv-automate-sub">
              Select camera types · engine will place with zero blind spots
            </div>
          </div>
          <button className="dv-automate-close" onClick={onClose}>✕</button>
        </div>

        {/* Zone info bar */}
        <div className="dv-automate-zone-bar">
          <div className="dv-az-stat">
            <span>Zone area</span>
            <strong>{Math.round(polygonAreaSqm(zone.polygon) * 10.764).toLocaleString()} sq ft</strong>
          </div>
          <div className="dv-az-stat">
            <span>Est. cameras</span>
            <strong style={{ color: "#a78bfa" }}>{estCount ?? "—"}</strong>
          </div>
          <div className="dv-az-stat">
            <span>Coverage target</span>
            <strong style={{ color: "#10b981" }}>{coverage}%</strong>
          </div>
        </div>

        {/* Camera type checkboxes */}
        <div className="dv-automate-body">
          <div className="dv-automate-section-label">Camera types to use</div>
          <div className="dv-automate-type-grid">
            {Object.entries(CAM_TYPE_META).map(([key, meta]) => {
              const on = selectedTypes.has(key);
              return (
                <div
                  key={key}
                  className={`dv-cam-type-card ${on ? "dv-cam-type-card--on" : ""}`}
                  style={{ "--tc": meta.color }}
                  onClick={() => toggleType(key)}
                >
                  <div className={`dv-cam-type-cb ${on ? "dv-cam-type-cb--on" : ""}`}>
                    {on && <svg width="9" height="9" viewBox="0 0 10 10">
                      <polyline points="1,5 4,8 9,2" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>}
                  </div>
                  <div>
                    <div className="dv-cam-type-name" style={{ color: on ? meta.color : "#94a3b8" }}>
                      {meta.label}
                    </div>
                    <div className="dv-cam-type-spec">
                      {meta.fov}° FOV · {meta.range}m range
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Coverage target */}
          <div className="dv-automate-coverage-row">
            <label>Coverage target</label>
            <select value={coverage} onChange={e => setCoverage(Number(e.target.value))}>
              <option value={100}>100% — zero blind spots</option>
              <option value={95}>95% — minor corners allowed</option>
              <option value={80}>80% — key areas only</option>
            </select>
          </div>
        </div>

        <div className="dv-automate-footer">
          <button className="dv-automate-cancel" onClick={onClose}>Cancel</button>
          <button
            className="dv-automate-run"
            onClick={() => onAutomate({ zone, selectedTypes: [...selectedTypes], coverage })}
          >
            ▶ Run automate
          </button>
        </div>
      </div>
    </div>
  );
}

function polygonAreaSqm(polygon, ppm = 22) {
  // Shoelace formula → pixels² → metres²
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }
  return Math.abs(area / 2) / (ppm * ppm);
}