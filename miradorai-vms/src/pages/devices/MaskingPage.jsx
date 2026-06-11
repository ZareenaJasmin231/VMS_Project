import { useState, useEffect, useCallback } from "react";
import MaskingSection from "./MaskingSection";
import "./MaskingPage.css";

const API = import.meta.env.VITE_API_URL;

export default function MaskingPage() {
  const [cameras, setCameras] = useState([]);
  const [selectedCam, setSelectedCam] = useState(null);
  const [maskCounts, setMaskCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const handleMasksChange = useCallback((ip, count) => {
    setMaskCounts(prev => {
      if (prev[ip] === count) return prev;
      return { ...prev, [ip]: count };
    });
  }, []);

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

    // Fetch initial mask counts for all cameras in parallel
    const fetchAllCounts = async () => {
      const counts = {};
      await Promise.all(
        devs.map(async (cam) => {
          try {
            const res = await fetch(`${API}/api/masks/${encodeURIComponent(cam.ip)}`);
            const data = await res.json();
            counts[cam.ip] = data.masks ? data.masks.length : 0;
          } catch (e) {
            console.error(`[MASKS] Failed to fetch count for ${cam.ip}:`, e);
            counts[cam.ip] = 0;
          }
        })
      );
      setMaskCounts(counts);
    };

    if (devs.length > 0) {
      fetchAllCounts();
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
      {/* Main Content: Masking UI */}
      <main className="mp-main">
        {selectedCam ? (
          <div className="masking-page-container">
            {/* Professional Top Bar */}

            <div className="mp-page-header">
              <div className="page-header__left">
                <h1 className="page-title">Masking <span>Regions</span></h1>
                <p className="page-desc" style={{ color: "rgba(255, 255, 255, 0.5)" }}>Configure privacy zones to permanently black out sensitive areas in the video feed.</p>
              </div>
              <div className="mp-device-pill">
                <div className="mp-device-dot" />
                <div className="mp-device-info">
                  <span className="mp-device-name">{selectedCam.name || selectedCam.ip}</span>
                  <span className="mp-device-ip" style={{ color: "rgba(255, 255, 255, 0.5)" }}>{selectedCam.ip}</span>
                </div>
              </div>
            </div>
            
            <div className="mp-content">
              <MaskingSection 
                device={selectedCam} 
                showToast={showToast} 
                onMasksChange={handleMasksChange}
              />
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
            <p style={{ color: "rgba(255, 255, 255, 0.5)" }}>Select a camera from the list on the right to start configuring privacy masks.</p>
          </div>
        )}
      </main>

      {/* Right Sidebar: Camera List */}
      <aside className="mp-sidebar">
        <div className="mp-sidebar-head">
          <h3 className="mp-sidebar-title" style={{ color: "rgba(255, 255, 255, 0.5)" }}>Devices</h3>
          <span className="mp-badge">{cameras.length}</span>
        </div>
        <div className="mp-sidebar-list">
          {cameras.map(cam => {
            const count = maskCounts[cam.ip] || 0;
            return (
              <button
                key={cam.id}
                className={`mp-cam-btn ${selectedCam?.id === cam.id ? "active" : ""}`}
                onClick={() => handleCamSelect(cam)}
              >
                <div className="mp-cam-info">
                  <div className="mp-cam-name">{cam.name || "Unnamed"}</div>
                  <div className="mp-cam-ip" style={{ color: "rgba(255, 255, 255, 0.5)" }}>{cam.ip}</div>
                </div>
                {count > 0 && (
                  <span className="mp-cam-mask-badge">
                    {count} {count === 1 ? "mask" : "masks"}
                  </span>
                )}
                {selectedCam?.id === cam.id && <div className="mp-active-bar" />}
              </button>
            );
          })}
          {cameras.length === 0 && (
            <div className="mp-sidebar-empty" style={{ color: "rgba(255, 255, 255, 0.5)" }}>No cameras found.</div>
          )}
        </div>
      </aside>

      {toast && (
        <div className={`mp-toast mp-toast--${toast.type}`} key={toast.key}>
          {toast.type === 'success' ? '' : ''}
          {toast.msg}
        </div>
      )}
    </div>
  );
}