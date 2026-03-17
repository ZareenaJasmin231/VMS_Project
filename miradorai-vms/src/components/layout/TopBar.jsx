import { useEffect, useState, useRef } from "react";
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

const PLUS_MENU = [
  { label: "Live view",     page: "live-view",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>` },
  { label: "Recordings",    page: "recordings",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>` },
  { label: "Smart search",  page: "smartsearch-settings",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>` },
  { label: "Configuration", page: "add-devices",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93A10 10 0 003 12c0 5.52 4.48 10 10 10s10-4.48 10-10c0-2.76-1.12-5.26-2.93-7.07"/></svg>` },
  { label: "Hotkeys",       page: "hotkeys",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/></svg>` },
  { label: "Logs",          page: "logs",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>` },
];

export default function TopBar({ activePage, onNavigate, onAlarmsClick, alarmsOpen }) {
  const [camCount,   setCamCount]   = useState(0);
  const [alarmCount, setAlarmCount] = useState(0);
  const [plusOpen,   setPlusOpen]   = useState(false);
  const plusRef = useRef(null);

  useEffect(() => {
    const update = () => {
      setCamCount(loadDevices().length);
      setAlarmCount(loadAlarms().filter((a) => !a.read).length);
    };
    update();
    const interval = setInterval(update, 5000);
    window.addEventListener("storage", update);
    return () => { clearInterval(interval); window.removeEventListener("storage", update); };
  }, []);

  // Close plus menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (plusRef.current && !plusRef.current.contains(e.target)) {
        setPlusOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const section = NAV_CONFIG.find((s) => s.items.some((i) => i.page === activePage));
  const item    = section?.items.find((i) => i.page === activePage);

  return (
    <header className="topbar">
      <div className="topbar__left">
        {/* + button */}
        <div className="topbar__plus-wrap" ref={plusRef}>
          <button
            className={`topbar__plus-btn ${plusOpen ? "topbar__plus-btn--open" : ""}`}
            onClick={() => setPlusOpen((p) => !p)}
            title="Open view">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>

          {plusOpen && (
            <div className="topbar__plus-menu">
              {PLUS_MENU.map((item) => (
                <button
                  key={item.page}
                  className="topbar__plus-item"
                  onClick={() => {
                    onNavigate?.(item.page);
                    setPlusOpen(false);
                  }}>
                  <span
                    className="topbar__plus-item-icon"
                    dangerouslySetInnerHTML={{ __html: item.icon }}
                  />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Breadcrumb */}
        <div className="topbar__breadcrumb">
          <span className="topbar__brand">MIRADOR VMS</span>
          <svg className="topbar__sep" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
          <span className="topbar__section">{section?.section}</span>
          {item && <>
            <svg className="topbar__sep" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            <span className="topbar__page">{item?.label}</span>
          </>}
        </div>
      </div>

      <div className="topbar__right">
        <div className="topbar__stat">
          <span className="topbar__stat-dot topbar__stat-dot--green" />
          <span>{camCount} Camera{camCount !== 1 ? "s" : ""}</span>
        </div>
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