import { useState } from "react";
import { MOCK_DEVICES } from "../../data/mockData";
import CameraThumb from "../../components/shared/CameraThumb";
import Toggle from "../../components/shared/Toggle";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";
import StatusBadge from "../../components/shared/StatusBadge";
import ManualSearchModal from "./ManualSearchModal";
import StreamURLModal from "./StreamURLModal";
import "./AddDevicesPage.css";

export default function AddDevicesPage() {
  const [filter, setFilter] = useState("");
  const [includePrerecorded, setInclude] = useState(true);
  const [checked, setChecked] = useState([]);
  const [showManualSearch, setShowManualSearch] = useState(false); 
  const [showStreamURL, setShowStreamURL] = useState(false);

  const filtered = MOCK_DEVICES.filter((d) =>
    d.name.toLowerCase().includes(filter.toLowerCase()) ||
    d.ip.toLowerCase().includes(filter.toLowerCase())
  );
  const allChecked = filtered.length > 0 && filtered.every((d) => checked.includes(d.id));
  const toggleAll  = () => setChecked(allChecked ? [] : filtered.map((d) => d.id));
  const toggleOne  = (id) => setChecked((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Add <span>Devices</span></h1>
          <p className="page-desc">Discover and enroll devices from your network into the MIRADORAI VMS platform.</p>
        </div>
        <div className="add-dev__toolbar">
          <Button label="Manual Search" icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`} onClick={() => setShowManualSearch(true)} />
          <Button label="Stream URL" icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`}onClick={() =>setShowStreamURL(true)} />
          <Button label="Refresh" icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`}/>
        </div>
        
      </div>

      {/* Options bar */}
      <div className="add-dev__options-bar">
        <div className="add-dev__toggle-row">
          <Toggle value={includePrerecorded} onChange={setInclude} />
          <span>Include prerecorded video</span>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Filter devices..." />
      </div>

      {/* Info pill */}
      <div className="add-dev__info-pill">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8h.01M12 12v4"/></svg>
        Refresh to sync latest devices from the server.
      </div>

      {/* Table */}
      <div className="add-dev__table-wrap card">
        <table className="m-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}><input type="checkbox" className="m-checkbox" checked={allChecked} onChange={toggleAll} /></th>
              <th style={{ width: 60 }}></th>
              {["Device Name", "IP Address", "MAC Address", "Status", "Manufacturer", "Model"].map((c) => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => {
              const isSel = checked.includes(d.id);
              return (
                <tr key={d.id} className={`m-table__row ${isSel ? "m-table__row--selected" : ""}`} onClick={() => toggleOne(d.id)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="m-checkbox" checked={isSel} onChange={() => toggleOne(d.id)} /></td>
                  <td><CameraThumb type={d.type} /></td>
                  <td className="m-table__primary">{d.name}</td>
                  <td><code className="add-dev__ip">{d.ip}</code></td>
                  <td><code className="add-dev__ip">{d.mac}</code></td>
                  <td><StatusBadge status={d.status} /></td>
                  <td>{d.manufacturer}</td>
                  <td>{d.model}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="page-footer">
        <span className="add-dev__count">{filtered.length} device{filtered.length !== 1 ? "s" : ""} discovered · {filtered.filter(d => d.status === "Online").length} online</span>
        <Button
          label={checked.length > 0 ? `Enroll ${checked.length} Device${checked.length > 1 ? "s" : ""}` : "Enroll"}
          variant="primary"
          disabled={checked.length === 0}
        />
      </div>
      {showManualSearch && (
        <ManualSearchModal
          onClose={() => setShowManualSearch(false)}
          onEnroll={(device) => {
            console.log("Enrolled device:", device);
          
            setShowManualSearch(false);
          }}
       
        />
      )}
      {showStreamURL && (
        <StreamURLModal
          onClose={() => setShowStreamURL(false)}
          onAdd={(urls) => {
            console.log("Stream URLs added:", urls);
            setShowStreamURL(false);
        }}
      />
    )}
    </div>
    //jj
  );
}
