import { useState, useEffect } from "react";
import Toggle from "../../components/shared/Toggle";
import Button from "../../components/shared/Button";
import "./ClientSettingsPage.css";

const LANGUAGES = [
  "English", "French", "German", "Spanish", "Italian",
  "Portuguese", "Japanese", "Chinese (Simplified)", "Arabic",
];

const THEMES = [
  {
    id: "system",
    label: "System",
    icon: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Left half — light */}
        <rect x="4"  y="4"  width="28" height="56" fill="#f0f2f5" />
        <rect x="4"  y="4"  width="28" height="14" fill="#e0e0e0" />
        <rect x="8"  y="22" width="12" height="30" fill="#eeeeee" />
        <rect x="22" y="22" width="8"  height="6"  fill="#e0e0e0" />
        <rect x="22" y="32" width="8"  height="4"  fill="#e0e0e0" />
        {/* Right half — dark */}
        <rect x="32" y="4"  width="28" height="56" fill="#0d0f14" />
        <rect x="32" y="4"  width="28" height="14" fill="#13161e" />
        <rect x="36" y="22" width="12" height="30" fill="#1a1e28" />
        <rect x="50" y="22" width="8"  height="6"  fill="#252a38" />
        <rect x="50" y="32" width="8"  height="4"  fill="#252a38" />
        {/* Center divider */}
        <rect x="31" y="4"  width="2"  height="56" fill="#00c8a0" opacity="0.6" />
      </svg>
    ),
  },
  {
    id: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4"  y="4"  width="56" height="56" fill="#f0f2f5" />
        <rect x="4"  y="4"  width="56" height="14" fill="#e0e0e0" />
        <rect x="8"  y="22" width="20" height="34" fill="#eeeeee" />
        <rect x="32" y="22" width="24" height="8"  fill="#e0e0e0" />
        <rect x="32" y="34" width="24" height="4"  fill="#e0e0e0" />
        <rect x="32" y="42" width="16" height="4"  fill="#e0e0e0" />
        {/* Sun icon hint */}
        <circle cx="52" cy="10" r="4" fill="#ffb340" opacity="0.8" />
      </svg>
    ),
  },
  {
    id: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4"  y="4"  width="56" height="56" fill="#0d0f14" />
        <rect x="4"  y="4"  width="56" height="14" fill="#13161e" />
        <rect x="8"  y="22" width="20" height="34" fill="#1a1e28" />
        <rect x="32" y="22" width="24" height="8"  fill="#252a38" />
        <rect x="32" y="34" width="24" height="4"  fill="#252a38" />
        <rect x="32" y="42" width="16" height="4"  fill="#252a38" />
        {/* Moon icon hint */}
        <path d="M52 7 a5 5 0 0 1 0 8 a6 6 0 0 1 0-8z" fill="#8892a4" opacity="0.7" />
      </svg>
    ),
  },
];

/* ── Theme CSS variable sets ─────────────────────────────────── */
const THEME_VARS = {
  dark: {
    "--bg-base":        "#0d0f14",
    "--bg-surface":     "#13161e",
    "--bg-elevated":    "#1a1e28",
    "--bg-hover":       "#1f2433",
    "--bg-active":      "#1e2d3d",
    "--border":         "#252a38",
    "--border-light":   "#2e3548",
    "--text-primary":   "#e8eaf0",
    "--text-secondary": "#8892a4",
    "--text-muted":     "#505870",
  },
  light: {
    "--bg-base":        "#f0f2f5",
    "--bg-surface":     "#ffffff",
    "--bg-elevated":    "#f8f9fb",
    "--bg-hover":       "#edf0f5",
    "--bg-active":      "#dde3ee",
    "--border":         "#d0d6e0",
    "--border-light":   "#c0c8d8",
    "--text-primary":   "#111827",
    "--text-secondary": "#374151",
    "--text-muted":     "#6b7280",
  },
  system: {
    // resolved at runtime based on OS preference
  },
};

function applyTheme(themeId) {
  const root = document.documentElement;
  let resolved = themeId;

  if (themeId === "system") {
    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  // Remove old theme attribute
  root.removeAttribute("data-theme");
  root.setAttribute("data-theme", resolved);

  const vars = resolved === "light" ? {
    "--bg-base":        "#f0f2f5",
    "--bg-surface":     "#ffffff",
    "--bg-elevated":    "#f8f9fb",
    "--bg-hover":       "#edf0f5",
    "--bg-active":      "#dde3ee",
    "--border":         "#d0d6e0",
    "--border-light":   "#c0c8d8",
    "--text-primary":   "#111827",
    "--text-secondary": "#374151",
    "--text-muted":     "#6b7280",
    "--teal":           "#009e7f",
    "--teal-dim":       "#007d65",
    "--teal-glow":      "rgba(0,158,127,0.15)",
    "--teal-subtle":    "rgba(0,158,127,0.08)",
  } : {
    "--bg-base":        "#0d0f14",
    "--bg-surface":     "#13161e",
    "--bg-elevated":    "#1a1e28",
    "--bg-hover":       "#1f2433",
    "--bg-active":      "#1e2d3d",
    "--border":         "#252a38",
    "--border-light":   "#2e3548",
    "--text-primary":   "#e8eaf0",
    "--text-secondary": "#8892a4",
    "--text-muted":     "#505870",
    "--teal":           "#00c8a0",
    "--teal-dim":       "#00a882",
    "--teal-glow":      "rgba(0,200,160,0.15)",
    "--teal-subtle":    "rgba(0,200,160,0.08)",
  };

  Object.entries(vars).forEach(([key, val]) => {
    root.style.setProperty(key, val);
  });

  // Force body background update too
  document.body.style.background = vars["--bg-base"];
  document.body.style.color = vars["--text-primary"];

  localStorage.setItem("miradorai_theme", themeId);
}

function Section({ title, children }) {
  return (
    <div className="cs-section">
      <div className="cs-section__title">{title}</div>
      <div className="cs-section__body">{children}</div>
    </div>
  );
}

function SettingRow({ label, hint, children }) {
  return (
    <div className="cs-row">
      <div className="cs-row__label">
        <span>{label}</span>
        {hint && <span className="cs-row__hint" title={hint}>ℹ</span>}
      </div>
      <div className="cs-row__control">{children}</div>
    </div>
  );
}

export default function ClientSettingsPage() {
  const [theme,          setTheme]          = useState(() => localStorage.getItem("miradorai_theme") || "dark");
  const [runOnStart,     setRunOnStart]     = useState(false);
  const [showWhatsNew,   setShowWhatsNew]   = useState(true);
  const [showCamNames,   setShowCamNames]   = useState(true);
  const [showRecInd,     setShowRecInd]     = useState(true);
  const [showEventInd,   setShowEventInd]   = useState(true);
  const [flashCoverage,  setFlashCoverage]  = useState(true);
  const [language,       setLanguage]       = useState("English");
  const [shareAnonymous, setShareAnonymous] = useState(true);

  // Apply saved theme on mount
  useEffect(() => {
    applyTheme(theme);
  }, []);

  const handleThemeChange = (id) => {
    setTheme(id);
    applyTheme(id);
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Client <span>Settings</span></h1>
          <p className="page-desc">
            These settings apply to all MIRADOR VMS users on this computer.
          </p>
        </div>
      </div>

      <div className="cs-body">

        {/* ── Theme ── */}
        <Section title="Theme">
          <div className="cs-themes">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`cs-theme-card${theme === t.id ? " cs-theme-card--active" : ""}`}
                onClick={() => handleThemeChange(t.id)}
              >
                <div className="cs-theme-card__icon">{t.icon}</div>
                <span className="cs-theme-card__label">{t.label}</span>
              </button>
            ))}
          </div>
        </Section>

        {/* ── General ── */}
        <Section title="General">
          <SettingRow label="Run application when Windows starts">
            <Toggle value={runOnStart} onChange={setRunOnStart} />
          </SettingRow>
          <SettingRow label="Show What's new after each update">
            <Toggle value={showWhatsNew} onChange={setShowWhatsNew} />
          </SettingRow>
        </Section>

        {/* ── Live view ── */}
        <Section title="Live view">
          <SettingRow label="Show camera names in live views">
            <Toggle value={showCamNames} onChange={setShowCamNames} />
          </SettingRow>
          <SettingRow label="Show recording indicators in live views and maps">
            <Toggle value={showRecInd} onChange={setShowRecInd} />
          </SettingRow>
          <SettingRow label="Show event indicators in live views and maps">
            <Toggle value={showEventInd} onChange={setShowEventInd} />
          </SettingRow>
        </Section>

        {/* ── Maps ── */}
        <Section title="Maps">
          <SettingRow
            label="Allow flashing coverage areas for all maps"
            hint="Flashing coverage areas highlight camera fields of view on the map."
          >
            <Toggle value={flashCoverage} onChange={setFlashCoverage} />
          </SettingRow>
        </Section>

        {/* ── Language ── */}
        <Section title="Language">
          <div className="cs-lang-wrap">
            <select className="cs-select" value={language}
              onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
            </select>
            <p className="cs-lang-hint">
              Language changes will take effect when you restart the application.
            </p>
          </div>
        </Section>

        {/* ── Feedback ── */}
        <Section title="Feedback">
          <label className="cs-checkbox-row">
            <input type="checkbox" checked={shareAnonymous}
              onChange={(e) => setShareAnonymous(e.target.checked)} />
            <span>
              Share anonymous client usage data with MIRADOR to help us improve the
              application and your user experience.
            </span>
          </label>
          <p className="cs-feedback-hint">
            Edit anonymous server usage data setting in the Server Settings under the
            Configuration tab.
          </p>
        </Section>

      </div>

      <div className="page-footer">
        <span />
        <div className="page-footer-right">
          <Button label="Apply" variant="primary" onClick={() => applyTheme(theme)} />
        </div>
      </div>
    </div>
  );
}