import { useState } from "react";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";
import "./IOPortsPage.css";

const PORT_TYPES = ["Input", "Output", "Virtual Input"];
const ACTIVE_STATES   = ["Open circuit", "Closed circuit", "High", "Low"];
const INACTIVE_STATES = ["Open circuit", "Closed circuit", "High", "Low"];

function loadDevices() {
  try {
    const saved = localStorage.getItem("miradorai_devices");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function loadPorts() {
  try {
    const saved = localStorage.getItem("miradorai_io_ports");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function savePorts(ports) {
  try {
    localStorage.setItem("miradorai_io_ports", JSON.stringify(ports));
  } catch {}
}

// ── Add/Edit Modal ────────────────────────────────────────────
function PortModal({ port, devices, onSave, onClose }) {
  const [form, setForm] = useState(
    port ?? {
      id: Date.now(),
      deviceId: devices[0]?.id ?? "",
      type: "Input",
      name: "",
      activeState: "Open circuit",
      inactiveState: "Closed circuit",
    }
  );
  const s = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="iop-modal-overlay" onClick={onClose}>
      <div className="iop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="iop-modal__header">
          <span>{port ? "Edit I/O Port" : "Add I/O Port"}</span>
          <button className="iop-modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="iop-modal__body">
          <div className="iop-modal__field">
            <label>I/O Port (Device)</label>
            <select value={form.deviceId} onChange={(e) => s("deviceId", e.target.value)}
              className="iop-select">
              <option value="">— Select device —</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div className="iop-modal__field">
            <label>Type</label>
            <select value={form.type} onChange={(e) => s("type", e.target.value)}
              className="iop-select">
              {PORT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>

          <div className="iop-modal__field">
            <label>Name</label>
            <input className="iop-input" value={form.name}
              onChange={(e) => s("name", e.target.value)}
              placeholder="Enter port name..." />
          </div>

          <div className="iop-modal__field">
            <label>Active state</label>
            <select value={form.activeState} onChange={(e) => s("activeState", e.target.value)}
              className="iop-select">
              {ACTIVE_STATES.map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>

          <div className="iop-modal__field">
            <label>Inactive state</label>
            <select value={form.inactiveState} onChange={(e) => s("inactiveState", e.target.value)}
              className="iop-select">
              {INACTIVE_STATES.map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <div className="iop-modal__footer">
          <Button label="Cancel" onClick={onClose} />
          <Button label="Save" variant="primary"
            disabled={!form.deviceId || !form.name}
            onClick={() => onSave(form)} />
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function IOPortsPage() {
  const [filter,    setFilter]    = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [ports,     setPorts]     = useState(loadPorts);
  const [modal,     setModal]     = useState(null); // null | "add" | "edit"

  const devices = loadDevices();

  const filtered = ports.filter((p) => {
    if (!filter) return true;
    const device = devices.find((d) => String(d.id) === String(p.deviceId));
    return [device?.name, p.type, p.name, p.activeState, p.inactiveState]
      .filter(Boolean)
      .some((v) => v.toLowerCase().includes(filter.toLowerCase()));
  });

  const selected = ports.find((p) => p.id === selectedId) ?? null;

  const handleSave = (form) => {
    const updated = modal === "edit"
      ? ports.map((p) => p.id === form.id ? form : p)
      : [...ports, { ...form, id: Date.now() }];
    setPorts(updated);
    savePorts(updated);
    setModal(null);
    setSelectedId(form.id);
  };

  const handleRemove = () => {
    if (!selectedId) return;
    const updated = ports.filter((p) => p.id !== selectedId);
    setPorts(updated);
    savePorts(updated);
    setSelectedId(null);
  };

  const handleReload = () => {
    // Re-read from localStorage (simulates a server reload)
    setPorts(loadPorts());
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Available <span>I/O Ports</span></h1>
          <p className="page-desc">
            Select which I/O ports to use in action rules. Change names and set the active and inactive states.
          </p>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Type to filter" />
      </div>

      {/* Table */}
      <div className="iop-table-wrap">
        <table className="iop-table">
          <thead>
            <tr>
              <th>I/O Port</th>
              <th>Type</th>
              <th>Name</th>
              <th>Active state</th>
              <th>Inactive state</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="iop-table__empty">
                  No I/O ports configured. Click Add… to create one.
                </td>
              </tr>
            ) : filtered.map((p) => {
              const device = devices.find((d) => String(d.id) === String(p.deviceId));
              return (
                <tr
                  key={p.id}
                  className={p.id === selectedId ? "iop-row--selected" : ""}
                  onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}
                >
                  <td>
                    <div className="iop-port-cell">
                      {device?.snapshot_url
                        ? <img src={device.snapshot_url} className="iop-thumb" alt="" />
                        : <div className="iop-thumb iop-thumb--placeholder">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M23 7l-7 5 7 5V7z"/>
                              <rect x="1" y="5" width="15" height="14" rx="2"/>
                            </svg>
                          </div>
                      }
                      <span>{device?.name ?? "Unknown device"}</span>
                    </div>
                  </td>
                  <td>{p.type}</td>
                  <td>{p.name}</td>
                  <td>{p.activeState}</td>
                  <td>{p.inactiveState}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer action bar */}
      <div className="iop-footer">
        <Button label="Reload I/O Ports" onClick={handleReload} />
        <Button label="Add…"    variant="primary" onClick={() => setModal("add")} />
        <Button label="Edit…"   disabled={!selectedId} onClick={() => setModal("edit")} />
        <Button label="Remove"  disabled={!selectedId} onClick={handleRemove} />
      </div>

      {/* Modal */}
      {(modal === "add" || modal === "edit") && (
        <PortModal
          port={modal === "edit" ? selected : null}
          devices={devices}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}