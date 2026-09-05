import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import SplashScreen from "../../components/layout/SplashScreen";
import "./AiAnalyticsPage.css";

export default function AiAnalyticsPage() {
  const navigate = useNavigate();
  const [showSplash, setShowSplash] = useState(true);
  const [contentVisible, setContentVisible] = useState(false);
  const [externalAiIp, setExternalAiIp] = useState("192.168.126.35");

  useEffect(() => {
    const fetchAiIp = async () => {
      try {
        const token = localStorage.getItem('miradorai_token') || localStorage.getItem('token');
        const API_BASE = import.meta.env.VITE_API_URL || "";
        const res = await fetch(API_BASE + "/api/integrations", {
          headers: token ? { Authorization: 'Bearer ' + token } : {},
        });
        if (res.ok) {
          const data = await res.json();
          const aiInt = data.find(i => i.isActive && (i.type.toLowerCase().includes('ai') || i.serverName.toLowerCase().includes('ai')));
          if (aiInt && aiInt.serverIp) {
            setExternalAiIp(aiInt.serverIp.split(':')[0]);
          } else {
            const anyActive = data.find(i => i.isActive && i.serverIp);
            if (anyActive) setExternalAiIp(anyActive.serverIp.split(':')[0]);
          }
        }
      } catch (e) {
        console.error("Failed to fetch integration IP", e);
      }
    };
    fetchAiIp();
  }, []);

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
            src={`http://${externalAiIp}:3000/dashboard`} 
            title="MIRADOR AI Analytics Dashboard"
            className="ai-analytics-iframe"
          />
        </div>
      </div>
    </>
  );
}
