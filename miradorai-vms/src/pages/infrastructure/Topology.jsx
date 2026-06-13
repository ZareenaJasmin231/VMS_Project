import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactFlow, {
  addEdge, Background, Controls, MiniMap,
  useNodesState, useEdgesState, Panel, MarkerType, Handle, Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import './Topology.css';

const API_BASE = `http://${window.location.hostname}:80/api/infrastructure`;

const BW_SPIKE_THRESHOLD_MBPS = 80;

// ─── HIERARCHICAL LAYOUT ─────────────────────────────────────────────────────
const DEVICE_TIER = {
  'core-switch': 0,
  'switch':      1,
  'poe-switch':  1,
  'server':      2,
  'nvr':         2,
  'camera':      3,
  'unknown':     3,
};
const TIER_Y = [80, 240, 400, 560];
const H_GAP  = 200;
const V_GAP  = 160;

function autoLayout(nodes) {
  const needsLayout = nodes.filter(n => !n._hasPosition);
  if (needsLayout.length === 0) return nodes;

  const byTier = {};
  needsLayout.forEach(n => {
    const tier = DEVICE_TIER[n.data?.type] ?? 3;
    (byTier[tier] = byTier[tier] || []).push(n);
  });

  const positioned = new Map(nodes.filter(n => n._hasPosition).map(n => [n.id, n]));

  Object.entries(byTier).forEach(([tier, tierNodes]) => {
    const y = TIER_Y[+tier] ?? (TIER_Y[3] + (+tier - 3) * V_GAP);
    const startX = 100;
    tierNodes.forEach((n, i) => {
      positioned.set(n.id, { ...n, position: { x: startX + i * H_GAP, y } });
    });
  });

  return nodes.map(n => positioned.get(n.id) || n);
}

// ─── Icons ───────────────────────────────────────────────────────────────────
const Icon = ({ type, size = 20 }) => {
  const s = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2.5', width: size, height: size };
  switch (type) {
    case 'camera':      return <svg {...s}><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>;
    case 'switch':      return <svg {...s}><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01"/></svg>;
    case 'core-switch': return <svg {...s}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 11h.01M10 11h.01M14 11h.01M18 11h.01M6 15h.01M10 15h.01"/></svg>;
    case 'poe-switch':  return <svg {...s}><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 12h.01M10 12h.01M14 12h.01"/><path d="M18 9v6" strokeWidth="2"/><path d="M16 11l2-2 2 2"/></svg>;
    case 'nvr':         return <svg {...s}><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="19" cy="6" r="1" fill="currentColor"/><circle cx="19" cy="18" r="1" fill="currentColor"/></svg>;
    case 'server':      return <svg {...s}><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6" y2="6"/><line x1="6" y1="18" x2="6" y2="18"/></svg>;
    case 'alert':       return <svg {...s}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
    case 'bell':        return <svg {...s}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>;
    case 'wifi':        return <svg {...s}><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M5 12.55a11 11 0 0114.08 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/></svg>;
    case 'cpu':         return <svg {...s}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>;
    case 'disk':        return <svg {...s}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>;
    case 'activity':    return <svg {...s}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
    case 'power':       return <svg {...s}><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>;
    case 'video':       return <svg {...s}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>;
    case 'zap':         return <svg {...s}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
    case 'check':       return <svg {...s}><polyline points="20 6 9 17 4 12"/></svg>;
    case 'refresh':     return <svg {...s}><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>;
    case 'email':       return <svg {...s}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
    case 'x':           return <svg {...s}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
    case 'template':    return <svg {...s}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M21 9H3M21 15H3M12 3v18"/></svg>;
    default:            return <svg {...s}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>;
  }
};

const statusColor     = (s) => ({ online: '#10b981', offline: '#ef4444', degraded: '#f59e0b' }[s] || '#6b7280');
const packetLossColor = (pct) => {
  if (pct == null) return '#6b7280';
  if (pct < 1)    return '#10b981';
  if (pct < 5)    return '#f59e0b';
  return '#ef4444';
};
const deviceTypeLabel = (type) => ({
  'core-switch': 'Core Switch', 'poe-switch': 'PoE Switch',
  'nvr': 'NVR', 'camera': 'Camera', 'server': 'Server', 'switch': 'Switch',
}[type] || type || 'Device');

// ─── Custom Topology Node ─────────────────────────────────────────────────────
const CustomNode = ({ data }) => (
  <div className={`topo-node topo-node--${data.status} topo-node-type--${data.type}`}
       style={{ borderColor: statusColor(data.status), position: 'relative' }}>
    <Handle type="target" position={Position.Top} style={{ background: '#555' }} />
    
    {/* Remove button */}
    {data.onRemove && (
      <button 
        onClick={(e) => {
          e.stopPropagation(); // Prevent opening node sidebar details
          data.onRemove();
        }}
        style={{
          position: 'absolute',
          top: -7,
          right: -7,
          background: '#ef4444',
          border: '1px solid #7f1d1d',
          color: '#fff',
          borderRadius: '50%',
          width: 17,
          height: 17,
          fontSize: 14,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
          zIndex: 1000,
          transition: 'all 0.1s'
        }}
        title="Remove from Canvas"
      >
        ×
      </button>
    )}

    <div className="topo-node__pulse" style={{ backgroundColor: statusColor(data.status), marginRight: data.onRemove ? 10 : 0 }} />
    <div className="topo-node__header">
      <div className="topo-node__icon-wrapper"><Icon type={data.type} /></div>
      <div className="topo-node__title">
        <span className="topo-node__ip">{data.ip}</span>
        <span className="topo-node__label">{deviceTypeLabel(data.type)}</span>
      </div>
    </div>
    <div className="topo-node__body">
      <span className="topo-node__model">{data.model || 'Device'}</span>
      {data.latency != null && <span className="topo-node__latency">{Math.round(data.latency)}ms</span>}
    </div>
    {data.poe_power && (
      <div className="topo-node__poe">
        <Icon type="zap" size={10}/> {data.poe_power.used}W / {data.poe_power.total}W
      </div>
    )}
    {data.stream_bitrate_mbps != null && (
      <div className="topo-node__stream">{data.stream_bitrate_mbps} Mbps</div>
    )}
    <Handle type="source" position={Position.Bottom} style={{ background: '#555' }} />
  </div>
);

const nodeTypes = { custom: CustomNode };

const MetricCard = ({ icon, label, value, unit, percent, color, sub }) => (
  <div className="metric-card">
    <div className="metric-card__icon" style={{ color }}><Icon type={icon} size={16} /></div>
    <div className="metric-card__body">
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}<span className="metric-card__unit">{unit}</span></div>
      {sub && <div className="metric-card__sub">{sub}</div>}
      {percent !== undefined && (
        <div className="metric-bar">
          <div className="metric-bar__fill" style={{ width: `${Math.min(percent, 100)}%`, background: color }} />
        </div>
      )}
    </div>
  </div>
);

// ─── BELL ALERT POPUP (replaces AlertBanner) ──────────────────────────────────
const BellAlertButton = ({ alerts, onAck }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const unreadCount = alerts.length;

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const severityColor = (sev) => ({ critical: '#ef4444', warning: '#f59e0b', info: '#60a5fa' }[sev] || '#ef4444');
  const severityBg    = (sev) => ({ critical: 'rgba(239,68,68,0.08)', warning: 'rgba(245,158,11,0.08)', info: 'rgba(96,165,250,0.08)' }[sev] || 'rgba(239,68,68,0.08)');

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Bell Button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'relative',
          background: open ? 'rgba(99,102,241,0.15)' : 'rgba(17,24,39,0.85)',
          border: `1px solid ${open ? '#6366f1' : '#374151'}`,
          borderRadius: 10,
          color: unreadCount > 0 ? '#f59e0b' : '#9ca3af',
          cursor: 'pointer',
          width: 38,
          height: 38,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(8px)',
          transition: 'all 0.2s',
          boxShadow: unreadCount > 0 ? '0 0 0 2px rgba(245,158,11,0.25)' : 'none',
        }}
        title={`${unreadCount} alert${unreadCount !== 1 ? 's' : ''}`}
      >
        <Icon type="bell" size={17} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: -5, right: -5,
            background: '#ef4444',
            color: '#fff',
            borderRadius: '50%',
            minWidth: 18,
            height: 18,
            fontSize: 14,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
            border: '2px solid #111827',
            lineHeight: 1,
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Popup */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 46,
          right: 0,
          width: 360,
          maxHeight: 480,
          background: '#111827',
          border: '1px solid #1f2937',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Popup header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #1f2937',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon type="bell" size={14} />
              <span style={{ color: '#e5e7eb', fontWeight: 600, fontSize: 17 }}>Alerts</span>
              {unreadCount > 0 && (
                <span style={{
                  background: '#ef4444',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '1px 7px',
                  fontSize: 14,
                  fontWeight: 700,
                }}>
                  {unreadCount}
                </span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', color: "rgba(255, 255, 255, 0.5)", cursor: 'pointer', padding: 2 }}
            >
              <Icon type="x" size={14} />
            </button>
          </div>

          {/* Alert list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {alerts.length === 0 ? (
              <div style={{
                padding: 32,
                textAlign: 'center',
                color: "rgba(255, 255, 255, 0.5)",
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
              }}>
                <Icon type="check" size={28} />
                <span style={{ fontSize: 17 }}>No active alerts</span>
              </div>
            ) : (
              alerts.map((a, i) => {
                const sev = a.severity || 'warning';
                return (
                  <div key={i} style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid #1a2332',
                    borderLeft: `3px solid ${severityColor(sev)}`,
                    background: severityBg(sev),
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                  }}>
                    <div style={{ color: severityColor(sev), marginTop: 1, flexShrink: 0 }}>
                      <Icon type="alert" size={13} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        color: severityColor(sev),
                        fontSize: 13,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        marginBottom: 3,
                      }}>
                        {sev.toUpperCase()}
                      </div>
                      <div style={{
                        color: '#d1d5db',
                        fontSize: 15,
                        lineHeight: 1.45,
                        wordBreak: 'break-word',
                        marginBottom: 4,
                      }}>
                        {a.message}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: "rgba(255, 255, 255, 0.5)", fontSize: 14 }}>
                        {a.ip && <span>{a.ip}</span>}
                        <span>{new Date(a.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => onAck(a.node_id)}
                      style={{
                        flexShrink: 0,
                        background: 'rgba(99,102,241,0.15)',
                        border: '1px solid rgba(99,102,241,0.3)',
                        borderRadius: 6,
                        color: '#818cf8',
                        cursor: 'pointer',
                        fontSize: 14,
                        fontWeight: 600,
                        padding: '3px 8px',
                        letterSpacing: '0.04em',
                      }}
                    >
                      ACK
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {alerts.length > 0 && (
            <div style={{
              padding: '8px 14px',
              borderTop: '1px solid #1f2937',
              display: 'flex',
              justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => { alerts.forEach(a => onAck(a.node_id)); }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#6366f1',
                  cursor: 'pointer',
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                Acknowledge All
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const SwitchPortTable = ({ ports }) => {
  if (!ports || ports.length === 0) return <p className="empty-msg">No switch port data</p>;
  return (
    <div className="port-table">
      <div className="port-table__header">
        <span>Port</span><span>Status</span><span>Speed</span><span>PoE(W)</span><span>Device</span>
      </div>
      {ports.map((p, i) => (
        <div key={i} className="port-table__row">
          <span className="port-name">{p.port}</span>
          <span className={`port-status ${p.status === 'up' ? 'port-up' : 'port-dn'}`}>
            {p.status === 'up' ? '▲ UP' : '▼ DN'}
          </span>
          <span className="port-speed">{p.speed || '—'}</span>
          <span className="port-poe" style={{ color: p.poe_watts > 0 ? '#f59e0b' : '#4b5563' }}>
            {p.poe_watts != null ? p.poe_watts : '—'}
          </span>
          <span className="port-device">{p.connected_device || '—'}</span>
        </div>
      ))}
      <div className="port-hint">
        <Icon type="zap" size={10}/> <i>Real-time port monitoring requires SNMPv2 support.</i>
      </div>
    </div>
  );
};

const NetworkPerfTable = ({ diagnostics, filterIp }) => {
  if (!diagnostics?.devices) return null;
  const rows = filterIp
    ? diagnostics.devices.filter(d => d.ip === filterIp)
    : diagnostics.devices;

  if (rows.length === 0)
    return <p className="empty-msg">No diagnostic data for this device yet.</p>;

  return (
    <div className="perf-table">
      <div className="perf-table__header">
        <span>Device</span><span>Latency</span><span>PktLoss</span>
        <span>RTSP</span><span>HTTP</span><span>ONVIF</span><span>Status</span>
      </div>
      {rows.map((d, i) => (
        <div key={i} className="perf-table__row perf-row--selected">
          <span className="perf-name">{d.name || d.ip}</span>
          <span className="perf-latency">{d.latency != null ? `${d.latency}ms` : '—'}</span>
          <span style={{ color: packetLossColor(d.packet_loss), fontSize: '14px', textAlign: 'center' }}>
            {d.packet_loss != null ? `${d.packet_loss}%` : '—'}
          </span>
          <span className={`perf-port ${d.ports?.rtsp  ? 'port-up' : 'port-dn'}`}>{d.ports?.rtsp  ? '●' : '○'}</span>
          <span className={`perf-port ${d.ports?.http  ? 'port-up' : 'port-dn'}`}>{d.ports?.http  ? '●' : '○'}</span>
          <span className={`perf-port ${d.ports?.onvif ? 'port-up' : 'port-dn'}`}>{d.ports?.onvif ? '●' : '○'}</span>
          <span className={`perf-status status--${d.status?.toLowerCase()}`}>{d.status}</span>
        </div>
      ))}
    </div>
  );
};

const Sparkline = ({ data, color, height = 36, width = 140 }) => {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
};

const NVRPanel = ({ d }) => (
  <div className="nvr-panel">
    <div className="nvr-panel__title"><Icon type="nvr" size={14}/> NVR Status</div>
    <div className="nvr-grid">
      <div className="nvr-stat"><span className="nvr-label">Connected</span>
        <span className={`nvr-val ${d.nvr_connected ? 'txt-green' : 'txt-red'}`}>{d.nvr_connected ? '✓ YES' : '✗ NO'}</span>
      </div>
      <div className="nvr-stat"><span className="nvr-label">Recording</span>
        <span className={`nvr-val ${d.recording_status === 'active' ? 'txt-green' : 'txt-red'}`}>{d.recording_status || 'Unknown'}</span>
      </div>
      <div className="nvr-stat"><span className="nvr-label">Storage</span>
        <span className="nvr-val">{d.storage_usage != null ? `${d.storage_usage}%` : '—'}</span>
      </div>
    </div>
    {d.storage_usage != null && (
      <div className="metric-bar" style={{ marginTop: 6 }}>
        <div className="metric-bar__fill" style={{
          width: `${d.storage_usage}%`,
          background: d.storage_usage > 85 ? '#ef4444' : d.storage_usage > 70 ? '#f59e0b' : '#10b981'
        }}/>
      </div>
    )}
  </div>
);

const CameraStreamPanel = ({ d, liveData, isRefreshing, onRefresh }) => {
  const cam = liveData ? { ...d, ...liveData } : d;

  const hasAnyStreamData =
    cam.stream_bitrate_mbps != null ||
    cam.stream_fps          != null ||
    cam.stream_status       != null ||
    cam.stream_resolution   != null ||
    cam.codec               != null ||
    cam.dropped_frames      != null;

  return (
    <div className="stream-panel">
      <div className="stream-panel__title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span><Icon type="video" size={14}/> Stream Health</span>
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Refresh stream data"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: isRefreshing ? '#4b5563' : '#6366f1', padding: '2px 4px',
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 14
          }}>
          <Icon type="refresh" size={12}/>
          {isRefreshing ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {!hasAnyStreamData && !isRefreshing && (
        <div style={{
          background: '#1f2937', borderRadius: 6, padding: '8px 10px',
          color: "rgba(255, 255, 255, 0.5)", fontSize: 14, marginBottom: 8,
          border: '1px solid #374151', display: 'flex', alignItems: 'center', gap: 6
        }}>
          <Icon type="alert" size={12}/>
          Stream data not yet polled. Click Refresh or wait for the next cycle.
        </div>
      )}

      <div className="stream-grid">
        <div className="stream-stat">
          <span className="stream-label">Bitrate</span>
          <span className="stream-val" style={{ color: cam.stream_bitrate_mbps != null ? '#e5e7eb' : '#4b5563' }}>
            {cam.stream_bitrate_mbps != null ? `${cam.stream_bitrate_mbps} Mbps` : '—'}
          </span>
        </div>
        <div className="stream-stat">
          <span className="stream-label">FPS</span>
          <span className="stream-val" style={{ color: cam.stream_fps != null ? '#e5e7eb' : '#4b5563' }}>
            {cam.stream_fps != null ? cam.stream_fps : '—'}
          </span>
        </div>
        <div className="stream-stat">
          <span className="stream-label">Status</span>
          <span className={`stream-val ${cam.stream_status === 'healthy' ? 'txt-green' : cam.stream_status ? 'txt-red' : ''}`}
                style={{ color: !cam.stream_status ? '#4b5563' : undefined }}>
            {cam.stream_status || '—'}
          </span>
        </div>
        <div className="stream-stat">
          <span className="stream-label">Resolution</span>
          <span className="stream-val" style={{ color: cam.stream_resolution != null ? '#e5e7eb' : '#4b5563' }}>
            {cam.stream_resolution || '—'}
          </span>
        </div>
        <div className="stream-stat">
          <span className="stream-label">Codec</span>
          <span className="stream-val" style={{ color: cam.codec != null ? '#e5e7eb' : '#4b5563' }}>
            {cam.codec || '—'}
          </span>
        </div>
        <div className="stream-stat">
          <span className="stream-label">Dropped Frames</span>
          <span className={`stream-val ${cam.dropped_frames > 0 ? 'txt-yellow' : cam.dropped_frames === 0 ? 'txt-green' : ''}`}
                style={{ color: cam.dropped_frames == null ? '#4b5563' : undefined }}>
            {cam.dropped_frames != null ? cam.dropped_frames : '—'}
          </span>
        </div>
      </div>

      <div className="stream-flags">
        <span className={`stream-flag ${cam.rtsp_connected == null ? 'flag-unknown' : cam.rtsp_connected ? 'flag-ok' : 'flag-err'}`}
          title={cam.rtsp_connected == null ? 'Not yet checked' : cam.rtsp_connected ? 'Connected' : 'Disconnected'}>
          RTSP{cam.rtsp_connected == null ? ' ?' : ''}
        </span>
        <span className={`stream-flag ${cam.onvif_connected == null ? 'flag-unknown' : cam.onvif_connected ? 'flag-ok' : 'flag-err'}`}
          title={cam.onvif_connected == null ? 'Not yet checked' : cam.onvif_connected ? 'Connected' : 'Disconnected'}>
          ONVIF{cam.onvif_connected == null ? ' ?' : ''}
        </span>
        <span className={`stream-flag ${cam.recording == null ? 'flag-unknown' : cam.recording ? 'flag-ok' : 'flag-err'}`}
          title={cam.recording == null ? 'Not yet checked' : cam.recording ? 'Recording' : 'Not recording'}>
          REC{cam.recording == null ? ' ?' : ''}
        </span>
      </div>

      {(cam.onvif_url || cam.rtsp_url) && (
        <div style={{ marginTop: 8 }}>
          {cam.onvif_url && (
            <div className="detail-row" style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.5)" }}>
              <label>ONVIF URL</label><span style={{ wordBreak: 'break-all' }}>{cam.onvif_url}</span>
            </div>
          )}
          {cam.rtsp_url && (
            <div className="detail-row" style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.5)" }}>
              <label>RTSP URL</label><span style={{ wordBreak: 'break-all' }}>{cam.rtsp_url}</span>
            </div>
          )}
        </div>
      )}

      {cam.stream_last_polled && (
        <div style={{ marginTop: 6, fontSize: 13, color: "rgba(255, 255, 255, 0.5)", textAlign: 'right' }}>
          Last polled: {new Date(cam.stream_last_polled).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
};

const PoEPanel = ({ d }) => {
  if (!d.poe_power) return null;
  const { used, total } = d.poe_power;
  const pct = total > 0 ? (used / total) * 100 : 0;
  return (
    <div className="poe-panel">
      <div className="poe-panel__title"><Icon type="zap" size={14}/> PoE Power</div>
      <div className="poe-summary">
        <span className="poe-used">{used}W</span><span className="poe-sep"> / </span>
        <span className="poe-total">{total}W</span><span className="poe-pct">({pct.toFixed(0)}%)</span>
      </div>
      <div className="metric-bar">
        <div className="metric-bar__fill" style={{ width: `${pct}%`, background: pct > 85 ? '#ef4444' : '#f59e0b' }}/>
      </div>
    </div>
  );
};

const normalizeNodeType = (node) => {
  if (!node) return node;
  const type = node.type;
  if (type === 'web_device') return node;
  
  const modelLower = (node.model || '').toLowerCase();
  const manufacturerLower = (node.manufacturer || '').toLowerCase();
  const labelLower = (node.label || '').toLowerCase();
  const idLower = (node.id || '').toLowerCase();
  const ip = node.ip || '';
  
  if (
    modelLower.includes('pc box') || 
    modelLower.includes('vms host') || 
    modelLower.includes('pc-box') ||
    modelLower.includes('host') ||
    modelLower.includes('server') ||
    modelLower.includes('computer') ||
    modelLower.includes('workstation') ||
    (modelLower.includes('pc') && !modelLower.includes('ipc')) ||
    manufacturerLower.includes('pc box') ||
    manufacturerLower.includes('vms host') ||
    (manufacturerLower.includes('pc') && !manufacturerLower.includes('ipc')) ||
    labelLower.includes('pc box') ||
    labelLower.includes('vms host') ||
    (labelLower.includes('pc') && !labelLower.includes('ipc')) ||
    idLower.includes('host') ||
    ip === '172.19.0.6' ||
    ip.startsWith('172.') ||
    ip === window.location.hostname
  ) {
    return { ...node, type: 'server' };
  }
  return node;
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Topology() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [scannedNodes, setScannedNodes]   = useState([]); // Store ALL scanned nodes from backend!
  const [scanning, setScanning]         = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [metrics, setMetrics]           = useState(null);
  const [alerts, setAlerts]             = useState([]);
  const [diagnostics, setDiagnostics]   = useState(null);
  const [bwHistory, setBwHistory]       = useState([]);
  const [activeTab, setActiveTab]       = useState('details');
  const [sidebarOpen, setSidebarOpen]   = useState(false);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false });

  const [templatesDropdownOpen, setTemplatesDropdownOpen] = useState(false);
  const templatesDropdownRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (templatesDropdownRef.current && !templatesDropdownRef.current.contains(e.target)) {
        setTemplatesDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ─── Filter state: null = show all, string = active filter ───────────────
  const [statusFilter, setStatusFilter]   = useState(null); // 'online'|'offline'|'degraded'
  const [typeFilter, setTypeFilter]       = useState(null); // 'camera'|'server'|'switch'|etc.

  const [deviceLiveData, setDeviceLiveData]     = useState(null);
  const [deviceRefreshing, setDeviceRefreshing] = useState(false);

  // ─── Search and Accordion group states ───
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({ online: true, degraded: true, offline: true });

  const toggleGroup = (group) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  const wsRef       = useRef(null);
  const prevUptimes = useRef({});
  const prevBwRef   = useRef({});

  // ─── Computed: nodes visible on canvas based on active filters ────────────
  // Placed nodes on the canvas always retain and do not hide under filters
  const visibleNodes = nodes;

  // ─── Toggle helpers ───────────────────────────────────────────────────────
  const toggleStatusFilter = (status) => {
    setStatusFilter(prev => prev === status ? null : status);
    setTypeFilter(null);
  };
  const toggleTypeFilter = (type) => {
    setTypeFilter(prev => prev === type ? null : type);
    setStatusFilter(null);
  };

  const fetchDeviceLiveData = useCallback(async (node) => {
    if (!node) return;
    setDeviceRefreshing(true);
    try {
      const r = await fetch(`${API_BASE}/topology`);
      if (!r.ok) return;
      const data = await r.json();
      if (!data?.nodes) return;
      const nodeData =
        data.nodes.find(n => n.id === node.id) ||
        data.nodes.find(n => n.ip === node.data?.ip) ||
        null;
      if (nodeData) {
        setDeviceLiveData(nodeData);
        setNodes(nds => nds.map(n =>
          n.id === node.id ? { ...n, data: { ...n.data, ...nodeData, onRemove: n.data.onRemove } } : n
        ));
      }
    } catch (err) {
      console.error('[DeviceFetch] Failed:', err);
    } finally {
      setDeviceRefreshing(false);
    }
  }, [setNodes]);

  const checkBandwidthSpike = useCallback((bwData) => {
    if (!bwData) return;
    const sentMbps = (bwData.sent_kbps || 0) / 1024;
    const recvMbps = (bwData.recv_kbps || 0) / 1024;
    const prev = prevBwRef.current['global'] || {};
    if (!prev.alerted && (sentMbps > BW_SPIKE_THRESHOLD_MBPS || recvMbps > BW_SPIKE_THRESHOLD_MBPS)) {
      setAlerts(p => [{
        node_id: 'bandwidth-spike', severity: 'warning',
        message: `High bandwidth spike detected! ${sentMbps > BW_SPIKE_THRESHOLD_MBPS ? '↑TX' : '↓RX'} ${Math.max(sentMbps, recvMbps).toFixed(1)} Mbps (threshold: ${BW_SPIKE_THRESHOLD_MBPS} Mbps)`,
        timestamp: new Date().toISOString(), ip: 'Network'
      }, ...p]);
      prevBwRef.current['global'] = { alerted: true };
    } else if (sentMbps < BW_SPIKE_THRESHOLD_MBPS && recvMbps < BW_SPIKE_THRESHOLD_MBPS) {
      prevBwRef.current['global'] = { alerted: false };
    }
  }, []);

  const checkUnexpectedReboot = useCallback((nodeId, newData) => {
    if (!newData.uptime) return;
    const parseUptimeSeconds = (str) => {
      if (!str) return null;
      let secs = 0;
      const d = str.match(/(\d+)\s*d/); if (d) secs += parseInt(d[1]) * 86400;
      const h = str.match(/(\d+)\s*h/); if (h) secs += parseInt(h[1]) * 3600;
      const m = str.match(/(\d+)\s*m/); if (m) secs += parseInt(m[1]) * 60;
      return secs;
    };
    const newSecs  = parseUptimeSeconds(newData.uptime);
    const prevSecs = parseUptimeSeconds(prevUptimes.current[nodeId]);
    if (prevSecs != null && newSecs != null && newSecs < prevSecs - 60) {
      setAlerts(p => [{
        node_id: nodeId, severity: 'critical',
        message: `Device ${newData.ip || nodeId} rebooted unexpectedly! Reason: ${newData.reboot_reason || 'Unknown'}`,
        timestamp: new Date().toISOString(), ip: newData.ip || nodeId
      }, ...p]);
    }
    prevUptimes.current[nodeId] = newData.uptime;
  }, []);

  // ─── Canvas Removal Action ────────────────────────────────────────────────
  const removeNodeFromCanvas = useCallback(async (nodeId) => {
    try {
      await fetch(`${API_BASE}/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: null })
      });
      
      // Clear connected edges
      const connectedEdges = edges.filter(e => e.source === nodeId || e.target === nodeId);
      await Promise.all(connectedEdges.map(e => 
        fetch(`${API_BASE}/edges?source=${e.source}&target=${e.target}`, {
          method: 'DELETE'
        })
      ));

      setNodes(nds => nds.filter(n => n.id !== nodeId));
      setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
      setScannedNodes(snd => snd.map(n => n.id === nodeId ? { ...n, position: null } : n));
    } catch (err) {
      console.error("Failed to remove node from canvas:", err);
    }
  }, [edges, setNodes, setEdges]);

  const fetchTopology = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/topology`);
      const data = await res.json();
      if (!data?.nodes) return;

      const seen = new Map();
      data.nodes.forEach(n => {
        if (n.type !== 'web_device') {
          const norm = normalizeNodeType(n);
          seen.set(norm.id, norm);
        }
      });
      const uniqueNodes = Array.from(seen.values());

      setScannedNodes(uniqueNodes);

      const placedNodes = uniqueNodes.filter(n => n.position && typeof n.position.x === 'number' && typeof n.position.y === 'number');

      const reactNodes = placedNodes.map(n => ({
        id: n.id,
        type: 'custom',
        _hasPosition: true,
        position: n.position,
        data: { 
          ...n, 
          onRemove: () => removeNodeFromCanvas(n.id)
        }
      }));

      setNodes(reactNodes);

      const edgeSeen = new Set();
      const uniqueEdges = (data.edges || []).filter(e => {
        const key = `${e.source}|${e.target}`;
        if (edgeSeen.has(key)) return false;
        edgeSeen.add(key);
        return true;
      });

      setEdges(uniqueEdges.map((e, idx) => {
        const targetNode = uniqueNodes.find(n => n.id === e.target);
        const targetType = targetNode?.type;
        
        let strokeColor = '#818cf8'; // Neon Indigo default
        let strokeWidth = 2;
        
        if (targetType === 'camera') {
          strokeColor = '#10b981'; // Neon Green
        } else if (targetType === 'server' || targetType === 'nvr') {
          strokeColor = '#3b82f6'; // Neon Blue
          strokeWidth = 2.5;
        } else if (targetType === 'switch' || targetType === 'poe-switch' || targetType === 'core-switch') {
          strokeColor = '#f59e0b'; // Neon Amber
          strokeWidth = 2.5;
        }

        const isCameraTarget = targetType === 'camera';

        return {
          id: `e-${idx}`, 
          source: e.source, 
          target: e.target,
          animated: true, // Make ALL lines animated and alive!
          label: e.port_label || '',
          type: 'smoothstep', // Clean orthogonal step layout
          style: { 
            stroke: strokeColor, 
            strokeWidth: strokeWidth,
            filter: `drop-shadow(0px 0px 3px ${strokeColor}66)` // Neon glowing drop-shadow
          },
          ...(isCameraTarget ? {
            markerStart: {
              type: MarkerType.ArrowClosed,
              color: strokeColor
            }
          } : {
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: strokeColor
            }
          })
        };
      }));
    } catch (err) { console.error('Topology fetch failed:', err); }
  }, [setNodes, setEdges, removeNodeFromCanvas]);

  const fetchMetrics = useCallback(async () => {
    try {
      const r    = await fetch(`${API_BASE}/metrics`);
      const data = await r.json();
      setMetrics(data);
    } catch {}
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/alerts?unacknowledged_only=true`);
      const d = await r.json();
      setAlerts(Array.isArray(d) ? d : []);
    } catch {}
  }, []);

  const fetchBandwidth = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/bandwidth`);
      const d = await r.json();
      setBwHistory(Array.isArray(d) ? d.reverse() : []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchTopology(); fetchMetrics(); fetchAlerts(); fetchBandwidth();
    const intervalMetrics = setInterval(fetchMetrics, 10000);
    const intervalTopo = setInterval(fetchTopology, 2000);
    const intervalAlerts = setInterval(fetchAlerts, 5000);
    const intervalBw = setInterval(fetchBandwidth, 2000);
    return () => {
      clearInterval(intervalMetrics);
      clearInterval(intervalTopo);
      clearInterval(intervalAlerts);
      clearInterval(intervalBw);
    };
  }, [fetchTopology, fetchMetrics, fetchAlerts, fetchBandwidth]);

  // Keep selectedNode data in sync when nodes refresh
  useEffect(() => {
    if (!selectedNode) return;
    const updated = nodes.find(n => n.id === selectedNode.id);
    if (updated && updated.data !== selectedNode.data) setSelectedNode(updated);
  }, [nodes, selectedNode]);

  const onNodeDragStop = useCallback((_, node) => {
    fetch(`${API_BASE}/nodes/${node.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: node.position })
    });
  }, []);

  const onConnect = useCallback((params) => {
    const targetNode = scannedNodes.find(n => n.id === params.target);
    const targetType = targetNode?.type;
    
    let strokeColor = '#818cf8'; // Neon Indigo default
    let strokeWidth = 2;
    
    if (targetType === 'camera') {
      strokeColor = '#10b981'; // Neon Green
    } else if (targetType === 'server' || targetType === 'nvr') {
      strokeColor = '#3b82f6'; // Neon Blue
      strokeWidth = 2.5;
    } else if (targetType === 'switch' || targetType === 'poe-switch' || targetType === 'core-switch') {
      strokeColor = '#f59e0b'; // Neon Amber
      strokeWidth = 2.5;
    }

    const isCameraTarget = targetType === 'camera';

    const customEdge = {
      ...params,
      id: `e-${Date.now()}`,
      animated: true,
      type: 'smoothstep',
      style: { 
        stroke: strokeColor, 
        strokeWidth: strokeWidth,
        filter: `drop-shadow(0px 0px 3px ${strokeColor}66)`
      },
      ...(isCameraTarget ? {
        markerStart: {
          type: MarkerType.ArrowClosed,
          color: strokeColor
        }
      } : {
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor
        }
      })
    };

    setEdges(eds => addEdge(customEdge, eds));
    fetch(`${API_BASE}/edges`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: params.source, target: params.target })
    });
  // }, [setEdges]);
    }, [setEdges, scannedNodes]);


  const handleNodeClick = useCallback((_, node) => {
    setSelectedNode(node);
    setActiveTab('details');
    setSidebarOpen(true);
    setDeviceLiveData(null);
    if (node.data?.type === 'camera' && node.data?.ip) {
      fetch(`${API_BASE}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: node.data.ip })
      }).catch(() => {});
      fetchDeviceLiveData(node);
      setTimeout(() => fetchDeviceLiveData(node), 3000);
    } else {
      fetchDeviceLiveData(node);
    }
  }, [fetchDeviceLiveData]);

  const closeSidebar = useCallback(() => {
    setSelectedNode(null);
    setSidebarOpen(false);
    setDeviceLiveData(null);
  }, []);

  const triggerScan   = async () => { setScanning(true); try { await fetch(`${API_BASE}/scan`, { method: 'POST' }); } catch {} finally { setScanning(false); } };
  const savePositions = async () => { await Promise.all(nodes.map(n => fetch(`${API_BASE}/nodes/${n.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: n.position }) }))); };
  const ackAlert      = async (nodeId) => { await fetch(`${API_BASE}/alerts/${nodeId}/acknowledge`, { method: 'POST' }); setAlerts(prev => prev.filter(a => a.node_id !== nodeId)); };
  const onDragStart   = (e, nd) => { e.dataTransfer.setData('application/reactflow', JSON.stringify(nd)); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver    = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  
  const onDrop        = useCallback((e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/reactflow');
    if (!raw) return;
    const nd = JSON.parse(raw);
    if (nodes.find(n => n.id === nd.id)) return;
    const bounds   = e.target.getBoundingClientRect();
    const position = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
    setNodes(nds => nds.concat({ 
      id: nd.id, 
      type: 'custom', 
      position, 
      data: { 
        ...nd, 
        onRemove: () => removeNodeFromCanvas(nd.id) 
      } 
    }));
    setScannedNodes(snd => snd.map(n => n.id === nd.id ? { ...n, position } : n));
    fetch(`${API_BASE}/nodes/${nd.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position }) });
  }, [nodes, setNodes, removeNodeFromCanvas]);

  // ─── Topology Template Design Actions ─────────────────────────────────────
  const placeAllDevices = useCallback(async () => {
    if (scannedNodes.length === 0) return;
    setScanning(true);
    try {
      const gap = 180;
      const cols = Math.ceil(Math.sqrt(scannedNodes.length));
      await Promise.all(
        scannedNodes.map((node, idx) => {
          const row = Math.floor(idx / cols);
          const col = idx % cols;
          return fetch(`${API_BASE}/nodes/${node.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              position: {
                x: 100 + col * gap,
                y: 100 + row * gap
              }
            })
          });
        })
      );
      await fetchTopology();
    } catch (err) {
      console.error("Failed to place all devices:", err);
    } finally {
      setScanning(false);
    }
  }, [scannedNodes, fetchTopology]);

  const resetWorkspace = useCallback(() => {
    setConfirmModal({
      isOpen: true,
      title: 'Clear Canvas',
      message: "Are you sure you want to clear the canvas? This will remove all devices from the topology and delete all links.",
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setScanning(true);
        try {
          await fetch(`${API_BASE}/reset`, { method: 'POST' });
          await fetchTopology();
          setSelectedNode(null);
          setSidebarOpen(false);
        } catch (err) {
          console.error("Failed to reset workspace:", err);
        } finally {
          setScanning(false);
        }
      },
      onCancel: () => setConfirmModal(prev => ({ ...prev, isOpen: false }))
    });
  }, [fetchTopology]);

  const applyTopologyTemplate = useCallback(async (templateType) => {
    setStatusFilter(null);
    setTypeFilter(null);
    let nodesToArrange = nodes.map(n => n.data);
    if (nodesToArrange.length === 0) {
      if (scannedNodes.length === 0) {
        alert("No scanned devices available. Please scan the network first.");
        return;
      }
      nodesToArrange = scannedNodes;
    }

    const N = nodesToArrange.length;
    if (N === 0) return;

    setScanning(true);

    try {
      const newPositions = {};
      const newEdges = [];

      if (templateType === 'star') {
        let hub = nodesToArrange.find(n => n.type === 'core-switch') ||
                  nodesToArrange.find(n => n.type === 'switch' || n.type === 'poe-switch') ||
                  nodesToArrange.find(n => n.type === 'server') ||
                  nodesToArrange[0];
        
        const hubId = hub.id;
        newPositions[hubId] = { x: 400, y: 300 };

        const spokes = nodesToArrange.filter(n => n.id !== hubId);
        const numSpokes = spokes.length;

        spokes.forEach((spoke, idx) => {
          const angle = (idx * 2 * Math.PI) / numSpokes;
          newPositions[spoke.id] = {
            x: Math.round(400 + 260 * Math.cos(angle)),
            y: Math.round(300 + 260 * Math.sin(angle))
          };
          newEdges.push({ source: hubId, target: spoke.id, type: 'default', inferred: false });
        });
      } else if (templateType === 'ring') {
        nodesToArrange.forEach((node, idx) => {
          const angle = (idx * 2 * Math.PI) / N;
          newPositions[node.id] = {
            x: Math.round(400 + 250 * Math.cos(angle)),
            y: Math.round(300 + 250 * Math.sin(angle))
          };
          const nextNode = nodesToArrange[(idx + 1) % N];
          newEdges.push({ source: node.id, target: nextNode.id, type: 'default', inferred: false });
        });
      } else if (templateType === 'bus') {
        const gap = 180;
        const startX = 400 - ((N - 1) * gap) / 2;
        nodesToArrange.forEach((node, idx) => {
          newPositions[node.id] = {
            x: Math.round(startX + idx * gap),
            y: 300
          };
          if (idx < N - 1) {
            const nextNode = nodesToArrange[idx + 1];
            newEdges.push({ source: node.id, target: nextNode.id, type: 'default', inferred: false });
          }
        });
      } else if (templateType === 'mesh') {
        nodesToArrange.forEach((node, idx) => {
          const angle = (idx * 2 * Math.PI) / N;
          newPositions[node.id] = {
            x: Math.round(400 + 250 * Math.cos(angle)),
            y: Math.round(300 + 250 * Math.sin(angle))
          };
        });
        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            newEdges.push({
              source: nodesToArrange[i].id,
              target: nodesToArrange[j].id,
              type: 'default',
              inferred: false
            });
          }
        }
      } else if (templateType === 'tree') {
        const byTier = {};
        nodesToArrange.forEach(n => {
          const tier = DEVICE_TIER[n.type] ?? 3;
          (byTier[tier] = byTier[tier] || []).push(n);
        });

        Object.entries(byTier).forEach(([tier, tierNodes]) => {
          const y = TIER_Y[+tier] ?? (TIER_Y[3] + (+tier - 3) * V_GAP);
          const startX = 400 - ((tierNodes.length - 1) * H_GAP) / 2;
          tierNodes.forEach((n, i) => {
            newPositions[n.id] = { x: Math.round(startX + i * H_GAP), y };
          });
        });

        const cores = byTier[0] || [];
        const switches = byTier[1] || [];
        const endpoints = byTier[2] || [];
        const cameras = byTier[3] || [];

        if (cores.length > 0 && switches.length > 0) {
          switches.forEach((sw, idx) => {
            const core = cores[idx % cores.length];
            newEdges.push({ source: core.id, target: sw.id, type: 'default', inferred: true });
          });
        }
        if (switches.length > 0 && endpoints.length > 0) {
          endpoints.forEach((ep, idx) => {
            const sw = switches[idx % switches.length];
            newEdges.push({ source: sw.id, target: ep.id, type: 'default', inferred: true });
          });
        } else if (cores.length > 0 && endpoints.length > 0) {
          endpoints.forEach((ep, idx) => {
            const core = cores[idx % cores.length];
            newEdges.push({ source: core.id, target: ep.id, type: 'default', inferred: true });
          });
        }
        if (endpoints.length > 0 && cameras.length > 0) {
          cameras.forEach((cam, idx) => {
            const ep = endpoints[idx % endpoints.length];
            newEdges.push({ source: ep.id, target: cam.id, type: 'default', inferred: true });
          });
        } else if (switches.length > 0 && cameras.length > 0) {
          cameras.forEach((cam, idx) => {
            const sw = switches[idx % switches.length];
            newEdges.push({ source: sw.id, target: cam.id, type: 'default', inferred: true });
          });
        }
      }

      await fetch(`${API_BASE}/edges/clear`, { method: 'POST' });

      await Promise.all(
        Object.entries(newPositions).map(([id, pos]) =>
          fetch(`${API_BASE}/nodes/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ position: pos })
          })
        )
      );

      await Promise.all(
        newEdges.map(edge =>
          fetch(`${API_BASE}/edges`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: edge.source, target: edge.target, inferred: edge.inferred })
          })
        )
      );

      await fetchTopology();
    } catch (err) {
      console.error("Failed to generate topology template:", err);
    } finally {
      setScanning(false);
    }
  }, [nodes, scannedNodes, fetchTopology]);

  const sentHistory   = bwHistory.map(b => b?.sent_kbps || 0);
  const recvHistory   = bwHistory.map(b => b?.recv_kbps || 0);
  const latestBw      = bwHistory[bwHistory.length - 1] || {};
  const onlineCount   = scannedNodes.filter(n => n.status === 'online').length;
  const offlineCount  = scannedNodes.filter(n => n.status === 'offline').length;
  const degradedCount = scannedNodes.filter(n => n.status === 'degraded').length;

  // Device type counts for filter buttons
  const DEVICE_TYPES = ['camera', 'server', 'nvr', 'switch', 'poe-switch', 'core-switch'];
  const nodesByType = scannedNodes.reduce((acc, n) => {
    const t = n.type || 'other';
    if (!acc[t]) acc[t] = [];
    acc[t].push(n);
    return acc;
  }, {});

  const d = selectedNode
    ? (deviceLiveData ? { ...selectedNode.data, ...deviceLiveData } : selectedNode.data)
    : null;

  const selectedNodeAlerts = selectedNode
    ? alerts.filter(a =>
        a.node_id === selectedNode.id ||
        (d?.ip && a.ip === d.ip)
      )
    : [];

  // ─── Filter chip style helper ─────────────────────────────────────────────
  const chipStyle = (active, activeColor = '#6366f1') => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    borderRadius: 20,
    border: `1px solid ${active ? activeColor : 'transparent'}`,
    background: active ? `${activeColor}22` : 'rgba(255,255,255,0.04)',
    color: active ? activeColor : '#9ca3af',
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: active ? 700 : 500,
    transition: 'all 0.15s',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  });

  const filteredNodes = scannedNodes.filter(node => {
    if (statusFilter && node.status !== statusFilter) return false;
    if (typeFilter   && node.type   !== typeFilter)   return false;
    
    const ipMatch = (node.ip || '').toLowerCase().includes(searchQuery.toLowerCase());
    const modelMatch = (node.model || '').toLowerCase().includes(searchQuery.toLowerCase());
    const typeLabelMatch = deviceTypeLabel(node.type).toLowerCase().includes(searchQuery.toLowerCase());
    return ipMatch || modelMatch || typeLabelMatch;
  });

  const onlineNodes = filteredNodes.filter(n => n.status === 'online');
  const degradedNodes = filteredNodes.filter(n => n.status === 'degraded');
  const offlineNodes = filteredNodes.filter(n => n.status === 'offline');

  const renderLibraryItem = (node) => {
    const isPlaced = nodes.some(n => n.id === node.id);
    return (
      <div key={node.id}
        className={`library-item status--${node.status}`}
        draggable={!isPlaced}
        onDragStart={e => !isPlaced && onDragStart(e, node)}
        onClick={() => {
          const pseudoNode = nodes.find(n => n.id === node.id) || { id: node.id, data: node };
          handleNodeClick(null, pseudoNode);
        }}
        style={{
          opacity: isPlaced ? 0.65 : 1,
          cursor: isPlaced ? 'pointer' : 'grab',
          borderRight: isPlaced ? '3px solid #10b981' : 'none',
          background: isPlaced ? 'rgba(16, 185, 129, 0.03)' : 'transparent',
          marginBottom: 4,
          borderRadius: 6,
          transition: 'all 0.15s'
        }}
      >
        <div className="item-icon"><Icon type={node.type} /></div>
        <div className="item-info">
          <span className="item-ip">{node.ip}</span>
          <span className="item-mdl" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {deviceTypeLabel(node.type)}
            {isPlaced && (
              <span style={{
                color: '#10b981',
                fontSize: 12,
                fontWeight: 700,
                background: 'rgba(16,185,129,0.15)',
                padding: '1px 4px',
                borderRadius: 4
              }}>
                PLACED
              </span>
            )}
          </span>
        </div>
        <span className="item-dot" style={{ background: statusColor(node.status) }} />
      </div>
    );
  };

  return (
    <div className="topology-container">
      {/* ── LEFT SIDEBAR ── */}
      <div className="topology-library">
        <div className="sidebar-header">
          <h3>Devices</h3>
          <button className="topo-btn topo-btn--small" onClick={triggerScan} title="Scan">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
          </button>
        </div>

        {/* Search Input */}
        <div className="sidebar-search-box">
          <div className="search-input-wrapper">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Search devices..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>
        </div>

        {/* ── STATUS FILTER BADGES ── */}
        <div className="status-summary" style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '6px 12px' }}>
          <span
            onClick={() => toggleStatusFilter('online')}
            style={chipStyle(statusFilter === 'online', '#10b981')}
            title="Show only Online"
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            {onlineCount} Online
          </span>
          <span
            onClick={() => toggleStatusFilter('offline')}
            style={chipStyle(statusFilter === 'offline', '#ef4444')}
            title="Show only Offline"
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
            {offlineCount} Offline
          </span>
          {degradedCount > 0 && (
            <span
              onClick={() => toggleStatusFilter('degraded')}
              style={chipStyle(statusFilter === 'degraded', '#f59e0b')}
              title="Show only Degraded"
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
              {degradedCount} Degraded
            </span>
          )}
        </div>

        {/* ── DEVICE TYPE FILTER CHIPS ── */}
        <div style={{ borderTop: '1px solid #1f2937', padding: '8px 12px 0 12px', marginTop: 2 }}>
          <div style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Filter by Type
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {DEVICE_TYPES.map(type => {
              const count = nodesByType[type]?.length || 0;
              if (count === 0) return null;
              const active = typeFilter === type;
              return (
                <div
                  key={type}
                  onClick={() => toggleTypeFilter(type)}
                  className={`hier-group ${active ? 'hier-group--active' : ''}`}
                  style={{
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: 7,
                    border: `1px solid ${active ? '#6366f1' : 'transparent'}`,
                    background: active ? 'rgba(99,102,241,0.12)' : 'transparent',
                    transition: 'all 0.15s',
                    userSelect: 'none',
                  }}
                >
                  <div className="hier-group__label" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    color: active ? '#818cf8' : '#9ca3af',
                    fontWeight: active ? 700 : 500,
                  }}>
                    <Icon type={type} size={11}/>
                    <span>{deviceTypeLabel(type)}</span>
                    <span style={{
                      marginLeft: 'auto',
                      background: active ? '#6366f1' : '#1f2937',
                      color: active ? '#fff' : '#6b7280',
                      borderRadius: 10,
                      padding: '0 6px',
                      fontSize: 13,
                      fontWeight: 700,
                    }}>{count}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Clear filter button */}
          {(statusFilter || typeFilter) && (
            <button
              onClick={() => { setStatusFilter(null); setTypeFilter(null); }}
              style={{
                marginTop: 8,
                width: '100%',
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 7,
                color: '#f87171',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
                padding: '5px 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
              }}
            >
              <Icon type="x" size={10}/> Clear Filter
            </button>
          )}
        </div>

        <div className="library-content">
          {filteredNodes.length === 0 && <p className="empty-msg">No devices match filters.</p>}
          
          {onlineNodes.length > 0 && (
            <div className="accordion-group">
              <button className="accordion-header" onClick={() => toggleGroup('online')}>
                <span className="accordion-title-wrapper">
                  <span className="accordion-indicator online" />
                  Online ({onlineNodes.length})
                </span>
                <span className={`accordion-chevron ${expandedGroups.online ? 'expanded' : ''}`}>▼</span>
              </button>
              {expandedGroups.online && (
                <div className="accordion-content">
                  {onlineNodes.map(renderLibraryItem)}
                </div>
              )}
            </div>
          )}

          {degradedNodes.length > 0 && (
            <div className="accordion-group">
              <button className="accordion-header" onClick={() => toggleGroup('degraded')}>
                <span className="accordion-title-wrapper">
                  <span className="accordion-indicator degraded" />
                  Degraded ({degradedNodes.length})
                </span>
                <span className={`accordion-chevron ${expandedGroups.degraded ? 'expanded' : ''}`}>▼</span>
              </button>
              {expandedGroups.degraded && (
                <div className="accordion-content">
                  {degradedNodes.map(renderLibraryItem)}
                </div>
              )}
            </div>
          )}

          {offlineNodes.length > 0 && (
            <div className="accordion-group">
              <button className="accordion-header" onClick={() => toggleGroup('offline')}>
                <span className="accordion-title-wrapper">
                  <span className="accordion-indicator offline" />
                  Offline ({offlineNodes.length})
                </span>
                <span className={`accordion-chevron ${expandedGroups.offline ? 'expanded' : ''}`}>▼</span>
              </button>
              {expandedGroups.offline && (
                <div className="accordion-content">
                  {offlineNodes.map(renderLibraryItem)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── MAIN CANVAS ── */}
      <div className="topology-canvas" onDrop={onDrop} onDragOver={onDragOver}>
        <ReactFlow
          nodes={visibleNodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onNodeClick={handleNodeClick}
          onNodeDragStop={onNodeDragStop} nodeTypes={nodeTypes} fitView>
          <Background color="#1f2937" gap={20} />
          <Controls />
          <MiniMap nodeStrokeWidth={3} zoomable pannable maskColor="rgba(0,0,0,0.1)" />

          <Panel position="top-left" className="topo-toolbar-unified">
            <div className="unified-toolbar-row">
              <button className="topo-btn topo-btn--primary" onClick={triggerScan} disabled={scanning}>
                {scanning ? 'Scanning…' : 'Scan Network'}
              </button>
              <button className="topo-btn" onClick={placeAllDevices} disabled={scanning || scannedNodes.length === 0}>
                Place All
              </button>
              <button className="topo-btn topo-btn-clear" onClick={resetWorkspace} disabled={scanning}>
                Clear Canvas
              </button>
              
              <div className="toolbar-divider" />
              
              <div ref={templatesDropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
                <button
                  className={`topo-btn ${templatesDropdownOpen ? 'topo-btn--active' : ''}`}
                  onClick={() => setTemplatesDropdownOpen(prev => !prev)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  title="Choose Topology Template"
                >
                  <Icon type="template" size={14} />
                  <span>Templates</span>
                  <span style={{ fontSize: '10px', opacity: 0.7 }}>▼</span>
                </button>
                {templatesDropdownOpen && (
                  <div className="topo-templates-dropdown" style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    background: '#111827',
                    border: '1px solid #1f2937',
                    borderRadius: 8,
                    padding: '4px',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 150,
                  }}>
                    <button
                      className="topo-dropdown-item"
                      onClick={() => {
                        applyTopologyTemplate('star');
                        setTemplatesDropdownOpen(false);
                      }}
                    >
                      Star Topology
                    </button>
                    <button
                      className="topo-dropdown-item"
                      onClick={() => {
                        applyTopologyTemplate('ring');
                        setTemplatesDropdownOpen(false);
                      }}
                    >
                      Ring Topology
                    </button>
                    <button
                      className="topo-dropdown-item"
                      onClick={() => {
                        applyTopologyTemplate('bus');
                        setTemplatesDropdownOpen(false);
                      }}
                    >
                      Bus Topology
                    </button>
                    <button
                      className="topo-dropdown-item"
                      onClick={() => {
                        applyTopologyTemplate('mesh');
                        setTemplatesDropdownOpen(false);
                      }}
                    >
                      Mesh Topology
                    </button>
                    <button
                      className="topo-dropdown-item"
                      onClick={() => {
                        applyTopologyTemplate('tree');
                        setTemplatesDropdownOpen(false);
                      }}
                    >
                      Hierarchical
                    </button>
                  </div>
                )}
              </div>
              
              {(statusFilter || typeFilter) && (
                <>
                  <div className="toolbar-divider" />
                  <div className="canvas-filter-badge">
                    <span>
                      {statusFilter
                        ? `Showing: ${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}`
                        : `Type: ${deviceTypeLabel(typeFilter)}`}
                    </span>
                    <button
                      onClick={() => { setStatusFilter(null); setTypeFilter(null); }}
                      className="canvas-filter-clear-btn"
                      title="Clear filter"
                    >
                      <Icon type="x" size={11} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </Panel>

          <Panel position="top-right" className="topo-legend" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="legend-item"><span className="dot dot--online"/> Online</div>
            <div className="legend-item"><span className="dot dot--degraded"/> Degraded</div>
            <div className="legend-item"><span className="dot dot--offline"/> Offline</div>
            {/* ── BELL ALERT BUTTON ── */}
            <BellAlertButton alerts={alerts} onAck={ackAlert} />
          </Panel>
        </ReactFlow>
      </div>

      {/* ── RIGHT SIDEBAR ── */}
      {sidebarOpen && selectedNode && d && (
        <div className="topology-sidebar">
          <div className="sidebar-header">
            <h3>
              {deviceTypeLabel(d?.type)}
              {deviceRefreshing && (
                <span style={{ fontSize: 13, color: '#6366f1', marginLeft: 8, fontWeight: 400 }}>
                  fetching…
                </span>
              )}
            </h3>
            <button className="close-btn" onClick={closeSidebar}>×</button>
          </div>
          <div className="sidebar-tabs">
            <button className={`stab ${activeTab==='details' ?'stab--active':''}`} onClick={() => setActiveTab('details')}>Details</button>
            {/* <button className={`stab ${activeTab==='network' ?'stab--active':''}`} onClick={() => setActiveTab('network')}>Network</button> */}
            <button className={`stab ${activeTab==='metrics' ?'stab--active':''}`} onClick={() => setActiveTab('metrics')}>System</button>
            <button className={`stab ${activeTab==='alerts'  ?'stab--active':''}`} onClick={() => setActiveTab('alerts')}>
              Alerts {selectedNodeAlerts.length > 0 && <span className="alert-badge">{selectedNodeAlerts.length}</span>}
            </button>
          </div>

          <div className="sidebar-content">

            {activeTab === 'details' && d && (
              <>
                <div className="section-title">Identity</div>
                <div className="detail-row"><label>IP Address</label><span>{d.ip || '—'}</span></div>
                <div className="detail-row"><label>Device Type</label><span>{deviceTypeLabel(d.type)}</span></div>
                <div className="detail-row"><label>Manufacturer</label><span>{d.manufacturer || 'Unknown'}</span></div>
                <div className="detail-row"><label>Model</label><span>{d.model || 'Unknown'}</span></div>
                <div className="detail-row">
                  <label>Status</label>
                  <span className={`status-pill ${d.status || 'offline'}`}>{(d.status || 'offline').toUpperCase()}</span>
                </div>

                {/* Canvas Staging Controls */}
                <div style={{ marginTop: 12, marginBottom: 12 }}>
                  {nodes.some(n => n.id === d.id) ? (
                    <button
                      className="topo-btn"
                      style={{
                        width: '100%',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#f87171',
                        justifyContent: 'center'
                      }}
                      onClick={() => removeNodeFromCanvas(d.id)}
                    >
                      <Icon type="x" size={12} /> Remove from Canvas
                    </button>
                  ) : (
                    <button
                      className="topo-btn topo-btn--primary"
                      style={{
                        width: '100%',
                        justifyContent: 'center'
                      }}
                      onClick={() => {
                        const defaultPos = { x: 300, y: 200 };
                        setNodes(nds => nds.concat({
                          id: d.id,
                          type: 'custom',
                          position: defaultPos,
                          data: { 
                            ...d, 
                            onRemove: () => removeNodeFromCanvas(d.id) 
                          }
                        }));
                        setScannedNodes(snd => snd.map(n => n.id === d.id ? { ...n, position: defaultPos } : n));
                        fetch(`${API_BASE}/nodes/${d.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ position: defaultPos })
                        });
                      }}
                    >
                      <Icon type="check" size={12} /> Place on Canvas
                    </button>
                  )}
                </div>

                {/* ── Real-Time Network Bandwidth widget ── */}
                <div className="section-title" style={{ marginTop: 12 }}>Network Bandwidth</div>
                {d.type === 'camera' ? (
                  <div className="stream-panel" style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="stream-label" style={{ fontSize: 14 }}>RTSP Stream Bitrate</span>
                      <span className="stream-val" style={{ fontSize: 18, fontWeight: 800, color: '#10b981', fontFamily: 'monospace' }}>
                        {d.stream_bitrate_mbps != null ? `${d.stream_bitrate_mbps} Mbps` : '0 Mbps'}
                      </span>
                    </div>
                    <div className="metric-bar" style={{ height: 4, background: '#1f2937' }}>
                      <div className="metric-bar__fill" style={{
                        width: `${Math.min(((d.stream_bitrate_mbps || 0) / 10) * 100, 100)}%`,
                        background: '#10b981',
                        boxShadow: '0 0 6px #10b981'
                      }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'rgba(255, 255, 255, 0.4)' }}>
                      <span>Latency: {d.latency != null ? `${Math.round(d.latency)}ms` : '—'}</span>
                      <span>Packet Loss: {d.packet_loss != null ? `${d.packet_loss}%` : '—'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="stream-panel" style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="stream-label" style={{ fontSize: 14 }}>Global TX (Sent)</span>
                      <span className="stream-val" style={{ fontSize: 16, fontWeight: 800, color: '#10b981', fontFamily: 'monospace' }}>
                        {latestBw.sent_kbps != null ? (latestBw.sent_kbps / 1024).toFixed(2) + ' Mbps' : '0 Mbps'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="stream-label" style={{ fontSize: 14 }}>Global RX (Received)</span>
                      <span className="stream-val" style={{ fontSize: 16, fontWeight: 800, color: '#6366f1', fontFamily: 'monospace' }}>
                        {latestBw.recv_kbps != null ? (latestBw.recv_kbps / 1024).toFixed(2) + ' Mbps' : '0 Mbps'}
                      </span>
                    </div>
                    <div className="metric-bar" style={{ height: 4, background: '#1f2937' }}>
                      <div className="metric-bar__fill" style={{
                        width: `${Math.min(((latestBw.recv_kbps || 0) / 1024 / 100) * 100, 100)}%`,
                        background: '#6366f1',
                        boxShadow: '0 0 6px #6366f1'
                      }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                      <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.4)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Host Uptime: {metrics?.uptime || '—'}</span>
                        <span>Latency: {d.latency != null ? `${Math.round(d.latency)}ms` : '—'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4, background: 'rgba(0,0,0,0.25)', padding: '6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
                        <Sparkline data={recvHistory} color="#6366f1" height={30} width={360} />
                      </div>
                    </div>
                  </div>
                )}



                {(d.type === 'poe-switch' || d.type === 'switch') && d.poe_power && <PoEPanel d={d} />}

                {(d.type === 'poe-switch' || d.type === 'core-switch' || d.type === 'switch') && (
                  <>
                    <div className="section-title" style={{ marginTop: 12 }}>Switch Ports</div>
                    <SwitchPortTable ports={d.switch_ports} />
                  </>
                )}

                {d.type === 'nvr' && (
                  <>
                    <div className="section-title" style={{ marginTop: 12 }}>NVR Connectivity</div>
                    <NVRPanel d={d} />
                  </>
                )}

                {d.type === 'camera' && (
                  <>
                    <div className="section-title" style={{ marginTop: 12 }}>Stream Health</div>
                    <CameraStreamPanel
                      d={selectedNode.data}
                      liveData={deviceLiveData}
                      isRefreshing={deviceRefreshing}
                      onRefresh={() => fetchDeviceLiveData(selectedNode)}
                    />
                  </>
                )}
              </>
            )}

            {activeTab === 'network' && (
              <div className="network-tab">
                <div className="bw-section">
                  <div className="bw-header">
                    <span>Network Bandwidth <span style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: 14 }}>(network-wide)</span></span>
                    <span className="bw-live">LIVE</span>
                  </div>
                  <div className="bw-row">
                    <div className="bw-stat">
                      <span className="bw-label">↑ TX</span>
                      <span className="bw-val">{latestBw.sent_kbps != null ? (latestBw.sent_kbps / 1024).toFixed(2) + ' Mbps' : '0 Mbps'}</span>
                      <Sparkline data={sentHistory} color="#10b981" />
                    </div>
                    <div className="bw-stat">
                      <span className="bw-label">↓ RX</span>
                      <span className="bw-val">{latestBw.recv_kbps != null ? (latestBw.recv_kbps / 1024).toFixed(2) + ' Mbps' : '0 Mbps'}</span>
                      <Sparkline data={recvHistory} color="#6366f1" />
                    </div>
                  </div>
                  <div className="bw-threshold-note">
                    <Icon type="zap" size={10}/> Spike alert threshold: {BW_SPIKE_THRESHOLD_MBPS} Mbps
                  </div>
                </div>

                <div className="perf-section">
                  <div className="section-title">
                    Diagnostics for <span style={{ color: '#6366f1' }}>{d?.ip}</span>
                  </div>
                  <NetworkPerfTable diagnostics={diagnostics} filterIp={d?.ip} />
                  {!diagnostics && <p className="empty-msg">Waiting for diagnostics data…</p>}
                </div>
              </div>
            )}

            {activeTab === 'metrics' && (
              <div className="metrics-tab">
                {metrics ? (
                  <>
                    <MetricCard icon="cpu"      label="CPU Usage"  value={metrics.cpu?.toFixed(1)}  unit="%" percent={metrics.cpu}  color="#6366f1" />
                    <MetricCard icon="activity" label="RAM Usage"  value={metrics.ram?.toFixed(1)}  unit="%" percent={metrics.ram}  color="#10b981" />
                    <MetricCard icon="disk"     label="Disk Usage" value={metrics.disk?.toFixed(1)} unit="%" percent={metrics.disk} color="#f59e0b" />
                    {metrics.gpu > 0 && <MetricCard icon="cpu" label="GPU Usage" value={metrics.gpu?.toFixed(1)} unit="%" percent={metrics.gpu} color="#ec4899" />}
                    <div className="metrics-divider" />
                    <div className="detail-row"><label>System Uptime</label><span>{metrics.uptime || 'N/A'}</span></div>
                    <div className="detail-row"><label>Last Reboot</label><span>{metrics.last_reboot || 'N/A'}</span></div>
                    <div className="detail-row"><label>Reboot Reason</label><span>{metrics.reboot_reason || 'N/A'}</span></div>
                  </>
                ) : <p className="empty-msg">Loading system metrics…</p>}
              </div>
            )}

            {activeTab === 'alerts' && (
              <div className="alerts-tab">
                {selectedNodeAlerts.length === 0 ? (
                  <div className="no-alerts">
                    <Icon type="check" size={32} />
                    <p>No alerts for {d?.ip || 'this device'}</p>
                  </div>
                ) : selectedNodeAlerts.map((a, i) => {
                  const sev = a.severity || 'warning';
                  const sevColor = { critical: '#ef4444', warning: '#f59e0b', info: '#60a5fa' }[sev] || '#ef4444';
                  return (
                    <div key={i} className="alert-card" style={{ borderColor: `${sevColor}66`, borderLeftColor: sevColor }}>
                      <div className="alert-card__icon" style={{ color: sevColor }}><Icon type="alert" size={16} /></div>
                      <div className="alert-card__body">
                        <div className="alert-card__sev" style={{ color: sevColor, fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{sev.toUpperCase()}</div>
                        <div className="alert-card__msg">{a.message}</div>
                        <div className="alert-card__meta"><span>{a.ip}</span><span>{new Date(a.timestamp).toLocaleTimeString()}</span></div>
                      </div>
                      <button className="alert-ack" onClick={() => ackAlert(a.node_id)}>ACK</button>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── CUSTOM CONFIRM MODAL ── */}
      {confirmModal.isOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: 12,
            width: 400,
            maxWidth: '90%',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #374151',
              display: 'flex', alignItems: 'center', gap: 10
            }}>
              <Icon type="alert" size={18} />
              <h3 style={{ margin: 0, fontSize: 16, color: '#f3f4f6', fontWeight: 600 }}>
                {confirmModal.title || 'Confirm Action'}
              </h3>
            </div>
            <div style={{ padding: '20px', color: '#d1d5db', fontSize: 15, lineHeight: 1.5 }}>
              {confirmModal.message}
            </div>
            <div style={{
              padding: '16px 20px',
              background: '#111827',
              borderTop: '1px solid #374151',
              display: 'flex', justifyContent: 'flex-end', gap: 12
            }}>
              <button
                onClick={confirmModal.onCancel}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px solid #4b5563',
                  background: 'transparent',
                  color: '#d1d5db',
                  cursor: 'pointer',
                  fontWeight: 500,
                  transition: 'all 0.2s'
                }}
                onMouseOver={e => e.target.style.background = 'rgba(255,255,255,0.05)'}
                onMouseOut={e => e.target.style.background = 'transparent'}
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#6366f1',
                  color: '#ffffff',
                  cursor: 'pointer',
                  fontWeight: 600,
                  boxShadow: '0 2px 4px rgba(99, 102, 241, 0.2)',
                  transition: 'all 0.2s'
                }}
                onMouseOver={e => e.target.style.background = '#4f46e5'}
                onMouseOut={e => e.target.style.background = '#6366f1'}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}