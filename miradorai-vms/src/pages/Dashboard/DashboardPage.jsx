import React, { useState, useEffect, useRef } from "react";
import "./DashboardPage.css";
import {
  Camera,
  Activity,
  Bell,
  HardDrive,
  AlertTriangle,
  Server,
  Cpu,
  MemoryStick,
  Calendar,
  Download
} from "lucide-react";
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:80";

const getAuthHeaders = () => {
  const token = localStorage.getItem("miradorai_token");
  return token ? { "Authorization": "Bearer " + token } : {};
};


const formatLocalDatetime = (date) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const getInitialFromDate = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return formatLocalDatetime(d);
};

const getInitialToDate = () => {
  const d = new Date();
  return formatLocalDatetime(d);
};

// ── CPU: Smooth area chart showing trend over time ──
const CpuAreaChart = ({ data, value }) => {
  const height = 64;
  const width = 220;
  if (!data || data.length < 2) return <div style={{ height }} />;

  // Scale 0-100 to chart height with some padding
  const padTop = 4;
  const padBot = 4;
  const chartH = height - padTop - padBot;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = padTop + chartH - (val / 100) * chartH;
    return { x, y };
  });

  // Smooth curve using cubic bezier
  let pathD = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx1 = prev.x + (curr.x - prev.x) * 0.4;
    const cpx2 = prev.x + (curr.x - prev.x) * 0.6;
    pathD += ` C ${cpx1},${prev.y} ${cpx2},${curr.y} ${curr.x},${curr.y}`;
  }

  const areaD = `${pathD} L ${width},${height} L 0,${height} Z`;
  const lineColor = value > 85 ? '#ef4444' : value > 60 ? '#f59e0b' : '#10b981';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="cpu-area-chart" preserveAspectRatio="none">
      <defs>
        <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Threshold line at 85% */}
      <line x1="0" y1={padTop + chartH - (85 / 100) * chartH} x2={width} y2={padTop + chartH - (85 / 100) * chartH}
        stroke="#ef4444" strokeWidth="0.5" strokeDasharray="4 3" opacity="0.4" />
      {/* Threshold line at 60% */}
      <line x1="0" y1={padTop + chartH - (60 / 100) * chartH} x2={width} y2={padTop + chartH - (60 / 100) * chartH}
        stroke="#f59e0b" strokeWidth="0.5" strokeDasharray="4 3" opacity="0.3" />
      <path d={areaD} fill="url(#cpuGrad)" />
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Current value dot */}
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={lineColor} />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="5" fill={lineColor} opacity="0.3" />
    </svg>
  );
};

// ── RAM: Horizontal usage gauge ──
const RamUsageGauge = ({ value }) => {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#10b981';
  const free = Math.round(100 - pct);

  return (
    <div className="ram-usage-gauge">
      <div className="ram-gauge-bar">
        <div
          className="ram-gauge-fill"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}88, ${color})` }}
        >
          {pct > 15 && <span className="ram-fill-label">{Math.round(pct)}%</span>}
        </div>
        {free > 10 && (
          <div className="ram-gauge-free">
            <span className="ram-free-label">{free}% free</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Disk: Horizontal segmented usage bar ──
const DiskUsageBar = ({ value, used, total }) => {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct > 90 ? '#ef4444' : pct > 75 ? '#f59e0b' : '#10b981';

  return (
    <div className="disk-bar-wrapper">
      <div className="disk-bar-track">
        <div
          className="disk-bar-fill"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}cc, ${color})`,
            transition: 'width 0.6s ease'
          }}
        />
        {/* Segment markers at 25%, 50%, 75% */}
        <div className="disk-bar-marker" style={{ left: '25%' }} />
        <div className="disk-bar-marker" style={{ left: '50%' }} />
        <div className="disk-bar-marker" style={{ left: '75%' }} />
      </div>
      <div className="disk-bar-labels">
        <span className="disk-bar-used" style={{ color }}>{used || `${pct}%`}</span>
        <span className="disk-bar-total">{total ? `/ ${total}` : '/ 100%'}</span>
      </div>
    </div>
  );
};

// ── Disk: Donut gauge ──
const DiskDonut = ({ value, used, total }) => {
  const size = 80;
  const strokeW = 7;
  const radius = (size - strokeW) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(100, Math.max(0, value));
  const dashOffset = circumference - (pct / 100) * circumference;
  const color = pct > 90 ? '#ef4444' : pct > 75 ? '#f59e0b' : '#10b981';

  return (
    <div className="disk-donut-container">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="disk-donut-svg">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeW}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={strokeW}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.3s ease' }}
        />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
          fill={color} fontSize="14" fontWeight="700" fontFamily="var(--font-ui)">
          {Math.round(pct)}%
        </text>
      </svg>
      <span className="disk-donut-sub">{used} / {total} GB</span>
    </div>
  );
};

// ── Mini Arc Gauge for stat cards ──
const MiniArcGauge = ({ value, label, thresholds = [60, 85], invert = false }) => {
  const size = 64;
  const strokeW = 5;
  const radius = (size - strokeW) / 2;
  // Semi-circle (180 degrees)
  const halfCirc = Math.PI * radius;
  const pct = Math.min(100, Math.max(0, value));
  const offset = halfCirc - (pct / 100) * halfCirc;

  let color;
  if (invert) {
    // For recording cameras: high % = good (green), low % = bad (red)
    color = pct >= thresholds[1] ? '#10b981' : pct >= thresholds[0] ? '#f59e0b' : '#ef4444';
  } else {
    // For disk: high % = bad (red)
    color = pct > thresholds[1] ? '#ef4444' : pct > thresholds[0] ? '#f59e0b' : '#10b981';
  }

  return (
    <div className="mini-arc-container">
      <svg width={size} height={size / 2 + 6} viewBox={`0 0 ${size} ${size / 2 + 6}`}>
        {/* Background track */}
        <path
          d={`M ${strokeW / 2},${size / 2} A ${radius},${radius} 0 0,1 ${size - strokeW / 2},${size / 2}`}
          fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeW} strokeLinecap="round"
        />
        {/* Progress arc */}
        <path
          d={`M ${strokeW / 2},${size / 2} A ${radius},${radius} 0 0,1 ${size - strokeW / 2},${size / 2}`}
          fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round"
          strokeDasharray={halfCirc}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.3s ease' }}
        />
      </svg>
      <span className="mini-arc-label" style={{ color }}>{label}</span>
    </div>
  );
};

const timeAgo = (date) => {
  if (!date) return 'Never';
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const DashboardPage = () => {
  const [summary, setSummary] = useState({
    total_cameras: 0,
    active_streams: 0,
    alarms_today: 0,
    cpu: 0,
    ram: 0,
    disk: 0,
    alerts: [],
    status: "Healthy",
    history: { cpu: [], ram: [], disk: [] }
  });
  const [storage, setStorage] = useState({ total: 0, used: 0, free: 0, location: "—" });
  const [events, setEvents] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [activeRecorders, setActiveRecorders] = useState([]);
  const [loading, setLoading] = useState(true);

  const recordingCount = cameras.filter((cam) => {
    if (cam.enabled === false) return false;
    return activeRecorders.includes(cam.stream_key) || activeRecorders.includes(cam.ome_stream);
  }).length;

  const enabledCount = cameras.filter((cam) => cam.enabled !== false).length;
  const [cameraHealth, setCameraHealth] = useState([]);

  // ─── NEW: Report Generation States ─────────────────────────────────────────
  const [reportFromDate, setReportFromDate] = useState(getInitialFromDate());
  const [reportToDate, setReportToDate] = useState(getInitialToDate());
  const [reportType, setReportType] = useState("alerts");
  const [reportData, setReportData] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportCurrentPage, setReportCurrentPage] = useState(1);
  const [reportDropdownOpen, setReportDropdownOpen] = useState(false);
  const [reportSuccessMsg, setReportSuccessMsg] = useState("");
  const [reportErrorMsg, setReportErrorMsg] = useState("");
  const reportPerPage = 10;

  const reportRef = useRef(null);

  const reportTypeMap = {
    alerts: "Camera Up/Down History",
    live_alerts: "Live View Alerts",
    health: "Device Health & Uptime Status"
  };

  const handleGenerateReport = async () => {
    setReportLoading(true);
    setReportSuccessMsg("");
    setReportErrorMsg("");
    try {
      const fromTime = new Date(reportFromDate).getTime();
      const toTime = new Date(reportToDate).getTime();

      if (reportType === "alerts") {
        // Query recent alerts and filter by date range
        const res = await fetch(`${API_BASE}/api/infrastructure/alerts?limit=5000`, {
          headers: getAuthHeaders()
        });
        const alertsData = await res.json();
        
        if (Array.isArray(alertsData)) {
          const filtered = alertsData.filter(a => {
            const ts = new Date(a.timestamp).getTime();
            return ts >= fromTime && ts <= toTime;
          });
          
          const formatted = filtered.map(a => ({
            timestamp: a.timestamp,
            ip: a.ip || "—",
            model: a.model || "—",
            type: a.type || "—",
            event: a.event || "—",
            message: a.message || "—",
            acknowledged: a.acknowledged ? "Yes" : "No"
          }));
          
          setReportData(formatted);
          setReportCurrentPage(1);
          if (formatted.length > 0) {
            setReportSuccessMsg(`Successfully generated report with ${formatted.length} camera up/down history records.`);
          } else {
            setReportSuccessMsg("No camera up/down history records found for the selected time range.");
          }
        } else {
          setReportErrorMsg("Failed to fetch alerts from server.");
        }
      } else if (reportType === "live_alerts") {
        // Query Real-Time MQTT Alerts and filter by date range
        const res = await fetch(`${API_BASE}/api/alerts?limit=5000`, {
          headers: getAuthHeaders()
        });
        const alertsRes = await res.json();
        const alertsList = Array.isArray(alertsRes) ? alertsRes : (alertsRes.alerts || []);
        
        if (Array.isArray(alertsList)) {
          const filtered = alertsList.filter(a => {
            const timeVal = a.received_at || a.time;
            if (!timeVal) return false;
            
            // Normalize time-only strings or standard timestamps to local datetime strings
            let finalDateStr = timeVal;
            if (!timeVal.includes("-") && !timeVal.includes("T")) {
              const d = new Date();
              const pad = (n) => String(n).padStart(2, "0");
              const todayLocalStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
              finalDateStr = `${todayLocalStr}T${timeVal}`;
            }
            
            // Normalize space to T for parsing compatibility
            finalDateStr = finalDateStr.replace(" ", "T");
            
            const ts = new Date(finalDateStr).getTime();
            return !isNaN(ts) && ts >= fromTime && ts <= toTime;
          });
          
          const formatted = filtered.map(a => ({
            timestamp: a.received_at || "—",
            ip_address: a.ip ? a.ip.replace(/_/g, ".") : "—",
            time_only: a.time || "—",
            scenario: a.scenario || "—",
            classification: a.type || "—"
          }));
          
          setReportData(formatted);
          setReportCurrentPage(1);
          if (formatted.length > 0) {
            setReportSuccessMsg(`Successfully generated report with ${formatted.length} live view alerts.`);
          } else {
            setReportSuccessMsg("No live view alerts found for the selected time range.");
          }
        } else {
          setReportErrorMsg("Failed to fetch Live View alerts from server.");
        }
      } else if (reportType === "health") {
        // Query topology nodes for health status
        const res = await fetch(`${API_BASE}/api/infrastructure/topology`, {
          headers: getAuthHeaders()
        });
        const topoData = await res.json();
        
        if (topoData && Array.isArray(topoData.nodes)) {
          const formatted = topoData.nodes.map(n => ({
            device_id: n.id || "—",
            ip_address: n.ip || "—",
            manufacturer: n.manufacturer || "—",
            model: n.model || "—",
            device_type: n.type || "—",
            current_status: n.status || "offline",
            latency_ms: n.latency !== undefined && n.latency !== null ? `${n.latency} ms` : "—",
            uptime_duration: n.uptime || "—",
            online_since: n.last_seen || "—",
            reboot_count: n.reboot_count !== undefined ? String(n.reboot_count) : "0",
            last_reboot: n.last_reboot || "—"
          }));
          
          setReportData(formatted);
          setReportCurrentPage(1);
          if (formatted.length > 0) {
            setReportSuccessMsg(`Successfully generated health report with ${formatted.length} devices.`);
          } else {
            setReportSuccessMsg("No active devices found in infrastructure topology.");
          }
        } else {
          setReportErrorMsg("Failed to fetch network topology from server.");
        }
      }
    } catch (err) {
      console.error(err);
      setReportErrorMsg("An error occurred while generating the report.");
    } finally {
      setReportLoading(false);
      setTimeout(() => {
        reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  };

  const handleDownloadCSV = () => {
    if (!reportData || reportData.length === 0) return;

    const headers = Object.keys(reportData[0]);
    const csvRows = [];
    
    csvRows.push(headers.join(","));

    for (const row of reportData) {
      const values = headers.map(header => {
        const val = row[header];
        const escaped = ("" + (val === null || val === undefined ? "" : val)).replace(/"/g, '""');
        return `"${escaped}"`;
      });
      csvRows.push(values.join(","));
    }

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${reportType}_report_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Pagination for report
  const indexOfLastReport = reportCurrentPage * reportPerPage;
  const indexOfFirstReport = indexOfLastReport - reportPerPage;
  const currentReportRows = reportData.slice(indexOfFirstReport, indexOfLastReport);
  const totalReportPages = Math.ceil(reportData.length / reportPerPage);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sumRes, storRes, eventRes, camRes, statusRes] = await Promise.all([
          fetch(`${API_BASE}/api/dashboard/summary`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE}/api/storage/management`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE}/api/dashboard/events`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE}/api/cameras/`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE}/api/recordings/status`, { headers: getAuthHeaders() }).catch(() => null)
        ]);

        const sumData = await sumRes.json();
        const storData = await storRes.json();
        const eventData = await eventRes.json();
        const camData = await camRes.json();

        if (statusRes && statusRes.ok) {
          const statusData = await statusRes.json();
          setActiveRecorders(statusData.active_recorders || []);
        }

        // Fetch history for the VMS host (assuming it's node-172-19-0-6 or similar)
        // We'll try to find the host node first or just fetch history if we have an ID
        try {
          const topoRes = await fetch(`${API_BASE}/api/infrastructure/topology`, { headers: getAuthHeaders() });
          const topoData = await topoRes.json();
          const hostNode = topoData.nodes.find(n => n.model === "VMS Host");
          if (hostNode) {
            const histRes = await fetch(`${API_BASE}/api/infrastructure/nodes/${hostNode.id}/history`, { headers: getAuthHeaders() });
            if (histRes.ok) {
              const histData = await histRes.json();
              if (Array.isArray(histData)) {
                sumData.history = {
                  cpu: histData.map(h => h.metrics?.cpu || 0),
                  ram: histData.map(h => h.metrics?.ram || 0),
                  disk: histData.map(h => h.metrics?.disk || 0)
                };
              }
            }
          }
        } catch (hErr) {
          console.warn("History fetch failed:", hErr);
        }

        setSummary(prev => {
          let history = sumData.history;
          if (!history || !history.cpu || history.cpu.length === 0) {
            // Accumulate locally if history isn't returned by the API
            const prevCpu = prev.history?.cpu || [];
            const prevRam = prev.history?.ram || [];
            const prevDisk = prev.history?.disk || [];

            // Seed initial 15 points if history is completely empty
            const cpuHist = prevCpu.length > 0
              ? [...prevCpu, sumData.cpu]
              : Array.from({ length: 15 }, () => Math.max(5, Math.min(95, sumData.cpu + Math.floor((Math.random() - 0.5) * 10))));

            const ramHist = prevRam.length > 0
              ? [...prevRam, sumData.ram]
              : Array.from({ length: 15 }, () => Math.max(5, Math.min(95, sumData.ram + Math.floor((Math.random() - 0.5) * 10))));

            const diskHist = prevDisk.length > 0
              ? [...prevDisk, sumData.disk]
              : Array.from({ length: 15 }, () => Math.max(1, Math.min(99, sumData.disk + Math.floor((Math.random() - 0.5) * 2))));

            history = {
              cpu: cpuHist.slice(-20),
              ram: ramHist.slice(-20),
              disk: diskHist.slice(-20)
            };
          }
          return {
            ...sumData,
            history
          };
        });
        if (storData && storData.length > 0) setStorage(storData[0]);
        setEvents(eventData);
        setCameras(camData);
      } catch (err) {
        console.error("Dashboard fetch error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/camera-health`, { headers: getAuthHeaders() })
      .then(res => res.json())
      .then(data => setCameraHealth(data))
      .catch(err => console.error("Camera health fetch error:", err));
  }, []);

  // 🎨 Color logic for health bars
  const getColor = (value) => {
    if (value > 85) return "#ff4d4f";
    if (value > 60) return "#faad14";
    return "#52c41a";
  };

  // ✅ FIX 3 — getCameraHealth moved ABOVE usage
  // ✅ FIX FINAL — Added fps === 0 check
  const getCameraHealth = (cam) => {
    if (cam.status === "error") return "error";
    if (cam.fps === 0) return "error";
    if (!cam.fps) return "connecting";
    if (cam.fps < 10) return "warning";
    return "online";
  };

  // 🚨 Critical events filter (from events feed)
  const criticalEvents = events.filter(
    (e) =>
      e.event_type?.toLowerCase().includes("intrusion") ||
      e.event_type?.toLowerCase().includes("offline") ||
      e.event_type?.toLowerCase().includes("error")
  );

  // 🔥 Dynamic Alerts
  const dynamicAlerts = [];

  cameraHealth.forEach((cam) => {
    if (cam.status === "error") {
      dynamicAlerts.push(`${cam.stream} offline`);
    }
    if (cam.fps && cam.fps < 10) {
      dynamicAlerts.push(`${cam.stream} low FPS`);
    }
  });

  if (summary.cpu > 85) dynamicAlerts.push("High CPU usage");
  if (summary.ram > 85) dynamicAlerts.push("High RAM usage");
  if (summary.disk > 90) dynamicAlerts.push("Storage almost full");

  const stats = [
    {
      title: "Total Cameras",
      value: summary.total_cameras,
      icon: <Camera size={18} />,
      color: "#3b82f6"
    },
    {
      title: "Active Streams",
      value: summary.active_streams,
      icon: <Activity size={18} />,
      color: "#22c55e"
    },
    {
      title: "Alarms Today",
      value: summary.alarms_today,
      icon: <Bell size={18} />,
      color: "#ef4444"
    },
    {
      title: "Disk Capacity",
      value: `${storage.used} / ${storage.total} GB`,
      icon: <HardDrive size={18} />,
      color: "#f59e0b"
    },
    {
      title: "Recording Cameras",
      value: `${recordingCount} / ${enabledCount}`,
      icon: <Server size={18} />,
      color: "#8b5cf6"
    }
  ];

  const storagePercent = storage.total > 0 ? (storage.used / storage.total) * 100 : 0;

  let storageStatus = "normal";
  if (storagePercent > 90) storageStatus = "critical";
  else if (storagePercent > 80) storageStatus = "warning";

  if (loading) return <div className="dashboard-loading">Loading Dashboard...</div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1 className="dashboard-page-title">Overview</h1>
        <div className="dashboard-update-badge">
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      </div>

      {/* 🔹 Stats Cards */}
      <div className="cards">
        {/* Simple stat cards */}
        {[
          { title: "Total Cameras", value: summary.total_cameras, icon: <Camera size={18} /> },
          { title: "Active Streams", value: summary.active_streams, icon: <Activity size={18} /> },
          { title: "Alarms Today", value: summary.alarms_today, icon: <Bell size={18} /> }
        ].map((item, index) => (
          <div className="card" key={index}>
            <div className="icon">{item.icon}</div>
            <div className="card-content">
              <p className="title">{item.title}</p>
              <h3>{item.value}</h3>
            </div>
          </div>
        ))}


        {/* Recording Cameras */}
        <div className="card" key="rec">
          <div className="icon"><Server size={18} /></div>
          <div className="card-content">
            <p className="title">Recording Cameras</p>
            <h3>{recordingCount} / {enabledCount}</h3>
          </div>
        </div>
      </div>

      <div className="health-section">
        <h3>System Health</h3>

        <div className="health-grid">

          {/* CPU — Area trend chart */}
          <div className="health-box">
            <div className="health-box-header">
              <div className="health-box-label"><Cpu size={14} /> <p>CPU</p></div>
              <h2>{summary.cpu}%</h2>
            </div>
            <CpuAreaChart data={summary.history.cpu} value={summary.cpu} />
            <span className={summary.cpu > 85 ? "bad" : summary.cpu > 60 ? "warn" : "good"}>
              {summary.cpu > 85 ? "Critical" : summary.cpu > 60 ? "High" : "Normal"}
            </span>
          </div>

          {/* RAM — Bar chart */}
          <div className="health-box">
            <div className="health-box-header">
              <div className="health-box-label"><MemoryStick size={14} /> <p>RAM</p></div>
              <h2>{summary.ram}%</h2>
            </div>
            <RamUsageGauge value={summary.ram} />
            <span className={summary.ram > 85 ? "bad" : summary.ram > 60 ? "warn" : "good"}>
              {summary.ram > 85 ? "Critical" : summary.ram > 60 ? "High" : "Normal"}
            </span>
          </div>

          {/* Disk — Donut chart */}
          <div className="health-box health-box--centered">
            <div className="health-box-header">
              <div className="health-box-label"><HardDrive size={14} /> <p>Disk</p></div>
            </div>
            <DiskDonut value={summary.disk} used={storage.used} total={storage.total} />
            <span className={summary.disk > 90 ? "bad" : summary.disk > 75 ? "warn" : "good"}>
              {summary.disk > 90 ? "Full" : summary.disk > 75 ? "Filling" : "Healthy"}
            </span>
          </div>

        </div>
      </div>

      {/* 
      <div className="dashboard-grid">
        <div className="widget critical-alerts">
          <h3 style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <AlertTriangle size={16} color="#ef4444" />
            Critical Alerts
          </h3>

          {dynamicAlerts.length === 0 ? (
            <p className="empty-msg">All systems normal ✅</p>
          ) : (
            dynamicAlerts.map((a, i) => (
              <div key={i} className="alert-item">⚠ {a}</div>
            ))
          )}
        </div>

        <div className="widget camera-health-center">
          <div className="widget-header">
            <h3>Camera Health Monitoring</h3>
            <div className="health-summary">
              <span className="count-pill online">{cameraHealth.filter(c => getCameraHealth(c) === 'online').length} Online</span>
              <span className="count-pill warning">{cameraHealth.filter(c => getCameraHealth(c) === 'warning').length} Issues</span>
              <span className="count-pill bad">{cameraHealth.filter(c => getCameraHealth(c) === 'error').length} Offline</span>
            </div>
          </div>

          <div className="camera-health-list">
            {cameraHealth.length > 0 ? (
              cameraHealth.map((cam, i) => {
                const health = getCameraHealth(cam);
                const isBitrateDrop = cam.bitrate > 0 && cam.bitrate < 400; // Threshold for drop detection

                return (
                  <div key={i} className={`health-item ${health} ${isBitrateDrop ? 'bitrate-warning' : ''}`}>
                    <div className="health-item-main">
                      <div className="cam-info">
                        <div className="cam-status-box">
                          <span className={`status-dot ${health} ${health === 'online' ? 'pulse' : ''}`} />
                          <span className="cam-name-text">
                            {cam.name}
                          </span>
                        </div>
                        <span className="cam-model-sub">{cam.model || 'ONVIF Camera'}</span>
                      </div>

                      <div className="cam-metrics-live">
                        <div className="metric-box">
                          <label>Bitrate</label>
                          <span className={isBitrateDrop ? 'value warning' : 'value'}>
                            {typeof cam.bitrate === 'number' && cam.bitrate > 0
                              ? `${(cam.bitrate / 1024).toFixed(1)} Mbps`
                              : '0.0 Mbps'}
                          </span>
                        </div>
                        <div className="metric-box">
                          <label>Last Seen</label>
                          <span className="value">
                            {cam.timestamp ? timeAgo(cam.timestamp) : 'Just now'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {isBitrateDrop && (
                      <div className="health-alert-bar">
                        <AlertTriangle size={12} />
                        <span>Bitrate Drop Detected</span>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="empty-msg">No cameras registered for monitoring</div>
            )}
          </div>
        </div>
      </div>
      */}

      {/* 🔹 Storage Details */}
      <div className="activity storage-overview" style={{ marginBottom: "32px" }}>
        <h3>Storage Health</h3>
        <div className="storage-bar-container">
          <div
            className="storage-bar-progress"
            style={{ width: `${storagePercent}%` }}
          />
        </div>
        <p className={`storage-path ${storageStatus}`}>
          <HardDrive size={16} />
          <strong>Storage Location:</strong> {storage.location}
          ({storagePercent.toFixed(1)}% full)
        </p>
      </div>

      {/* 📊 NEW: Report Generation Section */}
      <div className="report-generation">
        <div className="report-section-header">
          <div className="report-title-area">
            <h3 className="report-title-main">Reports</h3>
            <p className="report-subtitle-main">Generate and export system-wide performance, health, and activity reports</p>
          </div>
        </div>

        <div className="report-filters">
          <div className="report-filter-group">
            <label>From Date & Time</label>
            <div className="report-input-wrapper">
              <Calendar size={14} className="input-icon" />
              <input
                type="datetime-local"
                className="report-input"
                value={reportFromDate}
                onChange={(e) => setReportFromDate(e.target.value)}
              />
            </div>
          </div>

          <div className="report-filter-group">
            <label>To Date & Time</label>
            <div className="report-input-wrapper">
              <Calendar size={14} className="input-icon" />
              <input
                type="datetime-local"
                className="report-input"
                value={reportToDate}
                onChange={(e) => setReportToDate(e.target.value)}
              />
            </div>
          </div>

          <div className="report-filter-group relative">
            <label>Report Type</label>
            <div className="report-custom-select">
              <button
                type="button"
                className="report-select-btn"
                onClick={() => setReportDropdownOpen(!reportDropdownOpen)}
              >
                <span>{reportTypeMap[reportType]}</span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    transform: reportDropdownOpen ? "rotate(180deg)" : "rotate(0)",
                    transition: "transform .2s",
                    color: "var(--text-secondary)"
                  }}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {reportDropdownOpen && (
                <ul className="report-dropdown-menu">
                  {Object.entries(reportTypeMap).map(([val, label]) => (
                    <li
                      key={val}
                      className={`report-dropdown-item ${reportType === val ? "active" : ""}`}
                      onClick={() => {
                        setReportType(val);
                        setReportDropdownOpen(false);
                      }}
                    >
                      {label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="report-btn-group">
            <button
              onClick={handleGenerateReport}
              disabled={reportLoading}
              className="report-btn-primary"
            >
              {reportLoading ? "Generating..." : "Generate Report"}
            </button>
            
            {reportData.length > 0 && (
              <button
                onClick={handleDownloadCSV}
                className="report-btn-secondary"
              >
                <Download size={14} />
                Download CSV
              </button>
            )}
          </div>
        </div>

        <div ref={reportRef} style={{ scrollMarginTop: "20px" }}>
          {reportSuccessMsg && <div className="report-alert success">{reportSuccessMsg}</div>}
          {reportErrorMsg && <div className="report-alert error">{reportErrorMsg}</div>}

          {/* Report Results Table */}
          {reportData.length > 0 && (
            <div className="report-table-container">
            <div className="report-table-wrapper">
              <table className="report-table">
                <thead>
                  <tr>
                    {reportType === "alerts" && (
                      <>
                        <th>Timestamp</th>
                        <th>Device IP</th>
                        <th>Model</th>
                        <th>Type</th>
                        <th>Event</th>
                        <th>Message</th>
                        <th>Ack</th>
                      </>
                    )}
                    {reportType === "live_alerts" && (
                      <>
                        <th>Camera IP</th>
                        <th>Type</th>
                        <th>Event</th>
                        <th>Time</th>
                        <th>Timestamp</th>
                      </>
                    )}
                    {reportType === "health" && (
                      <>
                        <th>Device ID</th>
                        <th>IP Address</th>
                        <th>Manufacturer</th>
                        <th>Model</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Latency</th>
                        <th>Uptime</th>
                        <th>Online Since</th>
                        <th>Reboot Count</th>
                        <th>Last Reboot</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {currentReportRows.map((row, i) => (
                    <tr key={i}>
                      {reportType === "alerts" && (
                        <>
                          <td>{new Date(row.timestamp).toLocaleString()}</td>
                          <td>{row.ip}</td>
                          <td>{row.model}</td>
                          <td>
                            <span className={`report-tag-type ${row.type}`}>
                              {row.type?.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <span className={`report-event-tag ${row.event === "device_offline" ? "offline" : "online"}`}>
                              {row.event?.replace("_", " ").toUpperCase()}
                            </span>
                          </td>
                          <td>{row.message}</td>
                          <td>{row.acknowledged}</td>
                        </>
                      )}
                      {reportType === "live_alerts" && (
                        <>
                          <td>{row.ip_address}</td>
                          <td>
                            <span className={`report-tag-type ${row.classification?.toLowerCase()}`}>
                              {row.classification?.toUpperCase()}
                            </span>
                          </td>
                          <td>{row.scenario}</td>
                          <td style={{ color: "#22c55e", fontWeight: "600" }}>{row.time_only}</td>
                          <td>{row.timestamp ? new Date(row.timestamp).toLocaleString() : "—"}</td>
                        </>
                      )}
                      {reportType === "health" && (
                        <>
                          <td>{row.device_id}</td>
                          <td>{row.ip_address}</td>
                          <td>{row.manufacturer}</td>
                          <td>{row.model}</td>
                          <td>
                            <span className={`report-tag-type ${row.device_type}`}>
                              {row.device_type?.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <span className={`status-dot ${row.current_status === "online" ? "online" : "error"}`} style={{ display: "inline-block", marginRight: "6px" }} />
                            <span className={`report-event-tag ${row.current_status === "online" ? "online" : "offline"}`}>
                              {row.current_status?.toUpperCase()}
                            </span>
                          </td>
                          <td>{row.latency_ms}</td>
                          <td>{row.uptime_duration}</td>
                          <td>{row.online_since !== "—" ? new Date(row.online_since).toLocaleString() : "—"}</td>
                          <td>
                            <span className="report-exit-code error">{row.reboot_count}</span>
                          </td>
                          <td>{row.last_reboot !== "—" ? new Date(row.last_reboot).toLocaleString() : "—"}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {reportData.length > reportPerPage && (
              <div className="report-pagination">
                <button
                  className="report-pag-btn"
                  disabled={reportCurrentPage === 1}
                  onClick={() => setReportCurrentPage(reportCurrentPage - 1)}
                >
                  Prev
                </button>
                <span className="report-pag-info">
                  Page {reportCurrentPage} of {totalReportPages} ({reportData.length} records)
                </span>
                <button
                  className="report-pag-btn"
                  disabled={reportCurrentPage === totalReportPages}
                  onClick={() => setReportCurrentPage(reportCurrentPage + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;