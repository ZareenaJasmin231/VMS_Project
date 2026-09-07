import React, { useState, useEffect } from 'react';

/**
 * AiAlertModal
 * Restructured per wireframe:
 *  - Header: prev/next navigation, title, Acknowledge/Resolve/Download actions, close
 *  - Compact animated timeline strip under the header (Alarm → Acknowledged → Resolved)
 *  - Body: big Detection Summary panel (left) + Detection Frame / Detection Image stacked (right)
 *  - Footer: Alert ID
 *  - Whole modal animates in/out (scale + fade), timeline progress animates, active state pulses.
 *
 * Optional new props: onPrev, onNext — pass handlers to enable the header nav arrows
 * (used when browsing between alerts from LiveView without closing the modal).
 */
const AiAlertModal = ({ alert, onClose, onPrev, onNext }) => {
  const [status, setStatus] = useState(alert?.status || 'Active');
  const [showConfirm, setShowConfirm] = useState(null);
  const [note, setNote] = useState('');
  const [aiIp, setAiIp] = useState('');
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  const ImageFallback = ({ paths, alt, style }) => {
    const [idx, setIdx] = useState(0);
    const [failed, setFailed] = useState(false);
    
    if (failed || !paths || paths.length === 0) {
      return <span style={{ color: 'var(--text-secondary, #64748b)', fontSize: '12px' }}>No {alt} Available</span>;
    }
    return (
      <img 
        src={paths[idx]} 
        alt={alt} 
        style={style} 
        onError={(e) => {
          if (idx < paths.length - 1) {
            setIdx(idx + 1);
          } else {
            setFailed(true);
          }
        }} 
      />
    );
  };

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

  // Entrance animation — use a tiny timeout to ensure the CSS transition runs reliably after initial paint
  useEffect(() => {
    setClosing(false);
    setMounted(false);
    const timer = setTimeout(() => setMounted(true), 10);
    return () => clearTimeout(timer);
  }, [alert]);

  const ANIM_MS = 240;
  const handleRequestClose = () => {
    setClosing(true);
    setTimeout(() => { onClose && onClose(); }, ANIM_MS);
  };

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

  // Detection Image:
  // Prefer imageLocation from the external AI alert.
  // Supports imageLocation / imglocation / imgelocation, including nested data objects.
  const findImageLocation = (obj) => {
    if (!obj) return null;
    const key = Object.keys(obj).find((k) => {
      const normalized = k.toLowerCase().replace(/_/g, '');
      return (
        normalized === 'imagelocation' ||
        normalized === 'imglocation' ||
        normalized === 'imgelocation'
      );
    });
    return key ? obj[key] : null;
  };

  const dataObj = alert?.data || raw?.data || {};

  const imageLocationRaw =
    findImageLocation(alert) ||
    findImageLocation(raw) ||
    findImageLocation(dataObj) ||
    null;

  const effectiveAiIp = aiIp || '192.168.126.35';

  const buildPaths = (rawPath) => {
    if (!rawPath) return [];
    if (rawPath.startsWith('http')) return [rawPath];
    const clean = rawPath.replace(/^\//, '');
    return [
      `http://${effectiveAiIp}:9000/${clean}`,
      `http://${effectiveAiIp}/minio/${clean}`,
      `http://192.168.126.201:8006/${clean}`,
      `${API}/${clean}`,
      `/${clean}`
    ];
  };

  const imageLocationPaths = buildPaths(imageLocationRaw);
  
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

  const fallbackSnapshotUrl = (alertIpRaw && alertTime) 
    ? `${API}/api/event-playback/snapshot?ip=${encodeURIComponent(alertIpRaw)}&time=${encodeURIComponent(alertTime)}` 
    : null;

  const thumbPaths = [
    ...imageLocationPaths,
    ...(persisted ? [persisted] : []),
    ...(fallbackSnapshotUrl ? [fallbackSnapshotUrl] : [])
  ];

  // Frame URL — looks for framelocation/frameLocation/frame_location key
  const findLocKey = (obj, patterns) => {
    if (!obj) return null;
    const key = Object.keys(obj).find(k => patterns.includes(k.toLowerCase().replace(/_/g, '')));
    return key ? obj[key] : null;
  };
  const frameLocRaw = findLocKey(alert, ['framelocation', 'frameLocation', 'frame_location'])
    || findLocKey(raw, ['framelocation', 'frameLocation', 'frame_location'])
    || findLocKey(dataObj, ['framelocation', 'frameLocation', 'frame_location'])
    || null;

  const framePaths = frameLocRaw ? buildPaths(frameLocRaw) : thumbPaths;

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
  const handleDownload = () => {
    const url = (framePaths && framePaths.length > 0) ? framePaths[0] : ((thumbPaths && thumbPaths.length > 0) ? thumbPaths[0] : null);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `alert-${alertId || 'image'}.jpg`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const Row = ({ label: lbl, value: val, isStatus, isLabel }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--border-light, #f1f5f9)' }}>
      <span style={{ color: 'var(--text-secondary, #64748b)', fontSize: '13px', fontWeight: 500 }}>{lbl}</span>
      {isStatus ? (
        <span style={{
          background: isRes ? 'rgba(16, 185, 129, 0.14)' : isAck ? 'rgba(59, 130, 246, 0.14)' : 'rgba(249, 115, 22, 0.14)',
          color: isRes ? '#10b981' : isAck ? '#3b82f6' : '#f97316',
          padding: '3px 12px', borderRadius: '999px', fontWeight: 600, fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px', border: '1px solid currentColor'
        }}>
          {!isAck && !isRes && <span className="aam-livedot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#f97316', display: 'inline-block' }} />}
          {status}
        </span>
      ) : isLabel ? (
        <span style={{ color: '#f97316', fontWeight: 700, fontSize: '13px' }}>{val || 'N/A'}</span>
      ) : (
        <span style={{ color: 'var(--text-primary, #334155)', fontWeight: 600, fontSize: '13px', wordBreak: 'break-word', display: 'flex', alignItems: 'center', gap: '6px', textAlign: 'right' }}>
          {val || 'N/A'}
          {lbl === 'Alert ID' && (
            <svg onClick={() => navigator.clipboard.writeText(val)} style={{ cursor: 'pointer', flexShrink: 0 }} viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          )}
        </span>
      )}
    </div>
  );

  const showEntrance = mounted && !closing;
  // 0 / 50 / 100 progress along the compact header timeline
  const progressPct = isRes ? 100 : (isAck ? 50 : 0);

  const NavArrow = ({ dir, onClick }) => {
    const enabled = !!onClick;
    return (
      <button
        className="aam-btn aam-nav"
        onClick={enabled ? onClick : undefined}
        disabled={!enabled}
        aria-label={dir === 'prev' ? 'Previous alert' : 'Next alert'}
        style={{
          width: 30, height: 30, borderRadius: '8px', border: '1px solid rgba(148,163,184,0.35)',
          background: 'rgba(148,163,184,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.35, color: 'var(--text-secondary, #cbd5e1)'
        }}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" strokeWidth="2.2" fill="none">
          {dir === 'prev' ? <polyline points="15 18 9 12 15 6"></polyline> : <polyline points="9 18 15 12 9 6"></polyline>}
        </svg>
      </button>
    );
  };

  return (
    <div
      className="alp-overlay"
      onClick={handleRequestClose}
      style={{
        zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(10, 12, 16, 0.55)', backdropFilter: 'blur(4px)', position: 'fixed', inset: 0,
        opacity: showEntrance ? 1 : 0, transition: `opacity ${ANIM_MS}ms ease`,
        pointerEvents: closing ? 'none' : 'auto'
      }}
    >
      <style>{`
        @keyframes aamPulseRed {
          0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.55); }
          70%  { box-shadow: 0 0 0 9px rgba(239,68,68,0); }
          100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
        }
        @keyframes aamPop {
          0%   { transform: scale(0); }
          65%  { transform: scale(1.18); }
          100% { transform: scale(1); }
        }
        @keyframes aamLiveDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.35; transform: scale(0.7); }
        }
        .aam-livedot { animation: aamLiveDot 1.6s ease-in-out infinite; }
        .aam-pulse { animation: aamPulseRed 1.8s infinite; }
        .aam-pop { animation: aamPop 380ms cubic-bezier(0.34,1.56,0.64,1); }
        .aam-btn { transition: transform 150ms ease, filter 150ms ease, box-shadow 150ms ease; }
        .aam-btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
        .aam-btn:active:not(:disabled) { transform: translateY(0); filter: brightness(0.94); }
        .aam-nav:hover:not(:disabled) { background: rgba(203,213,225,0.22) !important; }
        .aam-headicon:hover:not(:disabled) { background: rgba(203,213,225,0.22) !important; }
        .aam-card { transition: box-shadow 200ms ease, transform 200ms ease; }
        .aam-scroll::-webkit-scrollbar { width: 8px; }
        .aam-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 8px; }
        .aam-progress { transition: width 900ms cubic-bezier(0.22, 1, 0.36, 1); }
      `}</style>

      <div
        className="alp-modal aam-scroll"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '900px', width: '95%', maxHeight: '90vh', overflowY: 'auto', borderRadius: '14px',
          background: 'var(--bg-elevated, #e2e8f0)', border: '1px solid var(--border-light, #cbd5e1)',
          boxShadow: '0 30px 60px -12px rgba(0, 0, 0, 0.35)', color: 'var(--text-primary, #0f172a)',
          fontFamily: 'var(--font-ui, sans-serif)', display: 'flex', flexDirection: 'column',
          transform: showEntrance ? 'scale(1) translateY(0)' : 'scale(0.94) translateY(18px)',
          opacity: showEntrance ? 1 : 0,
          transition: `transform ${ANIM_MS + 80}ms cubic-bezier(0.16,1,0.3,1), opacity ${ANIM_MS}ms ease`
        }}
      >
        {/* HEADER — nav / title / actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--border-light, #cbd5e1)', background: 'var(--bg-surface, #e2e8f0)', borderTopLeftRadius: '14px', borderTopRightRadius: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '6px' }}>
              <NavArrow dir="prev" onClick={onPrev} />
              <NavArrow dir="next" onClick={onNext} />
            </div>
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" style={{ flexShrink: 0 }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {feature !== '—' ? feature : 'Intrusion'} - {label !== '—' ? (label.charAt(0).toUpperCase() + label.slice(1)) : 'Person'}
            </h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            {!isAck && (
              <button className="aam-btn" onClick={handleAcknowledge} style={{ padding: '7px 14px', borderRadius: '7px', border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                Acknowledge
              </button>
            )}
            {!isRes && (
              <button className="aam-btn" onClick={isAck ? handleResolve : undefined} disabled={!isAck} title={!isAck ? "Acknowledge alert first" : ""} style={{ padding: '7px 14px', borderRadius: '7px', border: 'none', background: isAck ? '#10b981' : 'var(--bg-elevated, #94a3b8)', color: isAck ? '#fff' : 'var(--text-muted, #cbd5e1)', cursor: isAck ? 'pointer' : 'not-allowed', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', opacity: isAck ? 1 : 0.6 }}>
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                Resolve
              </button>
            )}
            <button className="aam-btn aam-headicon" onClick={handleDownload} title="Download" style={{ width: 30, height: 30, borderRadius: '8px', background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.35)', color: 'var(--text-secondary, #cbd5e1)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" strokeWidth="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button className="aam-btn aam-headicon" onClick={handleRequestClose} title="Close" style={{ width: 30, height: 30, borderRadius: '8px', background: 'transparent', border: 'none', color: 'var(--text-secondary, #cbd5e1)', cursor: 'pointer', fontSize: '19px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
        </div>

        {/* COMPACT ANIMATED TIMELINE STRIP */}
        {!showConfirm && (
          <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--border-light, #cbd5e1)', background: 'transparent' }}>
            <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
              <div style={{ position: 'absolute', top: '13px', left: '16.66%', right: '16.66%', height: '3px', borderRadius: '3px', background: 'var(--border-light, #e2e8f0)', zIndex: 1 }}></div>
              <div className="aam-progress" style={{ position: 'absolute', top: '13px', left: '16.66%', width: `${progressPct * 0.6666}%`, height: '3px', borderRadius: '3px', background: isRes ? '#10b981' : '#3b82f6', zIndex: 1 }}></div>

              {[
                { key: 'trigger', active: true, done: true, color: '#ef4444', label: 'Alarm Triggered', time: timeOnly, icon: <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>, iconExtra: <><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></> },
                { key: 'ack', active: isAck, done: isAck, color: '#3b82f6', label: isAck ? 'Acknowledged' : 'Not Acknowledged', time: isAck && alert.acknowledged_at ? alert.acknowledged_at.split('T')[1]?.slice(0,8) : '', icon: <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>, iconExtra: <circle cx="12" cy="12" r="3"></circle> },
                { key: 'resolve', active: isRes, done: isRes, color: '#10b981', label: isRes ? 'Resolved' : 'Active', time: isRes && alert.resolved_at ? alert.resolved_at.split('T')[1]?.slice(0,8) : '', icon: <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>, iconExtra: <polyline points="22 4 12 14.01 9 11.01"></polyline> },
              ].map((step, idx) => (
                <div key={step.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2, flex: 1, minWidth: 0 }}>
                  <div
                    key={`${step.key}-${step.done}`}
                    className={step.key === 'trigger' && !isAck && !isRes ? 'aam-pulse aam-pop' : 'aam-pop'}
                    style={{
                      width: '28px', height: '28px', borderRadius: '50%',
                      background: step.done ? step.color : 'var(--bg-surface, #ffffff)',
                      border: step.done ? 'none' : '1px solid var(--border-light, #cbd5e1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '6px',
                      boxShadow: '0 0 0 2px var(--bg-elevated, #ffffff)'
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" stroke={step.done ? '#fff' : 'var(--text-secondary, #94a3b8)'} strokeWidth="2" fill="none">{step.icon}{step.iconExtra}</svg>
                  </div>
                  <span style={{ fontWeight: 600, fontSize: '11.5px', color: 'var(--text-primary, #0f172a)', textAlign: 'center' }}>{step.label}</span>
                  {(idx === 0 ? displayDate?.split(' ')[1] : step.time) && (
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary, #64748b)', marginTop: '2px' }}>{idx === 0 ? timeOnly : step.time}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

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
              <button className="aam-btn" onClick={() => setShowConfirm(null)} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border-light, #cbd5e1)', background: 'var(--bg-surface, #ffffff)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 500 }}>Cancel</button>
              <button className="aam-btn" onClick={handleUpdateStatus} style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: showConfirm === 'Acknowledged' ? 'var(--blue, #3b82f6)' : 'var(--teal, #10b981)', color: '#fff', cursor: 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>
                {showConfirm === 'Acknowledged' ? 'Confirm Acknowledgement' : 'Confirm Resolution'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '16px', padding: '16px', flexWrap: 'wrap', flex: 1 }}>

            {/* LEFT — Detection Summary (big panel, per wireframe) */}
            <div className="aam-card" style={{ flex: '1 1 320px', background: 'var(--bg-surface, #ffffff)', borderRadius: '10px', padding: '18px 20px', border: '1px solid var(--border-light, #e2e8f0)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <svg viewBox="0 0 24 24" width="17" height="17" stroke="#3b82f6" strokeWidth="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary, #0f172a)' }}>Detection Summary</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <Row label="Status" value={status} isStatus />
                <Row label="Camera" value={readerName} />
                <Row label="Detection Time" value={displayDate} />
                <Row label="Alert ID" value={alertId} />
                <Row label="Location" value={location} />
                <Row label="Zone" value={zone} />
                <Row label="Feature" value={feature} />
                <Row label="Label" value={label} isLabel />
                {employeeName !== '—' && <Row label="Employee" value={employeeName} />}
                {readerIp !== '—' && <Row label="Reader IP" value={readerIp} />}
              </div>
            </div>

            {/* RIGHT — Detection Frame + Detection Image stacked, per wireframe */}
            <div style={{ flex: '1.4 1 380px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="aam-card" style={{ background: 'var(--bg-surface, #ffffff)', borderRadius: '10px', padding: '14px 16px', border: '1px solid var(--border-light, #e2e8f0)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', flex: '1.3', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" stroke="#10b981" strokeWidth="2" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                  <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary, #0f172a)' }}>Detection Frame</span>
                </div>
                <div style={{ width: '100%', flex: 1, minHeight: '180px', background: '#000', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: '10px' }}>
                  <ImageFallback 
                    paths={framePaths} 
                    alt="Detection Frame" 
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="aam-btn" onClick={handleDownload} title="Download Frame" style={{ background: 'var(--bg-elevated, #f1f5f9)', border: 'none', borderRadius: '4px', padding: '4px 6px', color: 'var(--text-secondary, #475569)', cursor: 'pointer', display: 'flex' }}><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>
                    <button className="aam-btn" style={{ background: 'var(--bg-elevated, #f1f5f9)', border: 'none', borderRadius: '4px', padding: '4px 6px', color: 'var(--text-secondary, #475569)', cursor: 'pointer', display: 'flex' }}><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg></button>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary, #64748b)', fontWeight: 500 }}>1 / 1</span>
                </div>
              </div>

              <div className="aam-card" style={{ background: 'var(--bg-surface, #ffffff)', borderRadius: '10px', padding: '14px 16px', border: '1px solid var(--border-light, #e2e8f0)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', flex: '1' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" stroke="#eab308" strokeWidth="2" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                  <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary, #0f172a)' }}>Detection Image</span>
                </div>
                <div style={{ width: '100%', height: '150px', background: '#000', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  <ImageFallback 
                    paths={thumbPaths} 
                    alt="Detection Image" 
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FOOTER */}
        {!showConfirm && (
          <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-light, #cbd5e1)', display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'transparent', borderBottomLeftRadius: '14px', borderBottomRightRadius: '14px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary, #475569)', fontFamily: 'monospace' }}>ID: {alertId}</span>
          </div>
        )}

      </div>
    </div>
  );
};

export default AiAlertModal;