import { useState } from "react";
import DataTable from "../../components/shared/DataTable";
import Button from "../../components/shared/Button";
import Toggle from "../../components/shared/Toggle";
import "./StorageSelectionPage.css";

export default function StorageSelectionPage() {
  const [storeTo, setStoreTo]     = useState("");
  const [retention, setRetention] = useState("unlimited");
  const [days, setDays]           = useState("");
  const [failover, setFailover]   = useState(false);

  return (
    <div className="page-shell">
      <div className="page-header"><div><h1 className="page-title">Storage <span>Selection</span></h1><p className="page-desc">Assign recording destinations and configure retention policies per device.</p></div></div>
      <DataTable columns={["Device", "Used Storage", "Location", "Retention", "Oldest Recording", "Failover"]} rows={[]} selectedId={null} onSelect={null} emptyMessage="No devices configured." />
      <div className="ss-panel card">
        <div className="ss-panel__title">Recording Storage Policy</div>
        <div className="ss-grid">
          <div className="ss-field"><label>Store To</label>
            <select value={storeTo} onChange={(e) => setStoreTo(e.target.value)} className="ss-select">
              <option value="">Select location...</option>
              <option value="local">Local Disk</option>
              <option value="nas">Network NAS</option>
              <option value="sd">SD Card</option>
              <option value="cloud">Cloud Storage</option>
            </select>
          </div>
          <div className="ss-field"><label>Retention Policy</label>
            <div className="ss-radios">
              {[["unlimited", "Unlimited"], ["limited", "Limited Duration"]].map(([v, l]) => (
                <label key={v} className="ss-radio"><input type="radio" name="ret" checked={retention === v} onChange={() => setRetention(v)} />{l}</label>
              ))}
              {retention === "limited" && (
                <div className="ss-days"><input type="number" value={days} onChange={(e) => setDays(e.target.value)} placeholder="30" /><span>days</span></div>
              )}
            </div>
          </div>
          <div className="ss-field"><label>Failover Recording</label><Toggle value={failover} onChange={setFailover} /></div>
        </div>
        <div className="ss-footer"><Button label="Apply Policy" variant="primary" /></div>
      </div>
    </div>
  );
}
