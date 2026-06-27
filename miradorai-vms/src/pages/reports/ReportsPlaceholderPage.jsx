import React from "react";
import "./ReportsPlaceholderPage.css";

export default function ReportsPlaceholderPage({ reportName }) {
  return (
    <div className="page-shell reports-placeholder-shell">
      <div className="page-header">
        <h1 className="page-title">
          {reportName.split(" ")[0]} <span>{reportName.split(" ").slice(1).join(" ")}</span>
        </h1>
      </div>
      <div className="reports-placeholder-card card">
        <div className="reports-placeholder-icon-container">
          <svg className="reports-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <h2>Module Under Integration</h2>
        <p>
          The <strong>{reportName}</strong> is currently undergoing system integration.
          Real-time metrics, advanced filtering, and scheduling capabilities will be available in the next release.
        </p>
        <div className="reports-placeholder-badge">Enterprise Edition</div>
      </div>
    </div>
  );
}
