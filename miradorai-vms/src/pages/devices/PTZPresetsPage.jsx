import { useState } from "react";
import DataTable from "../../components/shared/DataTable";
import Button from "../../components/shared/Button";
import "./PTZPresetsPage.css";

export default function PTZPresetsPage() {
  const [presets, setPresets]   = useState([]);
  const [selPreset, setSelPreset] = useState(null);
  const [adding, setAdding]     = useState(false);
  const [newName, setNewName]   = useState("");

  const add = () => { if (newName.trim()) { setPresets((p) => [...p, { id: Date.now(), name: newName.trim() }]); setNewName(""); setAdding(false); } };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">PTZ <span>Presets</span></h1>
          <p className="page-desc">Define and manage pan, tilt, and zoom preset positions for compatible cameras.</p>
        </div>
      </div>
      <DataTable columns={["Camera Name", "PTZ Model", "Server"]} rows={[]} selectedId={null} onSelect={null} emptyMessage="No PTZ-capable cameras found." />

      <div className="ptz-bottom">
        <div className="ptz-preview card">
          <div className="ptz-preview__inner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
            <span>No camera selected</span>
          </div>
        </div>
        <div className="ptz-side card">
          <div className="ptz-side__title">Saved Presets</div>
          <div className="ptz-side__list">
            {presets.length === 0 && <div className="ptz-empty">No presets saved yet.</div>}
            {presets.map((p) => (
              <div key={p.id} className={`ptz-preset-item ${selPreset === p.id ? "ptz-preset-item--active" : ""}`}
                onClick={() => setSelPreset(selPreset === p.id ? null : p.id)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 13, height: 13, flexShrink: 0 }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
                {p.name}
              </div>
            ))}
            {adding && (
              <div className="ptz-add-row">
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") setAdding(false); }}
                  placeholder="Preset name..." className="ptz-add-input" />
              </div>
            )}
          </div>
          <div className="ptz-side__actions">
            <Button label="Refresh" />
            <Button label="+ Add" onClick={() => setAdding(true)} />
            <Button label="Remove" variant="danger" disabled={!selPreset}
              onClick={() => { setPresets((p) => p.filter((x) => x.id !== selPreset)); setSelPreset(null); }} />
          </div>
        </div>
      </div>
    </div>
  );
}
