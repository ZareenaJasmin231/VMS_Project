// StorageManagementPage
import DataTable from "../../components/shared/DataTable";
export default function StorageManagementPage() {
  return (
    <div className="page-shell">
      <div className="page-header"><div><h1 className="page-title">Storage <span>Management</span></h1><p className="page-desc">Monitor disk usage and manage recording storage locations.</p></div></div>
      <DataTable columns={["Location", "Type", "Total", "Used", "Free", "Status"]} rows={[]} selectedId={null} onSelect={null} emptyMessage="No storage locations configured." />
    </div>
  );
}
