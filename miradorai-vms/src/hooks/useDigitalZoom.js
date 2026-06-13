import { useState, useRef, useEffect } from "react";

/**
 * React hook for digital zoom and panning on video elements.
 * @param {React.RefObject} containerRef Bounding container ref
 * @param {React.RefObject} videoRef Video element ref
 * @param {Object} options Configuration options
 */
export function useDigitalZoom(containerRef, videoRef, options = {}) {
  const { maxZoom = 8, minZoom = 1 } = options;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  // Ref to hold current state values for non-passive event listeners
  const stateRef = useRef({ zoom, pan });
  useEffect(() => {
    stateRef.current = { zoom, pan };
  }, [zoom, pan]);

  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const zoomIntensity = 0.12;
    const delta = e.deltaY < 0 ? 1 : -1;
    
    const currentZoom = stateRef.current.zoom;
    const currentPan = stateRef.current.pan;
    
    const nextZoom = Math.max(minZoom, Math.min(maxZoom, currentZoom + delta * zoomIntensity * currentZoom));

    if (containerRef.current && nextZoom > 1) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // Adjust pan to zoom centered on cursor location
      const ratio = nextZoom / currentZoom;
      const nextPanX = (currentPan.x - (mouseX - centerX)) * ratio + (mouseX - centerX);
      const nextPanY = (currentPan.y - (mouseY - centerY)) * ratio + (mouseY - centerY);

      // Boundary check for next pan coordinates
      const limitX = (rect.width * (nextZoom - 1)) / 2;
      const limitY = (rect.height * (nextZoom - 1)) / 2;

      setPan({
        x: Math.max(-limitX, Math.min(limitX, nextPanX)),
        y: Math.max(-limitY, Math.min(limitY, nextPanY)),
      });
    } else if (nextZoom === 1) {
      setPan({ x: 0, y: 0 });
    }
    setZoom(nextZoom);
  };

  const handleMouseDown = (e) => {
    if (zoom <= 1) return;
    // Only drag with left click
    if (e.button !== 0) return;
    
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
  };

  const handleMouseMove = (e) => {
    if (!isDragging || zoom <= 1) return;
    e.preventDefault();
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;

    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const limitX = (rect.width * (zoom - 1)) / 2;
      const limitY = (rect.height * (zoom - 1)) / 2;

      setPan({
        x: Math.max(-limitX, Math.min(limitX, panStart.current.x + dx)),
        y: Math.max(-limitY, Math.min(limitY, panStart.current.y + dy)),
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleDoubleClick = (e) => {
    e.preventDefault();
    resetZoom();
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
    };
  }, []); // Bind listener once

  const zoomTransform = zoom > 1
    ? `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`
    : "none";

  return {
    zoom,
    zoomTransform,
    handlers: {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
      onDoubleClick: handleDoubleClick,
    },
    resetZoom,
  };
}
export default useDigitalZoom;
