import { useState } from "react";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";
import Modal from "../../components/shared/Modal";
import { CAMERA_FEATURES_CONFIG } from "../../data/navConfig";
import "./CamerasPage.css";
import MaskingPage from "./MaskingPage";
import { useNavigate } from "react-router-dom";
import useActivityLogger from "../../hooks/useActivityLogger";

function loadDevices() {
  try {
    const saved = localStorage.getItem("miradorai_devices");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function loadGroups() {
  try {
    const saved = localStorage.getItem("miradorai_groups");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function saveDevices(devices) {
  try { localStorage.setItem("miradorai_devices", JSON.stringify(devices)); } catch {}
}

const API_BASE = "http://192.168.126.200:8000";
const INLINE_PAGES = ["masking"];

export default function CamerasPage({ onNavigate, onCameraSelect }) {
  const [cameras, setCameras]           = useState(loadDevices);
  const [groups]                        = useState(loadGroups);
  const [filter, setFilter]             = useState("");
  const [selected, setSelected]         = useState(null);
  const [checked, setChecked]           = useState([]);
  const [editModal, setEditModal]       = useState(null);
  const [editForm, setEditForm]         = useState({});
  const [authModal, setAuthModal]       = useState(null);
  const [authForm, setAuthForm]         = useState({ username: "", password: "" });
  const [activePage, setActivePage]     = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupChecked, setGroupChecked] = useState([]);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const navigate = useNavigate();
  const { logAction } = useActivityLogger();

  // ── Build grouped data ──
  const groupedData = Object.values(
    cameras.reduce((acc, cam) => {
      const gid = cam.group_id || "default";
      if (!acc[gid]) {
        acc[gid] = {
          group_id: gid,
          name: gid === "default"
            ? "Default"
            : (groups.find(g => g.id === gid)?.name || gid),
          cameras: [],
        };
      }
      acc[gid].cameras.push(cam);
      return acc;
    }, {})
  );

  // Filter groups by search
  const filteredGroups = groupedData.filter((group) =>
    !filter ||
    group.name.toLowerCase().includes(filter.toLowerCase()) ||
    group.cameras.some((c) =>
      [c.name, c.ip, c.mac, c.model, c.manufacturer].some(
        (v) => v && String(v).toLowerCase().includes(filter.toLowerCase())
      )
    )
  );

  const allChecked = filteredGroups.length > 0 && filteredGroups.every((g) => checked.includes(g.group_id));
  const toggleAll  = () => setChecked(allChecked ? [] : filteredGroups.map((g) => g.group_id));
  const toggleGroup = (gid) => setChecked((s) =>
    s.includes(gid) ? s.filter((x) => x !== gid) : [...s, gid]
  );

  const toggleGroupEnabled = (groupId) => {
    const groupCams = cameras.filter(c => (c.group_id || "default") === groupId);
    const allEnabled = groupCams.every(c => c.enabled !== false);
    const updated = cameras.map(c =>
      (c.group_id || "default") === groupId
        ? { ...c, enabled: !allEnabled }
        : c
    );
    setCameras(updated);
    saveDevices(updated);
  };

  const openGroupPanel = (group) => {
    setSelectedGroup(group);
    setGroupChecked([]);
  };

  const toggleGroupCam = (camId) => {
    setGroupChecked((s) =>
      s.includes(camId) ? s.filter((x) => x !== camId) : [...s, camId]
    );
  };

  const handleDeleteGroupCams = () => {
    const updated = cameras.filter(c => !groupChecked.includes(c.id));
    setCameras(updated);
    saveDevices(updated);
    setGroupChecked([]);
    if (selectedGroup) {
      const updatedGroup = {
        ...selectedGroup,
        cameras: selectedGroup.cameras.filter(c => !groupChecked.includes(c.id)),
      };
      setSelectedGroup(updatedGroup.cameras.length > 0 ? updatedGroup : null);
    }
  };

  const handleMoveToGroup = (targetGroupId) => {
    const updated = cameras.map(c =>
      groupChecked.includes(c.id)
        ? { ...c, group_id: targetGroupId }
        : c
    );
    setCameras(updated);
    saveDevices(updated);
    setShowMoveModal(false);
    setGroupChecked([]);
    setSelectedGroup(null);
  };

  const callCameraAction = (cam, action) => {
    if (!cam.ip) return;
    const ip     = encodeURIComponent(cam.ip);
    const url    = `${API_BASE}/api/cameras/by-ip/${ip}/${action}`;
    const method = action === "delete" ? "DELETE" : "POST";
    fetch(url, { method })
      .then((r) => r.json())
      .then((d) => console.log(`[CAMERA] ${action} OK for ${cam.ip}:`, d))
      .catch((err) => console.error(`[CAMERA] ${action} FAILED for ${cam.ip}:`, err));
  };

  const toggleEnabled = (cam, e) => {
    e.stopPropagation();
    const willBeEnabled = cam.enabled === false;
    const updated = cameras.map((c) =>
      String(c.id) === String(cam.id) ? { ...c, enabled: willBeEnabled } : c
    );
    setCameras(updated);
    saveDevices(updated);

    // Also update selectedGroup state so panel reflects change immediately
    if (selectedGroup) {
      setSelectedGroup((sg) => ({
        ...sg,
        cameras: sg.cameras.map((c) =>
          String(c.id) === String(cam.id) ? { ...c, enabled: willBeEnabled } : c
        ),
      }));
    }

    callCameraAction(cam, willBeEnabled ? "enable" : "disable");
    logAction(
      willBeEnabled ? "Camera enabled" : "Camera disabled",
      "camera",
      { ip: cam.ip }
    );
  };

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
    const prev    = cameras.find((c) => String(c.id) === String(editModal.id));
    const updated = cameras.map((c) =>
      String(c.id) === String(editModal.id) ? { ...c, ...editForm } : c
    );
    setCameras(updated);
    saveDevices(updated);
    if (prev) {
      const wasEnabled = prev.enabled !== false;
      const nowEnabled = editForm.enabled;
      if (wasEnabled && !nowEnabled) callCameraAction(editModal, "disable");
      else if (!wasEnabled && nowEnabled) callCameraAction(editModal, "enable");
    }
    setEditModal(null);
  };

  const openAuth = (e, c) => {
    e.stopPropagation();
    setAuthForm({ username: c.username || "", password: c.password || "" });
    setAuthModal(c);
  };

  const confirmAuth = () => {
    const updated = cameras.map((c) =>
      String(c.id) === String(authModal.id)
        ? { ...c, username: authForm.username, password: authForm.password }
        : c
    );
    setCameras(updated);
    saveDevices(updated);
    if (editModal && String(editModal.id) === String(authModal.id)) {
      setEditForm((f) => ({ ...f, username: authForm.username, password: authForm.password }));
    }
    setAuthModal(null);
  };

  const handleRemoveGroups = async () => {
    if (checked.length === 0) return;
    const camIdsToRemove = cameras
      .filter(c => checked.includes(c.group_id || "default"))
      .map(c => c.id);

    const camsToRemove = cameras.filter(c => camIdsToRemove.includes(c.id));
    for (const cam of camsToRemove) {
      try {
        const ip  = encodeURIComponent(cam.ip);
        const res = await fetch(`${API_BASE}/api/cameras/by-ip/${ip}/delete`, { method: "DELETE" });
        const data = await res.json();
        console.log("✅ Deleted from DB:", data);
        logAction("Camera deleted", "camera", { ip: cam.ip });
      } catch (err) {
        console.error("❌ Delete failed:", err);
      }
    }

    const updated = cameras.filter(c => !camIdsToRemove.includes(c.id));
    setCameras(updated);
    saveDevices(updated);
    setChecked([]);
    setSelectedGroup(null);
  };

  // All unique groups for Move To modal
  const allGroupOptions = [
    { id: "default", name: "Default" },
    ...groups.map(g => ({ id: g.id, name: g.name })),
  ];

  const selectedCam = null;

  /* ── Inline masking page ── */
  if (activePage === "masking" && selectedCam) {
    return (
      <div className="page-shell">
        <div className="page-header">
          <div>
            <h1 className="page-title"><span>Masking</span></h1>
            <p className="page-desc">{selectedCam.name || selectedCam.ip}</p>
          </div>
          <button
            className="ec-btn ec-btn--cancel"
            style={{ alignSelf: "center" }}
            onClick={() => setActivePage(null)}
          >
            ← Back to Cameras
          </button>
        </div>
        <MaskingPage camera={selectedCam} />
      </div>
    );
  }

  return (
    <div className="page-shell">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title"><span>Manage</span> Camera Groups</h1>
          <p className="page-desc">
            Manage camera groups. View, move, or remove cameras within each group.
          </p>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Type to filter" />
      </div>

      {/* ── Main layout: table + side panel ── */}
      <div className={`cameras-content-layout ${selectedGroup ? "has-panel" : ""}`}>

        {/* ── Group table ── */}
        <div className="card cam-table-wrap">
          <table className="m-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    className="m-checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                  />
                </th>
                <th style={{ width: 72 }}>Active</th>
                <th>Group Name</th>
                <th style={{ width: 160 }}>Total Cameras</th>
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="m-table__empty">
                    {cameras.length === 0
                      ? "No cameras enrolled. Go to Add Devices to get started."
                      : "No groups match your filter."}
                  </td>
                </tr>
              ) : filteredGroups.map((group) => {
                const total       = group.cameras.length;
                const activeCount = group.cameras.filter(c => c.enabled !== false).length;
                const isChecked   = checked.includes(group.group_id);
                const isSel       = selectedGroup?.group_id === group.group_id;

                return (
                  <tr
                    key={group.group_id}
                    className={[
                      "m-table__row",
                      isSel     ? "m-table__row--selected" : "",
                      isChecked ? "m-table__row--selected" : "",
                    ].join(" ")}
                  >
                    {/* Checkbox */}
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="m-checkbox"
                        checked={isChecked}
                        onChange={() => toggleGroup(group.group_id)}
                      />
                    </td>

                    {/* Active toggle (affects all cameras in group) */}
                    <td onClick={(e) => e.stopPropagation()}>
                      <label className="cam-toggle" title={activeCount > 0 ? "Disable all" : "Enable all"}>
                        <input
                          type="checkbox"
                          checked={activeCount > 0}
                          onChange={() => toggleGroupEnabled(group.group_id)}
                        />
                        <span className="cam-toggle-track">
                          <span className="cam-toggle-thumb" />
                        </span>
                      </label>
                    </td>

                    {/* Group Name */}
                    <td className="m-table__primary">{group.name}</td>

                    {/* ── UPDATED: Total Cameras cell ── */}
                    <td>
                      <div className="group-count">
                        <span className="group-total">{total} Cameras</span>
                        <div className="group-status">
                          <span className="group-active">{activeCount} Active</span>
                          <span className="group-divider">•</span>
                          <span className="group-disabled">{total - activeCount} Disabled</span>
                        </div>
                      </div>
                    </td>

                    {/* View All button */}
                    <td>
                      <button
                        className="ec-btn ec-btn--primary"
                        style={{ fontSize: "0.75rem", padding: "4px 10px" }}
                        onClick={() => openGroupPanel(group)}
                      >
                        Camera Groups
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Right Side Panel (Group) ── */}
        {selectedGroup && (
          <div className="card cam-side-panel">

            {/* ── UPDATED: Panel header ── */}
            <div className="cam-side-panel__header">
              <div className="cam-side-panel__info">
                <div className="cam-side-panel__name-row">
                  <div className="group-panel-header">
                    <h3>{selectedGroup.name}</h3>
                    <div className="group-panel-meta">
                      <span>{selectedGroup.cameras.length} Camera{selectedGroup.cameras.length !== 1 ? "s" : ""}</span>
                      <span className="dot">•</span>
                      <span className="active-count">
                        {selectedGroup.cameras.filter(c => c.enabled !== false).length} Active
                      </span>
                    </div>
                  </div>
                  <button
                    className="ec-btn ec-btn--cancel"
                    style={{ fontSize: "0.7rem", padding: "2px 8px", alignSelf: "flex-start" }}
                    onClick={() => setSelectedGroup(null)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>

            {/* ── UPDATED: Camera list with per-camera toggle ── */}
            <div className="group-cam-list">
              {selectedGroup.cameras.length === 0 ? (
                <div className="m-table__empty" style={{ padding: "1rem" }}>No cameras in this group.</div>
              ) : selectedGroup.cameras.map((cam) => {
                const isEnabled    = cam.enabled !== false;
                const isCamChecked = groupChecked.includes(cam.id);
                return (
                  <div
                    key={cam.id}
                    className={`group-cam-row ${isCamChecked ? "group-cam-row--checked" : ""}`}
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      className="m-checkbox"
                      checked={isCamChecked}
                      onChange={() => toggleGroupCam(cam.id)}
                    />

                    {/* Camera Info */}
                    <div className="group-cam-info">
                      <div className="group-cam-name">{cam.name || "Unnamed Camera"}</div>
                      <div className="group-cam-ip">{cam.ip || "No IP"}</div>
                    </div>

                    {/* Per-camera enable/disable toggle */}
                    <label className="cam-toggle" title={isEnabled ? "Disable camera" : "Enable camera"}>
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(e) => toggleEnabled(cam, e)}
                      />
                      <span className="cam-toggle-track">
                        <span className="cam-toggle-thumb" />
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>

            {/* Footer actions */}
            <div className="group-footer">
              <button
                className="ec-btn ec-btn--cancel"
                disabled={groupChecked.length === 0}
                onClick={handleDeleteGroupCams}
              >
                Delete
              </button>
              <button
                className="ec-btn ec-btn--primary"
                disabled={groupChecked.length === 0}
                onClick={() => setShowMoveModal(true)}
              >
                Move To
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="page-footer">
        <span className="cameras-count">
          {groupedData.length} group{groupedData.length !== 1 ? "s" : ""}
          <span className="cameras-count-active">
            {" "}· {cameras.length} total cameras · {cameras.filter(c => c.enabled !== false).length} active
          </span>
        </span>
        <div className="page-footer-right">
          <Button
            label={checked.length > 1 ? `Remove Groups (${checked.length})` : "Remove Group"}
            variant="danger"
            disabled={checked.length === 0}
            onClick={handleRemoveGroups}
          />
        </div>
      </div>

      {/* ── Move To Modal ── */}
      {showMoveModal && (
        <div className="ec-overlay" onClick={() => setShowMoveModal(false)}>
          <div className="ec-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ec-titlebar">
              <span className="ec-title">Move Cameras To Group</span>
              <div className="ec-titlebar-actions">
                <button className="ec-title-btn" onClick={() => setShowMoveModal(false)} title="Close">✕</button>
              </div>
            </div>
            <div className="ec-body">
              <p className="ec-auth-desc">
                Select a group to move <strong>{groupChecked.length} camera{groupChecked.length !== 1 ? "s" : ""}</strong> to:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
                {allGroupOptions
                  .filter(g => g.id !== selectedGroup?.group_id)
                  .map((g) => (
                    <button
                      key={g.id}
                      className="ec-btn ec-btn--primary"
                      style={{ textAlign: "left", justifyContent: "flex-start" }}
                      onClick={() => handleMoveToGroup(g.id)}
                    >
                      {g.name}
                    </button>
                  ))}
                {allGroupOptions.filter(g => g.id !== selectedGroup?.group_id).length === 0 && (
                  <p style={{ opacity: 0.6, fontSize: "0.85rem" }}>No other groups available.</p>
                )}
              </div>
            </div>
            <div className="ec-footer">
              <div className="ec-footer-right">
                <button className="ec-btn ec-btn--cancel" onClick={() => setShowMoveModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Camera Modal ── */}
      {editModal && (
        <div className="ec-overlay" onClick={() => setEditModal(null)}>
          <div className="ec-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ec-titlebar">
              <span className="ec-title">Edit Camera</span>
              <div className="ec-titlebar-actions">
                <button className="ec-title-btn" title="Help">?</button>
                <button className="ec-title-btn" onClick={() => setEditModal(null)} title="Close">✕</button>
              </div>
            </div>
            <div className="ec-body">
              <div className="ec-section-title">Settings</div>
              <div className="ec-toggle-row">
                <div className="ec-toggle-info">
                  <span className="ec-toggle-label">Enabled</span>
                  <span className="ec-toggle-sub">
                    {editForm.enabled ? "Camera will stream and record" : "Camera will not stream or record"}
                  </span>
                </div>
                <label className="cam-toggle cam-toggle--lg">
                  <input
                    type="checkbox"
                    checked={editForm.enabled}
                    onChange={(e) => setEditForm((f) => ({ ...f, enabled: e.target.checked }))}
                  />
                  <span className="cam-toggle-track"><span className="cam-toggle-thumb" /></span>
                </label>
              </div>
              <div className="ec-field-row">
                <label className="ec-field-label">Name:</label>
                <input
                  className="ec-input ec-input--highlight"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="ec-field-row ec-field-row--top">
                <label className="ec-field-label">Description:</label>
                <textarea
                  className="ec-textarea"
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="ec-field-row">
                <label className="ec-field-label">Address:</label>
                <input
                  className="ec-input"
                  value={editForm.ip}
                  onChange={(e) => setEditForm((f) => ({ ...f, ip: e.target.value }))}
                />
              </div>
              <div className="ec-field-row">
                <label className="ec-field-label">Port:</label>
                <input
                  className="ec-input ec-input--short"
                  value={editForm.port}
                  onChange={(e) => setEditForm((f) => ({ ...f, port: e.target.value }))}
                />
              </div>
              <div className="ec-section-title ec-section-title--spaced">Credentials</div>
              <div className="ec-field-row">
                <label className="ec-field-label">Username:</label>
                <input
                  className="ec-input"
                  value={editForm.username}
                  onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))}
                />
              </div>
              <div className="ec-field-row">
                <label className="ec-field-label">Password:</label>
                <input
                  className="ec-input"
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                />
              </div>
            </div>
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

      {/* ── Authentication Required Modal ── */}
      {authModal && (
        <div className="ec-overlay" onClick={() => setAuthModal(null)}>
          <div className="ec-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ec-titlebar">
              <span className="ec-title">Authentication Required</span>
              <div className="ec-titlebar-actions">
                <button className="ec-title-btn" title="Help">?</button>
                <button className="ec-title-btn" onClick={() => setAuthModal(null)} title="Close">✕</button>
              </div>
            </div>
            <div className="ec-body">
              <p className="ec-auth-desc">
                The device configuration tab of <strong>'{authModal.name}'</strong> is requesting a username and password.
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