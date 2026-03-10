import { useState } from "react";
import { MGMT_TOOLBAR } from "../../data/mockData";
import SearchBar from "../../components/shared/SearchBar";
import "./ManagementPage.css";

export default function ManagementPage() {
  const [filter, setFilter] = useState("");
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Device <span>Management</span></h1>
          <p className="page-desc">Firmware updates, security settings, network config, and device lifecycle management.</p>
        </div>
        <SearchBar value={filter} onChange={setFilter} />
      </div>
      <div className="mgmt-toolbar card">
        {MGMT_TOOLBAR.map(({ label, icon }) => (
          <button key={label} className="mgmt-btn" title={label}>
            <span className="mgmt-btn__icon">{icon}</span>
            <span className="mgmt-btn__label">{label}</span>
          </button>
        ))}
      </div>
      <div className="mgmt-stats">
        {[["0", "Total Devices"], ["0", "Online"], ["0", "Needs Update"], ["0", "Alerts"]].map(([n, l]) => (
          <div key={l} className="mgmt-stat card">
            <span className="mgmt-stat__num">{n}</span>
            <span className="mgmt-stat__label">{l}</span>
          </div>
        ))}
      </div>
      <div className="card" style={{ flex: 1, overflow: "auto" }}>
        <table className="m-table">
          <thead><tr>{["", "Name", "MAC Address", "Status", "Address", "Model", "Firmware"].map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody><tr><td colSpan={7} style={{ height: 160, textAlign: "center", color: "var(--text-muted)" }}>No devices enrolled. Go to Add Devices to get started.</td></tr></tbody>
        </table>
      </div>
    </div>
  );
}
