// import { useState, useRef, useEffect } from "react";
// import { useAuth } from "../../context/AuthContext";
// import "./MediaPlayerPage.css";

// const STREAM_API = "http://localhost:8000";

// // ── Extract the hour (0–23) from a recording file object ──────────────────────
// // Handles formats like: "14-05-30", "cam1_14_05_30", "14:05:30"
// function extractHour(file) {
//   const raw = file.start_time || file.name || "";
//   // HH-MM-SS or HH:MM:SS
//   const dashColon = raw.match(/^(\d{2})[-:]/);
//   if (dashColon) return parseInt(dashColon[1], 10);
//   // name like "cam1_14_05_30" → second underscore segment
//   const segments = raw.split("_");
//   if (segments.length >= 2) {
//     const h = parseInt(segments[1], 10);
//     if (!isNaN(h) && h >= 0 && h <= 23) return h;
//   }
//   // Fallback: first two digits
//   const digits = raw.match(/(\d{2})/);
//   if (digits) return parseInt(digits[1], 10);
//   return 0;
// }

// function fmt(s) {
//   if (!s || isNaN(s)) return "00:00";
//   const h = Math.floor(s / 3600);
//   const m = Math.floor((s % 3600) / 60);
//   const sec = Math.floor(s % 60);
//   return h > 0
//     ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
//     : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
// }

// function loadDevices() {
//   try { return JSON.parse(localStorage.getItem("miradorai_devices") || "[]"); }
//   catch { return []; }
// }

// export default function MediaPlayerPage() {
//   const { user } = useAuth();

//   const [cameras] = useState(loadDevices);
//   const [recordingCameras, setRecordingCameras] = useState([]);
//   const [selectedCam, setSelectedCam] = useState(null);
//   const [files, setFiles] = useState([]);
//   const [loadingFiles, setLoadingFiles] = useState(false);
//   const [playingFile, setPlayingFile] = useState(null);
//   const [playing, setPlaying] = useState(false);
//   const [currentTime, setCurrentTime] = useState(0);
//   const [duration, setDuration] = useState(0);
//   const [volume, setVolume] = useState(0.8);
//   const [speed, setSpeed] = useState(1);
//   const [selectedDate, setSelectedDate] = useState(
//     new Date().toISOString().split("T")[0]
//   );
//   const [startTime, setStartTime] = useState(0);
//   const [endTime, setEndTime] = useState(23);

//   const videoRef = useRef(null);
//   const playerWrap = useRef(null);

//   // ── Fetch cameras that have recordings ────────────────────────────
//   useEffect(() => {
//     (async () => {
//       try {
//         const res = await fetch(`${STREAM_API}/api/recordings/cameras`);
//         if (res.ok) {
//           const ids = await res.json();
//           setRecordingCameras(ids);
//           if (ids.length > 0)
//             setSelectedCam((prev) => prev ?? { stream_key: ids[0], name: ids[0] });
//         }
//       } catch (e) { console.error("Failed to fetch recording cameras:", e); }
//     })();
//   }, []);

//   // ── Fetch recordings when camera or date changes ──────────────────
//   useEffect(() => {
//     if (!selectedCam?.stream_key) return;
//     let cancelled = false;
//     (async () => {
//       setLoadingFiles(true);
//       setFiles([]);
//       try {
//         const res = await fetch(
//           `${STREAM_API}/api/recordings/${selectedCam.stream_key}?date=${selectedDate}`
//         );
//         if (!cancelled && res.ok) {
//           const data = await res.json();
//           const raw = Array.isArray(data) ? data : (data.files || []);
//           setFiles(raw.map((rec) => ({
//             name: rec.start_time || rec.name || "",
//             camera_id: rec.camera_id,
//             date: rec.date,
//             start_time: rec.start_time,
//             size: rec.file_size || "—",
//           })));
//         }
//       } catch { if (!cancelled) setFiles([]); }
//       finally { if (!cancelled) setLoadingFiles(false); }
//     })();
//     return () => { cancelled = true; };
//   }, [selectedCam, selectedDate]);

//   // ── Video event wiring ────────────────────────────────────────────
//   useEffect(() => {
//     const v = videoRef.current;
//     if (!v) return;
//     const onTime = () => setCurrentTime(v.currentTime);
//     const onMeta = () => setDuration(v.duration);
//     const onPlay = () => setPlaying(true);
//     const onPause = () => setPlaying(false);
//     const onEnded = () => setPlaying(false);
//     v.addEventListener("timeupdate", onTime);
//     v.addEventListener("loadedmetadata", onMeta);
//     v.addEventListener("play", onPlay);
//     v.addEventListener("pause", onPause);
//     v.addEventListener("ended", onEnded);
//     return () => {
//       v.removeEventListener("timeupdate", onTime);
//       v.removeEventListener("loadedmetadata", onMeta);
//       v.removeEventListener("play", onPlay);
//       v.removeEventListener("pause", onPause);
//       v.removeEventListener("ended", onEnded);
//     };
//   }, [playingFile]);

//   useEffect(() => { if (videoRef.current) videoRef.current.volume = volume; }, [volume]);
//   useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed; }, [speed]);

//   // ── Actions ───────────────────────────────────────────────────────
//   const playFile = (file) => {
//     setPlayingFile(file);
//     setPlaying(false);
//     setCurrentTime(0);
//     setDuration(0);
//     setTimeout(() => {
//       if (videoRef.current) {
//         videoRef.current.load();
//         videoRef.current.play().catch(() => { });
//       }
//     }, 100);
//   };

//   const playNext = () => {
//     if (!playingFile) return;
//     const idx = filteredFiles.findIndex((f) => f.start_time === playingFile.start_time);
//     if (idx < filteredFiles.length - 1) playFile(filteredFiles[idx + 1]);
//   };

//   const playPrev = () => {
//     if (!playingFile) return;
//     const idx = filteredFiles.findIndex((f) => f.start_time === playingFile.start_time);
//     if (idx > 0) playFile(filteredFiles[idx - 1]);
//   };

//   const togglePlay = () => {
//     if (!videoRef.current) return;
//     playing ? videoRef.current.pause() : videoRef.current.play();
//   };

//   const seek = (e) => {
//     if (!videoRef.current || !duration) return;
//     const rect = e.currentTarget.getBoundingClientRect();
//     videoRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
//   };

//   const skip = (secs) => {
//     if (!videoRef.current) return;
//     videoRef.current.currentTime = Math.max(0, Math.min(duration, currentTime + secs));
//   };

//   const toggleFullscreen = () => {
//     if (!document.fullscreenElement) playerWrap.current?.requestFullscreen?.();
//     else document.exitFullscreen?.();
//   };

//   // ── Derived: apply date + time-range filter ────────────────────────
//   // filteredFiles = only recordings whose hour falls in [startTime, endTime]
//   const filteredFiles = files.filter((f) => {
//     const h = extractHour(f);
//     return h >= startTime && h <= endTime;
//   });

//   // Group by hour for the sidebar
//   const groupedFiles = filteredFiles.reduce((acc, f) => {
//     const h = String(extractHour(f)).padStart(2, "0");
//     (acc[h] = acc[h] || []).push(f);
//     return acc;
//   }, {});

//   const videoSrc = playingFile?.camera_id && playingFile?.date && playingFile?.start_time
//     ? `${STREAM_API}/api/recordings/play?camera_id=${playingFile.camera_id}&date=${playingFile.date}&start_time=${playingFile.start_time}`
//     : null;

//   // ─────────────────────────────────────────────────────────────────
//   return (
//     <div className="mp-shell">
//       {user?.role !== "admin" ? (
//         <div className="mp-access-denied">
//           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
//             <rect x="3" y="11" width="18" height="11" rx="2" />
//             <path d="M7 11V7a5 5 0 0110 0v4" />
//           </svg>
//           <p>Admin access required</p>
//           <span>This page is only accessible to administrators.</span>
//         </div>
//       ) : (
//         <>
//           {/* ── Left Panel ──────────────────────────────────── */}
//           <div className="mp-left">
//             <div className="mp-left-header">
//               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
//                 <rect x="2" y="2" width="20" height="8" rx="2" />
//                 <rect x="2" y="14" width="20" height="8" rx="2" />
//               </svg>
//               Media Browser
//             </div>

//             {/* Camera list */}
//             <div className="mp-cam-section">Recorded Cameras</div>
//             <div className="mp-cam-list">
//               {recordingCameras.length === 0 && (
//                 <div className="mp-empty-small">No cameras with recordings</div>
//               )}
//               {recordingCameras.map((camId) => (
//                 <div
//                   key={camId}
//                   className={`mp-cam-item ${selectedCam?.stream_key === camId ? "active" : ""}`}
//                   onClick={() => {
//                     setSelectedCam({ stream_key: camId, name: camId });
//                     setPlayingFile(null);
//                   }}
//                 >
//                   <div className="mp-cam-dot on" />
//                   <div className="mp-cam-name">{camId}</div>
//                   <div className="mp-cam-count">
//                     {selectedCam?.stream_key === camId ? filteredFiles.length : "—"}
//                   </div>
//                 </div>
//               ))}
//             </div>

//             {/* Date + Time Range Filters */}
//             <div className="mp-filters">
//               <div className="mp-filter-group">
//                 <label className="mp-label">Date</label>
//                 <div className="mp-date-pick">
//                   <input
//                     type="date"
//                     className="mp-date-input"
//                     value={selectedDate}
//                     max={new Date().toISOString().split("T")[0]}
//                     onChange={(e) => { setSelectedDate(e.target.value); setPlayingFile(null); }}
//                   />
//                 </div>
//               </div>

//               <div className="mp-filter-group">
//                 <label className="mp-label">
//                   Time Range
//                   <span className="mp-label-hint">
//                     &nbsp;— {filteredFiles.length} clip{filteredFiles.length !== 1 ? "s" : ""}
//                   </span>
//                 </label>
//                 <div className="mp-time-range-row">
//                   <select
//                     className="mp-select"
//                     value={startTime}
//                     onChange={(e) => {
//                       const v = Number(e.target.value);
//                       setStartTime(v);
//                       if (v > endTime) setEndTime(v);
//                       setPlayingFile(null);
//                     }}
//                   >
//                     {Array.from({ length: 24 }).map((_, i) => (
//                       <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
//                     ))}
//                   </select>
//                   <span className="mp-range-sep">to</span>
//                   <select
//                     className="mp-select"
//                     value={endTime}
//                     onChange={(e) => {
//                       const v = Number(e.target.value);
//                       setEndTime(v);
//                       if (v < startTime) setStartTime(v);
//                       setPlayingFile(null);
//                     }}
//                   >
//                     {Array.from({ length: 24 }).map((_, i) => (
//                       <option key={i} value={i}>{String(i).padStart(2, "0")}:59</option>
//                     ))}
//                   </select>
//                 </div>
//               </div>
//             </div>

//             {/* File list — shows only filtered recordings */}
//             <div className="mp-file-list">
//               <div className="mp-cam-section">Matched Files</div>
//               {loadingFiles && <div className="mp-empty-small">Loading…</div>}
//               {!loadingFiles && filteredFiles.length === 0 && (
//                 <div className="mp-empty-small">No recordings for this range</div>
//               )}
//               {!loadingFiles &&
//                 Object.entries(groupedFiles)
//                   .sort(([a], [b]) => a.localeCompare(b))
//                   .map(([hour, hourFiles]) => (
//                     <div key={hour} className="mp-hour-group">
//                       <div className="mp-file-date">{hour}:00 h</div>
//                       {hourFiles.map((file) => (
//                         <div
//                           key={file.start_time || file.name}
//                           className={`mp-file-item ${playingFile?.start_time === file.start_time ? "playing" : ""}`}
//                           onClick={() => playFile(file)}
//                         >
//                           <div className="mp-file-icon">
//                             <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11">
//                               <polygon points="5 3 19 12 5 21 5 3" />
//                             </svg>
//                           </div>
//                           <div className="mp-file-info">
//                             <div className="mp-file-name">{file.start_time || file.name}</div>
//                             <div className="mp-file-meta">{file.size} • Recorded</div>
//                           </div>
//                           {playingFile?.start_time === file.start_time && (
//                             <div className="mp-file-active-ptr">
//                               <div className="mp-pulse-dot" />
//                             </div>
//                           )}
//                         </div>
//                       ))}
//                     </div>
//                   ))}
//             </div>
//           </div>

//           {/* ── Center: Player ────────────────────────────────── */}
//           <div className="mp-center">
//             <div className="mp-player-wrap" ref={playerWrap}>
//               {!playingFile ? (
//                 <div className="mp-player-empty">
//                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="52" height="52">
//                     <rect x="2" y="7" width="15" height="10" rx="2" />
//                     <path d="M17 9l5-3v12l-5-3" />
//                   </svg>
//                   <p>Select a recording from the browser to begin playback</p>
//                 </div>
//               ) : (
//                 <>
//                   <video ref={videoRef} className="mp-video" src={videoSrc} playsInline />
//                   <div className="mp-overlay-top">
//                     <div className="mp-cam-label">{playingFile.name}</div>
//                     <div className="mp-time-overlay">{fmt(currentTime)}</div>
//                   </div>
//                 </>
//               )}
//             </div>

//             {/* ── Horizontal 24-hour Timeline ──────────────────── */}
//             <div className="mp-bottom-timeline">
//               <div className="mp-tl-horizontal">
//                 {Array.from({ length: 24 }).map((_, h) => {
//                   const hourStr = String(h).padStart(2, "0");
//                   // All clips in this hour (full day picture, not just filtered)
//                   const hourFiles = files.filter((f) => extractHour(f) === h);
//                   const hasRec = hourFiles.length > 0;
//                   const inRange = h >= startTime && h <= endTime;
//                   const isPlaying = playingFile != null && extractHour(playingFile) === h;

//                   return (
//                     <div
//                       key={h}
//                       className={[
//                         "mp-tl-block",
//                         inRange ? "in-range" : "",
//                         hasRec ? "has-data" : "",
//                         isPlaying ? "playing" : "",
//                       ].filter(Boolean).join(" ")}
//                       title={
//                         hasRec
//                           ? `${hourFiles.length} clip(s) at ${hourStr}:00${!inRange ? " (outside filter)" : ""}`
//                           : `No recordings at ${hourStr}:00`
//                       }
//                       // Only clickable when there are clips AND the hour is inside the filter range
//                       onClick={() => hasRec && inRange && playFile(hourFiles[0])}
//                     >
//                       <div className="mp-tl-hour-tick">{hourStr}</div>
//                       <div className="mp-tl-bar">
//                         {hasRec && <div className="mp-tl-data-ptr" />}
//                         {isPlaying && <div className="mp-tl-play-head" />}
//                       </div>
//                     </div>
//                   );
//                 })}
//               </div>
//             </div>

//             {/* ── Playback Controls ─────────────────────────────── */}
//             <div className="mp-controls">
//               <div className="mp-progress-row">
//                 <span className="mp-time">{fmt(currentTime)}</span>
//                 <div className="mp-progress" onClick={seek}>
//                   <div
//                     className="mp-progress-fill"
//                     style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
//                   />
//                   <div
//                     className="mp-progress-thumb"
//                     style={{ left: duration ? `calc(${(currentTime / duration) * 100}% - 6px)` : "-6px" }}
//                   />
//                 </div>
//                 <span className="mp-time">{fmt(duration)}</span>
//               </div>

//               <div className="mp-ctrl-row">
//                 <button className="mp-ctrl-btn" onClick={playPrev} title="Previous">
//                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
//                     <polygon points="19 20 9 12 19 4 19 20" /><line x1="5" y1="19" x2="5" y2="5" />
//                   </svg>
//                 </button>
//                 <button className="mp-ctrl-btn" onClick={() => skip(-10)} title="-10s">
//                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
//                     <polyline points="1 4 1 10 7 10" />
//                     <path d="M3.51 15a9 9 0 1 0 .49-3.54" />
//                   </svg>
//                 </button>
//                 <button className="mp-ctrl-btn mp-play-btn" onClick={togglePlay}>
//                   {playing
//                     ? <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
//                     : <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3" /></svg>
//                   }
//                 </button>
//                 <button className="mp-ctrl-btn" onClick={() => skip(10)} title="+10s">
//                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
//                     <polyline points="23 4 23 10 17 10" />
//                     <path d="M20.49 15a9 9 0 1 1-.49-3.54" />
//                   </svg>
//                 </button>
//                 <button className="mp-ctrl-btn" onClick={playNext} title="Next">
//                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
//                     <polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" />
//                   </svg>
//                 </button>

//                 <div className="mp-ctrl-spacer" />

//                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"
//                   style={{ color: "#3a4055", flexShrink: 0 }}>
//                   <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
//                   <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
//                 </svg>
//                 <input
//                   type="range" min="0" max="1" step="0.05"
//                   value={volume}
//                   onChange={(e) => setVolume(Number(e.target.value))}
//                   className="mp-vol-slider"
//                 />

//                 {[1, 2, 4].map((s) => (
//                   <button
//                     key={s}
//                     className={`mp-speed-btn ${speed === s ? "active" : ""}`}
//                     onClick={() => setSpeed(s)}
//                   >
//                     {s}x
//                   </button>
//                 ))}

//                 <button className="mp-ctrl-btn" onClick={toggleFullscreen}>
//                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
//                     <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3" />
//                   </svg>
//                 </button>
//               </div>
//             </div>
//           </div>
//         </>
//       )}
//     </div>
//   );
// }



import { useState, useRef, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import Modal from "../../components/shared/Modal";
import "./MediaPlayerPage.css";

const STREAM_API = "http://localhost:8000";

// ── Extract the hour (0–23) from a recording file object ──────────────────────
// Handles formats like: "14-05-30", "cam1_14_05_30", "14:05:30"
function extractHour(file) {
  const raw = file.start_time || file.name || "";
  // HH-MM-SS or HH:MM:SS
  const dashColon = raw.match(/^(\d{2})[-:]/);
  if (dashColon) return parseInt(dashColon[1], 10);
  // name like "cam1_14_05_30" → second underscore segment
  const segments = raw.split("_");
  if (segments.length >= 2) {
    const h = parseInt(segments[1], 10);
    if (!isNaN(h) && h >= 0 && h <= 23) return h;
  }
  // Fallback: first two digits
  const digits = raw.match(/(\d{2})/);
  if (digits) return parseInt(digits[1], 10);
  return 0;
}

function fmt(s) {
  if (!s || isNaN(s)) return "00:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function loadDevices() {
  try { return JSON.parse(localStorage.getItem("miradorai_devices") || "[]"); }
  catch { return []; }
}

export default function MediaPlayerPage() {
  const { user } = useAuth();

  const [cameras] = useState(loadDevices);
  const [recordingCameras, setRecordingCameras] = useState([]);
  const [selectedCam, setSelectedCam] = useState(null);
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [playingFile, setPlayingFile] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [speed, setSpeed] = useState(1);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(23);
  const [expandedHours, setExpandedHours] = useState(new Set());

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportMode, setExportMode] = useState(null); // "current" or "range"
  const [exportStartDate, setExportStartDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [exportEndDate, setExportEndDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [exportStartTime, setExportStartTime] = useState(0);
  const [exportEndTime, setExportEndTime] = useState(23);
  const [exporting, setExporting] = useState(false);
  const videoRef = useRef(null);
  const playerWrap = useRef(null);

  // ── Fetch cameras that have recordings ────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${STREAM_API}/api/recordings/cameras`);
        if (res.ok) {
          const ids = await res.json();
          setRecordingCameras(ids);
          if (ids.length > 0)
            setSelectedCam((prev) => prev ?? { stream_key: ids[0], name: ids[0] });
        }
      } catch (e) { console.error("Failed to fetch recording cameras:", e); }
    })();
  }, []);

  // ── Fetch recordings when camera or date changes ──────────────────
  useEffect(() => {
    if (!selectedCam?.stream_key) return;
    let cancelled = false;
    (async () => {
      setLoadingFiles(true);
      setFiles([]);
      try {
        const res = await fetch(
          `${STREAM_API}/api/recordings/${selectedCam.stream_key}?date=${selectedDate}`
        );
        if (!cancelled && res.ok) {
          const data = await res.json();
          const raw = Array.isArray(data) ? data : (data.files || []);
          setFiles(raw.map((rec) => ({
            name: rec.start_time || rec.name || "",
            camera_id: rec.camera_id,
            date: rec.date,
            start_time: rec.start_time,
            size: rec.file_size || "—",
          })));
        }
      } catch { if (!cancelled) setFiles([]); }
      finally { if (!cancelled) setLoadingFiles(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedCam, selectedDate]);

  // ── Video event wiring ────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onMeta = () => setDuration(v.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
    };
  }, [playingFile]);

  useEffect(() => { if (videoRef.current) videoRef.current.volume = volume; }, [volume]);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed; }, [speed]);

  // ── Actions ───────────────────────────────────────────────────────
  const playFile = (file) => {
    setPlayingFile(file);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.load();
        videoRef.current.play().catch(() => { });
      }
    }, 100);
  };

  const playNext = () => {
    if (!playingFile) return;
    const idx = filteredFiles.findIndex((f) => f.start_time === playingFile.start_time);
    if (idx < filteredFiles.length - 1) playFile(filteredFiles[idx + 1]);
  };

  const playPrev = () => {
    if (!playingFile) return;
    const idx = filteredFiles.findIndex((f) => f.start_time === playingFile.start_time);
    if (idx > 0) playFile(filteredFiles[idx - 1]);
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    playing ? videoRef.current.pause() : videoRef.current.play();
  };

  const seek = (e) => {
    if (!videoRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    videoRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  };

  const skip = (secs) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(duration, currentTime + secs));
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) playerWrap.current?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  const toggleHourOpen = (hour) => {
    setExpandedHours((prev) => {
      const next = new Set(prev);
      if (next.has(hour)) next.delete(hour);
      else next.add(hour);
      return next;
    });
  };
const handleExportCurrent = async () => {
    if (!playingFile) return;

    setExporting(true);
    try {
      const directUrl = `${STREAM_API}/api/recordings/download?camera_id=${encodeURIComponent(playingFile.camera_id)}&date=${encodeURIComponent(playingFile.date)}&start_time=${encodeURIComponent(playingFile.start_time)}`;
      const filename = `${playingFile.camera_id}_${playingFile.date}_${playingFile.start_time}.mp4`;

      // ✅ Show file picker FIRST before any async fetch
      // (browsers block picker if not called directly from user gesture)
      let fileHandle = null;
      if (window.showSaveFilePicker) {
        try {
          fileHandle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: "MP4 Video", accept: { "video/mp4": [".mp4"] } }],
          });
        } catch (err) {
          if (err.name === "AbortError") {
            setExporting(false);
            return; // user cancelled, stop everything
          }
          // picker not supported or failed — will use anchor fallback
          fileHandle = null;
        }
      }

      // ✅ Now fetch the video
      const response = await fetch(directUrl);
      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("video")) {
        throw new Error("Server did not return a video file. Check backend logs.");
      }

      const blob = await response.blob();

      if (blob.size < 1000) {
        throw new Error(`File too small (${blob.size} bytes) — decryption may have failed.`);
      }

      // ✅ If we have a file handle, write to it
      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        // Fallback anchor download
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }

      alert(`✅ Exported successfully! (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
      setShowExportModal(false);
      setExportMode(null);

    } catch (error) {
      console.error("Export error:", error);
      if (error.name !== "AbortError") {
        alert("❌ Export failed: " + error.message);
      }
    } finally {
      setExporting(false);
    }
  };
  const handleExportRange = async () => {
    if (!selectedCam) return;

    setExporting(true);
    const payload = {
      camera_id: selectedCam.stream_key,
      start_date: exportStartDate,
      end_date: exportEndDate,
      start_hour: exportStartTime,
      end_hour: exportEndTime,
    };

    const directUrl = `${STREAM_API}/api/recordings/export-zip`;
    const filename = `recordings_${exportStartDate}_to_${exportEndDate}.zip`;

    try {
      // Modern saver
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }],
          });
          if (!handle) throw new Error("Save aborted");

          const response = await fetch(directUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!response.ok) throw new Error("Failed to create zip");

          const blob = await response.blob();
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();

          alert("Videos exported as ZIP successfully!");
          setShowExportModal(false);
          setExportMode(null);
          return;
        } catch (innerError) {
          console.warn("showSaveFilePicker fallback", innerError);
          // fallback to anchor download
        }
      }

      const response = await fetch(directUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Failed to create zip");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert("Videos exported as ZIP successfully (fallback)!");
      setShowExportModal(false);
      setExportMode(null);
    } catch (error) {
      console.error("Export error:", error);
      if (error.name !== "AbortError") {
        alert("Failed to export videos: " + error.message);
      }
    } finally {
      setExporting(false);
    }
  };

  // ── Derived: apply date + time-range filter ────────────────────────
  // filteredFiles = only recordings whose hour falls in [startTime, endTime]
  const filteredFiles = files.filter((f) => {
    const h = extractHour(f);
    return h >= startTime && h <= endTime;
  });

  // Group by hour for the sidebar
  const groupedFiles = filteredFiles.reduce((acc, f) => {
    const h = String(extractHour(f)).padStart(2, "0");
    (acc[h] = acc[h] || []).push(f);
    return acc;
  }, {});

  const videoSrc = playingFile?.camera_id && playingFile?.date && playingFile?.start_time
    ? `${STREAM_API}/api/recordings/play?camera_id=${playingFile.camera_id}&date=${playingFile.date}&start_time=${playingFile.start_time}`
    : null;

  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="mp-shell">
      {user?.role !== "admin" ? (
        <div className="mp-access-denied">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          <p>Admin access required</p>
          <span>This page is only accessible to administrators.</span>
        </div>
      ) : (
        <>
          {/* ── Left Panel ──────────────────────────────────── */}
          <div className="mp-left">
            <div className="mp-left-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <rect x="2" y="2" width="20" height="8" rx="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" />
              </svg>
              Media Browser
            </div>

            {/* Camera list */}
            <div className="mp-cam-section">Recorded Cameras</div>
            <div className="mp-cam-list">
              {recordingCameras.length === 0 && (
                <div className="mp-empty-small">No cameras with recordings</div>
              )}
              {recordingCameras.map((camId) => (
                <div
                  key={camId}
                  className={`mp-cam-item ${selectedCam?.stream_key === camId ? "active" : ""}`}
                  onClick={() => {
                    setSelectedCam({ stream_key: camId, name: camId });
                    setPlayingFile(null);
                  }}
                >
                  <div className="mp-cam-dot on" />
                  <div className="mp-cam-name">{camId}</div>
                  <div className="mp-cam-count">
                    {selectedCam?.stream_key === camId ? filteredFiles.length : "—"}
                  </div>
                </div>
              ))}
            </div>

            {/* Date + Time Range Filters */}
            <div className="mp-filters">
              <div className="mp-filter-group">
                <label className="mp-label">Date</label>
                <div className="mp-date-pick">
                  <input
                    type="date"
                    className="mp-date-input"
                    value={selectedDate}
                    max={new Date().toISOString().split("T")[0]}
                    onChange={(e) => { setSelectedDate(e.target.value); setPlayingFile(null); }}
                  />
                </div>
              </div>

              <div className="mp-filter-group">
                <label className="mp-label">
                  Time Range
                  <span className="mp-label-hint">
                    &nbsp;— {filteredFiles.length} clip{filteredFiles.length !== 1 ? "s" : ""}
                  </span>
                </label>
                <div className="mp-time-range-row">
                  <select
                    className="mp-select"
                    value={startTime}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setStartTime(v);
                      if (v > endTime) setEndTime(v);
                      setPlayingFile(null);
                    }}
                  >
                    {Array.from({ length: 24 }).map((_, i) => (
                      <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                    ))}
                  </select>
                  <span className="mp-range-sep">to</span>
                  <select
                    className="mp-select"
                    value={endTime}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setEndTime(v);
                      if (v < startTime) setStartTime(v);
                      setPlayingFile(null);
                    }}
                  >
                    {Array.from({ length: 24 }).map((_, i) => (
                      <option key={i} value={i}>{String(i).padStart(2, "0")}:59</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* File list — shows only filtered recordings */}
            <div className="mp-file-list">
              <div className="mp-cam-section">Matched Files</div>
              {loadingFiles && <div className="mp-empty-small">Loading…</div>}
              {!loadingFiles && filteredFiles.length === 0 && (
                <div className="mp-empty-small">No recordings for this range</div>
              )}
              {!loadingFiles &&
                Object.entries(groupedFiles)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([hour, hourFiles]) => {
                    const isOpen = expandedHours.has(hour);
                    return (
                      <div key={hour} className="mp-hour-group">
                        <button
                          type="button"
                          className={`mp-hour-header ${isOpen ? "open" : ""}`}
                          onClick={() => toggleHourOpen(hour)}
                        >
                          <span className={`mp-hour-toggle ${isOpen ? "open" : ""}`}>
                            {isOpen ? "▾" : "▸"}
                          </span>
                          <span className="mp-hour-label">{hour}:00 h</span>
                          <span className="mp-hour-count">{hourFiles.length} file{hourFiles.length !== 1 ? "s" : ""}</span>
                        </button>
                        {isOpen && hourFiles.map((file) => (
                          <div
                            key={file.start_time || file.name}
                            className={`mp-file-item ${playingFile?.start_time === file.start_time ? "playing" : ""}`}
                            onClick={() => playFile(file)}
                          >
                            <div className="mp-file-icon">
                              <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11">
                                <polygon points="5 3 19 12 5 21 5 3" />
                              </svg>
                            </div>
                            <div className="mp-file-info">
                              <div className="mp-file-name">{file.start_time || file.name}</div>
                              <div className="mp-file-meta">{file.size} • Recorded</div>
                            </div>
                            {playingFile?.start_time === file.start_time && (
                              <div className="mp-file-active-ptr">
                                <div className="mp-pulse-dot" />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })}
            </div>
          </div>

          {/* ── Center: Player ────────────────────────────────── */}
          <div className="mp-center">
            <div className="mp-player-wrap" ref={playerWrap}>
              {!playingFile ? (
                <div className="mp-player-empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="52" height="52">
                    <rect x="2" y="7" width="15" height="10" rx="2" />
                    <path d="M17 9l5-3v12l-5-3" />
                  </svg>
                  <p>Select a recording from the browser to begin playback</p>
                </div>
              ) : (
                <>
                  <video ref={videoRef} className="mp-video" src={videoSrc} playsInline />
                  <div className="mp-overlay-top">
                    <div className="mp-cam-label">{playingFile.name}</div>
                    <div className="mp-time-overlay">{fmt(currentTime)}</div>
                  </div>
                </>
              )}
            </div>

            {/* ── Horizontal 24-hour Timeline ──────────────────── */}
            <div className="mp-bottom-timeline">
              <div className="mp-tl-horizontal">
                {Array.from({ length: 24 }).map((_, h) => {
                  const hourStr = String(h).padStart(2, "0");
                  // All clips in this hour (full day picture, not just filtered)
                  const hourFiles = files.filter((f) => extractHour(f) === h);
                  const hasRec = hourFiles.length > 0;
                  const inRange = h >= startTime && h <= endTime;
                  const isPlaying = playingFile != null && extractHour(playingFile) === h;

                  return (
                    <div
                      key={h}
                      className={[
                        "mp-tl-block",
                        inRange ? "in-range" : "",
                        hasRec ? "has-data" : "",
                        isPlaying ? "playing" : "",
                      ].filter(Boolean).join(" ")}
                      title={
                        hasRec
                          ? `${hourFiles.length} clip(s) at ${hourStr}:00${!inRange ? " (outside filter)" : ""}`
                          : `No recordings at ${hourStr}:00`
                      }
                      // Only clickable when there are clips AND the hour is inside the filter range
                      onClick={() => hasRec && inRange && playFile(hourFiles[0])}
                    >
                      <div className="mp-tl-hour-tick">{hourStr}</div>
                      <div className="mp-tl-bar">
                        {hasRec && <div className="mp-tl-data-ptr" />}
                        {isPlaying && <div className="mp-tl-play-head" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Playback Controls ─────────────────────────────── */}
            <div className="mp-controls">
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

              <div className="mp-ctrl-row">
                <button className="mp-ctrl-btn" onClick={playPrev} title="Previous">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                    <polygon points="19 20 9 12 19 4 19 20" /><line x1="5" y1="19" x2="5" y2="5" />
                  </svg>
                </button>
                <button className="mp-ctrl-btn" onClick={() => skip(-10)} title="-10s">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 .49-3.54" />
                  </svg>
                </button>
                <button className="mp-ctrl-btn mp-play-btn" onClick={togglePlay}>
                  {playing
                    ? <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                    : <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  }
                </button>
                <button className="mp-ctrl-btn" onClick={() => skip(10)} title="+10s">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-.49-3.54" />
                  </svg>
                </button>
                <button className="mp-ctrl-btn" onClick={playNext} title="Next">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                    <polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" />
                  </svg>
                </button>

                <div className="mp-ctrl-spacer" />

                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"
                  style={{ color: "#3a4055", flexShrink: 0 }}>
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="mp-vol-slider"
                />

                {[1, 2, 4].map((s) => (
                  <button
                    key={s}
                    className={`mp-speed-btn ${speed === s ? "active" : ""}`}
                    onClick={() => setSpeed(s)}
                  >
                    {s}x
                  </button>
                ))}

                <button 
                  className="mp-ctrl-btn" 
                  onClick={() => {
                    setExportMode(null);
                    setShowExportModal(true);
                  }}
                  title="Export"
                  disabled={!playingFile && !selectedCam}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>

                <button className="mp-ctrl-btn" onClick={toggleFullscreen}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                    <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="mp-export-modal-overlay" onClick={() => !exporting && setShowExportModal(false)}>
          <div className="mp-export-modal card" onClick={(e) => e.stopPropagation()}>
            <div className="mp-export-header">
              <span className="mp-export-title">Export Recording</span>
              <button 
                className="mp-export-close" 
                onClick={() => !exporting && setShowExportModal(false)}
                disabled={exporting}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="mp-export-body">
              {!exportMode ? (
                <>
                  <p className="mp-export-intro">Choose export option:</p>
                  
                  <button 
                    className="mp-export-option"
                    onClick={() => setExportMode("current")}
                    disabled={!playingFile || exporting}
                  >
                    <div className="mp-export-option-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                        <path d="M23 7l-7 5 7 5V7z" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                    </div>
                    <div className="mp-export-option-content">
                      <div className="mp-export-option-title">Export This Video</div>
                      <div className="mp-export-option-desc">
                        Save the current recording as MP4 with browse location
                      </div>
                    </div>
                  </button>

                  <button 
                    className="mp-export-option"
                    onClick={() => setExportMode("range")}
                    disabled={!selectedCam || exporting}
                  >
                    <div className="mp-export-option-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                    </div>
                    <div className="mp-export-option-content">
                      <div className="mp-export-option-title">Export Date/Time Range</div>
                      <div className="mp-export-option-desc">
                        Select a date and time range to export multiple videos as ZIP
                      </div>
                    </div>
                  </button>
                </>
              ) : exportMode === "current" ? (
                <>
                  <p className="mp-export-label">Ready to export:</p>
                  <div className="mp-export-info">
                    <div className="mp-export-info-row">
                      <span className="mp-export-info-label">Camera:</span>
                      <span className="mp-export-info-value">{playingFile?.camera_id}</span>
                    </div>
                    <div className="mp-export-info-row">
                      <span className="mp-export-info-label">Recording:</span>
                      <span className="mp-export-info-value">{playingFile?.start_time}</span>
                    </div>
                    <div className="mp-export-info-row">
                      <span className="mp-export-info-label">Date:</span>
                      <span className="mp-export-info-value">{playingFile?.date}</span>
                    </div>
                  </div>
                  <p className="mp-export-note">Click "Export" to choose save location</p>
                </>
              ) : (
                <>
                  <p className="mp-export-label">Select Date & Time Range:</p>
                  
                  <div className="mp-export-range-section">
                    <div className="mp-export-range-group">
                      <label className="mp-export-date-label">Start Date</label>
                      <input
                        type="date"
                        className="mp-export-date-input"
                        value={exportStartDate}
                        max={new Date().toISOString().split("T")[0]}
                        onChange={(e) => setExportStartDate(e.target.value)}
                        disabled={exporting}
                      />
                    </div>

                    <div className="mp-export-range-group">
                      <label className="mp-export-date-label">End Date</label>
                      <input
                        type="date"
                        className="mp-export-date-input"
                        value={exportEndDate}
                        max={new Date().toISOString().split("T")[0]}
                        onChange={(e) => setExportEndDate(e.target.value)}
                        disabled={exporting}
                      />
                    </div>
                  </div>

                  <div className="mp-export-range-section">
                    <div className="mp-export-range-group">
                      <label className="mp-export-date-label">Start Hour</label>
                      <select
                        className="mp-export-select"
                        value={exportStartTime}
                        onChange={(e) => setExportStartTime(Number(e.target.value))}
                        disabled={exporting}
                      >
                        {Array.from({ length: 24 }).map((_, i) => (
                          <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                        ))}
                      </select>
                    </div>

                    <div className="mp-export-range-group">
                      <label className="mp-export-date-label">End Hour</label>
                      <select
                        className="mp-export-select"
                        value={exportEndTime}
                        onChange={(e) => setExportEndTime(Number(e.target.value))}
                        disabled={exporting}
                      >
                        {Array.from({ length: 24 }).map((_, i) => (
                          <option key={i} value={i}>{String(i).padStart(2, "0")}:59</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="mp-export-footer">
              <button 
                className="mp-export-btn mp-export-cancel"
                onClick={() => {
                  if (!exporting) {
                    if (exportMode) setExportMode(null);
                    else setShowExportModal(false);
                  }
                }}
                disabled={exporting}
              >
                {exportMode ? "Back" : "Cancel"}
              </button>
              
              {exportMode === "current" && (
                <button 
                  className="mp-export-btn mp-export-action"
                  onClick={handleExportCurrent}
                  disabled={exporting || !playingFile}
                >
                  {exporting ? "Exporting..." : "Export Video"}
                </button>
              )}
              
              {exportMode === "range" && (
                <button 
                  className="mp-export-btn mp-export-action"
                  onClick={handleExportRange}
                  disabled={exporting || !selectedCam}
                >
                  {exporting ? "Exporting..." : "Export as ZIP"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}