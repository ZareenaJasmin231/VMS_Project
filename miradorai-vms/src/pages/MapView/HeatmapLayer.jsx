import { useEffect, useRef } from "react";
import "./HeatmapLayer.css";
import { drawHeatmapToContext } from "./HeatmapLogic";

/**
 * HeatmapLayer — works identically for both MapView and DesignerView.
 * No special props needed. Both views now use the same cone origin formula.
 */
export default function HeatmapLayer({
  markers,
  cameras,
  scaleRef,
  offsetRef,
  wrapRef,
  showHeatmap,
  floorImgRef,
  activeZone,
  zones = [],
}) {
  const densityRef = useRef(null);

  useEffect(() => {
    const canvas = densityRef.current;
    if (!canvas) return;
    const wrap = wrapRef.current;
    if (!wrap) return;

    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    canvas.width  = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");

    if (!showHeatmap || markers.length === 0) {
      ctx.clearRect(0, 0, W, H);
      return;
    }

    drawHeatmapToContext(ctx, W, H, {
      markers,
      cameras,
      scale:     scaleRef.current,
      offset:    offsetRef.current,
      activeZone,
      allZones:  zones,
      floorImg:  floorImgRef.current,
      step:      3,
    });
  }, [showHeatmap, markers, cameras, scaleRef, offsetRef, wrapRef,
      floorImgRef, activeZone, zones]);

  return (
    <>
      <canvas
        ref={densityRef}
        className="mv-heatmap-density-canvas"
        style={{ display: showHeatmap ? "block" : "none" }}
      />

      {showHeatmap && (
        <div className="mv-heatmap-legend">
          <div className="mv-heatmap-legend__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            Coverage Heatmap
            {activeZone && (
              <span style={{ marginLeft: 6, fontSize: 9, color: "#f59e0b", fontWeight: 400 }}>
                · zone only
              </span>
            )}
          </div>
          <div className="mv-heatmap-legend__row">
            <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--none" />
            <span>Blind spot (No coverage)</span>
          </div>
          <div className="mv-heatmap-legend__row">
            <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--single" />
            <span>Single camera coverage</span>
          </div>
          <div className="mv-heatmap-legend__row">
            <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--overlap" />
            <span>2-camera overlap</span>
          </div>
          <div className="mv-heatmap-legend__row">
            <span className="mv-heatmap-legend__swatch mv-heatmap-legend__swatch--high" />
            <span>High density (3+ cameras)</span>
          </div>
        </div>
      )}
    </>
  );
}