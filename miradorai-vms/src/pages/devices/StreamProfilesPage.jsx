import { useState } from "react";
import DataTable from "../../components/shared/DataTable";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";
import "./StreamProfilesPage.css";

const RESOLUTIONS = ["3840×2160", "1920×1080", "1280×720", "854×480", "640×360"];
const FORMATS = ["H.265", "H.264", "MJPEG", "AV1"];

function QSel({ value, onChange, opts }) {
  return (
    <select className="sp-sel" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {opts.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}

export default function StreamProfilesPage() {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ hR: "", hF: "", hFps: "25", mR: "", mF: "", mFps: "15", lR: "", lF: "", lFps: "10", mic: "", speaker: "" });
  const s = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Stream <span>Profiles</span></h1>
          <p className="page-desc">Define quality tiers for live streaming and scheduled recording workflows.</p>
        </div>
        <SearchBar value={filter} onChange={setFilter} />
      </div>
      <DataTable columns={["Profile Name", "High", "Medium", "Low", "Server"]} rows={[]} selectedId={selected} onSelect={setSelected} emptyMessage="No stream profiles defined." />

      <div className="sp-panel card">
        <div className="sp-panel__section">
          <div className="sp-section-title">Video Quality Tiers</div>
          <div className="sp-grid">
            {[["High", "hR", "hF", "hFps"], ["Medium", "mR", "mF", "mFps"], ["Low", "lR", "lF", "lFps"]].map(([tier, rK, fK, fpsK]) => (
              <div key={tier} className="sp-tier-card">
                <div className="sp-tier-title">{tier}</div>
                <div className="sp-tier-field"><label>Resolution</label><QSel value={form[rK]} onChange={(v) => s(rK, v)} opts={RESOLUTIONS} /></div>
                <div className="sp-tier-field"><label>Format</label><QSel value={form[fK]} onChange={(v) => s(fK, v)} opts={FORMATS} /></div>
                <div className="sp-tier-field"><label>Frame Rate</label>
                  <div className="sp-fps">
                    <input value={form[fpsK]} onChange={(e) => s(fpsK, e.target.value)} />
                    <span>fps</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="sp-panel__section">
          <div className="sp-section-title">Audio</div>
          <div className="sp-audio-row">
            <div className="sp-tier-field"><label>Microphone</label><input className="sp-sel" value={form.mic} onChange={(e) => s("mic", e.target.value)} placeholder="Select microphone..." /></div>
            <div className="sp-tier-field"><label>Speaker</label><input className="sp-sel" value={form.speaker} onChange={(e) => s("speaker", e.target.value)} placeholder="Select speaker..." /></div>
          </div>
        </div>
      </div>
      <div className="page-footer"><span /><Button label="Apply Profile" variant="primary" disabled={!selected} /></div>
    </div>
  );
}
