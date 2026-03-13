import { useState, useRef, useEffect } from "react";
import Toggle from "../../components/shared/Toggle";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";
import DataTable from "../../components/shared/DataTable";
import WebRTCPlayer from "../../components/shared/WebRTCPlayer";
import "./ImageConfigPage.css";

const SLIDERS = [
  { label: "Brightness",  key: "brightness",  color: "#ffb340", min: -100, max: 100 },
  { label: "Color Level", key: "colorLevel",  color: "#4d9fff", min: -100, max: 100 },
  { label: "Sharpness",   key: "sharpness",   color: "#00c8a0", min: -100, max: 100 },
  { label: "Contrast",    key: "contrast",    color: "#c084fc", min: -100, max: 100 },
];

const DEFAULT_VALS = {
  brightness: 0, colorLevel: 0, sharpness: 0, contrast: 0,
  whiteBalance: "", rotateImage: "",
  autoRotation: false, mirrorImage: false,
  backlightComp: false,
  dynamicContrast: false, dynamicContrastLevel: 0,
};

function buildCSSFilter(vals) {
  const brightness = 1 + (vals.brightness / 100);
  let contrast = 1 + (vals.contrast / 100);
  if (vals.dynamicContrast) contrast += vals.dynamicContrastLevel / 200;
  const backlightBoost = vals.backlightComp ? 0.15 : 0;
  const saturate = 1 + (vals.colorLevel / 100);
  const sharpnessContrast = 1 + (vals.sharpness / 400);
  let hueRotate = 0, sepia = 0;
  if (vals.whiteBalance === "Sunny")    { hueRotate = 5;  sepia = 0.05; }
  if (vals.whiteBalance === "Cloudy")   { hueRotate = -5; sepia = 0.08; }
  if (vals.whiteBalance === "Indoor")   { hueRotate = 15; sepia = 0.12; }
  if (vals.whiteBalance === "Tungsten") { hueRotate = 25; sepia = 0.18; }
  return [
    `brightness(${Math.max(0.1, brightness + backlightBoost).toFixed(3)})`,
    `contrast(${Math.max(0.1, contrast * sharpnessContrast).toFixed(3)})`,
    `saturate(${Math.max(0, saturate).toFixed(3)})`,
    hueRotate !== 0 ? `hue-rotate(${hueRotate}deg)` : "",
    sepia > 0 ? `sepia(${sepia})` : "",
  ].filter(Boolean).join(" ");
}

function buildTransform(vals) {
  const parts = [];
  if (vals.mirrorImage) parts.push("scaleX(-1)");
  if (vals.rotateImage) parts.push(`rotate(${vals.rotateImage}deg)`);
  return parts.join(" ") || "none";
}

function loadDevices() {
  try {
    const saved = localStorage.getItem("miradorai_devices");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

export default function ImageConfigPage() {
  const [filter, setFilter]     = useState("");
  const [selected, setSelected] = useState(null);
  const [vals, setVals]         = useState(DEFAULT_VALS);

  const setV = (k, v) => setVals((f) => ({ ...f, [k]: v }));

  // Load real devices from localStorage (File 2 approach)
  const devices = loadDevices();
  const selectedDevice = devices.find((d) => String(d.id) === String(selected));
  const wsUrl = selectedDevice?.ws_url || null;

  // Build DataTable rows from real devices
  const rows = devices.map((d) => ({
    id: String(d.id),
    cells: [d.name, d.ip || "—", d.manufacturer || "—", d.model || "—"],
  }));

  // Filter rows using the SearchBar filter (File 1 approach)
  const filteredRows = rows.filter((r) =>
    !filter ||
    r.cells.some((c) => c.toLowerCase().includes(filter.toLowerCase()))
  );

  const cssFilter    = buildCSSFilter(vals);
  const cssTransform = buildTransform(vals);

  const handleReset = () => setVals(DEFAULT_VALS);

  const handleSelectCamera = (id) => {
    if (selected === id) { setSelected(null); }
    else { setSelected(id); setVals(DEFAULT_VALS); }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Image <span>Configuration</span></h1>
          <p className="page-desc">Make changes in real time. Changes apply instantly to the live preview.</p>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Type to filter" />
      </div>

      {/* Camera Table — uses DataTable with real devices (File 2) + filter (File 1) */}
      <DataTable
        columns={["Camera Name", "IP Address", "Manufacturer", "Model"]}
        rows={filteredRows}
        selectedId={selected ? String(selected) : null}
        onSelect={handleSelectCamera}
        emptyMessage="No cameras enrolled. Go to Add Devices first."
      />

      <div className="ic-bottom">
        {/* Live Stream Preview — WebRTCPlayer (File 2) + CSS filter/transform overlays (File 1) */}
        <div className="ic-preview card">
          {!selected ? (
            <div className="ic-preview__inner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
              </svg>
              <span>Select a camera to begin</span>
            </div>
          ) : (
            <div className="ic-preview__active">
              <div className="ic-preview__cam-label">
                <span className="ic-live-dot" />
                {selectedDevice?.name}
                <span className="ic-live-tag">LIVE</span>
                {selectedDevice?.ip && (
                  <code className="ic-preview__ip">{selectedDevice.ip}</code>
                )}
                {!wsUrl && (
                  <span style={{ fontSize: 10, color: "#ef4444", marginLeft: 8 }}>
                    ⚠ No stream registered
                  </span>
                )}
              </div>
              <div className="ic-preview__video-wrap">
                {wsUrl ? (
                  // WebRTCPlayer wrapped with CSS filter + transform from File 1
                  <div
                    style={{
                      filter: cssFilter,
                      transform: cssTransform,
                      transition: "filter 0.1s ease, transform 0.2s ease",
                      width: "100%",
                      height: "100%",
                    }}
                  >
                    <WebRTCPlayer serverUrl={wsUrl} />
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", height: "100%", gap: 8, color: "#64748b" }}>
                    <span style={{ fontSize: 32 }}>📡</span>
                    <span style={{ fontSize: 12 }}>Stream not registered with OME.</span>
                    <span style={{ fontSize: 11, color: "#475569" }}>
                      Re-enroll this camera to register its RTSP stream.
                    </span>
                  </div>
                )}

                {/* Filter readout overlay (File 1) */}
                {wsUrl && (
                  <div className="ic-filter-readout">
                    {[
                      vals.brightness !== 0 && `Brightness ${vals.brightness > 0 ? "+" : ""}${vals.brightness}`,
                      vals.contrast   !== 0 && `Contrast ${vals.contrast > 0 ? "+" : ""}${vals.contrast}`,
                      vals.colorLevel !== 0 && `Saturation ${vals.colorLevel > 0 ? "+" : ""}${vals.colorLevel}`,
                      vals.sharpness  !== 0 && `Sharpness ${vals.sharpness > 0 ? "+" : ""}${vals.sharpness}`,
                      vals.mirrorImage       && "Mirrored",
                      vals.rotateImage       && `Rotated ${vals.rotateImage}°`,
                      vals.backlightComp     && "Backlight Comp",
                      vals.dynamicContrast   && `WDR ${vals.dynamicContrastLevel}`,
                      vals.whiteBalance      && `WB: ${vals.whiteBalance}`,
                    ].filter(Boolean).map((tag) => (
                      <span key={tag} className="ic-filter-tag">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Image Controls — full set from File 1 */}
        <div className="ic-controls card">
          <div className="ic-controls__title">Image Parameters</div>

          {SLIDERS.map(({ label, key, color, min, max }) => (
            <div key={key} className="ic-row">
              <span className="ic-label">{label}</span>
              <div className="ic-slider-wrap">
                <input type="range" min={min} max={max} value={vals[key]}
                  disabled={!selected}
                  onChange={(e) => setV(key, Number(e.target.value))}
                  style={{ accentColor: color }} className="ic-slider" />
              </div>
              <span className="ic-val" style={{ color }}>{vals[key] > 0 ? "+" : ""}{vals[key]}</span>
            </div>
          ))}

          <div className="ic-divider" />

          <div className="ic-row">
            <span className="ic-label">White balance</span>
            <select disabled={!selected} value={vals.whiteBalance}
              onChange={(e) => setV("whiteBalance", e.target.value)} className="ic-select">
              <option value="">Auto</option>
              {["Sunny","Cloudy","Indoor","Tungsten"].map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>

          <div className="ic-row">
            <span className="ic-label">Rotate image</span>
            <div className="ic-row-inline">
              <select disabled={!selected} value={vals.rotateImage}
                onChange={(e) => setV("rotateImage", e.target.value)} className="ic-select ic-select--sm">
                <option value="">0</option>
                {["90","180","270"].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <span className="ic-unit">degrees</span>
            </div>
          </div>

          <div className="ic-divider" />

          {[
            ["Automatic image rotation", "autoRotation"],
            ["Mirror image",             "mirrorImage"],
            ["Backlight compensation",   "backlightComp"],
          ].map(([label, key]) => (
            <div key={key} className="ic-row">
              <span className="ic-label">{label}</span>
              <Toggle value={vals[key]} onChange={(v) => selected && setV(key, v)} disabled={!selected} />
            </div>
          ))}

          <div className="ic-divider" />

          <div className="ic-row">
            <span className="ic-label">
              Dynamic contrast <span className="ic-label-sub">(wide dynamic range)</span>
            </span>
            <Toggle value={vals.dynamicContrast} onChange={(v) => selected && setV("dynamicContrast", v)} disabled={!selected} />
          </div>

          {vals.dynamicContrast && selected && (
            <div className="ic-row ic-row--indented">
              <span className="ic-label">Dynamic contrast</span>
              <div className="ic-slider-wrap">
                <input type="range" min={0} max={100} value={vals.dynamicContrastLevel}
                  onChange={(e) => setV("dynamicContrastLevel", Number(e.target.value))}
                  style={{ accentColor: "#c084fc" }} className="ic-slider" />
              </div>
              <span className="ic-val" style={{ color: "#c084fc" }}>{vals.dynamicContrastLevel}</span>
            </div>
          )}

          <div className="ic-divider" />

          <div className="ic-row">
            <span className="ic-label">Custom dewarp settings</span>
            <div className="ic-btn-group">
              <Button label="Import…" disabled={!selected} />
              <Button label="Reset"   disabled={!selected} onClick={handleReset} />
            </div>
          </div>
        </div>
      </div>

      {/* Footer — from File 1 */}
      <div className="page-footer">
        <span />
        <div className="page-footer-right">
          <Button label="Reset to defaults" disabled={!selected} onClick={handleReset} />
          <Button label="Apply" variant="primary" disabled={!selected} />
        </div>
      </div>
    </div>
  );
}
