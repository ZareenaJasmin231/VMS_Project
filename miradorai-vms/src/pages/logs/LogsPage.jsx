import React, { useState, useEffect } from "react";
import "./LogsPage.css";

const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "http://192.168.126.200:8000";

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState("ui");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [userEmail, setUserEmail] = useState("");

  const fetchLogs = async () => {
    setLoading(true);
    setLogs([]);
    try {
      const queryParams = new URLSearchParams();
      if (fromDate) queryParams.append("from_date", fromDate);
      if (toDate) queryParams.append("to_date", toDate);
      if (userEmail) queryParams.append("user_email", userEmail);

      const response = await fetch(`${API_BASE}/api/logs/${activeTab}?${queryParams.toString()}`);
      const data = await response.json();
      if (data.success) {
        setLogs(data.logs);
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
          <label>From Date</label>
          <input 
            type="date" 
            className="log-input" 
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className="log-filter-group">
          <label>To Date</label>
          <input 
            type="date" 
            className="log-input" 
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        <div className="log-filter-group">
          <label>User Email</label>
          <input 
            type="text" 
            className="log-input" 
            placeholder="example@mirador.com"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
          />
        </div>
        <button className="log-btn-primary" onClick={fetchLogs}>Apply Filters</button>
      </div>

      <div className="logs-table-container">
        {loading ? (
          <div className="loading-spinner">Loading logs...</div>
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
                {logs.map((log, i) => (
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
    </div>
  );
}
