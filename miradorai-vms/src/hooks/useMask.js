import { useState, useEffect, useCallback } from "react";

function getMaskKey(cameraId) {
  return `miradorai_masks_${cameraId}`;
}

function loadMasks(cameraId) {
  try {
    const saved = localStorage.getItem(getMaskKey(cameraId));
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function persistMasks(cameraId, masks) {
  try {
    localStorage.setItem(getMaskKey(cameraId), JSON.stringify(masks));
  } catch {}
}

export function useMask(cameraId) {
  const [masks, setMasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [drawingMode, setDrawingMode] = useState(false);
  const [activePoints, setActivePoints] = useState([]);

  useEffect(() => {
    if (!cameraId) return;
    setLoading(true);
    const data = loadMasks(cameraId);
    setMasks(data);
    setLoading(false);
  }, [cameraId]);

  const addPoint = (x, y) => {
    setActivePoints((prev) => [...prev, { x, y }]);
  };

  const cancelDrawing = () => {
    setDrawingMode(false);
    setActivePoints([]);
  };

  const saveCurrentMask = async (label, color, opacity) => {
    if (activePoints.length < 3) return;
    const newMask = {
      id: `mask_${Date.now()}`,
      camera_id: cameraId,
      label,
      color,
      opacity,
      enabled: true,
      polygons: [{ points: activePoints }],
    };
    const updated = [...masks, newMask];
    setMasks(updated);
    persistMasks(cameraId, updated);
    cancelDrawing();
  };

  const toggleMask = (maskId, enabled) => {
    const updated = masks.map((m) =>
      m.id === maskId ? { ...m, enabled } : m
    );
    setMasks(updated);
    persistMasks(cameraId, updated);
  };

  const removeMask = (maskId) => {
    const updated = masks.filter((m) => m.id !== maskId);
    setMasks(updated);
    persistMasks(cameraId, updated);
  };

  return {
    masks,
    loading,
    error,
    drawingMode,
    activePoints,
    setDrawingMode,
    addPoint,
    cancelDrawing,
    saveCurrentMask,
    toggleMask,
    removeMask,
  };
}