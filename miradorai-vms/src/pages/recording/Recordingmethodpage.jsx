import { useState, useRef } from "react";
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

const INITIAL_CAMERAS = [
  {
    id: 1,
    name: "AXIS P1465-LE",
    thumb: null,
    server: "MIRADOR",
    motion: {
      enabled: true,
      profile: "High (1920x1080, 30 fps, H.264)",
      prebuffer: 5,
      postbuffer: 10,
      raiseAlarm: true,
      schedule: "Always",
      triggerPeriod: 10,
    },
    continuous: {
      enabled: true,
      profile: "Medium (1280x720, 15 fps, H.264)",
      prebuffer: 0,
      postbuffer: 0,
      schedule: "Always",
      avgBitrate: true,
      maxStorage: 352,
    },
    manual: {
      enabled: false,
      profile: "High (1920x1080, 30 fps, H.264)",
      prebuffer: 0,
      postbuffer: 0,
    },
  },
];

// ── Spinner input (▲▼ buttons) ────────────────────────────────
function Spinner({ value, onChange, min = 0, max = 999, disabled }) {
  return (
    <div className={`rm-spinner${disabled ? " rm-spinner--disabled" : ""}`}>
      <input
        type="number"
        className="rm-spinner__input"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
      />
      <div className="rm-spinner__btns">
        <button className="rm-spinner__btn" disabled={disabled} onClick={() => onChange(Math.min(max, value + 1))}>▲</button>
        <button className="rm-spinner__btn" disabled={disabled} onClick={() => onChange(Math.max(min, value - 1))}>▼</button>
      </div>
    </div>
  );
}

// ── Schedule row ──────────────────────────────────────────────
function ScheduleRow({ value, onChange, disabled }) {
  return (
    <div className="rm-schedule-row">
      <select
        className="rm-select rm-select--schedule"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {SCHEDULES.map((s) => <option key={s}>{s}</option>)}
      </select>
      <Button label="Edit..." variant="outline" disabled={disabled} onClick={() => {}} />
      <Button label="New..."  variant="outline" disabled={disabled} onClick={() => {}} />
    </div>
  );
}

// ── Column panel ──────────────────────────────────────────────
function ColumnPanel({ title, data, onChange, showAlarm, showTrigger, showBitrate }) {
  const dis = !data.enabled;

  const set = (key, val) => onChange({ ...data, [key]: val });

  return (
    <div className={`rm-col${dis ? " rm-col--off" : ""}`}>
      {/* Column header with toggle */}
      <div className="rm-col__header">
        <span className="rm-col__title">{title}</span>
        <Toggle value={data.enabled} onChange={(v) => set("enabled", v)} />
      </div>

      {/* Video settings */}
      <div className="rm-col__section-label">Video settings</div>

      <div className="rm-field">
        <label className="rm-label">Profile:</label>
        <select
          className="rm-select"
          value={data.profile}
          disabled={dis}
          onChange={(e) => set("profile", e.target.value)}
        >
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
          <input
            type="checkbox"
            checked={data.raiseAlarm}
            disabled={dis}
            onChange={(e) => set("raiseAlarm", e.target.checked)}
          />
          <span>Raise alarm</span>
        </label>
      )}

      {/* Schedule */}
      <div className="rm-col__section-label">Schedule</div>
      <ScheduleRow value={data.schedule} onChange={(v) => set("schedule", v)} disabled={dis} />

      {/* Advanced */}
      <div className="rm-col__section-label">Advanced</div>

      {showTrigger && (
        <div className="rm-field rm-field--inline">
          <label className="rm-label">Trigger period:</label>
          <Spinner value={data.triggerPeriod} onChange={(v) => set("triggerPeriod", v)} disabled={dis} />
          <span className="rm-unit">seconds</span>
        </div>
      )}

      {showTrigger && (
        <div className="rm-adv-btn">
          <Button label="Motion settings..." variant="outline" disabled={dis} onClick={() => {}} />
        </div>
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
                <Spinner value={data.maxStorage} onChange={(v) => set("maxStorage", v)} disabled={dis} min={1} max={9999} />
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

// ── Main Page ─────────────────────────────────────────────────
export default function RecordingMethodPage() {
  const [cameras,    setCameras]    = useState(INITIAL_CAMERAS);
  const [selectedId, setSelectedId] = useState(1);
  const [filter,     setFilter]     = useState("");

  const selected = cameras.find((c) => c.id === selectedId) || null;

  const updateSection = (section, data) => {
    setCameras((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, [section]: data } : c))
    );
  };

  const filtered = cameras.filter((c) =>
    c.name.toLowerCase().includes(filter.toLowerCase())
  );

  const truncate = (str, n = 22) => str.length > n ? str.slice(0, n) + "…" : str;

  return (
    <div className="rm-page">
      {/* ── Page header ── */}
      <div className="rm-page-header">
        <div>
          <h1 className="rm-page-title">Recording method</h1>
          <p className="rm-page-desc">
            Select which stream profile to use for recording. To edit stream profiles, go to Stream profiles. To manage events, go to Action rules.
          </p>
        </div>
        <input
          className="rm-filter"
          placeholder="Type to filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* ── Camera table ── */}
      <div className="rm-table-wrap">
        <table className="rm-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}></th>
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
            {filtered.map((cam) => (
              <tr
                key={cam.id}
                className={cam.id === selectedId ? "selected" : ""}
                onClick={() => setSelectedId(cam.id)}
              >
                <td>
                  <div className="rm-thumb">
                    {cam.thumb
                      ? <img src={cam.thumb} alt={cam.name} />
                      : <div className="rm-thumb__placeholder" />}
                  </div>
                </td>
                <td>{cam.name}</td>
                <td className="rm-cell-center">{cam.motion.enabled    ? "✓" : ""}</td>
                <td className="rm-cell-center">{cam.continuous.enabled ? "✓" : ""}</td>
                <td className="rm-cell-mono">{cam.motion.enabled    ? truncate(cam.motion.profile)     : "—"}</td>
                <td className="rm-cell-mono">{cam.continuous.enabled ? truncate(cam.continuous.profile) : "—"}</td>
                <td className="rm-cell-mono">{cam.manual.enabled    ? truncate(cam.manual.profile)     : "—"}</td>
                <td>{cam.server}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Divider ── */}
      <div className="rm-divider"><div className="rm-divider__handle" /></div>

      {/* ── Three column detail panel ── */}
      {selected && (
        <div className="rm-detail">
          <ColumnPanel
            title="Motion detection"
            data={selected.motion}
            onChange={(d) => updateSection("motion", d)}
            showAlarm
            showTrigger
          />
          <div className="rm-col-sep" />
          <ColumnPanel
            title="Continuous"
            data={selected.continuous}
            onChange={(d) => updateSection("continuous", d)}
            showBitrate
          />
          <div className="rm-col-sep" />
          <ColumnPanel
            title="Manual"
            data={selected.manual}
            onChange={(d) => updateSection("manual", d)}
          />

          {/* Apply */}
          <div className="rm-apply-row">
            <Button label="Apply" variant="primary" onClick={() => {}} />
          </div>
        </div>
      )}
    </div>
  );
}