import React, { useState, useEffect } from 'react';
import {
  FaServer, FaShieldAlt, FaHistory, FaCheckCircle,
  FaExclamationTriangle, FaPlayCircle, FaDownload,
  FaDatabase, FaBolt, FaBrain, FaFolder, FaHdd, FaUsb,
  FaArrowRight
} from 'react-icons/fa';
import './BackupPage.css';

const API = (import.meta.env.VITE_API_URL || "") + "/api/backup";
const CAM_API = (import.meta.env.VITE_API_URL || "") + "/api/cameras";

// ── Destination options ───────────────────────────────────────────────────────
const DEST_OPTIONS = [
  { key: 'D',      label: 'D: drive',     sub: 'D:\\Backup',  path: 'D:\\Backup' },
  { key: 'C',      label: 'C: drive',     sub: 'C:\\Backup',  path: 'C:\\Backup' },
  { key: 'Z',      label: 'Z: drive',     sub: 'Mapped laptop (Z:\\)', path: 'Z:\\' },
  { key: 'custom', label: 'Custom / USB', sub: 'Type any path or USB', path: '' },
];

// ── Toggle switch ─────────────────────────────────────────────────────────────
const Toggle = ({ checked, onChange }) => (
  <label className="mp-switch" onClick={e => e.stopPropagation()}>
    <input 
      type="checkbox" 
      checked={checked} 
      onChange={e => onChange(e.target.checked)} 
    />
    <span className="mp-switch-slider" />
  </label>
);

// ── Section card wrapper ──────────────────────────────────────────────────────
const SectionCard = ({ icon, title, enabled, onToggle, badge, children }) => (
  <div className="backup-section-card">
    <div className="card-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
        <span style={{ color: 'var(--teal)', fontSize: 22 }}>{icon}</span>
        <h2>{title}</h2>
        {badge && <span className="card-badge">{badge}</span>}
      </div>
      {onToggle !== undefined && <Toggle checked={!!enabled} onChange={onToggle} />}
    </div>
    <div className="card-body">{children}</div>
  </div>
);

// ── Destination picker modal ──────────────────────────────────────────────────
const DestinationModal = ({ onConfirm, onCancel }) => {
  const [selected, setSelected]   = useState('D');
  const [customPath, setCustomPath] = useState('');

  const confirm = () => {
    let path = DEST_OPTIONS.find(d => d.key === selected)?.path || '';
    if (selected === 'custom') {
      path = customPath.trim();
      if (!path) return;
    }
    onConfirm(path);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
          Select Destination
        </h2>
        <p style={{ fontSize: 17, color: 'var(--text-secondary)', margin: '0 0 20px' }}>
          Choose where to save the recordings (.enc + .meta files).
        </p>

        <div className="dest-options">
          {DEST_OPTIONS.map(opt => (
            <div 
              key={opt.key} 
              className={`dest-card ${selected === opt.key ? 'active' : ''}`}
              onClick={() => setSelected(opt.key)}
            >
              <div className="dest-label">{opt.label}</div>
              <div className="dest-sub">{opt.sub}</div>
            </div>
          ))}
        </div>

        {selected === 'custom' && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 16, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
              Custom Path (e.g. E:\Backup or \\server\share)
            </label>
            <input
              type="text"
              className="backup-input"
              style={{ width: '100%' }}
              placeholder="E:\Backup"
              value={customPath}
              onChange={e => setCustomPath(e.target.value)}
              autoFocus
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: 2 }} onClick={confirm}>
            <FaPlayCircle /> Start Backup
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BackupPage() {
  const [cameras, setCameras]           = useState([]);
  const [logs, setLogs]                 = useState([]);
  const [status, setStatus]             = useState({
    status: 'Idle', progress: 0, storage_usage: 0,
    local_path: '', network_path: 'Not configured', auto_active: false
  });
  const [notification, setNotification] = useState(null);
  const [loading, setLoading]           = useState({});
  const [networkSaved, setNetworkSaved] = useState(false);

  const [manualEnabled, setManualEnabled] = useState(false);
  const [autoEnabled, setAutoEnabled]     = useState(false);
  const [showDestModal, setShowDestModal] = useState(false);
  const [activeTab, setActiveTab]         = useState('storage');

  const [network, setNetwork] = useState({
    protocol: 'SMB', ip: '', port: 445, username: '', password: '', path: ''
  });

  const [manual, setManual] = useState({
    cameras: [], start_date: '', end_date: '', format: 'ENC'
  });

  const [groups, setGroups] = useState(() => {
    try {
      const saved = localStorage.getItem("miradorai_groups");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [devices, setDevices] = useState(() => {
    try {
      const saved = localStorage.getItem("miradorai_devices");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [defaultRetention, setDefaultRetention] = useState(() => {
    try {
      const saved = localStorage.getItem("miradorai_default_retention");
      return saved ? parseInt(saved, 10) : 5;
    } catch { return 5; }
  });

  const [retentionPreview, setRetentionPreview] = useState(null);
  const [retentionAlert, setRetentionAlert] = useState(null);

  const [restore, setRestore]       = useState({
    cameras: [], start_date: '', end_date: '', use_smart_restore: false
  });
  const [smartPreview, setSmartPreview] = useState(null);

  const notify = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 6000);
  };
  const setLoad = (k, v) => setLoading(p => ({ ...p, [k]: v }));

  const toggleCamera = (setState, ip) =>
    setState(prev => ({
      ...prev,
      cameras: prev.cameras.includes(ip)
        ? prev.cameras.filter(c => c !== ip)
        : [...prev.cameras, ip]
    }));

  const handleNetworkIpChange = ip => {
    setNetwork(n => ({
      ...n, ip,
      path: ip ? `\\\\${ip}\\checking` : n.path
    }));
  };

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
          if (cfg.retention_days) setDefaultRetention(cfg.retention_days);
        }
      } catch { notify('error', 'Connection failed.'); }
    };
    init();

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API}/status`);
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch {}
    };
    fetchStatus();
    const statusPoll = setInterval(fetchStatus, 3000);

    const logPoll = setInterval(async () => {
      try {
        const lRes = await fetch(`${API}/logs`);
        if (lRes.ok) setLogs(await lRes.json());
      } catch {}
    }, 10000);

    return () => {
      clearInterval(statusPoll);
      clearInterval(logPoll);
    };
  }, []);

  const handleTestConnection = async () => {
    if (!network.path.trim()) return notify('error', 'Enter path.');
    setLoad('test', true);
    try {
      const res = await fetch(`${API}/network/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(network)
      });
      const d = await res.json();
      res.ok ? notify('success', d.message) : notify('error', d.detail);
    } catch { notify('error', 'Test failed.'); }
    finally { setLoad('test', false); }
  };

  const handleSaveNetwork = async () => {
    if (!network.path.trim()) return notify('error', 'Enter path.');
    setLoad('saveNet', true);
    try {
      const res = await fetch(`${API}/network/save`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(network)
      });
      const d = await res.json();
      if (res.ok) { notify('success', 'Settings saved.'); setNetworkSaved(true); }
      else notify('error', d.detail);
    } catch { notify('error', 'Save failed.'); }
    finally { setLoad('saveNet', false); }
  };

  const handleAutoToggle = async enabled => {
    if (enabled && !networkSaved) return notify('error', 'Save network first.');
    setAutoEnabled(enabled);
    try {
      const res = await fetch(`${API}/auto/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const d = await res.json();
      res.ok ? notify('success', d.message) : notify('error', d.detail);
    } catch { notify('error', 'Failed.'); }
  };

  const handleManualClick = () => {
    if (!manual.cameras.length) return notify('error', 'Select cameras.');
    if (!manual.start_date || !manual.end_date) return notify('error', 'Select dates.');
    setShowDestModal(true);
  };

  const handleManualStart = async (destinationPath) => {
    setShowDestModal(false);
    setLoad('manual', true);
    try {
      const res = await fetch(`${API}/manual/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...manual, destination_path: destinationPath })
      });
      const d = await res.json();
      res.ok ? notify('success', 'Backup started.') : notify('error', d.detail);
    } catch { notify('error', 'Start failed.'); }
    finally { setLoad('manual', false); }
  };

  const updateGroupRetention = (groupId, days) => {
    setRetentionPreview(null);
    setRetentionAlert(null);
    if (groupId === 'default') {
      setDefaultRetention(days);
      localStorage.setItem('miradorai_default_retention', days.toString());
    } else {
      const updated = groups.map(g => g.id === groupId ? { ...g, retention_days: days } : g);
      setGroups(updated);
      localStorage.setItem('miradorai_groups', JSON.stringify(updated));
    }
    // Updated silently, wait for "Apply" button to save and notify
  };

  const handleApplyRetention = async () => {
    if (!networkSaved) return notify('error', 'Save network first.');
    setLoad('saveRetain', true);
    setRetentionAlert(null);
    const cameraConfigs = getCameraConfigs();
    try {
      // Step 1: Save retention rules to backend config
      const saveRes = await fetch(`${API}/retention/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          retention_days: defaultRetention,
          camera_configs: cameraConfigs,
          retention_enabled: true // Always treat it as enabled when applying
        })
      });
      
      if (!saveRes.ok) {
        const errData = await saveRes.json();
        notify('error', errData.message || 'Failed to save retention rules.');
        setLoad('saveRetain', false);
        return;
      }

      // Step 2: Immediately execute deletion purge sweep
      const enforceRes = await fetch(`${API}/retention/enforce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          retention_days: defaultRetention,
          camera_configs: cameraConfigs
        })
      });
      const d = await enforceRes.json();
      if (enforceRes.ok && d.status !== 'error') {
        notify('success', d.message);
        setRetentionPreview(null);
      } else {
        const errMsg = d.message || 'Retention cannot happen as some files are not stored in the backup.';
        notify('error', errMsg);
        setRetentionAlert({
          message: errMsg,
          missing: d.missing_files || []
        });
      }
    } catch {
      notify('error', 'Failed to apply retention rules.');
    } finally {
      setLoad('saveRetain', false);
    }
  };

  const getCameraConfigs = () => {
    return cameras.map(cam => {
      const matchedDevice = devices.find(d => d.ip === cam.ip || d.name === cam.name);
      const groupId = matchedDevice?.group_id || 'default';
      let days = defaultRetention;
      
      if (matchedDevice && matchedDevice.retention_days !== undefined && matchedDevice.retention_days !== "inherit") {
        days = parseInt(matchedDevice.retention_days, 10);
      } else if (groupId !== 'default') {
        const groupObj = groups.find(g => g.id === groupId);
        if (groupObj && groupObj.retention_days !== undefined) {
          days = parseInt(groupObj.retention_days, 10);
        }
      }
      
      return { ip: cam.ip, days };
    });
  };

  const handleRetentionPreview = async () => {
    setLoad('retPrev', true);
    setRetentionAlert(null);
    const cameraConfigs = getCameraConfigs();
    try {
      const res = await fetch(`${API}/retention/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          retention_days: defaultRetention,
          camera_configs: cameraConfigs
        })
      });
      const data = await res.json();
      setRetentionPreview(data);
      if (data.missing_in_backup_count > 0) {
        setRetentionAlert({
          message: `Retention cannot happen for all files because ${data.missing_in_backup_count} file(s) are not stored in the network backup.`,
          missing: data.missing_files || []
        });
      }
    } catch { notify('error', 'Preview failed.'); }
    finally { setLoad('retPrev', false); }
  };

  const handleRetentionEnforce = async () => {
    if (!networkSaved) return notify('error', 'Save network first.');
    setLoad('retain', true);
    setRetentionAlert(null);
    const cameraConfigs = getCameraConfigs();
    try {
      const res = await fetch(`${API}/retention/enforce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          retention_days: defaultRetention,
          camera_configs: cameraConfigs
        })
      });
      const d = await res.json();
      if (res.ok && d.status !== 'error') {
        notify('success', d.message);
        setRetentionPreview(null);
      } else {
        const errMsg = d.message || 'Retention cannot happen as some files are not stored in the backup.';
        notify('error', errMsg);
        setRetentionAlert({
          message: errMsg,
          missing: d.missing_files || []
        });
      }
    } catch { notify('error', 'Failed.'); }
    finally { setLoad('retain', false); }
  };

  const handleRestoreStart = async () => {
    if (!networkSaved)           return notify('error', 'Save network first.');
    if (!restore.cameras.length) return notify('error', 'Select cameras.');
    if (!restore.start_date || !restore.end_date) return notify('error', 'Select range.');
    setLoad('restore', true);
    try {
      const res = await fetch(`${API}/restore/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restore)
      });
      const d = await res.json();
      res.ok ? notify('success', 'Restore started.') : notify('error', d.detail);
    } catch { notify('error', 'Restore failed.'); }
    finally { setLoad('restore', false); }
  };

  return (
    <div className="backup-page">
      {showDestModal && (
        <DestinationModal
          onConfirm={handleManualStart}
          onCancel={() => setShowDestModal(false)}
        />
      )}

      {/* Header */}
      <div className="backup-page-header">
        <div>
          <h1 className="backup-page-title">Backup Management</h1>
        </div>
        <div className="backup-stats-strip">
          <div className="stat-pill">
            <label>Status</label>
            <div className="stat-value">
              <div className={`status-dot ${status.status === 'Processing' ? 'active' : 'idle'}`} />
              {status.status}
            </div>
          </div>
          <div className="stat-pill">
            <label>Auto Backup</label>
            <div className="stat-value" style={{ color: status.auto_active ? 'var(--teal)' : 'var(--text-muted)' }}>
              {status.auto_active ? 'Active' : 'Offline'}
            </div>
          </div>
          <div className="stat-pill">
            <label>Network Usage</label>
            <div className="stat-value">
              {status.storage_usage}%
            </div>
          </div>
        </div>
      </div>



      <div className="backup-tabs">
        <button className={`backup-tab-btn ${activeTab === 'storage' ? 'active' : ''}`} onClick={() => setActiveTab('storage')}>Storage & Mirroring</button>
        <button className={`backup-tab-btn ${activeTab === 'retention' ? 'active' : ''}`} onClick={() => setActiveTab('retention')}>Retention Policies</button>
        <button className={`backup-tab-btn ${activeTab === 'export' ? 'active' : ''}`} onClick={() => setActiveTab('export')}>Data Export</button>
      </div>

      <div className="backup-tab-content" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {activeTab === 'storage' && (
          <>
            {/* 1. Network Settings */}
            <SectionCard icon={<FaServer />} title="Network Storage" badge={networkSaved ? 'Linked' : null}>
            <div className="form-grid">
              <div className="input-group">
                <label>Protocol</label>
                <select className="backup-select" value={network.protocol} onChange={e => setNetwork(n => ({ ...n, protocol: e.target.value }))}>
                  <option>SMB</option>
                  <option>SFTP</option>
                </select>
              </div>
              <div className="input-group">
                <label>Host Address</label>
                <input type="text" className="backup-input" placeholder="192.168.1.1" value={network.ip} onChange={e => handleNetworkIpChange(e.target.value)} />
              </div>
              <div className="input-group">
                <label>Port</label>
                <input type="number" className="backup-input" value={network.port} onChange={e => setNetwork(n => ({ ...n, port: +e.target.value }))} />
              </div>
              <div className="input-group" style={{ gridColumn: 'span 2' }}>
                <label>Remote Path</label>
                <input type="text" className="backup-input" placeholder="\\host\share" value={network.path} onChange={e => setNetwork(n => ({ ...n, path: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn-secondary" style={{ padding: '6px 14px', fontSize: '15px', width: 'max-content' }} onClick={handleTestConnection} disabled={loading.test}>
                <FaBolt /> Test
              </button>
              <button className="btn-primary" style={{ padding: '6px 14px', fontSize: '15px', width: 'max-content' }} onClick={handleSaveNetwork} disabled={loading.saveNet}>
                Save Settings
              </button>
            </div>
          </SectionCard>

          {/* 3. Automatic Backup */}
          <SectionCard icon={<FaDatabase />} title="Automated Mirroring" enabled={autoEnabled} onToggle={handleAutoToggle} badge={status.auto_active ? 'Streaming' : null}>
          </SectionCard>
        </>
        )}

        {activeTab === 'export' && (
          <>
          {/* 2. Manual Backup */}
          <SectionCard icon={<FaHistory />} title="Data Export">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="input-group">
                  <label>Source Cameras</label>
                  <div className="camera-selector">
                    {cameras.map(c => (
                      <div key={c.id} className="cam-item">
                        <Toggle checked={manual.cameras.includes(c.ip)} onChange={() => toggleCamera(setManual, c.ip)} />
                        <span>{c.name || c.ip}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="form-grid">
                  <div className="input-group">
                    <label>Start</label>
                    <input type="date" className="backup-input" value={manual.start_date} onChange={e => setManual(m => ({ ...m, start_date: e.target.value }))} />
                  </div>
                  <div className="input-group">
                    <label>End</label>
                    <input type="date" className="backup-input" value={manual.end_date} onChange={e => setManual(m => ({ ...m, end_date: e.target.value }))} />
                  </div>
                </div>
                {status.status === 'Processing' && (
                  <div className="progress-container">
                    <div className="progress-header">
                      <span>Exporting...</span>
                      <span>{status.progress}%</span>
                    </div>
                    <div className="progress-bar-bg">
                      <div className="progress-bar-fill" style={{ width: `${status.progress}%` }} />
                    </div>
                  </div>
                )}
                <button className="btn-primary" style={{ padding: '6px 14px', fontSize: '15px', width: 'max-content', alignSelf: 'flex-end' }} onClick={handleManualClick} disabled={loading.manual || status.status === 'Processing'}>
                  <FaPlayCircle /> Export Records
                </button>
              </div>
          </SectionCard>
          </>
        )}

        {activeTab === 'retention' && (
          <>
          {/* 4. Retention */}
          <SectionCard icon={<FaHistory />} title="Retention Policy">
            <div className="input-group">
              <label style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                Group-Level Retention Rules
              </label>
              
              <div className="group-retention-table-wrap">
                <table className="group-retention-table">
                  <thead>
                    <tr>
                      <th>Camera Group</th>
                      <th style={{ textAlign: 'center' }}>Active Cameras</th>
                      <th style={{ textAlign: 'right' }}>Retention Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Default Group Row */}
                    <tr>
                      <td style={{ fontWeight: 600 }}>Default / Unassigned</td>
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        {devices.filter(d => !d.group_id || d.group_id === 'default').length} cams
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <select 
                          className="backup-select" 
                          style={{ width: '130px', display: 'inline-block', fontSize: '16px', padding: '4px 8px' }}
                          value={defaultRetention} 
                          onChange={e => updateGroupRetention('default', parseInt(e.target.value, 10))}
                        >
                          <option value={5}>5 Days</option>
                          <option value={10}>10 Days</option>
                          <option value={15}>15 Days</option>
                          <option value={30}>30 Days</option>
                          <option value={60}>60 Days</option>
                          <option value={120}>120 Days</option>
                        </select>
                      </td>
                    </tr>
                    
                    {/* Custom User Groups */}
                    {groups.map(g => {
                      const camCount = devices.filter(d => d.group_id === g.id).length;
                      return (
                        <tr key={g.id}>
                          <td style={{ fontWeight: 600 }}>{g.name}</td>
                          <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            {camCount} cam{camCount !== 1 ? 's' : ''}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <select 
                              className="backup-select" 
                              style={{ width: '130px', display: 'inline-block', fontSize: '16px', padding: '4px 8px' }}
                              value={g.retention_days ?? 5} 
                              onChange={e => updateGroupRetention(g.id, parseInt(e.target.value, 10))}
                            >
                              <option value={5}>5 Days</option>
                              <option value={10}>10 Days</option>
                              <option value={15}>15 Days</option>
                              <option value={30}>30 Days</option>
                              <option value={60}>60 Days</option>
                              <option value={120}>120 Days</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {retentionPreview && (
              <div className="help-box success" style={{ marginTop: 14, background: 'rgba(20, 184, 166, 0.08)', borderColor: 'var(--teal)' }}>
                <strong style={{ color: 'var(--teal)' }}>Preview Results:</strong> {retentionPreview.count} file(s) found exceeding group retention periods.
                {retentionPreview.count > 0 && (
                  <ul style={{ margin: '8px 0 0 16px', padding: 0, fontSize: '15px', color: 'var(--text-secondary)' }}>
                    {retentionPreview.files.map((f, idx) => (
                      <li key={idx} style={{ marginBottom: '4px' }}>
                        {f.file} ({f.camera}) - Modified: {f.modified}
                        {f.backed_up ? (
                          <span style={{ color: 'var(--teal)', marginLeft: 8, fontWeight: 600 }}>✓ Verified in Backup</span>
                        ) : (
                          <span style={{ color: 'var(--red)', marginLeft: 8, fontWeight: 600 }}>⚠️ Missing from Backup</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {retentionAlert && (
              <div className="help-box error" style={{ marginTop: 14, background: 'rgba(239, 68, 68, 0.08)', borderColor: 'var(--red)' }}>
                <strong style={{ color: 'var(--red)', display: 'block', marginBottom: '4px' }}>⚠️ Retention Halted:</strong>
                <span style={{ fontSize: '16px', color: 'var(--text-secondary)' }}>{retentionAlert.message}</span>
                {retentionAlert.missing && retentionAlert.missing.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>Files missing from network backup:</div>
                    <ul style={{ margin: '0 0 0 16px', padding: 0, fontSize: '15px', color: 'var(--text-secondary)' }}>
                      {retentionAlert.missing.map((f, idx) => (
                        <li key={idx} style={{ color: 'var(--text-secondary)' }}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Commented out as requested: Preview Purge & Enforce Now are no longer needed
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button className="btn-secondary" onClick={handleRetentionPreview} disabled={loading.retPrev}>Preview Purge</button>
              <button className="btn-primary" onClick={handleRetentionEnforce} disabled={loading.retain}>Enforce Now</button>
            </div>
            */}
            <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn-primary" style={{ padding: '6px 14px', fontSize: '15px', width: 'max-content' }} onClick={handleApplyRetention} disabled={loading.saveRetain}>Apply Retention Rules</button>
            </div>
          </SectionCard>

          {/* 5. Restore
          <SectionCard icon={<FaDownload />} title="Data Recovery">
            <div className="input-group">
              <label>Restore From Cameras</label>
              <div className="camera-selector">
                {cameras.map(c => (
                  <div key={c.id} className="cam-item">
                    <Toggle checked={restore.cameras.includes(c.ip)} onChange={() => toggleCamera(setRestore, c.ip)} />
                    <span>{c.name || c.ip}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="form-grid">
              <div className="input-group">
                <label>From Date</label>
                <input type="date" className="backup-input" value={restore.start_date} onChange={e => setRestore(r => ({ ...r, start_date: e.target.value }))} />
              </div>
              <div className="input-group">
                <label>To Date</label>
                <input type="date" className="backup-input" value={restore.end_date} onChange={e => setRestore(r => ({ ...r, end_date: e.target.value }))} />
              </div>
            </div>
            <button className="btn-primary" style={{ marginTop: 20 }} onClick={handleRestoreStart} disabled={loading.restore}>
              Start Restoration
            </button>
          </SectionCard>
          */}
          </>
        )}
      </div>

      {notification && (
        <div className={`notification-toast ${notification.type}`}>
          {notification.message}
        </div>
      )}
    </div>
  );
}