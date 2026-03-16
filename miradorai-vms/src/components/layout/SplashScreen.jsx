import { useEffect, useState } from "react";
import logoImg from "../../assets/logo.jpg";
import "./SplashScreen.css";

const NAME = "MIRADOR VMS";

export default function SplashScreen({ onDone }) {
  const [phase, setPhase] = useState("idle"); // idle → logo → text → line → exit

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("logo"),  100);
    const t2 = setTimeout(() => setPhase("text"),  900);
    const t3 = setTimeout(() => setPhase("line"),  1800);
    const t4 = setTimeout(() => setPhase("exit"),  3000);
    const t5 = setTimeout(() => onDone(),          3900);
    return () => [t1,t2,t3,t4,t5].forEach(clearTimeout);
  }, [onDone]);

  return (
    <div className={`splash ${phase === "exit" ? "splash--exit" : ""}`}>

      {/* Ambient glow blobs */}
      <div className="splash__blob splash__blob--1" />
      <div className="splash__blob splash__blob--2" />

      <div className="splash__center">

        {/* Logo */}
        <div className={`splash__logo-wrap ${phase !== "idle" ? "splash__logo-wrap--in" : ""}`}>
          <img src={logoImg} alt="MIRADOR " className="splash__logo" />
          {/* Shimmer scan line */}
          <div className={`splash__shimmer ${phase !== "idle" ? "splash__shimmer--run" : ""}`} />
        </div>

        {/* Letter by letter name */}
        <div className="splash__name">
          {NAME.split("").map((ch, i) => (
            <span
              key={i}
              className={`splash__letter ${phase === "text" || phase === "line" || phase === "exit" ? "splash__letter--in" : ""}`}
              style={{ transitionDelay: `${i * 0.07}s` }}
            >
              {ch}
            </span>
          ))}
        </div>

        {/* Sub text */}
        <div className={`splash__sub ${phase === "text" || phase === "line" || phase === "exit" ? "splash__sub--in" : ""}`}>
          VIDEO MANAGEMENT SYSTEM
        </div>

        {/* Line draw */}
        <div className="splash__line-wrap">
          <div className={`splash__line ${phase === "line" || phase === "exit" ? "splash__line--in" : ""}`} />
        </div>

      </div>
    </div>
  );
}