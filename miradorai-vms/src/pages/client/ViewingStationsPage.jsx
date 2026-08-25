import { useState, useEffect, useRef } from "react";
import WebRTCPlayer_MediaMTX from "../../components/shared/WebRTCPlayer_MediaMTX";
import rrwebPlayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';
import "./ViewingStationsPage.css";

const API = import.meta.env.VITE_API_URL;

function getAuthHeaders() {
  const token = localStorage.getItem("miradorai_token");
  return token ? { "Authorization": "Bearer " + token } : {};
}

function CellDropdown({ value, onChange, cameras }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedCam = cameras.find(c => String(c.id) === String(value));
  const label = selectedCam ? `${selectedCam.name} (${selectedCam.ip})` : "-- [Empty Cell] --";

  return (
    <div className="vs-cell-dropdown" ref={dropdownRef}>
      <button 
        type="button" 
        className={`vs-cell-dropdown-trigger ${isOpen ? "active" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="vs-cell-dropdown-label">{label}</span>
        <svg className={`vs-cell-chevron ${isOpen ? "open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isOpen && (
        <div className="vs-cell-dropdown-menu">
          <button
            type="button"
            className={`vs-cell-dropdown-item ${!value ? "selected" : ""}`}
            onClick={() => { onChange(""); setIsOpen(false); }}
          >
            -- [Empty Cell] --
          </button>
          {cameras.map(cam => (
            <button
              key={cam.id}
              type="button"
              className={`vs-cell-dropdown-item ${String(value) === String(cam.id) ? "selected" : ""}`}
              onClick={() => { onChange(cam.id); setIsOpen(false); }}
            >
              {cam.name} ({cam.ip})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ViewingStationsPage() {
  const [stations, setStations] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStation, setSelectedStation] = useState(null);
  
  // Layout Builder State
  const [gridSize, setGridSize] = useState("2x2");
  const [cellAssignments, setCellAssignments] = useState([]);
  const [pushStatus, setPushStatus] = useState({ success: null, message: "" });
  const [pushing, setPushing] = useState(false);

  // Monitor Station State
  const [monitorStation, setMonitorStation] = useState(null);

  const handleMonitorStation = (station) => {
    setMonitorStation(station);
  };

  // Load cameras
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("miradorai_devices") || "[]");
      setCameras(stored.filter(c => c.enabled !== false));
    } catch (e) {
      console.error("Failed to load local devices list:", e);
    }
  }, []);

  // Fetch viewing stations
  const fetchStations = async () => {
    try {
      const res = await fetch(`${API}/api/viewing-stations`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setStations(data.stations || []);
        }
      }
    } catch (e) {
      console.error("Failed to fetch stations:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStations();
    const interval = setInterval(fetchStations, 4000);
    return () => clearInterval(interval);
  }, []);

  // Handle grid size change
  useEffect(() => {
    const parts = gridSize.split("x");
    const rows = parseInt(parts[0], 10) || 2;
    const cols = parseInt(parts[1], 10) || 2;
    const cellsCount = rows * cols;
    
    setCellAssignments(prev => {
      const next = Array(cellsCount).fill(null);
      for (let i = 0; i < Math.min(prev.length, cellsCount); i++) {
        next[i] = prev[i];
      }
      return next;
    });
  }, [gridSize]);

  // Set builder layout based on selected station's layout
  const handleEditStationLayout = (station) => {
    setSelectedStation(station);
    setPushStatus({ success: null, message: "" });
    
    const active = station.active_layout;
    if (active) {
      setGridSize(active.grid || "2x2");
      const order = active.device_order || [];
      setCellAssignments(order);
    } else {
      setGridSize("2x2");
      setCellAssignments(Array(4).fill(null));
    }
  };

  const handleCellChange = (index, value) => {
    setCellAssignments(prev => {
      const next = [...prev];
      next[index] = value || null;
      return next;
    });
  };

  const handlePushLayout = async () => {
    if (!selectedStation) return;
    setPushing(true);
    setPushStatus({ success: null, message: "" });
    
    try {
      const res = await fetch(`${API}/api/viewing-stations/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          station_id: selectedStation.station_id,
          grid: gridSize,
          device_order: cellAssignments
        })
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        setPushStatus({ success: true, message: `Successfully pushed layout to ${selectedStation.name}!` });
        fetchStations();
      } else {
        setPushStatus({ success: false, message: data.detail || "Failed to push layout." });
      }
    } catch (e) {
      setPushStatus({ success: false, message: "Network error occurred." });
    } finally {
      setPushing(false);
    }
  };

  const getCameraName = (id) => {
    if (!id) return "Empty Cell";
    const cam = cameras.find(c => String(c.id) === String(id));
    return cam ? cam.name : `Camera [${id}]`;
  };

  return (
    <div className="vs-page">
      <div className="vs-header">
        <h1 className="vs-title">Viewing Stations Directory</h1>
      </div>

      <div className="vs-content-layout">
        
        {/* Terminals Directory List */}
        <div className="vs-panel vs-list-panel">
          <div className="vs-panel-header">
            <h2>Active Terminals ({stations.length})</h2>
          </div>
          <div className="vs-panel-body">
            {loading ? (
              <div className="vs-state-msg">Loading terminals directory...</div>
            ) : stations.length === 0 ? (
              <div className="vs-state-msg">No workstations detected on the network yet. Open the <strong>Live View</strong> page on any workstation to register.</div>
            ) : (
              <div className="vs-grid-list">
                {stations.map(st => {
                  const isSelected = selectedStation?.station_id === st.station_id;
                  const activeGrid = st.active_layout?.grid || "None";
                  const activeCamsCount = st.active_feeds_count || 0;
                  
                  return (
                    <div 
                      key={st.station_id} 
                      className={`vs-station-card ${st.is_online ? "online" : "offline"} ${isSelected ? "selected" : ""}`}
                      onClick={() => handleEditStationLayout(st)}
                    >
                      <div className="vs-card-header">
                        <div className="vs-station-info">
                          <span className="vs-station-name">{st.name}</span>
                          {st.email && st.email !== "Unknown" && (
                            <span className="vs-station-id" style={{fontSize: "12px", color: "var(--primary-color)", marginTop: "-2px", marginBottom: "2px"}}>{st.email}</span>
                          )}
                          <span className="vs-station-id">{st.station_id}</span>
                        </div>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <button
                            className="m-btn m-btn--elevated"
                            style={{ padding: "4px 8px", fontSize: "11px" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMonitorStation(st);
                            }}
                            title="Monitor this station's screen"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" style={{ marginRight: "4px" }}>
                              <rect x="2" y="3" width="20" height="14" rx="2" />
                              <line x1="8" y1="21" x2="16" y2="21" />
                              <line x1="12" y1="17" x2="12" y2="21" />
                            </svg>
                            Monitor
                          </button>
                          <div className={`vs-status-badge ${st.is_online ? "online" : "offline"}`}>
                            {st.is_online ? "Online" : "Offline"}
                          </div>
                        </div>
                      </div>
                      
                      <div className="vs-card-details">
                        <div className="vs-detail-row">
                          <span className="label">Current Grid:</span>
                          <span className="value highlight">{activeGrid} Grid</span>
                        </div>
                        <div className="vs-detail-row">
                          <span className="label">Active Feeds:</span>
                          <span className="value">{activeCamsCount} camera{activeCamsCount !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="vs-detail-row">
                          <span className="label">Last Seen:</span>
                          <span className="value">
                            {st.last_seen > 0 ? new Date(st.last_seen * 1000).toLocaleTimeString() : "Never"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Remote Layout Builder Panel */}
        <div className="vs-panel vs-builder-panel">
          <div className="vs-panel-header">
            <h2>Remote Layout Controller</h2>
          </div>
          <div className="vs-panel-body">
            {!selectedStation ? (
              <div className="vs-builder-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="48" height="48">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <path d="M8 21h8M12 17v4"/>
                </svg>
                <p>Select a viewing terminal from the directory list on the left to configure and push a remote layout.</p>
              </div>
            ) : (
              <div className="vs-builder-container">
                <div className="vs-builder-top">
                  <h3>Target Terminal: <span className="highlight">{selectedStation.name}</span></h3>
                  {!selectedStation.is_online && (
                    <div className="vs-warning-banner">
                      ⚠️ Note: This terminal is currently offline. Pushed layouts will apply immediately once the station re-connects.
                    </div>
                  )}
                </div>

                <div className="vs-form-group">
                  <label className="vs-form-label">Select Grid Format</label>
                  <div className="vs-grid-selector" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {["2x2", "2x3", "3x2", "3x3", "3x4", "4x4", "8x8"].map(g => (
                      <button 
                        key={g} 
                        className={`vs-grid-btn ${gridSize === g ? "active" : ""}`}
                        onClick={() => setGridSize(g)}
                        type="button"
                        style={{ flex: "1 0 calc(25% - 6px)", minWidth: "70px", padding: "8px 10px" }}
                      >
                        {g} Grid
                      </button>
                    ))}
                  </div>
                </div>

                <div className="vs-form-group">
                  <label className="vs-form-label">Configure Cells Configuration</label>
                  
                  {/* Grid Layout Preview Form */}
                  <div 
                    className="vs-builder-grid"
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${parseInt(gridSize.split("x")[1], 10) || 2}, 1fr)`,
                      gap: "12px",
                      marginTop: "12px"
                    }}
                  >
                    {cellAssignments.map((assignedId, idx) => (
                      <div key={idx} className="vs-builder-cell">
                        <span className="vs-cell-num">Cell {idx + 1}</span>
                        <CellDropdown
                          value={assignedId || ""}
                          onChange={(val) => handleCellChange(idx, val)}
                          cameras={cameras}
                        />
                        <div className="vs-cell-preview-name">
                          {getCameraName(assignedId)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {pushStatus.message && (
                  <div className={`vs-status-banner ${pushStatus.success ? "success" : "error"}`}>
                    {pushStatus.message}
                  </div>
                )}

                <div className="vs-builder-actions">
                  <button
                    className="m-btn m-btn--primary"
                    onClick={handlePushLayout}
                    disabled={pushing}
                    type="button"
                  >
                    {pushing ? "Pushing Layout..." : "Push Layout to Terminal"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {monitorStation && (
        <div className="modal-overlay" onClick={() => setMonitorStation(null)}>
          <div className="modal-box" style={{ width: "90%", maxWidth: "1200px", background: "var(--bg-surface)", border: "1px solid var(--border-color)", padding: "20px" }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Live Mirror: {monitorStation.name}</h2>
              <button className="modal-close" onClick={() => setMonitorStation(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ minHeight: "500px", padding: 0, marginTop: "16px" }}>
              {!monitorStation.is_online ? (
                <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                  Station is offline.
                </div>
              ) : (
                <LiveMirrorMonitor station={monitorStation} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LiveMirrorMonitor({ station }) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  
  useEffect(() => {
    let ws = null;
    let events = [];
    
    const apiBase = import.meta.env.VITE_API_URL || '';
    let wsUrl = '';
    
    if (apiBase) {
      wsUrl = apiBase.replace(/^http/, 'ws') + `/ws/events?topics=station_${station.station_id}_stream`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws/events?topics=station_${station.station_id}_stream`;
    }
    
    console.log("[LiveMirror] Connecting to stream:", wsUrl);
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
       console.log("[LiveMirror] Connected! Sending start_record command to:", station.station_id);
       ws.send(JSON.stringify({
          action: "publish",
          topic: `station_${station.station_id}`,
          pub_event: "start_record",
          data: {}
       }));
    };

    ws.onmessage = (msg) => {
       try {
         const data = JSON.parse(msg.data);
         if (data.event === "rrweb_event" && data.data) {
            const rr_event = data.data;
            
            if (events.length === 0 && rr_event.type !== 2) {
               console.log("[LiveMirror] Waiting for FullSnapshot...");
               return;
            }
            
            if (!playerRef.current) {
               events.push(rr_event);
               if (events.length > 1 && containerRef.current) {
                 console.log("[LiveMirror] Initializing rrwebPlayer with", events.length, "events");
                 playerRef.current = new rrwebPlayer({
                   target: containerRef.current,
                   props: {
                     events: [...events], // Clone the array for initial setup
                     liveMode: true,
                     showController: false,
                     autoPlay: true,
                     width: containerRef.current.offsetWidth,
                     height: containerRef.current.offsetHeight || 600,
                   }
                 });
               }
            } else {
               // Player is already initialized, just feed it the new event
               playerRef.current.addEvent(rr_event);
            }
         }
       } catch (e) {}
    };
    
    return () => {
       if (ws && ws.readyState === WebSocket.OPEN) {
          console.log("[LiveMirror] Sending stop_record command");
          ws.send(JSON.stringify({
             action: "publish",
             topic: `station_${station.station_id}`,
             pub_event: "stop_record",
             data: {}
          }));
          ws.close();
       }
       if (playerRef.current) {
           playerRef.current.pause();
       }
    };
  }, [station.station_id]);

  return <div ref={containerRef} style={{ width: '100%', height: '600px', backgroundColor: '#000' }} />;
}
