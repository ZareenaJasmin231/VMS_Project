import { useState, useEffect, useRef } from "react";
import Button from "../../components/shared/Button";
import Toggle from "../../components/shared/Toggle";
import "./RecordingMethodPage.css";

const API_HOST = window.location.hostname;
const STREAM_API = `http://${API_HOST}:8000`;
const BACKEND = `http://${API_HOST}:8000`;

const DEFAULT_CONTINUOUS = {
  enabled: true,
  profile: "",
  prebuffer: 0,
  postbuffer: 0,
  schedule: "Always",
  avgBitrate: true,
  maxStorage: 352,
};

// ── Inject credentials into RTSP URL if missing ───────────────
// ONVIF profile URLs often come back without auth — this ensures
// ffmpeg never hits a 401 when switching to a sub-stream profile.
function injectAuth(rtsp, username, password) {
  try {
    const url = new URL(rtsp);
    if (!url.username) {
      url.username = encodeURIComponent(username || "");
      url.password = encodeURIComponent(password || "");
    }
    return url.toString();
  } catch {
    return rtsp;
  }
}

// ── Spinner ───────────────────────────────────────────────────
function Spinner({ value, onChange, min = 0, max = 9999, disabled }) {
  return (
    <div className={`rm-spinner${disabled ? " rm-spinner--disabled" : ""}`}>
      <input
        type="number"
        className="rm-spinner__input"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) =>
          onChange(Math.max(min, Math.min(max, Number(e.target.value))))
        }
      />
      <div className="rm-spinner__btns">
        <button
          className="rm-spinner__btn"
          disabled={disabled}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          ▲
        </button>
        <button
          className="rm-spinner__btn"
          disabled={disabled}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          ▼
        </button>
      </div>
    </div>
  );
}

// ── Schedule row ──────────────────────────────────────────────
function ScheduleRow({ value, onChange, disabled, schedules }) {
  return (
    <div className="rm-schedule-row">
      <select
        className="rm-select rm-select--schedule"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {schedules.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <Button label="Edit..." variant="outline" disabled={disabled} onClick={() => {}} />
      <Button label="New..."  variant="outline" disabled={disabled} onClick={() => {}} />
    </div>
  );
}

// ── Continuous Column Panel ───────────────────────────────────
function ContinuousPanel({ data, onChange }) {
  const set = (key, val) => onChange({ ...data, [key]: val });

  return (
    <div className="rm-col">
      {/* Header — no toggle, always ON */}
      <div className="rm-col__header">
        <span className="rm-col__title">Continuous</span>
        <span
          style={{
            fontSize: 11,
            color: "var(--teal)",
            fontWeight: 600,
            letterSpacing: "0.05em",
          }}
        >
          ● ALWAYS ON
        </span>
      </div>

      {/* Video settings */}
      <div className="rm-col__section-label">Video settings</div>

      <div className="rm-field">
        <label className="rm-label">Profile:</label>
        <select
          className="rm-select"
          value={data.profile}
          onChange={(e) => set("profile", e.target.value)}
        >
          {data.availableProfiles && data.availableProfiles.length > 0 ? (
            data.availableProfiles.map((p) => (
              <option key={p.token} value={p.token}>
                {p.label}: {p.resolution || "Unknown"} ({p.encoding || "H.264"})
              </option>
            ))
          ) : (
            <option value="">No profiles found</option>
          )}
        </select>
      </div>

      <div className="rm-field rm-field--inline">
        <label className="rm-label">Prebuffer:</label>
        <Spinner value={data.prebuffer} onChange={(v) => set("prebuffer", v)} />
        <span className="rm-unit">seconds</span>
      </div>

      <div className="rm-field rm-field--inline">
        <label className="rm-label">Postbuffer:</label>
        <Spinner value={data.postbuffer} onChange={(v) => set("postbuffer", v)} />
        <span className="rm-unit">seconds</span>
      </div>

      {/* Schedule */}
      <div className="rm-col__section-label">Schedule</div>
      <ScheduleRow
        value={data.schedule}
        onChange={(v) => set("schedule", v)}
        schedules={data.availableSchedules || ["Always"]}
      />

      {/* Advanced */}
      <div className="rm-col__section-label">Advanced</div>

      <div className="rm-field rm-field--inline rm-field--toggle">
        <label className="rm-label">Average bitrate</label>
        <Toggle
          value={data.avgBitrate}
          onChange={(v) => set("avgBitrate", v)}
        />
      </div>

      {data.avgBitrate && (
        <>
          <div className="rm-field rm-field--inline">
            <label className="rm-label">Max storage:</label>
            <Spinner
              value={data.maxStorage}
              onChange={(v) => set("maxStorage", v)}
              min={1}
              max={9999}
            />
            <span className="rm-unit">GB</span>
          </div>
          <p className="rm-bitrate-hint">
            The average bitrate will be calculated based on the configured max
            storage and retention time.
          </p>
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
  const [loading,     setLoading]     = useState(false);
  const [recSettings, setRecSettings] = useState({});
  const [schedules,   setSchedules]   = useState([]);

  useEffect(() => {
    const init = async () => {
      const schs = await fetchSchedules();
      await fetchDevices(schs);
    };
    init();
  }, []);

  const fetchSchedules = async () => {
    try {
      const res = await fetch(`${BACKEND}/api/storage/schedules`);
      const data = await res.json();
      // Store full schedule objects for ID/Name lookup
      setSchedules(data);
      return data;
    } catch (err) {
      console.error(err);
      return [];
    }
  };

  const fetchDevices = async (currentSchedules = []) => {
    setLoading(true);
    try {
      const res  = await fetch(`${STREAM_API}/api/cameras`);
      const data = await res.json();
      setDevices(data);

      const initialSettings = {};
      data.forEach((cam) => {
        const profiles         = cam.stream_profiles || [];
        const activeRecProfile =
          cam.active_rec_profile ||
          cam.recording_profile ||   
          profiles[0]?.token ||
          "";
        
        initialSettings[cam.ome_stream] = {
          continuous: {
            ...DEFAULT_CONTINUOUS,
            enabled:           true,
            profile:           activeRecProfile,
            availableProfiles: profiles,
            schedule:          cam.assigned_schedule_id || "Always",
            availableSchedules: [
              { id: "Always", name: "Always" },
              ...currentSchedules.map(s => ({ id: s.id, name: s.name }))
            ]
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
    const newSettings  = {
      ...recSettings,
      [selectedId]: { ...prevSettings, [section]: data },
    };
    setRecSettings(newSettings);

    const cam = devices.find((d) => d.ome_stream === selectedId);
    if (!cam) return;

    // ── Profile Change → call /api/streams/assign ──────────────
    // The backend will stop + restart the recorder with the new RTSP URL.
    // We inject credentials here because ONVIF profile URLs often arrive
    // without auth, which causes ffmpeg to return 401 Unauthorized.
    if (data.profile !== prevSettings[section].profile) {
      const selectedProfile = data.availableProfiles?.find(
        (p) => p.token === data.profile
      );

      if (selectedProfile) {
        // ✅ Inject cam credentials into the sub-stream RTSP URL
        const authedRtsp = injectAuth(
          selectedProfile.rtsp_url,
          cam.username,
          cam.password
        );

        try {
          const res = await fetch(`${STREAM_API}/api/streams/assign`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ip:                cam.ip,
              port:              cam.port || 80,
              username:          cam.username || "",
              live_rtsp:         cam.rtsp_url,
              recording_rtsp:    authedRtsp,          // ✅ credentials injected
              live_profile:      cam.active_live_profile || "MAIN",
recording_profile: selectedProfile.token,
              manufacturer:      cam.manufacturer,
              model:             cam.model,
              mac:               cam.mac,
              device_name:       cam.device_name || cam.name || "",
            }),
          });

          if (res.ok) {
            console.log(`[PROFILE] ✅ Profile updated to ${selectedProfile.label} → ${authedRtsp}`);
            setTimeout(fetchDevices, 600);
          } else {
            console.error("[PROFILE] ❌ assign failed:", await res.text());
            setRecSettings((prev) => ({ ...prev, [selectedId]: prevSettings }));
          }
        } catch (err) {
          console.error("[PROFILE] ❌ Network error:", err);
          setRecSettings((prev) => ({ ...prev, [selectedId]: prevSettings }));
        }
      }
    }

    // ── Schedule Change → call /api/recordings/assign-schedule ──
    if (data.schedule !== prevSettings[section].schedule) {
      try {
        await fetch(`${BACKEND}/api/recordings/assign-schedule`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            camera_id:   selectedId,
            schedule_id: data.schedule,
          }),
        });
        console.log(`[SCHEDULE] ✅ Schedule updated to ${data.schedule}`);
      } catch (err) { console.error("[SCHEDULE] ❌ Network error:", err); }
    }
  };

  const filtered = devices.filter(
    (d) =>
      !filter ||
      [d.name, d.ip, d.manufacturer, d.model]
        .filter(Boolean)
        .some((c) => c.toLowerCase().includes(filter.toLowerCase()))
  );

  const selected = selectedId ? recSettings[selectedId] : null;

  return (
    <div className="rm-page">
      {/* Header */}
      <div className="rm-page-header">
        <div>
          <h1 className="rm-page-title">Recording method</h1>
          <p className="rm-page-desc">
            Select which stream profile to use for recording. To edit stream
            profiles, go to Stream profiles.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {loading && (
            <span style={{ color: "var(--teal)", fontSize: 12 }}>Syncing...</span>
          )}
          <input
            className="rm-filter"
            placeholder="Type to filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {/* Camera table */}
      <div className="rm-table-wrap">
        <table className="rm-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>Name</th>
              <th>Continuous</th>
              <th>Recording Profile</th>
              <th>Status</th>
              <th>Server</th>
            </tr>
          </thead>
          <tbody>
            {loading && devices.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 40 }}>
                  Loading devices...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: "center",
                    color:     "var(--text-muted)",
                    padding:   "20px",
                    fontSize:  12,
                  }}
                >
                  No cameras enrolled. Go to Add Devices first.
                </td>
              </tr>
            ) : (
              filtered.map((cam) => {
                const s = recSettings[cam.ome_stream];
                if (!s) return null;
                return (
                  <tr
                    key={cam.ome_stream}
                    className={cam.ome_stream === selectedId ? "selected" : ""}
                    onClick={() => setSelectedId(cam.ome_stream)}
                  >
                    <td>
                      <div className="rm-thumb">
                        {cam.snapshot_url ? (
                          <img src={cam.snapshot_url} alt={cam.name} />
                        ) : (
                          <div className="rm-thumb__placeholder" />
                        )}
                      </div>
                    </td>
                    <td>
                      {cam.manufacturer} {cam.model}
                      <br />
                      <small style={{ opacity: 0.6 }}>{cam.ip}</small>
                    </td>
                    <td className="rm-cell-center">
                      <span style={{ color: "var(--teal)", fontWeight: 600 }}>✓</span>
                    </td>
<td className="rm-cell-mono">
  {
    cam.stream_profiles?.find(p => p.token === cam.active_rec_profile)?.label
    || cam.active_rec_profile
    || "Default"
  }
</td>
                    <td>
                      <span
                        className={`status-dot ${cam.recording_requested ? "recording" : ""}`}
                      />
                      {cam.recording_requested ? "Active" : "Idle"}
                    </td>
                    <td>MIRADOR</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="rm-divider">
        <div className="rm-divider__handle" />
      </div>

      {selected && (
        <div className="rm-detail">
          <ContinuousPanel
            data={selected.continuous}
            onChange={(d) => updateSection("continuous", d)}
          />
          <div className="rm-apply-row">
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginRight: "auto" }}>
              Profile changes apply immediately. Recording runs continuously.
            </p>
            <Button label="Refresh" variant="outline" onClick={fetchDevices} />
            <Button label="Done"    variant="primary"  onClick={() => setSelectedId(null)} />
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