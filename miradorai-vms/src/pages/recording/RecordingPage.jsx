import DataTable from "../../components/shared/DataTable";
export default function RecordingPage() {
  return (
    <div className="page-shell">
      <div className="page-header"><div><h1 className="page-title">Recording <span>Schedules</span></h1><p className="page-desc">Configure continuous and scheduled recording for each enrolled camera.</p></div></div>
      <DataTable columns={["Camera", "Schedule", "Type", "Quality Profile", "Server"]} rows={[]} selectedId={null} onSelect={null} emptyMessage="No recording schedules configured." />
    </div>
  );
}
