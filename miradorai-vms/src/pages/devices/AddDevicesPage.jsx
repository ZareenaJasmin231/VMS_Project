import { useState, useEffect, useRef, useCallback } from "react";
import CameraThumb from "../../components/shared/CameraThumb";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";
import StatusBadge from "../../components/shared/StatusBadge";
import ManualSearchModal from "./ManualSearchModal";
import StreamURLModal from "./StreamURLModal";
import DiscoveryModal from "../../components/shared/DiscoveryModal";
import CreateGroupModal from "./CreateGroupModal";
import "./AddDevicesPage.css";
import useActivityLogger from "../../hooks/useActivityLogger";


const STREAM_API = "http://192.168.126.200:8000";

// ─── Persisted Devices ───────────────────────────────────────────────────────
function usePersistedDevices() {
  const [devices, setDevices] = useState(() => {
    try {
      const saved = localStorage.getItem("miradorai_devices");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const updateDevices = (updater) => {
    setDevices((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { localStorage.setItem("miradorai_devices", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  return [devices, updateDevices];
}

// ─── Persisted Groups ────────────────────────────────────────────────────────
function usePersistedGroups() {
  const [groups, setGroups] = useState(() => {
    try {
      const saved = localStorage.getItem("miradorai_groups");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const updateGroups = (updater) => {
    setGroups((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { localStorage.setItem("miradorai_groups", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  return [groups, updateGroups];
}

// ─── Empty State ─────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="add-dev__empty">
      <div className="add-dev__empty-icon">
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.2" width="64" height="64" style={{ flexShrink: 0 }}>
          <rect x="8" y="16" width="40" height="28" rx="4" stroke="var(--border-light)"/>
          <path d="M48 26l10 6-10 6V26z" stroke="var(--border-light)"/>
          <circle cx="28" cy="30" r="6" stroke="var(--text-muted)"/>
          <path d="M16 52h32" stroke="var(--border-light)" strokeLinecap="round"/>
          <path d="M32 44v8" stroke="var(--border-light)" strokeLinecap="round"/>
          <circle cx="50" cy="14" r="8" fill="var(--bg-elevated)" stroke="var(--border-light)"/>
          <path d="M50 11v4M50 17h.01" stroke="var(--teal)" strokeLinecap="round"/>
        </svg>
        <div className="add-dev__empty-pulse" />
      </div>
      <p className="add-dev__empty-title">No devices enrolled yet</p>
      <p className="add-dev__empty-sub">
        Use <strong>Manual Search</strong> to discover ONVIF cameras on your network,
        <br/>or add a camera via <strong>Stream URL</strong>.
      </p>
    </div>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────────────
function ContextMenu({ x, y, onEdit, onRemove, onStreamProfiles, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handle = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("contextmenu", handle);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("contextmenu", handle);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{
        position: "fixed",
        top:  Math.min(y, window.innerHeight - 130),
        left: Math.min(x, window.innerWidth  - 180),
        zIndex: 9999,
      }}
    >
      <button className="ctx-item" onClick={() => { onEdit(); onClose(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ flexShrink: 0 }}>
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Edit
      </button>
      <button className="ctx-item" onClick={() => { onStreamProfiles?.(); onClose(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ flexShrink: 0 }}>
          <path d="M23 7l-7 5 7 5V7z"/>
          <rect x="1" y="5" width="15" height="14" rx="2"/>
          <path d="M8 10h5M8 14h3" strokeLinecap="round"/>
        </svg>
        Stream Profiles
      </button>
      <div className="ctx-divider" />
      <button className="ctx-item ctx-item--danger" onClick={() => { onRemove(); onClose(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ flexShrink: 0 }}>
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
        </svg>
        Remove
      </button>
    </div>
  );
}

// ─── Edit Device Modal ────────────────────────────────────────────────────────
// Group reassignment is kept here — useful for moving a camera after the fact.
function EditDeviceModal({ device, groups, onClose, onSave }) {
  const [form, setForm] = useState({
    name:         device.name         || "",
    ip:           device.ip           || "",
    mac:          device.mac          || "",
    manufacturer: device.manufacturer || "",
    model:        device.model        || "",
    rtsp_url:     device.rtsp_url     || "",
    group_id:     device.group_id     || "default",
  });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Edit Device</h2>
          <button className="modal-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          {[
            { label: "Device Name",  key: "name"         },
            { label: "IP Address",   key: "ip"           },
            { label: "MAC Address",  key: "mac"          },
            { label: "Manufacturer", key: "manufacturer" },
            { label: "Model",        key: "model"        },
            { label: "RTSP URL",     key: "rtsp_url"     },
          ].map(({ label, key }) => (
            <div className="modal-field" key={key}>
              <label className="modal-label">{label}</label>
              <input className="modal-input" value={form[key]} onChange={set(key)} placeholder={label} />
            </div>
          ))}
          <div className="modal-field">
            <label className="modal-label">Group</label>
            <select className="modal-input" value={form.group_id} onChange={set("group_id")}>
              <option value="default">Default</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn modal-btn--cancel" onClick={onClose}>Cancel</button>
          <button className="modal-btn modal-btn--save" onClick={() => { onSave({ ...device, ...form }); onClose(); }}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AddDevicesPage({ onNavigate }) {
  const [filter, setFilter]                     = useState("");
  const [activeGroup, setActiveGroup]           = useState("all");
  const [showManualSearch, setShowManualSearch] = useState(false);
  const [showStreamURL, setShowStreamURL]       = useState(false);
  const [showDiscovery, setShowDiscovery]       = useState(false);
  const [enrolling, setEnrolling]               = useState(false);
  const [enrollMsg, setEnrollMsg]               = useState("");
  const [refreshing, setRefreshing]             = useState(false);
  const [devices, setDevices]                   = usePersistedDevices();
  const [groups, setGroups]                     = usePersistedGroups();
  const [ctxMenu, setCtxMenu]                   = useState(null);
  const [editDevice, setEditDevice]             = useState(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);


  // selectedGroupId is owned here but only mutated/read through modals (FIX 1).
  const [selectedGroupId, setSelectedGroupId]   = useState("default");
  const { logAction }                           = useActivityLogger();

  // ── Smart modal openers — pre-select active group (FIX 5) ────────────────
  const openManualSearch = () => {
    setSelectedGroupId(activeGroup === "all" ? "default" : activeGroup);
    setShowManualSearch(true);
  };
  const openDiscovery = () => {
    setSelectedGroupId(activeGroup === "all" ? "default" : activeGroup);
    setShowDiscovery(true);
  };
  const openStreamURL = () => {
    setSelectedGroupId(activeGroup === "all" ? "default" : activeGroup);
    setShowStreamURL(true);
  };

  // ── Filtered list (search + group) ───────────────────────────────────────
  const filtered = devices.filter((d) => {
    const matchSearch =
      (d.name || "").toLowerCase().includes(filter.toLowerCase()) ||
      (d.ip   || "").toLowerCase().includes(filter.toLowerCase());
    const matchGroup =
      activeGroup === "all" || (d.group_id || "default") === activeGroup;
    return matchSearch && matchGroup;
  });

  const onlineCount    = filtered.filter((d) => d.status === "Online").length;
  const countForGroup  = (gid) => devices.filter((d) => (d.group_id || "default") === gid).length;

  // ── Create Group — toolbar action (FIX 3) ────────────────────────────────
const handleCreateGroup = () => {
  setShowCreateGroup(true);
};

const handleCreateGroupSubmit = (name) => {
  setGroups((prev) => [
    ...prev,
    { id: `group-${Date.now()}`, name }
  ]);
};

  // ── Delete Group ─────────────────────────────────────────────────────────
  const handleDeleteGroup = (groupId) => {
    if (!window.confirm("Delete this group? Cameras will move to Default.")) return;
    setDevices((prev) =>
      prev.map((d) => d.group_id === groupId ? { ...d, group_id: "default" } : d)
    );
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    if (activeGroup === groupId) setActiveGroup("all");
  };

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200);
  };

  const handleRowContextMenu = useCallback((e, deviceId) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, deviceId });
  }, []);

  const handleEditDevice = useCallback((deviceId) => {
    const device = devices.find((d) => d.id === deviceId);
    if (device) setEditDevice(device);
  }, [devices]);

  const handleSaveDevice = useCallback((updated) => {
    setDevices((prev) => prev.map((d) => d.id === updated.id ? updated : d));
  }, [setDevices]);

  const handleRemoveDevice = useCallback(async (deviceId) => {
    const device = devices.find((d) => d.id === deviceId);
    if (!device) return;
    try {
      await fetch(`${STREAM_API}/api/cameras/by-ip/${device.ip}/delete`, { method: "DELETE" });
    } catch (err) {
      console.error("❌ Failed to delete from DB:", err);
    }
    setDevices((prev) => prev.filter((d) => d.id !== deviceId));
  }, [devices, setDevices]);

  const handleStreamProfiles = useCallback((deviceId) => {
    localStorage.setItem("miradorai_selected_camera_id", String(deviceId));
    if (onNavigate) onNavigate("stream-profiles");
  }, [onNavigate]);

  // ── handleDiscoveredDevices ───────────────────────────────────────────────
  // selectedGroupId is set via openDiscovery() before the modal opens,
  // so the closure captures the correct value.
  const handleDiscoveredDevices = useCallback((discoveredDevices) => {
    if (!discoveredDevices || discoveredDevices.length === 0) return;

    const failed = discoveredDevices.filter((d) => !d.ws_url);
    if (failed.length > 0) {
      console.warn(
        `[AddDevices] ${failed.length} device(s) failed OME registration:`,
        failed.map((d) => `${d.ip} ch${d.channel ?? 0} — ${d.stream_status}`)
      );
    }

    const targetGroup = selectedGroupId; // captured from modal context

    setDevices((prev) => {
      let next = [...prev];

      for (const d of discoveredDevices) {
        const streamKey = d.stream_key || d.stream_name ||
          `${d.ip.replace(/\./g, "_")}_cam${d.channel ?? 0}`;

        const device = {
          id:            d.id || `device-${d.ip}-cam${d.channel ?? 0}`,
          type:          "entrance",
          name:          d.cameraName || d.name ||
                         `${d.manufacturer || ""} ${d.model || ""}`.trim() ||
                         `Camera @ ${d.ip}`,
          ip:            d.ip,
          channel:       d.channel ?? 0,
          mac:           d.mac           || "—",
          status:        d.ws_url ? "Online" : "Offline",
          manufacturer:  d.manufacturer  || "Unknown",
          model:         d.model         || "Unknown",
          firmware:      d.firmware      || "",
          rtsp_url:      d.rtsp_url      || null,
          ws_url:        d.ws_url        || null,
          stream_key:    streamKey,
          stream_status: d.ws_url ? "streaming" : (d.stream_status || "not_registered"),
          stream_profiles: d.profiles    || d.stream_profiles || [],
          stream_count:  d.stream_count  || d.profiles?.length || 0,
          physical_camera_count: d.physical_camera_count || 1,
          label:         d.label         || d.profile_name || "",
          source:        "discovery",
          group_id:      targetGroup,                    // ✅ from modal
        };

        const existingIndex = next.findIndex(
          (item) =>
            item.id === device.id ||
            (item.stream_key && item.stream_key === streamKey)
        );

        if (existingIndex !== -1) {
          next[existingIndex] = { ...next[existingIndex], ...device };
        } else {
          next.push(device);
        }

        logAction("Camera added", "camera", { ip: d.ip, channel: d.channel ?? 0, source: "discovery" });
      }

      return next;
    });
  }, [setDevices, selectedGroupId]);

  // ── handleEnroll — group_id comes from ManualSearchModal field ────────────
  const handleEnroll = async (device) => {
    setEnrolling(true);
    setEnrollMsg("Registering stream with OME…");
    setShowManualSearch(false);

    const { ip, user, pass, discovered, cameraName, channel = 0, group_id } = device;
    const enrichedName = discovered?.model
      ? `${discovered.manufacturer} ${discovered.model}`
      : null;

    const probeRes = await fetch(`${STREAM_API}/api/onvif/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, port: 80, username: user, password: pass, channel, group_id: group_id || selectedGroupId }),
    });
    const probeData = probeRes.ok ? await probeRes.json() : null;

    const streamKey =
      probeData?.stream_key ||
      probeData?.ome_stream ||
      `${ip.replace(/\./g, "_")}_cam${channel}`;

    setDevices((prev) => {
      const existingIndex = prev.findIndex(
        (item) =>
          (item.stream_key && item.stream_key === streamKey) ||
          (!item.stream_key && item.ip === ip && (item.channel ?? 0) === channel)
      );

      const updated = {
        id: existingIndex !== -1
          ? prev[existingIndex].id
          : `device-${ip}-cam${channel}-${Date.now()}`,
        type:            "entrance",
        name:            cameraName || enrichedName || `Camera @ ${ip}`,
        ip,
        channel,
        mac:             discovered?.mac          || probeData?.mac          || "—",
        status:          probeData?.ws_url ? "Online" : "Offline",
        manufacturer:    discovered?.manufacturer || probeData?.manufacturer || "Unknown",
        model:           discovered?.model        || probeData?.model        || "Unknown",
        firmware:        probeData?.firmware      || discovered?.firmware    || "",
        serial:          probeData?.serial        || discovered?.serial      || "",
        ptz:             probeData?.ptz           || discovered?.ptz         || "No",
        rtsp_url:        probeData?.rtsp_url      || probeData?.stream_uri   || null,
        ws_url:          probeData?.ws_url        || null,
        stream_key:      streamKey,
        stream_status:   probeData?.status        || "error",
        stream_profiles: probeData?.profiles      || discovered?.profiles    || [],
        stream_count:    probeData?.stream_count  || discovered?.stream_count || 0,
        physical_camera_count: probeData?.physical_camera_count || 1,
        source:          "onvif",
        group_id:        group_id || selectedGroupId,  // ✅ from modal field
      };

      if (existingIndex !== -1) {
        const next = [...prev];
        next[existingIndex] = { ...next[existingIndex], ...updated };
        return next;
      }
      return [...prev, updated];
    });

    logAction("Camera added", "camera", { ip, channel });
    setEnrolling(false);
    setEnrollMsg("");
  };

  // ── handleAddStreamURLs — group_id comes from StreamURLModal field ─────────
  const handleAddStreamURLs = async (payload) => {
    setShowStreamURL(false);
    setEnrolling(true);

    const urls       = Array.isArray(payload) ? payload : payload.urls;
    const cameraName = Array.isArray(payload) ? "" : (payload.cameraName || "");
    const groupId    = Array.isArray(payload)
      ? selectedGroupId
      : (payload.group_id || selectedGroupId);           // ✅ from modal field

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      setEnrollMsg(`Registering stream ${i + 1} of ${urls.length}…`);

      let ip = "—";
      try { ip = new URL(url).hostname; } catch {}

      const streamName = cameraName
        ? (urls.length > 1 ? `${cameraName} (${i + 1})` : cameraName)
        : `Stream @ ${ip}`;

      try {
        const res  = await fetch(`${STREAM_API}/api/streams/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rtsp_url: url }),
        });
        const data = res.ok ? await res.json() : null;

        const streamKey = data?.ome_stream || data?.stream_key ||
          `${ip.replace(/\./g, "_")}_rtsp${i}`;

        setDevices((prev) => {
          const existingIndex = prev.findIndex(
            (item) =>
              (item.stream_key && item.stream_key === streamKey) ||
              item.rtsp_url === url
          );
          const entry = {
            id:            existingIndex !== -1 ? prev[existingIndex].id : `device-rtsp-${streamKey}-${Date.now()}`,
            type:          "entrance",
            name:          streamName,
            ip,
            channel:       0,
            mac:           "—",
            status:        data?.ws_url ? "Online" : "Offline",
            manufacturer:  "Unknown",
            model:         "Unknown",
            rtsp_url:      url,
            ws_url:        data?.ws_url  || null,
            stream_key:    streamKey,
            stream_status: data?.ws_url ? "streaming" : "error",
            stream_profiles: [],
            stream_count:  0,
            physical_camera_count: 1,
            source:        "rtsp",
            group_id:      groupId,                      // ✅ from modal field
          };
          if (existingIndex !== -1) {
            const next = [...prev];
            next[existingIndex] = { ...next[existingIndex], ...entry };
            return next;
          }
          return [...prev, entry];
        });

        logAction("Camera added", "camera", { ip, source: "stream_url" });

      } catch {
        const streamKey = `${ip.replace(/\./g, "_")}_rtsp${i}`;
        setDevices((prev) => {
          const existingIndex = prev.findIndex((item) => item.rtsp_url === url);
          const entry = {
            id:            existingIndex !== -1 ? prev[existingIndex].id : `device-rtsp-${Date.now()}-${i}`,
            type:          "entrance", name: streamName, ip, channel: 0,
            mac:           "—", status: "Offline", manufacturer: "Unknown", model: "Unknown",
            rtsp_url:      url, ws_url: null, stream_key: streamKey,
            stream_status: "error", stream_profiles: [], stream_count: 0,
            physical_camera_count: 1, source: "rtsp",
            group_id:      groupId,                      // ✅ from modal field
          };
          if (existingIndex !== -1) {
            const next = [...prev];
            next[existingIndex] = { ...next[existingIndex], ...entry };
            return next;
          }
          return [...prev, entry];
        });
      }
    }

    setEnrolling(false);
    setEnrollMsg("");
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="page-shell add-dev__layout">

      {/* ── LEFT SIDEBAR — group list only, no create button (FIX 4) ────── */}


      {/* ── MAIN CONTENT ──────────────────────────────────────────────────── */}
      <div className="add-dev__main">
        <div className="page-header">
          <div>
            <h1 className="page-title">Add <span>Devices</span></h1>
            <p className="page-desc">Discover and enroll devices from your network into the MIRADOR VMS platform.</p>
          </div>

          {/* Toolbar — FIX 3: Create Group sits here alongside other actions */}
          <div className="add-dev__toolbar">
            <Button
              label="Manual Search"
              icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`}
              onClick={openManualSearch}
            />
            <Button
              label="Network Discovery"
              icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="9"/><path d="M12 2v20"/><path d="M2 12h20"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>`}
              onClick={openDiscovery}
            />
            <Button
              label="Stream URL"
              icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`}
              onClick={openStreamURL}
            />
            <Button
              label="Create Group"
              icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>`}
              onClick={handleCreateGroup}
            />
            {/* <Button
              label="Refresh"
              icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" class="${refreshing ? "spin" : ""}"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`}
              onClick={handleRefresh}
            /> */}
          </div>
        </div>

<div className="add-dev__options-bar">
  <SearchBar value={filter} onChange={setFilter} placeholder="Filter devices..." />

  <select
    className="group-filter"
    value={activeGroup}
    onChange={(e) => setActiveGroup(e.target.value)}
  >
    <option value="all">All Cameras</option>
    <option value="default">Default</option>
    {groups.map(g => (
      <option key={g.id} value={g.id}>{g.name}</option>
    ))}
  </select>
</div>
        <div className="add-dev__info-pill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8h.01M12 12v4"/>
          </svg>
          {enrolling
            ? `⏳ ${enrollMsg}`
            : activeGroup === "all"
              ? "Showing all cameras across all groups."
              : activeGroup === "default"
                ? "Showing cameras in Default group."
                : `Showing cameras in "${groups.find((g) => g.id === activeGroup)?.name || ""}" group.`
          }
        </div>

        <div className="add-dev__table-wrap card">
          {filtered.length === 0 ? (
            <EmptyState />
          ) : (
            <table className="m-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}></th>
                  {["Device Name","IP Address","MAC Address","Status","Manufacturer","Model"].map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                  <th>Group</th>
                  <th>Stream</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const groupLabel =
                    d.group_id === "default" || !d.group_id
                      ? "Default"
                      : groups.find((g) => g.id === d.group_id)?.name || "Default";

                  return (
                    <tr
                      key={d.id}
                      className="m-table__row"
                      onContextMenu={(e) => handleRowContextMenu(e, d.id)}
                    >
                      <td><CameraThumb type={d.type} /></td>
                      <td className="m-table__primary">
                        {d.name}
                        {d.physical_camera_count > 1 && (
                          <span style={{
                            marginLeft: 6, fontSize: 10, padding: "1px 5px",
                            background: "#1a0f2e", color: "#a78bfa",
                            border: "1px solid #3b1f6e", borderRadius: 4,
                          }}>
                            CAM {(d.channel ?? 0) + 1}
                          </span>
                        )}
                      </td>
                      <td><code className="add-dev__ip">{d.ip}</code></td>
                      <td><code className="add-dev__ip">{d.mac}</code></td>
                      <td><StatusBadge status={d.status} /></td>
                      <td>{d.manufacturer}</td>
                      <td>{d.model}</td>
                      <td>
                        <span className="add-dev__group-tag">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11">
                            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                          </svg>
                          {groupLabel}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {d.stream_status === "streaming"
                            ? <span className="add-dev__stream add-dev__stream--live">● LIVE</span>
                            : d.ws_url
                              ? <span className="add-dev__stream add-dev__stream--pending">
                                  ● {d.stream_status || "pending"}
                                </span>
                              : <span className="add-dev__stream add-dev__stream--none">— not registered</span>
                          }
                          {(d.stream_count > 0 || d.stream_profiles?.length > 0) && (
                            <span style={{ fontSize: 10, color: "#4a6a99" }}>
                              {d.stream_count || d.stream_profiles?.length} profile{
                                (d.stream_count || d.stream_profiles?.length) !== 1 ? "s" : ""
                              }
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>


      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}

      {/* FIX 1 ✅ — group selector lives INSIDE ManualSearchModal */}
      {showManualSearch && (
        <ManualSearchModal
          onClose={() => setShowManualSearch(false)}
          onEnroll={handleEnroll}
          groups={groups}
          selectedGroupId={selectedGroupId}
          setSelectedGroupId={setSelectedGroupId}
        />
      )}

      {/* DiscoveryModal — group props passed, selectedGroupId captured via closure */}
      {showDiscovery && (
        <DiscoveryModal
          isOpen={showDiscovery}
          onClose={() => setShowDiscovery(false)}
          onAddDevices={handleDiscoveredDevices}
          groups={groups}
          selectedGroupId={selectedGroupId}
          setSelectedGroupId={setSelectedGroupId}
        />
      )}

      {/* FIX 1 ✅ — group selector lives INSIDE StreamURLModal */}
      {showStreamURL && (
        <StreamURLModal
          onClose={() => setShowStreamURL(false)}
          onAdd={handleAddStreamURLs}
          groups={groups}
          selectedGroupId={selectedGroupId}
          setSelectedGroupId={setSelectedGroupId}
        />
      )}

      {editDevice && (
        <EditDeviceModal
          device={editDevice}
          groups={groups}
          onClose={() => setEditDevice(null)}
          onSave={handleSaveDevice}
        />
      )}
{showCreateGroup && (
  <CreateGroupModal
    onClose={() => setShowCreateGroup(false)}
    onCreate={handleCreateGroupSubmit}
  />
)}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onEdit={()           => handleEditDevice(ctxMenu.deviceId)}
          onRemove={()         => handleRemoveDevice(ctxMenu.deviceId)}
          onStreamProfiles={()  => handleStreamProfiles(ctxMenu.deviceId)}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}