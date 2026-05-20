import React, { useState, useEffect } from "react";
import "./DashboardPage.css";
import {
  Camera,
  Activity,
  Bell,
  HardDrive,
  AlertTriangle,
  Server,
  Cpu,
  MemoryStick
} from "lucide-react";
const API_BASE = "http://localhost:8000";

const Sparkline = ({ data, color = '#6366f1', height = 60 }) => {
  if (!data || data.length < 2) return <div style={{ height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 200;
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  const pathData = `M ${points}`;
  const areaData = `${pathData} L ${width},${height} L 0,${height} Z`;

  // Sanitizing color to avoid `#` in SVG element IDs, which is illegal and breaks gradient rendering
  const cleanColorId = color.replace('#', '');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="dashboard-sparkline" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${cleanColorId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaData} fill={`url(#grad-${cleanColorId})`} />
      <path d={pathData} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  const [loading, setLoading] = useState(true);
  const [cameraHealth, setCameraHealth] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sumRes, storRes, eventRes, camRes] = await Promise.all([
          fetch(`${API_BASE}/api/dashboard/summary`),
          fetch(`${API_BASE}/api/storage/management`),
          fetch(`${API_BASE}/api/dashboard/events`),
          fetch(`${API_BASE}/api/cameras/`)
        ]);

        const sumData = await sumRes.json();
        const storData = await storRes.json();
        const eventData = await eventRes.json();
        const camData = await camRes.json();

        // Fetch history for the VMS host (assuming it's node-172-19-0-6 or similar)
        // We'll try to find the host node first or just fetch history if we have an ID
        try {
          const topoRes = await fetch(`${API_BASE}/api/infrastructure/topology`);
          const topoData = await topoRes.json();
          const hostNode = topoData.nodes.find(n => n.model === "VMS Host");
          if (hostNode) {
            const histRes = await fetch(`${API_BASE}/api/infrastructure/nodes/${hostNode.id}/history`);
            const histData = await histRes.json();
            sumData.history = {
              cpu: histData.map(h => h.metrics.cpu),
              ram: histData.map(h => h.metrics.ram),
              disk: histData.map(h => h.metrics.disk)
            };
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
    fetch("/api/camera-health")
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
      value: `${cameras.filter(c => c.stream_status?.connected).length} / ${cameras.length}`,
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
        {stats.map((item, index) => (
          <div className="card" key={index}>
            <div className={`icon ${index === 0 ? "blue" :
                index === 1 ? "green" :
                  index === 2 ? "red" : "orange"
              }`}>
              {item.icon}
            </div>
            <div className="card-content">
              <p className="title">{item.title}</p>
              <h3>{item.value}</h3>
            </div>
          </div>
        ))}
      </div>

      <div className="health-section">
        <h3>System Health</h3>

        <div className="health-grid">

          <div className="health-box">
            <div className="health-box-header">
              <p>CPU</p>
              <h2>{summary.cpu}%</h2>
            </div>
            <Sparkline data={summary.history.cpu} color={summary.cpu > 80 ? "#ef4444" : "#6366f1"} />
            <span className={summary.cpu > 85 ? "bad" : summary.cpu > 60 ? "warn" : "good"}>
              {summary.cpu > 85 ? "Critical" : summary.cpu > 60 ? "High" : "Normal"}
            </span>
          </div>

          <div className="health-box">
            <div className="health-box-header">
              <p>RAM</p>
              <h2>{summary.ram}%</h2>
            </div>
            <Sparkline data={summary.history.ram} color={summary.ram > 80 ? "#f59e0b" : "#22c55e"} />
            <span className={summary.ram > 85 ? "bad" : summary.ram > 60 ? "warn" : "good"}>
              {summary.ram > 85 ? "Critical" : summary.ram > 60 ? "High" : "Normal"}
            </span>
          </div>

          <div className="health-box">
            <div className="health-box-header">
              <p>Disk</p>
              <h2>{summary.disk}%</h2>
            </div>
            <Sparkline data={summary.history.disk} color="#94a3b8" />
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
      <div className="activity storage-overview">
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
    </div>
  );
};

export default DashboardPage;