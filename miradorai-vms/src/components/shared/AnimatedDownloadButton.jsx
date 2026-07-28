import React from 'react';
import SpecularButton from './SpecularButton';
import './AnimatedDownloadButton.css';

export default function AnimatedDownloadButton({ 
  onClick, 
  disabled, 
  tooltip = "Size: 20Mb", 
  text = "Download", 
  style, 
  className = "",
  type = "button",
  // Default specular props (match Generate Report)
  radius = 8,
  tint = "#10b981",
  tintOpacity = 0.10,
  blur = 4,
  textColor = "#f0fff8",
  lineColor = "#10b981",
  baseColor = "#0d3326"
}) {
  return (
    <SpecularButton 
      type={type}
      className={`animated-download-btn ${className}`} 
      data-tooltip={tooltip} 
      onClick={onClick} 
      disabled={disabled}
      style={style}
      // Specular specifics
      size="md"
      radius={radius}
      tint={tint}
      tintOpacity={tintOpacity}
      blur={blur}
      textColor={textColor}
      lineColor={lineColor}
      baseColor={baseColor}
      intensity={1.2}
      shineSize={12}
      shineFade={38}
      thickness={1}
      speed={0.35}
      followMouse={true}
      proximity={220}
      autoAnimate={false}
    >
      <div className="animated-download-btn-wrapper">
        <div className="animated-download-btn-text">{text}</div>
        <span className="animated-download-btn-icon">
          <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img" width="2em" height="2em" preserveAspectRatio="xMidYMid meet" viewBox="0 0 24 24">
            <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 0 0 4.561 21h14.878a2 2 0 0 0 1.94-1.515L22 17"></path>
          </svg>
        </span>
      </div>
    </SpecularButton>
  );
}
