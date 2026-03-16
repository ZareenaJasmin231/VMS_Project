import { useState } from "react";
import Toggle from "../../components/shared/Toggle";
import Button from "../../components/shared/Button";
import "./UserSettingsPage.css";

const NAV_SHOW_OPTIONS = [
  "Views and Cameras",
  "Views only",
  "Cameras only",
  "Nothing",
];

function Section({ title, children }) {
  return (
    <div className="us-section">
      <div className="us-section__title">{title}</div>
      <div className="us-section__body">{children}</div>
    </div>
  );
}

function SettingRow({ label, children }) {
  return (
    <div className="us-row">
      <span className="us-row__label">{label}</span>
      <div className="us-row__control">{children}</div>
    </div>
  );
}

// ── Sound picker (radio: No sound / Beep / Sound file) ────────
function SoundPicker({ value, onChange, fileValue, onFileChange }) {
  return (
    <div className="us-sound">
      {["no-sound", "beep", "file"].map((opt) => (
        <label key={opt} className="us-radio">
          <input type="radio" name={`sound-${Math.random()}`}
            checked={value === opt}
            onChange={() => onChange(opt)} />
          <span>
            {opt === "no-sound" ? "No sound" : opt === "beep" ? "Beep" : "Sound file:"}
          </span>
          {opt === "file" && (
            <>
              <input
                className="us-file-input"
                value={fileValue}
                placeholder="Music"
                disabled={value !== "file"}
                onChange={(e) => onFileChange(e.target.value)}
              />
              <Button label="Browse..." disabled={value !== "file"} onClick={() => {}} />
            </>
          )}
        </label>
      ))}
      <div className="us-play-btn">
        <Button label="Play" disabled={value === "no-sound"} onClick={() => {}} />
      </div>
    </div>
  );
}

export default function UserSettingsPage() {
  // Navigation system
  const [treeView,     setTreeView]     = useState(true);
  const [showIn,       setShowIn]       = useState("Views and Cameras");
  const [showNavPath,  setShowNavPath]  = useState(true);

  // Notifications
  const [notifAlarms,  setNotifAlarms]  = useState(true);
  const [notifTasks,   setNotifTasks]   = useState(true);
  const [notifDevMgmt, setNotifDevMgmt] = useState(true);
  const [notifIntercom,setNotifIntercom]= useState(true);

  // Snapshot
  const [snapMsg,      setSnapMsg]      = useState(false);
  const [snapOpen,     setSnapOpen]     = useState(true);
  const [snapFolder,   setSnapFolder]   = useState("C:\\Users\\miradorwin\\Pictures");

  // Startup
  const [fullScreen,   setFullScreen]   = useState(false);
  const [remTabs,      setRemTabs]      = useState(true);
  const [remMonitors,  setRemMonitors]  = useState(true);

  // Sound on alarm
  const [alarmSound,   setAlarmSound]   = useState("no-sound");
  const [alarmFile,    setAlarmFile]    = useState("");

  // Sound on incoming call
  const [callSound,    setCallSound]    = useState("no-sound");
  const [callFile,     setCallFile]     = useState("");

  // Features
  const [smartSearch,  setSmartSearch]  = useState(true);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">User <span>Settings</span></h1>
          <p className="page-desc">
            These settings apply to the current MIRADOR VMS user on this computer.
          </p>
        </div>
      </div>

      <div className="us-body">

        {/* ── Navigation system ── */}
        <Section title="Navigation system">
          <SettingRow label="Tree view navigation system">
            <Toggle value={treeView} onChange={setTreeView} />
          </SettingRow>

          <div className="us-row us-row--inline">
            <span className="us-row__label">Show in navigation:</span>
            <select className="us-select" value={showIn}
              onChange={(e) => setShowIn(e.target.value)}>
              {NAV_SHOW_OPTIONS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>

          <SettingRow label="Show navigation path when navigating in view">
            <Toggle value={showNavPath} onChange={setShowNavPath} />
          </SettingRow>
        </Section>

        {/* ── Notifications ── */}
        <Section title="Notifications">
          <SettingRow label="Show taskbar notification for alarms">
            <Toggle value={notifAlarms} onChange={setNotifAlarms} />
          </SettingRow>
          <SettingRow label="Show taskbar notification for tasks">
            <Toggle value={notifTasks} onChange={setNotifTasks} />
          </SettingRow>
          <SettingRow label="Show notifications in Device management">
            <Toggle value={notifDevMgmt} onChange={setNotifDevMgmt} />
          </SettingRow>
          <SettingRow label="Show intercom notification window">
            <Toggle value={notifIntercom} onChange={setNotifIntercom} />
          </SettingRow>
        </Section>

        {/* ── Snapshot ── */}
        <Section title="Snapshot">
          <SettingRow label="When a snapshot is taken show a message">
            <Toggle value={snapMsg} onChange={setSnapMsg} />
          </SettingRow>
          <SettingRow label="When a snapshot is taken open the snapshot folder">
            <Toggle value={snapOpen} onChange={setSnapOpen} />
          </SettingRow>
          <div className="us-row us-row--inline">
            <span className="us-row__label">Snapshot folder:</span>
            <input className="us-path-input" value={snapFolder}
              onChange={(e) => setSnapFolder(e.target.value)} />
            <Button label="Browse..." onClick={() => {}} />
          </div>
        </Section>

        {/* ── Startup ── */}
        <Section title="Startup">
          <SettingRow label="Start in full screen">
            <Toggle value={fullScreen} onChange={setFullScreen} />
          </SettingRow>
          <SettingRow label="Remember last used tabs">
            <Toggle value={remTabs} onChange={setRemTabs} />
          </SettingRow>
          <SettingRow label="Remember last used monitors">
            <Toggle value={remMonitors} onChange={setRemMonitors} />
          </SettingRow>
        </Section>

        {/* ── Sound on alarm ── */}
        <Section title="Sound on alarm">
          <SoundPicker
            value={alarmSound}   onChange={setAlarmSound}
            fileValue={alarmFile} onFileChange={setAlarmFile}
          />
        </Section>

        {/* ── Sound on incoming call ── */}
        <Section title="Sound on incoming call">
          <SoundPicker
            value={callSound}   onChange={setCallSound}
            fileValue={callFile} onFileChange={setCallFile}
          />
        </Section>

        {/* ── Features ── */}
        <Section title="Features">
          <SettingRow label="Show smart search 1">
            <Toggle value={smartSearch} onChange={setSmartSearch} />
          </SettingRow>
        </Section>

      </div>

      {/* Footer */}
      <div className="page-footer">
        <span />
        <div className="page-footer-right">
          <Button label="Apply" variant="primary" onClick={() => {}} />
        </div>
      </div>
    </div>
  );
}