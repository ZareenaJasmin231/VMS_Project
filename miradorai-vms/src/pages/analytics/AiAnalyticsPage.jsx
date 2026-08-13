import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import SplashScreen from "../../components/layout/SplashScreen";
import "./AiAnalyticsPage.css";

export default function AiAnalyticsPage() {
  const navigate = useNavigate();
  const [showSplash, setShowSplash] = useState(true);
  const [contentVisible, setContentVisible] = useState(false);

  const handleSplashDone = () => {
    setShowSplash(false);
    setContentVisible(true);
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
        <div className="ai-analytics-content">
          <iframe 
            src="http://192.168.126.201:3000/dashboard" 
            title="MIRADOR AI Analytics Dashboard"
            className="ai-analytics-iframe"
          />
        </div>
      </div>
    </>
  );
}
