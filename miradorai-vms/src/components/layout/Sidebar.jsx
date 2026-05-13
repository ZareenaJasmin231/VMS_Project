import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getNavConfig } from "../../data/navConfig";
import { useAuth } from "../../context/AuthContext";
import logoImg from "../../assets/logo.jpg";
import "./Sidebar.css";

function SvgIcon({ html }) {
  return <span className="nav-icon" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function Sidebar({ userRole }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Derive active path for highlight checks
  const activePath = location.pathname; // e.g. "/live-view"
  const toPath = (page) => `/${page}`; // "live-view" → "/live-view"

  const navConfig = getNavConfig(userRole || user?.role);

  const [isCollapsed, setIsCollapsed] = useState(() => {
    return localStorage.getItem("sidebar-collapsed") === "true";
  });
  const [expanded, setExpanded] = useState({
    Cameras: true,
    "Recording & Events": false,
    Storage: false,
    Client: false,
  });
  const [search, setSearch] = useState("");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };

  const toggle = (s) => setExpanded((p) => ({ ...p, [s]: !p[s] }));

  const handleLogoutClick = () => setShowLogoutConfirm(true);
  const confirmLogout = () => { setShowLogoutConfirm(false); logout(); };
  const cancelLogout = () => setShowLogoutConfirm(false);

  return (
    <aside className={`sidebar ${isCollapsed ? "sidebar--collapsed" : ""}`} aria-label="Main navigation">
      {/* Logo */}
      <div className="sidebar__logo">
        <div className="sidebar__logo-mark">
          <img src={logoImg} alt="MIRADOR" className="sidebar__logo-img" />
        </div>
        {!isCollapsed && (
          <div className="sidebar__logo-text">
            <span className="sidebar__logo-name">MIRADOR</span>
            <span className="sidebar__logo-sub">VMS Platform</span>
          </div>
        )}
        <button 
          className="sidebar__collapse-toggle" 
          onClick={toggleCollapse}
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {isCollapsed ? (
              <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
            ) : (
              <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
            )}
          </svg>
        </button>
      </div>

      {/* Search */}
      {!isCollapsed && (
        <div className="sidebar__search-wrap" role="search">
          <svg className="sidebar__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            className="sidebar__search"
            placeholder="Search..."
            aria-label="Search menu"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      

      {/* Nav */}
      <nav className="sidebar__nav" role="navigation" aria-label="Application menu">
        {navConfig.map(({ section, page, icon, items }) => {
          // Direct nav item (e.g. Live View, About)
          if (page) {
            const isActive = activePath === toPath(page);
            const matchesSearch = !search || section.toLowerCase().includes(search.toLowerCase());
            if (!matchesSearch) return null;

            return (
              <button
                key={section}
                className={`sidebar__direct-item ${isActive ? "sidebar__direct-item--active" : ""}`}
                onClick={() => navigate(toPath(page))}
                aria-current={isActive ? "page" : undefined}
                title={isCollapsed ? section : undefined}
              >
                <SvgIcon html={icon} />
                {!isCollapsed && <span className="sidebar__direct-item-label">{section}</span>}
                {isActive && <span className="sidebar__item-dot" />}
              </button>
            );
          }

          // Expandable group
          const visible = items?.filter((i) =>
            !search || i.label.toLowerCase().includes(search.toLowerCase())
          ) || [];

          if (search && visible.length === 0) return null;

          const hasActiveItem = items?.some((i) => activePath === toPath(i.page));

          return (
            <div key={section} className="sidebar__group">
              <button
                className={`sidebar__group-btn ${hasActiveItem ? "sidebar__group-btn--active" : ""}`}
                onClick={() => isCollapsed ? navigate(toPath(items[0].page)) : toggle(section)}
                aria-expanded={expanded[section] ? "true" : "false"}
                aria-controls={`group-${section.replace(/\s+/g, "-").toLowerCase()}`}
                title={isCollapsed ? section : undefined}
              >
                <SvgIcon html={icon} />
                {!isCollapsed && <span className="sidebar__group-label">{section}</span>}
                {!isCollapsed && (
                  <svg
                    className={`sidebar__chevron ${expanded[section] ? "sidebar__chevron--open" : ""}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  >
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                )}
              </button>

              {!isCollapsed && (expanded[section] || search) && (
                <div
                  className="sidebar__items"
                  id={`group-${section.replace(/\s+/g, "-").toLowerCase()}`}
                  role="group"
                  aria-label={`${section} submenu`}
                >
                  {visible.map((item) => {
                    const isActive = activePath === toPath(item.page);
                    return (
                      <button
                        key={item.page}
                        className={`sidebar__item ${isActive ? "sidebar__item--active" : ""}`}
                        onClick={() => navigate(toPath(item.page))}
                        aria-current={isActive ? "page" : undefined}
                      >
                        <SvgIcon html={item.icon} />
                        <span>{item.label}</span>
                        {isActive && <span className="sidebar__item-dot" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar__footer">
        <div className="sidebar__user-info">
          <div className="sidebar__user-avatar" title={user?.email}>
            {user?.email?.charAt(0).toUpperCase()}
          </div>
          {!isCollapsed && (
            <div className="sidebar__user-details">
              <div className="sidebar__user-email" title={user?.email}>{user?.email}</div>
              <div className="sidebar__user-meta">
                <span className={`sidebar__user-badge ${user?.role}`}>
                  {user?.role?.toUpperCase()}
                </span>
                {user?.loginDate && (
                  <span className="sidebar__user-login-date">{user.loginDate}</span>
                )}
              </div>
            </div>
          )}
        </div>
        {!isCollapsed && (
          <button
            className="sidebar__logout-btn"
            onClick={handleLogoutClick}
            title="Logout"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 8l4-4m0 0l-4 4m4-4v12a2 2 0 0 1-2 2h-4"/>
            </svg>
            <span>Logout</span>
          </button>
        )}
        {isCollapsed && (
          <button
            className="sidebar__logout-btn-collapsed"
            onClick={handleLogoutClick}
            title="Logout"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 8l4-4m0 0l-4 4m4-4v12a2 2 0 0 1-2 2h-4"/>
            </svg>
          </button>
        )}
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
                onClick={cancelLogout}
              >
                Cancel
              </button>
              <button
                className="logout-modal__btn logout-modal__btn--confirm"
                onClick={confirmLogout}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}