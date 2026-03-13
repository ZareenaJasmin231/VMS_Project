import { useState } from "react";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";
import Modal from "../../components/shared/Modal";
import "./CamerasPage.css";

function loadDevices() {
  try {
    const saved = localStorage.getItem("miradorai_devices");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function saveDevices(devices) {
  try { localStorage.setItem("miradorai_devices", JSON.stringify(devices)); } catch {}
}

export default function CamerasPage() {
  const [cameras, setCameras] = useState(loadDevices);
  const [filter, setFilter]         = useState("");
  const [selected, setSelected]     = useState(null);
  const [editModal, setEditModal]     = useState(null);
  const [removeModal, setRemoveModal] = useState(null);
  const [editForm, setEditForm]       = useState({});
  const [authModal, setAuthModal]     = useState(null);
  const [authForm, setAuthForm]       = useState({ username: "", password: "" });

  const filtered = cameras.filter((c) =>
    !filter ||
    [c.name, c.ip, c.mac, c.model, c.manufacturer, c.channel, c.server].some(
      (v) => v && String(v).toLowerCase().includes(filter.toLowerCase())
    )
  );

  const openEdit = (c) => {
    setEditForm({
      enabled:     c.enabled !== false,
      name:        c.name        || "",
      description: c.description || "",
      ip:          c.ip          || "",
      port:        c.port        || "80",
      username:    c.username    || "",
      password:    c.password    || "",
    });
    setEditModal(c);
  };

  const saveEdit = () => {
    const updated = cameras.map((c) =>
      String(c.id) === String(editModal.id) ? { ...c, ...editForm } : c
    );
    setCameras(updated);
    saveDevices(updated);
    setEditModal(null);
  };

  // Open Authentication Required dialog when IP address is clicked
  const openAuth = (e, c) => {
    e.stopPropagation();
    setAuthForm({ username: c.username || "", password: c.password || "" });
    setAuthModal(c);
  };

  // On Auth OK — save credentials to camera, then pre-fill Edit modal credentials
  const confirmAuth = () => {
    const updated = cameras.map((c) =>
      String(c.id) === String(authModal.id)
        ? { ...c, username: authForm.username, password: authForm.password }
        : c
    );
    setCameras(updated);
    saveDevices(updated);
    // If edit modal is open for the same camera, update its credentials too
    if (editModal && String(editModal.id) === String(authModal.id)) {
      setEditForm((f) => ({ ...f, username: authForm.username, password: authForm.password }));
    }
    setAuthModal(null);
  };

  const confirmRemove = () => {
    const updated = cameras.filter((c) => String(c.id) !== String(removeModal.id));
    setCameras(updated);
    saveDevices(updated);
    setSelected(null);
    setRemoveModal(null);
  };

  const selectedCam = cameras.find((c) => String(c.id) === String(selected));

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title"><span>Camera</span> Registry</h1>
          <p className="page-desc">
            Change the names, addresses, and ports of cameras. You can also disable or remove the cameras from the server.
          </p>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Type to filter" />
      </div>

      {/* Main table — matches reference exactly */}
      <div className="card cam-table-wrap">
        <table className="m-table">
          <thead>
            <tr>
              <th style={{ width: 52 }}></th>
              <th>Name</th>
              <th>Address</th>
              <th>MAC Address</th>
              <th>Manufacturer</th>
              <th>Model</th>
              <th>Channel</th>
              <th>Server</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="m-table__empty">
                  {cameras.length === 0
                    ? "No cameras enrolled. Go to Add Devices to get started."
                    : "No cameras match your filter."}
                </td>
              </tr>
            ) : filtered.map((c) => {
              const isSel = String(selected) === String(c.id);
              return (
                <tr
                  key={c.id}
                  className={`m-table__row ${isSel ? "m-table__row--selected" : ""}`}
                  onClick={() => setSelected(isSel ? null : String(c.id))}
                  onDoubleClick={() => openEdit(c)}
                >
                  {/* Thumbnail */}
                  <td>
                    <div className="cam-thumb-cell">
                      {c.snapshot ? (
                        <img src={c.snapshot} alt={c.name} className="cam-thumb-img" />
                      ) : (
                        <div className="cam-thumb-placeholder">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                            <path d="M23 7l-7 5 7 5V7z"/>
                            <rect x="1" y="5" width="15" height="14" rx="2"/>
                          </svg>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="m-table__primary">{c.name || "—"}</td>
                  <td>
                    {c.ip
                      ? <span className="cam-ip-link" onClick={(e) => openAuth(e, c)}>{c.ip}</span>
                      : "—"}
                  </td>
                  <td className="cam-mono">{c.mac || "—"}</td>
                  <td>{c.manufacturer || "—"}</td>
                  <td>{c.model || "—"}</td>
                  <td>{c.channel || "—"}</td>
                  <td>{c.server || "MIRADORAI"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="page-footer">
        <span className="cameras-count">
          {filtered.length} camera{filtered.length !== 1 ? "s" : ""}
        </span>
        <div className="page-footer-right">
          <Button label="Edit" disabled={!selected} onClick={() => selectedCam && openEdit(selectedCam)} />
          <Button label="Remove" variant="danger" disabled={!selected}
            onClick={() => selectedCam && setRemoveModal(selectedCam)} />
        </div>
      </div>

      {/* Edit Camera Modal — matches reference exactly */}
      {editModal && (
        <div className="ec-overlay" onClick={() => setEditModal(null)}>
          <div className="ec-modal" onClick={(e) => e.stopPropagation()}>
            {/* Title bar */}
            <div className="ec-titlebar">
              <span className="ec-title">Edit Camera</span>
              <div className="ec-titlebar-actions">
                <button className="ec-title-btn" title="Help">?</button>
                <button className="ec-title-btn" onClick={() => setEditModal(null)} title="Close">✕</button>
              </div>
            </div>

            <div className="ec-body">
              {/* Settings section */}
              <div className="ec-section-title">Settings</div>

              <label className="ec-checkbox-row">
                <input type="checkbox" checked={editForm.enabled}
                  onChange={(e) => setEditForm((f) => ({ ...f, enabled: e.target.checked }))} />
                <span>Enabled</span>
              </label>

              <div className="ec-field-row">
                <label className="ec-field-label">Name:</label>
                <input className="ec-input ec-input--highlight" value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
              </div>

              <div className="ec-field-row ec-field-row--top">
                <label className="ec-field-label">Description:</label>
                <textarea className="ec-textarea" rows={3} value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
              </div>

              <div className="ec-field-row">
                <label className="ec-field-label">Address:</label>
                <input className="ec-input" value={editForm.ip}
                  onChange={(e) => setEditForm((f) => ({ ...f, ip: e.target.value }))} />
              </div>

              <div className="ec-field-row">
                <label className="ec-field-label">Port:</label>
                <input className="ec-input ec-input--short" value={editForm.port}
                  onChange={(e) => setEditForm((f) => ({ ...f, port: e.target.value }))} />
              </div>

              {/* Credentials section */}
              <div className="ec-section-title ec-section-title--spaced">Credentials</div>

              <div className="ec-field-row">
                <label className="ec-field-label">Username:</label>
                <input className="ec-input" value={editForm.username}
                  onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))} />
              </div>

              <div className="ec-field-row">
                <label className="ec-field-label">Password:</label>
                <input className="ec-input" type="password" value={editForm.password}
                  onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))} />
              </div>
            </div>

            {/* Footer buttons — Help | OK | Cancel */}
            <div className="ec-footer">
              <button className="ec-btn ec-btn--help">Help</button>
              <div className="ec-footer-right">
                <button className="ec-btn ec-btn--primary" onClick={saveEdit}>OK</button>
                <button className="ec-btn ec-btn--cancel" onClick={() => setEditModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Remove Modal */}
      {removeModal && (
        <Modal title="Remove Camera" onClose={() => setRemoveModal(null)}
          onConfirm={confirmRemove} confirmLabel="Remove" confirmVariant="danger">
          <p className="m-confirm-text">
            Remove <strong style={{ color: "var(--text-primary)" }}>{removeModal.name}</strong> from MIRADORAI VMS?
          </p>
          <p className="m-confirm-warn">
            This will delete all associated recordings and configurations.
          </p>
        </Modal>
      )}
      {/* Authentication Required Modal */}
      {authModal && (
        <div className="ec-overlay" onClick={() => setAuthModal(null)}>
          <div className="ec-modal" onClick={(e) => e.stopPropagation()}>
            {/* Title bar */}
            <div className="ec-titlebar">
              <span className="ec-title">Authentication Required</span>
              <div className="ec-titlebar-actions">
                <button className="ec-title-btn" title="Help">?</button>
                <button className="ec-title-btn" onClick={() => setAuthModal(null)} title="Close">✕</button>
              </div>
            </div>

            <div className="ec-body">
              <p className="ec-auth-desc">
                The device configuration tab of{" "}
                <strong>'{authModal.name}'</strong> is requesting a username and password.
              </p>

              <div className="ec-field-row">
                <label className="ec-field-label">Username:</label>
                <input
                  className="ec-input ec-input--highlight"
                  value={authForm.username}
                  autoFocus
                  onChange={(e) => setAuthForm((f) => ({ ...f, username: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && confirmAuth()}
                />
              </div>

              <div className="ec-field-row">
                <label className="ec-field-label">Password:</label>
                <input
                  className="ec-input"
                  type="password"
                  value={authForm.password}
                  onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && confirmAuth()}
                />
              </div>
            </div>

            <div className="ec-footer">
              <button className="ec-btn ec-btn--help">Help</button>
              <div className="ec-footer-right">
                <button className="ec-btn ec-btn--primary" onClick={confirmAuth}>OK</button>
                <button className="ec-btn ec-btn--cancel" onClick={() => setAuthModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}