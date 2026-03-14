import { useState } from "react";
import CameraThumb from "../../components/shared/CameraThumb";
import Toggle from "../../components/shared/Toggle";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";
import StatusBadge from "../../components/shared/StatusBadge";
import ManualSearchModal from "./ManualSearchModal";
import StreamURLModal from "./StreamURLModal";
import "./AddDevicesPage.css";

const STREAM_API = "http://localhost:8000";

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
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.2">
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
      <p className="add-dev__empty-sub">Use <strong>Manual Search</strong> to discover ONVIF cameras on your network,<br/>or add a camera via <strong>Stream URL</strong>.</p>
    </div>
  );
}

export default function AddDevicesPage() {
  const [filter, setFilter] = useState("");
  const [includePrerecorded, setInclude] = useState(true);
  const [checked, setChecked] = useState([]);
  const [showManualSearch, setShowManualSearch] = useState(false);
  const [showStreamURL, setShowStreamURL] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollMsg, setEnrollMsg] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [devices, setDevices] = usePersistedDevices();

  const filtered = devices.filter((d) =>
    (d.name || "").toLowerCase().includes(filter.toLowerCase()) ||
    (d.ip   || "").toLowerCase().includes(filter.toLowerCase())
  );
  const allChecked = filtered.length > 0 && filtered.every((d) => checked.includes(d.id));
  const toggleAll  = () => setChecked(allChecked ? [] : filtered.map((d) => d.id));
  const toggleOne  = (id) => setChecked((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200);
  };

  const handleEnroll = async (device) => {
    setEnrolling(true);
    setEnrollMsg("Registering stream with OME…");
    setShowManualSearch(false);

    const { ip, user, pass, discovered } = device;
    const name = discovered?.model
      ? `${discovered.manufacturer} ${discovered.model}`
      : `Camera @ ${ip}`;

    const probeRes = await fetch(`${STREAM_API}/api/onvif/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, port: 80, username: user, password: pass }),
    });
    const probeData = probeRes.ok ? await probeRes.json() : null;

    const newDevice = {
      id:            String(Date.now()),
      type:          "entrance",
      name,
      ip,
      mac:           discovered?.mac          || "—",
      status:        probeData?.ws_url ? "Online" : "Offline",
      manufacturer:  discovered?.manufacturer || "Unknown",
      model:         discovered?.model        || "Unknown",
      rtsp_url:      probeData?.stream_uri    || null,
      ws_url:        probeData?.ws_url        || null,
      stream_key:    probeData?.stream_key    || null,
      stream_status: probeData?.status        || "error",
      source:        "onvif",
    };

    setDevices((prev) => [...prev, newDevice]);
    setEnrolling(false);
    setEnrollMsg("");
  };

  const handleAddStreamURLs = async (urls) => {
    setShowStreamURL(false);
    setEnrolling(true);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      setEnrollMsg(`Registering stream ${i + 1} of ${urls.length}…`);

      try {
        const res = await fetch(`${STREAM_API}/api/streams/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rtsp_url: url }),
        });
        const data = res.ok ? await res.json() : null;

        let ip = "—";
        try { ip = new URL(url).hostname; } catch {}

        setDevices((prev) => [...prev, {
          id:            String(Date.now()) + i,
          type:          "entrance",
          name:          `Stream @ ${ip}`,
          ip,
          mac:           "—",
          status:        data?.ws_url ? "Online" : "Offline",
          manufacturer:  "Unknown",
          model:         "Unknown",
          rtsp_url:      url,
          ws_url:        data?.ws_url        || null,
          stream_key:    data?.stream_key    || null,
          stream_status: data?.status        || (data?.ws_url ? "streaming" : "error"),
          source:        "rtsp",
        }]);
      } catch (err) {
        let ip = "—";
        try { ip = new URL(url).hostname; } catch {}
        setDevices((prev) => [...prev, {
          id:            String(Date.now()) + i,
          type:          "entrance",
          name:          `Stream @ ${ip}`,
          ip,
          mac:           "—",
          status:        "Offline",
          manufacturer:  "Unknown",
          model:         "Unknown",
          rtsp_url:      url,
          ws_url:        null,
          stream_key:    null,
          stream_status: "error",
          source:        "rtsp",
        }]);
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
          <p className="page-desc">Discover and enroll devices from your network into the MIRADORAI VMS platform.</p>
        </div>
        <div className="add-dev__toolbar">
          <Button label="Manual Search" icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`} onClick={() => setShowManualSearch(true)} />
          <Button label="Stream URL"   icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`} onClick={() => setShowStreamURL(true)} />
          <Button
            label="Refresh"
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="${refreshing ? "spin" : ""}"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`}
            onClick={handleRefresh}
          />
        </div>
      </div>

      <div className="add-dev__options-bar">
        <div className="add-dev__toggle-row">
          <Toggle value={includePrerecorded} onChange={setInclude} />
          <span>Include prerecorded video</span>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Filter devices..." />
      </div>

      <div className="add-dev__info-pill">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8h.01M12 12v4"/></svg>
        {enrolling ? `⏳ ${enrollMsg}` : "Refresh to sync latest devices from the server."}
      </div>

      <div className="add-dev__table-wrap card">
        {filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="m-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}><input type="checkbox" className="m-checkbox" checked={allChecked} onChange={toggleAll} /></th>
                <th style={{ width: 60 }}></th>
                {["Device Name", "IP Address", "MAC Address", "Status", "Manufacturer", "Model"].map((c) => <th key={c}>{c}</th>)}
                <th>Stream</th>
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
                    <td>
                      {d.stream_status === "streaming"
                        ? <span className="add-dev__stream add-dev__stream--live">● LIVE</span>
                        : d.ws_url
                          ? <span className="add-dev__stream add-dev__stream--pending">● {d.stream_status || "pending"}</span>
                          : <span className="add-dev__stream add-dev__stream--none">— not registered</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="page-footer">
        <span className="add-dev__count">
          {filtered.length} device{filtered.length !== 1 ? "s" : ""} enrolled · {filtered.filter(d => d.status === "Online").length} online
        </span>
        <Button
          label={checked.length > 0 ? `Enroll ${checked.length} Device${checked.length > 1 ? "s" : ""}` : "Enroll"}
          variant="primary"
          disabled={checked.length === 0}
        />
      </div>

      {showManualSearch && <ManualSearchModal onClose={() => setShowManualSearch(false)} onEnroll={handleEnroll} />}
      {showStreamURL    && <StreamURLModal    onClose={() => setShowStreamURL(false)}    onAdd={handleAddStreamURLs} />}
    </div>
  );
}