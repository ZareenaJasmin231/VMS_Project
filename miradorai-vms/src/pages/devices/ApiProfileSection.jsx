/**
 * ApiProfileSection.jsx
 * 
 * Drop into CameraFeaturesPage as a new nav item under "Device".
 * Shows the dynamically detected API profile for any camera brand.
 * 
 * ADD TO NAV_SECTIONS in CameraFeaturesPage.jsx:
 *   { id: "api-profile", label: "API Profile", icon: "⚙", capKey: null }
 * 
 * ADD TO renderContent() switch:
 *   case "api-profile": return <ApiProfileSection {...props} />;
 */

import { useState, useEffect } from "react";

const API = "http://192.168.126.200:8000";

// Brand color config — purely cosmetic, no logic gating on this
const BRAND_COLORS = {
  hikvision: { accent: "#e63946", label: "ISAPI"    },
  dahua:     { accent: "#f4a261", label: "CGI/RPC2" },
  axis:      { accent: "#2a9d8f", label: "VAPIX"    },
  bosch:     { accent: "#4361ee", label: "REST"     },
  uniview:   { accent: "#7209b7", label: "LAPI"     },
  hanwha:    { accent: "#3a86ff", label: "SUNAPI"   },
  reolink:   { accent: "#06d6a0", label: "CGI"      },
  generic:   { accent: "#6b7a99", label: "ONVIF"    },
};

export default function ApiProfileSection({ device, onCall, showToast }) {
  const [profile,   setProfile]   = useState(null);
  const [summary,   setSummary]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [rescanning, setRescanning] = useState(false);

  // Load saved profile on mount
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res  = await fetch(`${API}/api/camera/api-profile/${device.ip}`);
        const data = await res.json();
        setProfile(data.api_profile);
        setSummary(data.summary);
      } catch (e) {
        console.error("[ApiProfile] load failed:", e);
      }
      setLoading(false);
    })();
  }, [device.ip]);

  // Re-scan button — triggers fresh detection
  const rescan = async () => {
    setRescanning(true);
    try {
      const res  = await fetch(`${API}/api/camera/detect-api`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          ip:       device.ip,
          port:     device.port     || 80,
          username: device.username || "",
          password: device.password || "",
        }),
      });
      const data = await res.json();
      setProfile(data.api_profile);
      setSummary(data.summary);
      showToast(
        data.api_profile?.confirmed
          ? `${data.api_profile.display_name} API detected`
          : "No brand API found — ONVIF only",
        data.api_profile?.confirmed ? "success" : "info"
      );
    } catch (e) {
      showToast("Re-scan failed: " + e.message, "error");
    }
    setRescanning(false);
  };

  if (loading) {
    return (
      <div className="cfp-loading">
        <div className="cfp-spinner" />
        <div className="cfp-loading-text">Loading API profile…</div>
      </div>
    );
  }

  const brand      = profile?.brand || "generic";
  const branding   = BRAND_COLORS[brand] || BRAND_COLORS.generic;
  const endpoints  = profile?.endpoints  || {};
  const features   = profile?.features   || {};
  const verified   = profile?.verified_endpoints || {};

  return (
    <>
      <div className="cfp-section-title">Camera API Profile</div>
      <div className="cfp-section-desc">
        Dynamically detected HTTP API — no hardcoded mappings
      </div>

      {/* ── Brand summary card ── */}
      <div className="cfp-card" style={{ borderColor: profile?.confirmed ? branding.accent + "40" : "#1a2332" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          {/* Brand badge */}
          <div style={{
            background: branding.accent + "18",
            border:     `1px solid ${branding.accent}40`,
            borderRadius: 8,
            padding:    "8px 14px",
            color:      branding.accent,
            fontFamily: "'Syne', sans-serif",
            fontWeight: 700,
            fontSize:   13,
            letterSpacing: "0.04em",
          }}>
            {profile?.display_name || "Unknown"}
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#4a5a72", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              API Protocol
            </div>
            <div style={{ fontSize: 12, color: branding.accent, fontWeight: 500, marginTop: 2 }}>
              {branding.label}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {/* Detection status */}
            <span className={`cfp-chip ${profile?.confirmed ? "cfp-chip--on" : "cfp-chip--off"}`}>
              {profile?.confirmed ? "✓ Detected" : "⚠ ONVIF Only"}
            </span>
            {/* Re-scan button */}
            <button
              className="cfp-action-btn"
              onClick={rescan}
              disabled={rescanning}
              style={{ fontSize: 10 }}
            >
              {rescanning ? "Scanning…" : "Re-scan"}
            </button>
          </div>
        </div>

        {/* Connection details */}
        <div className="cfp-info-grid">
          {[
            ["Base URL",    profile?.base_url],
            ["Auth Method", profile?.auth_method?.toUpperCase()],
            ["Port",        profile?.port],
            ["Scheme",      profile?.scheme?.toUpperCase()],
            ["Snapshot",    profile?.snapshot_url ? "Available" : "N/A"],
            ["Endpoints",   Object.keys(endpoints).length + " defined"],
          ].map(([k, v]) => (
            <div key={k} className="cfp-info-item">
              <span className="cfp-info-key">{k}</span>
              <span className="cfp-info-val" style={{ wordBreak: "break-all" }}>
                {v || "—"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Feature flags ── */}
      {Object.keys(features).length > 0 && (
        <div className="cfp-card">
          <div className="cfp-card-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            Brand-Specific Features
          </div>
          <div className="cfp-event-chips">
            {Object.entries(features).map(([key, val]) => (
              <span
                key={key}
                className={`cfp-chip ${val ? "cfp-chip--on" : "cfp-chip--off"}`}
              >
                {key.replace(/_/g, " ").toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Endpoint list ── */}
      {Object.keys(endpoints).length > 0 && (
        <div className="cfp-card">
          <div className="cfp-card-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            Available API Endpoints
            <span className="cfp-nav-badge">{Object.keys(endpoints).length}</span>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                <td style={{ color: "#2e3d55", paddingBottom: 8, width: 160, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Function
                </td>
                <td style={{ color: "#2e3d55", paddingBottom: 8, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Path
                </td>
                <td style={{ color: "#2e3d55", paddingBottom: 8, width: 80, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", textAlign: "right" }}>
                  Status
                </td>
              </tr>
            </thead>
            <tbody>
              {Object.entries(endpoints).map(([key, path]) => {
                const status = verified[key];
                return (
                  <tr key={key} style={{ borderTop: "1px solid #111923" }}>
                    <td style={{ padding: "8px 0", color: "#6b7a99" }}>
                      {key.replace(/_/g, " ")}
                    </td>
                    <td style={{ padding: "8px 0", color: "#3b82f6", wordBreak: "break-all", fontSize: 10 }}>
                      {path}
                    </td>
                    <td style={{ padding: "8px 0", textAlign: "right" }}>
                      {status === true   && <span className="cfp-chip cfp-chip--on"  style={{ fontSize: 9 }}>✓</span>}
                      {status === false  && <span className="cfp-chip cfp-chip--off" style={{ fontSize: 9 }}>✗</span>}
                      {status === "parameterized" && <span style={{ color: "#2e3d55", fontSize: 9 }}>param</span>}
                      {status === undefined && <span style={{ color: "#1a2332", fontSize: 9 }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {Object.keys(verified).length === 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: "#4a5a72" }}>
              Endpoints not yet verified. Re-scan to check which are reachable.
            </div>
          )}
        </div>
      )}

      {/* ONVIF-only notice */}
      {profile?.onvif_only && (
        <div className="cfp-card" style={{ borderColor: "#f59e0b40" }}>
          <div style={{ color: "#f59e0b", fontSize: 12 }}>
            ⚠ No brand-specific HTTP API detected. All features are served via ONVIF only.
          </div>
          <div style={{ color: "#4a5a72", fontSize: 11, marginTop: 6 }}>
            This is normal for generic ONVIF cameras. All standard features (PTZ, imaging, events) still work.
          </div>
        </div>
      )}
    </>
  );
}