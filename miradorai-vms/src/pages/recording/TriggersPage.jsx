import DataTable from "../../components/shared/DataTable";
export default function TriggersPage() {
  return (
    <div className="page-shell">
      <div className="page-header"><div><h1 className="page-title">Event <span>Triggers</span></h1><p className="page-desc">Define conditions and trigger sources for your automated event rules.</p></div></div>
      <DataTable columns={["Trigger Name", "Type", "Device", "Condition", "Priority", "Server"]} rows={[]} selectedId={null} onSelect={null} emptyMessage="No triggers defined." />
    </div>
  );
}
