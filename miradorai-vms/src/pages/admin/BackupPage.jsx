import React, { useState, useEffect } from 'react';
import {
  FaServer, FaShieldAlt, FaHistory, FaCheckCircle,
  FaExclamationTriangle, FaPlayCircle, FaDownload,
  FaDatabase, FaBolt, FaBrain, FaFolder
} from 'react-icons/fa';
import './BackupPage.css';

const API     = "http://localhost:8000/api/backup";
const CAM_API = "http://localhost:8000/api/cameras";

const Toggle = ({ checked, onChange }) => (
  <label style={{ position:'relative', display:'inline-block', width:40, height:22, cursor:'pointer' }}>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
      style={{ opacity:0, width:0, height:0 }} />
    <span style={{
      position:'absolute', inset:0, borderRadius:11,
      background: checked ? '#3b82f6' : '#334155', transition:'0.2s'
    }}/>
    <span style={{
      position:'absolute', top:3, left: checked ? 21 : 3,
      width:16, height:16, borderRadius:'50%',
      background:'white', transition:'0.2s'
    }}/>
  </label>
);

const SectionCard = ({ icon, title, enabled, onToggle, badge, children }) => (
  <div className="backup-section-card">
    <div className="card-header" style={{ justifyContent:'space-between' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        {icon}
        <h2 style={{ margin:0 }}>{title}</h2>
        {badge && (
          <span style={{
            fontSize:10, padding:'2px 8px', borderRadius:10,
            background:'rgba(34,197,94,0.15)', color:'#22c55e',
            border:'1px solid rgba(34,197,94,0.3)', fontWeight:600
          }}>{badge}</span>
        )}
      </div>
      {onToggle !== undefined && <Toggle checked={!!enabled} onChange={onToggle} />}
    </div>
    <div className="card-body">{children}</div>
  </div>
);

export default function BackupPage() {
  const [cameras, setCameras]               = useState([]);
  const [logs, setLogs]                     = useState([]);
  const [status, setStatus]                 = useState({
    status:'Idle', progress:0, storage_usage:0,
    local_path:'', network_path:'Not configured', auto_active:false
  });
  const [notification, setNotification]     = useState(null);
  const [loading, setLoading]               = useState({});
  const [networkSaved, setNetworkSaved]     = useState(false);

  // toggles
  const [manualEnabled, setManualEnabled]   = useState(false);
  const [autoEnabled, setAutoEnabled]       = useState(false);

  // network — all from UI, nothing hardcoded
  const [network, setNetwork] = useState({
    protocol: 'SMB',
    ip:       '',
    port:     445,
    username: '',
    password: '',
    path:     ''     // user types e.g.  \\192.168.1.45\checking
  });

  // manual
  const [manual, setManual] = useState({
    cameras:[], start_date:'', end_date:'', format:'MP4'
  });

  // retention
  const [retentionDays, setRetentionDays]     = useState(7);
  const [retentionPreview, setRetentionPreview] = useState(null);

  // restore
  const [restore, setRestore] = useState({
    cameras:[], start_date:'', end_date:'', use_smart_restore:false
  });
  const [smartPreview, setSmartPreview] = useState(null);

  // ── helpers ────────────────────────────────────────────────────────────────
  const notify = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };
  const setLoad = (k, v) => setLoading(p => ({ ...p, [k]: v }));

  const toggleCamera = (setState, ip) =>
    setState(prev => ({
      ...prev,
      cameras: prev.cameras.includes(ip)
        ? prev.cameras.filter(c => c !== ip)
        : [...prev.cameras, ip]
    }));

  // auto-fill path from IP when user types IP
  const handleNetworkIpChange = (ip) => {
    setNetwork(n => ({
      ...n,
      ip,
      // auto-suggest path — user can override
      path: ip ? `\\\\${ip}\\checking` : n.path
    }));
  };

  // ── initial load + polling ─────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        const [camRes, cfgRes, logRes] = await Promise.all([
          fetch(CAM_API),
          fetch(`${API}/config`),
          fetch(`${API}/logs`)
        ]);
        if (camRes.ok) setCameras(await camRes.json());
        if (logRes.ok) setLogs(await logRes.json());
        if (cfgRes.ok) {
          const cfg = await cfgRes.json();
          if (cfg.network) {
            setNetwork(n => ({ ...n, ...cfg.network }));
            setNetworkSaved(!!cfg.network.path);
          }
          if (cfg.auto)           setAutoEnabled(cfg.auto.enabled ?? false);
          if (cfg.retention_days) setRetentionDays(cfg.retention_days);
        }
      } catch { notify('error', 'Could not connect to backend.'); }
    };
    init();

    const poll = setInterval(async () => {
      try {
        const [sRes, lRes] = await Promise.all([
          fetch(`${API}/status`), fetch(`${API}/logs`)
        ]);
        if (sRes.ok) setStatus(await sRes.json());
        if (lRes.ok) setLogs(await lRes.json());
      } catch {}
    }, 3000);
    return () => clearInterval(poll);
  }, []);

  // ── network handlers ───────────────────────────────────────────────────────
  const handleTestConnection = async () => {
    if (!network.path.trim())
      return notify('error', 'Enter the network path first, e.g. \\\\192.168.1.45\\checking');
    setLoad('test', true);
    try {
      const res = await fetch(`${API}/network/test`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(network)
      });
      const d = await res.json();
      res.ok ? notify('success', d.message) : notify('error', d.detail);
    } catch { notify('error', 'Network error.'); }
    finally { setLoad('test', false); }
  };

  const handleSaveNetwork = async () => {
    if (!network.path.trim())
      return notify('error', 'Enter the network path before saving.');
    setLoad('saveNet', true);
    try {
      const res = await fetch(`${API}/network/save`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(network)
      });
      const d = await res.json();
      if (res.ok) {
        notify('success', d.message);
        setNetworkSaved(true);
      } else {
        notify('error', d.detail);
      }
    } catch { notify('error', 'Failed to save.'); }
    finally { setLoad('saveNet', false); }
  };

  // ── auto toggle ────────────────────────────────────────────────────────────
  const handleAutoToggle = async (enabled) => {
    if (enabled && !networkSaved)
      return notify('error', 'Save network settings first before enabling auto backup.');
    setAutoEnabled(enabled);
    try {
      const res = await fetch(`${API}/auto/config`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ enabled })
      });
      const d = await res.json();
      res.ok
        ? notify('success', d.message)
        : notify('error', d.detail);
    } catch { notify('error', 'Failed to update auto backup.'); }
  };

  // ── manual backup ──────────────────────────────────────────────────────────
  // const handleManualStart = async () => {
  //   if (!networkSaved)      return notify('error', 'Save network settings first.');
  //   if (!manual.cameras.length) return notify('error', 'Select at least one camera.');
  //   if (!manual.start_date)     return notify('error', 'Select a start date.');
  //   if (!manual.end_date)       return notify('error', 'Select an end date.');
  //   setLoad('manual', true);
  //   try {
  //     const res = await fetch(`${API}/manual/start`, {
  //       method:'POST', headers:{'Content-Type':'application/json'},
  //       body: JSON.stringify(manual)
  //     });
  //     const d = await res.json();
  //     res.ok ? notify('success', d.message) : notify('error', d.detail);
  //   } catch { notify('error', 'Failed to start backup.'); }
  //   finally { setLoad('manual', false); }
  // };
const handleManualDownload = async () => {
  if (!manual.cameras.length)   return notify('error', 'Select at least one camera.');
  if (!manual.start_date)       return notify('error', 'Select a start date.');
  if (!manual.end_date)         return notify('error', 'Select an end date.');

  setLoad('manual', true);
  try {
    const { format, ...payload } = manual;
    const res = await fetch(`${API}/manual/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
      return notify('error', err.detail || 'No files found for selected range.');
    }

    const blob = await res.blob();

    // ── Try native Save-As picker (Chrome/Edge) ──────────────────────────────
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: `backup_${manual.start_date}_to_${manual.end_date}.zip`,
          types: [{
            description: 'ZIP archive',
            accept: { 'application/zip': ['.zip'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        notify('success', 'Backup saved successfully.');
        return;
      } catch (pickerErr) {
        // User cancelled the picker — don't fall through to auto-download
        if (pickerErr.name === 'AbortError') return;
        // Any other error: fall through to regular download
      }
    }

    // ── Fallback: regular browser download (Firefox / Safari) ────────────────
    const url = window.URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `backup_${manual.start_date}_to_${manual.end_date}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    notify('success', 'Backup download started.');

  } catch (e) {
    console.error('[ManualBackup]', e);
    notify('error', 'Download failed. Check console.');
  } finally {
    setLoad('manual', false);
  }
};

  // ── retention ──────────────────────────────────────────────────────────────
  const handleRetentionPreview = async () => {
    setLoad('retPrev', true);
    try {
      const res = await fetch(`${API}/retention/preview?days=${retentionDays}`);
      setRetentionPreview(await res.json());
    } catch { notify('error', 'Preview failed.'); }
    finally { setLoad('retPrev', false); }
  };

  const handleRetentionEnforce = async () => {
    if (!networkSaved) return notify('error', 'Save network settings first.');
    setLoad('retain', true);
    try {
      const res = await fetch(`${API}/retention/enforce`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ retention_days: retentionDays })
      });
      const d = await res.json();
      res.ok ? notify('success', d.message) : notify('error', d.detail);
      setRetentionPreview(null);
    } catch { notify('error', 'Retention failed.'); }
    finally { setLoad('retain', false); }
  };

  // ── restore ────────────────────────────────────────────────────────────────
  const handleSmartPreview = async () => {
    if (!restore.cameras.length || !restore.end_date) return;
    try {
      const res = await fetch(
        `${API}/restore/smart-preview?camera=${restore.cameras[0]}&end_date=${restore.end_date}`
      );
      setSmartPreview(await res.json());
    } catch {}
  };

  const handleRestoreStart = async () => {
    if (!networkSaved)           return notify('error', 'Save network settings first.');
    if (!restore.cameras.length) return notify('error', 'Select at least one camera.');
    if (!restore.start_date || !restore.end_date)
                                 return notify('error', 'Select date range.');
    setLoad('restore', true);
    try {
      const res = await fetch(`${API}/restore/start`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(restore)
      });
      const d = await res.json();
      res.ok ? notify('success', d.message) : notify('error', d.detail);
    } catch { notify('error', 'Restore failed.'); }
    finally { setLoad('restore', false); }
  };

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="backup-page">

      {/* Header */}
      <div className="backup-header-card">
        <div className="backup-title-area">
          <h1><FaShieldAlt style={{ color:'#3b82f6' }}/> Backup Management</h1>
          <p>PC recordings → Network laptop storage — configured entirely from UI</p>
        </div>
        <div className="backup-stats-strip">
          <div className="stat-pill">
            <label>Status</label>
            <div className="stat-value">
              <div style={{
                width:8, height:8, borderRadius:'50%',
                background: status.status === 'Processing' ? '#3b82f6' : '#22c55e',
                animation: status.status === 'Processing' ? 'pulse 1.5s infinite' : 'none'
              }}/>
              {status.status}
            </div>
          </div>
          <div className="stat-pill">
            <label>Network usage</label>
            <div className="stat-value">
              {status.storage_usage}%
              <div style={{ width:60, height:6, background:'#334155', borderRadius:3, overflow:'hidden' }}>
                <div style={{ width:`${status.storage_usage}%`, height:'100%', background:'#3b82f6' }}/>
              </div>
            </div>
          </div>
          <div className="stat-pill">
            <label>Auto backup</label>
            <div className="stat-value" style={{ color: status.auto_active ? '#22c55e' : '#64748b' }}>
              {status.auto_active ? 'Active' : 'Off'}
            </div>
          </div>
        </div>
      </div>

      {/* Path info bar */}
      {(status.local_path || status.network_path) && (
        <div style={{
          display:'flex', gap:16, padding:'12px 20px',
          background:'rgba(59,130,246,0.04)',
          border:'1px solid rgba(59,130,246,0.1)',
          borderRadius:10, fontSize:12, color:'#64748b'
        }}>
          <span><FaFolder style={{ color:'#3b82f6', marginRight:6 }}/>
            <strong style={{ color:'#94a3b8' }}>Local:</strong> {status.local_path || '—'}
          </span>
          <span style={{ color:'#334155' }}>→</span>
          <span><FaFolder style={{ color:'#22c55e', marginRight:6 }}/>
            <strong style={{ color:'#94a3b8' }}>Network:</strong> {status.network_path || 'Not configured'}
          </span>
        </div>
      )}

      {/* 1. Network Settings */}
      <SectionCard
        icon={<FaServer style={{ color:'#3b82f6' }}/>}
        title="Network storage settings"
        badge={networkSaved ? 'Configured' : undefined}
      >
        {/* Helper tip */}
        <div style={{
          marginBottom:20, padding:'10px 14px',
          background:'rgba(59,130,246,0.05)',
          border:'1px solid rgba(59,130,246,0.15)',
          borderRadius:8, fontSize:12, color:'#94a3b8', lineHeight:1.7
        }}>
          <strong style={{ color:'#3b82f6' }}>How to find your laptop path:</strong><br/>
          1. On your laptop, run <code style={{ color:'#60a5fa' }}>ipconfig</code> → note the IPv4 address (e.g. 192.168.1.45)<br/>
          2. Make sure <code style={{ color:'#60a5fa' }}>C:\checking</code> is shared on the laptop<br/>
          3. Enter path below as <code style={{ color:'#60a5fa' }}>\\192.168.1.45\checking</code>
        </div>

        <div className="form-grid">
          <div className="input-group">
            <label>Protocol</label>
            <select className="backup-select" value={network.protocol}
              onChange={e => setNetwork(n => ({ ...n, protocol: e.target.value }))}>
              <option>SMB</option>
              <option>SFTP</option>
            </select>
          </div>

          <div className="input-group">
            <label>Laptop IP address</label>
            <input type="text" className="backup-input"
              placeholder="192.168.1.45"
              value={network.ip}
              onChange={e => handleNetworkIpChange(e.target.value)} />
          </div>

          <div className="input-group">
            <label>Port</label>
            <input type="number" className="backup-input"
              value={network.port}
              onChange={e => setNetwork(n => ({ ...n, port: +e.target.value }))} />
          </div>

          <div className="input-group">
            <label>Username (optional)</label>
            <input type="text" className="backup-input"
              placeholder="leave blank if no password on share"
              value={network.username}
              onChange={e => setNetwork(n => ({ ...n, username: e.target.value }))} />
          </div>

          <div className="input-group">
            <label>Password (optional)</label>
            <input type="password" className="backup-input"
              value={network.password}
              onChange={e => setNetwork(n => ({ ...n, password: e.target.value }))} />
          </div>

          <div className="input-group" style={{ gridColumn: 'span 2' }}>
            <label>Network path — exact UNC path to the shared folder</label>
            <input type="text" className="backup-input"
              placeholder="\\192.168.1.45\checking"
              value={network.path}
              onChange={e => setNetwork(n => ({ ...n, path: e.target.value }))} />
            <p style={{ fontSize:11, color:'#64748b', marginTop:6 }}>
              This is the folder on your laptop where all recordings will be copied.
              Use double backslashes: <code>\\laptop-ip\folder-name</code>
            </p>
          </div>
        </div>

        <div style={{ display:'flex', gap:12, marginTop:20, paddingTop:16,
          borderTop:'1px solid rgba(255,255,255,0.05)' }}>
          <button className="btn-secondary" onClick={handleTestConnection} disabled={loading.test}>
            {loading.test ? <span className="spinner-sm"/> : <FaBolt style={{ color:'#eab308' }}/>}
            Test connection
          </button>
          <button className="btn-primary" onClick={handleSaveNetwork} disabled={loading.saveNet}>
            {loading.saveNet ? <span className="spinner-sm"/> : 'Save settings'}
          </button>
        </div>
      </SectionCard>

      {/* 2. Manual Backup */}
      <SectionCard
        icon={<FaHistory style={{ color:'#60a5fa' }}/>}
        title="Manual backup"
        enabled={manualEnabled}
        onToggle={setManualEnabled}
      >
        {!manualEnabled
          ? <p style={{ color:'#64748b', fontSize:13, margin:0 }}>
              Toggle on to select cameras and date range to back up manually.
            </p>
          : (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div className="input-group">
                <label>Select cameras</label>
                <div className="camera-selector">
                        {/* inside the manual cameras list */}
                        {cameras
                          .filter(c => c.enabled !== false && c.status !== 'offline')
                          .map(c => (
                            <div key={c.ip} className="cam-item">
                              <input type="checkbox"
                                checked={manual.cameras.includes(c.ip)}
                                onChange={() => toggleCamera(setManual, c.ip)} />
                              <span>
                                {c.device_name || `${c.manufacturer || ''} ${c.model || ''}`.trim() || c.ip}
                                <span style={{ fontSize: 11, color: '#64748b', marginLeft: 6 }}>({c.ip})</span>
                              </span>
                            </div>
                          ))
                        }
                  {!cameras.length &&
                    <div className="empty-msg">No cameras configured.</div>}
                </div>
              </div>
              <div className="input-group">
                <label>Format</label>
                <div style={{ display:'flex', gap:8 }}>
                  {['MP4','AVI'].map(f => (
                    <button key={f} onClick={() => setManual(m => ({ ...m, format:f }))}
                      className="btn-secondary"
                      style={{
                        flex:1,
                        color: manual.format === f ? '#3b82f6' : undefined,
                        borderColor: manual.format === f ? '#3b82f6' : undefined
                      }}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div className="input-group">
                  <label>Start date</label>
                  <input type="date" className="backup-input"
                    value={manual.start_date}
                    onChange={e => setManual(m => ({ ...m, start_date:e.target.value }))}/>
                </div>
                <div className="input-group">
                  <label>End date</label>
                  <input type="date" className="backup-input"
                    value={manual.end_date}
                    onChange={e => setManual(m => ({ ...m, end_date:e.target.value }))}/>
                </div>
              </div>

              {status.status === 'Processing' && (
                <div className="progress-container">
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'#94a3b8' }}>
                    <span>Copying files to network...</span>
                    <span style={{ fontFamily:'monospace' }}>{status.progress}%</span>
                  </div>
                  <div className="progress-bar-bg">
                    <div className="progress-bar-fill" style={{ width:`${status.progress}%` }}/>
                  </div>
                </div>
              )}

              <button className="btn-primary" onClick={handleManualDownload}
                disabled={loading.manual || status.status === 'Processing'}
                style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:10 }}>
                <FaPlayCircle/> Start manual backup
              </button>
            </div>
          </div>
        )}
      </SectionCard>

      {/* 3. Automatic Backup */}
      <SectionCard
        icon={<FaDatabase style={{ color:'#2dd4bf' }}/>}
        title="Automatic backup"
        enabled={autoEnabled}
        onToggle={handleAutoToggle}
        badge={status.auto_active ? 'Watching' : undefined}
      >
        <p style={{ color:'#94a3b8', fontSize:13, margin:0, lineHeight:1.7 }}>
          {autoEnabled
            ? `Every new recording written to ${status.local_path || 'your recordings folder'} is instantly copied to ${status.network_path}.`
            : 'When enabled, every new recording chunk is automatically pushed to the network laptop as it is created — real-time mirror.'}
        </p>
        {autoEnabled && status.auto_active && (
          <div style={{
            marginTop:12, padding:'10px 14px',
            background:'rgba(45,212,191,0.06)',
            border:'1px solid rgba(45,212,191,0.15)',
            borderRadius:8, fontSize:12, color:'#2dd4bf'
          }}>
            Watcher active — new recording chunks are auto-copied to network instantly
          </div>
        )}
      </SectionCard>

      {/* 4. Retention */}
      <SectionCard icon={<FaHistory style={{ color:'#f59e0b' }}/>} title="Retention">
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          <div className="input-group">
            <label>Keep recordings locally for</label>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {[7, 14, 30, 60, 90].map(d => (
                <button key={d} onClick={() => setRetentionDays(d)}
                  className="btn-secondary"
                  style={{
                    color: retentionDays === d ? '#f59e0b' : undefined,
                    borderColor: retentionDays === d ? '#f59e0b' : undefined
                  }}>
                  {d} days
                </button>
              ))}
            </div>
            <p style={{ fontSize:12, color:'#64748b', marginTop:8 }}>
              Files older than {retentionDays} days are moved to the network drive
              and deleted from local storage automatically.
            </p>
          </div>

          {retentionPreview && (
            <div style={{
              padding:'12px 16px',
              background:'rgba(234,179,8,0.06)',
              border:'1px solid rgba(234,179,8,0.2)',
              borderRadius:8
            }}>
              <p style={{ margin:'0 0 8px', fontSize:13, color:'#f59e0b' }}>
                {retentionPreview.count} file(s) will be moved to network
              </p>
              {retentionPreview.files.slice(0,5).map((f,i) => (
                <div key={i} style={{ fontSize:11, color:'#64748b' }}>
                  {f.camera} / {f.file} — {f.modified}
                </div>
              ))}
              {retentionPreview.count > 5 &&
                <div style={{ fontSize:11, color:'#475569', marginTop:4 }}>
                  ...and {retentionPreview.count - 5} more
                </div>}
            </div>
          )}

          <div style={{ display:'flex', gap:12 }}>
            <button className="btn-secondary" onClick={handleRetentionPreview} disabled={loading.retPrev}>
              {loading.retPrev ? <span className="spinner-sm"/> : 'Preview'}
            </button>
            <button className="btn-primary" onClick={handleRetentionEnforce} disabled={loading.retain}>
              {loading.retain ? <span className="spinner-sm"/> : 'Enforce now'}
            </button>
          </div>
        </div>
      </SectionCard>

      {/* 5. Restore */}
      <SectionCard icon={<FaDownload style={{ color:'#a78bfa' }}/>} title="Restore">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <div className="input-group">
              <label>Select cameras</label>
              <div className="camera-selector">
                {cameras.filter(c => c.enabled !== false).map(c => (
                  <div key={c.ip} className="cam-item">
                    <input type="checkbox"
                      checked={restore.cameras.includes(c.ip)}
                      onChange={() => toggleCamera(setRestore, c.ip)}/>
                    <span>{c.manufacturer} {c.model} ({c.ip})</span>
                  </div>
                ))}
                {!cameras.length && <div className="empty-msg">No cameras configured.</div>}
              </div>
            </div>

            <div className="input-group">
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                <FaBrain style={{ color:'#a78bfa', fontSize:14 }}/>
                <label style={{ margin:0 }}>Smart restore predictor</label>
                <Toggle
                  checked={restore.use_smart_restore}
                  onChange={v => {
                    setRestore(r => ({ ...r, use_smart_restore:v }));
                    if (v) handleSmartPreview();
                  }}
                />
              </div>
              <p style={{ fontSize:11, color:'#64748b', margin:0 }}>
                AI picks the last healthy recording point instead of the latest file,
                avoiding unstable or crashed segments.
              </p>
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div className="input-group">
                <label>From date</label>
                <input type="date" className="backup-input"
                  value={restore.start_date}
                  onChange={e => setRestore(r => ({ ...r, start_date:e.target.value }))}/>
              </div>
              <div className="input-group">
                <label>To date</label>
                <input type="date" className="backup-input"
                  value={restore.end_date}
                  onChange={e => {
                    setRestore(r => ({ ...r, end_date:e.target.value }));
                    if (restore.use_smart_restore) handleSmartPreview();
                  }}/>
              </div>
            </div>

            {smartPreview && restore.use_smart_restore && (
              <div style={{
                padding:'10px 14px',
                background:'rgba(167,139,250,0.06)',
                border:'1px solid rgba(167,139,250,0.2)',
                borderRadius:8
              }}>
                <p style={{ margin:'0 0 4px', fontSize:12, color:'#a78bfa', fontWeight:500 }}>
                  AI recommendation
                </p>
                <p style={{ margin:0, fontSize:12, color:'#94a3b8' }}>
                  Restore to:{' '}
                  <strong style={{ color:'white' }}>
                    {smartPreview.recommended_restore_point || 'No healthy point found'}
                  </strong>
                </p>
                <p style={{ margin:'4px 0 0', fontSize:11, color:'#64748b' }}>
                  {smartPreview.reason}
                </p>
              </div>
            )}

            {status.status === 'Processing' && (
              <div className="progress-container">
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'#94a3b8' }}>
                  <span>Restoring from network...</span>
                  <span style={{ fontFamily:'monospace' }}>{status.progress}%</span>
                </div>
                <div className="progress-bar-bg">
                  <div className="progress-bar-fill" style={{ width:`${status.progress}%` }}/>
                </div>
              </div>
            )}

            <button className="btn-primary" onClick={handleRestoreStart}
              disabled={loading.restore || status.status === 'Processing'}
              style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:10 }}>
              <FaDownload/> Restore to local
            </button>
          </div>
        </div>
      </SectionCard>

      {/* Logs */}
      <div className="backup-section-card">
        <div className="card-header">
          <FaHistory style={{ color:'#94a3b8' }}/><h2>Activity logs</h2>
        </div>
        <div className="logs-list">
          {logs.map(log => (
            <div key={log.id} className="log-item">
              <span className="log-time">{log.time}</span>
              <span className={`log-badge ${log.status.toLowerCase()}`}>{log.status}</span>
              <span className="log-event">{log.event}</span>
            </div>
          ))}
          {!logs.length &&
            <div className="empty-msg" style={{ margin:20 }}>No activity yet.</div>}
        </div>
      </div>

      {/* Toast */}
      {notification && (
        <div className={`notification-toast ${notification.type}`}>
          {notification.type === 'success'
            ? <FaCheckCircle style={{ fontSize:20 }}/>
            : <FaExclamationTriangle style={{ fontSize:20 }}/>}
          <div style={{ display:'flex', flexDirection:'column' }}>
            <span style={{ fontWeight:'bold', fontSize:12 }}>
              {notification.type.toUpperCase()}
            </span>
            <span style={{ fontSize:13, color:'white' }}>{notification.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}