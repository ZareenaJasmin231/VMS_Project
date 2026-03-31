import { useState, useRef, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import "./MediaPlayerPage.css";

const STREAM_API = "http://localhost:8000";

function loadDevices() {
  try { return JSON.parse(localStorage.getItem("miradorai_devices") || "[]"); }
  catch { return []; }
}

export default function MediaPlayerPage() {
  const { user } = useAuth();

  // ── All state MUST come before conditional returns ───────────────
  const [mode, setMode]               = useState("recordings"); // recordings | live | rtsp
  const [cameras]                     = useState(loadDevices);
  const [recordingCameras, setRecordingCameras] = useState([]);
  const [selectedCam, setSelectedCam] = useState(null);
  const [files, setFiles]             = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [playingFile, setPlayingFile] = useState(null);
  const [rtspUrl, setRtspUrl]         = useState("");
  const [selectedCustomFile, setSelectedCustomFile] = useState(null);
  const [playing, setPlaying]         = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]       = useState(0);
  const [volume, setVolume]           = useState(0.8);
  const [speed, setSpeed]             = useState(1);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  const videoRef    = useRef(null);
  const playerWrap  = useRef(null);

  // ── All useEffect hooks MUST come here, BEFORE any conditional returns ──────
  // ── Fetch available recording cameras ───────────────────────────
  useEffect(() => {
    const fetchRecordingCameras = async () => {
      try {
        const res = await fetch(`${STREAM_API}/api/recordings/cameras`);
        if (res.ok) {
          const cameraIds = await res.json();
          setRecordingCameras(cameraIds);
          if (cameraIds.length > 0 && !selectedCam) {
            setSelectedCam({ stream_key: cameraIds[0], name: cameraIds[0] });
          }
        }
      } catch (err) {
        console.error("Failed to fetch recording cameras:", err);
      }
    };
    if (mode === "recordings") {
      fetchRecordingCameras();
    }
  }, [mode]);

  // ── Fetch recordings when camera or date changes ─────────────────
  useEffect(() => {
    const fetchFiles = async () => {
      if (!selectedCam?.stream_key) return;
      setLoadingFiles(true);
      try {
        const res = await fetch(
          `${STREAM_API}/api/recordings/${selectedCam.stream_key}?date=${selectedDate}`
        );
        if (res.ok) {
          const data = await res.json();
          const formattedFiles = Array.isArray(data) 
            ? data.map(rec => ({
                name: `${rec.start_time}`,
                camera_id: rec.camera_id,
                date: rec.date,
                start_time: rec.start_time,
                size: rec.file_size || "—",
              }))
            : (data.files || []);
          setFiles(formattedFiles);
        } else {
          setFiles([]);
        }
      } catch {
        setFiles([]);
      } finally {
        setLoadingFiles(false);
      }
    };
    if (mode === "recordings" && selectedCam?.stream_key) {
      fetchFiles();
    }
  }, [selectedCam, selectedDate, mode]);

  // ── Video event handlers ──────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime     = () => setCurrentTime(v.currentTime);
    const onDuration = () => setDuration(v.duration);
    const onPlay     = () => setPlaying(true);
    const onPause    = () => setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const onEnded    = () => { setPlaying(false); };
    v.addEventListener("timeupdate",      onTime);
    v.addEventListener("loadedmetadata",  onDuration);
    v.addEventListener("play",            onPlay);
    v.addEventListener("pause",           onPause);
    v.addEventListener("ended",           onEnded);
    return () => {
      v.removeEventListener("timeupdate",     onTime);
      v.removeEventListener("loadedmetadata", onDuration);
      v.removeEventListener("play",           onPlay);
      v.removeEventListener("pause",          onPause);
      v.removeEventListener("ended",          onEnded);
    };
  }, [playingFile]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  // ── All functions come AFTER all hooks ──────────────────────────
  // ── Play a recording file (encrypted) ─────────────────────────────
  const playFile = (file) => {
    setPlayingFile(file);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.load();
        videoRef.current.play().catch(() => {});
      }
    }, 100);
  };

  const playNext = () => {
    if (!playingFile || !files.length) return;
    const idx = files.findIndex((f) => f.name === playingFile.name);
    if (idx < files.length - 1) playFile(files[idx + 1]);
  };

  const playPrev = () => {
    if (!playingFile || !files.length) return;
    const idx = files.findIndex((f) => f.name === playingFile.name);
    if (idx > 0) playFile(files[idx - 1]);
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    playing ? videoRef.current.pause() : videoRef.current.play();
  };

  const seek = (e) => {
    if (!videoRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    videoRef.current.currentTime = pct * duration;
  };

  const skip = (secs) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(duration, currentTime + secs));
  };

  const toggleFullscreen = () => {
    if (!playerWrap.current) return;
    if (!document.fullscreenElement) {
      playerWrap.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  const playRtsp = () => {
    if (!rtspUrl.trim()) return;
    setPlayingFile({ name: rtspUrl, url: rtspUrl, isRtsp: true });
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.load();
        videoRef.current.play().catch(() => {});
      }
    }, 100);
  };

  const handleFileSelection = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Check if file is encrypted (.enc)
    if (file.name.endsWith(".enc")) {
      // Send to backend for decryption
      const formData = new FormData();
      formData.append("file", file);
      
      setLoadingFiles(true);
      fetch(`${STREAM_API}/play`, {  // Uses http://localhost:8000
        method: "POST",
        body: formData,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Decryption failed: ${res.status}`);
          return res.blob();
        })
        .then((decryptedBlob) => {
          const fileUrl = URL.createObjectURL(decryptedBlob);
          const decryptedFile = {
            name: file.name.replace(".enc", ".mp4"),
            url: fileUrl,
            size: (file.size / (1024 * 1024)).toFixed(2) + " MB",
            isCustom: true,
            isEncrypted: true,
          };
          setSelectedCustomFile(decryptedFile);
          setPlayingFile(decryptedFile);
          
          setTimeout(() => {
            if (videoRef.current) {
              videoRef.current.load();
              videoRef.current.play().catch(() => {});
            }
          }, 100);
        })
        .catch((err) => {
          console.error("Failed to decrypt file:", err);
          alert("Failed to decrypt .enc file. Make sure it was encrypted with the correct key.");
        })
        .finally(() => setLoadingFiles(false));
    } else {
      // Non-encrypted file - play directly
      const fileUrl = URL.createObjectURL(file);
      const customFile = {
        name: file.name,
        url: fileUrl,
        size: (file.size / (1024 * 1024)).toFixed(2) + " MB",
        isCustom: true,
      };
      setSelectedCustomFile(customFile);
      setPlayingFile(customFile);
      
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.load();
          videoRef.current.play().catch(() => {});
        }
      }, 100);
    }
  };

  const fmt = (s) => {
    if (!s || isNaN(s)) return "00:00";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`
      : `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  };

  const videoSrc = playingFile
    ? playingFile.isRtsp
      ? playingFile.url
      : playingFile.isLive
      ? playingFile.url
      : playingFile.isCustom
      ? playingFile.url
      : playingFile.camera_id && playingFile.date && playingFile.start_time
      ? `${STREAM_API}/api/recordings/play?camera_id=${playingFile.camera_id}&date=${playingFile.date}&start_time=${playingFile.start_time}`
      : null
    : null;

  const groupedFiles = files.reduce((acc, f) => {
    const hour = f.name.split("_")[1]?.substring(0, 2) || f.start_time?.split("-")[0] || "00";
    if (!acc[hour]) acc[hour] = [];
    acc[hour].push(f);
    return acc;
  }, {});

  return (
    <div className="mp-shell">
      {/* Admin guard */}
      {user?.role !== "admin" ? (
        <div className="mp-access-denied">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
          <p>Admin access required</p>
          <span>This page is only accessible to administrators.</span>
        </div>
      ) : (
        <>
      {/* ── Left Panel ─────────────────────────────────── */}
      <div className="mp-left">
        <div className="mp-left-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <rect x="2" y="2" width="20" height="8" rx="2"/>
            <rect x="2" y="14" width="20" height="8" rx="2"/>
          </svg>
          Media Browser
        </div>

        {/* Mode tabs */}
        <div className="mp-mode-tabs">
          {["recordings","live","rtsp"].map((m) => (
            <button
              key={m}
              className={`mp-mode-tab ${mode === m ? "active" : ""}`}
              onClick={() => { setMode(m); setPlayingFile(null); }}
            >
              {m === "recordings" ? "Recordings" : m === "live" ? "Live" : "RTSP"}
            </button>
          ))}
        </div>

        {/* Camera list */}
        <div className="mp-cam-section">
          {mode === "recordings" ? "Recorded Cameras" : "Cameras"}
        </div>
        <div className="mp-cam-list">
          {mode === "recordings" && recordingCameras.length === 0 && (
            <div className="mp-empty-small">No cameras with recordings</div>
          )}
          {mode === "recordings" && recordingCameras.map((camId) => (
            <div
              key={camId}
              className={`mp-cam-item ${selectedCam?.stream_key === camId ? "active" : ""}`}
              onClick={() => { setSelectedCam({ stream_key: camId, name: camId }); setPlayingFile(null); }}
            >
              <div className={`mp-cam-dot on`}/>
              <div className="mp-cam-name">{camId}</div>
              {mode === "recordings" && (
                <div className="mp-cam-count">{files.length || 0}</div>
              )}
            </div>
          ))}
          {mode !== "recordings" && cameras.length === 0 && (
            <div className="mp-empty-small">No cameras enrolled</div>
          )}
          {mode !== "recordings" && cameras.map((cam) => (
            <div
              key={cam.id}
              className={`mp-cam-item ${selectedCam?.id === cam.id ? "active" : ""}`}
              onClick={() => { setSelectedCam(cam); setPlayingFile(null); }}
            >
              <div className={`mp-cam-dot ${cam.status === "Online" ? "on" : "off"}`}/>
              <div className="mp-cam-name">{cam.name}</div>
              {mode === "recordings" && (
                <div className="mp-cam-count">{files.length || 0}</div>
              )}
            </div>
          ))}
        </div>

        {/* File list — recordings mode */}
        {mode === "recordings" && (
          <>
            <div className="mp-date-pick">
              <input
                type="date"
                className="mp-date-input"
                value={selectedDate}
                max={new Date().toISOString().split("T")[0]}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
            </div>

            {/* File picker from storage */}
            <div style={{ padding: "10px", borderTop: "1px solid #e5e7eb" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "6px", color: "#64748b" }}>
                📁 Open from Storage
              </label>
              <input
                type="file"
                accept="video/*,.mp4,.mkv,.avi,.mov,.enc"
                onChange={handleFileSelection}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "6px",
                  fontSize: "11px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              />
              {selectedCustomFile && (
                <div style={{
                  marginTop: "8px",
                  padding: "6px",
                  backgroundColor: "#f0fdf4",
                  border: "1px solid #86efac",
                  borderRadius: "4px",
                  fontSize: "11px",
                  color: "#166534",
                }}>
                  ✓ {selectedCustomFile.name} ({selectedCustomFile.size})
                </div>
              )}
            </div>

            <div className="mp-file-list">
              {loadingFiles && <div className="mp-empty-small">Loading…</div>}
              {!loadingFiles && files.length === 0 && (
                <div className="mp-empty-small">No recordings for this date</div>
              )}
              {Object.entries(groupedFiles).map(([hour, hourFiles]) => (
                <div key={hour}>
                  <div className="mp-file-date">{hour}:00</div>
                  {hourFiles.map((file) => (
                    <div
                      key={file.start_time || file.name}
                      className={`mp-file-item ${playingFile?.start_time === file.start_time ? "playing" : ""}`}
                      onClick={() => playFile(file)}
                    >
                      <div className="mp-file-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11">
                          <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                      </div>
                      <div className="mp-file-info">
                        <div className="mp-file-name">{file.start_time || file.name} 🔒</div>
                        <div className="mp-file-meta">{file.size || "—"} (encrypted)</div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        {/* RTSP input */}
        {mode === "rtsp" && (
          <div className="mp-rtsp-panel">
            <div className="mp-rtsp-label">Stream URL</div>
            <input
              className="mp-rtsp-input"
              placeholder="rtsp://192.168.x.x:554/..."
              value={rtspUrl}
              onChange={(e) => setRtspUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && playRtsp()}
            />
            <button className="mp-rtsp-btn" onClick={playRtsp}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              Play Stream
            </button>
          </div>
        )}

        {/* Live camera list */}
        {mode === "live" && (
          <div className="mp-live-list">
            {cameras.filter((c) => c.ws_url).map((cam) => (
              <div
                key={cam.id}
                className={`mp-live-item ${selectedCam?.id === cam.id && playingFile?.isLive ? "active" : ""}`}
                onClick={() => {
                  setSelectedCam(cam);
                  setPlayingFile({ name: cam.name, url: cam.ws_url, isLive: true });
                }}
              >
                <div className="mp-cam-dot on"/>
                <div className="mp-cam-name">{cam.name}</div>
                <span className="mp-live-tag">LIVE</span>
              </div>
            ))}
            {cameras.filter((c) => c.ws_url).length === 0 && (
              <div className="mp-empty-small">No live streams available</div>
            )}
          </div>
        )}
      </div>

      {/* ── Center: Player ──────────────────────────────── */}
      <div className="mp-center">
        <div className="mp-player-wrap" ref={playerWrap}>
          {!playingFile ? (
            <div className="mp-player-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="52" height="52">
                <rect x="2" y="7" width="15" height="10" rx="2"/>
                <path d="M17 9l5-3v12l-5-3"/>
              </svg>
              <p>
                {mode === "recordings" ? "Select a recording to play" :
                 mode === "live"       ? "Select a live camera" :
                 "Enter an RTSP URL and click Play"}
              </p>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="mp-video"
                src={videoSrc}
                playsInline
              />
              <div className="mp-overlay-top">
                <div className="mp-cam-label">
                  {playingFile.isLive && <span className="mp-rec-dot"/>}
                  {playingFile.name}
                </div>
                <div className="mp-time-overlay">{fmt(currentTime)}</div>
              </div>
            </>
          )}
        </div>

        {/* Controls */}
        <div className="mp-controls">
          {/* Progress bar */}
          <div className="mp-progress-row">
            <span className="mp-time">{fmt(currentTime)}</span>
            <div className="mp-progress" onClick={seek}>
              <div
                className="mp-progress-fill"
                style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
              />
              <div
                className="mp-progress-thumb"
                style={{ left: duration ? `calc(${(currentTime / duration) * 100}% - 6px)` : "-6px" }}
              />
            </div>
            <span className="mp-time">{fmt(duration)}</span>
          </div>

          {/* Buttons */}
          <div className="mp-ctrl-row">
            <button className="mp-ctrl-btn" onClick={playPrev} title="Previous">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>
              </svg>
            </button>
            <button className="mp-ctrl-btn" onClick={() => skip(-10)} title="-10s">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 .49-3.54"/>
              </svg>
            </button>
            <button className="mp-ctrl-btn mp-play-btn" onClick={togglePlay}>
              {playing
                ? <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                : <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              }
            </button>
            <button className="mp-ctrl-btn" onClick={() => skip(10)} title="+10s">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-.49-3.54"/>
              </svg>
            </button>
            <button className="mp-ctrl-btn" onClick={playNext} title="Next">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>
              </svg>
            </button>

            <div className="mp-ctrl-spacer"/>

            {/* Volume */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{color:"#3a4055",flexShrink:0}}>
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
            <input
              type="range" min="0" max="1" step="0.05"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="mp-vol-slider"
            />

            {/* Speed */}
            {[1, 2, 4].map((s) => (
              <button
                key={s}
                className={`mp-speed-btn ${speed === s ? "active" : ""}`}
                onClick={() => setSpeed(s)}
              >
                {s}x
              </button>
            ))}

            {/* Download - only for non-encrypted files */}
            {playingFile && !playingFile.isLive && !playingFile.isRtsp && !playingFile.camera_id && (
              <a
                className="mp-dl-btn"
                href={videoSrc}
                download={playingFile.name}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download
              </a>
            )}

            {/* Fullscreen */}
            <button className="mp-ctrl-btn" onClick={toggleFullscreen}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Right Panel: Timeline ───────────────────────── */}
      <div className="mp-right">
        <div className="mp-right-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          Timeline
        </div>

        <div className="mp-date-nav">
          <button className="mp-date-btn" onClick={() => {
            const d = new Date(selectedDate);
            d.setDate(d.getDate() - 1);
            setSelectedDate(d.toISOString().split("T")[0]);
          }}>‹</button>
          <span className="mp-date-label">
            {new Date(selectedDate).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" })}
          </span>
          <button className="mp-date-btn" onClick={() => {
            const d = new Date(selectedDate);
            d.setDate(d.getDate() + 1);
            const today = new Date().toISOString().split("T")[0];
            if (d.toISOString().split("T")[0] <= today)
              setSelectedDate(d.toISOString().split("T")[0]);
          }}>›</button>
        </div>

        <div className="mp-timeline">
          {Array.from({ length: 24 }, (_, h) => {
            const hourStr  = String(h).padStart(2, "0");
            const hourFiles = groupedFiles[hourStr] || [];
            const hasRec   = hourFiles.length > 0;
            const isPlaying = playingFile && hourFiles.some((f) => f.start_time === playingFile.start_time || f.name === playingFile.name);
            return (
              <div key={h} className="mp-tl-row">
                <div className="mp-tl-hour">{hourStr}:00</div>
                <div
                  className={`mp-tl-seg ${hasRec ? "has-rec" : ""} ${isPlaying ? "playing" : ""}`}
                  onClick={() => hasRec && playFile(hourFiles[0])}
                >
                  {isPlaying ? "▶ playing" : hasRec ? `${hourFiles.length} file${hourFiles.length > 1 ? "s" : ""}` : ""}
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick RTSP */}
        <div className="mp-quick-rtsp">
          <div className="mp-quick-label">Quick Stream</div>
          <input
            className="mp-rtsp-input"
            placeholder="rtsp://..."
            value={rtspUrl}
            onChange={(e) => setRtspUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && playRtsp()}
          />
          <button className="mp-rtsp-btn" onClick={playRtsp}>▶ Play</button>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
