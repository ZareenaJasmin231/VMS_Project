import React, { useState } from "react";
import "./DatasheetModal.css";

const sections = [
  { id: "dashboard", title: "Dashboard", icon: "dashboard" },
  { id: "live", title: "Live View", icon: "live" },
  { id: "map", title: "Map View", icon: "map" },
  { id: "playback", title: "Playback", icon: "playback" },
  { id: "designer", title: "Designer View", icon: "designer" },
  { id: "infra", title: "Infrastructure", icon: "infra" },
  { id: "settings", title: "Settings", icon: "settings" },
];

export default function DatasheetModal({ onClose }) {
  const [activeTab, setActiveTab] = useState("dashboard");

  const renderIcon = (iconName) => {
    switch (iconName) {
      case "dashboard": return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>;
      case "live": return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>;
      case "map": return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>;
      case "playback": return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M10 8l6 4-6 4z"/></svg>;
      case "designer": return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8v8H8z"/><path d="M3 12h5M16 12h5"/></svg>;
      case "infra": return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6" y2="6"/><line x1="6" y1="18" x2="6" y2="18"/><path d="M12 10v4M12 10h4M12 14h4"/></svg>;
      case "settings": return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
      default: return null;
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return (
          <div className="ds-anim-container">
            <p className="ds-simple-desc">View system health and high-level statistics.</p>
            <div className="ds-scene">
              <div className="ds-box" style={{width: '60%', height: '100px', top: '10px', left: '10px'}} />
              <div className="ds-box" style={{width: '30%', height: '100px', top: '10px', right: '10px'}} />
              <div className="ds-box" style={{width: '95%', height: '120px', bottom: '10px', left: '10px'}} />
              <div className="ds-cursor ds-anim-dashboard" />
            </div>
          </div>
        );
      case "live":
        return (
          <div className="ds-anim-container">
            <p className="ds-simple-desc">Monitor live cameras. Click grid to change layout, double click to expand.</p>
            <div className="ds-scene">
              <div className="ds-live-grid">
                <div className="ds-box ds-cam" />
                <div className="ds-box ds-cam" />
                <div className="ds-box ds-cam" />
                <div className="ds-box ds-cam" />
              </div>
              <div className="ds-cursor ds-anim-live" />
            </div>
          </div>
        );
      case "map":
        return (
          <div className="ds-anim-container">
            <p className="ds-simple-desc">View cameras on a geographic map. Click pins to see feed.</p>
            <div className="ds-scene">
              <div className="ds-map-bg" />
              <div className="ds-pin" style={{top: '30%', left: '40%'}} />
              <div className="ds-pin" style={{top: '60%', left: '70%'}} />
              <div className="ds-map-popup" />
              <div className="ds-cursor ds-anim-map" />
            </div>
          </div>
        );
      case "playback":
        return (
          <div className="ds-anim-container">
            <p className="ds-simple-desc">Search historical video. Drag timeline to find events.</p>
            <div className="ds-scene">
              <div className="ds-box" style={{width: '90%', height: '140px', top: '10px', left: '5%'}} />
              <div className="ds-timeline-wrap">
                <div className="ds-timeline-bar" />
                <div className="ds-timeline-head" />
              </div>
              <div className="ds-cursor ds-anim-playback" />
            </div>
          </div>
        );
      case "designer":
        return (
          <div className="ds-anim-container">
            <p className="ds-simple-desc">Create custom layouts. Drag and drop cameras into grid cells.</p>
            <div className="ds-scene">
              <div className="ds-sidebar-list">
                <div className="ds-list-item" />
                <div className="ds-list-item ds-drag-item" />
              </div>
              <div className="ds-designer-grid">
                <div className="ds-grid-cell" />
                <div className="ds-grid-cell" />
              </div>
              <div className="ds-cursor ds-anim-designer" />
            </div>
          </div>
        );
      case "infra":
        return (
          <div className="ds-anim-container">
            <p className="ds-simple-desc">Manage servers and system resources.</p>
            <div className="ds-scene">
              <div className="ds-server" style={{top: '20px'}} />
              <div className="ds-server" style={{top: '80px'}} />
              <div className="ds-server" style={{top: '140px'}} />
              <div className="ds-cursor ds-anim-infra" />
            </div>
          </div>
        );
      case "settings":
        return (
          <div className="ds-anim-container">
            <p className="ds-simple-desc">Configure system options, add devices, and manage users.</p>
            <div className="ds-scene">
              <div className="ds-sidebar-list" style={{width: '100px'}}>
                <div className="ds-list-item" style={{width: '80px'}} />
                <div className="ds-list-item" style={{width: '80px'}} />
                <div className="ds-list-item" style={{width: '80px'}} />
              </div>
              <div className="ds-box" style={{left: '120px', width: '250px', height: '200px', top: '10px'}}>
                 <div className="ds-toggle-switch" />
              </div>
              <div className="ds-cursor ds-anim-settings" />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="datasheet-overlay">
      <div className="datasheet-modal">
        <div className="datasheet-sidebar">
          <div className="datasheet-sidebar-header">
            <h2>Datasheet</h2>
          </div>
          <div className="datasheet-nav">
            {sections.map((sec) => (
              <button
                key={sec.id}
                className={`datasheet-nav-item ${activeTab === sec.id ? "active" : ""}`}
                onClick={() => setActiveTab(sec.id)}
              >
                <div className="ds-nav-icon">{renderIcon(sec.icon)}</div>
                {sec.title}
              </button>
            ))}
          </div>
        </div>
        <div className="datasheet-content">
          <div className="datasheet-header">
            <h1>{sections.find((s) => s.id === activeTab)?.title}</h1>
            <button className="datasheet-close-btn" onClick={onClose} title="Close Manual">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div className="datasheet-body">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
