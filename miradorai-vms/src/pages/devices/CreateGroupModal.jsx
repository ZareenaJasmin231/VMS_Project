import { useState } from "react";

export default function CreateGroupModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [alertMsg, setAlertMsg] = useState("");

  const handleCreate = () => {
    if (!name.trim()) {
      setAlertMsg("Group Name is a mandatory field. Please enter a group name!");
      return;
    }
    onCreate(name.trim());
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        
        <div className="modal-header">
          <h2 className="modal-title">Create Group</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {alertMsg && (
            <div className="modal-ui-alert">
              <svg className="modal-ui-alert-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div className="modal-ui-alert-text">{alertMsg}</div>
              <button className="modal-ui-alert-close" onClick={() => setAlertMsg("")}>✕</button>
            </div>
          )}

          <div className="modal-field">
            <label className="modal-label">Group Name <span style={{ color: "#f87171", marginLeft: "2px" }}>*</span></label>
            <input
              className="modal-input"
              placeholder="e.g. Warehouse"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setAlertMsg("");
              }}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="modal-btn modal-btn--cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="modal-btn modal-btn--save" onClick={handleCreate}>
            Create
          </button>
        </div>

      </div>
    </div>
  );
}