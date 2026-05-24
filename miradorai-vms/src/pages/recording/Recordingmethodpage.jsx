import { useState, useEffect } from "react";
import SearchBar from "../../components/shared/SearchBar";

import "./Recordingmethodpage.css";

const STREAM_API = `http://${window.location.hostname}:8000`;
const BACKEND = `http://${window.location.hostname}:8000`;

const DEFAULT_CONTINUOUS = {
  enabled: true,
  profile: "",
  prebuffer: 5,
  postbuffer: 5,
  avgBitrate: false,
  maxStorage: 50,
  schedule: "Always",
  availableProfiles: [],
  availableSchedules: [],
};

function loadGroups() {
  try {
    const saved = localStorage.getItem("miradorai_groups");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function getAuthHeaders() {
  const token = localStorage.getItem("miradorai_token");
  return token ? { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

function injectAuth(url, user, pass) {
  if (!url || !user) return url;
  try {
    const baseUrl = url.replace(/^rtsp:\/\/([^@]+@)?/, "rtsp://");
    const encodedUser = encodeURIComponent(user);
    const encodedPass = encodeURIComponent(pass || "");
    return baseUrl.replace("rtsp://", `rtsp://${encodedUser}:${encodedPass}@`);
  } catch { return url; }
}

export default function RecordingMethodPage() {
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [devices, setDevices] = useState([]);
  const [groups] = useState(loadGroups);
  const [loading, setLoading] = useState(false);
  const [recSettings, setRecSettings] = useState({});
  const [schedules, setSchedules] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [checkedGroups, setCheckedGroups] = useState([]);
  const [checkedCams, setCheckedCams] = useState([]);
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (message, isError = false) => {
    setToastMessage({ text: message, isError });
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    const init = async () => {
      const schs = await fetchSchedules();
      await fetchDevices(schs);
    };
    init();
  }, []);

  const fetchSchedules = async () => {
    try {
      const res = await fetch(`${BACKEND}/api/storage/schedules`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      const schs = Array.isArray(data) ? data : [];
      setSchedules(schs);
      return schs;
    } catch (err) {
      console.error(err);
      return [];
    }
  };

  const fetchDevices = async (currentSchedules = []) => {
    setLoading(true);
    try {
      let localDevices = [];
      try {
        const saved = localStorage.getItem("miradorai_devices");
        if (saved) localDevices = JSON.parse(saved);
      } catch (e) { console.error("[RM] LS Load error", e); }

      let backendData = [];
      try {
        const res = await fetch(`${STREAM_API}/api/cameras`, {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const json = await res.json();
          backendData = Array.isArray(json) ? json : (json.devices || []);
        }
      } catch (e) { console.warn("[RM] Backend fetch failed", e); }

      const combinedDevices = localDevices.map((localCam, idx) => {
        const backendCam = backendData.find(b => b.ip === localCam.ip);
        if (backendCam) {
          return {
            ...localCam,
            ...backendCam,
            group_id: localCam.group_id || backendCam.group_id || "default",
            ome_stream: backendCam.ome_stream || localCam.ome_stream || (localCam.ip ? `${localCam.ip.replace(/\./g, "_")}_cam${localCam.channel || 0}` : `cam_${localCam.id || idx}`),
          };
        }
        return {
          ...localCam,
          group_id: localCam.group_id || "default",
          ome_stream: localCam.ome_stream || (localCam.ip ? `${localCam.ip.replace(/\./g, "_")}_cam${localCam.channel || 0}` : `cam_${localCam.id || idx}`),
        };
      });

      const backendOnly = backendData.filter(b => !localDevices.some(l => l.ip === b.ip)).map((b, idx) => ({
        ...b,
        group_id: b.group_id || "default",
        ome_stream: b.ome_stream || (b.ip ? `${b.ip.replace(/\./g, "_")}_cam${b.channel || 0}` : `cam_${b.id || idx}`),
      }));

      const finalData = [...combinedDevices, ...backendOnly];
      setDevices(finalData);

      const initialSettings = {};
      finalData.forEach((cam) => {
        const profiles = cam.stream_profiles || [];
        let pVal = cam.active_rec_profile || cam.recording_profile || "MAIN_STREAM";
        if (profiles.length > 0 && pVal !== "MAIN_STREAM" && pVal !== "SUB_STREAM") {
          const sortedMain = [...profiles].sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)) || (b.bitrate || 0) - (a.bitrate || 0));
          const sortedSub = [...profiles].sort((a, b) => ((a.width || 0) * (a.height || 0)) - ((b.width || 0) * (b.height || 0)) || (a.bitrate || 0) - (b.bitrate || 0));
          if (pVal === sortedMain[0]?.token) pVal = "MAIN_STREAM";
          else if (pVal === sortedSub[0]?.token) pVal = "SUB_STREAM";
        }

        initialSettings[cam.ome_stream] = {
          continuous: {
            ...DEFAULT_CONTINUOUS,
            profile: pVal,
            availableProfiles: [
              { token: "MAIN_STREAM", label: "Main Stream", isGeneric: true },
              { token: "SUB_STREAM", label: "Sub Stream", isGeneric: true }
            ],
            schedule: cam.assigned_schedule_id || "Always",
            availableSchedules: [
              { id: "Always", name: "Always" },
              ...(Array.isArray(currentSchedules) ? currentSchedules.map(s => ({ id: s.id, name: s.name })) : [])
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
    g.cameras.some(c => (c.name || "").toLowerCase().includes(filter.toLowerCase()) || (c.ip || "").includes(filter))
  );

  const updateSection = (section, data) => {
    const targets = checkedCams.length > 0 ? checkedCams : (selectedId ? [selectedId] : []);
    if (targets.length === 0) return;

    setRecSettings(prev => {
      const next = { ...prev };
      targets.forEach(tid => {
        if (next[tid]) {
          next[tid] = { ...next[tid], [section]: { ...next[tid][section], ...data } };
        }
      });
      return next;
    });
  };

  const updateProfile = (val) => {
    const targets = checkedCams.length > 0 ? checkedCams : (selectedId ? [selectedId] : []);
    if (targets.length === 0) return;

    // Check eligibility: camera must have at least 2 profiles to "switch"
    const ineligible = targets.filter(tid => {
      const cam = devices.find(d => d.ome_stream === tid);
      return !cam || !cam.stream_profiles || cam.stream_profiles.length < 2;
    });

    if (ineligible.length > 0) {
      if (targets.length === 1) {
        showToast("This camera only has one stream profile and is not eligible for profile switching.", true);
      } else {
        showToast(`${ineligible.length} of the selected cameras only have one stream profile and are not eligible for profile switching.`, true);
      }
      return;
    }

    updateSection("continuous", { profile: val });
  };

  const updateSchedule = (val) => updateSection("continuous", { schedule: val });

  const handleApply = async () => {
    const targets = checkedCams.length > 0 ? checkedCams : (selectedId ? [selectedId] : []);
    if (targets.length === 0) return;

    setLoading(true);
    try {
      const templateId = (selectedId && recSettings[selectedId]) ? selectedId : checkedCams.find(id => recSettings[id]);
      const template = recSettings[templateId];

      if (!template) {
        showToast("No settings found for the selected camera(s). Please try refreshing.", true);
        setLoading(false);
        return;
      }

      const applyTasks = targets.map(async (tid) => {
        const cam = devices.find(d => d.ome_stream === tid);
        if (!cam) return;

        const data = template.continuous;
        let targetProfile = null;

        if (data.profile === "MAIN_STREAM") {
          targetProfile = [...(cam.stream_profiles || [])].sort((a, b) => {
            const resA = (a.width || 0) * (a.height || 0);
            const resB = (b.width || 0) * (b.height || 0);
            if (resB !== resA) return resB - resA;
            return (b.bitrate || 0) - (a.bitrate || 0);
          })[0];
        } else if (data.profile === "SUB_STREAM") {
          targetProfile = [...(cam.stream_profiles || [])].sort((a, b) => {
            const resA = (a.width || 0) * (a.height || 0);
            const resB = (b.width || 0) * (b.height || 0);
            if (resA !== resB) return resA - resB;
            return (a.bitrate || 0) - (b.bitrate || 0);
          })[0];
        } else {
          const templateProfile = template.continuous.availableProfiles?.find(p => p.token === data.profile);
          targetProfile = cam.stream_profiles?.find(p => p.label === templateProfile?.label) || cam.stream_profiles?.[0];
        }

        let authedRtsp = null;
        let profileToken = "";

        if (targetProfile) {
          authedRtsp = injectAuth(targetProfile.rtsp_url, cam.username, cam.password);
          profileToken = targetProfile.token;
        } else {
          authedRtsp = injectAuth(cam.rtsp_url, cam.username, cam.password);
          profileToken = data.profile || "SUB_STREAM";
        }

        if (authedRtsp) {
          await fetch(`${STREAM_API}/api/streams/assign`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({
              ip: cam.ip,
              port: cam.port || 80,
              username: cam.username || "",
              live_rtsp: cam.rtsp_url,
              recording_rtsp: authedRtsp,
              live_profile: cam.active_live_profile || "MAIN",
              recording_profile: profileToken,
              manufacturer: cam.manufacturer,
              model: cam.model,
              mac: cam.mac,
              device_name: cam.device_name || cam.name || "",
              ome_stream: cam.ome_stream,
            }),
          });
        }

        await fetch(`${BACKEND}/api/recordings/assign-schedule`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            camera_id: tid,
            schedule_id: data.schedule,
          }),
        });
      });

      await Promise.all(applyTasks);

      setRecSettings(prev => {
        const next = { ...prev };
        targets.forEach(tid => {
          if (next[tid]) {
            next[tid] = {
              ...next[tid],
              continuous: {
                ...next[tid].continuous,
                profile: template.continuous.profile,
                schedule: template.continuous.schedule
              }
            };
          }
        });
        return next;
      });

      showToast(`Successfully applied settings to ${targets.length} camera(s)!`);
      await fetchDevices(schedules);
      setCheckedCams([]);
      setCheckedGroups([]);
    } catch (err) {
      console.error(err);
      showToast("Failed to apply settings.", true);
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

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header__left">
          <h1 className="page-title">Recording <span>Method</span></h1>
          <p className="page-desc">Manage recording methods by groups. Configure continuous or scheduled recording.</p>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Filter groups or cameras..." />
      </div>

      <div className="app-content">
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
                    <td colSpan={5} className="m-table__empty" style={{ textAlign: "center", padding: "40px", color: "rgba(255,255,255,0.3)" }}>
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
                        <button className="m-btn m-btn--primary" onClick={() => setSelectedGroup(group)}>
                          View All Cameras
                        </button>
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
                      <div className="rm-item-name">
                        {cam.name || cam.ip}
                        <span className="rm-stream-badge">
                          {(recSettings[cam.ome_stream]?.continuous?.profile || cam.active_rec_profile) === "MAIN_STREAM" ? "MAIN" : "SUB"}
                        </span>
                      </div>
                      <div className="rm-item-mode">{(!cam.assigned_schedule_id || cam.assigned_schedule_id === "Always") ? "Continuous" : "Scheduled"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {(selectedId || checkedCams.length > 0) && (
          <div className="rm-detail-horizontal">
            <div className="rm-h-group">
              <div className="rm-h-field">
                <label className="rm-h-label">Profiles</label>
                <select
                  className="rm-h-select"
                  value={
                    selectedId 
                      ? recSettings[selectedId]?.continuous?.profile 
                      : recSettings[checkedCams[0]]?.continuous?.profile || "SUB_STREAM"
                  }
                  onChange={e => updateProfile(e.target.value)}
                >
                  <option value="MAIN_STREAM">Main Stream</option>
                  <option value="SUB_STREAM">Sub Stream</option>
                </select>
              </div>

              <div className="rm-h-sep">|</div>

              <div className="rm-h-field">
                <label className="rm-h-label">Recording mode</label>
                <select
                  className="rm-h-select"
                  value={
                    selectedId
                      ? recSettings[selectedId]?.continuous?.schedule || "Always"
                      : recSettings[checkedCams[0]]?.continuous?.schedule || "Always"
                  }
                  onChange={e => updateSchedule(e.target.value)}
                >
                  <option value="Always">Continuous</option>
                  {schedules.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                  <option value="Never">Never</option>
                </select>
              </div>

              <div className="rm-h-sep">|</div>

              <button
                className="m-btn m-btn--primary"
                onClick={handleApply}
                disabled={loading}
                style={{ minWidth: 120 }}
              >
                {loading ? "Applying..." : (checkedCams.length > 1 ? `Apply to ${checkedCams.length} Cameras` : "Apply")}
              </button>
            </div>
          </div>
        )}

        {!selectedGroup && !selectedId && !checkedCams.length && filteredGroups.length > 0 && (
          <div className="rm-detail rm-detail--empty">
            <span>Select a camera or group above to configure recording settings.</span>
          </div>
        )}

        {toastMessage && (
          <div className={`rm-toast ${toastMessage.isError ? "rm-toast--error" : ""}`}>
            {toastMessage.text}
          </div>
        )}
      </div>
    </div>
  );
}