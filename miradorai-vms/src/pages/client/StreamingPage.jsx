import { useState } from "react";
import Toggle from "../../components/shared/Toggle";
import Button from "../../components/shared/Button";
import "./StreamingPage.css";

const HW_MODES    = ["On", "Off", "Auto"];
const GPU_OPTIONS = ["NVIDIA T400 4GB", "Intel UHD Graphics", "AMD Radeon RX 580", "Software only"];

function Section({ title, children }) {
  return (
    <div className="st-section">
      <div className="st-section__title">{title}</div>
      <div className="st-section__body">{children}</div>
    </div>
  );
}

function SettingRow({ label, children }) {
  return (
    <div className="st-row">
      <span className="st-row__label">{label}</span>
      <div className="st-row__control">{children}</div>
    </div>
  );
}

function Spinner({ value, onChange, min = 0, max = 999 }) {
  return (
    <div className="st-spinner">
      <input
        type="number"
        className="st-spinner__input"
        value={value}
        min={min} max={max}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
      />
      <div className="st-spinner__btns">
        <button className="st-spinner__btn" onClick={() => onChange(Math.min(max, value + 1))}>▲</button>
        <button className="st-spinner__btn" onClick={() => onChange(Math.max(min, value - 1))}>▼</button>
      </div>
    </div>
  );
}

export default function StreamingPage() {
  // Video scaling
  const [videoScale,      setVideoScale]      = useState("best-fit");

  // Hardware decoding
  const [hwMode,          setHwMode]          = useState("On");
  const [gpu,             setGpu]             = useState("NVIDIA T400 4GB");

  // Bandwidth usage
  const [useLowProfile,   setUseLowProfile]   = useState(false);
  const [suspendInactive, setSuspendInactive] = useState(true);

  // PTZ
  const [ptzFirstClick,   setPtzFirstClick]   = useState(false);

  // Audio
  const [pttDelay,        setPttDelay]        = useState(100);
  const [pttAllDuplex,    setPttAllDuplex]    = useState(false);
  const [alwaysAudio,     setAlwaysAudio]     = useState(false);

  // Instant replay
  const [replayDuration,  setReplayDuration]  = useState(5);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Stream<span>ing</span></h1>
          <p className="page-desc">
            Configure video, audio and bandwidth settings for this client.
          </p>
        </div>
      </div>

      <div className="st-body">

        {/* ── Video scaling ── */}
        <Section title="Video scaling">
          <label className="st-radio">
            <input type="radio" name="video-scale"
              checked={videoScale === "best-fit"}
              onChange={() => setVideoScale("best-fit")} />
            <span>Scale to best fit</span>
          </label>
          <label className="st-radio">
            <input type="radio" name="video-scale"
              checked={videoScale === "fill"}
              onChange={() => setVideoScale("fill")} />
            <span>Fill video area (may crop parts of the video)</span>
          </label>
        </Section>

        {/* ── Hardware decoding ── */}
        <Section title="Hardware decoding">
          <div className="st-row st-row--inline">
            <span className="st-row__label">Mode:</span>
            <select className="st-select" value={hwMode}
              onChange={(e) => setHwMode(e.target.value)}>
              {HW_MODES.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="st-row st-row--inline">
            <span className="st-row__label">Graphics card:</span>
            <select className="st-select" value={gpu}
              onChange={(e) => setGpu(e.target.value)}>
              {GPU_OPTIONS.map((g) => <option key={g}>{g}</option>)}
            </select>
          </div>
        </Section>

        {/* ── Bandwidth usage ── */}
        <Section title="Bandwidth usage">
          <SettingRow label="Always use the stream profile Low on this client">
            <Toggle value={useLowProfile} onChange={setUseLowProfile} />
          </SettingRow>
          <SettingRow label="Suspend video streams for inactive tabs">
            <Toggle value={suspendInactive} onChange={setSuspendInactive} />
          </SettingRow>
        </Section>

        {/* ── PTZ ── */}
        <Section title="PTZ (Pan, Tilt, Zoom)">
          <SettingRow label="Select view with first click instead of starting PTZ">
            <Toggle value={ptzFirstClick} onChange={setPtzFirstClick} />
          </SettingRow>
        </Section>

        {/* ── Audio ── */}
        <Section title="Audio">
          <div className="st-row st-row--inline">
            <span className="st-row__label">Push-to-talk release delay (ms):</span>
            <span className="st-slider-val">{pttDelay}</span>
            <input type="range" min={0} max={500} value={pttDelay}
              onChange={(e) => setPttDelay(Number(e.target.value))}
              className="st-slider" />
          </div>
          <SettingRow label="Use push-to-talk for all duplex modes">
            <Toggle value={pttAllDuplex} onChange={setPttAllDuplex} />
          </SettingRow>
          <SettingRow label="Always allow audio for intercoms">
            <Toggle value={alwaysAudio} onChange={setAlwaysAudio} />
          </SettingRow>
        </Section>

        {/* ── Instant replay ── */}
        <Section title="Instant replay">
          <div className="st-row st-row--inline">
            <span className="st-row__label">Playback duration (s):</span>
            <Spinner value={replayDuration} onChange={setReplayDuration} min={1} max={300} />
          </div>
        </Section>

      </div>

      {/* Footer */}
      <div className="page-footer">
        <span />
        <div className="page-footer-right">
          <Button label="Apply" variant="primary" onClick={() => {}} />
        </div>
      </div>
    </div>
  );
}