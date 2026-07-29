import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getNavConfig } from "../../data/navConfig";
import { useAuth } from "../../context/AuthContext";
import logoImg from "../../assets/logo.jpg";
import Dock from "../shared/Dock/Dock";
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
    Settings: true,
    Infrastructure: true,
  });
  const [search, setSearch] = useState("");

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };

  const toggle = (s) => setExpanded((p) => ({ ...p, [s]: !p[s] }));

  // Listen for external collapse requests
  useEffect(() => {
    const handleCollapse = () => {
      setIsCollapsed(true);
      localStorage.setItem("sidebar-collapsed", "true");
    };
    window.addEventListener("collapse-sidebar", handleCollapse);
    return () => window.removeEventListener("collapse-sidebar", handleCollapse);
  }, []);


  return (
    <aside className={`sidebar ${isCollapsed ? "sidebar--collapsed" : ""}`} aria-label="Main navigation">
      <div className="sidebar__logo">
        <button 
          className="sidebar__logo-btn" 
          onClick={toggleCollapse}
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          <div className="sidebar__logo-mark">
            <img src={logoImg} alt="MIRADOR" className="sidebar__logo-img" />
          </div>
        </button>
        {!isCollapsed && (
          <div className="sidebar__logo-text">
            <span className="sidebar__logo-name">MIRADOR VMS</span>
          </div>
        )}
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
      {isCollapsed ? (
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', paddingTop: '1rem' }}>
          <Dock
            direction="vertical"
            panelHeight={68}
            baseItemSize={44}
            magnification={64}
            distance={100}
            className="sidebar-dock"
            items={navConfig.map(({ section, page, icon, items }) => {
              const isActive = activePath === toPath(page) || items?.some((i) => activePath === toPath(i.page));
              return {
                icon: <div dangerouslySetInnerHTML={{ __html: icon }} style={{ color: isActive ? 'var(--teal)' : 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }} />,
                label: section,
                onClick: () => {
                  if (page) navigate(toPath(page));
                  else if (items?.length) navigate(toPath(items[0].page));
                },
                className: isActive ? "sidebar__dock-item--active" : ""
              };
            })}
          />
        </div>
      ) : (
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
      )}

    </aside>
  );
}