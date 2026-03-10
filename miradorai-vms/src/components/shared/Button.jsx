import "./Button.css";
export default function Button({ label, onClick, disabled, variant = "default", icon }) {
  return (
    <button className={`m-btn m-btn--${variant} ${disabled ? "m-btn--disabled" : ""}`} disabled={disabled} onClick={onClick}>
      {icon && <span className="m-btn__icon" dangerouslySetInnerHTML={{ __html: icon }} />}
      {label}
    </button>
  );
}
