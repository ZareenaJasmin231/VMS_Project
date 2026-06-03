import React, { useState, useEffect, useRef } from "react";
import "./LogsPage.css";

const API_BASE = import.meta.env.VITE_API_URL;
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
  const [currentPage, setCurrentPage] = useState(1);
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

  const fetchLogs = async () => {
    setLoading(true);
    setLogs([]);
    try {
      const queryParams = new URLSearchParams();
      if (fromDate) {
        const localDate = new Date(fromDate);
        queryParams.append("from_date", localDate.toISOString());
      }
      if (toDate) {
        const localDate = new Date(toDate);
        queryParams.append("to_date", localDate.toISOString());
      }
      if (activeTab === "ui" && category) {
        queryParams.append("category", category);
      }
      queryParams.append("limit", "1000");

      const response = await fetch(`${API_BASE}/api/logs/${activeTab}?${queryParams.toString()}`);
      const data = await response.json();
      if (data.success) {
        setLogs(data.logs);
        setCurrentPage(1);
      }
    } catch (err) {
      console.error("Failed to fetch logs", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [activeTab]);

  useEffect(() => {
    const interval = setInterval(fetchLogs, 10000);
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
            onChange={(e) => setToDate(e.target.value)}
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
        <button className="log-btn-primary" onClick={fetchLogs}>Apply Filters</button>
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
                  {activeTab === "ui" ? (
                    <>
                      <th>Role</th>
                      <th>Category</th>
                      <th>Action</th>
                      <th>Details</th>
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
                    {activeTab === "ui" ? (
                      <>
                        <td>
                          <span className={`log-tag ${log.user_role}`}>
                            {log.user_role?.toUpperCase()}
                          </span>
                        </td>
                        <td>{log.category?.toUpperCase()}</td>
                        <td>{log.action}</td>
                        <td className="log-details-cell">
                          {log.details && Object.keys(log.details).length > 0 ? (
                            <pre className="log-details-pre">{JSON.stringify(log.details, null, 2)}</pre>
                          ) : (
                            "-"
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