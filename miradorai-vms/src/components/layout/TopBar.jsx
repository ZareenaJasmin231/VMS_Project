import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { NAV_CONFIG } from "../../data/navConfig";
import { useAuth } from "../../context/AuthContext";
import "./TopBar.css";

const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL)
  || "http://localhost:80";

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

// ---- Supervisor Details Modal ----
function SupervisorDetailsModal({ onClose }) {
  const [newPass, setNewPass]   = useState("");
  const [confirm, setConfirm]   = useState("");
  const [showPass, setShowPass] = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");
    if (newPass.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }
    if (newPass !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem("miradorai_token");
      const res = await fetch(`${API_BASE}/api/auth/supervisor-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ password: newPass, confirm_password: confirm }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || "Failed to save supervisor password.");
      }
      setSaved(true);
      setNewPass("");
      setConfirm("");
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("[AUTH] Supervisor save error:", err);
      setError(err.message || "Failed to save supervisor password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sv-overlay" role="dialog" aria-modal="true">
      <div className="sv-backdrop" onClick={onClose} />
      <div className="sv-modal" style={{ maxWidth: 400 }}>
        {/* Icon */}
        <div className="sv-icon-wrap">
          <svg className="sv-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h2 className="sv-title">Supervisor Password</h2>
        <p className="sv-subtitle">
          Set the password that clients must enter to access restricted pages (Playback, Backup, Masking).
        </p>

        <form onSubmit={handleSave} className="sv-form">
          <div className="sv-field">
            <label>Set Password</label>
            <div className="sv-input-wrap">
              <input
                type={showPass ? "text" : "password"}
                placeholder="Enter supervisor password"
                value={newPass}
                onChange={e => { setNewPass(e.target.value); setSaved(false); }}
                autoFocus
                required
              />
              <button type="button" className="sv-eye-btn" onClick={() => setShowPass(p => !p)} tabIndex={-1}>
                {showPass ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
          </div>

          <div className="sv-field">
            <label>Confirm Password</label>
            <div className="sv-input-wrap">
              <input
                type={showPass ? "text" : "password"}
                placeholder="Confirm supervisor password"
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setSaved(false); }}
                required
              />
            </div>
          </div>

          {error && <div className="sv-error">{error}</div>}
          {saved && (
            <div style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 8, padding: "0.6rem 0.9rem", color: "#86efac", fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
              Supervisor password saved successfully!
            </div>
          )}

          <div className="sv-actions">
            <button type="button" className="sv-btn-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="sv-btn-verify" disabled={!newPass || !confirm}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v14z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Save Password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
  const [showSupervisorDetails, setShowSupervisorDetails] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const role = user?.role;
  
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
        setSettingsOpen(false);
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

  // ---- Settings items per role ----
  const ADMIN_SETTINGS_ITEMS = [
    { label: "Client Settings", page: "client-settings", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>` },
    { label: "User Settings",   page: "user-settings",   icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 10-16 0"/></svg>` },
    { label: "Profile",         page: "profile",          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>` },
    { label: "About",           page: "about",            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>` },
  ];

  const CLIENT_SETTINGS_ITEMS = [
    { label: "Client Settings", page: "client-settings", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>` },
    { label: "About",           page: "about",            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>` },
  ];

  const OPERATOR_SETTINGS_ITEMS = [
    { label: "About", page: "about", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>` },
  ];

  const settingsItems = role === "admin"
    ? ADMIN_SETTINGS_ITEMS
    : role === "operator"
      ? OPERATOR_SETTINGS_ITEMS
      : CLIENT_SETTINGS_ITEMS;

  const navigateTo = (page) => {
    navigate(`/${page}`);
    setUserMenuOpen(false);
    setSettingsOpen(false);
  };

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
      </div>

      <div className="topbar__right">
        <div className="topbar__divider" />
        
        <div className="topbar__user-wrap" ref={userRef}>
          <div 
            className={`topbar__user ${userMenuOpen ? "topbar__user--active" : ""}`}
            onClick={() => { setUserMenuOpen(!userMenuOpen); setSettingsOpen(false); }}
          >
            <div className="topbar__avatar">
              {user?.email?.charAt(0).toUpperCase() || "A"}
            </div>
          </div>

          {userMenuOpen && (
            <div className="topbar__user-dropdown">
              {/* Header */}
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

                {/* ---- Settings expandable ---- */}
                <div
                  className={`topbar__user-dropdown-item topbar__settings-toggle ${settingsOpen ? "topbar__settings-toggle--open" : ""}`}
                  onClick={(e) => { e.stopPropagation(); setSettingsOpen(p => !p); }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
                  </svg>
                  <span>Settings</span>
                  <svg className={`topbar__settings-chevron ${settingsOpen ? "topbar__settings-chevron--open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </div>

                {/* Settings sub-items */}
                {settingsOpen && (
                  <div className="topbar__settings-submenu">
                    {settingsItems.map((si) => (
                      <button
                        key={si.page}
                        className="topbar__settings-subitem"
                        onClick={() => navigateTo(si.page)}
                      >
                        <span dangerouslySetInnerHTML={{ __html: si.icon }} />
                        <span>{si.label}</span>
                      </button>
                    ))}

                    {/* Admin-only: Supervisor Details */}
                    {role === "admin" && (
                      <>
                        <div className="topbar__settings-divider" />
                        <button
                          className="topbar__settings-subitem topbar__settings-subitem--supervisor"
                          onClick={() => { setShowSupervisorDetails(true); setUserMenuOpen(false); setSettingsOpen(false); }}
                        >
                          <span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                            </svg>
                          </span>
                          <span>Supervisor Details</span>
                          <span className="topbar__supervisor-badge">ADMIN</span>
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Last login */}
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

      {/* Supervisor Details Modal (admin only) */}
      {showSupervisorDetails && (
        <SupervisorDetailsModal onClose={() => setShowSupervisorDetails(false)} />
      )}
    </header>
  );
}

