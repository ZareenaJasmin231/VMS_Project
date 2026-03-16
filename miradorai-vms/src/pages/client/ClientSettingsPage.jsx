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
        <rect x="4"  y="4"  width="28" height="28" fill="#b0bec5" />
        <rect x="4"  y="36" width="28" height="24" fill="#78909c" />
        <rect x="36" y="4"  width="24" height="24" fill="#cfd8dc" />
        <rect x="36" y="32" width="24" height="28" fill="#263238" />
        <rect x="40" y="36" width="16" height="4"  fill="#37474f" />
        <rect x="40" y="44" width="10" height="3"  fill="#37474f" />
      </svg>
    ),
  },
  {
    id: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4"  y="4"  width="56" height="56" fill="#f5f5f5" />
        <rect x="4"  y="4"  width="56" height="14" fill="#e0e0e0" />
        <rect x="8"  y="22" width="24" height="34" fill="#eeeeee" />
        <rect x="36" y="22" width="20" height="8"  fill="#e0e0e0" />
        <rect x="36" y="34" width="20" height="4"  fill="#e0e0e0" />
        <rect x="36" y="42" width="14" height="4"  fill="#e0e0e0" />
      </svg>
    ),
  },
  {
    id: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4"  y="4"  width="56" height="56" fill="#1e1e2e" />
        <rect x="4"  y="4"  width="56" height="14" fill="#181825" />
        <rect x="8"  y="22" width="24" height="34" fill="#11111b" />
        <rect x="36" y="22" width="20" height="8"  fill="#313244" />
        <rect x="36" y="34" width="20" height="4"  fill="#313244" />
        <rect x="36" y="42" width="14" height="4"  fill="#313244" />
      </svg>
    ),
  },
];

/* ── Theme CSS variable sets ─────────────────────────────────── */
const THEME_VARS = {
  dark: {
    "--bg-base":       "#0d0f14",
    "--bg-surface":    "#13161e",
    "--bg-elevated":   "#1a1e28",
    "--bg-hover":      "#1f2433",
    "--bg-active":     "#1e2d3d",
    "--border":        "#252a38",
    "--border-light":  "#2e3548",
    "--text-primary":  "#e8eaf0",
    "--text-secondary":"#8892a4",
    "--text-muted":    "#505870",
  },
  light: {
    "--bg-base":       "#f0f2f5",
    "--bg-surface":    "#ffffff",
    "--bg-elevated":   "#f8f9fb",
    "--bg-hover":      "#e8ecf2",
    "--bg-active":     "#dde3ee",
    "--border":        "#d0d6e0",
    "--border-light":  "#c0c8d8",
    "--text-primary":  "#111827",
    "--text-secondary":"#374151",
    "--text-muted":    "#6b7280",
  },
  system: null, // will use media query detection
};

function applyTheme(themeId) {
  const root = document.documentElement;

  // Detect system preference for "system" mode
  if (themeId === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    themeId = prefersDark ? "dark" : "light";
  }

  const vars = THEME_VARS[themeId];
  if (!vars) return;

  Object.entries(vars).forEach(([key, val]) => {
    root.style.setProperty(key, val);
  });

  // Store preference
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