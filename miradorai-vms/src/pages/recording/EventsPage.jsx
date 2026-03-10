import DataTable from "../../components/shared/DataTable";
export default function EventsPage() {
  return (
    <div className="page-shell">
      <div className="page-header"><div><h1 className="page-title">Event <span>Rules</span></h1><p className="page-desc">Define intelligent event rules that trigger actions based on camera analytics and sensor data.</p></div></div>
      <DataTable columns={["Rule Name", "Trigger", "Action", "Active", "Last Fired", "Server"]} rows={[]} selectedId={null} onSelect={null} emptyMessage="No event rules configured." />
    </div>
  );
}
