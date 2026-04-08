import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchMasks, fetchPipelineStatus,
  saveMask, updateMask, deleteMask,
} from "../api/maskApi";

export function useMask(cameraId, rawWsUrl) {
  const [masks,          setMasks]          = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [deletingId,     setDeletingId]     = useState(null);
  const [togglingId,     setTogglingId]     = useState(null);

  // Drawing state
  const [drawingMode,    setDrawingMode]    = useState(false);
  const [pendingRect,    setPendingRect]    = useState(null);  // drawn but not yet saved

  // Pipeline state
  const [pipelineRunning,  setPipelineRunning]  = useState(false);
  const [maskedWsUrl,      setMaskedWsUrl]      = useState(null);

  const pollRef = useRef(null);

  // ── Load masks ───────────────────────────────────────────────
  const loadMasks = useCallback(async () => {
    if (!cameraId) return;
    setLoading(true);
    setError(null);
    try {
      setMasks(await fetchMasks(cameraId));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [cameraId]);

  // ── Poll pipeline status ─────────────────────────────────────
  const checkPipeline = useCallback(async () => {
    if (!cameraId) return;
    try {
      const s = await fetchPipelineStatus(cameraId);
      setPipelineRunning(s.pipeline_running);
      // Use the ws url returned by backend (has correct OME_HOST_IP baked in)
      setMaskedWsUrl(s.pipeline_running ? s.masked_ws_url : null);
    } catch {}
  }, [cameraId]);

  useEffect(() => {
    loadMasks();
    checkPipeline();
  }, [loadMasks, checkPipeline]);

  useEffect(() => {
    if (!cameraId) return;
    pollRef.current = setInterval(checkPipeline, 3000);
    return () => clearInterval(pollRef.current);
  }, [checkPipeline]);

  // ── Drawing ──────────────────────────────────────────────────
  const startDrawing = () => {
    setPendingRect(null);
    setDrawingMode(true);
    setError(null);
  };

  const cancelDrawing = () => {
    setDrawingMode(false);
    setPendingRect(null);
  };

  const onRectDrawn = (rect) => {
    // rect = { x, y, w, h } normalized 0-1
    // Just store it — user must press Save to commit
    setPendingRect(rect);
    setDrawingMode(false);   // exit draw mode, show save controls
  };

  // ── Save pending rect ────────────────────────────────────────
  const saveZone = async ({ label, color, opacity }) => {
    if (!pendingRect || !cameraId) return;
    setSaving(true);
    setError(null);
    try {
      const { x, y, w, h } = pendingRect;
      const saved = await saveMask(cameraId, {
        camera_id: cameraId,
        label,
        color,
        opacity,
        enabled: true,
        polygons: [{
          points: [
            { x,     y     },
            { x: x+w, y     },
            { x: x+w, y: y+h },
            { x,     y: y+h },
          ],
        }],
      });
      setMasks(prev => [...prev, saved]);
      setPendingRect(null);
      // Pipeline starts server-side; poll picks it up within 3 s
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle ───────────────────────────────────────────────────
  const toggleMask = async (maskId, enabled) => {
    setTogglingId(maskId);
    setMasks(prev => prev.map(m => m.id === maskId ? { ...m, enabled } : m));
    try {
      await updateMask(maskId, { enabled });
    } catch (e) {
      setMasks(prev => prev.map(m => m.id === maskId ? { ...m, enabled: !enabled } : m));
      setError(e.message);
    } finally {
      setTogglingId(null);
    }
  };

  // ── Delete ───────────────────────────────────────────────────
  const removeMask = async (maskId) => {
    setDeletingId(maskId);
    setError(null);
    try {
      await deleteMask(maskId);
      setMasks(prev => prev.filter(m => m.id !== maskId));
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setDeletingId(null);
    }
  };

  return {
    masks, loading, error,
    saving, deletingId, togglingId,
    drawingMode, pendingRect,
    pipelineRunning, maskedWsUrl,
    startDrawing, cancelDrawing, onRectDrawn, saveZone,
    toggleMask, removeMask,
    reload: loadMasks,
  };
}