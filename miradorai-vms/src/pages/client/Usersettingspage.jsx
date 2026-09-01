import { useState, useCallback, useEffect } from "react";
import Toggle from "../../components/shared/Toggle";
import Button from "../../components/shared/Button";
import { useUserSettings } from "../../context/UserSettingsContext";
import ServerFolderPicker from "../../components/shared/ServerFolderPicker";
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

// Sound picker (radio: No sound / Beep / Sound file)
function SoundPicker({ value, onChange, fileValue, onFileChange, hideFileOption }) {
  const handleBrowse = async () => {
    try {
      const API = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${API}/api/pick-file`);
      const data = await res.json();
      if (data.success && data.path) {
        onFileChange(data.path);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to pick file from native dialog.");
    }
  };

  const handlePlay = () => {
    if (value === "beep") {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, 300);
      } catch(e) {}
    } else if (value === "file" && fileValue) {
      try {
        const url = `${import.meta.env.VITE_API_URL || ""}/api/stream-audio?path=${encodeURIComponent(fileValue)}`;
        const audio = new Audio(url);
        audio.play().catch(e => console.error("Audio play failed:", e));
      } catch(e) {}
    }
  };

  const options = hideFileOption ? ["no-sound", "beep"] : ["no-sound", "beep", "file"];

  return (
    <div className="us-sound-picker">
      {options.map((opt) => (
        <label key={opt} className="us-radio-lbl" style={{display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px'}}>
          <input
            type="radio"
            name={`sound-opt-${Math.random()}`}
            checked={value === opt}
            onChange={() => onChange(opt)}
          />
          {opt === "no-sound" && "No sound"}
          {opt === "beep" && "Beep"}
          {opt === "file" && (
            <>
              <span>Sound file:</span>
              <input
                className="us-path-input us-audio-path"
                value={fileValue}
                placeholder="Music"
                disabled={value !== "file"}
                onChange={(e) => onFileChange(e.target.value)}
              />
              <Button label="Browse..." disabled={value !== "file"} onClick={handleBrowse} />
            </>
          )}
        </label>
      ))}
    </div>
  );
}

export default function UserSettingsPage() {
  const { settings, saveSettings } = useUserSettings();
  const [draft, setDraft] = useState(settings);
  const [toastMsg, setToastMsg] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  // Debounced auto-save effect
  useEffect(() => {
    const timer = setTimeout(() => {
      // Check if draft actually differs from settings
      const hasChanges = Object.keys(draft).some(key => draft[key] !== settings[key]);
      if (hasChanges) {
        saveSettings(draft);
        setToastMsg("Settings saved automatically.");
        setTimeout(() => setToastMsg(""), 3000);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [draft, settings, saveSettings]);

  const updateDraft = (key, val) => {
    setDraft((prev) => ({ ...prev, [key]: val }));
  };

  const handleBrowseFolder = async () => {
    if (window.electron?.showOpenDialog) {
      const result = await window.electron.showOpenDialog({ properties: ['openDirectory'] });
      if (!result.canceled && result.filePaths.length > 0) {
        updateDraft('snapFolder', result.filePaths[0]);
      }
    } else {
      try {
        const token = localStorage.getItem("token") || sessionStorage.getItem("token");
        const headers = token ? { "Authorization": `Bearer ${token}` } : {};
        const API = import.meta.env.VITE_API_URL || "";
        const res = await fetch(`${API}/api/pick-folder`, { headers });
        const data = await res.json();
        if (data.success && data.path) {
          updateDraft('snapFolder', data.path);
        } else if (data.error !== "Canceled") {
          setIsPickerOpen(true);
        }
      } catch (err) {
        console.error("Failed to trigger native folder picker:", err);
        setIsPickerOpen(true);
      }
    }
  };

  return (
    <div className="page-shell">
      {toastMsg && <div className="us-toast">{toastMsg}</div>}
      <ServerFolderPicker
        isOpen={isPickerOpen}
        initialPath={draft.snapFolder || "C:\\"}
        onClose={() => setIsPickerOpen(false)}
        onSelect={(path) => {
          updateDraft('snapFolder', path);
          setIsPickerOpen(false);
        }}
      />
      <div className="page-header">
        <div>
          <h1 className="page-title">User <span>Settings</span></h1>
          <p className="page-desc">
            These settings apply to the current MIRADOR VMS user on this computer.
          </p>
        </div>
      </div>

      <div className="us-body">
        {/* Navigation system section intentionally removed as requested */}

        {/* Notifications */}
        <Section title="Notifications">
          <SettingRow label="Show alarms in Navigation panel">
            <Toggle value={draft.notifAlarms} onChange={(v) => updateDraft('notifAlarms', v)} />
          </SettingRow>
          <SettingRow label="Show Background tasks in Navigation panel">
            <Toggle value={draft.notifTasks} onChange={(v) => updateDraft('notifTasks', v)} />
          </SettingRow>
          {/* Device management and Intercom settings intentionally removed */}
        </Section>

        {/* Snapshot */}
        <Section title="Snapshot">
          <SettingRow label="When a snapshot is taken show a message">
            <Toggle value={draft.snapMsg} onChange={(v) => updateDraft('snapMsg', v)} />
          </SettingRow>
          <SettingRow label="When a snapshot is taken open the snapshot folder">
            <Toggle value={draft.snapOpen} onChange={(v) => updateDraft('snapOpen', v)} />
          </SettingRow>
          <div className="us-row us-row--inline">
            <span className="us-row__label">Snapshot folder:</span>
            <input className="us-path-input" value={draft.snapFolder}
              onChange={(e) => updateDraft('snapFolder', e.target.value)} />
            <Button label="Browse..." onClick={handleBrowseFolder} />
          </div>
        </Section>

        {/* Startup */}
        <Section title="Startup">
          <SettingRow label="Start in full screen">
            <Toggle value={draft.fullScreen} onChange={(v) => updateDraft('fullScreen', v)} />
          </SettingRow>
          <SettingRow label="Remember last used tabs">
            <Toggle value={draft.remTabs} onChange={(v) => updateDraft('remTabs', v)} />
          </SettingRow>
          <SettingRow label="Remember last used monitors">
            <Toggle value={draft.remMonitors} onChange={(v) => updateDraft('remMonitors', v)} />
          </SettingRow>
        </Section>

        {/* Sound on alarm */}
        <Section title="Sound on alarm">
          <SoundPicker
            value={draft.alarmSound}   onChange={(v) => updateDraft('alarmSound', v)}
            fileValue={draft.alarmFile} onFileChange={(v) => updateDraft('alarmFile', v)}
            hideFileOption={true}
          />
        </Section>

        {/* Sound on incoming call intentionally removed */}

        {/* Features */}
        <Section title="Features">
          <SettingRow label="Show smart search 1">
            <Toggle value={draft.smartSearch} onChange={(v) => updateDraft('smartSearch', v)} />
          </SettingRow>
        </Section>

      </div>
    </div>
  );
}
