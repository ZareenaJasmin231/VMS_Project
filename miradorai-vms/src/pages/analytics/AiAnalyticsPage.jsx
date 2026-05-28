import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import SplashScreen from "../../components/layout/SplashScreen";
import "./AiAnalyticsPage.css";

export default function AiAnalyticsPage() {
  const navigate = useNavigate();
  const [showSplash, setShowSplash] = useState(true);
  const [contentVisible, setContentVisible] = useState(false);

  const handleSplashDone = () => {
    window.location.href = "http://localhost:3000/login";
  };

  return (
    <>
      {showSplash && (
        <SplashScreen 
          onDone={handleSplashDone} 
          title="MIRADOR AI" 
          subtitle="ANALYTICS DASHBOARD" 
        />
      )}
      <div 
        className="ai-analytics-page"
        style={{ opacity: contentVisible ? 1 : 0, transition: "opacity 0.5s ease", display: showSplash ? "none" : "flex" }}
      >
        <div className="ai-analytics-header">
          <button className="back-btn" onClick={() => navigate(-1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back to Dashboard
          </button>
          <h1>MIRADOR AI ANALYTICS</h1>
        </div>
        
        <div className="ai-analytics-content">
          <div className="analytics-placeholder-card">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            <h2>Advanced AI Insights</h2>
            <p>This is the new Mirador AI Analytics dashboard. AI-driven metrics and visualizations will appear here.</p>
          </div>
        </div>
      </div>
    </>
  );
}
