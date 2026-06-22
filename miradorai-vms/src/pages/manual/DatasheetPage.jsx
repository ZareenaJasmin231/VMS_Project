import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./DatasheetPage.css";

const SECTIONS = [
  { id: "dashboard", title: "Dashboard", icon: "dashboard" },
  { id: "live", title: "Live View", icon: "live" },
  { id: "map", title: "Map View", icon: "map" },
  { id: "playback", title: "Playback", icon: "playback" },
  { id: "designer", title: "Designer View", icon: "designer" },
  { id: "infra", title: "Infrastructure", icon: "infra" },
  { id: "settings", title: "Settings", icon: "settings" },
];

export default function DatasheetPage() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const navigate = useNavigate();

  useEffect(() => {
    // Scroll to top on tab change
    const contentArea = document.querySelector('.dsp-main-content');
    if (contentArea) contentArea.scrollTo(0, 0);
  }, [activeTab]);

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
          <div className="dsp-section">
            <div className="dsp-animation-wrap">
              <div className="dsp-anim-dashboard">
                <div className="dsp-db-card" style={{top: '20px', left: '20px', width: '200px'}}></div>
                <div className="dsp-db-card" style={{top: '20px', left: '240px', width: '200px'}}></div>
                <div className="dsp-db-card" style={{top: '20px', left: '460px', width: '200px'}}></div>
                <div className="dsp-db-card" style={{top: '120px', left: '20px', width: '420px', height: '200px'}}>
                  <div className="dsp-db-chart-bar" style={{height: '60%', left: '20px'}}></div>
                  <div className="dsp-db-chart-bar" style={{height: '80%', left: '50px'}}></div>
                  <div className="dsp-db-chart-bar" style={{height: '40%', left: '80px'}}></div>
                  <div className="dsp-db-chart-bar" style={{height: '90%', left: '110px'}}></div>
                </div>
                <div className="dsp-db-card" style={{top: '120px', left: '460px', width: '200px', height: '200px'}}>
                  <div className="dsp-db-donut"></div>
                </div>
                <div className="dsp-cursor dsp-cursor-dash"></div>
              </div>
            </div>
            <h2>Dashboard</h2>
            <p>The Dashboard is the central hub for monitoring the overall health and status of your Video Management System.</p>
            
            <div className="dsp-step-list">
              <div className="dsp-step">
                <span className="dsp-step-num">1</span>
                <div>
                  <strong>View System Metrics</strong>
                  <p>At the top of the dashboard, you will find KPI cards displaying the total number of connected cameras, active alerts, and overall system status. Click any card to refresh its specific metric.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">2</span>
                <div>
                  <strong>Analyze Resource Usage</strong>
                  <p>The donut chart displays CPU and RAM usage for your main recording server. If usage exceeds 90%, the ring will turn red, indicating a potential bottleneck.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">3</span>
                <div>
                  <strong>Review Storage Health</strong>
                  <p>The bar chart visualizes available storage space across your configured drives. Hover over each bar to see exact byte values and estimated retention days remaining.</p>
                </div>
              </div>
            </div>
          </div>
        );

      case "live":
        return (
          <div className="dsp-section">
            <div className="dsp-animation-wrap">
              <div className="dsp-anim-live">
                <div className="dsp-lv-topbar">
                  <div className="dsp-lv-grid-btn"></div>
                  <div className="dsp-lv-dropdown">
                    <div className="dsp-lv-dd-item"></div>
                    <div className="dsp-lv-dd-item"></div>
                  </div>
                </div>
                <div className="dsp-lv-grid">
                  <div className="dsp-lv-cam"></div>
                  <div className="dsp-lv-cam"></div>
                  <div className="dsp-lv-cam"></div>
                  <div className="dsp-lv-cam"></div>
                </div>
                <div className="dsp-lv-alert-panel">
                   <div className="dsp-lv-alert-card"></div>
                   <div className="dsp-lv-alert-card"></div>
                </div>
                <div className="dsp-cursor dsp-cursor-live"></div>
              </div>
            </div>
            <h2>Live View</h2>
            <p>The Live View page allows you to monitor real-time feeds from all connected cameras and interact with active alerts.</p>
            
            <div className="dsp-step-list">
              <div className="dsp-step">
                <span className="dsp-step-num">1</span>
                <div>
                  <strong>Change Grid Layout</strong>
                  <p>Click the Grid icon in the top right of the stream area to open the layout dropdown. Select from 2x2, 3x3, 4x4, or up to 8x8 grids depending on your monitor size and camera count.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">2</span>
                <div>
                  <strong>Maximize Camera Stream</strong>
                  <p>Double-click anywhere inside a camera's video feed to maximize it to full screen. Double-click again, or press Esc, to return to the grid layout.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">3</span>
                <div>
                  <strong>Interact with Alerts</strong>
                  <p>When an AI or Motion event occurs, a badge appears on the camera cell, and an alert card slides into the side panel. Click the 'View' button on the alert card to play a 10-second clip of the event in a pop-up window.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">4</span>
                <div>
                  <strong>PTZ Controls</strong>
                  <p>For PTZ-capable cameras, hover over the video feed to reveal the directional arrows. Click and hold the arrows to pan/tilt, and use the scroll wheel to zoom.</p>
                </div>
              </div>
            </div>
          </div>
        );

      case "map":
        return (
          <div className="dsp-section">
            <div className="dsp-animation-wrap">
              <div className="dsp-anim-map">
                <div className="dsp-map-bg"></div>
                <div className="dsp-map-pin" style={{top: '30%', left: '40%'}}></div>
                <div className="dsp-map-pin" style={{top: '60%', left: '70%'}}></div>
                <div className="dsp-map-popup">
                  <div className="dsp-map-popup-video"></div>
                </div>
                <div className="dsp-cursor dsp-cursor-map"></div>
              </div>
            </div>
            <h2>Map View</h2>
            <p>Map View provides spatial awareness by mapping cameras to floor plans or geographic maps.</p>
            
            <div className="dsp-step-list">
              <div className="dsp-step">
                <span className="dsp-step-num">1</span>
                <div>
                  <strong>Upload a Floor Plan</strong>
                  <p>Click 'Upload Map' in the top right. Select a JPG or PNG file of your facility's floor plan. The map will be saved and synchronized across all viewing stations.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">2</span>
                <div>
                  <strong>Place Camera Pins</strong>
                  <p>Drag a camera from the left sidebar onto the map. The pin will drop where you release the mouse. You can click and drag existing pins to reposition them.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">3</span>
                <div>
                  <strong>Preview Camera Feed</strong>
                  <p>Single-click any red pin on the map to open a Picture-in-Picture (PiP) popup displaying the live feed for that specific camera.</p>
                </div>
              </div>
            </div>
          </div>
        );

      case "playback":
        return (
          <div className="dsp-section">
            <div className="dsp-animation-wrap">
              <div className="dsp-anim-playback">
                <div className="dsp-pb-player"></div>
                <div className="dsp-pb-sidebar">
                  <div className="dsp-pb-cal"></div>
                  <div className="dsp-pb-cam-list"></div>
                </div>
                <div className="dsp-pb-timeline-area">
                  <div className="dsp-pb-timeline-bar">
                    <div className="dsp-pb-marker red" style={{left: '20%'}}></div>
                    <div className="dsp-pb-marker teal" style={{left: '50%'}}></div>
                    <div className="dsp-pb-marker red" style={{left: '80%'}}></div>
                    <div className="dsp-pb-scrubber"></div>
                  </div>
                </div>
                <div className="dsp-cursor dsp-cursor-playback"></div>
              </div>
            </div>
            <h2>Playback & Video Search</h2>
            <p>Access historical video recordings, search for AI events, and export video clips.</p>
            
            <div className="dsp-step-list">
              <div className="dsp-step">
                <span className="dsp-step-num">1</span>
                <div>
                  <strong>Select Camera and Date</strong>
                  <p>In the left sidebar, click on a camera from the list. Then, click a highlighted date on the calendar. Highlighted dates indicate available recorded footage.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">2</span>
                <div>
                  <strong>Navigate the Timeline</strong>
                  <p>The timeline at the bottom represents 24 hours. Click anywhere on the timeline to jump to that time. Click and drag left or right to pan through time.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">3</span>
                <div>
                  <strong>Analyze Event Markers</strong>
                  <p>Look for colored vertical lines on the timeline. Red lines represent AI alerts (e.g., person detected), and Teal lines represent standard motion. Click a marker to instantly jump to the event.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">4</span>
                <div>
                  <strong>Export Video Clips</strong>
                  <p>Click the 'Export' scissor icon. Drag the left and right brackets on the timeline to define your clip duration (up to 1 hour). Click 'Save' to download an MP4.</p>
                </div>
              </div>
            </div>
          </div>
        );

      case "designer":
        return (
          <div className="dsp-section">
            <div className="dsp-animation-wrap">
              <div className="dsp-anim-designer">
                <div className="dsp-des-sidebar">
                  <div className="dsp-des-item" style={{top:'10px'}}>Camera A</div>
                  <div className="dsp-des-item dsp-des-drag" style={{top:'50px'}}>Camera B</div>
                  <div className="dsp-des-item" style={{top:'90px'}}>Camera C</div>
                </div>
                <div className="dsp-des-grid">
                  <div className="dsp-des-cell" style={{top:0, left:0}}></div>
                  <div className="dsp-des-cell dsp-des-cell-active" style={{top:0, left:'160px'}}></div>
                  <div className="dsp-des-cell" style={{top:'110px', left:0}}></div>
                  <div className="dsp-des-cell" style={{top:'110px', left:'160px'}}></div>
                </div>
                <div className="dsp-cursor dsp-cursor-designer"></div>
              </div>
            </div>
            <h2>Designer View</h2>
            <p>Create completely custom layouts by dragging cameras into defined grid spaces.</p>
            
            <div className="dsp-step-list">
              <div className="dsp-step">
                <span className="dsp-step-num">1</span>
                <div>
                  <strong>Add Grid Cells</strong>
                  <p>Click the '+' button in the designer workspace to add a new empty grid cell. You can resize cells by dragging their bottom-right corner.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">2</span>
                <div>
                  <strong>Assign Cameras</strong>
                  <p>Click and hold a camera from the left sidebar. Drag it over an empty grid cell. The cell will highlight green. Release the mouse to assign the camera.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">3</span>
                <div>
                  <strong>Save Layout Preset</strong>
                  <p>Once your layout is complete, type a name in the 'Layout Name' input box at the top and click 'Save Layout'. This layout is now available in the Live View dropdown.</p>
                </div>
              </div>
            </div>
          </div>
        );

      case "infra":
        return (
          <div className="dsp-section">
            <div className="dsp-animation-wrap">
              <div className="dsp-anim-infra">
                <div className="dsp-inf-server">
                  <div className="dsp-inf-status pulse-green"></div>
                  Main Server (192.168.1.100)
                </div>
                <div className="dsp-inf-server">
                  <div className="dsp-inf-status pulse-green"></div>
                  Failover Node (192.168.1.101)
                </div>
                <div className="dsp-inf-server">
                  <div className="dsp-inf-status pulse-red"></div>
                  Storage Node (Disconnected)
                </div>
                <div className="dsp-inf-line line-1"></div>
                <div className="dsp-inf-line line-2"></div>
                <div className="dsp-cursor dsp-cursor-infra"></div>
              </div>
            </div>
            <h2>Infrastructure & Topology</h2>
            <p>Monitor the health of servers, storage nodes, and viewing stations across your distributed deployment.</p>
            
            <div className="dsp-step-list">
              <div className="dsp-step">
                <span className="dsp-step-num">1</span>
                <div>
                  <strong>Check Node Status</strong>
                  <p>The topology map shows all connected servers. A pulsing green dot indicates healthy communication. A red dot indicates a disconnected or failing node.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">2</span>
                <div>
                  <strong>Restart Services</strong>
                  <p>Right-click any server node to open the context menu. Select 'Restart VMS Service' to remotely restart the backend process if a server is unresponsive.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">3</span>
                <div>
                  <strong>Configure Failover</strong>
                  <p>Click the 'Failover Rules' button to configure which cameras should automatically migrate to a secondary server if the primary server goes offline.</p>
                </div>
              </div>
            </div>
          </div>
        );

      case "settings":
        return (
          <div className="dsp-section">
            <div className="dsp-animation-wrap">
              <div className="dsp-anim-settings">
                <div className="dsp-set-sidebar">
                  <div className="dsp-set-tab active">Device Mgmt</div>
                  <div className="dsp-set-tab">Storage</div>
                  <div className="dsp-set-tab">Users</div>
                  <div className="dsp-set-tab">Masking</div>
                </div>
                <div className="dsp-set-content">
                  <div className="dsp-set-field"></div>
                  <div className="dsp-set-field"></div>
                  <div className="dsp-set-toggle">
                    <div className="dsp-set-toggle-knob"></div>
                  </div>
                  <div className="dsp-set-btn">Save Config</div>
                </div>
                <div className="dsp-cursor dsp-cursor-settings"></div>
              </div>
            </div>
            <h2>Settings & Configuration</h2>
            <p>Administrators manage all system configurations, devices, users, and security settings here.</p>
            
            <div className="dsp-step-list">
              <div className="dsp-step">
                <span className="dsp-step-num">1</span>
                <div>
                  <strong>Add a New Camera</strong>
                  <p>Navigate to 'Device Management'. Click 'ONVIF Discover' to automatically find cameras on the network, or click 'Manual Add' to input an RTSP URL, IP, username, and password.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">2</span>
                <div>
                  <strong>Configure Storage Retention</strong>
                  <p>Navigate to 'Storage Management'. Select a drive, input the maximum quota (in GB), and enable the 'Auto-Delete Oldest Video' toggle switch to prevent the drive from filling up.</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">3</span>
                <div>
                  <strong>Create a New User</strong>
                  <p>Navigate to 'User Management'. Click 'Add User', enter an email and password. Assign a role: 'Admin' (full access), 'Operator' (live view and playback), or 'Client' (live view only).</p>
                </div>
              </div>
              <div className="dsp-step">
                <span className="dsp-step-num">4</span>
                <div>
                  <strong>Draw Privacy Masks</strong>
                  <p>Navigate to 'Privacy Masking'. Select a camera, then click and drag on the video preview to draw black rectangles over sensitive areas (like keypads or private property). Click 'Save Masks'.</p>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="dsp-page">
      <div className="dsp-sidebar">
        <div className="dsp-sidebar-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="28" height="28" style={{color: '#14b8a6'}}>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          <h2>VMS Manual</h2>
        </div>
        
        <button 
          className="dsp-back-btn" 
          onClick={() => navigate('/dashboard')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back to VMS
        </button>

        <div className="dsp-nav">
          {SECTIONS.map((sec) => (
            <button
              key={sec.id}
              className={`dsp-nav-item ${activeTab === sec.id ? "active" : ""}`}
              onClick={() => setActiveTab(sec.id)}
            >
              <div className="dsp-nav-icon">{renderIcon(sec.icon)}</div>
              {sec.title}
            </button>
          ))}
        </div>
      </div>
      <div className="dsp-main-content">
        <div className="dsp-header-banner">
          <h1>User Manual: {SECTIONS.find((s) => s.id === activeTab)?.title}</h1>
          <p>Exhaustive step-by-step guide and exact UI demonstration</p>
        </div>
        <div className="dsp-body">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
