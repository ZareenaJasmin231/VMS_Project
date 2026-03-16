import { NAV_CONFIG } from "../../data/navConfig";
import "./TopBar.css";

export default function TopBar({ activePage }) {
  const section = NAV_CONFIG.find((s) => s.items.some((i) => i.page === activePage));
  const item    = section?.items.find((i) => i.page === activePage);

  return (
    <header className="topbar">
      {/* Breadcrumb */}
      <div className="topbar__breadcrumb">
        <span className="topbar__brand">MIRADOR VMS</span>
        <svg className="topbar__sep" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        <span className="topbar__section">{section?.section}</span>
        <svg className="topbar__sep" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        <span className="topbar__page">{item?.label}</span>
      </div>

      {/* Right cluster */}
      <div className="topbar__right">
        <div className="topbar__stat">
          <span className="topbar__stat-dot topbar__stat-dot--green" />
          <span>4 Cameras</span>
        </div>
        <div className="topbar__stat">
          <span className="topbar__stat-dot topbar__stat-dot--yellow" />
          <span>2 Alarms</span>
        </div>
        <div className="topbar__divider" />
        <div className="topbar__user">
          <div className="topbar__avatar">A</div>
          <span>Admin</span>
        </div>
      </div>
    </header>
  );
}
