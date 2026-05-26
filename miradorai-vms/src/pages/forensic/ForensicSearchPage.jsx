import { useState, useEffect, useRef, useCallback } from "react";
import "./ForensicSearchPage.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const DEFAULT_CAMERAS = [
  { id: "entrance_dome_1",  name: "Entrance Dome 1",    type: "dome"   },
  { id: "entrance_dome_2",  name: "Entrance Dome 2",    type: "dome"   },
  { id: "hallway_wall",     name: "Corridor Wall",      type: "bullet" },
  { id: "lobby_room_1",     name: "Lobby Room 1",       type: "dome"   },
  { id: "office_room_2",    name: "Office Room 2",      type: "dome"   },
  { id: "conf_room_3",      name: "Conference Room 3",  type: "dome"   },
  { id: "breakroom_room_4", name: "Breakroom Room 4",   type: "dome"   },
];

const COLORS = [
  { name: "white",  hex: "#f8fafc", textDark: true  },
  { name: "black",  hex: "#0f172a", textDark: false },
  { name: "gray",   hex: "#64748b", textDark: false },
  { name: "red",    hex: "#ef4444", textDark: false },
  { name: "orange", hex: "#f97316", textDark: false },
  { name: "yellow", hex: "#eab308", textDark: true  },
  { name: "green",  hex: "#22c55e", textDark: false },
  { name: "blue",   hex: "#3b82f6", textDark: false },
  { name: "purple", hex: "#a855f7", textDark: false },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAuthHeaders() {
  const token = localStorage.getItem("miradorai_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Build an authenticated API URL.
 * Appends token as a query param only if a token exists (safe for <video src> and <img src>).
 */
function authUrl(path) {
  const token = localStorage.getItem("miradorai_token");
  const separator = path.includes("?") ? "&" : "?";
  return token
    ? `${API_BASE}${path}${separator}token=${encodeURIComponent(token)}`
    : `${API_BASE}${path}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CameraIcon({ type, size = 18 }) {
  if (type === "bullet") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2">
        <rect x="2" y="7" width="20" height="10" rx="2"/>
        <path d="M6 17v2M18 17v2M6 7V5M18 7V5"/>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M12 22a10 10 0 0 0 10-10H2a10 10 0 0 0 10 10z"/>
      <circle cx="12" cy="8" r="4"/>
    </svg>
  );
}

function ColorDot({ name }) {
  const c = COLORS.find(x => x.name === name);
  if (!c) return <span className="color-label">{name}</span>;
  return (
    <span
      className="color-dot"
      title={name}
      style={{ background: c.hex, border: name === "white" ? "1px solid #334155" : "none" }}
    />
  );
}

/**
 * Detection card thumbnail — loads from /video/thumbnail endpoint.
 * On error, shows the SVG silhouette inline so the card never breaks.
 */
function DetectionThumbnail({ detectionId, appearance }) {
  const [failed, setFailed] = useState(false);
  const top    = appearance?.top_color_name    || "white";
  const bottom = appearance?.bottom_color_name || "blue";

  const CSS_COLORS = {
    white: "#F8FAFC", black: "#0F172A", gray: "#64748B",
    red: "#EF4444", orange: "#F97316", yellow: "#EAB308",
    green: "#22C55E", blue: "#3B82F6", purple: "#A855F7",
  };
  const topHex = CSS_COLORS[top]    || "#F8FAFC";
  const botHex = CSS_COLORS[bottom] || "#3B82F6";

  if (failed) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        className="card-thumbnail-svg"
      >
        <rect width="100" height="100" fill="#1E293B" rx="0"/>
        <circle cx="50" cy="28" r="14" fill="#CBD5E1"/>
        <path d="M22,78 C22,52 78,52 78,78 L68,78 L68,56 L32,56 L32,78 Z" fill={topHex}/>
        <path d="M32,78 L46,78 L46,98 L32,98 Z" fill={botHex}/>
        <path d="M54,78 L68,78 L68,98 L54,98 Z" fill={botHex}/>
        {/* corner brackets */}
        <path d="M8,22 L8,8 L22,8"  stroke="#38BDF8" strokeWidth="2.5" fill="none"/>
        <path d="M92,22 L92,8 L78,8" stroke="#38BDF8" strokeWidth="2.5" fill="none"/>
        <path d="M8,78 L8,92 L22,92" stroke="#38BDF8" strokeWidth="2.5" fill="none"/>
        <path d="M92,78 L92,92 L78,92" stroke="#38BDF8" strokeWidth="2.5" fill="none"/>
      </svg>
    );
  }

  return (
    <img
      src={authUrl(`/api/forensic/video/thumbnail?detection_id=${detectionId}`)}
      alt="Detection snapshot"
      className="card-thumbnail-img"
      onError={() => setFailed(true)}
    />
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ForensicSearchPage() {
  // Filter state
  const [startDate,    setStartDate]    = useState("");
  const [endDate,      setEndDate]      = useState("");
  const [selectedCams, setSelectedCams] = useState({});
  const [objectType,   setObjectType]   = useState("person");
  const [topColor,     setTopColor]     = useState("any");
  const [bottomColor,  setBottomColor]  = useState("any");
  const [gender,       setGender]       = useState("any");
  const [bag,          setBag]          = useState("any");

  // Data state
  const [camerasList,  setCamerasList]  = useState([]);
  const [results,      setResults]      = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [statusData,   setStatusData]   = useState(null);

  // Tracking workspace state
  const [activeTrack,  setActiveTrack]  = useState(null);
  const [trackLoading, setTrackLoading] = useState(false);

  // Video player state
  const [playbackMode, setPlaybackMode] = useState("unified"); // "unified" | "clip"
  const [selectedClip, setSelectedClip] = useState(null);     // clip object from activeTrack.clippings
  const [videoError,   setVideoError]   = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);

  const videoRef = useRef(null);

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const today     = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    setStartDate(yesterday.toISOString().split("T")[0]);
    setEndDate(today.toISOString().split("T")[0]);
    fetchCameras();
    fetchStatus();
  }, []);

  // ── Camera Loader ─────────────────────────────────────────────────────────

  const fetchCameras = async () => {
    let camList = [];

    try {
      const res  = await fetch(`${API_BASE}/api/cameras`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          camList = data.map(cam => ({
            id:   cam.ome_stream || cam.id || cam.ip,
            name: cam.device_name || cam.name || cam.ip,
            type: (cam.model || "dome").toLowerCase(),
          }));
        }
      }
    } catch (_) { /* fall through to localStorage */ }

    if (!camList.length) {
      try {
        const saved = localStorage.getItem("miradorai_devices");
        const enrolled = saved ? JSON.parse(saved) : [];
        camList = enrolled.length > 0
          ? enrolled.map(c => ({ id: c.ome_stream || c.id || c.ip, name: c.name || c.ip, type: "dome" }))
          : DEFAULT_CAMERAS;
      } catch (_) {
        camList = DEFAULT_CAMERAS;
      }
    }

    setCamerasList(camList);
    const all = {};
    camList.forEach(c => { all[c.id] = true; });
    setSelectedCams(all);
  };

  const fetchStatus = async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/forensic/index-status`, { headers: getAuthHeaders() });
      const data = await res.json();
      setStatusData(data);
    } catch (_) {}
  };

  // ── Search ────────────────────────────────────────────────────────────────

  const handleSearch = async () => {
    setLoading(true);
    setResults([]);
    setActiveTrack(null);
    try {
      const activeCams  = Object.keys(selectedCams).filter(k => selectedCams[k]);
      const cameraQuery = activeCams.length ? `&cameras=${activeCams.join(",")}` : "";
      const qs = [
        `start_time=${startDate}`,
        `end_time=${endDate}`,
        `object_type=${objectType}`,
        `top_color=${topColor}`,
        `bottom_color=${bottomColor}`,
        `gender=${gender}`,
        `bag=${bag}`,
        cameraQuery,
      ].join("");

      const res  = await fetch(`${API_BASE}/api/forensic/search?${qs}`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.success) setResults(data.results || []);
    } catch (err) {
      console.error("[FORENSIC] Search failed:", err);
    } finally {
      setLoading(false);
    }
  };

  // ── Video Player Control ──────────────────────────────────────────────────

  /**
   * Imperatively set video src and play.
   * Using videoRef.current.src directly is the most reliable cross-browser approach
   * for dynamically changing video sources — avoids React re-render timing issues
   * that cause the <source> approach to stall/spin.
   */
  const setVideoSource = useCallback((url) => {
    const vid = videoRef.current;
    if (!vid) return;
    setVideoError(false);
    setVideoLoading(true);
    vid.pause();
    vid.src = url;       // set src directly on the element
    vid.load();          // trigger load
    vid.play().catch(() => {
      // Autoplay blocked by browser policy — user can click play manually
    });
  }, []);

  const handlePlayUnified = useCallback(() => {
    if (!activeTrack) return;
    setPlaybackMode("unified");
    setSelectedClip(null);
    setVideoSource(authUrl(activeTrack.combined_video_url));
  }, [activeTrack, setVideoSource]);

  const handlePlayClip = useCallback((clip) => {
    setPlaybackMode("clip");
    setSelectedClip(clip);
    setVideoSource(authUrl(clip.video_url));
  }, [setVideoSource]);

  // When workspace first opens → auto-play unified track
  useEffect(() => {
    if (activeTrack && !trackLoading) {
      // Small delay to let DOM mount
      const t = setTimeout(() => handlePlayUnified(), 150);
      return () => clearTimeout(t);
    }
  }, [activeTrack, trackLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Track Resolver ────────────────────────────────────────────────────────

  const handleSelectDetection = async (detId) => {
    setTrackLoading(true);
    setActiveTrack(null);
    setVideoError(false);
    try {
      const res  = await fetch(`${API_BASE}/api/forensic/track`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body:    JSON.stringify({ detection_id: detId }),
      });
      const data = await res.json();
      if (data.success) {
        setActiveTrack(data);
        setPlaybackMode("unified");
        setSelectedClip(null);
      }
    } catch (err) {
      console.error("[FORENSIC] Track load failed:", err);
    } finally {
      setTrackLoading(false);
    }
  };

  // ── Download ──────────────────────────────────────────────────────────────

  const handleDownloadTrack = () => {
    if (!activeTrack) return;
    const url  = authUrl(activeTrack.combined_video_url);
    const link = document.createElement("a");
    link.href  = url;
    link.download = `forensic_evidence_${activeTrack.track_id}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Group results by track_id for subject-level display ───────────────────
  // Each unique subject appears once; the card shows their earliest detection thumbnail.
  const groupedSubjects = (() => {
    const map = new Map();
    for (const det of results) {
      const key = det.track_id || det.detection_id;
      if (!map.has(key)) {
        map.set(key, { ...det, _count: 1 });
      } else {
        map.get(key)._count += 1;
      }
    }
    return Array.from(map.values());
  })();

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="forensic-shell">

      {/* ── SIDEBAR ────────────────────────────────────────────────────────── */}
      <aside className="forensic-sidebar">
        <div className="sidebar-title">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35M11 8v6M8 11h6"/>
          </svg>
          Forensic Scan
        </div>

        {/* Target Category */}
        <div className="filter-group">
          <div className="filter-label">Target Category</div>
          <select className="datetime-input" value={objectType} onChange={e => setObjectType(e.target.value)}>
            <option value="person">Person (Re-ID Tracker)</option>
            <option value="vehicle">Vehicle (Plate Index)</option>
          </select>
        </div>

        {/* Date Range */}
        <div className="filter-group">
          <div className="filter-label">From Date</div>
          <input type="date" className="datetime-input" value={startDate} onChange={e => setStartDate(e.target.value)}/>
        </div>
        <div className="filter-group">
          <div className="filter-label">To Date</div>
          <input type="date" className="datetime-input" value={endDate} onChange={e => setEndDate(e.target.value)}/>
        </div>

        {/* Camera Checklist */}
        <div className="filter-group">
          <div className="filter-label" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Cameras</span>
            <span
              style={{ cursor: "pointer", color: "#38bdf8", fontSize: "0.72rem" }}
              onClick={() => {
                const allOn = camerasList.every(c => selectedCams[c.id]);
                const next  = {};
                camerasList.forEach(c => { next[c.id] = !allOn; });
                setSelectedCams(next);
              }}
            >
              {camerasList.every(c => selectedCams[c.id]) ? "Deselect All" : "Select All"}
            </span>
          </div>
          <div className="cam-selector-box">
            {camerasList.map(cam => (
              <label key={cam.id} className="cam-checkbox-row">
                <input
                  type="checkbox"
                  checked={!!selectedCams[cam.id]}
                  onChange={() => setSelectedCams(p => ({ ...p, [cam.id]: !p[cam.id] }))}
                />
                <CameraIcon type={cam.type} size={13}/>
                <span>{cam.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Person Attributes */}
        {objectType === "person" ? (
          <>
            <div className="filter-group">
              <div className="filter-label">Upper Color (Shirt)</div>
              <ColorSwatches value={topColor} onChange={setTopColor}/>
            </div>
            <div className="filter-group">
              <div className="filter-label">Lower Color (Pants)</div>
              <ColorSwatches value={bottomColor} onChange={setBottomColor}/>
            </div>
            <div className="filter-group">
              <div className="filter-label">Gender</div>
              <select className="datetime-input" value={gender} onChange={e => setGender(e.target.value)}>
                <option value="any">Any Gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div className="filter-group">
              <div className="filter-label">Bag Carrying</div>
              <select className="datetime-input" value={bag} onChange={e => setBag(e.target.value)}>
                <option value="any">Any Baggage</option>
                <option value="backpack">Backpack</option>
                <option value="handbag">Handbag / Purse</option>
                <option value="none">No Bag</option>
              </select>
            </div>
          </>
        ) : (
          <div className="filter-group">
            <div className="filter-label">Vehicle Color</div>
            <ColorSwatches value={topColor} onChange={setTopColor}/>
          </div>
        )}

        <button className="scan-btn" onClick={handleSearch} disabled={loading}>
          {loading ? (
            <><div className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }}/> Scanning...</>
          ) : (
            <>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12H3l9-9 9 9h-2M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/>
              </svg>
              Run Forensic Scan
            </>
          )}
        </button>

        {/* Indexer Status */}
        {statusData && (
          <div className="status-badge">
            <div className="status-row">
              <span>Indexer</span>
              <span className="status-val" style={{ color: "#22c55e" }}>● Active</span>
            </div>
            <div className="status-row">
              <span>Mode</span>
              <span className="status-val">{statusData.device_mode}</span>
            </div>
            <div className="status-row">
              <span>Total Indexed</span>
              <span className="status-val">{statusData.total_detections_indexed?.toLocaleString()}</span>
            </div>
            <div className="status-row">
              <span>Active Tracks</span>
              <span className="status-val">{statusData.total_active_tracks?.toLocaleString()}</span>
            </div>
          </div>
        )}
      </aside>

      {/* ── RESULTS MAIN ───────────────────────────────────────────────────── */}
      <div className="forensic-main">
        <div className="forensic-header">
          <div className="header-title-section">
            <div className="header-main-title">Visual Forensic Results</div>
            <div className="header-subtitle">
              {results.length > 0
                ? `${groupedSubjects.length} unique subject${groupedSubjects.length !== 1 ? "s" : ""} resolved across ${results.length} detections`
                : "Matched subjects appear as cards. Click any card to view full camera tracking path."}
            </div>
          </div>
          {results.length > 0 && (
            <span className="results-count-badge">{results.length} Detections</span>
          )}
        </div>

        <div className="forensic-grid-wrap">
          {loading ? (
            <div className="grid-empty-state">
              <div className="scan-radar">
                <div className="radar-ring r1"/>
                <div className="radar-ring r2"/>
                <div className="radar-ring r3"/>
                <div className="radar-dot"/>
              </div>
              <div className="loading-text" style={{ fontSize: "1rem" }}>Executing AI Multi-Camera Forensic Scan...</div>
              <div style={{ fontSize: "0.78rem", color: "#475569" }}>Querying index across all selected channels</div>
            </div>
          ) : groupedSubjects.length > 0 ? (
            <div className="detections-grid">
              {groupedSubjects.map(det => (
                <DetectionCard
                  key={det.track_id || det.detection_id}
                  det={det}
                  onClick={() => handleSelectDetection(det.detection_id)}
                />
              ))}
            </div>
          ) : (
            <div className="grid-empty-state">
              <svg className="radar-sweep-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 2a10 10 0 0110 10"/>
                <line x1="12" y1="12" x2="22" y2="12"/>
              </svg>
              <div style={{ fontSize: "1rem", fontWeight: 600 }}>No Forensic Searches Yet</div>
              <div style={{ fontSize: "0.82rem", color: "#475569", maxWidth: 280, textAlign: "center", lineHeight: 1.6 }}>
                Configure visual attributes in the left panel and click "Run Forensic Scan" to search the index.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── TRACK WORKSPACE OVERLAY ─────────────────────────────────────────── */}
      {(trackLoading || activeTrack) && (
        <div className="forensic-workspace">
          {/* Workspace Header */}
          <div className="workspace-header">
            <button className="ws-back-btn" onClick={() => { setActiveTrack(null); setTrackLoading(false); }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Back to Results
            </button>

            {activeTrack && (
              <div className="ws-title">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
                Forensic Auto-Track —{" "}
                <span style={{ color: "#94a3b8", fontWeight: 500 }}>{activeTrack.camera_sequence?.join(" → ")}</span>
              </div>
            )}

            {activeTrack && (
              <span style={{ fontSize: "0.75rem", color: "#475569", fontWeight: 600 }}>
                ID: {activeTrack.track_id}
              </span>
            )}
          </div>

          {/* Workspace Body */}
          <div className="ws-body">
            {trackLoading ? (
              <div className="ws-player-loading" style={{ flex: 1 }}>
                <div className="loading-spinner"/>
                <div className="loading-text">Resolving Multi-Camera Track Sequence...</div>
                <div style={{ fontSize: "0.75rem", color: "#475569" }}>Compiling chronological camera path</div>
              </div>
            ) : activeTrack ? (
              <>
                {/* ── Left: Video Player ── */}
                <div className="ws-left-panel">
                  <div className="ws-player-container">
                    {videoLoading && !videoError && (
                      <div className="video-spinner-overlay">
                        <div className="loading-spinner"/>
                      </div>
                    )}
                    {videoError && (
                      <div className="video-error-overlay">
                        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#ef4444" strokeWidth="1.5">
                          <circle cx="12" cy="12" r="10"/>
                          <path d="M12 8v4M12 16h.01"/>
                        </svg>
                        <div>Could not load video clip</div>
                        <div style={{ fontSize: "0.72rem", color: "#64748b" }}>
                          Check that FFmpeg is installed and the API is reachable
                        </div>
                      </div>
                    )}
                    {/* Video element — src set imperatively via setVideoSource() */}
                    <video
                      ref={videoRef}
                      className="ws-video-element"
                      controls
                      playsInline
                      onWaiting={() => setVideoLoading(true)}
                      onCanPlay={() => setVideoLoading(false)}
                      onPlaying={() => setVideoLoading(false)}
                      onError={() => { setVideoLoading(false); setVideoError(true); }}
                    />

                    {/* HUD Overlay */}
                    <div className="ws-hud-overlay">
                      <span className="hud-rec-dot"/>
                      {playbackMode === "unified"
                        ? <span><span className="hud-track-tag">MASTER TRACK</span> · {activeTrack.clippings?.length} cameras</span>
                        : <span><span className="hud-track-tag">CLIP</span> · {selectedClip?.camera_name}</span>
                      }
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="ws-actions-row">
                    <button
                      className={`ws-action-btn ${playbackMode === "unified" ? "active-primary" : "outline"}`}
                      onClick={handlePlayUnified}
                    >
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                      Play Full Track
                    </button>
                    <button className="ws-action-btn export-btn" onClick={handleDownloadTrack}>
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                      </svg>
                      Export Evidence (MP4)
                    </button>
                  </div>

                  {/* Subject Attributes Summary */}
                  {activeTrack.original_detection?.appearance && (
                    <div className="subject-attr-panel">
                      <div className="attr-panel-title">Subject Attributes</div>
                      <div className="attr-grid">
                        <AttrPill label="Top" value={activeTrack.original_detection.appearance.top_color_name}    showDot/>
                        <AttrPill label="Bottom" value={activeTrack.original_detection.appearance.bottom_color_name} showDot/>
                        <AttrPill label="Gender" value={activeTrack.original_detection.appearance.gender}/>
                        <AttrPill label="Bag" value={activeTrack.original_detection.appearance.bag}/>
                        <AttrPill
                          label="Confidence"
                          value={`${Math.round((activeTrack.original_detection.appearance.confidence || 0) * 100)}%`}
                          highlight
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Right: Timeline ── */}
                <div className="ws-right-panel">
                  <div className="timeline-section-title">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                    Camera Timeline · {activeTrack.clippings?.length} stops
                  </div>

                  <div className="timeline-flow">
                    {activeTrack.clippings?.map((clip, idx) => (
                      <div key={clip.detection_id}>
                        <div
                          className={`timeline-node ${selectedClip?.detection_id === clip.detection_id ? "active" : ""}`}
                          onClick={() => handlePlayClip(clip)}
                        >
                          {/* Clip thumbnail */}
                          <div className="node-thumb">
                            <TimelineThumbnail detectionId={clip.detection_id}/>
                          </div>

                          <div className="node-icon-wrap">
                            <CameraIcon type={clip.camera_type} size={16}/>
                          </div>

                          <div className="node-details">
                            <div className="node-cam-name">{clip.camera_name}</div>
                            <div className="node-time">
                              {clip.timestamp
                                ? new Date(clip.timestamp).toLocaleString(undefined, {
                                    month: "short", day: "numeric",
                                    hour: "2-digit", minute: "2-digit", second: "2-digit"
                                  })
                                : clip.timestamp}
                            </div>
                          </div>

                          <span className="node-play-badge">
                            {selectedClip?.detection_id === clip.detection_id ? "▶ Playing" : `Clip ${idx + 1}`}
                          </span>
                        </div>
                        {idx < activeTrack.clippings.length - 1 && (
                          <div className="timeline-connector">
                            <div className="connector-arrow"/>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helper sub-components ─────────────────────────────────────────────────────

function ColorSwatches({ value, onChange }) {
  return (
    <div className="swatches-grid">
      <div
        className={`color-swatch any-swatch ${value === "any" ? "active" : ""}`}
        onClick={() => onChange("any")}
        title="Any color"
      >
        {value === "any" && <span className="swatch-check" style={{ color: "white" }}>✓</span>}
      </div>
      {COLORS.map(c => (
        <div
          key={c.name}
          className={`color-swatch ${value === c.name ? "active" : ""}`}
          style={{ background: c.hex, border: c.name === "white" ? "1px solid #33415580" : "none" }}
          onClick={() => onChange(c.name)}
          title={c.name}
        >
          {value === c.name && (
            <span className="swatch-check" style={{ color: c.textDark ? "#0f172a" : "white" }}>✓</span>
          )}
        </div>
      ))}
    </div>
  );
}

function DetectionCard({ det, onClick }) {
  const camCount = det._count || 1;
  return (
    <div className="detection-card" onClick={onClick}>
      <div className="card-img-wrap">
        <DetectionThumbnail detectionId={det.detection_id} appearance={det.appearance}/>
        <span className="card-confidence">{Math.round((det.appearance?.confidence || 0) * 100)}%</span>
        {camCount > 1 && (
          <span className="card-cam-count" title={`Seen across ${camCount} cameras`}>
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
            </svg>
            {camCount}
          </span>
        )}
      </div>
      <div className="card-body">
        <div className="card-cam-name">
          <CameraIcon type={det.camera_type} size={13}/>
          {det.camera_name}
        </div>
        <div className="card-time">
          {det.timestamp
            ? new Date(det.timestamp).toLocaleString(undefined, {
                month: "short", day: "numeric",
                hour: "2-digit", minute: "2-digit"
              })
            : det.timestamp}
        </div>
        <div className="card-tags">
          {det.appearance?.top_color_name && (
            <span className="card-tag card-tag--top">
              <ColorDot name={det.appearance.top_color_name}/>
              {det.appearance.top_color_name}
            </span>
          )}
          {det.appearance?.bottom_color_name && (
            <span className="card-tag card-tag--bottom">
              <ColorDot name={det.appearance.bottom_color_name}/>
              {det.appearance.bottom_color_name}
            </span>
          )}
          {det.appearance?.gender && det.appearance.gender !== "unknown" && (
            <span className="card-tag card-tag--meta">{det.appearance.gender}</span>
          )}
          {det.appearance?.bag && det.appearance.bag !== "none" && (
            <span className="card-tag card-tag--meta">{det.appearance.bag}</span>
          )}
        </div>
        <div className="card-track-cta">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          View tracking path
        </div>
      </div>
    </div>
  );
}

/**
 * Small thumbnail for the timeline clip nodes — same resilient load logic.
 */
function TimelineThumbnail({ detectionId }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="node-thumb-fallback">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#38bdf8" strokeWidth="1.8">
          <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
        </svg>
      </div>
    );
  }
  return (
    <img
      src={authUrl(`/api/forensic/video/thumbnail?detection_id=${detectionId}`)}
      alt=""
      className="node-thumb-img"
      onError={() => setFailed(true)}
    />
  );
}

function AttrPill({ label, value, showDot, highlight }) {
  return (
    <div className={`attr-pill ${highlight ? "attr-pill--highlight" : ""}`}>
      <span className="attr-label">{label}</span>
      <span className="attr-value">
        {showDot && <ColorDot name={value}/>}
        {value}
      </span>
    </div>
  );
}