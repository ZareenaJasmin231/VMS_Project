import "./StatusBadge.css";
const MAP = { Online: "green", Offline: "red", Warning: "yellow", Running: "green", Stopped: "red" };
export default function StatusBadge({ status }) {
  const color = MAP[status] || "gray";
  return <span className={`m-badge m-badge--${color}`}><span className="m-badge__dot" />{status}</span>;
}
