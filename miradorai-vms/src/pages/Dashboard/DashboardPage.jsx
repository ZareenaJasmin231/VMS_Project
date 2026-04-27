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

const DashboardPage = () => {
  const [summary, setSummary] = useState({
    total_cameras: 0,
    active_streams: 0,
    alarms_today: 0,
    cpu: 0,
    ram: 0,
    disk: 0,
    alerts: [],
    status: "Healthy"
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

        setSummary(sumData);
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
    if (value > 85) return "#ff4d4f";  // red
    if (value > 60) return "#faad14";  // yellow
    return "#52c41a";                  // green
  };

  // 🚨 Critical alerts filter (from events feed)
  const criticalEvents = events.filter(
    (e) =>
      e.event_type?.toLowerCase().includes("intrusion") ||
      e.event_type?.toLowerCase().includes("offline") ||
      e.event_type?.toLowerCase().includes("error")
  );

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
      <h2 className="dashboard-title"> Live VMS Overview</h2>

      {/* 🔹 Stats Cards */}
      <div className="cards">
        {stats.map((item, index) => (
          <div className="card" key={index}>
            <div className={`icon ${
              index === 0 ? "blue"  :
              index === 1 ? "green" :
              index === 2 ? "red"   : "orange"
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
      <p>CPU</p>
      <h2>{summary.cpu}%</h2>
      <span className={summary.cpu > 85 ? "bad" : summary.cpu > 60 ? "warn" : "good"}>
        {summary.cpu > 85 ? "Critical" : summary.cpu > 60 ? "High" : "Normal"}
      </span>
    </div>

    <div className="health-box">
      <p>RAM</p>
      <h2>{summary.ram}%</h2>
      <span className={summary.ram > 85 ? "bad" : summary.ram > 60 ? "warn" : "good"}>
        {summary.ram > 85 ? "Critical" : summary.ram > 60 ? "High" : "Normal"}
      </span>
    </div>

    <div className="health-box">
      <p>Disk</p>
      <h2>{summary.disk}%</h2>
      <span className={summary.disk > 90 ? "bad" : summary.disk > 75 ? "warn" : "good"}>
        {summary.disk > 90 ? "Full" : summary.disk > 75 ? "Filling" : "Healthy"}
      </span>
    </div>

  </div>
</div>

      <div className="dashboard-grid">
        {/* 🚨 Critical Alerts */}
        <div className="widget critical-alerts">
<h3 style={{ display: "flex", alignItems: "center", gap: "6px" }}>
  <AlertTriangle size={16} color="#ef4444" />
  Critical Alerts
</h3>
{summary.alerts.length === 0 ? (
  <p className="empty-msg">All systems normal ✅</p>
) : (
  summary.alerts.map((a, i) => (
    <div key={i} className="alert-item">⚠ {a}</div>
  ))
)}
        </div>
{/* 🔹 Camera Health Grid */}
<div className="widget camera-health-section">
  <h3>Camera Health Details</h3>

  <div className="camera-status-grid">
    {cameras.map((cam, idx) => (
      <div key={idx} className="mini-cam-card">

        {/* ✅ Single clean status dot */}
        <div
          className={`status-dot ${
            cam.stream_status?.connected ? "online" : "offline"
          }`}
        />

        {/* ✅ Camera Info */}
        <div className="mini-cam-info">
          <div className="cam-name">{cam.name || cam.ip}</div>
          <div className="cam-details">
            {cam.stream_status?.connected ? "Streaming" : "Offline"}
          </div>
        </div>

      </div>
    ))}

    {cameras.length === 0 && (
      <p className="empty-msg">No cameras connected.</p>
    )}
  </div>
</div>


        {/* 📡 Camera Stream Health */}
        <div className="widget camera-stream-health">
          <h3>📡 Camera Stream Health</h3>
          <div className="camera-health-grid">
            {cameraHealth.length > 0 ? (
              cameraHealth.map((cam, i) => (
                <div key={i} className="camera-health-card">
                  <p>{cam.stream}</p>
                  <p>FPS: {cam.fps || "--"}</p>
                  <p>Bitrate: {cam.bitrate || "--"}</p>
                  <span style={{
                    color: cam.status === "error" ? "red" : "green"
                  }}>
                    ● {cam.status || "healthy"}
                  </span>
                </div>
              ))
            ) : (
              <p className="empty-msg">No stream health data available.</p>
            )}
          </div>
        </div>
      </div>

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