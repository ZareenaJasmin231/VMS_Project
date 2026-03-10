import { useState } from "react";
import DataTable from "../../components/shared/DataTable";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";

export default function OtherDevicesPage() {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(null);
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Other <span>Devices</span></h1>
          <p className="page-desc">Manage network speakers, door controllers, I/O modules and auxiliary devices.</p>
        </div>
        <SearchBar value={filter} onChange={setFilter} />
      </div>
      <DataTable columns={["Name", "Address", "MAC Address", "Model", "Server"]} rows={[]} selectedId={selected} onSelect={setSelected} emptyMessage="No auxiliary devices enrolled." />
      <div className="page-footer">
        <span />
        <div className="page-footer-right">
          <Button label="Edit" disabled={!selected} />
          <Button label="Remove" variant="danger" disabled={!selected} />
        </div>
      </div>
    </div>
  );
}
