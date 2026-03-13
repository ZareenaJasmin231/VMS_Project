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
//ngjtrjtufyfdvhdhu
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

export default function AddDevicesPage() {
  const [filter, setFilter] = useState("");
  const [includePrerecorded, setInclude] = useState(true);
  const [checked, setChecked] = useState([]);
  const [showManualSearch, setShowManualSearch] = useState(false);
  const [showStreamURL, setShowStreamURL] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollMsg, setEnrollMsg] = useState("");
  const [devices, setDevices] = usePersistedDevices();

  const filtered = devices.filter((d) =>
    (d.name || "").toLowerCase().includes(filter.toLowerCase()) ||
    (d.ip   || "").toLowerCase().includes(filter.toLowerCase())
  );
  const allChecked = filtered.length > 0 && filtered.every((d) => checked.includes(d.id));
  const toggleAll  = () => setChecked(allChecked ? [] : filtered.map((d) => d.id));
  const toggleOne  = (id) => setChecked((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  // ── ONVIF enroll (existing) ──────────────────────────────────────────
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

  // ── RTSP / Stream URL enroll (NEW) ───────────────────────────────────
  const handleAddStreamURLs = async (urls) => {
    setShowStreamURL(false);
    setEnrolling(true);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      setEnrollMsg(`Registering stream ${i + 1} of ${urls.length}…`);

      try {
        // POST to your backend — adjust endpoint to match your actual API
        const res = await fetch(`${STREAM_API}/api/streams/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rtsp_url: url }),
        });

        const data = res.ok ? await res.json() : null;

        // Extract a readable name from the URL (e.g. "Stream @ 192.168.1.64")
        let ip = "—";
        try { ip = new URL(url).hostname; } catch {}
        const name = `Stream @ ${ip}`;

        const newDevice = {
          id:            String(Date.now()) + i,
          type:          "entrance",
          name,
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
        };

        setDevices((prev) => [...prev, newDevice]);

      } catch (err) {
        console.error(`Failed to register stream: ${url}`, err);

        // Still add it to the table so user knows it was attempted
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
          <Button label="Stream URL" icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`} onClick={() => setShowStreamURL(true)} />
          <Button label="Refresh" icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`} />
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
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                  No devices enrolled yet. Use <strong>Manual Search</strong> or <strong>Stream URL</strong> to add cameras.
                </td>
              </tr>
            )}
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
                      ? <span style={{ color: "#22c55e", fontSize: 11, fontWeight: 600 }}>● LIVE</span>
                      : d.ws_url
                        ? <span style={{ color: "#f59e0b", fontSize: 11 }}>● {d.stream_status || "pending"}</span>
                        : <span style={{ color: "#475569", fontSize: 11 }}>— not registered</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="page-footer">
        <span className="add-dev__count">{filtered.length} device{filtered.length !== 1 ? "s" : ""} enrolled · {filtered.filter(d => d.status === "Online").length} online</span>
        <Button
          label={checked.length > 0 ? `Enroll ${checked.length} Device${checked.length > 1 ? "s" : ""}` : "Enroll"}
          variant="primary"
          disabled={checked.length === 0}
        />
      </div>

      {showManualSearch && (
        <ManualSearchModal
          onClose={() => setShowManualSearch(false)}
          onEnroll={handleEnroll}
        />
      )}
      {showStreamURL && (
        <StreamURLModal
          onClose={() => setShowStreamURL(false)}
          onAdd={handleAddStreamURLs}
        />
      )}
    </div>
  );
}