import { useState, useEffect } from "react";
import Button from "../../components/shared/Button";
import "./Recordingmethodpage.css";

const STREAM_API = `http://${window.location.hostname}:8000`;
const BACKEND    = `http://${window.location.hostname}:8000`;

const DEFAULT_CONTINUOUS = {
  enabled:           true,
  profile:           "",
  prebuffer:         5,
  postbuffer:        5,
  avgBitrate:        false,
  maxStorage:        50,
  schedule:          "Always",
  availableProfiles: [],
  availableSchedules: [],
};

function loadGroups() {
  try {
    const saved = localStorage.getItem("miradorai_groups");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function injectAuth(url, user, pass) {
  if (!url || !user) return url;
  try {
    const u = new URL(url);
    u.username = user;
    u.password = pass || "";
    return u.toString();
  } catch { return url; }
}

export default function RecordingMethodPage() {
  const [filter,         setFilter]      = useState("");
  const [selectedId,     setSelectedId]  = useState(null);
  const [devices,        setDevices]     = useState([]);
  const [groups]         = useState(loadGroups);
  const [loading,        setLoading]     = useState(false);
  const [recSettings,    setRecSettings] = useState({});
  const [schedules,      setSchedules]   = useState([]);
  const [selectedGroup,  setSelectedGroup] = useState(null);
  const [checkedGroups,  setCheckedGroups] = useState([]);
  const [checkedCams,    setCheckedCams]   = useState([]);

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
      setSchedules(data);
      return data;
    } catch (err) {
      console.error(err);
      return [];
    }
  };

  const fetchDevices = async (currentSchedules = []) => {
    setLoading(true);
    console.log("[RM] Fetching devices...");
    try {
      // 1. Load from localStorage
      let localDevices = [];
      try {
        const saved = localStorage.getItem("miradorai_devices");
        console.log("[RM] LocalStorage 'miradorai_devices':", saved ? "Found" : "Empty");
        if (saved) localDevices = JSON.parse(saved);
      } catch (e) { console.error("[RM] LS Load error", e); }

      // 2. Fetch from Backend
      let backendData = [];
      try {
        const res = await fetch(`${STREAM_API}/api/cameras`);
        if (res.ok) {
          backendData = await res.json();
          console.log("[RM] Backend cameras found:", backendData.length);
        }
      } catch (e) { console.warn("[RM] Backend fetch failed (using local fallback)", e); }

      // 3. Merge
      // If backend has data, use it as primary shell but keep local group info
      // If backend is empty, use local as primary shell
      const source = backendData.length > 0 ? backendData : localDevices;
      console.log("[RM] Using source:", backendData.length > 0 ? "Backend" : "Local");

      const data = source.map(s => {
        const matchingLocal = localDevices.find(d => d.ip === s.ip);
        const matchingBackend = backendData.find(d => d.ip === s.ip);
        
        return { 
          ...matchingLocal, 
          ...s, 
          ...matchingBackend,
          ome_stream: s.ome_stream || matchingLocal?.ome_stream || s.ip?.replace(/\./g, "_") || `cam_${s.id}`,
          group_id: matchingLocal?.group_id || s.group_id || "default" 
        };
      });

      console.log("[RM] Total merged devices:", data.length);
      setDevices(data);

      const initialSettings = {};
      data.forEach((cam) => {
        const profiles         = cam.stream_profiles || [];
        const activeRecProfile = cam.active_rec_profile || cam.recording_profile || profiles[0]?.token || "";
        
        initialSettings[cam.ome_stream] = {
          continuous: {
            ...DEFAULT_CONTINUOUS,
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
      console.error("[RM] Global fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  // ── Aggregation ──
  const groupedData = Object.values(
    devices.reduce((acc, cam) => {
      const gid = cam.group_id || "default";
      if (!acc[gid]) {
        acc[gid] = {
          group_id: gid,
          name: gid === "default" ? "Default" : (groups.find(g => g.id === gid)?.name || gid),
          cameras: [],
        };
      }
      acc[gid].cameras.push(cam);
      return acc;
    }, {})
  );

  const filteredGroups = groupedData.filter(g => 
    !filter || g.name.toLowerCase().includes(filter.toLowerCase()) ||
    g.cameras.some(c => (c.name||"").toLowerCase().includes(filter.toLowerCase()) || (c.ip||"").includes(filter))
  );

  const updateSection = (section, data) => {
    if (!selectedId) return;
    setRecSettings(prev => ({
      ...prev,
      [selectedId]: { ...prev[selectedId], [section]: data }
    }));
  };

  const handleApply = async () => {
    const targets = checkedCams.length > 0 ? checkedCams : (selectedId ? [selectedId] : []);
    if (targets.length === 0) return;

    setLoading(true);
    try {
      const template = selectedId ? recSettings[selectedId] : (checkedCams[0] ? recSettings[checkedCams[0]] : null);
      if (!template) throw new Error("No settings template found");

      for (const tid of targets) {
        const cam = devices.find(d => d.ome_stream === tid);
        if (!cam) continue;

        const data = template.continuous;
        const templateProfile = template.continuous.availableProfiles?.find(p => p.token === data.profile);
        const targetProfile = cam.stream_profiles?.find(p => p.label === templateProfile?.label) || cam.stream_profiles?.[0];

        if (targetProfile) {
          const authedRtsp = injectAuth(targetProfile.rtsp_url, cam.username, cam.password);
          await fetch(`${STREAM_API}/api/streams/assign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ip: cam.ip,
              port: cam.port || 80,
              username: cam.username || "",
              live_rtsp: cam.rtsp_url,
              recording_rtsp: authedRtsp,
              live_profile: cam.active_live_profile || "MAIN",
              recording_profile: targetProfile.token,
              manufacturer: cam.manufacturer,
              model: cam.model,
              mac: cam.mac,
              device_name: cam.device_name || cam.name || "",
            }),
          });
        }

        await fetch(`${BACKEND}/api/recordings/assign-schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            camera_id: tid,
            schedule_id: data.schedule,
          }),
        });
      }

      const scheduleName = schedules.find(s => s.id === template.continuous.schedule)?.name || template.continuous.schedule;
      alert(`Successfully applied settings to ${targets.length} camera(s)!\n\nSchedule: ${scheduleName}`);
      await fetchDevices(schedules);
      setCheckedCams([]);
      setCheckedGroups([]);
    } catch (err) {
      console.error(err);
      alert("Failed to apply settings.");
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (gid) => {
    const isChecked = checkedGroups.includes(gid);
    const group = groupedData.find(g => g.group_id === gid);
    const camIds = group?.cameras.map(c => c.ome_stream) || [];

    if (isChecked) {
      setCheckedGroups(prev => prev.filter(id => id !== gid));
      setCheckedCams(prev => prev.filter(id => !camIds.includes(id)));
    } else {
      setCheckedGroups(prev => [...prev, gid]);
      setCheckedCams(prev => [...new Set([...prev, ...camIds])]);
    }
  };

  const toggleCam = (cid) => {
    setCheckedCams(prev => prev.includes(cid) ? prev.filter(id => id !== cid) : [...prev, cid]);
  };

  const selected = selectedId ? recSettings[selectedId] : null;

  return (
    <div className="rm-page">
      <div className="rm-page-header">
        <div>
          <h1 className="rm-page-title">Recording method</h1>
          <p className="rm-page-desc">Manage recording methods by groups. Configure continuous or scheduled recording.</p>
        </div>
        <input className="rm-filter" placeholder="Type to filter" value={filter} onChange={e => setFilter(e.target.value)} />
      </div>

      <div className={`rm-content-layout ${selectedGroup ? "has-panel" : ""}`}>
        <div className="rm-table-wrap card">
          <table className="rm-table m-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input 
                    type="checkbox" 
                    checked={filteredGroups.length > 0 && filteredGroups.every(g => checkedGroups.includes(g.group_id))} 
                    onChange={() => {
                      const allGids = filteredGroups.map(g => g.group_id);
                      const allChecked = filteredGroups.every(g => checkedGroups.includes(g.group_id));
                      if (allChecked) {
                        setCheckedGroups([]);
                        setCheckedCams([]);
                      } else {
                        setCheckedGroups(allGids);
                        const allCids = filteredGroups.flatMap(g => g.cameras.map(c => c.ome_stream));
                        setCheckedCams(allCids);
                      }
                    }} 
                  />
                </th>
                <th>Group Name</th>
                <th style={{ width: 120 }}>Continuous</th>
                <th style={{ width: 120 }}>Scheduled</th>
                <th style={{ width: 150 }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="rm-table__empty" style={{ textAlign: "center", padding: "40px", color: "rgba(255,255,255,0.3)" }}>
                    {devices.length === 0 
                      ? "No cameras enrolled. Go to Add Devices first." 
                      : "No groups match your filter."}
                  </td>
                </tr>
              ) : filteredGroups.map(group => {
                const continuousCount = group.cameras.filter(c => c.assigned_schedule_id === "Always" || !c.assigned_schedule_id).length;
                const scheduledCount = group.cameras.length - continuousCount;
                return (
                  <tr key={group.group_id} className={checkedGroups.includes(group.group_id) ? "selected" : ""}>
                    <td><input type="checkbox" checked={checkedGroups.includes(group.group_id)} onChange={() => toggleGroup(group.group_id)} /></td>
                    <td className="m-table__primary">{group.name}</td>
                    <td><span className="count-badge continuous">{continuousCount}</span></td>
                    <td><span className="count-badge scheduled">{scheduledCount}</span></td>
                    <td>
                      <button className="ec-btn ec-btn--primary" onClick={() => setSelectedGroup(group)}>View All Camera</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selectedGroup && (
          <div className="rm-side-panel card">
            <div className="rm-side-header">
              <h3>{selectedGroup.name}</h3>
              <button className="close-btn" onClick={() => setSelectedGroup(null)}>✕</button>
            </div>
            <div className="rm-side-list">
              {selectedGroup.cameras.map(cam => (
                <div 
                  key={cam.ome_stream} 
                  className={`rm-side-item ${selectedId === cam.ome_stream ? "active" : ""} ${checkedCams.includes(cam.ome_stream) ? "checked" : ""}`} 
                  onClick={() => setSelectedId(cam.ome_stream)}
                >
                  <input 
                    type="checkbox" 
                    checked={checkedCams.includes(cam.ome_stream)} 
                    onChange={(e) => { e.stopPropagation(); toggleCam(cam.ome_stream); }} 
                  />
                  <div className="rm-item-info">
                    <div className="rm-item-name">{cam.name || cam.ip}</div>
                    <div className="rm-item-mode">{(!cam.assigned_schedule_id || cam.assigned_schedule_id === "Always") ? "Continuous" : "Scheduled"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {(selected || checkedCams.length > 0) && (
        <div className="rm-detail-horizontal">
          <div className="rm-h-group">
            <div className="rm-h-field">
              <label className="rm-h-label">Profiles</label>
              <select 
                className="rm-h-select" 
                value={selected?.continuous.profile || recSettings[checkedCams[0]]?.continuous.profile || ""} 
                onChange={e => updateSection("continuous", { ...selected.continuous, profile: e.target.value })}
              >
                {(selected || recSettings[checkedCams[0]])?.continuous.availableProfiles?.map(p => (
                  <option key={p.token} value={p.token}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="rm-h-sep">|</div>

            <div className="rm-h-field">
              <label className="rm-h-label">Recording mode</label>
              <select 
                className="rm-h-select" 
                value={selected?.continuous.schedule || recSettings[checkedCams[0]]?.continuous.schedule || "Always"} 
                onChange={e => updateSection("continuous", { ...selected.continuous, schedule: e.target.value })}
              >
                {(selected || recSettings[checkedCams[0]])?.continuous.availableSchedules?.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="rm-h-sep">|</div>

            <Button 
              label={loading ? "Applying..." : (checkedCams.length > 1 ? `Apply to ${checkedCams.length} Cameras` : "Apply")} 
              variant="primary" 
              onClick={handleApply} 
              disabled={loading}
              style={{ minWidth: 120 }}
            />
          </div>
        </div>
      )}

      {!selected && !checkedCams.length && filteredGroups.length > 0 && (
        <div className="rm-detail rm-detail--empty">
          <span>Select a camera or group above to configure recording settings.</span>
        </div>
      )}
    </div>
  );
}