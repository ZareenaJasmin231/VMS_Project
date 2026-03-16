import { useState } from "react";
import { NAV_CONFIG } from "../../data/navConfig";
import logoImg from "../../assets/logo.jpg";
import "./Sidebar.css";

function SvgIcon({ html }) {
  return <span className="nav-icon" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function Sidebar({ activePage, onNavigate }) {
  const [expanded, setExpanded] = useState({
    Devices: true, Storage: false, Recording: false, Client: false,
  });
  const [search, setSearch] = useState("");
  const toggle = (s) => setExpanded((p) => ({ ...p, [s]: !p[s] }));
  const activeSection = NAV_CONFIG.find((s) => s.items.some((i) => i.page === activePage))?.section;

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar__logo">
        <div className="sidebar__logo-mark">
          <img src={logoImg} alt="MIRADOR" className="sidebar__logo-img" />
        </div>
        <div className="sidebar__logo-text">
          <span className="sidebar__logo-name">MIRADOR</span>
          <span className="sidebar__logo-sub">VMS Platform</span>
        </div>
      </div>

      {/* Search */}
      <div className="sidebar__search-wrap">
        <svg className="sidebar__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          className="sidebar__search"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Nav */}
      <nav className="sidebar__nav">
        {NAV_CONFIG.map(({ section, icon, items }) => {
          const visible = items.filter((i) =>
            !search || i.label.toLowerCase().includes(search.toLowerCase())
          );
          if (search && visible.length === 0) return null;
          const isActiveSection = activeSection === section;
          return (
            <div key={section} className="sidebar__group">
              <button
                className={`sidebar__group-btn ${isActiveSection ? "sidebar__group-btn--active" : ""}`}
                onClick={() => toggle(section)}
              >
                <SvgIcon html={icon} />
                <span className="sidebar__group-label">{section}</span>
                <svg className={`sidebar__chevron ${expanded[section] ? "sidebar__chevron--open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </button>
              {(expanded[section] || search) && (
                <div className="sidebar__items">
                  {visible.map((item) => {
                    const isActive = activePage === item.page;
                    return (
                      <button
                        key={item.page}
                        className={`sidebar__item ${isActive ? "sidebar__item--active" : ""}`}
                        onClick={() => onNavigate(item.page)}
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
        <div className="sidebar__server-dot" />
        <div>
          <div className="sidebar__server-name">MIRADOR-VMS</div>
          <div className="sidebar__server-status">Connected · Secure</div>
        </div>
      </div>
    </aside>
  );
}