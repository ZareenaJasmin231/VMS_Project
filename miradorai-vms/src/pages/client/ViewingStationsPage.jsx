import { useState, useEffect, useRef } from "react";
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
                          <span className="vs-station-id">{st.station_id}</span>
                        </div>
                        <div className={`vs-status-badge ${st.is_online ? "online" : "offline"}`}>
                          {st.is_online ? "Online" : "Offline"}
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
    </div>
  );
}
