import React, { useState, useEffect, useRef } from "react";
import "./LogsPage.css";

const API_BASE = import.meta.env.VITE_API_URL;
function getAuthHeaders() {
  const token = localStorage.getItem("miradorai_token") || localStorage.getItem("token") || localStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
const formatLocalDatetime = (date) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const getInitialFromDate = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return formatLocalDatetime(d);
};

const getInitialToDate = () => {
  const d = new Date();
  return formatLocalDatetime(d);
};

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState("ui");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState(getInitialFromDate());
  const [toDate, setToDate] = useState(getInitialToDate());
  const [category, setCategory] = useState("");
  const [hasCustomToDate, setHasCustomToDate] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedDetails, setExpandedDetails] = useState({});
  const logsPerPage = 15;

  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const categoryDropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target)) {
        setCategoryDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const categoryMap = {
    "": "All Categories",
    "auth": "Auth",
    "navigation": "Navigation",
    "devices": "Devices",
    "settings": "Settings",
    "system": "System",
    "recording": "Recording"
  };

  const fetchLogs = async (isBackground = false) => {
    if (!isBackground) {
      setLoading(true);
      setLogs([]);
    }
    try {
      const queryParams = new URLSearchParams();
      if (fromDate) {
        const localDate = new Date(fromDate);
        queryParams.append("from_date", localDate.toISOString());
      }
      if (toDate && hasCustomToDate) {
        const localDate = new Date(toDate);
        queryParams.append("to_date", localDate.toISOString());
      }

      // For the recordings tab, force category=recording on ui endpoint
      if (activeTab === "recordings") {
        queryParams.append("category", "recording");
      } else if (activeTab === "ui" && category) {
        queryParams.append("category", category);
      }
      queryParams.append("limit", "1000");

      // recordings tab uses /api/logs/ui with category=recording
      const endpoint = activeTab === "recordings" ? "ui" : activeTab;
      const response = await fetch(`${API_BASE}/api/logs/${endpoint}?${queryParams.toString()}`, {
        headers: getAuthHeaders()
      });
      const data = await response.json();
      if (data.success) {
        setLogs(data.logs);
        if (!isBackground) {
          setCurrentPage(1);
          setExpandedDetails({});
        }
      }
    } catch (err) {
      console.error("Failed to fetch logs", err);
    } finally {
      if (!isBackground) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [activeTab, category]);

  useEffect(() => {
    const interval = setInterval(() => fetchLogs(true), 2000);
    return () => clearInterval(interval);
  }, [activeTab, fromDate, toDate, category]);

  // Pagination calculations
  const indexOfLastLog = currentPage * logsPerPage;
  const indexOfFirstLog = indexOfLastLog - logsPerPage;
  const currentLogs = logs.slice(indexOfFirstLog, indexOfLastLog);
  const totalPages = Math.ceil(logs.length / logsPerPage);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  return (
    <div className="logs-page page-shell slide-in">
      <div className="logs-header">
        <div className="logs-title-area">
          <h1 className="logs-title">System <span>Logs</span></h1>
          <p className="logs-subtitle">Track UI activities and Terminal executions</p>
        </div>
        
        <div className="logs-tabs">
          <button 
            className={`logs-tab ${activeTab === "ui" ? "active" : ""}`}
            onClick={() => setActiveTab("ui")}
          >
            UI Logs
          </button>
          <button 
            className={`logs-tab ${activeTab === "terminal" ? "active" : ""}`}
            onClick={() => setActiveTab("terminal")}
          >
            Terminal Logs
          </button>
          <button 
            className={`logs-tab ${activeTab === "recordings" ? "active" : ""}`}
            onClick={() => setActiveTab("recordings")}
          >
            🎥 Recordings
          </button>
        </div>
      </div>

      <div className="logs-filters card">
        <div className="log-filter-group">
          <label>From Date & Time</label>
          <input 
            type="datetime-local" 
            className="log-input" 
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className="log-filter-group">
          <label>To Date & Time</label>
          <input 
            type="datetime-local" 
            className="log-input" 
            value={toDate}
            onChange={(e) => {
              const val = e.target.value;
              setToDate(val);
              setHasCustomToDate(!!val);
            }}
          />
        </div>
        {activeTab === "ui" && (
          <div className="log-filter-group" ref={categoryDropdownRef}>
            <label>Category</label>
            <div className="logs-custom-select">
              <button
                type="button"
                className="logs-select-btn"
                onClick={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
              >
                <span>{categoryMap[category]}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: categoryDropdownOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", color: "var(--text-secondary)" }}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
              {categoryDropdownOpen && (
                <ul className="logs-dropdown-menu">
                  {Object.entries(categoryMap).map(([val, label]) => (
                    <li
                      key={val}
                      className={`logs-dropdown-item ${category === val ? "active" : ""}`}
                      onClick={() => {
                        setCategory(val);
                        setCategoryDropdownOpen(false);
                      }}
                    >
                      {label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        {activeTab === "recordings" && (
          <div className="log-filter-group">
            <label>Filter</label>
            <div style={{ color: "var(--text-secondary)", fontSize: "12px", padding: "8px 12px", background: "rgba(99, 102, 241, 0.1)", border: "1px solid rgba(99, 102, 241, 0.3)", borderRadius: "8px" }}>
              🎬 Showing recordings only for motion-enabled cameras
            </div>
          </div>
        )}
        <button 
          className="log-btn-primary" 
          onClick={() => {
            setHasCustomToDate(true);
            fetchLogs();
          }}
        >
          Apply Filters
        </button>
      </div>

      <div className="logs-table-container">
        {loading ? (
          <div className="logs-loading-text">Loading....</div>
        ) : logs.length === 0 ? (
          <div className="empty-logs">No logs found for the selected criteria.</div>
        ) : (
          <div className="logs-table-wrapper">
            <table className="logs-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  {(activeTab === "ui" || activeTab === "recordings") ? (
                    <>
                      <th>Role</th>
                      {activeTab === "ui" && <th>Category</th>}
                      {activeTab === "recordings" && <th>Camera</th>}
                      <th>Action</th>
                      <th>{activeTab === "recordings" ? "Face / Details" : "Details"}</th>
                    </>
                  ) : (
                    <>
                      <th>Project Folder</th>
                      <th>Exit Code</th>
                      <th>Command & Output</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {currentLogs.map((log, i) => (
                  <tr key={i}>
                    <td>{new Date(log.timestamp).toLocaleString()}</td>
                    <td>{log.user_email}</td>
                    {(activeTab === "ui" || activeTab === "recordings") ? (
                      <>
                        <td>
                          <span className={`log-tag ${log.user_role}`}>
                            {log.user_role?.toUpperCase()}
                          </span>
                        </td>
                        {activeTab === "ui" && <td>{log.category?.toUpperCase()}</td>}
                        {activeTab === "recordings" && (
                          <td style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--accent)" }}>
                            {log.details?.camera_id || "-"}
                          </td>
                        )}
                        <td>
                          <span>{log.action}</span>
                        </td>
                        <td className="log-details-cell">
                          {(activeTab === "recordings" || log.category === "recording") ? (
                            // Recording logs: show face image prominently + event badge
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              {log.details?.face_url && (
                                <img
                                  src={`${API_BASE}${log.details.face_url}`}
                                  alt="Detected Face"
                                  style={{
                                    width: "56px",
                                    height: "56px",
                                    borderRadius: "6px",
                                    objectFit: "cover",
                                    border: "2px solid rgba(99, 102, 241, 0.6)",
                                    flexShrink: 0,
                                    boxShadow: "0 0 8px rgba(99,102,241,0.4)"
                                  }}
                                  onError={(e) => { e.target.style.display = 'none'; }}
                                />
                              )}
                              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                {log.details?.event && (
                                  <span style={{
                                    padding: "2px 8px",
                                    borderRadius: "12px",
                                    fontSize: "10px",
                                    fontWeight: 600,
                                    background: log.details.event === "recording_started" ? "rgba(34, 197, 94, 0.15)" : "rgba(245, 158, 11, 0.15)",
                                    color: log.details.event === "recording_started" ? "#22c55e" : "#f59e0b",
                                    border: `1px solid ${log.details.event === "recording_started" ? "rgba(34,197,94,0.3)" : "rgba(245,158,11,0.3)"}`
                                  }}>
                                    {log.details.event === "recording_started" ? "🎬 Recording Started" : "💥 Motion Detected"}
                                  </span>
                                )}
                                {log.details?.file_name && (
                                  <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                                    📁 {log.details.file_name}
                                  </span>
                                )}
                                {log.details?.duration && (
                                  <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                                    ⏱ {log.details.duration}s
                                  </span>
                                )}
                                {!log.details?.face_url && log.details?.event === "motion_trigger" && (
                                  <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>No face detected</span>
                                )}
                              </div>
                            </div>
                          ) : (
                            // UI Logs tab (other categories): face image or nothing important
                            log.details && Object.keys(log.details).length > 0 ? (
                              log.details.face_url ? (
                                <img 
                                  src={`${API_BASE}${log.details.face_url}`}
                                  alt="Face Crop"
                                  style={{ 
                                    width: "60px", 
                                    height: "60px", 
                                    borderRadius: "4px", 
                                    objectFit: "cover",
                                    border: "1px solid rgba(255, 255, 255, 0.2)",
                                    display: "block"
                                  }}
                                  onError={(e) => { e.target.style.display = 'none'; }}
                                />
                              ) : (
                                <button
                                  className="log-details-toggle"
                                  onClick={() => setExpandedDetails(prev => ({ ...prev, [i]: !prev[i] }))}
                                >
                                  {expandedDetails[i] ? "Hide" : "Show Details"}
                                </button>
                              )
                            ) : (
                              "-"
                            )
                          )}
                          {expandedDetails[i] && !log.details?.face_url && activeTab === "ui" && (
                            <pre className="log-details-pre">{JSON.stringify(log.details, null, 2)}</pre>
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{log.project_folder}</td>
                        <td>{log.exit_code}</td>
                        <td className="log-output">
                          <strong>{log.command}</strong>
                          {log.output_snippet && (
                            <pre>{log.output_snippet}</pre>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {logs.length > logsPerPage && (
        <div className="pagination-container">
          <button 
            className="pagination-btn" 
            disabled={currentPage === 1}
            onClick={() => handlePageChange(currentPage - 1)}
          >
            Prev
          </button>
          <span className="pagination-info">
            Page {currentPage} of {totalPages} ({logs.length} total logs)
          </span>
          <button 
            className="pagination-btn" 
            disabled={currentPage === totalPages}
            onClick={() => handlePageChange(currentPage + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}