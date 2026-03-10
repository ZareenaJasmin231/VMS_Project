import "./Toggle.css";
export default function Toggle({ value, onChange, disabled }) {
  return (
    <div className={`m-toggle ${value ? "m-toggle--on" : ""} ${disabled ? "m-toggle--disabled" : ""}`} onClick={() => !disabled && onChange(!value)}>
      <div className="m-toggle__thumb" />
    </div>
  );
}
