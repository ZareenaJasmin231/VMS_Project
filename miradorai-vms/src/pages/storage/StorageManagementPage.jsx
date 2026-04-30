import { useEffect, useRef, useState } from "react";
import SearchBar from "../../components/shared/SearchBar";
import "./StorageManagementPage.css";

const BACKEND = "http://localhost:8000";

// ── Path helpers ────────────────────────────────────────────────────────────
// The backend always works with Linux container paths (/recordings/...).
// The UI shows Windows-friendly paths (D:\REC\...) for readability.
// These two helpers convert between the two representations.

function toDisplayPath(containerPath) {
  if (!containerPath) return "";
  // /recordings        → D:\REC
  // /recordings/site-A → D:\REC\site-A
  if (containerPath.startsWith("/recordings")) {
    const suffix = containerPath.slice("/recordings".length).replace(/\//g, "\\");
    return `D:\\REC${suffix}`;
  }
  return containerPath;
}

function toContainerPath(displayPath) {
  if (!displayPath) return "";
  const p = displayPath.trim();

  // Already a container path
  if (p.startsWith("/")) return p;

  // Windows path: D:\REC\subfolder  or  D:/REC/subfolder
  const winMatch = p.match(/^[A-Za-z]:[/\\](.*)$/);
  if (winMatch) {
    const rest   = winMatch[1].replace(/\\/g, "/");
    const parts  = rest.split("/").filter(Boolean);
    const first  = (parts[0] || "").toLowerCase();
    // Strip the leading REC / recordings / recording folder
    const sub    = ["rec", "recordings", "recording"].includes(first)
                     ? parts.slice(1).join("/")
                     : parts.join("/");
    return sub ? `/recordings/${sub}` : "/recordings";
  }

  // Fallback — treat as-is
  return p;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function StorageManagementPage() {
  const [rows, setRows]                 = useState([]);
  const [selected, setSelected]         = useState(null);
  const [loading, setLoading]           = useState(true);
  const [filter, setFilter]             = useState("");

  // folder stores the DISPLAY path (D:\REC\...) shown in the input box
  const [folder, setFolder]             = useState("");
  const [allocated, setAllocated]       = useState(352);
  const [allocWarning, setAllocWarning] = useState("");
  const [addModal, setAddModal]         = useState(false);
  const [newPath, setNewPath]           = useState("");
  const [applyMsg, setApplyMsg]         = useState("");

  // ── Fetch storage info from backend ──────────────────────────────────────
  const fetchStorage = () => {
    setLoading(true);
    fetch(`${BACKEND}/api/storage/management`)
      .then((r) => r.json())
      .then((data) => {
        // Backend returns container_path; we show display_path / location
        const mapped = data.map((row) => ({
          ...row,
          // Prefer the display_path field; fall back to converting location
          display: row.display_path || toDisplayPath(row.container_path || row.location || ""),
        }));
        setRows(mapped);
        if (mapped.length > 0) {
          setSelected(0);
          setFolder(mapped[0].display);
          setAllocated(mapped[0].allocated || 352);
        }
      })
      .catch(() => {
        // Fallback: ask the recorder what path it's currently using
        fetch(`${BACKEND}/api/recordings/status`)
          .then((r) => r.json())
          .then((status) => {
            const containerPath = status.recording_path || "/recordings";
            const display       = status.display_path   || toDisplayPath(containerPath);
            const mock = [{
              location:       display,
              container_path: containerPath,
              display:        display,
              type:           "Local Disk",
              total:          475,
              used:           16,
              free:           459,
              allocated:      459,
              status:         "Recording",
              server:         "MIRADOR",
            }];
            setRows(mock);
            setSelected(0);
            setFolder(mock[0].display);
            setAllocated(mock[0].allocated);
          })
          .catch(() => {
            const mock = [{
              location:       "D:\\REC",
              container_path: "/recordings",
              display:        "D:\\REC",
              type:           "Local Disk",
              total:          475,
              used:           16,
              free:           459,
              allocated:      459,
              status:         "Recording",
              server:         "MIRADOR",
            }];
            setRows(mock);
            setSelected(0);
            setFolder(mock[0].display);
            setAllocated(mock[0].allocated);
          });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchStorage(); }, []);

  const sel = rows[selected] ?? null;

  const filtered = rows.filter((r) =>
    !filter ||
    [r.display, r.location, r.type, r.status, r.server].some((v) =>
      v && String(v).toLowerCase().includes(filter.toLowerCase())
    )
  );

  const usedPct   = sel ? Math.min(Math.round((sel.used / sel.total) * 100), 100) : 0;
  const usedColor = usedPct >= 90 ? "#ef4444" : usedPct >= 70 ? "#f59e0b" : "var(--teal)";

  const handleAllocChange = (newVal) => {
    if (!sel) return;
    if (newVal < sel.used) {
      setAllocWarning(
        `Cannot reduce to ${newVal} GB — disk already has ${sel.used} GB of recordings. ` +
        `Delete older recordings first, then reduce the allocation.`
      );
      return;
    }
    setAllocWarning("");
    setAllocated(newVal);
  };

  const handleRemove = async () => {
    if (sel === null) return;
    if (!window.confirm(`Remove storage location "${sel.display || sel.location}"?`)) return;
    
    try {
      await fetch(`${BACKEND}/api/storage/locations?container_path=${encodeURIComponent(sel.container_path)}`, {
        method: "DELETE"
      });
      fetchStorage();
      setSelected(null);
    } catch (err) {
      console.error("Failed to remove storage location:", err);
    }
  };

  const handleAdd = async () => {
    if (!newPath.trim()) return;
    const containerPath = toContainerPath(newPath.trim());
    const display       = toDisplayPath(containerPath);
    
    try {
      await fetch(`${BACKEND}/api/storage/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_path: display,
          container_path: containerPath,
          allocated: 100
        })
      });
      fetchStorage();
      setAddModal(false);
      setNewPath("");
    } catch (err) {
      console.error("Failed to add storage location:", err);
    }
  };

  // ── Apply: convert display path → container path, send to backend ─────────
  const handleApply = async () => {
    if (allocWarning) return;

    const displayInput  = folder.trim();
    const containerPath = toContainerPath(displayInput);

    if (!containerPath) {
      setApplyMsg("❌ Please enter a valid folder path.");
      setTimeout(() => setApplyMsg(""), 4000);
      return;
    }

    setApplyMsg("Applying...");

    try {
      const res = await fetch(`${BACKEND}/api/storage/apply`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          // Always send the container path — backend validates & persists it
          recording_path: containerPath,
          folder:         containerPath,
          allocated,
        }),
      });

      const json = await res.json();
      if (res.ok) {
        // Use the display_path the backend echoes back, or derive it ourselves
        const newDisplay = json.display_path || toDisplayPath(json.recording_path || containerPath);
        setApplyMsg(`✅ ${json.message || "Recording path updated to: " + newDisplay}`);

        // Update the displayed row
        if (selected !== null) {
          setRows((prev) =>
            prev.map((r, i) =>
              i === selected
                ? {
                    ...r,
                    location:       newDisplay,
                    container_path: json.recording_path || containerPath,
                    display:        newDisplay,
                  }
                : r
            )
          );
          setFolder(newDisplay);
        }
      } else {
        setApplyMsg(`❌ ${json.detail || "Failed to apply settings."}`);
      }
    } catch {
      setApplyMsg("❌ Could not reach backend. Is the server running?");
    }

    setTimeout(() => setApplyMsg(""), 6000);
  };

  return (
    <div className="page-shell">

      <div className="page-header">
        <div>
          <h1 className="page-title">Storage <span>Management</span></h1>
          <p className="page-desc">
            Add and remove local or network storage. Select how much space to use and where to store data.
          </p>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Type to filter" />
      </div>

      <div className="sm-table-wrap card">
        <table className="m-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              {["Location", "Allocated", "Used", "Status", "Server"].map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="m-table__empty">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="m-table__empty">No storage locations configured.</td></tr>
            ) : filtered.map((r, i) => {
              const isSel = selected === i;
              const pct   = r.total ? Math.round((r.used / r.total) * 100) : 0;
              const warn  = pct >= 90;
              return (
                <tr
                  key={i}
                  className={`m-table__row ${isSel ? "m-table__row--selected" : ""}`}
                  onClick={() => {
                    setSelected(i);
                    setFolder(r.display || r.location || "");
                    setAllocated(r.allocated || 352);
                    setAllocWarning("");
                  }}
                >
                  <td>
                    <div className="sm-disk-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <ellipse cx="12" cy="6" rx="8" ry="3"/>
                        <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/>
                        <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>
                      </svg>
                      {warn && <span className="sm-disk-warn">⚠</span>}
                    </div>
                  </td>
                  <td className="m-table__primary sm-location">{r.display || r.location}</td>
                  <td>{r.allocated} GB</td>
                  <td>{r.used} GB</td>
                  <td>
                    <span className={`sm-status ${warn ? "sm-status--warn" : "sm-status--ok"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td>{r.server}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sm-table-actions">
        <button className="sm-btn" disabled={selected === null} onClick={handleRemove}>Remove</button>
        <button className="sm-btn sm-btn--primary" onClick={() => setAddModal(true)}>Add…</button>
      </div>

      {sel && (
        <div className="sm-bottom">

          <div className="sm-overview card">
            <div className="sm-panel-title">Overview</div>

            <div className="sm-legend">
              <span className="sm-legend-dot sm-legend-dot--used" />
              <span>Used: <strong>{sel.used} GB</strong></span>
            </div>
            <div className="sm-legend">
              <span className="sm-legend-dot sm-legend-dot--free" />
              <span>Free: <strong>{sel.free} GB</strong></span>
            </div>
            <div className="sm-legend">
              <span className="sm-legend-dot sm-legend-dot--other" />
              <span>Other data:</span>
            </div>
            <div className="sm-legend">
              <span style={{ width: 12 }} />
              <span>Total capacity: <strong>{sel.total} GB</strong></span>
            </div>

            <div className="sm-usage-label">DISK USAGE</div>
            <div className="sm-usage-track">
              <div className="sm-usage-bar" style={{ width: `${usedPct}%`, background: usedColor }} />
            </div>
            <div className="sm-usage-text">
              {sel.used} GB used of {sel.total} GB ({usedPct}%)
            </div>

            <div className="sm-divider" />

            <div className="sm-field-row">
              <label>Allocated:</label>
            </div>
            <div className="sm-slider-row">
              <input
                type="range"
                min={10}
                max={sel.total || 500}
                value={allocated}
                onChange={(e) => handleAllocChange(Number(e.target.value))}
                className="sm-slider"
              />
              <span className="sm-slider-val">{allocated} GB</span>
            </div>

            {allocWarning && (
              <div className="sm-alloc-warning">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                {allocWarning}
              </div>
            )}

            <div className="sm-divider" />

            <div className="sm-field-row">
              <label>Status:</label>
              <span className={`sm-status ${usedPct >= 90 ? "sm-status--warn" : "sm-status--ok"}`}>
                {sel.status}
              </span>
            </div>

            <div className="sm-field-row">
              <label>Folder for new recordings:</label>
            </div>

            {/*
              The input shows the Windows-friendly path (D:\REC\...) for readability.
              On Apply, toContainerPath() converts it back to /recordings/... before
              sending to the backend. The backend further sanitizes and persists the
              container path, so D:\ paths can never reach ffmpeg.
            */}
            <div className="sm-folder-row">
             <input
  type="text"
  value={folder}
  onChange={(e) => setFolder(e.target.value)}
  placeholder="Enter storage path (e.g., D:\REC or D:\MyFolder)"
  className="sm-input"
/>
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted, #888)", marginTop: 4 }}>
              Type a Windows path like <code>D:\REC\site-A</code> or a container path like{" "}
              <code>/recordings/site-A</code>. Both are accepted — the path is automatically
              converted to the correct format inside the container.
            </div>

            {applyMsg && <div className="sm-apply-msg">{applyMsg}</div>}

            <div className="sm-field-row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
              <button
                className="sm-btn sm-btn--primary"
                disabled={!!allocWarning}
                onClick={handleApply}
              >
                Apply
              </button>
            </div>
          </div>

          

        </div>
      )}

      {addModal && (
        <div className="mgmt-modal-overlay" onClick={() => setAddModal(false)}>
          <div className="mgmt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mgmt-modal__header">
              <span className="mgmt-modal__title">Add Storage Location</span>
              <button className="mgmt-detail__close" onClick={() => setAddModal(false)}>✕</button>
            </div>
            <div className="mgmt-modal__body">
              <div className="mgmt-form">
                <div className="mgmt-form__row">
                  <label>Path</label>
                  <input
                    className="mgmt-input"
                    style={{ flex: 1 }}
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                    placeholder="D:\REC\site-B  or  /recordings/site-B"
                    title="Windows path (D:\REC\site-B) or container path (/recordings/site-B) — both work."
                  />
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted, #888)", marginTop: 4, paddingLeft: 2 }}>
                  Windows path <code>D:\REC\site-B</code> and container path{" "}
                  <code>/recordings/site-B</code> both map to the same location.
                </div>
                <div className="mgmt-form__actions">
                  <button className="sm-btn" onClick={() => setAddModal(false)}>Cancel</button>
                  <button className="sm-btn sm-btn--primary" onClick={handleAdd}>Add</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}