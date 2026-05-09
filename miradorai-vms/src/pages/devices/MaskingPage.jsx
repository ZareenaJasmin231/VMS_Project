import { useState, useEffect } from "react";
import MaskingSection from "./MaskingSection";
import "./MaskingPage.css";

const API = "http://192.168.126.200:8000";

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
    return <div className="masking-page-loading">Loading cameras...</div>;
  }

  return (
    <div className="masking-page-layout">
      {/* Left Sidebar: Camera List */}
      <aside className="masking-sidebar">
        <div className="masking-sidebar-header">
          <h3 className="masking-sidebar-title">Devices</h3>
          <span className="masking-count">{cameras.length}</span>
        </div>
        <div className="masking-sidebar-list">
          {cameras.map(cam => (
            <button
              key={cam.id}
              className={`masking-cam-item ${selectedCam?.id === cam.id ? "active" : ""}`}
              onClick={() => handleCamSelect(cam)}
            >
              <div className="masking-cam-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                </svg>
              </div>
              <div className="masking-cam-info">
                <div className="masking-cam-name">{cam.name || "Unnamed"}</div>
                <div className="masking-cam-ip">{cam.ip}</div>
              </div>
              {selectedCam?.id === cam.id && <div className="masking-active-indicator" />}
            </button>
          ))}
          {cameras.length === 0 && (
            <div className="masking-empty-state">No cameras found.</div>
          )}
        </div>
      </aside>

      {/* Main Content: Masking UI */}
      <main className="masking-main">
        {selectedCam ? (
          <div className="masking-page-container">
            <div className="masking-page-header">
              <div>
                <h1 className="masking-page-title">Privacy <span>Masking</span></h1>
                <p className="masking-page-desc">
                  {selectedCam.name || selectedCam.ip} · Configuration for burned-in privacy regions
                </p>
              </div>
            </div>
            
            <div className="masking-page-content">
              <MaskingSection device={selectedCam} showToast={showToast} />
            </div>
          </div>
        ) : (
          <div className="masking-page--empty">
          <div className="masking-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <path d="M8 8h8v8H8z" />
            </svg>
          </div>
          <p>Select a camera from the list on the left to start configuring privacy masks.</p>
          </div>
        )}
      </main>

      {toast && (
        <div className={`masking-toast masking-toast--${toast.type}`} key={toast.key}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}