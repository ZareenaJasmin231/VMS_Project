import React, { useState, useEffect } from "react";
import { Mail, Trash2, Clock } from "lucide-react";
import "./EmailSchedulesPage.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:80";

const getAuthHeaders = () => {
  const token = localStorage.getItem("miradorai_token");
  return token ? { "Authorization": "Bearer " + token } : {};
};

const reportTypeMap = {
  alerts: "Camera Up/Down History",
  live_alerts: "Analytics Alerts",
  health: "Device Health & Uptime Status"
};

export default function EmailSchedulesPage() {
  const [schedules, setSchedules] = useState([]);
  const [schedulesLoading, setSchedulesLoading] = useState(true);
  const [scheduleRecipients, setScheduleRecipients] = useState("");
  const [scheduleType, setScheduleType] = useState("daily");
  const [scheduleReportType, setScheduleReportType] = useState("alerts");
  const [scheduleFormat, setScheduleFormat] = useState("pdf");
  const [scheduleSendTime, setScheduleSendTime] = useState("09:00");
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleSubmitMsg, setScheduleSubmitMsg] = useState("");

  const fetchSchedules = async () => {
    setSchedulesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reports/schedules`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSchedules(data.schedules || []);
        }
      }
    } catch (err) {
      console.error("Failed to fetch schedules:", err);
    } finally {
      setSchedulesLoading(false);
    }
  };

  const handleAddSchedule = async (e) => {
    e.preventDefault();
    if (!scheduleRecipients.trim()) {
      setScheduleSubmitMsg("Please enter at least one recipient email address.");
      return;
    }
    setScheduleSubmitMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/reports/schedules`, {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          report_type: scheduleReportType,
          schedule_type: scheduleType,
          recipients: scheduleRecipients.split(",").map(e => e.trim()).filter(e => e),
          format: scheduleFormat,
          send_time: scheduleSendTime,
          enabled: scheduleEnabled
        })
      });
      const data = await res.json();
      if (data.success) {
        setScheduleSubmitMsg("Schedule saved successfully!");
        setScheduleRecipients("");
        fetchSchedules();
      } else {
        setScheduleSubmitMsg(`Error: ${data.error}`);
      }
    } catch (err) {
      setScheduleSubmitMsg("Failed to save schedule.");
    }
  };

  const handleDeleteSchedule = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/reports/schedules/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (data.success) {
        fetchSchedules();
      }
    } catch (err) {
      console.error("Failed to delete schedule:", err);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, []);

  return (
    <div className="es-page">
      <div className="es-header">
        <h1 className="es-title">Email Schedules</h1>
      </div>

      <div className="es-content-layout">
        {/* Form to Add Schedule */}
        <div className="es-panel es-form-panel">
          <form onSubmit={handleAddSchedule} className="es-form">
            <h5 className="es-form-title">
              <Mail size={16} className="es-icon-teal" />
              <span>Add Email Schedule</span>
            </h5>
            
            <div className="es-form-field">
              <label>Recipient Email(s)</label>
              <input
                type="text"
                placeholder="e.g. admin@domain.com, manager@domain.com"
                className="es-input"
                value={scheduleRecipients}
                onChange={(e) => setScheduleRecipients(e.target.value)}
              />
              <span className="es-field-tip">Separate multiple emails with commas</span>
            </div>

            <div className="es-form-row">
              <div className="es-form-field">
                <label>Frequency</label>
                <select
                  value={scheduleType}
                  onChange={(e) => setScheduleType(e.target.value)}
                  className="es-select"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              
              <div className="es-form-field">
                <label>Send Time</label>
                <div className="es-time-input-wrapper">
                  <Clock size={14} className="es-time-icon" />
                  <input
                    type="time"
                    value={scheduleSendTime}
                    onChange={(e) => setScheduleSendTime(e.target.value)}
                    className="es-time-input"
                  />
                </div>
              </div>
            </div>

            <div className="es-form-row">
              <div className="es-form-field">
                <label>Report Type</label>
                <select
                  value={scheduleReportType}
                  onChange={(e) => setScheduleReportType(e.target.value)}
                  className="es-select"
                >
                  <option value="alerts">Camera Up/Down History</option>
                  <option value="live_alerts">Analytics Alerts</option>
                  <option value="health">Device Health & Uptime Status</option>
                </select>
              </div>

              <div className="es-form-field">
                <label>Attachment Format</label>
                <select
                  value={scheduleFormat}
                  onChange={(e) => setScheduleFormat(e.target.value)}
                  className="es-select"
                >
                  <option value="pdf">PDF</option>
                  <option value="xlsx">Excel (.xlsx)</option>
                  <option value="csv">CSV</option>
                </select>
              </div>
            </div>

            <div className="es-checkbox-field">
              <input
                type="checkbox"
                id="scheduleEnabled"
                checked={scheduleEnabled}
                onChange={(e) => setScheduleEnabled(e.target.checked)}
                className="es-checkbox"
              />
              <label htmlFor="scheduleEnabled">Enable Schedule</label>
            </div>

            <button type="submit" className="es-btn-primary">
              Save Schedule
            </button>

            {scheduleSubmitMsg && (
              <div className={`es-submit-msg ${scheduleSubmitMsg.includes("successfully") ? "success" : "error"}`}>
                {scheduleSubmitMsg}
              </div>
            )}
          </form>
        </div>

        {/* List of Active Schedules */}
        <div className="es-panel es-list-panel">
          <h5 className="es-list-title">Active Report Schedules</h5>
          
          {schedulesLoading ? (
            <div className="es-loading">Loading schedules...</div>
          ) : schedules.length === 0 ? (
            <div className="es-empty-state">
              No automated report schedules configured yet.
            </div>
          ) : (
            <div className="es-list">
              {schedules.map(sch => (
                <div key={sch.id} className="es-list-item">
                  <div className="es-item-details">
                    <div className="es-item-header">
                      <span className={`es-status-tag ${sch.enabled ? "enabled" : "disabled"}`}>
                        {sch.enabled ? "Enabled" : "Disabled"}
                      </span>
                      <span className="es-item-report-type">
                        {reportTypeMap[sch.report_type] || sch.report_type}
                      </span>
                    </div>
                    <div className="es-item-freq-info">
                      Sent <strong className="es-highlight">{sch.schedule_type}</strong> at <strong className="es-highlight">{sch.send_time || "09:00"}</strong> in <strong className="es-highlight">{sch.format?.toUpperCase()}</strong> format
                    </div>
                    <div className="es-item-recipients">
                      To: {sch.recipients?.join(", ")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteSchedule(sch.id)}
                    className="es-btn-delete"
                    title="Delete schedule"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
