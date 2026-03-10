import { useState } from "react";
import { MOCK_CAMERAS } from "../../data/mockData";
import CameraThumb from "../../components/shared/CameraThumb";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";
import StatusBadge from "../../components/shared/StatusBadge";
import Modal from "../../components/shared/Modal";
import "./CamerasPage.css";

export default function CamerasPage() {
  const [cameras, setCameras] = useState(MOCK_CAMERAS);
  const [filter, setFilter]   = useState("");
  const [selected, setSelected] = useState(null);
  const [editModal, setEditModal]     = useState(null);
  const [removeModal, setRemoveModal] = useState(null);
  const [editForm, setEditForm]       = useState({});

  const filtered = cameras.filter((c) =>
    [c.name, c.address, c.mac, c.model].some((v) => v.toLowerCase().includes(filter.toLowerCase()))
  );

  const openEdit = (c) => { setEditForm({ name: c.name, address: c.address }); setEditModal(c); };
  const saveEdit = () => {
    setCameras((cs) => cs.map((c) => c.id === editModal.id ? { ...c, ...editForm } : c));
    setEditModal(null);
  };
  const confirmRemove = () => {
    setCameras((cs) => cs.filter((c) => c.id !== removeModal.id));
    setSelected(null); setRemoveModal(null);
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title"><span>Camera</span> Registry</h1>
          <p className="page-desc">Manage camera profiles, addresses and channel assignments across your infrastructure.</p>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Search cameras..." />
      </div>

      <div className="cameras-grid">
        {filtered.map((c) => {
          const isSel = selected === c.id;
          return (
            <div key={c.id} className={`cam-card card ${isSel ? "cam-card--selected" : ""}`}
              onClick={() => setSelected(isSel ? null : c.id)}
              onDoubleClick={() => openEdit(c)}>
              <div className="cam-card__thumb"><CameraThumb type={c.type} width={64} height={46} /></div>
              <div className="cam-card__info">
                <div className="cam-card__name">{c.name}</div>
                <code className="cam-card__addr">{c.address}</code>
              </div>
              <div className="cam-card__meta">
                <span className="cam-card__model">{c.model}</span>
                <StatusBadge status="Online" />
              </div>
              {isSel && <div className="cam-card__selected-bar" />}
            </div>
          );
        })}
        {filtered.length === 0 && <div className="cameras-empty card">No cameras match your filter.</div>}
      </div>

      <div className="page-footer">
        <span className="cameras-count">{filtered.length} camera{filtered.length !== 1 ? "s" : ""}</span>
        <div className="page-footer-right">
          <Button label="Edit" disabled={!selected} onClick={() => openEdit(cameras.find((c) => c.id === selected))} />
          <Button label="Remove" variant="danger" disabled={!selected} onClick={() => setRemoveModal(cameras.find((c) => c.id === selected))} />
        </div>
      </div>

      {editModal && (
        <Modal title={`Edit — ${editModal.name}`} onClose={() => setEditModal(null)} onConfirm={saveEdit} confirmLabel="Save">
          <div className="m-field"><label>Display Name</label><input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} /></div>
          <div className="m-field"><label>IP Address</label><input value={editForm.address} onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))} /></div>
          {[["MAC", editModal.mac], ["Model", editModal.model], ["Channel", editModal.channel], ["Server", editModal.server]].map(([k, v]) => (
            <div key={k} className="m-info-row"><span className="m-info-key">{k}</span><span className="m-info-val">{v}</span></div>
          ))}
        </Modal>
      )}
      {removeModal && (
        <Modal title="Remove Camera" onClose={() => setRemoveModal(null)} onConfirm={confirmRemove} confirmLabel="Remove" confirmVariant="danger">
          <p className="m-confirm-text">Remove <strong style={{ color: "var(--text-primary)" }}>{removeModal.name}</strong> from MIRADORAI VMS?</p>
          <p className="m-confirm-warn">This will delete all associated recordings and configurations.</p>
        </Modal>
      )}
    </div>
  );
}
