import { useState } from "react";
import DataTable from "../../components/shared/DataTable";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";
import "./StreamProfilesPage.css";

const RESOLUTIONS = [
  "3840×2160 (16:9)", "1920×1080 (16:9)", "1280×720 (16:9)",
  "854×480 (16:9)", "640×360 (16:9)"
];
const FORMATS = ["H.265", "H.264", "MJPEG", "AV1"];

const DEFAULT_FORM = {
  hR: "1920×1080 (16:9)", hF: "H.264", hFps: 30, hComp: 30,
  mR: "1280×720 (16:9)",  mF: "H.264", mFps: 15, mComp: 30,
  lR: "640×360 (16:9)",   lF: "H.264", lFps: 8,  lComp: 30,
  mic: "None", speaker: "None", micFor: "",
};

function loadDevices() {
  try {
    const saved = localStorage.getItem("miradorai_devices");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function loadProfiles() {
  try {
    const saved = localStorage.getItem("miradorai_stream_profiles");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function saveProfiles(profiles) {
  try {
    localStorage.setItem("miradorai_stream_profiles", JSON.stringify(profiles));
  } catch {}
}

function Spinner({ value, onChange }) {
  return (
    <div className="sp-spinner">
      <input
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v)) onChange(Math.min(120, Math.max(0, v)));
        }}
      />
      <div className="sp-spinner-btns">
        <button onClick={() => onChange(Math.min(120, value + 1))}>▲</button>
        <button onClick={() => onChange(Math.max(0, value - 1))}>▼</button>
      </div>
    </div>
  );
}

function QSel({ value, onChange, opts }) {
  return (
    <select className="sp-sel" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {opts.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}

// Camera thumbnail cell — shows snapshot or placeholder icon
function CamThumb({ device }) {
  if (!device) return <div className="sp-thumb sp-thumb--empty" />;
  return (
    <div className="sp-thumb">
      {device.snapshot_url ? (
        <img src={device.snapshot_url} alt={device.name} className="sp-thumb__img" />
      ) : (
        <div className="sp-thumb__placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M23 7l-7 5 7 5V7z"/>
            <rect x="1" y="5" width="15" height="14" rx="2"/>
          </svg>
        </div>
      )}
    </div>
  );
}

export default function StreamProfilesPage() {
  const [filter, setFilter]   = useState("");
  const [selected, setSelected] = useState(null);
  const [profiles, setProfiles] = useState(loadProfiles);
  const [form, setForm]         = useState(DEFAULT_FORM);

  const s = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Load cameras from ImageConfig's localStorage key
  const devices = loadDevices();

  // Each camera becomes a "stream profile" row
  const rows = devices
    .filter((d) =>
      !filter ||
      [d.name, d.ip, d.manufacturer, d.model]
        .filter(Boolean)
        .some((c) => c.toLowerCase().includes(filter.toLowerCase()))
    )
    .map((d) => {
      const savedProfile = profiles.find((p) => String(p.deviceId) === String(d.id));
      const pf = savedProfile?.form || {};
      return {
        id: String(d.id),
        // Pass the device object for thumbnail rendering via a custom cell
        _device: d,
        cells: [
          // Cell 0: thumbnail + name (rendered specially below via renderCell)
          d.name,
          pf.hR ? `${pf.hR.split(" ")[0]} ${pf.hFps}fps ${pf.hF}` : "—",
          pf.mR ? `${pf.mR.split(" ")[0]} ${pf.mFps}fps ${pf.mF}` : "—",
          pf.lR ? `${pf.lR.split(" ")[0]} ${pf.lFps}fps ${pf.lF}` : "—",
          "MIRADOR",
        ],
      };
    });

  const handleSelect = (id) => {
    if (selected === id) {
      setSelected(null);
      setForm(DEFAULT_FORM);
    } else {
      setSelected(id);
      const saved = profiles.find((p) => String(p.deviceId) === String(id));
      setForm(saved ? { ...DEFAULT_FORM, ...saved.form } : DEFAULT_FORM);
    }
  };

  const handleApply = () => {
    if (!selected) return;
    const existing = profiles.filter((p) => String(p.deviceId) !== String(selected));
    const updated = [...existing, { deviceId: selected, form }];
    setProfiles(updated);
    saveProfiles(updated);
  };

  const selectedDevice = devices.find((d) => String(d.id) === String(selected));

  const tiers = [
    { label: "High",   rK: "hR", fK: "hF", fpsK: "hFps", cK: "hComp" },
    { label: "Medium", rK: "mR", fK: "mF", fpsK: "mFps", cK: "mComp" },
    { label: "Low",    rK: "lR", fK: "lF", fpsK: "lFps", cK: "lComp" },
  ];

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Stream <span>Profiles</span></h1>
          <p className="page-desc">Create profiles for live streaming and recording.</p>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Type to filter" />
      </div>

      {/* Camera / Profile Table */}
      <div style={{
        maxHeight: "calc(4 * 48px + 48px)",
        overflowY: "auto",
        borderRadius: 8,
        scrollbarWidth: "thin",
        scrollbarColor: "#334155 transparent",
      }}>
        {/* Custom table with thumbnail in first column */}
        <table className="sp-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>High</th>
              <th>Medium</th>
              <th>Low</th>
              <th>Server</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="sp-table__empty">
                  No cameras enrolled. Go to Add Devices first.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const device = devices.find((d) => String(d.id) === row.id);
                return (
                  <tr
                    key={row.id}
                    className={selected === row.id ? "sp-table__row--selected" : ""}
                    onClick={() => handleSelect(row.id)}
                  >
                    {/* Name cell with thumbnail */}
                    <td>
                      <div className="sp-name-cell">
                        <CamThumb device={device} />
                        <span>{row.cells[0]}</span>
                      </div>
                    </td>
                    <td>{row.cells[1]}</td>
                    <td>{row.cells[2]}</td>
                    <td>{row.cells[3]}</td>
                    <td>{row.cells[4]}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Panel — Video Profiles (left) + Audio (right) */}
      <div className="sp-panel card">
        <div className="sp-panel-body">

          {/* Left: Video Profiles */}
          <div className="sp-video-section">
            <div className="sp-section-title">Video profiles</div>
            <div className="sp-video-grid">
              <div className="sp-col-header" />
              {tiers.map((t) => (
                <div key={t.label} className="sp-col-header">{t.label}</div>
              ))}

              <div className="sp-row-label">Resolution:</div>
              {tiers.map((t) => (
                <QSel key={t.rK} value={form[t.rK]} onChange={(v) => s(t.rK, v)} opts={RESOLUTIONS} />
              ))}

              <div className="sp-row-label">Format:</div>
              {tiers.map((t) => (
                <QSel key={t.fK} value={form[t.fK]} onChange={(v) => s(t.fK, v)} opts={FORMATS} />
              ))}

              <div className="sp-row-label">Frame rate:</div>
              {tiers.map((t) => (
                <Spinner key={t.fpsK} value={form[t.fpsK]} onChange={(v) => s(t.fpsK, v)} />
              ))}

              <div className="sp-row-label">Compression:</div>
              {tiers.map((t) => (
                <Spinner key={t.cK} value={form[t.cK]} onChange={(v) => s(t.cK, v)} />
              ))}
            </div>
            <div className="sp-zipstream">Zipstream</div>
          </div>

          {/* Right: Audio */}
          <div className="sp-audio-section">
            <div className="sp-section-title">Audio</div>
            <div className="sp-audio-fields">
              <div className="sp-audio-field">
                <label>Microphone:</label>
                <QSel value={form.mic} onChange={(v) => s("mic", v)}
                  opts={["None", "Built-in", "USB Mic"]} />
              </div>
              <div className="sp-audio-field">
                <label>Speaker:</label>
                <QSel value={form.speaker} onChange={(v) => s("speaker", v)}
                  opts={["None", "Built-in", "USB Speaker"]} />
              </div>
              <div className="sp-audio-field">
                <label>Use microphone for:</label>
                <QSel value={form.micFor} onChange={(v) => s("micFor", v)}
                  opts={["Recording", "Live stream", "Both"]} />
              </div>
            </div>
          </div>

        </div>
      </div>

      <div className="page-footer">
        <span />
        <Button label="Apply" variant="primary" disabled={!selected} onClick={handleApply} />
      </div>
    </div>
  );
}