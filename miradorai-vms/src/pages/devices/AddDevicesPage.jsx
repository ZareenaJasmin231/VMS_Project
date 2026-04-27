import { useState, useEffect, useRef, useCallback } from "react";
import CameraThumb from "../../components/shared/CameraThumb";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";
import StatusBadge from "../../components/shared/StatusBadge";
import ManualSearchModal from "./ManualSearchModal";
import StreamURLModal from "./StreamURLModal";
import DiscoveryModal from "../../components/shared/DiscoveryModal";
import "./AddDevicesPage.css";
import useActivityLogger from "../../hooks/useActivityLogger";

const STREAM_API = "http://192.168.126.200:8000";

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

function EmptyState() {
  return (
    <div className="add-dev__empty">
      <div className="add-dev__empty-icon">
        <svg
          viewBox="0 0 64 64"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          width="64"
          height="64"
          style={{ flexShrink: 0 }}
        >
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

  const style = {
    position: "fixed",
    top:  Math.min(y, window.innerHeight - 130),
    left: Math.min(x, window.innerWidth  - 180),
    zIndex: 9999,
  };

  return (
    <div ref={menuRef} className="ctx-menu" style={style}>
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

function EditDeviceModal({ device, onClose, onSave }) {
  const [form, setForm] = useState({
    name:         device.name         || "",
    ip:           device.ip           || "",
    mac:          device.mac          || "",
    manufacturer: device.manufacturer || "",
    model:        device.model        || "",
    rtsp_url:     device.rtsp_url     || "",
  });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = () => {
    onSave({ ...device, ...form });
    onClose();
  };

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
              <input
                className="modal-input"
                value={form[key]}
                onChange={set(key)}
                placeholder={label}
              />
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="modal-btn modal-btn--cancel" onClick={onClose}>Cancel</button>
          <button className="modal-btn modal-btn--save"   onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

export default function AddDevicesPage({ onNavigate }) {
  const [filter, setFilter]                     = useState("");
  const [showManualSearch, setShowManualSearch] = useState(false);
  const [showStreamURL, setShowStreamURL]       = useState(false);
  const [showDiscovery, setShowDiscovery]       = useState(false);
  const [enrolling, setEnrolling]               = useState(false);
  const [enrollMsg, setEnrollMsg]               = useState("");
  const [refreshing, setRefreshing]             = useState(false);
  const [devices, setDevices]                   = usePersistedDevices();
  const [ctxMenu, setCtxMenu]                   = useState(null);
  const [editDevice, setEditDevice]             = useState(null);
  const { logAction }                           = useActivityLogger();

  const filtered    = devices.filter((d) =>
    (d.name || "").toLowerCase().includes(filter.toLowerCase()) ||
    (d.ip   || "").toLowerCase().includes(filter.toLowerCase())
  );
  const onlineCount = filtered.filter((d) => d.status === "Online").length;

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
      await fetch(`${STREAM_API}/api/cameras/by-ip/${device.ip}/delete`, {
        method: "DELETE",
      });
      console.log("✅ Deleted from DB:", device.ip);
    } catch (err) {
      console.error("❌ Failed to delete from DB:", err);
    }

    setDevices((prev) => prev.filter((d) => d.id !== deviceId));
  }, [devices, setDevices]);

  const handleStreamProfiles = useCallback((deviceId) => {
    localStorage.setItem("miradorai_selected_camera_id", String(deviceId));
    if (onNavigate) onNavigate("stream-profiles");
  }, [onNavigate]);

  // const handleDiscoveredDevices = useCallback((discoveredDevices) => {
  //   if (!discoveredDevices || discoveredDevices.length === 0) return;

  //   const failed = discoveredDevices.filter((d) => !d.ws_url);
  //   if (failed.length > 0) {
  //     console.warn(
  //       `[AddDevices] ${failed.length} device(s) failed OME registration:`,
  //       failed.map((d) => `${d.ip} — ${d.stream_status}`)
  //     );
  //   }

  //   setDevices((prev) => {
  //     let next = [...prev];

  //     for (const d of discoveredDevices) {
  //       const device = {
  //         id:              d.id || `device-${d.ip}-${Date.now()}`,
  //         type:            "entrance",
  //         name:            d.cameraName || d.name || `${d.manufacturer || ""} ${d.model || ""}`.trim() || `Camera @ ${d.ip}`,
  //         ip:              d.ip,
  //         mac:             d.mac           || "—",
  //         status:          d.ws_url ? "Online" : "Offline",
  //         manufacturer:    d.manufacturer  || "Unknown",
  //         model:           d.model         || "Unknown",
  //         rtsp_url:        d.rtsp_url      || null,
  //         ws_url:          d.ws_url        || null,
  //         stream_key:      d.stream_key    || null,
  //         stream_status:   d.ws_url ? "streaming" : (d.stream_status || "not_registered"),
  //         stream_profiles: d.profiles      || d.stream_profiles || [],
  //         stream_count:    d.stream_count  || d.profiles?.length || 0,
  //         source:          "discovery",
  //       };

  //       const existingIndex = next.findIndex((item) => item.ip === d.ip);
  //       if (existingIndex !== -1) {
  //         next[existingIndex] = { ...next[existingIndex], ...device };
  //       } else {
  //         next.push(device);
  //       }

  //       logAction("Camera added", "camera", { ip: d.ip, source: "discovery" });
  //     }

  //     return next;
  //   });
  // }, [setDevices]);

  // const handleEnroll = async (device) => {
  //   setEnrolling(true);
  //   setEnrollMsg("Registering stream with OME…");
  //   setShowManualSearch(false);

  //   const { ip, user, pass, discovered, cameraName } = device;
  //   const enrichedName = discovered?.model
  //     ? `${discovered.manufacturer} ${discovered.model}`
  //     : null;

  //   const probeRes = await fetch(`${STREAM_API}/api/onvif/probe`, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ ip, port: 80, username: user, password: pass }),
  //   });
  //   const probeData = probeRes.ok ? await probeRes.json() : null;

  //   setDevices((prev) => {
  //     const existingIndex = prev.findIndex((item) => item.ip === ip);
  //     const updated = {
  //       id:              String(Date.now()),
  //       type:            "entrance",
  //       name:            cameraName || enrichedName || `Camera @ ${ip}`,
  //       ip,
  //       mac:             discovered?.mac           || probeData?.mac           || "—",
  //       status:          probeData?.ws_url ? "Online" : "Offline",
  //       manufacturer:    discovered?.manufacturer  || probeData?.manufacturer  || "Unknown",
  //       model:           discovered?.model         || probeData?.model         || "Unknown",
  //       firmware:        probeData?.firmware       || discovered?.firmware     || "",
  //       serial:          probeData?.serial         || discovered?.serial       || "",
  //       ptz:             probeData?.ptz            || discovered?.ptz          || "No",
  //       rtsp_url:        probeData?.rtsp_url       || probeData?.stream_uri    || null,
  //       ws_url:          probeData?.ws_url         || null,
  //       stream_key:      probeData?.stream_key     || null,
  //       stream_status:   probeData?.status         || "error",
  //       stream_profiles: probeData?.profiles       || discovered?.profiles     || [],
  //       stream_count:    probeData?.stream_count   || discovered?.stream_count || 0,
  //       source:          "onvif",
  //     };

  //     if (existingIndex !== -1) {
  //       const next = [...prev];
  //       next[existingIndex] = { ...next[existingIndex], ...updated };
  //       return next;
  //     }
  //     return [...prev, updated];
  //   });

  //   logAction("Camera added", "camera", { ip });
  //   setEnrolling(false);
  //   setEnrollMsg("");
  // };

  // ── REPLACE the entire handleEnroll function ────────────────────


// ── REPLACE handleDiscoveredDevices ────────────────────────────
const handleDiscoveredDevices = useCallback((discoveredDevices) => {
  if (!discoveredDevices || discoveredDevices.length === 0) return;

  const failed = discoveredDevices.filter((d) => !d.ws_url);
  if (failed.length > 0) {
    console.warn(
      `[AddDevices] ${failed.length} device(s) failed OME registration:`,
      failed.map((d) => `${d.ip} ch${d.channel ?? 0} — ${d.stream_status}`)
    );
  }

  setDevices((prev) => {
    let next = [...prev];

    for (const d of discoveredDevices) {
      // ✅ FIX 3: unique key = d.id which is already "device-{ip}-cam{idx}"
      //    also fall back to stream_key or ip+channel
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
      };

      // ✅ Match on id or stream_key — never ip alone
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

      logAction("Camera added", "camera", {
        ip: d.ip, channel: d.channel ?? 0, source: "discovery",
      });
    }

    return next;
  });
}, [setDevices]);

const handleEnroll = async (device) => {
  setEnrolling(true);
  setEnrollMsg("Registering stream with OME…");
  setShowManualSearch(false);

  const { ip, user, pass, discovered, cameraName, channel = 0 } = device;
  const enrichedName = discovered?.model
    ? `${discovered.manufacturer} ${discovered.model}`
    : null;

  // ✅ FIX 1: pass channel so backend registers the RIGHT physical camera
  const probeRes = await fetch(`${STREAM_API}/api/onvif/probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ip, port: 80, username: user, password: pass,
      channel,                          // ← was missing, always defaulted to 0
    }),
  });
  const probeData = probeRes.ok ? await probeRes.json() : null;

  // ✅ FIX 2: unique key is stream_key (e.g. "192_168_1_240_cam1"), NOT ip alone
  const streamKey =
    probeData?.stream_key ||
    probeData?.ome_stream ||
    `${ip.replace(/\./g, "_")}_cam${channel}`;

  setDevices((prev) => {
    // Match by stream_key first, then ip+channel fallback
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
      channel,                                          // ← store channel
      mac:             discovered?.mac          || probeData?.mac          || "—",
      status:          probeData?.ws_url ? "Online" : "Offline",
      manufacturer:    discovered?.manufacturer || probeData?.manufacturer || "Unknown",
      model:           discovered?.model        || probeData?.model        || "Unknown",
      firmware:        probeData?.firmware      || discovered?.firmware    || "",
      serial:          probeData?.serial        || discovered?.serial      || "",
      ptz:             probeData?.ptz           || discovered?.ptz         || "No",
      rtsp_url:        probeData?.rtsp_url      || probeData?.stream_uri   || null,
      ws_url:          probeData?.ws_url        || null,
      stream_key:      streamKey,                       // ← store for future dedup
      stream_status:   probeData?.status        || "error",
      stream_profiles: probeData?.profiles      || discovered?.profiles    || [],
      stream_count:    probeData?.stream_count  || discovered?.stream_count || 0,
      physical_camera_count: probeData?.physical_camera_count || 1,
      source:          "onvif",
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
  
  // const handleAddStreamURLs = async (payload) => {
  //   setShowStreamURL(false);
  //   setEnrolling(true);

  //   const urls       = Array.isArray(payload) ? payload : payload.urls;
  //   const cameraName = Array.isArray(payload) ? "" : (payload.cameraName || "");

  //   for (let i = 0; i < urls.length; i++) {
  //     const url = urls[i];
  //     setEnrollMsg(`Registering stream ${i + 1} of ${urls.length}…`);

  //     let ip = "—";
  //     try { ip = new URL(url).hostname; } catch {}

  //     const streamName = cameraName
  //       ? (urls.length > 1 ? `${cameraName} (${i + 1})` : cameraName)
  //       : `Stream @ ${ip}`;

  //     try {
  //       const res  = await fetch(`${STREAM_API}/api/streams/register`, {
  //         method: "POST",
  //         headers: { "Content-Type": "application/json" },
  //         body: JSON.stringify({ rtsp_url: url }),
  //       });
  //       const data = res.ok ? await res.json() : null;

  //       setDevices((prev) => {
  //         const existingIndex = prev.findIndex((item) => item.ip === ip);
  //         const entry = {
  //           id:            String(Date.now()) + i,
  //           type:          "entrance",
  //           name:          streamName,
  //           ip,
  //           mac:           "—",
  //           status:        data?.ws_url ? "Online" : "Offline",
  //           manufacturer:  "Unknown",
  //           model:         "Unknown",
  //           rtsp_url:      url,
  //           ws_url:        data?.ws_url     || null,
  //           stream_key:    data?.stream_key || null,
  //           stream_status: data?.ws_url ? "streaming" : "error",
  //           source:        "rtsp",
  //         };
  //         if (existingIndex !== -1) {
  //           const next = [...prev];
  //           next[existingIndex] = { ...next[existingIndex], ...entry };
  //           return next;
  //         }
  //         return [...prev, entry];
  //       });

  //       logAction("Camera added", "camera", { ip, source: "stream_url" });

  //     } catch {
  //       setDevices((prev) => {
  //         const existingIndex = prev.findIndex((item) => item.ip === ip);
  //         const entry = {
  //           id: String(Date.now()) + i, type: "entrance",
  //           name: streamName, ip, mac: "—",
  //           status: "Offline", manufacturer: "Unknown", model: "Unknown",
  //           rtsp_url: url, ws_url: null, stream_key: null,
  //           stream_status: "error", source: "rtsp",
  //         };
  //         if (existingIndex !== -1) {
  //           const next = [...prev];
  //           next[existingIndex] = { ...next[existingIndex], ...entry };
  //           return next;
  //         }
  //         return [...prev, entry];
  //       });
  //     }
  //   }

  //   setEnrolling(false);
  //   setEnrollMsg("");
  // };

  // ── REPLACE handleAddStreamURLs ─────────────────────────────────
const handleAddStreamURLs = async (payload) => {
  setShowStreamURL(false);
  setEnrolling(true);

  const urls       = Array.isArray(payload) ? payload : payload.urls;
  const cameraName = Array.isArray(payload) ? "" : (payload.cameraName || "");

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

      // ✅ FIX 4: use ome_stream as unique key for RTSP streams
      const streamKey = data?.ome_stream || data?.stream_key ||
        `${ip.replace(/\./g, "_")}_rtsp${i}`;

      setDevices((prev) => {
        const existingIndex = prev.findIndex(
          (item) =>
            (item.stream_key && item.stream_key === streamKey) ||
            item.rtsp_url === url
        );

        const entry = {
          id:            existingIndex !== -1
                           ? prev[existingIndex].id
                           : `device-rtsp-${streamKey}-${Date.now()}`,
          type:          "entrance",
          name:          streamName,
          ip,
          channel:       0,
          mac:           "—",
          status:        data?.ws_url ? "Online" : "Offline",
          manufacturer:  "Unknown",
          model:         "Unknown",
          rtsp_url:      url,
          ws_url:        data?.ws_url     || null,
          stream_key:    streamKey,
          stream_status: data?.ws_url ? "streaming" : "error",
          stream_profiles: [],
          stream_count:  0,
          physical_camera_count: 1,
          source:        "rtsp",
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
          mac:           "—", status: "Offline",
          manufacturer:  "Unknown", model: "Unknown",
          rtsp_url:      url, ws_url: null, stream_key: streamKey,
          stream_status: "error", stream_profiles: [], stream_count: 0,
          physical_camera_count: 1, source: "rtsp",
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
  
  
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Add <span>Devices</span></h1>
          <p className="page-desc">Discover and enroll devices from your network into the MIRADOR VMS platform.</p>
        </div>
        <div className="add-dev__toolbar">
          <Button
            label="Manual Search"
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`}
            onClick={() => setShowManualSearch(true)}
          />
          <Button
            label="Network Discovery"
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="9"/><path d="M12 2v20"/><path d="M2 12h20"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>`}
            onClick={() => setShowDiscovery(true)}
          />
          <Button
            label="Stream URL"
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`}
            onClick={() => setShowStreamURL(true)}
          />
          <Button
            label="Refresh"
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" class="${refreshing ? "spin" : ""}"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`}
            onClick={handleRefresh}
          />
        </div>
      </div>

      <div className="add-dev__options-bar">
        <SearchBar value={filter} onChange={setFilter} placeholder="Filter devices..." />
      </div>

      <div className="add-dev__info-pill">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8h.01M12 12v4"/>
        </svg>
        {enrolling ? `⏳ ${enrollMsg}` : "Refresh to sync latest devices from the server."}
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
                <th>Stream</th>
              </tr>
            </thead>
 {/* // ── REPLACE the table body row to show channel/profile info ──── */}
              <tbody>
                {filtered.map((d) => (
                  <tr
                    key={d.id}
                    className="m-table__row"
                    onContextMenu={(e) => handleRowContextMenu(e, d.id)}
                  >
                    <td><CameraThumb type={d.type} /></td>
                    <td className="m-table__primary">
                      {d.name}
                      {/* ✅ Show camera label for multi-sensor devices */}
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
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {d.stream_status === "streaming"
                          ? <span className="add-dev__stream add-dev__stream--live">● LIVE</span>
                          : d.ws_url
                            ? <span className="add-dev__stream add-dev__stream--pending">
                                ● {d.stream_status || "pending"}
                              </span>
                            : <span className="add-dev__stream add-dev__stream--none">— not registered</span>
                        }
                        {/* ✅ Show profile count from any source */}
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
                ))}
              </tbody>
          </table>
        )}
      </div>

      <div className="page-footer">
        <span className="add-dev__count">
          {filtered.length} device{filtered.length !== 1 ? "s" : ""} enrolled · {onlineCount} online
        </span>
      </div>

      {showManualSearch && (
        <ManualSearchModal onClose={() => setShowManualSearch(false)} onEnroll={handleEnroll} />
      )}
      {showDiscovery && (
        <DiscoveryModal
          isOpen={showDiscovery}
          onClose={() => setShowDiscovery(false)}
          onAddDevices={handleDiscoveredDevices}
        />
      )}
      {showStreamURL && (
        <StreamURLModal onClose={() => setShowStreamURL(false)} onAdd={handleAddStreamURLs} />
      )}
      {editDevice && (
        <EditDeviceModal
          device={editDevice}
          onClose={() => setEditDevice(null)}
          onSave={handleSaveDevice}
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