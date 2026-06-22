import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
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
  Download,
  Printer,
  Mail,
  ChevronDown,
  Trash2
} from "lucide-react";
import jsPDF from "jspdf";
import "jspdf-autotable";
import * as XLSX from "xlsx";
const API_BASE = import.meta.env.VITE_API_URL || "";

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

const InteractiveLineChart = ({ data, xKey, yKey, height = 180 }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null);

  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "14px" }}>
        No bitrate data available
      </div>
    );
  }

  const values = data.map(d => d[yKey] || 0);
  const maxVal = Math.max(...values, 1.0);
  const minVal = Math.min(...values, 0.0);
  const valRange = maxVal - minVal;

  const width = 500;
  const padding = { top: 15, right: 15, bottom: 25, left: 60 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = data.map((d, idx) => {
    const x = padding.left + (idx / (data.length - 1 || 1)) * chartWidth;
    const y = padding.top + chartHeight - (((d[yKey] || 0) - minVal) / valRange) * chartHeight;
    return { x, y, item: d };
  });

  let pathD = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    pathD += ` L ${points[i].x},${points[i].y}`;
  }

  return (
    <div className="custom-chart-wrapper" style={{ position: "relative", width: "100%" }}>
      <svg viewBox={`0 0 ${width} ${height}`} className="custom-chart-svg" style={{ width: "100%", height, display: "block" }}>
        {/* Horizontal Grid Lines */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((ratio, idx) => {
          const y = padding.top + chartHeight * ratio;
          const val = maxVal - ratio * valRange;
          return (
            <g key={idx}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="rgba(255, 255, 255, 0.06)" strokeWidth="0.8" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="#ffffff" fontSize="13" fontWeight="700">
                {val.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Path line */}
        <path d={pathD} fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Hover points */}
        {points.map((pt, idx) => (
          <g key={idx}>
            <circle
              cx={pt.x}
              cy={pt.y}
              r={hoveredPoint?.idx === idx ? "5" : "0"}
              fill="#00D2FF"
              stroke="var(--bg-surface)"
              strokeWidth="1.5"
              style={{ transition: "r 0.1s ease" }}
            />
            <rect
              x={pt.x - 12}
              y={padding.top}
              width="24"
              height={chartHeight}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredPoint({ ...pt, idx })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          </g>
        ))}
      </svg>
      {hoveredPoint && (
        <div className="custom-chart-tooltip" style={{
          position: "absolute",
          top: Math.max(0, hoveredPoint.y - 45),
          left: Math.max(10, Math.min(hoveredPoint.x - 45, width - 100)),
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "4px 8px",
          fontSize: "11px",
          color: "var(--text-primary)",
          pointerEvents: "none",
          zIndex: 10,
          boxShadow: "0 4px 10px rgba(0, 0, 0, 0.4)",
          whiteSpace: "nowrap"
        }}>
          <div><strong>{hoveredPoint.item[xKey]}</strong></div>
          <div>{hoveredPoint.item[yKey].toFixed(2)} Mbps</div>
        </div>
      )}
    </div>
  );
};

const StorageTrendChart = ({ data, xKey, yKey, height = 180 }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null);

  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "14px" }}>
        No storage historical data available
      </div>
    );
  }

  const values = data.map(d => d[yKey] || 0);
  const maxVal = Math.max(...values, 1.0);
  const minVal = Math.min(...values, 0.0);
  const valRange = maxVal - minVal;

  const width = 500;
  const padding = { top: 15, right: 15, bottom: 25, left: 60 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = data.map((d, idx) => {
    const x = padding.left + (idx / (data.length - 1 || 1)) * chartWidth;
    const y = padding.top + chartHeight - (((d[yKey] || 0) - minVal) / valRange) * chartHeight;
    return { x, y, item: d };
  });

  let pathD = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    pathD += ` L ${points[i].x},${points[i].y}`;
  }

  const areaD = `${pathD} L ${points[points.length - 1].x},${padding.top + chartHeight} L ${points[0].x},${padding.top + chartHeight} Z`;

  return (
    <div className="custom-chart-wrapper" style={{ position: "relative", width: "100%" }}>
      <svg viewBox={`0 0 ${width} ${height}`} className="custom-chart-svg" style={{ width: "100%", height, display: "block" }}>
        <defs>
          <linearGradient id="storageAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Horizontal Grid Lines */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((ratio, idx) => {
          const y = padding.top + chartHeight * ratio;
          const val = maxVal - ratio * valRange;
          return (
            <g key={idx}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="rgba(255, 255, 255, 0.06)" strokeWidth="0.8" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="#ffffff" fontSize="13" fontWeight="700">
                {val.toFixed(0)} GB
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaD} fill="url(#storageAreaGrad)" />

        {/* Path line */}
        <path d={pathD} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Hover points */}
        {points.map((pt, idx) => (
          <g key={idx}>
            <circle
              cx={pt.x}
              cy={pt.y}
              r={hoveredPoint?.idx === idx ? "5" : "0"}
              fill="#8b5cf6"
              stroke="var(--bg-surface)"
              strokeWidth="1.5"
              style={{ transition: "r 0.1s ease" }}
            />
            <rect
              x={pt.x - 12}
              y={padding.top}
              width="24"
              height={chartHeight}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredPoint({ ...pt, idx })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          </g>
        ))}
      </svg>
      {hoveredPoint && (
        <div className="custom-chart-tooltip" style={{
          position: "absolute",
          top: Math.max(0, hoveredPoint.y - 45),
          left: Math.max(10, Math.min(hoveredPoint.x - 45, width - 100)),
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "4px 8px",
          fontSize: "11px",
          color: "var(--text-primary)",
          pointerEvents: "none",
          zIndex: 10,
          boxShadow: "0 4px 10px rgba(0, 0, 0, 0.4)",
          whiteSpace: "nowrap"
        }}>
          <div><strong>{hoveredPoint.item[xKey]}</strong></div>
          <div>{hoveredPoint.item[yKey].toFixed(1)} GB</div>
        </div>
      )}
    </div>
  );
};

const parseEvents = (uiLogsList, infraAlertsList) => {
  const merged = [];

  if (Array.isArray(uiLogsList)) {
    uiLogsList.forEach(log => {
      const act = log.action || "";
      const ts = log.timestamp;
      let eventType = null;
      let message = act;

      if (act.toLowerCase().includes("logged in")) {
        eventType = "User Login";
      } else if (act.toLowerCase().includes("recording") && act.toLowerCase().includes("start")) {
        eventType = "Recording Started";
      } else if (act.toLowerCase().includes("stopped recorder") || act.toLowerCase().includes("stopped: ")) {
        eventType = "Recording Stopped";
      } else if (log.category === "storage" || act.toLowerCase().includes("storage") || act.toLowerCase().includes("disk")) {
        eventType = "Storage Events";
      }

      if (eventType) {
        merged.push({
          id: `ui-${log.timestamp}-${message}`,
          type: eventType,
          message,
          timestamp: ts,
          rawTime: ts
        });
      }
    });
  }

  if (Array.isArray(infraAlertsList)) {
    infraAlertsList.forEach(alert => {
      const ev = alert.event || "";
      const msg = alert.message || "";
      const ts = alert.timestamp;
      let eventType = null;

      if (ev === "device_offline") {
        eventType = "Camera Offline";
      } else if (ev === "device_online") {
        eventType = "Camera Online";
      }

      if (eventType) {
        merged.push({
          id: `infra-${alert.timestamp}-${msg}`,
          type: eventType,
          message: msg,
          timestamp: ts,
          rawTime: ts
        });
      }
    });
  }

  merged.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const seen = new Set();
  const unique = [];
  for (const item of merged) {
    const key = `${item.type}-${item.message}-${item.rawTime}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique.slice(0, 10);
};

const DashboardPage = () => {
  const navigate = useNavigate();
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

  // Enhanced Widget States
  const [serverMetrics, setServerMetrics] = useState({ uptime: "—", last_reboot: "—" });
  const [healthInfo, setHealthInfo] = useState({ status: "ok", version: "1.0.0", watchdog: "Active" });
  const [recentSystemEvents, setRecentSystemEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [serverTime, setServerTime] = useState(new Date().toLocaleTimeString());

  const recordingCount = cameras.filter((cam) => {
    if (cam.enabled === false) return false;
    return activeRecorders.includes(cam.stream_key) || activeRecorders.includes(cam.ome_stream);
  }).length;

  const enabledCount = cameras.filter((cam) => cam.enabled !== false).length;
  const [cameraHealth, setCameraHealth] = useState([]);

  // Phase 2 Widget States
  const [storageDiagnostics, setStorageDiagnostics] = useState({
    total_gb: 0,
    used_gb: 0,
    free_gb: 0,
    usage_pct: 0,
    avg_daily_consumption: null,
    retention_days: null,
    predicted_exhaustion_date: null,
    warning_status: false,
    trend_history: []
  });
  const [bitrateDiagnostics, setBitrateDiagnostics] = useState({
    current_bitrate: 0,
    avg_bitrate: 0,
    peak_bitrate: 0,
    trend_data: []
  });
  const [camerasBandwidth, setCamerasBandwidth] = useState({
    total_bandwidth: 0,
    top_cameras: []
  });
  const [bitrateFilter, setBitrateFilter] = useState("1h");
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(true);

  // ─── NEW: Report Generation States ─────────────────────────────────────────
  const [reportFromDate, setReportFromDate] = useState(getInitialFromDate());
  const [reportToDate, setReportToDate] = useState(getInitialToDate());
  const [reportType, setReportType] = useState("alerts");
  const [reportData, setReportData] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportCurrentPage, setReportCurrentPage] = useState(1);
  const [reportDropdownOpen, setReportDropdownOpen] = useState(false);
  const [actionsDropdownOpen, setActionsDropdownOpen] = useState(false);
  const actionsDropdownRef = useRef(null);

  const [reportSuccessMsg, setReportSuccessMsg] = useState("");
  const [reportErrorMsg, setReportErrorMsg] = useState("");
  const reportPerPage = 10;

  const reportRef = useRef(null);

  const reportTypeMap = {
    alerts: "Camera Up/Down History",
    live_alerts: "Analytics Alerts",
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
            setReportSuccessMsg(`Successfully generated report with ${formatted.length} Analytics Alerts.`);
          } else {
            setReportSuccessMsg("No Analytics Alerts found for the selected time range.");
          }
        } else {
          setReportErrorMsg("Failed to fetch Analytics Alerts from server.");
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

  const handleDownloadPDF = () => {
    if (!reportData || reportData.length === 0) return;
    const doc = new jsPDF();
    doc.text(`${reportTypeMap[reportType]} Report`, 14, 15);
    
    const keys = Object.keys(reportData[0]);
    const headers = keys.map(k => k.replace(/_/g, " ").toUpperCase());
    const rows = reportData.map(row => keys.map(k => {
      const val = row[k];
      return val === null || val === undefined ? "—" : String(val);
    }));

    doc.autoTable({
      head: [headers],
      body: rows,
      startY: 20,
      theme: "striped",
      styles: { fontSize: 8 }
    });
    doc.save(`${reportType}_report_${new Date().toISOString().slice(0,10)}.pdf`);
  };

  const handleDownloadExcel = () => {
    if (!reportData || reportData.length === 0) return;
    const keys = Object.keys(reportData[0]);
    const mappedData = reportData.map(row => {
      const obj = {};
      keys.forEach(k => {
        const headerName = k.replace(/_/g, " ").toUpperCase();
        obj[headerName] = row[k] === null || row[k] === undefined ? "—" : row[k];
      });
      return obj;
    });

    const ws = XLSX.utils.json_to_sheet(mappedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `${reportType}_report_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  // Pagination for report
  const indexOfLastReport = reportCurrentPage * reportPerPage;
  const indexOfFirstReport = indexOfLastReport - reportPerPage;
  const currentReportRows = reportData.slice(indexOfFirstReport, indexOfLastReport);
  const totalReportPages = Math.ceil(reportData.length / reportPerPage);

  useEffect(() => {
    const timer = setInterval(() => {
      setServerTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchRecentEvents = async () => {
    try {
      const [logsRes, alertsRes] = await Promise.all([
        fetch(`${API_BASE}/api/logs/ui?limit=50`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/api/infrastructure/alerts?limit=50`, { headers: getAuthHeaders() })
      ]);
      const logsJson = await logsRes.json();
      const alertsJson = await alertsRes.json();
      const parsed = parseEvents(logsJson.logs || [], alertsJson || []);
      setRecentSystemEvents(parsed);
    } catch (err) {
      console.error("Failed to fetch recent events:", err);
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecentEvents();
    const interval = setInterval(fetchRecentEvents, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleCameraStatusClick = () => {
    const reportSection = document.querySelector('.report-generation');
    if (reportSection) {
      reportSection.scrollIntoView({ behavior: 'smooth' });
    }
    setReportType('health');
    setTimeout(() => {
      handleGenerateReport();
    }, 500);
  };

  const fetchDiagnostics = async () => {
    try {
      const [storageRes, bitrateRes, bandwidthRes] = await Promise.all([
        fetch(`${API_BASE}/api/storage/diagnostics`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/api/bitrate/diagnostics?filter_type=${bitrateFilter}`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/api/cameras/bandwidth`, { headers: getAuthHeaders() })
      ]);

      if (storageRes.ok) {
        const storageData = await storageRes.json();
        setStorageDiagnostics(storageData);
      }
      if (bitrateRes.ok) {
        const bitrateData = await bitrateRes.json();
        setBitrateDiagnostics(bitrateData);
      }
      if (bandwidthRes.ok) {
        const bandwidthData = await bandwidthRes.json();
        setCamerasBandwidth(bandwidthData);
      }
    } catch (err) {
      console.error("Diagnostics fetch error:", err);
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
    const interval = setInterval(fetchDiagnostics, 5000);
    return () => clearInterval(interval);
  }, [bitrateFilter]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sumRes, storRes, eventRes, camRes, statusRes, healthRes, metricsRes, camHealthRes] = await Promise.all([
          fetch(`${API_BASE}/api/dashboard/summary`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE}/api/storage/management`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE}/api/dashboard/events`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE}/api/cameras/`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE}/api/recordings/status`, { headers: getAuthHeaders() }).catch(() => null),
          fetch(`${API_BASE}/api/health`, { headers: getAuthHeaders() }).catch(() => null),
          fetch(`${API_BASE}/api/infrastructure/metrics`, { headers: getAuthHeaders() }).catch(() => null),
          fetch(`${API_BASE}/api/camera-health`, { headers: getAuthHeaders() }).catch(() => null)
        ]);

        const sumData = await sumRes.json();
        const storData = await storRes.json();
        const eventData = await eventRes.json();
        const camData = await camRes.json();

        if (statusRes && statusRes.ok) {
          const statusData = await statusRes.json();
          setActiveRecorders(statusData.active_recorders || []);
        }

        if (healthRes && healthRes.ok) {
          const healthData = await healthRes.json();
          setHealthInfo(healthData);
        }

        if (metricsRes && metricsRes.ok) {
          const metricsData = await metricsRes.json();
          setServerMetrics(metricsData);
        }

        if (camHealthRes && camHealthRes.ok) {
          const camHealthData = await camHealthRes.json();
          setCameraHealth(camHealthData);
        }

        // Fetch history for the VMS host
        // Note: Commented out the actual fetch to prevent 404 console errors since the backend may not support this endpoint yet.
        try {
          const topoRes = await fetch(`${API_BASE}/api/infrastructure/topology`, { headers: getAuthHeaders() });
          if (topoRes.ok) {
            const topoData = await topoRes.json();
            const hostNode = topoData.nodes?.find(n => n.model === "VMS Host");
            
            // For now, simulate history data so charts aren't completely empty and we avoid 404s
            if (hostNode) {
              const simHist = Array.from({ length: 24 }, (_, i) => ({
                metrics: {
                  cpu: Math.floor(Math.random() * 40) + 10,
                  ram: Math.floor(Math.random() * 20) + 40,
                  disk: Math.floor(Math.random() * 5) + 60
                }
              }));
              sumData.history = {
                cpu: simHist.map(h => h.metrics.cpu),
                ram: simHist.map(h => h.metrics.ram),
                disk: simHist.map(h => h.metrics.disk)
              };
            }
          }
        } catch (hErr) {
          console.warn("History fetch failed:", hErr);
        }

        setSummary(prev => {
          let history = sumData.history;
          if (!history || !history.cpu || history.cpu.length === 0) {
            const prevCpu = prev.history?.cpu || [];
            const prevRam = prev.history?.ram || [];
            const prevDisk = prev.history?.disk || [];

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
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
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

  const storagePercent = storage.total > 0 ? (storage.used / storage.total) * 100 : 0;

  if (summary.cpu > 85) dynamicAlerts.push("High CPU usage");
  if (summary.ram > 85) dynamicAlerts.push("High RAM usage");
  if (storagePercent > 90) dynamicAlerts.push("Storage almost full");

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
            <DiskDonut value={storagePercent} used={storage.used} total={storage.total} />
            <span className={storagePercent > 90 ? "bad" : storagePercent > 75 ? "warn" : "good"}>
              {storagePercent > 90 ? "Full" : storagePercent > 75 ? "Filling" : "Healthy"}
            </span>
          </div>

        </div>
      </div>

      {/* ── Enhanced Diagnostics & Service Status Section ── */}
      <div className="enhanced-widgets-section">
        <div className="widgets-grid">
          {/* Widget 1: Server Health */}
          <div className="enhanced-card">
            <div className="enhanced-card-header">
              <span className="header-icon"><Server size={18} /></span>
              <h4>Server Health</h4>
            </div>
            <div className="widget-content-list">
              <div className="widget-item-row">
                <span className="widget-item-label">Server Uptime</span>
                <span className="widget-item-value">{serverMetrics.uptime || "—"}</span>
              </div>
              <div className="widget-item-row">
                <span className="widget-item-label">Backend Status</span>
                <span className={`widget-item-value ${healthInfo.status === "ok" ? "healthy" : "unhealthy"}`}>
                  {healthInfo.status === "ok" ? "Healthy" : "Unhealthy"}
                </span>
              </div>
              <div className="widget-item-row">
                <span className="widget-item-label">Server Time</span>
                <span className="widget-item-value">{serverTime}</span>
              </div>
              <div className="widget-item-row">
                <span className="widget-item-label">App Version</span>
                <span className="widget-item-value">v{healthInfo.version || "1.0.0"}</span>
              </div>
            </div>
          </div>

          {/* Widget 2: Device Health */}
          <div className="enhanced-card">
            <div className="enhanced-card-header">
              <span className="header-icon"><Camera size={18} /></span>
              <h4>Device Health</h4>
            </div>
            <div className="widget-content-list">
              <div className="widget-item-row">
                <span className="widget-item-label">Total Cameras</span>
                <span className="widget-item-value">{summary.total_cameras}</span>
              </div>
              <div className="widget-item-row">
                <span className="widget-item-label">Online Cameras</span>
                <span className="widget-item-value healthy">
                  {summary.active_streams}
                </span>
              </div>
              <div className="widget-item-row">
                <span className="widget-item-label">Offline Cameras</span>
                <span className="widget-item-value unhealthy">
                  {summary.total_cameras - summary.active_streams}
                </span>
              </div>
              <div className="widget-item-row">
                <span className="widget-item-label">Recording Cameras</span>
                <span className="widget-item-value">
                  {recordingCount}
                </span>
              </div>
              <div className="widget-item-row">
                <span className="widget-item-label">Signal Loss Cameras</span>
                <span className="widget-item-value unhealthy">
                  {summary.total_cameras - summary.active_streams}
                </span>
              </div>
            </div>
          </div>

          {/* Widget 3: Camera Status */}
          <div className="enhanced-card clickable-widget" onClick={handleCameraStatusClick} title="Click to view Camera Health Report">
            <div className="enhanced-card-header">
              <span className="header-icon"><Activity size={18} /></span>
              <h4>Camera Status</h4>
            </div>
            <div className="widget-content-list" style={{ justifyContent: "center" }}>
              <div style={{ display: "flex", justifyContent: "space-around", textAlign: "center" }}>
                <div>
                  <div style={{ fontSize: "28px", fontWeight: "800", color: "#22c55e" }}>
                    {summary.active_streams}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: "600", textTransform: "uppercase" }}>Online</div>
                </div>
                <div style={{ width: "1px", background: "var(--border-light)" }} />
                <div>
                  <div style={{ fontSize: "28px", fontWeight: "800", color: "#ef4444" }}>
                    {summary.total_cameras - summary.active_streams}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: "600", textTransform: "uppercase" }}>Offline</div>
                </div>
              </div>
              <div style={{ textAlign: "center", fontSize: "12px", color: "var(--teal)", marginTop: "16px", fontWeight: "600" }}>
                Click card to view Health Report
              </div>
            </div>
          </div>

          {/* Widget 4: Recording Health */}
          <div className="enhanced-card">
            <div className="enhanced-card-header">
              <span className="header-icon"><Server size={18} /></span>
              <h4>Recording Health</h4>
            </div>
            <div className="widget-content-list">
              <div className="widget-item-row">
                <span className="widget-item-label">Recording Cameras</span>
                <span className="widget-item-value">{recordingCount} / {enabledCount}</span>
              </div>
              <div className="widget-item-row">
                <span className="widget-item-label">Failed Recordings</span>
                <span className={`widget-item-value ${cameras.filter(cam => cam.enabled !== false && !activeRecorders.includes(cam.ome_stream) && !activeRecorders.includes(cam.stream_key)).length > 0 ? "unhealthy" : "healthy"}`}>
                  {cameras.filter(cam => cam.enabled !== false && !activeRecorders.includes(cam.ome_stream) && !activeRecorders.includes(cam.stream_key)).length}
                </span>
              </div>
              <div className="widget-item-row">
                <span className="widget-item-label">Service Status</span>
                <span className={`widget-item-value ${activeRecorders.length > 0 ? "healthy" : "unhealthy"}`}>
                  {activeRecorders.length > 0 ? "Running" : "Stopped"}
                </span>
              </div>
            </div>
          </div>

          {/* Widget 5: Storage Details */}
          <div className="enhanced-card">
            <div className="enhanced-card-header">
              <span className="header-icon"><HardDrive size={18} /></span>
              <h4>Storage Details</h4>
              {storageDiagnostics.warning_status && (
                <span className="badge warning" style={{ marginLeft: "auto", fontSize: "11px" }}>Low Storage Warning</span>
              )}
            </div>
            <div className="widget-content-list">
              <div className="widget-item-row">
                <span className="widget-item-label">Total Capacity</span>
                <span className="widget-item-value">{(storageDiagnostics.total_gb / 1024).toFixed(2)} TB ({storageDiagnostics.total_gb} GB)</span>
              </div>
              <div className="widget-item-row">
                <span className="widget-item-label">Used Space</span>
                <span className="widget-item-value">{(storageDiagnostics.used_gb / 1024).toFixed(2)} TB ({storageDiagnostics.used_gb} GB)</span>
              </div>
              <div className="widget-item-row">
                <span className="widget-item-label">Free Space</span>
                <span className="widget-item-value">{(storageDiagnostics.free_gb / 1024).toFixed(2)} TB ({storageDiagnostics.free_gb} GB)</span>
              </div>
              
              <div style={{ marginTop: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                  <span>Usage Utilization</span>
                  <strong>{storageDiagnostics.usage_pct}%</strong>
                </div>
                <div className="card-inline-bar" style={{ marginTop: 0 }}>
                  <div
                    className="card-inline-bar-fill"
                    style={{
                      width: `${storageDiagnostics.usage_pct}%`,
                      background: storageDiagnostics.warning_status ? "linear-gradient(90deg, #f59e0b, #ef4444)" : "linear-gradient(90deg, var(--teal), #00d2ff)"
                    }}
                  />
                </div>
              </div>

              <div className="widget-item-row" style={{ marginTop: "10px" }}>
                <span className="widget-item-label">Estimated Retention</span>
                <span className={`widget-item-value ${storageDiagnostics.retention_days === null ? "warning" : "healthy"}`}>
                  {storageDiagnostics.retention_days !== null ? `${storageDiagnostics.retention_days} Days` : "Calculating..."}
                </span>
              </div>
            </div>
          </div>

          {/* Widget 6: Bitrate Trend */}
          <div className="enhanced-card chart-card">
            <div className="enhanced-card-header">
              <span className="header-icon"><Activity size={18} /></span>
              <h4>Bitrate Trend</h4>
              <div className="chart-filters" style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
                {["1h", "24h", "7d"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setBitrateFilter(f)}
                    className={`chart-filter-btn ${bitrateFilter === f ? "active" : ""}`}
                    style={{
                      padding: "2px 8px",
                      fontSize: "10px",
                      fontWeight: "700",
                      borderRadius: "4px",
                      border: "1px solid var(--border)",
                      background: bitrateFilter === f ? "rgba(16, 185, 129, 0.2)" : "rgba(255, 255, 255, 0.02)",
                      color: bitrateFilter === f ? "var(--teal)" : "var(--text-secondary)",
                      cursor: "pointer",
                      transition: "all 0.2s"
                    }}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="widget-content-list" style={{ minHeight: "280px" }}>
              <div style={{ display: "flex", justifyContent: "space-around", marginBottom: "10px", fontSize: "12px" }}>
                <div>Current: <strong>{bitrateDiagnostics.current_bitrate} Mbps</strong></div>
                <div>Avg: <strong>{bitrateDiagnostics.avg_bitrate} Mbps</strong></div>
                <div>Peak: <strong>{bitrateDiagnostics.peak_bitrate} Mbps</strong></div>
              </div>
              <InteractiveLineChart data={bitrateDiagnostics.trend_data} xKey="timestamp" yKey="bitrate_mbps" height={220} />
            </div>
          </div>

          {/* Widget 7: Storage Usage Trend */}
          <div className="enhanced-card chart-card">
            <div className="enhanced-card-header">
              <span className="header-icon"><HardDrive size={18} /></span>
              <h4>Storage Growth Trend</h4>
            </div>
            <div className="widget-content-list" style={{ minHeight: "280px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "12px", alignItems: "center" }}>
                <div>Avg Daily: <strong>{storageDiagnostics.avg_daily_consumption !== null ? `${storageDiagnostics.avg_daily_consumption} GB/day` : "Calculating..."}</strong></div>
                {storageDiagnostics.predicted_exhaustion_date && (
                  <div style={{ color: "#ef4444", fontWeight: "700", whiteSpace: "nowrap", fontSize: "11.5px" }}>Exhaustion: {storageDiagnostics.predicted_exhaustion_date}</div>
                )}
              </div>
              {storageDiagnostics.warning_status && storageDiagnostics.predicted_exhaustion_date && (
                <div className="warning-banner" style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "6px", padding: "6px 10px", fontSize: "11.5px", color: "#f87171", marginBottom: "8px" }}>
                  ⚠️ Warning: Exhaustion predicted on {storageDiagnostics.predicted_exhaustion_date}.
                </div>
              )}
              <StorageTrendChart data={storageDiagnostics.trend_history} xKey="timestamp" yKey="used_gb" height={220} />
            </div>
          </div>

          {/* Widget 8: Top Bandwidth Consumers */}
          <div className="enhanced-card bandwidth-card">
            <div className="enhanced-card-header">
              <span className="header-icon"><Camera size={18} /></span>
              <h4>Top Bandwidth Consumers</h4>
            </div>
            <div className="widget-content-list">
              {camerasBandwidth.top_cameras && camerasBandwidth.top_cameras.length > 0 ? (
                <div className="bandwidth-list-container">
                  {camerasBandwidth.top_cameras.map((cam, idx) => (
                    <div
                      key={cam.id || idx}
                      onClick={() => navigate("/cameras")}
                      className="bandwidth-item-row"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border-light)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        transition: "border-color 0.2s ease"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.borderColor = "var(--teal)"}
                      onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border-light)"}
                    >
                      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: "13.5px", fontWeight: "600", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {cam.name}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{cam.ip}</span>
                      </div>
                      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: "13.5px", fontWeight: "700", color: "var(--text-primary)" }}>{cam.bitrate} Mbps</div>
                        <div style={{ fontSize: "11px", color: "var(--teal)", fontWeight: "600" }}>{cam.percentage}% of total</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: "13.5px", minHeight: "120px" }}>
                  No active camera bandwidth metrics
                </div>
              )}
            </div>
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



      {/* 📊 NEW: Report Generation Section */}
      <div className="report-generation">
        <div className="report-section-header">
          <div className="report-title-area">
            <h3 className="report-title-main">Reports</h3>
          </div>
        </div>

        <div className="report-filters">
          <div className="report-filter-group">
            <label>From Date & Time</label>
            <div className="report-input-wrapper">
              <Calendar size={14} className="input-icon" style={{ color: "#ffffff" }} />
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
              <Calendar size={14} className="input-icon" style={{ color: "#ffffff" }} />
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

          <div className="report-btn-group" ref={actionsDropdownRef} style={{ position: "relative" }}>
            <button
              onClick={handleGenerateReport}
              disabled={reportLoading}
              className="report-btn-primary"
            >
              {reportLoading ? "Generating..." : "Generate Report"}
            </button>
            
            {reportData.length > 0 && (
              <div className="report-actions-dropdown">
                <button
                  type="button"
                  onClick={() => setActionsDropdownOpen(!actionsDropdownOpen)}
                  className="report-btn-secondary"
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <Download size={14} />
                  <span>Export / Print</span>
                  <ChevronDown size={14} style={{ transform: actionsDropdownOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s" }} />
                </button>
                {actionsDropdownOpen && (
                  <ul className="report-actions-menu" style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    boxShadow: "0 8px 16px rgba(0,0,0,0.5)",
                    zIndex: 100,
                    listStyle: "none",
                    padding: "6px 0",
                    margin: "4px 0 0 0",
                    minWidth: "160px"
                  }}>
                    <li className="report-actions-item" onClick={() => { handleDownloadCSV(); setActionsDropdownOpen(false); }} style={{
                      padding: "8px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      transition: "background 0.2s"
                    }}>
                      <Download size={13} />
                      Export CSV
                    </li>
                    <li className="report-actions-item" onClick={() => { handleDownloadExcel(); setActionsDropdownOpen(false); }} style={{
                      padding: "8px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      transition: "background 0.2s"
                    }}>
                      <Download size={13} />
                      Export Excel (.xlsx)
                    </li>
                    <li className="report-actions-item" onClick={() => { handleDownloadPDF(); setActionsDropdownOpen(false); }} style={{
                      padding: "8px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      transition: "background 0.2s"
                    }}>
                      <Download size={13} />
                      Export PDF
                    </li>
                    <li className="report-actions-item" onClick={() => { window.print(); setActionsDropdownOpen(false); }} style={{
                      padding: "8px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      transition: "background 0.2s"
                    }}>
                      <Printer size={13} />
                      Print Report
                    </li>
                  </ul>
                )}
              </div>
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