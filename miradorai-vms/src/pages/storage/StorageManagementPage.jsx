import { useEffect, useState } from "react";
import DataTable from "../../components/shared/DataTable";

export default function StorageManagementPage() {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("http://localhost:8000/api/storage/management")
      .then(r => r.json())
      .then(data => {
        setRows(data.map((s, i) => ({
          id: i,
          cells: [
            s.location,
            s.type,
            `${s.total} GB`,
            `${s.used} GB`,
            `${s.free} GB`,
            s.status,
          ],
          raw: s,
        })));
      })
      .finally(() => setLoading(false));
  }, []);

  const sel = rows.find(r => r.id === selected)?.raw;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Storage <span>Management</span></h1>
          <p className="page-desc">Monitor disk usage and manage recording storage locations.</p>
        </div>
      </div>

      <DataTable
        columns={["Location", "Type", "Total", "Used", "Free", "Status"]}
        rows={rows}
        selectedId={selected}
        onSelect={setSelected}
        emptyMessage={loading ? "Loading..." : "No storage locations configured."}
      />

      {sel && (
        <div className="ss-panel card" style={{ marginTop: 16 }}>
          <div className="ss-panel__title">Storage Overview — {sel.location}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>DISK USAGE</div>
              <div style={{ background: "var(--bg-base)", borderRadius: 4, height: 8, overflow: "hidden" }}>
                <div style={{
                  width: `${Math.min((sel.used / sel.total) * 100, 100)}%`,
                  height: "100%",
                  background: "var(--teal)"
                }} />
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {sel.used} GB used of {sel.total} GB ({Math.round((sel.used / sel.total) * 100)}%)
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              <div>Allocated: <strong>{sel.allocated} GB</strong></div>
              <div>Server: <strong>{sel.server}</strong></div>
              <div>Status: <strong>{sel.status}</strong></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}