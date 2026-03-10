import { useState } from "react";
import DataTable from "../../components/shared/DataTable";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";

export default function ExternalDataPage() {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(null);
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">External <span>Data Sources</span></h1>
          <p className="page-desc">Connect external metadata overlays — POS systems, access control, sensor feeds.</p>
        </div>
        <SearchBar value={filter} onChange={setFilter} />
      </div>
      <DataTable columns={["Name", "Source Key", "View", "Server"]} rows={[]} selectedId={selected} onSelect={setSelected} emptyMessage="No external data sources configured." />
      <div className="page-footer"><span /><div className="page-footer-right"><Button label="Edit" disabled={!selected} /></div></div>
    </div>
  );
}
