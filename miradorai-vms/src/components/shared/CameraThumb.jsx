const PALETTES = {
  panoramic: ["#0d3348", "#00c8a0"],
  entrance:  ["#1a2d0d", "#6ec04a"],
  ptz:       ["#2d1a0d", "#e8903a"],
  zoom:      ["#0d1a2d", "#4d9fff"],
};
export default function CameraThumb({ type, width = 52, height = 38 }) {
  const [bg, accent] = PALETTES[type] || ["#1a1e28", "#8892a4"];
  const id = `ct-${type}`;
  return (
    <svg width={width} height={height} viewBox="0 0 52 38" style={{ borderRadius: 6, display: "block", flexShrink: 0 }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={bg} />
          <stop offset="100%" stopColor={accent} stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <rect width={52} height={38} fill={`url(#${id})`} />
      <rect width={52} height={38} fill="none" stroke={accent} strokeWidth="0.8" strokeOpacity="0.4" rx="0" />
      <circle cx={26} cy={19} r={9} fill="none" stroke={accent} strokeWidth="1.2" strokeOpacity="0.6" />
      <circle cx={26} cy={19} r={4} fill={accent} fillOpacity="0.5" />
      <circle cx={26} cy={19} r={1.5} fill={accent} />
    </svg>
  );
}
