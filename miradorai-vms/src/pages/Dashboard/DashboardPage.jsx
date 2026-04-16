import React, { useState, useEffect } from "react";
import "./DashboardPage.css";
import { FaVideo, FaBell, FaHdd, FaCircle, FaExclamationTriangle } from "react-icons/fa";

const API_BASE = "http://localhost:8000";

const DashboardPage = () => {
  const [summary, setSummary] = useState({ total_cameras: 0, active_streams: 0, alarms_today: 0 });
  const [storage, setStorage] = useState({ total: 0, used: 0, free: 0, location: "—" });
  const [events, setEvents] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);

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
    const interval = setInterval(fetchData, 10000); // Polling every 10s
    return () => clearInterval(interval);
  }, []);

  const stats = [
    { title: "Total Cameras", value: summary.total_cameras, icon: <FaVideo />, color: "#3b82f6" },
    { title: "Active Streams", value: summary.active_streams, icon: <FaVideo />, color: "#22c55e" },
    { title: "Alarms Today", value: summary.alarms_today, icon: <FaBell />, color: "#ef4444" },
    { title: "Disk Capacity", value: `${storage.used} / ${storage.total} GB`, icon: <FaHdd />, color: "#f59e0b" },
  ];

  if (loading) return <div className="dashboard-loading">Loading Dashboard...</div>;

  return (
    <div className="dashboard">
      <h2 className="dashboard-title">📊 Live VMS Overview</h2>

      {/* 🔹 Stats Cards */}
      <div className="cards">
        {stats.map((item, index) => (
          <div className="card" key={index}>
<div className={`icon ${
  index === 0 ? "blue" :
  index === 1 ? "green" :
  index === 2 ? "red" : "orange"
}`}>              {item.icon}
            </div>
            <div className="card-content">
              <p className="title">{item.title}</p>
              <h3>{item.value}</h3>
            </div>
          </div>
        ))}
      </div>

      <div className="dashboard-grid">
        
        {/* 🔹 Camera Health Grid (Real Data) */}
        <div className="widget camera-health-section">
          <h3>Camera Health Details</h3>
          <div className="camera-status-grid">
            {cameras.map((cam, idx) => (
              <div key={idx} className="mini-cam-card">
                <div className={`status-dot ${cam.stream_status?.connected ? "online" : "offline"}`}>
                  <FaCircle />
                </div>
                <div className="mini-cam-info">
                  <span className="cam-name">{cam.name || cam.ip}</span>
                  <span className="cam-details">
                    {cam.stream_status?.connected ? "Online" : "Offline"} · {cam.ip}
                  </span>
                </div>
              </div>
            ))}
            {cameras.length === 0 && <p className="empty-msg">No cameras connected.</p>}
          </div>
        </div>

        {/* 🔹 Live Security Feed (Real Data) */}
        <div className="widget events-section">
          <h3>Live Detection Feed</h3>
          <div className="event-feed">
            {events.map((event, idx) => (
              <div key={idx} className="event-item">
                <div className="event-marker" />
                <div className="event-content">
                  <p className="event-text">
                    <strong>{event.event_type}</strong> detected at {event.ip}
                  </p>
                  <span className="event-time">
                    {new Date(event.received_at).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
            {events.length === 0 && <p className="empty-msg">No recent events detected.</p>}
          </div>
        </div>

      </div>

      {/* 🔹 Storage Details */}
      <div className="activity storage-overview">
        <h3>Storage Health</h3>
        <div className="storage-bar-container">
          <div 
            className="storage-bar-progress" 
            style={{ width: `${(storage.used / storage.total) * 100}%` }} 
          />
        </div>
        <p className="storage-path">
          <FaHdd /> <strong>Storage Location:</strong> {storage.location} ({((storage.used / storage.total) * 100).toFixed(1)}% full)
        </p>
      </div>

    </div>
  );
};

export default DashboardPage;
