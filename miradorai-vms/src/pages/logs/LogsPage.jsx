import React, { useState, useEffect } from "react";
import "./LogsPage.css";

const API_BASE = import.meta.env.VITE_API_URL;
const WS_BASE = import.meta.env.VITE_WS_URL;
export default function LogsPage() {
  const [activeTab, setActiveTab] = useState("ui");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [category, setCategory] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const logsPerPage = 15;

  const fetchLogs = async () => {
    setLoading(true);
    setLogs([]);
    try {
      const queryParams = new URLSearchParams();
      if (fromDate) {
        const [y, m, d] = fromDate.split("-");
        const startOfDay = new Date(y, m - 1, d, 0, 0, 0, 0);
        queryParams.append("from_date", startOfDay.toISOString());
      }
      if (toDate) {
        const [y, m, d] = toDate.split("-");
        const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);
        queryParams.append("to_date", endOfDay.toISOString());
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
    const ws = new WebSocket(`${WS_BASE}/ws/logs`);
    ws.onmessage = (event) => {
      const newLog = JSON.parse(event.data);
      // 🔥 Add new log on top
      setLogs(prev => [newLog, ...prev]);
    };
    return () => ws.close();
  }, []);

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
        {activeTab === "ui" && (
          <div className="log-filter-group">
            <label>Category</label>
            <select 
              className="log-input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All Categories</option>
              <option value="auth">Auth</option>
              <option value="navigation">Navigation</option>
              <option value="devices">Devices</option>
              <option value="settings">Settings</option>
              <option value="system">System</option>
              <option value="recording">Recording</option>
            </select>
          </div>
        )}
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
    </div>
  );
}