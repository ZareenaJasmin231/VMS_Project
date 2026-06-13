import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { useImageConfig, buildCSSFilter } from "../../hooks/useImageConfig";
import { useDigitalZoom } from "../../hooks/useDigitalZoom";
import "./MediaPlayerPage.css";

const STREAM_API = "http://localhost:80";

function getToken() {
  return (
    localStorage.getItem("miradorai_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    ""
  );
}
function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function extractHour(file) {
  const raw = file.start_time || file.name || "";
  const dashColon = raw.match(/^(\d{2})[-:]/);
  if (dashColon) return parseInt(dashColon[1], 10);
  const segments = raw.split("_");
  if (segments.length >= 2) {
    const h = parseInt(segments[1], 10);
    if (!isNaN(h) && h >= 0 && h <= 23) return h;
  }
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
  const { user, supervisorUnlocked } = useAuth();

  const videoRef = useRef(null);
  const playerWrap = useRef(null);

  const [cameras] = useState(loadDevices);
  const [recordingCameras, setRecordingCameras] = useState([]);
  const [activeRecorders, setActiveRecorders] = useState([]);
  const [selectedCam, setSelectedCam] = useState(null);

  const filteredCameras = useMemo(() => {
    if (user?.role === "admin" || !user?.allowedCameras || user?.allowedCameras.length === 0) {
      return cameras;
    }
    return cameras.filter(c => user.allowedCameras.includes(String(c.id)));
  }, [cameras, user]);

  const filteredRecordingCameras = useMemo(() => {
    if (user?.role === "admin" || !user?.allowedCameras || user?.allowedCameras.length === 0) {
      return recordingCameras;
    }
    return recordingCameras.filter(camId => {
      const normalized = camId.replace(/_/g, ".");
      const dev = cameras.find(c => 
        String(c.id) === String(camId) || 
        c.ip === camId || 
        (c.ip && c.ip.replace(/_/g, ".") === normalized)
      );
      if (!dev) return false;
      return user.allowedCameras.includes(String(dev.id));
    });
  }, [recordingCameras, cameras, user]);

  const actualRecordingCount = useMemo(() => {
    return filteredCameras.filter((cam) => {
      if (cam.enabled === false) return false;
      return activeRecorders.includes(cam.stream_key) || activeRecorders.includes(cam.ome_stream);
    }).length;
  }, [activeRecorders, filteredCameras]);

  const getCameraInfo = useCallback((camId) => {
    if (!camId) return { name: "No camera selected", ip: "" };
    if (camId === "Uploaded File") return { name: "Uploaded File", ip: "" };
    const normalized = camId.replace(/_/g, ".");
    const found = filteredCameras.find(
      (c) =>
        (c.ip && c.ip.replace(/_/g, ".") === normalized) ||
        String(c.id) === String(camId) ||
        c.name === camId
    );
    if (found) {
      return {
        name: found.name || `Camera ${normalized}`,
        ip: found.ip || normalized
      };
    }
    return {
      name: `Camera ${normalized}`,
      ip: normalized
    };
  }, [cameras]);

  const selectedCamInfo = useMemo(() => {
    return getCameraInfo(selectedCam?.stream_key);
  }, [selectedCam, getCameraInfo]);

  const configCameraId = selectedCam ?
    (filteredCameras.find(c => c.ip === selectedCam.stream_key || String(c.id) === String(selectedCam.stream_key) || c.name === selectedCam.stream_key)?.id || selectedCam.stream_key)
    : null;
  const { vals: imgVals, cssTransform } = useImageConfig(configCameraId);
  const { zoom, zoomTransform, handlers } = useDigitalZoom(playerWrap, videoRef);

  const [localSharpness, setLocalSharpness] = useState(0);

  useEffect(() => {
    if (imgVals && typeof imgVals.sharpness === "number") {
      setLocalSharpness(imgVals.sharpness);
    } else {
      setLocalSharpness(0);
    }
  }, [imgVals]);

  const customCssFilter = useMemo(() => {
    return buildCSSFilter({ ...imgVals, sharpness: localSharpness });
  }, [imgVals, localSharpness]);

  const [camDropdownOpen, setCamDropdownOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [playingFile, setPlayingFile] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [motionRanges, setMotionRanges] = useState([]);

  const [volume, setVolume] = useState(0.8);
  const [speed, setSpeed] = useState(1);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(23);
  const [expandedHours, setExpandedHours] = useState(new Set());

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportStartDate, setExportStartDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [exportEndDate, setExportEndDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [exportStartTime, setExportStartTime] = useState("00:00");
  const [exportEndTime, setExportEndTime] = useState("23:59");
  const [exporting, setExporting] = useState(false);
  const [snapshotFlash, setSnapshotFlash] = useState(false);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [toast, setToast] = useState(null); // { msg, type: 'success'|'error' }

  // Ref to track blob URL created from uploaded .enc so we can revoke it later
  const uploadedBlobUrl = useRef(null);

  const progressRef = useRef(null);
  const isDragging = useRef(false);
  const camDropdownRef = useRef(null);
  const browseInputRef = useRef(null);
  const timelineRef = useRef(null);
  const isTimelineDragging = useRef(false);

  // ── Toast helper ───────────────────────────────────────────────
  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Close camera dropdown on outside click ─────────────────────
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (camDropdownRef.current && !camDropdownRef.current.contains(e.target)) {
        setCamDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Fetch recording cameras on mount ──────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${STREAM_API}/api/recordings/cameras`, {
          headers: authHeaders(),
        });
        if (res.ok) {
          const ids = await res.json();
          setRecordingCameras(ids);
        }
      } catch (e) { console.error("Failed to fetch recording cameras:", e); }
    })();
  }, []);

  // ── Fetch active recording status on mount and poll ────────────
  useEffect(() => {
    const fetchRecordingStatus = async () => {
      try {
        const res = await fetch(`${STREAM_API}/api/recordings/status`, {
          headers: authHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          setActiveRecorders(data.active_recorders || []);
        }
      } catch (e) { console.error("Failed to fetch recording status:", e); }
    };
    fetchRecordingStatus();
    const interval = setInterval(fetchRecordingStatus, 8000);
    return () => clearInterval(interval);
  }, []);

  // ── Fetch file list when camera or date changes ────────────────
  useEffect(() => {
    if (!selectedCam?.stream_key) return;
    let cancelled = false;
    (async () => {
      setLoadingFiles(true);
      setFiles([]);
      try {
        const res = await fetch(
          `${STREAM_API}/api/recordings/${selectedCam.stream_key}?date=${selectedDate}`,
          { headers: authHeaders() }
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
            file_path: rec.file_path,
          })));
        }
      } catch { if (!cancelled) setFiles([]); }
      finally { if (!cancelled) setLoadingFiles(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedCam, selectedDate]);

  // ── Video event listeners ──────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onMeta = () => setDuration(v.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    const onLoadStart = () => setIsVideoLoading(true);
    const onCanPlay = () => setIsVideoLoading(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("loadstart", onLoadStart);
    v.addEventListener("canplay", onCanPlay);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("loadstart", onLoadStart);
      v.removeEventListener("canplay", onCanPlay);
    };
  }, [playingFile]);

  // ── Progress drag + Timeline drag ─────────────────────────────
  useEffect(() => {
    const handleMove = (e) => {
      // Progress bar drag
      if (isDragging.current && progressRef.current && duration) {
        const rect = progressRef.current.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (videoRef.current) {
          videoRef.current.currentTime = pct * duration;
          setCurrentTime(pct * duration);
        }
      }
      // Timeline drag
      if (isTimelineDragging.current && timelineRef.current && duration) {
        const rect = timelineRef.current.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (videoRef.current) {
          videoRef.current.currentTime = pct * duration;
          setCurrentTime(pct * duration);
        }
      }
    };
    const handleUp = () => {
      isDragging.current = false;
      isTimelineDragging.current = false;
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [duration]);

  // ── Keyboard shortcuts ─────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e) => {
      if (!videoRef.current) return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      switch (e.key) {
        case " ": e.preventDefault(); togglePlay(); break;
        case "ArrowLeft": e.preventDefault(); skip(-5); break;
        case "ArrowRight": e.preventDefault(); skip(5); break;
        case "j": case "J": skip(-10); break;
        case "l": case "L": skip(10); break;
        case "f": case "F": toggleFullscreen(); break;
        case "m": case "M":
          if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [playing, currentTime, duration]);

  useEffect(() => { if (videoRef.current) videoRef.current.volume = volume; }, [volume]);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed; }, [speed]);

  // ── Fetch motion alerts for timeline highlighting ──────────────
  useEffect(() => {
    if (!playingFile || !duration || playingFile.camera_id === "Uploaded File") {
      setMotionRanges([]);
      return;
    }

    let cancelled = false;
    const fetchMotionAlerts = async () => {
      try {
        const info = getCameraInfo(playingFile.camera_id);
        if (!info.ip) return;
        
        // Fetch up to 1000 alerts including software motion
        const res = await fetch(`${STREAM_API}/api/alerts?limit=1000&include_software_motion=true`, {
          headers: authHeaders()
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          const alertsList = data.alerts || [];
          
          // Parse start time of current playing video
          const match = playingFile.start_time.match(/(\d{2})[-:_](\d{2})[-:_](\d{2})/);
          if (!match) return;
          const [_, hh, mm, ss] = match;
          
          // Parse date parts manually for robust timezone-independent local comparison
          const matchDate = playingFile.date.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
          if (!matchDate) return;
          const [__, year, month, day] = matchDate;
          const fileStart = new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10),
            parseInt(hh, 10),
            parseInt(mm, 10),
            parseInt(ss, 10)
          );
          const fileStartMs = fileStart.getTime();
          const fileEndMs = fileStartMs + duration * 1000;
          
          // Helper: parse a time string into local milliseconds
          const parseLocalMs = (timeStr) => {
            if (!timeStr) return null;
            const d = new Date(timeStr);
            if (isNaN(d.getTime())) return null;
            // Re-construct from components to strip timezone offset issues
            return new Date(
              d.getFullYear(), d.getMonth(), d.getDate(),
              d.getHours(), d.getMinutes(), d.getSeconds()
            ).getTime();
          };
          
          const ranges = [];
          alertsList.forEach((alert) => {
            // Filter by camera IP and source "software_motion"
            const alertIpNormalized = alert.ip?.replace(/_/g, ".");
            const camIpNormalized = info.ip.replace(/_/g, ".");
            
            if (alertIpNormalized === camIpNormalized && alert.source === "software_motion") {
              // Use motion_start/motion_end for accurate ranges
              const startMs = parseLocalMs(alert.motion_start || alert.time);
              if (startMs === null) return;
              
              // If motion_end is not set (still active), default to start + 5s
              const endMs = parseLocalMs(alert.motion_end) || (startMs + 5000);
              
              // Check if the motion range overlaps with the video file time range
              if (endMs >= fileStartMs && startMs <= fileEndMs) {
                const startOffset = Math.max(0, (startMs - fileStartMs) / 1000);
                const endOffset = Math.min(duration, (endMs - fileStartMs) / 1000);
                if (endOffset > startOffset) {
                  ranges.push({ start: startOffset, end: endOffset });
                }
              }
            }
          });
          setMotionRanges(ranges);
        }
      } catch (err) {
        console.error("Error fetching motion alerts for timeline:", err);
      }
    };

    fetchMotionAlerts();
    return () => { cancelled = true; };
  }, [playingFile, duration, getCameraInfo]);

  // ── Revoke blob URL on unmount to avoid memory leaks ──────────
  useEffect(() => {
    return () => {
      if (uploadedBlobUrl.current) {
        URL.revokeObjectURL(uploadedBlobUrl.current);
        uploadedBlobUrl.current = null;
      }
    };
  }, []);

  // ── playFile ──────────────────────────────────────────────────
  const playFile = (file) => {
    // Revoke any previous uploaded blob URL
    if (uploadedBlobUrl.current) {
      URL.revokeObjectURL(uploadedBlobUrl.current);
      uploadedBlobUrl.current = null;
    }
    setPlayingFile(file);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setIsVideoLoading(true);
    setTimeout(() => {
      const v = videoRef.current;
      if (!v) return;
      v.crossOrigin = "anonymous";
      const cb = Date.now();
      const tk = getToken();
      v.src = `${STREAM_API}/api/recordings/play`
        + `?camera_id=${encodeURIComponent(file.camera_id)}`
        + `&date=${encodeURIComponent(file.date)}`
        + `&start_time=${encodeURIComponent(file.start_time)}`
        + `&_cb=${cb}`
        + (tk ? `&token=${encodeURIComponent(tk)}` : "");
      v.load();
      v.play().catch(() => { });
    }, 50);
  };

  // ── Browse & upload .enc file ──────────────────────────────────
  const handleBrowseFile = async (e) => {
    const file = e.target.files[0];
    // Reset input so the same file can be re-selected if needed
    if (browseInputRef.current) browseInputRef.current.value = "";
    if (!file) return;

    if (!file.name.endsWith(".enc")) {
      alert("Please select a valid .enc file");
      return;
    }

    try {
      setIsVideoLoading(true);

      // Revoke any previous uploaded blob URL before creating a new one
      if (uploadedBlobUrl.current) {
        URL.revokeObjectURL(uploadedBlobUrl.current);
        uploadedBlobUrl.current = null;
      }

      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${STREAM_API}/api/recordings/decrypt-file`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });

      if (!res.ok) {
        let errorDetail = `Decryption failed (${res.status})`;
        try {
          const errJson = await res.json();
          if (errJson && errJson.detail) {
            errorDetail = errJson.detail;
          }
        } catch (_) {}
        throw new Error(errorDetail);
      }

      const blob = await res.blob();
      const videoURL = URL.createObjectURL(blob);
      uploadedBlobUrl.current = videoURL;

      setPlayingFile({
        camera_id: "Uploaded File",
        date: "—",
        start_time: file.name,
      });
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);

      setTimeout(() => {
        const v = videoRef.current;
        if (!v) return;
        // No crossOrigin needed for blob URLs
        v.removeAttribute("crossorigin");
        v.src = videoURL;
        v.load();
        v.play().catch(() => { });
      }, 50);

    } catch (err) {
      console.error("Browse decrypt error:", err);
      alert("Failed to decrypt file: " + err.message);
    } finally {
      setIsVideoLoading(false);
    }
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
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    videoRef.current.currentTime = pct * duration;
    setCurrentTime(pct * duration);
  };

  const handleProgressMouseDown = (e) => {
    isDragging.current = true;
    seek(e);
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
      next.has(hour) ? next.delete(hour) : next.add(hour);
      return next;
    });
  };

  // ── Snapshot ──────────────────────────────────────────────────
  const handleSnapshot = async () => {
    if (!videoRef.current || !playingFile) return;
    const video = videoRef.current;
    const wasPaused = video.paused;
    if (!wasPaused) video.pause();

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");

    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const timestamp = fmt(currentTime).replace(/:/g, "-");
      const filename = `snapshot_${playingFile.camera_id}_${playingFile.date}_${timestamp}.png`;

      setSnapshotFlash(true);
      setTimeout(() => setSnapshotFlash(false), 300);

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("Canvas toBlob returned null"));
        }, "image/png");
      });

      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: "PNG Image", accept: { "image/png": [".png"] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          if (!wasPaused) video.play();
          return;
        } catch (err) {
          if (err.name === "AbortError") {
            if (!wasPaused) video.play();
            return;
          }
          console.warn("showSaveFilePicker failed, falling back:", err);
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);

      showToast("Snapshot saved successfully! ");
    } catch (err) {
      console.error("Snapshot error:", err);
      if (err.name === "SecurityError") {
        showToast("Snapshot failed: canvas security error (CORS). Check backend headers.", "error");
      } else {
        showToast("Snapshot failed: " + err.message, "error");
      }
    } finally {
      if (!wasPaused) video.play();
    }
  };

  // ── Download current video segment ────────────────────────────
  const handleDownloadVideo = async () => {
    if (!playingFile) return;

    const safeTime = playingFile.start_time.replace(/[:\/]/g, "-");
    const safeDate = playingFile.date.replace(/[:\/]/g, "-");
    const filename = `${playingFile.camera_id}_${safeDate}_${safeTime}.mp4`;
    const url = `${STREAM_API}/api/recordings/download`
      + `?camera_id=${encodeURIComponent(playingFile.camera_id)}`
      + `&date=${encodeURIComponent(playingFile.date)}`
      + `&start_time=${encodeURIComponent(playingFile.start_time)}`;

    try {
      // showSaveFilePicker MUST be called synchronously inside the click handler
      // (before any await), otherwise the browser blocks it as outside a user gesture.
      if (window.showSaveFilePicker) {
        let handle;
        try {
          handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: "MP4 Video", accept: { "video/mp4": [".mp4"] } }],
          });
        } catch (pickerErr) {
          if (pickerErr.name === "AbortError") return; // User cancelled
          // showSaveFilePicker not allowed — fall through to blob download
          handle = null;
        }

        if (handle) {
          // Now fetch the blob and write to the chosen location
          const response = await fetch(url, { headers: authHeaders() });
          if (!response.ok) throw new Error(`Server returned ${response.status}: ${response.statusText}`);
          const blob = await response.blob();
          if (blob.size === 0) throw new Error("Received empty file from server.");
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          showToast("Video saved successfully! ✓");
          return;
        }
      }

      // Fallback: fetch as blob → blob URL anchor download
      const response = await fetch(url, { headers: authHeaders() });
      if (!response.ok) throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      const blob = await response.blob();
      if (blob.size === 0) throw new Error("Received empty file from server.");

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      showToast("Video download started! ✓");

    } catch (err) {
      console.error("Download error:", err);
      showToast("Failed to download video: " + err.message, "error");
    }
  };

  // ── Export date range as ZIP ───────────────────────────────────
  const handleExportRange = async () => {
    if (!selectedCam) return;
    setExporting(true);
    const payload = {
      camera_id: selectedCam.stream_key,
      start_date: exportStartDate,
      end_date: exportEndDate,
      start_time: exportStartTime,
      end_time: exportEndTime,
    };
    const directUrl = `${STREAM_API}/api/recordings/export-zip`;
    const filename = `recordings_${exportStartDate}_to_${exportEndDate}.zip`;

    try {
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: "ZIP Archive", accept: { "application/zip": [".zip"] } }],
          });
          const response = await fetch(directUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(payload),
          });
          if (!response.ok) {
            const errBody = await response.json().catch(() => ({ detail: "Failed to create zip" }));
            throw new Error(errBody.detail || "Failed to create zip");
          }
          const blob = await response.blob();
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          setShowExportModal(false);
          showToast("Export ZIP saved successfully! ✓");
          return;
        } catch (innerError) {
          if (innerError.name === "AbortError") { setExporting(false); return; }
          throw innerError; // Let outer catch handle it
        }
      }

      const response = await fetch(directUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ detail: "Failed to create zip" }));
        throw new Error(errBody.detail || "Failed to create zip");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowExportModal(false);
      showToast("Export ZIP downloaded successfully! ✓");

    } catch (error) {
      if (error.name !== "AbortError") showToast("Failed to export: " + error.message, "error");
    } finally {
      setExporting(false);
    }
  };

  // ── Derived data ───────────────────────────────────────────────
  const filteredFiles = files.filter((f) => {
    const h = extractHour(f);
    return h >= startTime && h <= endTime;
  });

  const groupedFiles = filteredFiles.reduce((acc, f) => {
    const h = String(extractHour(f)).padStart(2, "0");
    (acc[h] = acc[h] || []).push(f);
    return acc;
  }, {});

  const getAbsoluteTime = (secondsOffset) => {
    if (!playingFile?.start_time) return "";
    const match = playingFile.start_time.match(/(\d{2})[-:_](\d{2})[-:_](\d{2})/);
    if (!match) return "";
    const [_, hh, mm, ss] = match;
    const d = new Date(selectedDate);
    d.setHours(parseInt(hh, 10), parseInt(mm, 10), parseInt(ss, 10), 0);
    d.setSeconds(d.getSeconds() + Math.floor(secondsOffset));
    return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  // ── Timeline ticks ─────────────────────────────────────────────
  const timelineTicks = useMemo(() => {
    if (!duration || duration <= 0) return [];
    // Determine a sensible tick interval based on video duration
    let interval;
    if (duration <= 30) interval = 5;
    else if (duration <= 60) interval = 10;
    else if (duration <= 300) interval = 30;
    else if (duration <= 900) interval = 60;
    else if (duration <= 3600) interval = 300;
    else interval = 600;

    const ticks = [];
    for (let t = 0; t <= duration; t += interval) {
      ticks.push(t);
    }
    // Always include the end
    if (ticks[ticks.length - 1] < duration) ticks.push(duration);
    return ticks;
  }, [duration]);

  const handleTimelineMouseDown = useCallback((e) => {
    if (!timelineRef.current || !duration) return;
    isTimelineDragging.current = true;
    const rect = timelineRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (videoRef.current) {
      videoRef.current.currentTime = pct * duration;
      setCurrentTime(pct * duration);
    }
  }, [duration]);

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="mp-shell">
      {/* ── Toast Notification ── */}
      {toast && (
        <div className={`mp-toast mp-toast-${toast.type}`}>
          {toast.type === "success" ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          )}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="lv-toolbar">
        <div className="lv-toolbar__left">
          <h1 className="lv-page-title">Playback</h1>
          <div className="lv-toolbar__stats">
            <span className="lv-toolbar__count">
              {actualRecordingCount} camera{actualRecordingCount !== 1 ? "s" : ""} recording
            </span>
          </div>
        </div>
      </div>

      <div className="mp-container">
        {(user?.role !== "admin" && !supervisorUnlocked) ? (
          <div className="mp-access-denied">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            <p>Admin access required</p>
          </div>
        ) : (
          <>
            {/* ── Left panel ── */}
            <div className="mp-left">
              {/* ── Custom Camera Dropdown ── */}
            <div className="mp-cam-section">Camera</div>
            <div className="mp-cam-dropdown-wrap" ref={camDropdownRef}>
              <button
                className={`mp-cam-select-btn ${camDropdownOpen ? "open" : ""}`}
                onClick={() => setCamDropdownOpen((o) => !o)}
                disabled={recordingCameras.length === 0}
              >
                <div className="mp-cam-dot" />
                <div className="mp-cam-select-val">
                  {selectedCam ? (
                    <div className="mp-cam-select-val-container">
                       <span className="mp-cam-select-name">
                        {selectedCamInfo.name}
                       </span>
                      {selectedCamInfo.ip && (
                        <span className="mp-cam-select-ip">
                          {selectedCamInfo.ip}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="mp-cam-select-name">Select Camera</span>
                  )}
                </div>
                <svg
                  className={`mp-cam-chevron ${camDropdownOpen ? "open" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  width="12"
                  height="12"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>

              {camDropdownOpen && (
                <div className="mp-cam-menu">
                  {filteredRecordingCameras.map((camId) => {
                    const info = getCameraInfo(camId);
                    return (
                      <div
                        key={camId}
                        className={`mp-cam-menu-item ${selectedCam?.stream_key === camId ? "active" : ""}`}
                        onClick={() => {
                          setSelectedCam({ stream_key: camId, name: camId });
                          setPlayingFile(null);
                          setCamDropdownOpen(false);
                        }}
                      >
                        <div className={`mp-cam-dot ${selectedCam?.stream_key === camId ? "on" : ""}`} />
                        <div className="mp-cam-menu-item-info">
                          <span className="mp-cam-menu-item-name">{info.name}</span>
                          <span className="mp-cam-menu-item-ip">{info.ip}</span>
                        </div>
                        {selectedCam?.stream_key === camId && (
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            width="11"
                            height="11"
                            style={{ marginLeft: "auto", color: "var(--amber)", flexShrink: 0 }}
                          >
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mp-filters">
              <input
                type="date"
                className="mp-date-input"
                value={selectedDate}
                onChange={(e) => { setSelectedDate(e.target.value); setPlayingFile(null); }}
              />
            </div>

            {/* ── Button Row: Browse + Export ── */}
            <div className="mp-button-row">
              <input
                ref={browseInputRef}
                type="file"
                accept=".enc"
                id="mp-browse-input"
                style={{ display: "none" }}
                onChange={handleBrowseFile}
              />
              <label htmlFor="mp-browse-input" className="mp-action-btn mp-browse-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Play
              </label>

              <button
                className="mp-action-btn mp-export-btn-side"
                onClick={() => setShowExportModal(true)}
                title="Export recordings by date range"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export
              </button>
            </div>

            <div className="mp-file-list">
              {loadingFiles && (
                <div className="mp-empty-small">Loading…</div>
              )}
              {!loadingFiles && filteredFiles.length === 0 && (
                <div className="mp-empty-small">No recordings found.</div>
              )}
              {Object.entries(groupedFiles).sort().map(([hour, hourFiles]) => {
                const isOpen = expandedHours.has(hour);
                return (
                  <div key={hour} className="mp-hour-group">
                    <button
                      className={`mp-hour-header ${isOpen ? "open" : ""}`}
                      onClick={() => toggleHourOpen(hour)}
                    >
                      <span className="mp-hour-toggle">{isOpen ? "▾" : "▸"}</span>
                      <span className="mp-hour-label">{hour}:00 h</span>
                      <span className="mp-hour-count">({hourFiles.length})</span>
                    </button>
                    {isOpen && hourFiles.map((file) => (
                      <div
                        key={file.start_time}
                        className={`mp-file-item ${playingFile?.start_time === file.start_time ? "playing" : ""}`}
                        onClick={() => playFile(file)}
                      >
                        <div className="mp-file-icon">
                          <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                        <div>
                          <div className="mp-file-name" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            {file.start_time}
                            {file.file_path && file.file_path.includes("_motion_based") && (
                              <span style={{
                                fontSize: "10px",
                                padding: "2px 5px",
                                background: "rgba(239, 68, 68, 0.2)",
                                color: "#f87171",
                                border: "1px solid rgba(239, 68, 68, 0.4)",
                                borderRadius: "3px",
                                fontWeight: "600",
                                textTransform: "uppercase"
                              }}>
                                Motion
                              </span>
                            )}
                          </div>
                          {file.size !== "—" && (
                            <div className="mp-file-meta">{file.size}</div>
                          )}
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

          {/* ── Center / player ── */}
          <div className="mp-center">
            <div 
              className="mp-player-wrap" 
              ref={playerWrap}
              {...handlers}
              style={{ overflow: 'hidden', cursor: zoom > 1 ? 'grab' : 'default', position: 'relative' }}
            >
              {snapshotFlash && <div className="mp-snapshot-flash" />}

              {!playingFile ? (
                <div className="mp-player-empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="56" height="56">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path d="M8 21h8M12 17v4" />
                    <circle cx="12" cy="10" r="3" />
                    <path d="M10.5 10l3 1.5-3 1.5z" fill="currentColor" />
                  </svg>
                  <p>Select a recording from the browser to begin playback</p>
                </div>
              ) : (
                <>
                  <div className="mp-overlay-top">
                    <span className="mp-cam-label">
                      {getCameraInfo(playingFile.camera_id).name} — {playingFile.date}
                    </span>
                    <span className="mp-time-overlay">
                      {getAbsoluteTime(currentTime) || fmt(currentTime)}
                    </span>
                  </div>
                  <video
                    ref={videoRef}
                    className="mp-video"
                    playsInline
                    style={{
                      filter: customCssFilter || 'none',
                      transform: `${cssTransform || 'none'} ${zoomTransform}`,
                      transition: "filter 0.1s ease, transform 0.2s ease"
                    }}
                  />
                  {isVideoLoading && (
                    <div className="mp-loading-overlay">
                      <div className="mp-spinner"></div>
                      <p>Loading and decrypting video...</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Controls ── */}
            <div className="mp-controls">
              <div className="mp-progress-row">
                <span className="mp-time">{fmt(currentTime)}</span>
                <div
                  className="mp-progress"
                  ref={progressRef}
                  onMouseDown={handleProgressMouseDown}
                  onClick={seek}
                >
                  <div
                    className="mp-progress-fill"
                    style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
                  />
                  <div
                    className="mp-progress-thumb"
                    style={{ left: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
                  />
                </div>
                <span className="mp-time">{fmt(duration)}</span>
              </div>

              <div className="mp-ctrl-row">
                <button className="mp-ctrl-btn" onClick={playPrev} disabled={!playingFile} title="Previous (←)">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
                  </svg>
                </button>

                <button className="mp-ctrl-btn" onClick={() => skip(-10)} disabled={!playingFile} title="Back 10s (J)">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M12 5V2L8 6l4 4V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                    <text x="9" y="15" fontSize="5" fill="currentColor">10</text>
                  </svg>
                </button>

                <button
                  className="mp-ctrl-btn mp-play-btn"
                  onClick={togglePlay}
                  disabled={!playingFile}
                  title="Play/Pause (Space)"
                >
                  {playing ? (
                    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                <button className="mp-ctrl-btn" onClick={() => skip(10)} disabled={!playingFile} title="Forward 10s (L)">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M12 5V2l4 4-4 4V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
                    <text x="9" y="15" fontSize="5" fill="currentColor">10</text>
                  </svg>
                </button>

                <button className="mp-ctrl-btn" onClick={playNext} disabled={!playingFile} title="Next (→)">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                  </svg>
                </button>

                <div className="mp-ctrl-spacer" />

                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                </svg>
                <input
                  type="range"
                  className="mp-vol-slider"
                  min="0" max="1" step="0.05"
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                />

                <div className="mp-ctrl-spacer" />

                {/* Sharpness Scrollbar */}
                <div className="mp-sharpness-container">
                  <span className="mp-sharpness-label" title="Sharpen Video">SHARP:</span>
                  <input
                    type="range"
                    className="mp-sharpness-slider"
                    min="-100"
                    max="100"
                    step="5"
                    value={localSharpness}
                    onChange={(e) => setLocalSharpness(Number(e.target.value))}
                    disabled={!playingFile}
                  />
                  <span className="mp-sharpness-value">
                    {localSharpness > 0 ? "+" : ""}{localSharpness}
                  </span>
                </div>

                <div className="mp-ctrl-spacer" />

                {[0.5, 1, 1.5, 2].map((s) => (
                  <button
                    key={s}
                    className={`mp-speed-btn ${speed === s ? "active" : ""}`}
                    onClick={() => setSpeed(s)}
                  >
                    {s}×
                  </button>
                ))}

                <div className="mp-ctrl-spacer" />

                <button
                  className="mp-ctrl-btn mp-snapshot-btn"
                  onClick={handleSnapshot}
                  disabled={!playingFile}
                  title="Snapshot current frame"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="17" height="17">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </button>

                <button
                  className="mp-ctrl-btn mp-download-btn"
                  onClick={handleDownloadVideo}
                  disabled={!playingFile}
                  title="Download current video segment"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="17" height="17">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>

                <button
                  className="mp-ctrl-btn"
                  onClick={toggleFullscreen}
                  title="Fullscreen (F)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="17" height="17">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                </button>
              </div>
            </div>

            {/* ── Timescale / Timeline ── */}
            {playingFile && duration > 0 && (
              <div className="mp-timescale">
                <div className="mp-timescale-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="12" height="12">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span className="mp-timescale-label">Timeline</span>
                  <span className="mp-timescale-range">
                    {getAbsoluteTime(0) || fmt(0)} — {getAbsoluteTime(duration) || fmt(duration)}
                  </span>
                </div>
                <div
                  className="mp-timescale-track"
                  ref={timelineRef}
                  onMouseDown={handleTimelineMouseDown}
                >
                  {/* Filled portion */}
                  <div
                    className="mp-timescale-fill"
                    style={{ width: `${(currentTime / duration) * 100}%` }}
                  />

                  {/* Motion Ranges */}
                  {motionRanges.map((range, idx) => {
                    const leftPct = (range.start / duration) * 100;
                    const widthPct = Math.max(0.8, ((range.end - range.start) / duration) * 100);
                    return (
                      <div
                        key={idx}
                        className="mp-timescale-motion-range"
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`
                        }}
                        title={`Motion Detected: ${getAbsoluteTime(range.start) || fmt(range.start)} — ${getAbsoluteTime(range.end) || fmt(range.end)}`}
                      />
                    );
                  })}

                  {/* Tick marks and labels */}
                  {timelineTicks.map((t, i) => {
                    const pct = (t / duration) * 100;
                    const isFirst = i === 0;
                    const isLast = i === timelineTicks.length - 1;
                    const isMajor = isFirst || isLast || t % (duration <= 300 ? 60 : 300) === 0;
                    return (
                      <div
                        key={t}
                        className={`mp-timescale-tick ${isMajor ? "major" : "minor"}`}
                        style={{ left: `${pct}%` }}
                      >
                        <div className="mp-timescale-tick-line" />
                        {isMajor && !isFirst && !isLast && (
                          <span className="mp-timescale-tick-label">
                            {getAbsoluteTime(t) || fmt(t)}
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {/* Playhead */}
                  <div
                    className="mp-timescale-playhead"
                    style={{ left: `${(currentTime / duration) * 100}%` }}
                  >
                    <div className="mp-timescale-playhead-flag">
                      {getAbsoluteTime(currentTime) || fmt(currentTime)}
                    </div>
                    <div className="mp-timescale-playhead-needle" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      </div>

      {/* ── Export Modal (Date Range Only) ── */}
      {showExportModal && (
        <div
          className="mp-export-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !exporting) {
              setShowExportModal(false);
            }
          }}
        >
          <div className="mp-export-modal">
            <div className="mp-export-header">
              <span className="mp-export-title">Export Recordings — {selectedCamInfo.name || "Camera"}</span>
              <button
                className="mp-export-close"
                onClick={() => { if (!exporting) setShowExportModal(false); }}
                disabled={exporting}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mp-export-body">
              <div className="mp-export-range-section">
                <div className="mp-export-range-group">
                  <label className="mp-export-date-label">Start Date</label>
                  <input type="date" className="mp-export-date-input" value={exportStartDate}
                    onChange={(e) => setExportStartDate(e.target.value)} disabled={exporting} />
                </div>
                <div className="mp-export-range-group">
                  <label className="mp-export-date-label">End Date</label>
                  <input type="date" className="mp-export-date-input" value={exportEndDate}
                    onChange={(e) => setExportEndDate(e.target.value)} disabled={exporting} />
                </div>
                <div className="mp-export-range-group">
                  <label className="mp-export-date-label">Start Time</label>
                  <select className="mp-export-select" value={exportStartTime}
                    onChange={(e) => setExportStartTime(e.target.value)} disabled={exporting}>
                    {Array.from({ length: 48 }, (_, i) => {
                      const h = Math.floor(i / 2);
                      const m = i % 2 === 0 ? "00" : "30";
                      return `${String(h).padStart(2, "0")}:${m}`;
                    }).map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="mp-export-range-group">
                  <label className="mp-export-date-label">End Time</label>
                  <select className="mp-export-select" value={exportEndTime}
                    onChange={(e) => setExportEndTime(e.target.value)} disabled={exporting}>
                    {Array.from({ length: 48 }, (_, i) => {
                      const h = Math.floor(i / 2);
                      const m = i % 2 === 0 ? "00" : "30";
                      return `${String(h).padStart(2, "0")}:${m}`;
                    }).map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                    <option value="23:59">23:59</option>
                  </select>
                </div>
              </div>
              <p className="mp-export-note">
                All recordings in this date and hour range will be decrypted and bundled into a ZIP archive.
              </p>
            </div>

            <div className="mp-export-footer">
              <button
                className="mp-export-btn mp-export-cancel"
                onClick={() => setShowExportModal(false)}
                disabled={exporting}
              >
                Cancel
              </button>
              <button
                className="mp-export-btn mp-export-action"
                onClick={handleExportRange}
                disabled={exporting || !selectedCam}
              >
                {exporting ? "Exporting…" : "Download ZIP"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}