import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { NAV_CONFIG } from "../../data/navConfig";
import { useAuth } from "../../context/AuthContext";
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

export default function TopBar({
  activePage,
  onNavigate,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onAlarmsClick,
  alarmsOpen,
}) {
  const [camCount,   setCamCount]   = useState(0);
  const [alarmCount, setAlarmCount] = useState(0);
  const [plusOpen,   setPlusOpen]   = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  
  const plusRef = useRef(null);
  const userRef = useRef(null);

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

  // Close menus on outside click
  useEffect(() => {
    const handler = (e) => {
      if (plusRef.current && !plusRef.current.contains(e.target)) {
        setPlusOpen(false);
      }
      if (userRef.current && !userRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const section = NAV_CONFIG.find((s) => {
    if (s.page === activePage) return true;
    if (s.items?.some((i) => i.page === activePage)) return true;
    return false;
  });
  const item = section?.items?.find((i) => i.page === activePage) || 
               (section?.page === activePage ? { label: section.section } : null);

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

        <div className="topbar__history">
          <button
            className="topbar__history-btn"
            disabled={!canGoBack}
            onClick={onBack}
            title="Go back"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            className="topbar__history-btn"
            disabled={!canGoForward}
            onClick={onForward}
            title="Go forward"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        {/* Breadcrumb
        <div className="topbar__breadcrumb">
          <span className="topbar__brand">MIRADOR VMS</span>
          <svg className="topbar__sep" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
          <span className="topbar__section">{section?.section}</span>
          {item && <>
            <svg className="topbar__sep" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            <span className="topbar__page">{item?.label}</span>
          </>}
        </div> */}
      </div>

      <div className="topbar__right">
        <div className="topbar__divider" />
        
        <div className="topbar__user-wrap" ref={userRef}>
          <div 
            className={`topbar__user ${userMenuOpen ? "topbar__user--active" : ""}`}
            onClick={() => setUserMenuOpen(!userMenuOpen)}
          >
            <div className="topbar__avatar">
              {user?.email?.charAt(0).toUpperCase() || "A"}
            </div>
          </div>

          {userMenuOpen && (
            <div className="topbar__user-dropdown">
              <div className="topbar__user-dropdown-header">
                <div className="topbar__user-dropdown-avatar">
                  {user?.email?.charAt(0).toUpperCase() || "A"}
                </div>
                <div className="topbar__user-dropdown-info">
                  <div className="topbar__user-dropdown-name">{user?.email?.split("@")[0] || "Administrator"}</div>
                  <div className="topbar__user-dropdown-role-row">
                    <span className={`topbar__user-badge ${user?.role || "admin"}`}>
                      {user?.role?.toUpperCase() || "ADMIN"}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="topbar__user-dropdown-body">
                {/* 
                <div 
                  className="topbar__user-dropdown-item"
                  onClick={() => { navigate("/user-settings"); setUserMenuOpen(false); }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                  <span>User Settings</span>
                </div>
                */}
                
                <div 
                  className="topbar__user-dropdown-item"
                  onClick={() => { navigate("/settings"); setUserMenuOpen(false); }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
                  </svg>
                  <span>Settings</span>
                </div>
                {user?.loginDate && (
                  <div className="topbar__user-dropdown-meta">
                    <div className="topbar__user-dropdown-meta-label">Last Login:</div>
                    <div className="topbar__user-dropdown-meta-value">{user.loginDate}</div>
                  </div>
                )}
              </div>

              <div className="topbar__user-dropdown-footer">
                <button 
                  className="topbar__logout-btn"
                  onClick={() => setShowLogoutConfirm(true)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
                  </svg>
                  <span>LOGOUT</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="logout-modal-overlay">
          <div className="logout-modal">
            <div className="logout-modal__header">
              <h2>Confirm Logout</h2>
            </div>
            <div className="logout-modal__body">
              <p>Are you sure you want to logout?</p>
            </div>
            <div className="logout-modal__footer">
              <button
                className="logout-modal__btn logout-modal__btn--cancel"
                onClick={() => setShowLogoutConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="logout-modal__btn logout-modal__btn--confirm"
                onClick={() => {
                  setShowLogoutConfirm(false);
                  logout();
                }}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}