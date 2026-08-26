import "./AboutPage.css";
export default function AboutPage() {
  return (
    <div className="page-shell">
      <div className="page-header"><div><h1 className="page-title">About <span>MIRADOR</span></h1></div></div>
      <div className="about-layout">
        <div className="about-hero card">
          <div className="about-logo-mark">M</div>
          <div className="about-product-name">MIRADOR VMS</div>
          <div className="about-tagline">Intelligent Video Management Platform</div>
          <div className="about-version-badge">v1.4.0</div>
        </div>
        <div className="about-info card">
          <div className="about-section-title">Platform Details</div>
          {[["Version", "1.4.0"], ["Build Date", "2025-03-09"], ["Server", "MIRADOR-VMS"], ["License", "Enterprise"], ["Connected Cameras", "4"], ["Active Recordings", "0"]].map(([k, v]) => (
            <div key={k} className="about-row">
              <span className="about-key">{k}</span>
              <span className="about-val">{v}</span>
            </div>
          ))}
        </div>
        <div className="about-copy card">
          <div className="about-section-title">Legal</div>
          <p>© 2025 MIRADOR Technologies. All rights reserved.</p>
          <p>MIRADOR VMS is an independent video management platform. All third-party trademarks remain property of their respective owners.</p>
        </div>
      </div>
    </div>
  );
}
