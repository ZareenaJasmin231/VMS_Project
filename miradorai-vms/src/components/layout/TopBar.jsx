import { useEffect, useState } from "react";
import { NAV_CONFIG } from "../../data/navConfig";
import "./TopBar.css";

function loadDevices() {
  try { return JSON.parse(localStorage.getItem("miradorai_devices") || "[]"); }
  catch { return []; }
}

function loadAlarms() {
  try { return JSON.parse(localStorage.getItem("miradorai_alarms") || "[]"); }
  catch { return []; }
}

export default function TopBar({ activePage, onAlarmsClick, alarmsOpen }) {
  const [camCount,   setCamCount]   = useState(0);
  const [alarmCount, setAlarmCount] = useState(0);

  useEffect(() => {
    const update = () => {
      const devices = loadDevices();
      const alarms  = loadAlarms();
      setCamCount(devices.length);
      setAlarmCount(alarms.filter((a) => !a.read).length);
    };

    update();

    // Re-check every 5 seconds for live updates
    const interval = setInterval(update, 5000);

    // Also listen for storage changes from other tabs
    window.addEventListener("storage", update);
    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", update);
    };
  }, []);

  const section = NAV_CONFIG.find((s) => s.items.some((i) => i.page === activePage));
  const item    = section?.items.find((i) => i.page === activePage);

  return (
    <header className="topbar">
      <div className="topbar__breadcrumb">
        <span className="topbar__brand">MIRADOR VMS</span>
        <svg className="topbar__sep" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        <span className="topbar__section">{section?.section}</span>
        <svg className="topbar__sep" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        <span className="topbar__page">{item?.label}</span>
      </div>

      <div className="topbar__right">
        {/* Camera count */}
        <div className="topbar__stat">
          <span className="topbar__stat-dot topbar__stat-dot--green" />
          <span>{camCount} Camera{camCount !== 1 ? "s" : ""}</span>
        </div>

        {/* Alarm count — clickable */}
        <button
          className={`topbar__stat topbar__stat--btn ${alarmsOpen ? "topbar__stat--active" : ""}`}
          onClick={onAlarmsClick}>
          <span className={`topbar__stat-dot ${alarmCount > 0 ? "topbar__stat-dot--yellow" : "topbar__stat-dot--green"}`} />
          <span>{alarmCount} Alarm{alarmCount !== 1 ? "s" : ""}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ width: 10, height: 10, marginLeft: 2,
              transform: alarmsOpen ? "rotate(180deg)" : "none",
              transition: "transform 0.2s" }}>
            <path d="M19 9l-7 7-7-7"/>
          </svg>
        </button>

        <div className="topbar__divider" />

        <div className="topbar__user">
          <div className="topbar__avatar">A</div>
          <span>Admin</span>
        </div>
      </div>
    </header>
  );
}