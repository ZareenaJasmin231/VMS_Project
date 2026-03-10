import { useState } from "react";
import DataTable from "../../components/shared/DataTable";
import Toggle from "../../components/shared/Toggle";
import Button from "../../components/shared/Button";
import "./TimeSyncPage.css";

export default function TimeSyncPage() {
  const [enabled, setEnabled]   = useState(false);
  const [ntpSrc, setNtpSrc]     = useState("");
  const [priType, setPriType]   = useState("address");
  const [priAddr, setPriAddr]   = useState("");
  const [secOn, setSecOn]       = useState(false);
  const [secAddr, setSecAddr]   = useState("");
  const [alarm, setAlarm]       = useState(false);
  const NTP_SERVERS = ["time.windows.com", "pool.ntp.org", "time.google.com", "time.cloudflare.com"];

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Time <span>Synchronization</span></h1>
          <p className="page-desc">Configure NTP settings to keep all device clocks aligned across the network.</p>
        </div>
      </div>
      <DataTable columns={["Device", "Sync Enabled", "NTP Source", "Primary NTP", "Secondary NTP", "Alarm", "Offset"]} rows={[]} selectedId={null} onSelect={null} emptyMessage="No devices to configure." />

      <div className="ts-panels">
        <div className="ts-config card">
          <div className="ts-config__header">
            <span className="ts-config__title">Synchronization Settings</span>
            <Toggle value={enabled} onChange={setEnabled} />
          </div>

          <div className={`ts-body ${!enabled ? "ts-body--disabled" : ""}`}>
            <div className="ts-field">
              <label>NTP Source</label>
              <select disabled={!enabled} value={ntpSrc} onChange={(e) => setNtpSrc(e.target.value)} className="ts-select">
                <option value="">Select source...</option>
                <option value="manual">Manual</option>
                <option value="dhcp">DHCP</option>
              </select>
            </div>
            <div className="ts-ntp-row">
              <div className="ts-ntp-block">
                <div className="ts-ntp-title">Primary NTP Server</div>
                {[["address", "Custom Address"], ["axis", "Use MIRADORAI Server"]].map(([v, l]) => (
                  <label key={v} className="ts-radio">
                    <input type="radio" name="pri" checked={priType === v} disabled={!enabled} onChange={() => setPriType(v)} />
                    <span>{l}</span>
                  </label>
                ))}
                {priType === "address" && (
                  <select disabled={!enabled} value={priAddr} onChange={(e) => setPriAddr(e.target.value)} className="ts-select">
                    <option value="">Select NTP server...</option>
                    {NTP_SERVERS.map((s) => <option key={s}>{s}</option>)}
                  </select>
                )}
              </div>
              <div className="ts-ntp-block">
                <label className="ts-radio ts-radio--bold">
                  <input type="checkbox" checked={secOn} disabled={!enabled} onChange={(e) => setSecOn(e.target.checked)} />
                  <span>Secondary NTP Server</span>
                </label>
                {[["address", "Custom Address"], ["axis", "Use MIRADORAI Server"]].map(([v, l]) => (
                  <label key={v} className="ts-radio">
                    <input type="radio" name="sec" disabled={!enabled || !secOn} onChange={() => {}} />
                    <span>{l}</span>
                  </label>
                ))}
                <select disabled={!enabled || !secOn} value={secAddr} onChange={(e) => setSecAddr(e.target.value)} className="ts-select">
                  <option value="">Select NTP server...</option>
                  {NTP_SERVERS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <label className="ts-alarm-row">
              <input type="checkbox" checked={alarm} disabled={!enabled} onChange={(e) => setAlarm(e.target.checked)} />
              <span>Trigger alarm when device time offset exceeds 2 seconds</span>
            </label>
            <div className="ts-apply"><Button label="Apply" variant="primary" disabled={!enabled} /></div>
          </div>
        </div>

        <div className="ts-info card">
          <div className="ts-info__title">Server Time Service</div>
          {[["Server", "MIRADORAI-SRV"], ["Status", "Running"], ["NTP Server", "time.windows.com"], ["Last Sync", "Just now"]].map(([k, v]) => (
            <div key={k} className="ts-info__row">
              <span className="ts-info__key">{k}</span>
              <span className="ts-info__val">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
