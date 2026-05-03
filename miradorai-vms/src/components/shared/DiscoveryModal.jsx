import { useState, useEffect, useRef } from "react";
import "./DiscoveryModal.css";

const STREAM_API = "http://192.168.126.200:8000";


export default function DiscoveryModal({
  isOpen,
  onClose,
  onAddDevices,
  groups,
  selectedGroupId,
  setSelectedGroupId
}) {
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [selectedDevices, setSelectedDevices] = useState(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Initializing network scan...");
  const [error, setError] = useState(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [deviceCreds, setDeviceCreds] = useState({});
  const [showCredModal, setShowCredModal] = useState(false);
  const [showPasswords, setShowPasswords] = useState({});
  const [isRegistering, setIsRegistering] = useState(false);
  const [regStatus, setRegStatus] = useState({});
  const [openDropdownId, setOpenDropdownId] = useState(null);

  const progressTimerRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const startProgressTicker = () => {
    let current = 0;
    const tick = () => {
      current = current < 60
        ? current + 12
        : current < 85
        ? current + 2
        : current;
      setProgress(current);
      if (current < 85) {
        progressTimerRef.current = setTimeout(tick, 300);
      }
    };
    progressTimerRef.current = setTimeout(tick, 300);
  };

  const stopProgressTicker = () => {
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  };

  const startDiscovery = async () => {
    const token = localStorage.getItem("miradorai_token");
    setIsScanning(true);
    setError(null);
    setDiscoveredDevices([]);
    setSelectedDevices(new Set());
    setRegStatus({});
    setDeviceCreds({});
    setProgress(0);
    setHasScanned(false);
    setStatusMessage("Scanning network for ONVIF cameras…");

    startProgressTicker();

    let devices = [];
    try {
      const response = await fetch(`${STREAM_API}/api/discover-devices`, {
        headers: {
          Authorization: "Bearer " + token
        }
      });
      if (response.ok) {
        const data = await response.json();
        devices = data.devices || [];
        console.log("[Discovery] Backend returned:", devices);
      } else {
        throw new Error(`Server returned HTTP ${response.status}`);
      }
    } catch (fetchErr) {
      console.error("[Discovery] Backend API failed:", fetchErr.message);
      setError(fetchErr.message);
    }

    stopProgressTicker();
    setProgress(100);
    setDiscoveredDevices(devices);
    setStatusMessage(
      devices.length > 0
        ? `Found ${devices.length} camera${devices.length !== 1 ? "s" : ""}`
        : "No cameras found"
    );
    setHasScanned(true);
    setIsScanning(false);
  };

  useEffect(() => () => stopProgressTicker(), []);

  const toggleOne = (id) => {
    const s = new Set(selectedDevices);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedDevices(s);
  };

  const toggleAll = () => {
    setSelectedDevices(
      selectedDevices.size === discoveredDevices.length
        ? new Set()
        : new Set(discoveredDevices.map((d) => d.id))
    );
  };

  const handleAddClick = () => {
    const init = {};
    discoveredDevices
      .filter((d) => selectedDevices.has(d.id))
      .forEach((d) => {
        init[d.id] = deviceCreds[d.id] || { username: "", password: "", cameraName: "", groupId: selectedGroupId || "default" };
      });
    setDeviceCreds(init);
    setShowCredModal(true);
  };

  const updateCred = (deviceId, field, value) => {
    setDeviceCreds((prev) => ({
      ...prev,
      [deviceId]: { ...prev[deviceId], [field]: value },
    }));
  };

  const togglePasswordVisibility = (deviceId) => {
    setShowPasswords((prev) => ({
      ...prev,
      [deviceId]: !prev[deviceId],
    }));
  };

  const handleCredKeyDown = (e, deviceId, isLast) => {
    if (e.key === "Enter" && isLast) {
      handleEnroll();
    }
  };

  // ── Enroll & Stream ───────────────────────────────────────────────
  const handleEnroll = async () => {
    setShowCredModal(false);
    const toAdd = discoveredDevices.filter((d) => selectedDevices.has(d.id));
    setIsRegistering(true);

    const initStatus = {};
    toAdd.forEach((d) => { initStatus[d.id] = { status: "pending" }; });
    setRegStatus(initStatus);

    const results = await Promise.all(
      toAdd.map(async (device) => {

        const creds = deviceCreds[device.id] || {};

        const probePayload = {
          ip: device.ip,
          username: creds.username || "",
          password: creds.password || "",
          group_id: creds.groupId || "default",
          device_name: creds.cameraName || ""
        };

        const devicePort = device.port;
        if (devicePort && !isNaN(devicePort) && Number(devicePort) > 0) {
          probePayload.port = Number(devicePort);
        }

        setRegStatus((prev) => ({
          ...prev,
          [device.id]: { status: "registering" }
        }));

        let ws_url = null;
        let stream_key = null;
        let stream_status = "error";
        let rtsp_url = null;

        let enrichedName = null;
        let enrichedManufacturer = device.manufacturer || "Unknown";
        let enrichedModel = device.model || "Unknown";
        let enrichedFirmware = null;
        let enrichedSerial = null;

        let streamProfiles = [];
        let streamCount = 0;

        let data = null;
        try {
          const res = await fetch(`${STREAM_API}/api/onvif/probe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(probePayload),
          });

          data = await res.json();

          if (!res.ok) {
            alert(` ${device.ip} → ${data.detail || "Camera limit exceeded"}`);

            setRegStatus((prev) => ({
              ...prev,
              [device.id]: { status: "error", error: data.detail }
            }));

            return null;
          }

          if (data?.success && data?.ws_url) {
            ws_url = data.ws_url;
            stream_key = data.stream_key || data.ome_stream || null;
            stream_status = data.status || "streaming";
            rtsp_url = data.rtsp_url || data.stream_uri || null;

            enrichedManufacturer = data.manufacturer || enrichedManufacturer;
            enrichedModel = data.model || enrichedModel;
            enrichedFirmware = data.firmware || null;
            enrichedSerial = data.serial || null;

            enrichedName = `${enrichedManufacturer} ${enrichedModel}`.trim();

            streamProfiles = data.profiles || [];
            streamCount = data.stream_count ?? streamProfiles.length;

            setRegStatus((prev) => ({
              ...prev,
              [device.id]: { status: "success", ws_url }
            }));
          } else {
            const errMsg = data?.error || `HTTP ${res.status}`;
            setRegStatus((prev) => ({
              ...prev,
              [device.id]: { status: "error", error: errMsg }
            }));
          }

        } catch (err) {
          setRegStatus((prev) => ({
            ...prev,
            [device.id]: { status: "error", error: err.message }
          }));
        }

        return {
          id: `device-${device.ip}-${Date.now()}`,
          type: "entrance",
          name:
            creds.cameraName ||
            enrichedName ||
            `Camera @ ${device.ip}`,
          ip: device.ip,
          group_id: creds.groupId || "default",
          mac: data?.mac || device.mac || "—",
          status: ws_url ? "Online" : "Offline",
          manufacturer: enrichedManufacturer,
          model: enrichedModel,
          firmware: enrichedFirmware,
          serial: enrichedSerial,
          rtsp_url,
          ws_url,
          stream_key,
          stream_status,
          source: "discovery",
          stream_profiles: streamProfiles,
          stream_count: streamCount,
        };
      })
    );

    await new Promise((r) => setTimeout(r, 600));
    setIsRegistering(false);
    onAddDevices(results.filter(Boolean));
    onClose();
  };

  const RegBadge = ({ deviceId }) => {
    const s = regStatus[deviceId];
    if (!s) return null;
    const map = {
      pending:     { label: "Pending…",    cls: "dm-reg--pending"  },
      registering: { label: "Probing…",    cls: "dm-reg--progress" },
      success:     { label: "✓ Streaming", cls: "dm-reg--success"  },
      error:       { label: "✗ Failed",    cls: "dm-reg--error"    },
    };
    const { label, cls } = map[s.status] || {};
    return (
      <span className={`dm-reg-badge ${cls}`} title={s.error || s.ws_url || ""}>
        {label}
      </span>
    );
  };

  const selectedList = discoveredDevices.filter((d) => selectedDevices.has(d.id));

  useEffect(() => {
    if (!showCredModal) return;
    const handleKeyDown = (e) => {
      if (e.target.tagName !== 'INPUT') return;
      const inputs = document.querySelectorAll('.dm-cred-modal input[tabindex]:not([tabindex="-1"])');
      const currentIndex = Array.from(inputs).findIndex(input => input === e.target);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % inputs.length;
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + inputs.length) % inputs.length;
      } else {
        return;
      }
      e.preventDefault();
      inputs[nextIndex].focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showCredModal, selectedList]);

  return (
    <>
      <div className="dm-overlay" onClick={onClose}>
        <div className="dm-modal" onClick={(e) => e.stopPropagation()}>

          <div className="dm-header">
            <div className="dm-header-left">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                <path d="M11 8v6M8 11h6"/>
              </svg>
              Network Discovery
            </div>
            <button className="dm-close" onClick={onClose} tabIndex={-1}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className="dm-body">

            {!hasScanned && !isScanning && (
              <div className="dm-center">
                <div className="dm-empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    <path d="M2 12h20"/>
                  </svg>
                </div>
                <div className="dm-empty-title">Auto-Discover Cameras</div>
                <div className="dm-empty-sub">
                  Automatically scans your network for ONVIF-compatible cameras.
                  <br />No configuration needed — just click Start.
                </div>
                <button className="dm-start-btn" onClick={startDiscovery} tabIndex={1}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  Start Discovery
                </button>
              </div>
            )}

            {isScanning && (
              <div className="dm-center">
                <div className="dm-spinner"><div className="dm-spinner-ring"/></div>
                <div className="dm-scan-msg">{statusMessage}</div>
                <div className="dm-progress-wrap">
                  <div className="dm-progress-bar">
                    <div
                      className="dm-progress-fill"
                      style={{ width: `${progress}%`, transition: "width 0.3s ease-out" }}
                    />
                  </div>
                  <span className="dm-progress-pct">{progress}%</span>
                </div>
              </div>
            )}

            {hasScanned && !isScanning && discoveredDevices.length > 0 && (
              <div className="dm-results">
                <div className="dm-results-header">
                  <span className="dm-results-count">
                    Found <strong>{discoveredDevices.length}</strong> camera{discoveredDevices.length !== 1 ? "s" : ""}
                  </span>
                  <button className="dm-select-all" onClick={toggleAll} disabled={isRegistering} tabIndex={2}>
                    {selectedDevices.size === discoveredDevices.length ? "Deselect All" : "Select All"}
                  </button>
                </div>
                <div className="dm-device-list">
                  {discoveredDevices.map((device, index) => {
                    const sel = selectedDevices.has(device.id);
                    return (
                      <div
                        key={device.id}
                        className={`dm-device ${sel ? "dm-device--selected" : ""} ${isRegistering ? "dm-device--disabled" : ""}`}
                        onClick={() => !isRegistering && toggleOne(device.id)}
                      >
                        <input
                          type="checkbox"
                          className="dm-cb"
                          checked={sel}
                          disabled={isRegistering}
                          tabIndex={3 + index}
                          onChange={() => toggleOne(device.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="dm-device-icon">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                            <rect x="2" y="7" width="15" height="10" rx="2"/>
                            <path d="M17 9l5-3v12l-5-3"/>
                          </svg>
                        </div>
                        <div className="dm-device-info">
                          <div className="dm-device-name">{device.name || `Camera @ ${device.ip}`}</div>
                          <div className="dm-device-meta">
                            {device.ip}
                            {device.manufacturer && device.manufacturer !== "Unknown" && ` · ${device.manufacturer}`}
                            {device.model        && device.model        !== "Unknown" && ` ${device.model}`}
                          </div>
                        </div>
                        {isRegistering && sel
                          ? <RegBadge deviceId={device.id} />
                          : (
                            <div className={`dm-status ${device.status === "online" ? "dm-status--online" : "dm-status--offline"}`}>
                              <span className="dm-status-dot"/>
                              {device.status === "online" ? "Online" : "Offline"}
                            </div>
                          )
                        }
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {hasScanned && !isScanning && discoveredDevices.length === 0 && (
              <div className="dm-center">
                <div className="dm-empty-icon dm-empty-icon--warn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <div className="dm-empty-title">{error ? "Discovery Failed" : "No Cameras Found"}</div>
                <div className="dm-empty-sub">
                  {error || "No ONVIF cameras were detected on the network."}
                </div>
                <button className="dm-start-btn" onClick={startDiscovery} tabIndex={1}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  Try Again
                </button>
              </div>
            )}
          </div>

          {hasScanned && !isScanning && discoveredDevices.length > 0 && (
            <div className="dm-footer">
              <button
                className="dm-btn dm-btn--cancel"
                onClick={onClose}
                disabled={isRegistering}
                tabIndex={discoveredDevices.length + 3}
              >
                Cancel
              </button>
              <button
                className="dm-btn dm-btn--primary"
                disabled={selectedDevices.size === 0 || isRegistering}
                onClick={handleAddClick}
                tabIndex={discoveredDevices.length + 4}
              >
                {isRegistering
                  ? "Registering…"
                  : selectedDevices.size > 0
                    ? `Add ${selectedDevices.size} Camera${selectedDevices.size !== 1 ? "s" : ""}`
                    : "Add Devices"
                }
              </button>
            </div>
          )}
        </div>
      </div>

      {showCredModal && (
        <div className="dm-overlay dm-overlay--front" onClick={() => setShowCredModal(false)}>
          <div className="dm-cred-modal" onClick={(e) => e.stopPropagation()}>

            <div className="dm-header">
              <div className="dm-header-left">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <rect x="3" y="11" width="18" height="11" rx="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                Enter Camera Credentials
              </div>
              <button className="dm-close" onClick={() => setShowCredModal(false)} tabIndex={-1}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className="dm-cred-body">

              <p className="dm-cred-hint">
                Enter ONVIF credentials for each camera. Leave blank if no authentication is required.
              </p>

              <div className="dm-cred-list">
                {selectedList.map((device, index) => {
                  const isLast  = index === selectedList.length - 1;
                  const baseTab = index * 3 + 1;
                  return (
                    <div key={device.id} className="dm-cred-row">
                      <div className="dm-cred-cam">
                        <div className="dm-cred-cam-icon">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="15" height="15">
                            <rect x="2" y="7" width="15" height="10" rx="2"/>
                            <path d="M17 9l5-3v12l-5-3"/>
                          </svg>
                        </div>
                        <div>
                          <div className="dm-cred-cam-name">{device.name || `Camera @ ${device.ip}`}</div>
                          <div className="dm-cred-cam-ip">{device.ip}</div>
                        </div>
                      </div>

                      <div className="dm-cred-fields">

                        <input
                          className="dm-cred-input"
                          placeholder="Camera Name (optional)"
                          tabIndex={baseTab}
                          value={deviceCreds[device.id]?.cameraName || ""}
                          onChange={(e) => updateCred(device.id, "cameraName", e.target.value)}
                          autoComplete="off"
                        />

                        <div className="dm-custom-select" style={{ flex: 1, minWidth: 0 }} ref={openDropdownId === device.id ? dropdownRef : null}>
                          <button
                            type="button"
                            className="dm-select-btn"
                            style={{ height: "30px", padding: "0 10px" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownId(openDropdownId === device.id ? null : device.id);
                            }}
                          >
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {(!deviceCreds[device.id]?.groupId || deviceCreds[device.id]?.groupId === "default") 
                                ? "Default" 
                                : groups?.find(g => g.id === deviceCreds[device.id]?.groupId)?.name || "Default"}
                            </span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: openDropdownId === device.id ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", color: "var(--text-muted)", flexShrink: 0, marginLeft: "6px" }}>
                              <path d="M6 9l6 6 6-6"/>
                            </svg>
                          </button>
                          {openDropdownId === device.id && (
                            <ul className="dm-dropdown-menu">
                              <li
                                className={`dm-dropdown-item ${(!deviceCreds[device.id]?.groupId || deviceCreds[device.id]?.groupId === "default") ? "active" : ""}`}
                                onClick={() => { updateCred(device.id, "groupId", "default"); setOpenDropdownId(null); }}
                              >
                                Default
                              </li>
                              {groups?.map((g) => (
                                <li
                                  key={g.id}
                                  className={`dm-dropdown-item ${deviceCreds[device.id]?.groupId === g.id ? "active" : ""}`}
                                  onClick={() => { updateCred(device.id, "groupId", g.id); setOpenDropdownId(null); }}
                                >
                                  {g.name}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <input
                          className="dm-cred-input"
                          placeholder="Username"
                          tabIndex={baseTab + 1}
                          value={deviceCreds[device.id]?.username || ""}
                          onChange={(e) => updateCred(device.id, "username", e.target.value)}
                          autoComplete="off"
                        />

                        <div className="dm-password-wrapper">
                          <input
                            className="dm-cred-input dm-password-input"
                            placeholder="Password"
                            type={showPasswords[device.id] ? "text" : "password"}
                            tabIndex={baseTab + 2}
                            value={deviceCreds[device.id]?.password || ""}
                            onChange={(e) => updateCred(device.id, "password", e.target.value)}
                            onKeyDown={(e) => handleCredKeyDown(e, device.id, isLast)}
                            autoComplete="new-password"
                          />
                          <button
                            type="button"
                            className="dm-eye-btn"
                            onClick={() => togglePasswordVisibility(device.id)}
                            tabIndex={-1}
                          >
                            {showPasswords[device.id] ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                                <line x1="1" y1="1" x2="23" y2="23"/>
                              </svg>
                            )}
                          </button>
                        </div>

                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="dm-footer">
              <button
                className="dm-btn dm-btn--cancel"
                onClick={() => setShowCredModal(false)}
                tabIndex={selectedList.length * 3 + 1}
              >
                Back
              </button>
              <button
                className="dm-btn dm-btn--primary"
                onClick={handleEnroll}
                tabIndex={selectedList.length * 3 + 2}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Enroll & Stream
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}