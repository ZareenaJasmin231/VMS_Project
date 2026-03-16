import { useState } from "react";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";
import "./TimeSyncPage.css";

const NTP_SERVERS = [
  "time.windows.com", "pool.ntp.org",
  "time.google.com",  "time.cloudflare.com",
];

function loadDevices() {
  try {
    const saved = localStorage.getItem("miradorai_devices");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

export default function TimeSyncPage() {
  const [filter,   setFilter]   = useState("");
  const [selected, setSelected] = useState(null);

  // Per-device config stored in state (keyed by device id)
  const [configs, setConfigs] = useState({});

  const devices = loadDevices().filter((d) =>
    !filter ||
    [d.name, d.ip, d.manufacturer, d.model]
      .filter(Boolean)
      .some((c) => c.toLowerCase().includes(filter.toLowerCase()))
  );

  // Get config for selected device, with defaults
  const cfg = configs[selected] ?? {
    enabled:  false,
    ntpSrc:   "Static",
    priType:  "address",
    priAddr:  "",
    secOn:    false,
    secType:  "address",
    secAddr:  "",
    alarm:    false,
  };

  const setCfg = (patch) =>
    setSelected((sel) => {
      if (!sel) return sel;
      setConfigs((prev) => ({
        ...prev,
        [sel]: { ...(prev[sel] ?? cfg), ...patch },
      }));
      return sel;
    });

  // Helper to mutate cfg immediately (avoids stale closure)
  const update = (patch) => {
    if (!selected) return;
    setConfigs((prev) => ({
      ...prev,
      [selected]: { ...(prev[selected] ?? cfg), ...patch },
    }));
  };

  const handleApply = () => {
    // configs already updated live; Apply could POST to API here
  };

  // Build table rows
  const rows = devices.map((d) => {
    const c = configs[d.id] ?? {};
    return { d, c };
  });

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Time <span>Synchronization</span></h1>
          <p className="page-desc">Configure the time settings on devices.</p>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Type to filter" />
      </div>

      {/* Device Table */}
      <div style={{
        maxHeight: "calc(4 * 48px + 48px)",
        overflowY: "auto", borderRadius: 8,
        scrollbarWidth: "thin", scrollbarColor: "#334155 transparent",
      }}>
        <table className="ts-table">
          <thead>
            <tr>
              {["Name","Enabled","NTP Source","Primary NTP Server","Secondary NTP Server","Alarm","Server Time Offset"]
                .map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="ts-table__empty">No devices to configure.</td></tr>
            ) : rows.map(({ d, c }) => (
              <tr
                key={d.id}
                className={selected === String(d.id) ? "ts-row--selected" : ""}
                onClick={() => setSelected(String(d.id))}
              >
                <td>
                  <div className="ts-name-cell">
                    {d.snapshot_url
                      ? <img src={d.snapshot_url} className="ts-thumb" alt="" />
                      : <div className="ts-thumb ts-thumb--placeholder">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M23 7l-7 5 7 5V7z"/>
                            <rect x="1" y="5" width="15" height="14" rx="2"/>
                          </svg>
                        </div>
                    }
                    <span>{d.name}</span>
                  </div>
                </td>
                <td className="ts-td-center">{c.enabled ? "✓" : ""}</td>
                <td>{c.ntpSrc || "—"}</td>
                <td>{c.priType === "axis" ? "Use MIRADORAI Server" : (c.priAddr || "—")}</td>
                <td>{c.secOn ? (c.secType === "axis" ? "Use MIRADORAI Server" : (c.secAddr || "—")) : "—"}</td>
                <td className="ts-td-center">{c.alarm ? "✓" : ""}</td>
                <td className="ts-td-mono">{c.enabled ? "-00:00:00.0600443" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom panels */}
      <div className="ts-panels">
        <div className="ts-config card">

          {/* Enable checkbox */}
          <label className="ts-enable-row">
            <input
              type="checkbox"
              checked={cfg.enabled}
              disabled={!selected}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            <span>Enable time synchronization</span>
          </label>

          <div className={`ts-body ${(!selected || !cfg.enabled) ? "ts-body--disabled" : ""}`}>

            {/* NTP Source */}
            <div className="ts-inline-field">
              <label>NTP source:</label>
              <select
                value={cfg.ntpSrc}
                onChange={(e) => update({ ntpSrc: e.target.value })}
                className="ts-select ts-select--sm"
              >
                <option value="">Select source...</option>
                <option value="Static">Static</option>
                <option value="DHCP">DHCP</option>
              </select>
            </div>

            {/* Primary + Secondary NTP */}
            <div className="ts-ntp-row">

              {/* Primary */}
              <div className="ts-ntp-block">
                <div className="ts-ntp-title">Primary NTP Server</div>
                <label className="ts-radio">
                  <input type="radio" name="pri" checked={cfg.priType === "address"}
                    onChange={() => update({ priType: "address" })} />
                  <span>Server address</span>
                  {cfg.priType === "address" && (
                    <select value={cfg.priAddr}
                      onChange={(e) => update({ priAddr: e.target.value })}
                      className="ts-select ts-select--inline">
                      <option value="">—</option>
                      {NTP_SERVERS.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  )}
                </label>
                <label className="ts-radio">
                  <input type="radio" name="pri" checked={cfg.priType === "axis"}
                    onChange={() => update({ priType: "axis" })} />
                  <span>Use MIRADORAI Server</span>
                </label>
              </div>

              {/* Secondary */}
              <div className="ts-ntp-block">
                <label className="ts-radio ts-radio--bold">
                  <input type="checkbox" checked={cfg.secOn}
                    onChange={(e) => update({ secOn: e.target.checked })} />
                  <span>Secondary NTP Server</span>
                </label>
                <div className={cfg.secOn ? "" : "ts-sub--disabled"}>
                  <label className="ts-radio">
                    <input type="radio" name="sec" checked={cfg.secType === "address"}
                      disabled={!cfg.secOn}
                      onChange={() => update({ secType: "address" })} />
                    <span>Server address</span>
                    {cfg.secType === "address" && cfg.secOn && (
                      <select value={cfg.secAddr}
                        onChange={(e) => update({ secAddr: e.target.value })}
                        className="ts-select ts-select--inline">
                        <option value="">—</option>
                        {NTP_SERVERS.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    )}
                  </label>
                  <label className="ts-radio">
                    <input type="radio" name="sec" checked={cfg.secType === "axis"}
                      disabled={!cfg.secOn}
                      onChange={() => update({ secType: "axis" })} />
                    <span>Use MIRADORAI Server</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Alarm checkbox */}
            <label className="ts-alarm-row">
              <input type="checkbox" checked={cfg.alarm}
                onChange={(e) => update({ alarm: e.target.checked })} />
              <span>Send alarm when the time difference between server and device is larger than 2 seconds</span>
            </label>

            <div className="ts-apply">
              <Button label="Apply" variant="primary"
                disabled={!selected || !cfg.enabled} onClick={handleApply} />
            </div>
          </div>
        </div>

        {/* Server Time Service — plain text block */}
        <div className="ts-info card">
          <div className="ts-info__title">Windows Time service</div>
          <div className="ts-info__line">Server:&nbsp;&nbsp; MIRADOR</div>
          <div className="ts-info__line">Status:&nbsp;&nbsp; Running</div>
          <div className="ts-info__line">NTP server:&nbsp; time.windows.com</div>
        </div>
      </div>
    </div>
  );
}