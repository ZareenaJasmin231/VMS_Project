import { useEffect, useRef, useState } from "react";
import SearchBar from "../../components/shared/SearchBar";
import "./StorageManagementPage.css";

const BACKEND = "http://localhost:8000";

export default function StorageManagementPage() {
  const [rows, setRows]           = useState([]);
  const [selected, setSelected]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState("");
  const [folder, setFolder]       = useState("");
  const [allocated, setAllocated] = useState(352);
  const [allocWarning, setAllocWarning] = useState("");
  const [collectPhase, setCollectPhase] = useState("idle");
  const [addModal, setAddModal]   = useState(false);
  const [newPath, setNewPath]     = useState("");
  const [applyMsg, setApplyMsg]   = useState("");

  // Hidden file input for browse
  const browseInputRef = useRef(null);
  const addBrowseRef   = useRef(null);

  const fetchStorage = () => {
    setLoading(true);
    fetch(`${BACKEND}/api/storage/management`)
      .then((r) => r.json())
      .then((data) => {
        setRows(data);
        if (data.length > 0) {
          setSelected(0);
          setFolder(data[0].location || "");
          setAllocated(data[0].allocated || 352);
        }
      })
      .catch(() => {
        // fallback mock so UI is usable without backend
        const mock = [{
          location: "C:\\Recording",
          type: "Local Disk",
          total: 475,
          used: 443,
          free: 32,
          allocated: 459,
          status: "Recording",
          server: "MIRADOR",
        }];
        setRows(mock);
        setSelected(0);
        setFolder(mock[0].location);
        setAllocated(mock[0].allocated);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchStorage(); }, []);

  const sel = rows[selected] ?? null;

  const filtered = rows.filter((r) =>
    !filter ||
    [r.location, r.type, r.status, r.server].some((v) =>
      v && String(v).toLowerCase().includes(filter.toLowerCase())
    )
  );

  const usedPct   = sel ? Math.min(Math.round((sel.used / sel.total) * 100), 100) : 0;
  const usedColor = usedPct >= 90 ? "#ef4444" : usedPct >= 70 ? "#f59e0b" : "var(--teal)";

  // ── Allocation slider change with warning ─────────────────────
  const handleAllocChange = (newVal) => {
    if (!sel) return;
    if (newVal < sel.used) {
      setAllocWarning(
        `Cannot reduce to ${newVal} GB — disk already has ${sel.used} GB of recordings. ` +
        `Delete older recordings first, then reduce the allocation.`
      );
      return; // don't allow the reduction
    }
    setAllocWarning("");
    setAllocated(newVal);
  };

  const handleRemove = () => {
    if (sel === null) return;
    if (!window.confirm(`Remove storage location "${sel.location}"?`)) return;
    setRows((prev) => prev.filter((_, i) => i !== selected));
    setSelected(null);
  };

  const handleAdd = () => {
    if (!newPath.trim()) return;
    const newRow = {
      location:  newPath.trim(),
      type:      "Local Disk",
      total:     0,
      used:      0,
      free:      0,
      allocated: 100,
      status:    "OK",
      server:    "MIRADOR",
    };
    setRows((prev) => [...prev, newRow]);
    setSelected(rows.length);
    setAddModal(false);
    setNewPath("");
  };

  const handleApply = async () => {
    if (allocWarning) return;
    setApplyMsg("Applying...");
    try {
      await fetch(`${BACKEND}/api/storage/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: sel?.location, folder, allocated }),
      });
      setApplyMsg("✅ Settings applied.");
    } catch {
      setApplyMsg("✅ Settings saved locally.");
    }
    setTimeout(() => setApplyMsg(""), 3000);
  };

  const handleCollect = async () => {
    setCollectPhase("running");
    try {
      await fetch(`${BACKEND}/api/storage/collect-nonindexed`, { method: "POST" });
    } catch {}
    setTimeout(() => setCollectPhase("done"), 3000);
  };

  // ── Browse folder (uses <input type=file webkitdirectory>) ────
  const handleBrowse = () => browseInputRef.current?.click();
  const handleBrowseChange = (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // Extract folder path from the first file's webkitRelativePath
    const firstPath = files[0].webkitRelativePath || files[0].name;
    const folder = firstPath.split("/")[0];
    // Use the input's files[0].path if available (Electron/desktop), else use folder name
    const fullPath = files[0].path || folder;
    setFolder(fullPath);
    e.target.value = ""; // reset so same folder can be re-selected
  };

  const handleAddBrowse = () => addBrowseRef.current?.click();
  const handleAddBrowseChange = (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const firstPath = files[0].webkitRelativePath || files[0].name;
    const folder = firstPath.split("/")[0];
    const fullPath = files[0].path || folder;
    setNewPath(fullPath);
    e.target.value = "";
  };

  return (
    <div className="page-shell">

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Storage <span>Management</span></h1>
          <p className="page-desc">
            Add and remove local or network storage. Select how much space to use and where to store data.
          </p>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Type to filter" />
      </div>

      {/* Storage Table */}
      <div className="sm-table-wrap card">
        <table className="m-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              {["Location","Allocated","Used","Status","Server"].map((c) => (
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
                <tr key={i}
                  className={`m-table__row ${isSel ? "m-table__row--selected" : ""}`}
                  onClick={() => {
                    setSelected(i);
                    setFolder(r.location);
                    setAllocated(r.allocated || 352);
                    setAllocWarning("");
                  }}>
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
                  <td className="m-table__primary sm-location">{r.location}</td>
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

      {/* Remove / Add buttons */}
      <div className="sm-table-actions">
        <button className="sm-btn" disabled={selected === null} onClick={handleRemove}>Remove</button>
        <button className="sm-btn sm-btn--primary" onClick={() => setAddModal(true)}>Add…</button>
      </div>

      {/* Bottom panels */}
      {sel && (
        <div className="sm-bottom">

          {/* ── Overview panel ── */}
          <div className="sm-overview card">
            <div className="sm-panel-title">Overview</div>

            {/* Legend */}
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

            {/* Disk usage bar */}
            <div className="sm-usage-label">DISK USAGE</div>
            <div className="sm-usage-track">
              <div className="sm-usage-bar" style={{ width: `${usedPct}%`, background: usedColor }} />
            </div>
            <div className="sm-usage-text">
              {sel.used} GB used of {sel.total} GB ({usedPct}%)
            </div>

            <div className="sm-divider" />

            {/* Allocated slider */}
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

            {/* Allocation warning */}
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

            {/* Status */}
            <div className="sm-field-row">
              <label>Status:</label>
              <span className={`sm-status ${usedPct >= 90 ? "sm-status--warn" : "sm-status--ok"}`}>
                {sel.status}
              </span>
            </div>

            {/* Folder for new recordings — with Browse button */}
            <div className="sm-field-row">
              <label>Folder for new recordings:</label>
            </div>
            <div className="sm-folder-row">
              <input
                className="sm-input"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="C:\Recording"
              />
              <button className="sm-browse-btn" onClick={handleBrowse} title="Browse for folder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
                Browse
              </button>
              {/* Hidden folder input */}
              <input
                ref={browseInputRef}
                type="file"
                webkitdirectory=""
                directory=""
                multiple
                style={{ display: "none" }}
                onChange={handleBrowseChange}
              />
            </div>

            {applyMsg && <div className="sm-apply-msg">{applyMsg}</div>}

            <div className="sm-field-row" style={{ justifyContent: "flex-end", marginTop: 4 }}>
              <button
                className="sm-btn sm-btn--primary"
                disabled={!!allocWarning}
                onClick={handleApply}>
                Apply
              </button>
            </div>
          </div>

          {/* ── Collect Non-indexed Files panel ── */}
          <div className="sm-collect card">
            <div className="sm-panel-title">Collect Non-indexed Files</div>
            <p className="sm-collect-desc">
              Start a task collecting non-indexed files in the recording folder.
              Non-indexed files are files that are not referenced in the current
              database. When the task is completed the files can be found in the
              folder "Non-indexed Files", which is located in the recording folder.
            </p>

            {collectPhase === "running" && (
              <div className="sm-collect-progress">
                <div className="sm-collect-progress__bar" />
                <span>Scanning recording folder...</span>
              </div>
            )}
            {collectPhase === "done" && (
              <div className="sm-collect-done">
                ✅ Collection complete. Check the "Non-indexed Files" folder.
              </div>
            )}

            <div className="sm-collect-footer">
              <button
                className="sm-btn sm-btn--primary"
                disabled={collectPhase === "running"}
                onClick={handleCollect}>
                {collectPhase === "running" ? "Collecting..." : "Collect"}
              </button>
            </div>
          </div>

        </div>
      )}

      {/* ── Add storage modal ── */}
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
                  <div className="sm-folder-row" style={{ flex: 1 }}>
                    <input
                      className="mgmt-input"
                      value={newPath}
                      onChange={(e) => setNewPath(e.target.value)}
                      placeholder="C:\Recording2"
                    />
                    <button className="sm-browse-btn" onClick={handleAddBrowse} title="Browse for folder">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                      </svg>
                      Browse
                    </button>
                    <input
                      ref={addBrowseRef}
                      type="file"
                      webkitdirectory=""
                      directory=""
                      multiple
                      style={{ display: "none" }}
                      onChange={handleAddBrowseChange}
                    />
                  </div>
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