import "./Modal.css";
import Button from "./Button";

export default function Modal({ title, onClose, onConfirm, confirmLabel = "OK", confirmVariant = "primary", children, width = 420 }) {
  return (
    <div className="m-modal-overlay" onClick={onClose}>
      <div className="m-modal card" style={{ width }} onClick={(e) => e.stopPropagation()}>
        <div className="m-modal__header">
          <span className="m-modal__title">{title}</span>
          <button className="m-modal__close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="m-modal__body">{children}</div>
        <div className="m-modal__footer">
          <Button label="Cancel" onClick={onClose} />
          <Button label={confirmLabel} variant={confirmVariant} onClick={onConfirm} />
        </div>
      </div>
    </div>
  );
}
