import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useUserSettings } from "./UserSettingsContext";
import { useNotificationPermission } from "../hooks/useNotificationPermission";
import { useWebSocket } from "../hooks/useWebSocket";
import "./NotificationContext.css"; // ADDED

const NotificationContext = createContext({});
export const useNotifications = () => useContext(NotificationContext);

export const NotificationProvider = ({ children }) => {
  const { settings } = useUserSettings();
  const { permission } = useNotificationPermission();
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const [toasts, setToasts] = useState([]);
  const [intercomCall, setIntercomCall] = useState(null);
  const [firmwareUpdateCount, setFirmwareUpdateCount] = useState(0);

  const clearFirmwareBadge = useCallback(() => setFirmwareUpdateCount(0), []);

  const showToast = useCallback(({ title, body, variant = "info", persistent = false }) => {
    console.log('[SHOW TOAST CALLED]', title, body, variant);
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, title, body, variant, persistent }]);
    if (!persistent) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 5000);
    }
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const playSoundForType = useCallback((type) => {
    const s = settingsRef.current;
    if (!s) return;

    let soundType = s.alarmSound || "no-sound";
    let filePath = s.alarmFile || "";

    if (type === "intercom") {
        soundType = s.callSound || "no-sound";
        filePath = s.callFile || "";
    }

    if (soundType === "beep") {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, 300);
      } catch(e) {}
    } else if (soundType === "file" && filePath) {
      try {
        const url = `${import.meta.env.VITE_API_URL || ""}/api/stream-audio?path=${encodeURIComponent(filePath)}`;
        const audio = new Audio(url);
        audio.play().catch(e => console.error("Audio play failed:", e));
      } catch(e) {}
    }
  }, []);

  const lastSnapshotTimeRef = useRef(0);

  const handleSnapshot = useCallback((base64) => {
    const now = Date.now();
    const lastSnap = parseInt(localStorage.getItem('miradorai_last_snapshot') || '0', 10);
    // Prevent duplicate snapshots within 5 seconds across all tabs (e.g. from both websocket and keyup if one is delayed)
    if (now - lastSnap < 5000) return;
    localStorage.setItem('miradorai_last_snapshot', now.toString());
    lastSnapshotTimeRef.current = now;

    import('../utils/snapshotUtils').then(({ saveSnapshotToBackend }) => {
        const pageName = window.location.pathname.split('/').pop() || 'dashboard';
        saveSnapshotToBackend(base64, 'Screenshot_' + pageName, settingsRef.current, (msg, type, persistent) => {
            const timeStr = new Date().toLocaleString();
            const folder = settingsRef.current?.snapFolder || "default path";
            showToast({ 
                title: `Screenshot Captured in /${pageName}`, 
                body: `saved to ${folder}!\n${timeStr}`, 
                variant: type || 'success', 
                persistent 
            });
        });
    }).catch(err => console.error("Snapshot error:", err));
  }, [showToast]);

  const notify = useCallback((event) => {
    console.log('[NOTIFY CALLED]', event);
    const payload = event.data;
    if (!payload) {
      console.log('[NOTIFY] bailed: no payload');
      return;
    }

    const isSystem = event.topic === 'system';
    const payloadType = payload.type || 'Analytics Event';

    const envelope = { topic: isSystem ? 'system' : 'alerts', event: 'notification', data: payload };
    window.dispatchEvent(new CustomEvent(`ws-event-${envelope.topic}`, { detail: envelope }));

    if (payloadType === 'os_screenshot') {
       handleSnapshot(payload.base64);
       return;
    }

    if (payloadType === 'intercom_call') {
        setIntercomCall({ deviceName: payload.device || 'Unknown' });
        playSoundForType('intercom');
        return;
    }

    if (payloadType === 'firmware_available') {
        setFirmwareUpdateCount(c => c + 1);
        showToast({ title: 'System Notification', body: 'New firmware available', variant: 'info' });
        return;
    }

    const DEVICE_FAILURES = ["Device Offline", "Video Stream Lost", "Recording Stopped", "Storage Full", "Storage Failure"];
    const DEVICE_RECOVERIES = ["Device Online / Recovered", "Video Stream Restored", "Recording Resumed", "Storage Restored"];
    const SYSTEM_FAILURES = ["Backend Service Unavailable", "Database Connection Failure"];

    let variant = 'warning';
    if (DEVICE_FAILURES.includes(payloadType) || SYSTEM_FAILURES.includes(payloadType)) variant = 'error';
    else if (DEVICE_RECOVERIES.includes(payloadType)) variant = 'success';

    console.log('[NOTIFY] isSystem:', isSystem, 'notifTasks:', settingsRef.current?.notifTasks, 'notifAlarms:', settingsRef.current?.notifAlarms, 'payloadType:', payloadType);

    if (isSystem && settingsRef.current?.notifTasks !== false) {
        showToast({ title: 'Background Task', body: payload.description || payloadType, variant: 'info' });
    }
    if (!isSystem && settingsRef.current?.notifAlarms !== false) {
        showToast({
           title: `${payloadType} Alert`,
           body: `Camera: ${payload.ip || payload.serial || 'Unknown'}`,
           variant
        });
        playSoundForType("alarm");
    }
  }, [showToast, playSoundForType, handleSnapshot]);

  const { lastEvent } = useWebSocket(['alerts', 'system']);

  const isCapturingRef = useRef(false);

  useEffect(() => {
    const handleKeyUp = async (e) => {
      if (e.key === "PrintScreen") {
        if (isCapturingRef.current) return;
        isCapturingRef.current = true;
        
        try {
          const html2canvas = (await import("html2canvas")).default;
          const canvas = await html2canvas(document.body, { useCORS: true });
          const base64 = canvas.toDataURL("image/png");
          handleSnapshot(base64);
        } catch (error) {
          console.error("Screenshot capture failed:", error);
          showToast({ title: "Snapshot Error", body: "Capture failed.", variant: "error" });
        } finally {
          isCapturingRef.current = false;
        }
      }
    };
    window.addEventListener("keyup", handleKeyUp);
    return () => window.removeEventListener("keyup", handleKeyUp);
  }, [handleSnapshot, showToast]);

  useEffect(() => {
    console.log('[LAST EVENT CHANGED]', lastEvent);
    if (lastEvent && lastEvent.data && lastEvent.data.type) {
      notify(lastEvent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);

  return (
    <NotificationContext.Provider value={{ notify, firmwareUpdateCount, clearFirmwareBadge, showToast }}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-container-box">
          {toasts.length > 1 && (
            <div className="toast-container-header">
              <span>Notifications ({toasts.length})</span>
              <button className="toast-container-close" title="Clear all" onClick={() => setToasts([])}>&times;</button>
            </div>
          )}
          <div className="toast-list">
            {toasts.map(t => (
              <div key={t.id} className={`toast-item toast-${t.variant}`}>
                <div className="toast-content">
                  <strong>{t.title}</strong>
                  <p className="toast-body">{t.body}</p>
                </div>
                <button className="toast-close" title="Dismiss" onClick={() => removeToast(t.id)}>&times;</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {intercomCall && (
        <div className="intercom-modal-overlay">
          <div className="intercom-modal">
            <h2>Incoming Intercom Call</h2>
            <p>From: {intercomCall.deviceName || 'Unknown Device'}</p>
            <div className="intercom-video-preview">
              <div className="video-placeholder">Audio/Video feed...</div>
            </div>
            <div className="intercom-actions">
              <button className="btn-accept" onClick={() => setIntercomCall(null)}>Accept</button>
              <button className="btn-decline" onClick={() => setIntercomCall(null)}>Decline</button>
            </div>
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
};