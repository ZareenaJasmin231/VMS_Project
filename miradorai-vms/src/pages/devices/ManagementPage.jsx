import { useState, useMemo } from "react";
import SearchBar from "../../components/shared/SearchBar";
import "./ManagementPage.css";

/* ── toolbar actions (matching reference icons left-to-right) ── */
const TOOLBAR = [
  { key: "assign-ip",    title: "Assign IP address",      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h2m2 0h2M6 14h4"/></svg> },
  { key: "info",         title: "Device info",             icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg> },
  { key: "upgrade",      title: "Upgrade firmware",        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 16V8m-4 4 4-4 4 4"/><path d="M4 20h16"/></svg> },
  { key: "factory",      title: "Factory default",         icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 3v6h6"/></svg> },
  { key: "restart",      title: "Restart",                 icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.8.99 6.48 2.58L21 8"/><path d="M21 3v5h-5"/></svg> },
  { key: "pulse",        title: "Identify",                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 12h3l3-8 4 16 3-8h4"/></svg> },
  { key: "configure",    title: "Configure",               icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93A10 10 0 0 0 4.93 19.07M4.93 4.93a10 10 0 0 0 14.14 14.14"/></svg> },
  { key: "sync",         title: "Synchronize",             icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 4v6h6M20 20v-6h-6"/><path d="M20 10A8 8 0 0 0 5.64 5.64M4 14a8 8 0 0 0 14.36 4.36"/></svg> },
];

function loadDevices() {
  try {
    const saved = localStorage.getItem("miradorai_devices");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function StatusBadge({ status }) {
  const ok = !status || status.toLowerCase() === "ok" || status.toLowerCase() === "online";
  return (
    <span className={`mgmt-status-badge ${ok ? "mgmt-status-badge--ok" : "mgmt-status-badge--warn"}`}>
      <span className="mgmt-status-dot" />
      {status || "OK"}
    </span>
  );
}

export default function ManagementPage() {
  const [filter, setFilter]   = useState("");
  const [selected, setSelected] = useState(null);

  const allDevices = loadDevices();

  const devices = useMemo(() => {
    if (!filter) return allDevices;
    const q = filter.toLowerCase();
    return allDevices.filter((d) =>
      [d.name, d.mac, d.ip, d.manufacturer, d.model, d.firmware].some(
        (v) => v && String(v).toLowerCase().includes(q)
      )
    );
  }, [filter, allDevices.length]);

  const total   = allDevices.length;
  const online  = allDevices.filter((d) => !d.status || d.status.toLowerCase() === "ok" || d.status.toLowerCase() === "online").length;
  const needsUpd = allDevices.filter((d) => d.needsUpdate).length;
  const alerts  = allDevices.filter((d) => d.alert).length;

  const selectedDevice = allDevices.find((d) => String(d.id) === String(selected));

  const handleRowClick = (id) => setSelected((prev) => prev === id ? null : id);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Manage <span>Devices</span></h1>
          <p className="page-desc">Firmware updates, security settings, network config, and device lifecycle management.</p>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Type to filter" />
      </div>

      {/* Toolbar — matches reference icon row */}
      <div className="mgmt-toolbar card">
        {TOOLBAR.map(({ key, title, icon }) => (
          <button key={key} className="mgmt-btn" title={title}>
            <span className="mgmt-btn__icon">{icon}</span>
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div className="mgmt-stats">
        {[
          [total,    "Total Devices",  ""],
          [online,   "Online",         "ok"],
          [needsUpd, "Needs Update",   needsUpd > 0 ? "warn" : ""],
          [alerts,   "Alerts",         alerts   > 0 ? "danger" : ""],
        ].map(([n, l, variant]) => (
          <div key={l} className={`mgmt-stat card ${variant ? `mgmt-stat--${variant}` : ""}`}>
            <span className="mgmt-stat__num">{n}</span>
            <span className="mgmt-stat__label">{l}</span>
          </div>
        ))}
      </div>

      {/* Device count label — matches "1 devices, 0 selected" in reference */}
      <div className="mgmt-count-row">
        <span className="mgmt-count-label">
          {total} device{total !== 1 ? "s" : ""},{" "}
          {selected ? "1" : "0"} selected
        </span>
      </div>

      {/* Main table — matches reference columns exactly */}
      <div className="card mgmt-table-wrap">
        <table className="m-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>Name</th>
              <th>MAC Address</th>
              <th>Status</th>
              <th>Address</th>
              <th>Manufacturer</th>
              <th>Model</th>
              <th>Firmware</th>
              <th>DHCP</th>
              <th>HTTPS</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan={10} className="m-table__empty">
                  {allDevices.length === 0
                    ? "No devices enrolled. Go to Add Devices to get started."
                    : "No devices match your filter."}
                </td>
              </tr>
            ) : devices.map((d) => {
              const isSel = String(d.id) === String(selected);
              return (
                <tr
                  key={d.id}
                  className={`m-table__row ${isSel ? "m-table__row--selected" : ""}`}
                  onClick={() => handleRowClick(String(d.id))}
                >
                  <td>
                    <span className="mgmt-cam-thumb">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <path d="M23 7l-7 5 7 5V7z"/>
                        <rect x="1" y="5" width="15" height="14" rx="2"/>
                      </svg>
                    </span>
                  </td>
                  <td className="m-table__primary">{d.name || "—"}</td>
                  <td className="mgmt-mono">{d.mac || "—"}</td>
                  <td><StatusBadge status={d.status} /></td>
                  <td>
                    {d.ip
                      ? <span className="mgmt-ip-link">{d.ip}</span>
                      : "—"}
                  </td>
                  <td>{d.manufacturer || "—"}</td>
                  <td>{d.model || "—"}</td>
                  <td className="mgmt-mono">{d.firmware || "—"}</td>
                  <td>
                    <span className={`mgmt-pill ${d.dhcp ? "mgmt-pill--on" : "mgmt-pill--off"}`}>
                      {d.dhcp ? "Yes" : "No"}
                    </span>
                  </td>
                  <td>
                    <span className={`mgmt-pill ${d.https ? "mgmt-pill--on" : "mgmt-pill--off"}`}>
                      {d.https ? "On" : "Off"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Device detail panel — shown when a row is selected (ImageConfigPage pattern) */}
      {selectedDevice && (
        <div className="mgmt-detail card">
          <div className="mgmt-detail__header">
            <span className="mgmt-detail__title">{selectedDevice.name}</span>
            <button className="mgmt-detail__close" onClick={() => setSelected(null)}>✕</button>
          </div>
          <div className="mgmt-detail__grid">
            {[
              ["IP Address",    selectedDevice.ip          || "—"],
              ["MAC Address",   selectedDevice.mac         || "—"],
              ["Manufacturer",  selectedDevice.manufacturer|| "—"],
              ["Model",         selectedDevice.model       || "—"],
              ["Firmware",      selectedDevice.firmware    || "—"],
              ["DHCP",          selectedDevice.dhcp ? "Yes" : "No"],
              ["HTTPS",         selectedDevice.https ? "On" : "Off"],
              ["Status",        selectedDevice.status      || "OK"],
            ].map(([label, value]) => (
              <div key={label} className="mgmt-detail__item">
                <span className="mgmt-detail__key">{label}</span>
                <span className="mgmt-detail__val">{value}</span>
              </div>
            ))}
          </div>
          <div className="mgmt-detail__actions">
            <button className="mgmt-action-btn">Upgrade Firmware</button>
            <button className="mgmt-action-btn">Restart Device</button>
            <button className="mgmt-action-btn mgmt-action-btn--danger">Factory Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}