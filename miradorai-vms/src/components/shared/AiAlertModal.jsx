import React from 'react';
import { useTheme } from '../../context/ThemeContext';

const AiAlertModal = ({ alert, onClose }) => {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  if (!alert) return null;

  // All data from DB — nothing hardcoded
  const raw = alert.rawData || alert.raw || alert || {};

  const eventType   = raw.type          || alert.type          || 'AI Event';
  const feature     = raw.feature       || '—';
  const readerName  = raw.readerName    || raw.readername      || raw.reader_name || raw.readerIp || '—';
  const readerIp    = raw.readerIp      || (alert.ip || '').replace(/_/g, '.') || '—';
  const dtRaw       = raw.detectionTime || raw.detection_time  || alert.received_at || '';
  const status      = alert.status      || 'Active';
  const alertId     = alert.id          || raw.id              || alert._id || '';
  const employeeName= raw.employeeName  || raw.employee_name   || '—';
  const location    = raw.locationName  || raw.location        || '—';
  const zone        = raw.zoneName      || raw.zone            || '—';
  const label       = raw.label         || raw.subType         || '—';
  const thumbUrl    = raw.snapshot_url  || raw.image_url       || alert.snapshot_url || alert.image || null;
  const subType     = raw.subType       || raw.sub_type        || null;
  const known       = raw.known         || null;
  const value       = raw.value         != null ? raw.value : null;

  // Format detection time from DB value
  let displayDate = dtRaw;
  try {
    const d = new Date(dtRaw);
    if (!isNaN(d.getTime())) {
      displayDate = d.toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });
    }
  } catch (_) {}

  // Theme tokens
  const t = {
    overlay:    'rgba(0,0,0,0.72)',
    modal:      dark ? '#111827' : '#ffffff',
    header:     dark ? '#1f2937' : '#f8fafc',
    headerBdr:  dark ? '#374151' : '#e2e8f0',
    card:       dark ? '#1f2937' : '#f8fafc',
    cardBdr:    dark ? '#374151' : '#e5e7eb',
    body:       dark ? '#111827' : '#f1f5f9',
    text:       dark ? '#f9fafb' : '#0f172a',
    sub:        dark ? '#9ca3af' : '#64748b',
    accent:     '#06b6d4',      // cyan — unique accent
    accentSoft: dark ? 'rgba(6,182,212,0.15)' : 'rgba(6,182,212,0.1)',
    labelBg:    dark ? 'rgba(239,68,68,0.15)'  : '#fee2e2',
    labelText:  '#ef4444',
    statusBg:   dark ? 'rgba(34,197,94,0.15)'  : '#dcfce7',
    statusText: '#16a34a',
    divider:    dark ? '#374151' : '#e5e7eb',
    imgBg:      dark ? '#0f172a' : '#e2e8f0',
    btnAck:     '#3b82f6',
    btnResolve: '#10b981',
  };

  const SectionTitle = ({ icon, children }) => (
    <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'16px',
      paddingBottom:'10px', borderBottom:`1px solid ${t.divider}` }}>
      <span style={{ fontSize:'16px' }}>{icon}</span>
      <span style={{ fontSize:'13px', fontWeight:700, color: t.accent, letterSpacing:'0.05em', textTransform:'uppercase' }}>
        {children}
      </span>
    </div>
  );

  const Row = ({ label: lbl, value: val, accent: isAccent }) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
      padding:'7px 0', borderBottom:`1px solid ${t.divider}` }}>
      <span style={{ fontSize:'12px', color: t.sub }}>{lbl}</span>
      <span style={{ fontSize:'13px', fontWeight:600,
        color: isAccent ? t.accent : t.text, maxWidth:'55%', textAlign:'right', wordBreak:'break-word' }}>
        {val || '—'}
      </span>
    </div>
  );

  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0,
      background: t.overlay,
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:99999,
      fontFamily:'"Inter", system-ui, sans-serif',
      backdropFilter: 'blur(3px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.modal,
        width:'920px', maxWidth:'96vw', maxHeight:'92vh',
        borderRadius:'16px',
        display:'flex', flexDirection:'column',
        boxShadow: dark
          ? '0 25px 50px rgba(0,0,0,0.7), 0 0 0 1px rgba(6,182,212,0.2)'
          : '0 25px 50px rgba(0,0,0,0.15), 0 0 0 1px rgba(6,182,212,0.3)',
        overflow:'hidden',
      }}>

        {/* ── Header with cyan left border accent */}
        <div style={{
          background: t.header,
          borderBottom: `1px solid ${t.headerBdr}`,
          borderLeft: `4px solid ${t.accent}`,
          padding: '14px 22px',
          display:'flex', justifyContent:'space-between', alignItems:'center',
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            {/* Pulsing dot */}
            <span style={{
              width:'10px', height:'10px', borderRadius:'50%',
              background:'#ef4444',
              boxShadow:'0 0 0 0 rgba(239,68,68,0.5)',
              display:'inline-block',
              animation:'pulse 1.5s infinite',
            }} />
            <span style={{ fontSize:'16px', fontWeight:700, color: t.text }}>
              {feature}
            </span>
            <span style={{
              fontSize:'11px', background: t.accentSoft, color: t.accent,
              padding:'2px 10px', borderRadius:'20px', fontWeight:600, border:`1px solid ${t.accent}`,
            }}>{eventType}</span>
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <button style={{
              background: t.btnAck, color:'#fff', border:'none',
              padding:'7px 18px', borderRadius:'8px', fontSize:'12px', fontWeight:600, cursor:'pointer',
            }}>Acknowledge</button>
            <button style={{
              background: t.btnResolve, color:'#fff', border:'none',
              padding:'7px 18px', borderRadius:'8px', fontSize:'12px', fontWeight:600, cursor:'pointer',
            }}>Resolve</button>
            <button onClick={onClose} style={{
              background:'transparent', border:`1px solid ${t.divider}`, cursor:'pointer',
              color: t.sub, width:'30px', height:'30px', borderRadius:'8px',
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px',
            }}>✕</button>
          </div>
        </div>

        {/* ── Body */}
        <div style={{
          display:'flex', gap:'0', flex:1, overflow:'auto',
          background: t.body,
        }}>

          {/* LEFT: Info panel */}
          <div style={{
            flex: '0 0 340px', padding:'20px', display:'flex', flexDirection:'column', gap:'16px',
            borderRight: `1px solid ${t.divider}`,
            background: t.modal,
            overflow:'auto',
          }}>

            {/* Status badge + ID strip */}
            <div style={{
              display:'flex', justifyContent:'space-between', alignItems:'center',
              padding:'10px 14px', borderRadius:'10px',
              background: t.accentSoft, border:`1px solid ${t.accent}`,
            }}>
              <div style={{ fontSize:'11px', color: t.sub, maxWidth:'65%', wordBreak:'break-all' }}>
                ID: <span style={{ color: t.text, fontWeight:600 }}>{alertId ? alertId.substring(0,22)+'…' : '—'}</span>
              </div>
              <span style={{
                background: t.statusBg, color: t.statusText,
                padding:'3px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:700,
              }}>{status}</span>
            </div>

            {/* Alert details — all from DB */}
            <div style={{ background: t.card, borderRadius:'12px', padding:'16px', border:`1px solid ${t.cardBdr}` }}>
              <SectionTitle icon="📋">Alert Details</SectionTitle>
              <Row label="Feature"        value={feature}     accent />
              <Row label="Type"           value={eventType} />
              <Row label="Sub Type"       value={subType} />
              <Row label="Label"          value={label} />
              <Row label="Status"         value={status} />
            </div>

            <div style={{ background: t.card, borderRadius:'12px', padding:'16px', border:`1px solid ${t.cardBdr}` }}>
              <SectionTitle icon="📷">Camera Info</SectionTitle>
              <Row label="Reader Name"    value={readerName}  accent />
              <Row label="Reader IP"      value={readerIp} />
              <Row label="Detection Time" value={displayDate} />
            </div>

            <div style={{ background: t.card, borderRadius:'12px', padding:'16px', border:`1px solid ${t.cardBdr}` }}>
              <SectionTitle icon="📍">Location & Person</SectionTitle>
              <Row label="Location"       value={location} />
              <Row label="Zone"           value={zone} />
              <Row label="Employee"       value={employeeName} />
              <Row label="Known"          value={known} />
              {value != null && <Row label="Value"   value={String(value)} />}
            </div>
          </div>

          {/* RIGHT: Frame + timeline */}
          <div style={{ flex:1, padding:'20px', display:'flex', flexDirection:'column', gap:'16px', overflow:'auto' }}>

            {/* Frame */}
            <div style={{
              background: t.card, borderRadius:'12px', padding:'16px',
              border:`1px solid ${t.cardBdr}`, flex:1, display:'flex', flexDirection:'column'
            }}>
              <SectionTitle icon="🖼️">Detection Frame</SectionTitle>
              <div style={{
                flex:1, minHeight:'240px', background: dark ? '#000' : '#e2e8f0',
                borderRadius:'10px', overflow:'hidden',
                display:'flex', alignItems:'center', justifyContent:'center',
                position:'relative',
              }}>
                {thumbUrl ? (
                  <img src={thumbUrl} alt="Detection Frame"
                    style={{ width:'100%', height:'100%', objectFit:'contain' }}
                    onError={e => { e.currentTarget.style.display='none'; }} />
                ) : (
                  <span style={{ color: t.sub, fontSize:'13px' }}>No Frame Available</span>
                )}
                {/* corner accent lines */}
                {[
                  {top:8,left:8,bT:'2px solid '+t.accent,bL:'2px solid '+t.accent},
                  {top:8,right:8,bT:'2px solid '+t.accent,bR:'2px solid '+t.accent},
                  {bottom:8,left:8,bB:'2px solid '+t.accent,bL:'2px solid '+t.accent},
                  {bottom:8,right:8,bB:'2px solid '+t.accent,bR:'2px solid '+t.accent},
                ].map((s,i) => (
                  <div key={i} style={{
                    position:'absolute', width:18, height:18, ...Object.fromEntries(
                      Object.entries(s).map(([k,v]) => [k.startsWith('b') && !k.startsWith('bot') && !k.startsWith('bL') && !k.startsWith('bR') && !k.startsWith('bT') && !k.startsWith('bB') ? k : k, v])
                    )
                  }} />
                ))}
              </div>
            </div>

            {/* Response Timeline */}
            <div style={{
              background: t.card, borderRadius:'12px', padding:'16px',
              border:`1px solid ${t.cardBdr}`,
            }}>
              <SectionTitle icon="⏱️">Response Timeline</SectionTitle>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingTop:'8px' }}>
                {[
                  { label: 'Alarm Triggered', color:'#ef4444', filled: true },
                  { label: 'Acknowledged',    color:'#3b82f6', filled: false },
                  { label: 'Resolved',        color:'#10b981', filled: false },
                ].map((step, i, arr) => (
                  <React.Fragment key={i}>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'8px' }}>
                      <div style={{
                        width:'36px', height:'36px', borderRadius:'50%',
                        background: step.filled ? step.color : t.body,
                        border: `2px solid ${step.filled ? step.color : t.divider}`,
                        display:'flex', alignItems:'center', justifyContent:'center',
                        boxShadow: step.filled ? `0 0 12px ${step.color}55` : 'none',
                        transition:'all 0.3s',
                      }}>
                        {step.filled
                          ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.sub} strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                        }
                      </div>
                      <span style={{ fontSize:'11px', fontWeight:600, color: step.filled ? step.color : t.sub }}>
                        {step.label}
                      </span>
                    </div>
                    {i < arr.length - 1 && (
                      <div style={{ flex:1, height:'2px', background: t.divider, margin:'0 8px', marginBottom:'20px' }} />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* ── Footer */}
        <div style={{
          background: t.header, borderTop:`1px solid ${t.headerBdr}`,
          padding:'10px 22px', display:'flex', justifyContent:'space-between', alignItems:'center',
        }}>
          <span style={{ fontSize:'11px', color: t.sub }}>
            <span style={{ color: t.accent, fontWeight:600 }}>ALERT ID: </span>{alertId || '—'}
          </span>
          <button onClick={onClose} style={{
            background:`linear-gradient(135deg, ${t.accent}, #3b82f6)`,
            color:'#fff', border:'none', padding:'7px 20px',
            borderRadius:'8px', fontSize:'12px', fontWeight:600, cursor:'pointer',
          }}>Close</button>
        </div>

        {/* Pulse keyframe via style tag */}
        <style>{`
          @keyframes pulse {
            0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.6); }
            70%  { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
            100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
          }
        `}</style>
      </div>
    </div>
  );
};

export default AiAlertModal;
