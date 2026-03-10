import { useState } from "react";
import DataTable from "../../components/shared/DataTable";
import Toggle from "../../components/shared/Toggle";
import "./ImageConfigPage.css";

const SLIDERS = [
  { label: "Brightness", key: "brightness", color: "#ffb340" },
  { label: "Color Level", key: "colorLevel", color: "#4d9fff" },
  { label: "Sharpness",  key: "sharpness",  color: "#00c8a0" },
  { label: "Contrast",   key: "contrast",   color: "#c084fc" },
];

export default function ImageConfigPage() {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(null);
  const [vals, setVals] = useState({ brightness: 0, colorLevel: 0, sharpness: 0, contrast: 0, whiteBalance: "", rotateImage: "", autoRotation: false, mirrorImage: false });
  const setV = (k, v) => setVals((f) => ({ ...f, [k]: v }));

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Image <span>Configuration</span></h1>
          <p className="page-desc">Real-time image tuning. Changes immediately affect live streams and active recordings.</p>
        </div>
      </div>
      <DataTable columns={["Camera Name", "Channel", "Server"]} rows={[]} selectedId={selected} onSelect={setSelected} emptyMessage="Select a camera to configure." />

      <div className="ic-bottom">
        <div className="ic-preview card">
          <div className="ic-preview__inner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            <span>No camera selected</span>
          </div>
        </div>
        <div className="ic-controls card">
          <div className="ic-controls__title">Image Parameters</div>
          {SLIDERS.map(({ label, key, color }) => (
            <div key={key} className="ic-row">
              <span className="ic-label">{label}</span>
              <div className="ic-slider-wrap">
                <input type="range" min={-100} max={100} value={vals[key]} disabled={!selected}
                  onChange={(e) => setV(key, Number(e.target.value))}
                  style={{ "--accent": color }} className="ic-slider" />
              </div>
              <span className="ic-val" style={{ color }}>{vals[key] > 0 ? "+" : ""}{vals[key]}</span>
            </div>
          ))}
          <div className="ic-divider" />
          <div className="ic-row">
            <span className="ic-label">White Balance</span>
            <select disabled={!selected} value={vals.whiteBalance} onChange={(e) => setV("whiteBalance", e.target.value)} className="ic-select">
              <option value="">Auto</option>
              {["Sunny", "Cloudy", "Indoor", "Tungsten"].map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="ic-row">
            <span className="ic-label">Rotate Image</span>
            <select disabled={!selected} value={vals.rotateImage} onChange={(e) => setV("rotateImage", e.target.value)} className="ic-select">
              <option value="">0°</option>
              {["90°", "180°", "270°"].map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="ic-divider" />
          {[["Auto Rotation", "autoRotation"], ["Mirror Image", "mirrorImage"]].map(([label, key]) => (
            <div key={key} className="ic-row">
              <span className="ic-label">{label}</span>
              <Toggle value={vals[key]} onChange={(v) => selected && setV(key, v)} disabled={!selected} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
