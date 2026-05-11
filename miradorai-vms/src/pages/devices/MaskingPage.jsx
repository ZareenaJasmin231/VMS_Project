import { useState, useEffect } from "react";
import MaskingSection from "./MaskingSection";
import "./MaskingPage.css";

const API = import.meta.env.VITE_API_URL;
const WS_BASE = import.meta.env.VITE_WS_URL;
export default function MaskingPage() {
  const [cameras, setCameras] = useState([]);
  const [selectedCam, setSelectedCam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    // Load devices from localStorage
    const saved = localStorage.getItem("miradorai_devices");
    const devs = saved ? JSON.parse(saved) : [];
    setCameras(devs);
    
    // Auto-select first camera if available or use the one from localStorage
    const lastId = localStorage.getItem("miradorai_selected_camera_id");
    const lastCam = devs.find(d => String(d.id) === String(lastId));
    
    if (lastCam) {
      setSelectedCam(lastCam);
    } else if (devs.length > 0) {
      setSelectedCam(devs[0]);
    }
    setLoading(false);
  }, []);

  const handleCamSelect = (cam) => {
    setSelectedCam(cam);
    localStorage.setItem("miradorai_selected_camera_id", cam.id);
  };

  const showToast = (msg, type = "info") => {
    setToast({ msg, type, key: Date.now() });
    setTimeout(() => setToast(null), 3000);
  };

  if (loading) {
    return <div className="mp-loading-screen">Initializing Vision Systems…</div>;
  }

  return (
    <div className="mp-layout">
      {/* Left Sidebar: Camera List */}
      <aside className="mp-sidebar">
        <div className="mp-sidebar-head">
          <h3 className="mp-sidebar-title">Devices</h3>
          <span className="mp-badge">{cameras.length}</span>
        </div>
        <div className="mp-sidebar-list">
          {cameras.map(cam => (
            <button
              key={cam.id}
              className={`mp-cam-btn ${selectedCam?.id === cam.id ? "active" : ""}`}
              onClick={() => handleCamSelect(cam)}
            >
              <div className="mp-cam-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                </svg>
              </div>
              <div className="mp-cam-info">
                <div className="mp-cam-name">{cam.name || "Unnamed"}</div>
                <div className="mp-cam-ip">{cam.ip}</div>
              </div>
              {selectedCam?.id === cam.id && <div className="mp-active-bar" />}
            </button>
          ))}
          {cameras.length === 0 && (
            <div className="mp-sidebar-empty">No cameras found.</div>
          )}
        </div>
      </aside>

      {/* Main Content: Masking UI */}
      <main className="mp-main">
        {selectedCam ? (
          <div className="mp-container">
            {/* Professional Top Bar */}
            <div className="mp-topbar">
              <div className="mp-breadcrumb">
                Mirador VMS
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.3, margin: '0 8px' }}>
                  <path d="m9 18 6-6-6-6" />
                </svg>
                <span className="mp-breadcrumb-active">Masking</span>
              </div>
              <div className="mp-status-pill">
                <div className="mp-status-dot green" />
                <span>Streaming Active</span>
              </div>
            </div>

            <div className="mp-page-header">
              <div>
                <div className="mp-eyebrow">Privacy Configuration</div>
                <h1 className="mp-title">Masking <span>Regions</span></h1>
              </div>
              <div className="mp-device-pill">
                <div className="mp-device-dot" />
                <div className="mp-device-info">
                  <span className="mp-device-name">{selectedCam.name || selectedCam.ip}</span>
                  <span className="mp-device-ip">{selectedCam.ip}</span>
                </div>
              </div>
            </div>
            
            <div className="mp-content">
              <MaskingSection device={selectedCam} showToast={showToast} />
            </div>
          </div>
        ) : (
          <div className="mp-empty-state">
            <div className="mp-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.2 }}>
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <path d="M8 8h8v8H8z" />
              </svg>
            </div>
            <p>Select a camera from the list on the left to start configuring privacy masks.</p>
          </div>
        )}
      </main>

      {toast && (
        <div className={`mp-toast mp-toast--${toast.type}`} key={toast.key}>
          {toast.type === 'success' ? '✅ ' : '❌ '}
          {toast.msg}
        </div>
      )}
    </div>
  );
}