import "./Button.css";
import SpecularButton from "./SpecularButton";
import { useTheme } from "../../context/ThemeContext";

export default function Button({ label, onClick, disabled, variant = "default", icon, type = "button", className = "" }) {
  const { theme } = useTheme();
  const isLight = theme === "light" || (theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);

  if (variant === "primary") {
    return (
      <SpecularButton
        size="sm"
        radius={6}
        tint="#10b981"
        tintOpacity={isLight ? 0.9 : 0.10}
        blur={4}
        textColor={isLight ? "#ffffff" : "#f0fff8"}
        lineColor={isLight ? "#6ee7b7" : "#10b981"}
        baseColor={isLight ? "#059669" : "#0d3326"}
        intensity={1.2}
        shineSize={12}
        shineFade={38}
        thickness={1}
        speed={0.35}
        followMouse
        proximity={200}
        autoAnimate={false}
        disabled={disabled}
        onClick={onClick}
        type={type}
        className={className}
      >
        {icon && <span className="m-btn__icon" dangerouslySetInnerHTML={{ __html: icon }} />}
        {label}
      </SpecularButton>
    );
  }

  return (
    <button
      type={type}
      className={`m-btn m-btn--${variant} ${disabled ? "m-btn--disabled" : ""} ${className}`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <span className="m-btn__icon" dangerouslySetInnerHTML={{ __html: icon }} />}
      {label}
    </button>
  );
}
