import { useState } from "react";
import Toggle from "../../components/shared/Toggle";
import Button from "../../components/shared/Button";
import "./ClientSettingsPage.css";

const SECTIONS = [
  { title: "Appearance", settings: [["Dark Mode", "darkMode", "toggle"], ["Compact Sidebar", "compactSidebar", "toggle"]] },
  { title: "Notifications", settings: [["Desktop Alerts", "desktopAlerts", "toggle"], ["Sound Alerts", "soundAlerts", "toggle"], ["Email Digest", "emailDigest", "toggle"]] },
  { title: "System", settings: [["Auto Login", "autoLogin", "toggle"], ["Language", "language", "select"]] },
];

export default function ClientSettingsPage() {
  const [vals, setVals] = useState({ darkMode: true, compactSidebar: false, desktopAlerts: true, soundAlerts: false, emailDigest: false, autoLogin: false, language: "en" });
  const set = (k, v) => setVals((p) => ({ ...p, [k]: v }));

  return (
    <div className="page-shell">
      <div className="page-header"><div><h1 className="page-title">Client <span>Settings</span></h1><p className="page-desc">Customize your MIRADORAI VMS client experience.</p></div></div>
      <div className="cs-grid">
        {SECTIONS.map(({ title, settings }) => (
          <div key={title} className="cs-card card">
            <div className="cs-card__title">{title}</div>
            {settings.map(([label, key, type]) => (
              <div key={key} className="cs-row">
                <span className="cs-label">{label}</span>
                {type === "toggle"
                  ? <Toggle value={vals[key]} onChange={(v) => set(key, v)} />
                  : <select value={vals[key]} onChange={(e) => set(key, e.target.value)} className="cs-select">
                      <option value="en">English</option>
                      <option value="sv">Swedish</option>
                      <option value="de">German</option>
                      <option value="fr">French</option>
                    </select>
                }
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="page-footer"><span /><Button label="Save Settings" variant="primary" /></div>
    </div>
  );
}
