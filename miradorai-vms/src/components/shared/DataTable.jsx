import "./DataTable.css";

export default function DataTable({ columns, rows, selectedId, onSelect, emptyMessage = "No data found.", checkable, checkedIds, onCheckAll, onCheckOne }) {
  const allChecked = checkable && rows.length > 0 && rows.every((r) => checkedIds?.includes(r.id));
  return (
    <div className="m-table-wrap card">
      <table className="m-table">
        <thead>
          <tr>
            {checkable && <th style={{ width: 36 }}><input type="checkbox" className="m-checkbox" checked={allChecked} onChange={onCheckAll} /></th>}
            {columns.map((c) => <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={columns.length + (checkable ? 1 : 0)} className="m-table__empty">{emptyMessage}</td></tr>
            : rows.map((row, i) => {
                const isSel = selectedId === row.id || checkedIds?.includes(row.id);
                return (
                  <tr key={row.id}
                    className={`m-table__row ${isSel ? "m-table__row--selected" : ""}`}
                    onClick={() => onSelect && onSelect(isSel ? null : row.id)}
                  >
                    {checkable && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="m-checkbox" checked={!!checkedIds?.includes(row.id)} onChange={() => onCheckOne(row.id)} /></td>}
                    {row.cells.map((cell, ci) => <td key={ci} className={ci === 0 ? "m-table__primary" : ""}>{cell}</td>)}
                  </tr>
                );
              })
          }
        </tbody>
      </table>
    </div>
  );
}
