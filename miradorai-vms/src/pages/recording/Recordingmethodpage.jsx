import { useState } from "react";
import Button from "../../components/shared/Button";
import Toggle from "../../components/shared/Toggle";
import "./RecordingMethodPage.css";

const STREAM_PROFILES = [
  "High (1920x1080, 30 fps, H.264)",
  "Medium (1280x720, 15 fps, H.264)",
  "Low (640x360, 10 fps, H.264)",
  "Mobile (320x180, 8 fps, H.264)",
];

const SCHEDULES = ["Always", "Office Hours", "Weekends", "New schedule"];

const DEFAULT_MOTION = {
  enabled: false, profile: "High (1920x1080, 30 fps, H.264)",
  prebuffer: 5, postbuffer: 10, raiseAlarm: true,
  schedule: "Always", triggerPeriod: 10,
};
const DEFAULT_CONTINUOUS = {
  enabled: false, profile: "Medium (1280x720, 15 fps, H.264)",
  prebuffer: 0, postbuffer: 0, schedule: "Always",
  avgBitrate: true, maxStorage: 352,
};
const DEFAULT_MANUAL = {
  enabled: false, profile: "High (1920x1080, 30 fps, H.264)",
  prebuffer: 0, postbuffer: 0,
};

function loadDevices() {
  try {
    const saved = localStorage.getItem("miradorai_devices");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function loadRecSettings() {
  try {
    const saved = localStorage.getItem("miradorai_rec_settings");
    return saved ? JSON.parse(saved) : {};
  } catch { return {}; }
}

function saveRecSettings(settings) {
  try {
    localStorage.setItem("miradorai_rec_settings", JSON.stringify(settings));
  } catch {}
}

// ── Spinner ───────────────────────────────────────────────────
function Spinner({ value, onChange, min = 0, max = 9999, disabled }) {
  return (
    <div className={`rm-spinner${disabled ? " rm-spinner--disabled" : ""}`}>
      <input
        type="number"
        className="rm-spinner__input"
        value={value}
        min={min} max={max}
        disabled={disabled}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
      />
      <div className="rm-spinner__btns">
        <button className="rm-spinner__btn" disabled={disabled}
          onClick={() => onChange(Math.min(max, value + 1))}>▲</button>
        <button className="rm-spinner__btn" disabled={disabled}
          onClick={() => onChange(Math.max(min, value - 1))}>▼</button>
      </div>
    </div>
  );
}

// ── Schedule row ──────────────────────────────────────────────
function ScheduleRow({ value, onChange, disabled }) {
  return (
    <div className="rm-schedule-row">
      <select className="rm-select rm-select--schedule" value={value}
        onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {SCHEDULES.map((s) => <option key={s}>{s}</option>)}
      </select>
      <Button label="Edit..." variant="outline" disabled={disabled} onClick={() => {}} />
      <Button label="New..."  variant="outline" disabled={disabled} onClick={() => {}} />
    </div>
  );
}

// ── Column Panel ──────────────────────────────────────────────
function ColumnPanel({ title, data, onChange, showAlarm, showTrigger, showBitrate, showSchedule = true }) {
  const dis = !data.enabled;
  const set = (key, val) => onChange({ ...data, [key]: val });

  return (
    <div className="rm-col">
      {/* Header */}
      <div className="rm-col__header">
        <span className="rm-col__title">{title}</span>
        <Toggle value={data.enabled} onChange={(v) => set("enabled", v)} />
      </div>

      {/* Video settings */}
      <div className="rm-col__section-label">Video settings</div>

      <div className="rm-field">
        <label className="rm-label">Profile:</label>
        <select className="rm-select" value={data.profile}
          disabled={dis} onChange={(e) => set("profile", e.target.value)}>
          {STREAM_PROFILES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>

      <div className="rm-field rm-field--inline">
        <label className="rm-label">Prebuffer:</label>
        <Spinner value={data.prebuffer} onChange={(v) => set("prebuffer", v)} disabled={dis} />
        <span className="rm-unit">seconds</span>
      </div>

      <div className="rm-field rm-field--inline">
        <label className="rm-label">Postbuffer:</label>
        <Spinner value={data.postbuffer} onChange={(v) => set("postbuffer", v)} disabled={dis} />
        <span className="rm-unit">seconds</span>
      </div>

      {showAlarm && (
        <label className={`rm-checkbox-row${dis ? " rm-checkbox-row--disabled" : ""}`}>
          <input type="checkbox" checked={data.raiseAlarm} disabled={dis}
            onChange={(e) => set("raiseAlarm", e.target.checked)} />
          <span>Raise alarm</span>
        </label>
      )}

      {/* Schedule */}
      {showSchedule && (
        <>
          <div className="rm-col__section-label">Schedule</div>
          <ScheduleRow value={data.schedule} onChange={(v) => set("schedule", v)} disabled={dis} />
        </>
      )}

      {/* Advanced */}
      {(showTrigger || showBitrate) && (
        <div className="rm-col__section-label">Advanced</div>
      )}

      {showTrigger && (
        <>
          <div className="rm-field rm-field--inline">
            <label className="rm-label">Trigger period:</label>
            <Spinner value={data.triggerPeriod} onChange={(v) => set("triggerPeriod", v)} disabled={dis} />
            <span className="rm-unit">seconds</span>
          </div>
          <div className="rm-adv-btn">
            <Button label="Motion settings..." variant="outline" disabled={dis} onClick={() => {}} />
          </div>
        </>
      )}

      {showBitrate && (
        <>
          <div className="rm-field rm-field--inline rm-field--toggle">
            <label className="rm-label">Average bitrate</label>
            <Toggle value={data.avgBitrate} onChange={(v) => set("avgBitrate", v)} disabled={dis} />
          </div>
          {data.avgBitrate && !dis && (
            <>
              <div className="rm-field rm-field--inline">
                <label className="rm-label">Max storage:</label>
                <Spinner value={data.maxStorage} onChange={(v) => set("maxStorage", v)}
                  disabled={dis} min={1} max={9999} />
                <span className="rm-unit">GB</span>
              </div>
              <p className="rm-bitrate-hint">
                The average bitrate will be 488 Kbit/s based on the configured max storage and retention time.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Truncate helper ───────────────────────────────────────────
const trunc = (str, n = 24) => str && str.length > n ? str.slice(0, n) + "…" : (str || "—");

// ── Main Page ─────────────────────────────────────────────────
export default function RecordingMethodPage() {
  const [filter,      setFilter]      = useState("");
  const [selectedId,  setSelectedId]  = useState(null);
  const [recSettings, setRecSettings] = useState(loadRecSettings);

  const devices = loadDevices();

  // Get or init settings for a device
  const getSettings = (id) => recSettings[id] ?? {
    motion:     { ...DEFAULT_MOTION },
    continuous: { ...DEFAULT_CONTINUOUS },
    manual:     { ...DEFAULT_MANUAL },
  };

  const updateSection = (section, data) => {
    if (!selectedId) return;
    const updated = {
      ...recSettings,
      [selectedId]: {
        ...getSettings(selectedId),
        [section]: data,
      },
    };
    setRecSettings(updated);
    saveRecSettings(updated);
  };

  const handleApply = () => saveRecSettings(recSettings);

  const filtered = devices.filter((d) =>
    !filter ||
    [d.name, d.ip, d.manufacturer, d.model]
      .filter(Boolean)
      .some((c) => c.toLowerCase().includes(filter.toLowerCase()))
  );

  const selected    = selectedId ? getSettings(selectedId) : null;
  const selDevice   = devices.find((d) => String(d.id) === String(selectedId));

  return (
    <div className="rm-page">
      {/* Header */}
      <div className="rm-page-header">
        <div>
          <h1 className="rm-page-title">Recording method</h1>
          <p className="rm-page-desc">
            Select which stream profile to use for recording. To edit stream profiles, go to Stream profiles.
            To manage events, go to Action rules.
          </p>
        </div>
        <input className="rm-filter" placeholder="Type to filter"
          value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      {/* Camera table */}
      <div className="rm-table-wrap">
        <table className="rm-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>Name</th>
              <th>Motion detection</th>
              <th>Continuous</th>
              <th>Motion profile</th>
              <th>Continuous profile</th>
              <th>Manual profile</th>
              <th>Server</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)",
                  padding: "20px", fontSize: 12 }}>
                  No cameras enrolled. Go to Add Devices first.
                </td>
              </tr>
            ) : filtered.map((cam) => {
              const s = getSettings(String(cam.id));
              return (
                <tr key={cam.id}
                  className={String(cam.id) === String(selectedId) ? "selected" : ""}
                  onClick={() => setSelectedId(String(cam.id))}>
                  <td>
                    <div className="rm-thumb">
                      {cam.snapshot_url
                        ? <img src={cam.snapshot_url} alt={cam.name} />
                        : <div className="rm-thumb__placeholder" />}
                    </div>
                  </td>
                  <td>{cam.name}</td>
                  <td className="rm-cell-center">{s.motion.enabled     ? "✓" : ""}</td>
                  <td className="rm-cell-center">{s.continuous.enabled  ? "✓" : ""}</td>
                  <td className="rm-cell-mono">{s.motion.enabled     ? trunc(s.motion.profile)     : "—"}</td>
                  <td className="rm-cell-mono">{s.continuous.enabled  ? trunc(s.continuous.profile) : "—"}</td>
                  <td className="rm-cell-mono">{s.manual.enabled      ? trunc(s.manual.profile)     : "—"}</td>
                  <td>MIRADOR</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Divider */}
      <div className="rm-divider"><div className="rm-divider__handle" /></div>

      {/* Detail panel */}
      {selected && (
        <div className="rm-detail">
          <ColumnPanel
            title="Motion detection"
            data={selected.motion}
            onChange={(d) => updateSection("motion", d)}
            showAlarm showTrigger showSchedule
          />
          <div className="rm-col-sep" />
          <ColumnPanel
            title="Continuous"
            data={selected.continuous}
            onChange={(d) => updateSection("continuous", d)}
            showBitrate showSchedule
          />
          <div className="rm-col-sep" />
          <ColumnPanel
            title="Manual"
            data={selected.manual}
            onChange={(d) => updateSection("manual", d)}
            showSchedule={false}
          />
          <div className="rm-apply-row">
            <Button label="Apply" variant="primary" onClick={handleApply} />
          </div>
        </div>
      )}

      {/* Placeholder when nothing selected */}
      {!selected && filtered.length > 0 && (
        <div className="rm-detail rm-detail--empty">
          <span>Select a camera above to configure recording settings.</span>
        </div>
      )}
    </div>
  );
}