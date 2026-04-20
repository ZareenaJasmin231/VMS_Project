import { useState, useEffect } from "react";
import Button from "../../components/shared/Button";
import Toggle from "../../components/shared/Toggle";
import "./RecordingMethodPage.css";

const STREAM_API = "http://192.168.126.200:8000";

const SCHEDULES = ["Always", "Office Hours", "Weekends", "New schedule"];

const DEFAULT_MOTION = {
  enabled: false, profile: "",
  prebuffer: 5, postbuffer: 10, raiseAlarm: true,
  schedule: "Always", triggerPeriod: 10,
};
const DEFAULT_CONTINUOUS = {
  enabled: false, profile: "",
  prebuffer: 0, postbuffer: 0, schedule: "Always",
  avgBitrate: true, maxStorage: 352,
};
const DEFAULT_MANUAL = {
  enabled: false, profile: "",
  prebuffer: 0, postbuffer: 0,
};

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
          {data.availableProfiles && data.availableProfiles.length > 0
            ? data.availableProfiles.map((p) => (
                <option key={p.token} value={p.token}>
                  {p.label}: {p.resolution || "Unknown"} ({p.encoding || "H.264"})
                </option>
              ))
            : <option value="">No profiles found</option>
          }
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
                The average bitrate will be calculated based on the configured max storage and retention time.
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
  const [filter,      setFilter]      = useState("");
  const [selectedId,  setSelectedId]  = useState(null);
  const [devices,     setDevices]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [recSettings, setRecSettings] = useState({});

  useEffect(() => {
    fetchDevices();
  }, []);

  const fetchDevices = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${STREAM_API}/api/cameras/`);
      const data = await res.json();
      setDevices(data);

      // Initialize recSettings from backend data
      const initialSettings = {};
      data.forEach(cam => {
        const profiles = cam.stream_profiles || [];
        const activeRecProfile = cam.active_rec_profile || (profiles[0]?.token || "");

        initialSettings[cam.ome_stream] = {
          motion:     { ...DEFAULT_MOTION, profile: activeRecProfile, availableProfiles: profiles },
          continuous: { ...DEFAULT_CONTINUOUS, profile: activeRecProfile, availableProfiles: profiles },
          manual:     {
            ...DEFAULT_MANUAL,
            enabled: !!cam.recording_requested,
            profile: activeRecProfile,
            availableProfiles: profiles
          },
        };
      });
      setRecSettings(initialSettings);
    } catch (err) {
      console.error("Failed to fetch devices:", err);
    } finally {
      setLoading(false);
    }
  };

  const updateSection = async (section, data) => {
    if (!selectedId) return;

    const prevSettings = recSettings[selectedId];
    const newSettings = {
      ...recSettings,
      [selectedId]: {
        ...prevSettings,
        [section]: data,
      },
    };
    setRecSettings(newSettings);

    const cam = devices.find(d => d.ome_stream === selectedId);
    if (!cam) return;

    // ── 1. Handle Recording Start/Stop (Manual Toggle) ──
    if (section === "manual" && data.enabled !== prevSettings.manual.enabled) {
      try {
        const endpoint = data.enabled ? "start" : "stop";
        const selectedProfile = data.availableProfiles?.find(p => p.token === data.profile);
        const urlParam = selectedProfile ? `?rtsp_url=${encodeURIComponent(selectedProfile.rtsp_url)}` : "";

        await fetch(`${STREAM_API}/api/recordings/${endpoint}/${cam.ome_stream}${urlParam}`, {
          method: "POST"
        });
        console.log(`Backend recording ${endpoint} successful`);
        
        // Refresh devices to update status dots
        setTimeout(fetchDevices, 500);
      } catch (err) {
        console.error("Recording toggle failed:", err);
      }
    }

    // ── 2. Handle Profile Change ──
    if (data.profile !== prevSettings[section].profile) {
      const selectedProfile = data.availableProfiles?.find(p => p.token === data.profile);
      if (selectedProfile) {
        try {
          await fetch(`${STREAM_API}/api/streams/assign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ip: cam.ip,
              port: cam.port || 80,
              username: cam.username || "",
              live_rtsp: cam.rtsp_url,
              recording_rtsp: selectedProfile.rtsp_url,
              live_profile: cam.active_live_profile || "MAIN",
              recording_profile: selectedProfile.label || selectedProfile.name,
              manufacturer: cam.manufacturer,
              model: cam.model,
              mac: cam.mac,
              device_name: cam.device_name || cam.name
            })
          });
          console.log("Profile assignment updated on backend");
          setTimeout(fetchDevices, 500);
        } catch (err) {
          console.error("Profile change failed:", err);
        }
      }
    }
  };

  const handleApply = () => {
    alert("Settings synchronized with backend.");
  };

  const filtered = devices.filter((d) =>
    !filter ||
    [d.name, d.ip, d.manufacturer, d.model]
      .filter(Boolean)
      .some((c) => c.toLowerCase().includes(filter.toLowerCase()))
  );

  const selected    = selectedId ? recSettings[selectedId] : null;

  return (
    <div className="rm-page">
      {/* Header */}
      <div className="rm-page-header">
        <div>
          <h1 className="rm-page-title">Recording method</h1>
          <p className="rm-page-desc">
            Select which stream profile to use for recording. To edit stream profiles, go to Stream profiles.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {loading && <span style={{ color: "var(--teal)", fontSize: 12 }}>Syncing...</span>}
          <input className="rm-filter" placeholder="Type to filter"
            value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>

      {/* Camera table */}
      <div className="rm-table-wrap">
        <table className="rm-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>Name</th>
              <th>Motion</th>
              <th>Continuous</th>
              <th>Manual</th>
              <th>Recording Profile</th>
              <th>Status</th>
              <th>Server</th>
            </tr>
          </thead>
          <tbody>
            {loading && devices.length === 0 ? (
               <tr><td colSpan={8} style={{ textAlign: "center", padding: 40 }}>Loading devices...</td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)",
                  padding: "20px", fontSize: 12 }}>
                  No cameras enrolled. Go to Add Devices first.
                </td>
              </tr>
            ) : filtered.map((cam) => {
              const s = recSettings[cam.ome_stream];
              if (!s) return null;
              return (
                <tr key={cam.ome_stream}
                  className={cam.ome_stream === selectedId ? "selected" : ""}
                  onClick={() => setSelectedId(cam.ome_stream)}>
                  <td>
                    <div className="rm-thumb">
                      {cam.snapshot_url
                        ? <img src={cam.snapshot_url} alt={cam.name} />
                        : <div className="rm-thumb__placeholder" />}
                    </div>
                  </td>
                  <td>{cam.manufacturer} {cam.model} <br/><small style={{opacity:0.6}}>{cam.ip}</small></td>
                  <td className="rm-cell-center">{s.motion.enabled     ? "✓" : ""}</td>
                  <td className="rm-cell-center">{s.continuous.enabled  ? "✓" : ""}</td>
                  <td className="rm-cell-center">
                    <span style={{ color: s.manual.enabled ? "var(--teal)" : "inherit" }}>
                      {s.manual.enabled ? "● RECORDING" : "OFF"}
                    </span>
                  </td>
                  <td className="rm-cell-mono">
                    {cam.active_rec_profile || "Default"}
                  </td>
                  <td>
                    <span className={`status-dot ${cam.recording_requested ? "recording" : ""}`} />
                    {cam.recording_requested ? "Active" : "Idle"}
                  </td>
                  <td>MIRADOR</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rm-divider"><div className="rm-divider__handle" /></div>

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
             <p style={{ fontSize: 11, color: "var(--text-muted)", marginRight: "auto" }}>
               Changes are applied immediately.
             </p>
            <Button label="Refresh Sync" variant="outline" onClick={fetchDevices} />
            <Button label="Done" variant="primary" onClick={handleApply} />
          </div>
        </div>
      )}

      {!selected && filtered.length > 0 && (
        <div className="rm-detail rm-detail--empty">
          <span>Select a camera above to configure recording settings.</span>
        </div>
      )}
    </div>
  );
}