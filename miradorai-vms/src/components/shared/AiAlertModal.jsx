import React, { useState, useEffect } from 'react';

const AiAlertModal = ({ alert, onClose }) => {
  const [status, setStatus] = useState(alert?.status || 'Active');
  const [showConfirm, setShowConfirm] = useState(null);
  const [note, setNote] = useState('');
  const [aiIp, setAiIp] = useState('');
  
  const API = import.meta.env.VITE_API_URL || '';
  function getAuthHeaders() {
    const token = localStorage.getItem('miradorai_token') || localStorage.getItem('token') || localStorage.getItem('authToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  // Fetch the AI integration server IP (same logic as LiveViewPage)
  useEffect(() => {
    const fetchAiIp = async () => {
      try {
        const res = await fetch(`${API}/api/integrations`, { headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          const aiInt = data.find(i => i.isActive && (i.type?.toLowerCase().includes('ai') || i.serverName?.toLowerCase().includes('ai')));
          if (aiInt?.serverIp) {
            setAiIp(aiInt.serverIp.split(':')[0]);
          } else {
            const anyActive = data.find(i => i.isActive && i.serverIp);
            if (anyActive) setAiIp(anyActive.serverIp.split(':')[0]);
          }
        }
      } catch (e) { /* silent */ }
    };
    fetchAiIp();
  }, []);

  useEffect(() => {
    setStatus(alert?.status || 'Active');
  }, [alert]);

  if (!alert) return null;

  // All data from DB — nothing hardcoded
  const raw = alert.rawData || alert.raw || alert || {};

  const eventType    = raw.type          || alert.type          || 'AI Event';
  const feature       = raw.feature       || '—';
  const readerName   = raw.readerName    || raw.readername      || raw.reader_name || raw.readerIp || '—';
  const readerIp      = raw.readerIp      || (alert.ip || '').replace(/_/g, '.') || '—';
  const dtRaw          = raw.detectionTime || raw.detection_time  || alert.received_at || '';
  const alertId        = alert.id          || raw.id              || alert._id || '';
  const employeeName= raw.employeeName  || raw.employee_name   || '—';
  const location      = raw.locationName  || raw.location        || '—';
  const zone           = raw.zoneName      || raw.zone            || '—';
  const label           = raw.label         || raw.subType         || '—';
  // Match same logic as SidePlaybackPanel: persisted snapshot → API fallback
  // const alertIpRaw = (alert.ip || raw.readerIp || raw.ip || '').replace(/_/g, '.');
  // const alertTime  = alert.time || alert.received_at || dtRaw || '';
  // const persisted  = raw.snapshot_url || raw.image_url || alert.snapshot_url || alert.snapshotUrl || alert.snapshot || alert.face_url || alert.image || null;
  // const thumbUrl   = persisted || (alertIpRaw && alertTime
  //   ? `${API}/api/event-playback/snapshot?ip=${encodeURIComponent(alertIpRaw)}&time=${encodeURIComponent(alertTime)}`
  //   : null);
  // Detection Image:
// Prefer imageLocation from the external AI alert.
// Supports imageLocation / imglocation / imgelocation,
// including nested data objects.
const findImageLocation = (obj) => {
  if (!obj) return null;

  const key = Object.keys(obj).find(
    (k) => {
      const normalized = k.toLowerCase().replace(/_/g, '');
      return (
        normalized === 'imagelocation' ||
        normalized === 'imglocation' ||
        normalized === 'imgelocation'
      );
    }
  );

  return key ? obj[key] : null;
};

const dataObj = alert?.data || raw?.data || {};

const imageLocationRaw =
  findImageLocation(alert) ||
  findImageLocation(raw) ||
  findImageLocation(dataObj) ||
  null;

const effectiveAiIp = aiIp || '192.168.126.35';

const imageLocationUrl = imageLocationRaw
  ? (
      imageLocationRaw.startsWith('http')
        ? imageLocationRaw
        : `http://${effectiveAiIp}/minio/${imageLocationRaw.replace(/^\//, '')}`
    )
  : null;

// Existing fallbacks
const alertIpRaw = (alert.ip || raw.readerIp || raw.ip || '').replace(/_/g, '.');
const alertTime = alert.time || alert.received_at || dtRaw || '';

const persisted =
  raw.snapshot_url ||
  raw.image_url ||
  alert.snapshot_url ||
  alert.snapshotUrl ||
  alert.snapshot ||
  alert.face_url ||
  alert.image ||
  null;

// Priority:
// 1. imageLocation
// 2. persisted image
// 3. event playback snapshot
const thumbUrl =
  imageLocationUrl ||
  persisted ||
  (alertIpRaw && alertTime
    ? `${API}/api/event-playback/snapshot?ip=${encodeURIComponent(alertIpRaw)}&time=${encodeURIComponent(alertTime)}`
    : null);

  // Frame URL — looks for framelocation/frameLocation/frame_location key (same pattern as imglocation for Detection Image)
  const findLocKey = (obj, patterns) => {
    if (!obj) return null;
    const key = Object.keys(obj).find(k => patterns.includes(k.toLowerCase().replace(/_/g, '')));
    return key ? obj[key] : null;
  };
  // const dataObj = alert?.data || raw?.data || {};
  const frameLocRaw = findLocKey(alert, ['framelocation', 'frameLocation', 'frame_location'])
    || findLocKey(raw, ['framelocation', 'frameLocation', 'frame_location'])
    || findLocKey(dataObj, ['framelocation', 'frameLocation', 'frame_location'])
    || null;
  // const effectiveAiIp = aiIp || '192.168.126.35';
  const frameUrl = frameLocRaw
    ? (frameLocRaw.startsWith('http') ? frameLocRaw : `http://${effectiveAiIp}/minio/${frameLocRaw.replace(/^\//, '')}`)
    : thumbUrl; // fall back to thumbUrl if no framelocation

  const subType       = raw.subType       || raw.sub_type        || '—';
  const known           = raw.known         || '—';
  const value           = raw.value         != null ? raw.value : null;

  // Format detection time from DB value
  let displayDate = dtRaw;
  try {
    const d = new Date(dtRaw);
    if (!isNaN(d.getTime())) {
      const pad = (n) => n.toString().padStart(2, '0');
      displayDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  } catch (_) {}

  const timeOnly = (() => {
    try {
      const d = new Date(dtRaw);
      if (!isNaN(d.getTime())) {
        const pad = (n) => n.toString().padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      }
    } catch (_) {}
    return '';
  })();

  const isAck = status.includes('Acknowledged');
  const isRes = status.includes('Resolved');

  const handleAcknowledge = () => setShowConfirm('Acknowledged');
  const handleResolve = () => setShowConfirm('Resolved');

  const handleUpdateStatus = async () => {
    if (!showConfirm) return;
    try {
      let newStatus = showConfirm;
      if (showConfirm === 'Resolved' && status.includes('Acknowledged')) {
         newStatus = 'Acknowledged & Resolved';
      }
      const id = alert.id || alert._id || alert.alert_id;
      if (id) {
        await fetch(`${API}/api/alerts/${id}/status`, {
          method: 'PUT',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus, action: showConfirm, note }),
        });
      }
      if (showConfirm === 'Acknowledged') {
          const tzOffset = (new Date()).getTimezoneOffset() * 60000; alert.acknowledged_at = (new Date(Date.now() - tzOffset)).toISOString().slice(0, -1);
          alert.acknowledge_note = note;
      } else if (showConfirm === 'Resolved') {
          const tzOffset = (new Date()).getTimezoneOffset() * 60000; alert.resolved_at = (new Date(Date.now() - tzOffset)).toISOString().slice(0, -1);
          alert.resolve_note = note;
      }
      setStatus(newStatus);
      alert.status = newStatus;
      setShowConfirm(null);
      setNote('');
    } catch (err) {
      console.error("Failed to update status", err);
    }
  };
  
  const formatTs = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts.replace("T", " ").split(".")[0].replace("Z", "");
    const pad = (n) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const Row = ({ label: lbl, value: val, isStatus, isLabel }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
      <span style={{ color: 'var(--text-secondary, #64748b)', fontSize: '13px', fontWeight: 500 }}>{lbl}</span>
      {isStatus ? (
         <span style={{
            background: isRes ? 'rgba(16, 185, 129, 0.15)' : isAck ? 'rgba(59, 130, 246, 0.15)' : 'rgba(249, 115, 22, 0.15)',
            color: isRes ? 'var(--teal, #10b981)' : isAck ? 'var(--blue, #3b82f6)' : '#f97316',
            padding: '2px 10px', borderRadius: '12px', fontWeight: 600, fontSize: '12px', display: 'inline-block', border: '1px solid currentColor'
          }}>{status}</span>
      ) : isLabel ? (
         <span style={{ color: '#f97316', fontWeight: 600, fontSize: '13px' }}>{val || 'N/A'}</span>
      ) : (
         <span style={{ color: 'var(--text-primary, #334155)', fontWeight: 600, fontSize: '13px', wordBreak: 'break-word', display: 'flex', alignItems: 'center', gap: '4px' }}>
           {val || 'N/A'}
           {lbl === 'Alert ID' && (
              <svg onClick={() => navigator.clipboard.writeText(val)} style={{cursor: 'pointer'}} viewBox="0 0 24 24" width="14" height="14" stroke="#94a3b8" strokeWidth="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
           )}
         </span>
      )}
    </div>
  );

  return (
    <div
      className="alp-overlay"
      onClick={onClose}
      style={{ zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10, 12, 16, 0.5)', backdropFilter: 'blur(4px)', position: 'fixed', inset: 0 }}
    >
      <div
        className="alp-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '850px', width: '95%', maxHeight: '90vh', overflowY: 'auto', borderRadius: '10px', background: 'var(--bg-elevated, #e2e8f0)', border: '1px solid var(--border-light, #cbd5e1)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', color: 'var(--text-primary, #0f172a)', fontFamily: 'var(--font-ui, sans-serif)', display: 'flex', flexDirection: 'column' }}
      >
        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--border-light, #cbd5e1)', background: 'var(--bg-surface, #e2e8f0)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="2" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>{feature !== '—' ? feature : 'Intrusion'} - {label !== '—' ? (label.charAt(0).toUpperCase() + label.slice(1)) : 'Person'}</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {!isAck && (
              <button onClick={handleAcknowledge} style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                Acknowledge
              </button>
            )}
            {!isRes && (
              <button onClick={handleResolve} style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', background: '#10b981', color: '#fff', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                Resolve
              </button>
            )}
            <button style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
               <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '20px', marginLeft: '4px' }}>✕</button>
          </div>
        </div>

        {/* BODY */}
        {showConfirm ? (
           <div style={{ padding: '24px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>{showConfirm === 'Acknowledged' ? 'Acknowledge Alarm' : 'Mark as Resolved'}</h3>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px', marginTop: 0 }}>
              {showConfirm === 'Acknowledged' ? "Confirm you've reviewed this alarm and describe your initial response or findings." : "Provide a brief summary of how this alarm was handled before closing it."}
            </p>
            <div style={{ marginBottom: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
              <span style={{ color: 'var(--red, #ef4444)' }}>*</span> {showConfirm === 'Acknowledged' ? 'Acknowledgement Note' : 'Resolution Summary'}
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={showConfirm === 'Acknowledged' ? "e.g. Alert reviewed - security team dispatched to Zone B." : "e.g. Investigated on-site - false alarm. No further action required."} style={{ width: '100%', height: '80px', background: 'var(--bg-surface, #ffffff)', border: '1px solid var(--border-light, #cbd5e1)', borderRadius: '8px', padding: '12px', color: 'var(--text-primary)', fontSize: '14px', resize: 'none', marginBottom: '20px', outline: 'none', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowConfirm(null)} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border-light, #cbd5e1)', background: 'var(--bg-surface, #ffffff)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 500 }}>Cancel</button>
              <button onClick={handleUpdateStatus} style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: showConfirm === 'Acknowledged' ? 'var(--blue, #3b82f6)' : 'var(--teal, #10b981)', color: '#fff', cursor: 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>
                {showConfirm === 'Acknowledged' ? 'Confirm Acknowledgement' : 'Confirm Resolution'}
              </button>
            </div>
          </div>
        ) : (
        <div style={{ display: 'flex', gap: '16px', padding: '16px', flexWrap: 'wrap', flex: 1 }}>
          
          {/* LEFT COLUMN */}
          <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* Detection Summary Card */}
            <div style={{ background: '#ffffff', borderRadius: '8px', padding: '12px 16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="#3b82f6" strokeWidth="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>Detection Summary</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <Row label="Status" value={status} isStatus />
                <Row label="Camera" value={readerName} />
                <Row label="Detection Time" value={displayDate} />
                <Row label="Alert ID" value={alertId} />
                <Row label="Location" value={location} />
                <Row label="ZONE" value={zone} />
                <Row label="Feature" value={feature} />
                <Row label="Label" value={label} isLabel />
              </div>
            </div>

            {/* Detection Image Card */}
            <div style={{ background: '#ffffff', borderRadius: '8px', padding: '12px 16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="#eab308" strokeWidth="2" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>Detection Image</span>
              </div>
              <div style={{ width: '100%', height: '180px', background: '#000', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                 {thumbUrl ? (
                  <img src={thumbUrl} alt="Detection Image" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ) : (
                  <span style={{ color: '#64748b', fontSize: '12px' }}>No Image Available</span>
                )}
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN */}
          <div style={{ flex: '1.5 1 400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* Detection Frame Card */}
            <div style={{ background: '#ffffff', borderRadius: '8px', padding: '12px 16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="#10b981" strokeWidth="2" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>Detection Frame</span>
              </div>
              <div style={{ width: '100%', flex: 1, minHeight: '200px', background: '#000', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: '10px' }}>
                 {frameUrl ? (
                  <img src={frameUrl} alt="Detection Frame" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ) : (
                  <span style={{ color: '#64748b', fontSize: '12px' }}>No Frame Available</span>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                 <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ background: '#f1f5f9', border: 'none', borderRadius: '4px', padding: '4px 6px', color: '#475569', cursor: 'pointer', display: 'flex' }}><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>
                    <button style={{ background: '#f1f5f9', border: 'none', borderRadius: '4px', padding: '4px 6px', color: '#475569', cursor: 'pointer', display: 'flex' }}><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg></button>
                 </div>
                 <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>1 / 1</span>
              </div>
            </div>

            {/* Response Timeline Card */}
            <div style={{ background: '#ffffff', borderRadius: '8px', padding: '12px 16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="#ef4444" strokeWidth="2" fill="none"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>Response Timeline</span>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', padding: '0 10px' }}>
                <div style={{ position: 'absolute', top: '16px', left: '15%', right: '15%', height: '2px', background: '#e2e8f0', zIndex: 1 }}></div>
                <div style={{ position: 'absolute', top: '16px', left: '15%', width: isRes ? '70%' : (isAck ? '35%' : '0%'), height: '2px', background: isRes ? '#10b981' : '#3b82f6', zIndex: 1, transition: 'width 1s ease' }}></div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2, flex: 1, minWidth: 0 }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px', boxShadow: '0 0 0 2px #ffffff', animation: (!isAck && !isRes) ? 'pulse-red 2s infinite' : 'none' }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="#fff" strokeWidth="2" fill="none"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                  </div>
                  <span style={{ fontWeight: 600, fontSize: '12px', color: '#0f172a', textAlign: 'center' }}>Alarm Triggered</span>
                  <span style={{ fontSize: '10px', color: '#64748b', textAlign: 'center', marginTop: '4px' }}>{(displayDate || '').split(' ')[0]}<br />{timeOnly}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2, flex: 1, minWidth: 0 }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: isAck ? '#3b82f6' : '#ffffff', border: isAck ? 'none' : '1px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke={isAck ? '#fff' : '#94a3b8'} strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  </div>
                  <span style={{ fontWeight: 600, fontSize: '12px', color: '#0f172a', textAlign: 'center' }}>{isAck ? 'Acknowledged' : 'Not Acknowledged'}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2, flex: 1, minWidth: 0 }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: isRes ? '#10b981' : '#ffffff', border: isRes ? 'none' : '1px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke={isRes ? '#fff' : '#94a3b8'} strokeWidth="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                  </div>
                  <span style={{ fontWeight: 600, fontSize: '12px', color: '#0f172a', textAlign: 'center' }}>{isRes ? 'Resolved' : 'Active'}</span>
                </div>
              </div>
            </div>

          </div>
        </div>
        )}

        {/* FOOTER */}
        {!showConfirm && (
           <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-light, #cbd5e1)', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f1f5f9', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', position: 'relative' }}>
              <span style={{ fontSize: '13px', color: '#475569', fontFamily: 'monospace' }}>ID: {alertId}</span>
              <div style={{ display: 'flex', gap: '8px', position: 'absolute', right: '24px' }}>
                 <button style={{ width: '28px', height: '28px', borderRadius: '50%', border: 'none', background: '#94a3b8', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
                 <button style={{ width: '28px', height: '28px', borderRadius: '50%', border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
              </div>
           </div>
        )}

      </div>
    </div>
  );
};

export default AiAlertModal;