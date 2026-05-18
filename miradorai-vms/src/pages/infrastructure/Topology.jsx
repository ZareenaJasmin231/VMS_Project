import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactFlow, {
  addEdge, Background, Controls, MiniMap,
  useNodesState, useEdgesState, Panel, MarkerType, Handle, Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import './Topology.css';

const API_BASE = `http://${window.location.hostname}:8000/api/infrastructure`;
const WS_URL   = `ws://${window.location.hostname}:8000/api/infrastructure/ws`;

// ─── ALERT THRESHOLDS ────────────────────────────────────────────────────────
const BW_SPIKE_THRESHOLD_MBPS = 80; // alert if TX or RX > 80 Mbps

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
    case 'wifi':        return <svg {...s}><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M5 12.55a11 11 0 0114.08 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/></svg>;
    case 'cpu':         return <svg {...s}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>;
    case 'disk':        return <svg {...s}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>;
    case 'activity':    return <svg {...s}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
    case 'power':       return <svg {...s}><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>;
    case 'video':       return <svg {...s}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>;
    case 'zap':         return <svg {...s}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
    case 'check':       return <svg {...s}><polyline points="20 6 9 17 4 12"/></svg>;
    case 'email':       return <svg {...s}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
    default:            return <svg {...s}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>;
  }
};

// ─── Status color helper ──────────────────────────────────────────────────────
const statusColor = (s) => ({ online: '#10b981', offline: '#ef4444', degraded: '#f59e0b' }[s] || '#6b7280');

// ─── Packet loss color ────────────────────────────────────────────────────────
const packetLossColor = (pct) => {
  if (pct == null) return '#6b7280';
  if (pct < 1)  return '#10b981';
  if (pct < 5)  return '#f59e0b';
  return '#ef4444';
};

// ─── Device type label ────────────────────────────────────────────────────────
const deviceTypeLabel = (type) => ({
  'core-switch': 'Core Switch',
  'poe-switch':  'PoE Switch',
  'nvr':         'NVR',
  'camera':      'Camera',
  'server':      'Server',
  'switch':      'Switch',
}[type] || type || 'Device');

// ─── Custom Topology Node ─────────────────────────────────────────────────────
const CustomNode = ({ data }) => (
  <div className={`topo-node topo-node--${data.status} topo-node-type--${data.type}`}
       style={{ borderColor: statusColor(data.status) }}>
    <Handle type="target" position={Position.Top} style={{ background: '#555' }} />
    <div className="topo-node__pulse" style={{ backgroundColor: statusColor(data.status) }} />
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
    {/* PoE badge on node */}
    {data.poe_power && (
      <div className="topo-node__poe">
        <Icon type="zap" size={10}/> {data.poe_power.used}W / {data.poe_power.total}W
      </div>
    )}
    {/* Stream bitrate badge for cameras */}
    {data.stream_bitrate_mbps != null && (
      <div className="topo-node__stream">{data.stream_bitrate_mbps} Mbps</div>
    )}
    <Handle type="source" position={Position.Bottom} style={{ background: '#555' }} />
  </div>
);

const nodeTypes = { custom: CustomNode };

// ─── Metric Card ──────────────────────────────────────────────────────────────
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

// ─── Alert Banner ─────────────────────────────────────────────────────────────
const AlertBanner = ({ alerts, onAck }) => {
  if (!alerts.length) return null;
  const severityColor = (sev) => ({ critical: '#ef4444', warning: '#f59e0b', info: '#60a5fa' }[sev] || '#ef4444');
  return (
    <div className="alert-banner">
      {alerts.slice(0, 3).map((a, i) => (
        <div key={i} className="alert-item" style={{ borderLeft: `3px solid ${severityColor(a.severity)}` }}>
          <Icon type="alert" size={14} />
          <span className="alert-severity" style={{ color: severityColor(a.severity) }}>
            [{(a.severity || 'ALERT').toUpperCase()}]
          </span>
          <span>{a.message}</span>
          <span className="alert-time">{new Date(a.timestamp).toLocaleTimeString()}</span>
          <button className="alert-ack" onClick={() => onAck(a.node_id)}>ACK</button>
        </div>
      ))}
      {alerts.length > 3 && (
        <div className="alert-item alert-item--more">+{alerts.length - 3} more alerts</div>
      )}
    </div>
  );
};

// ─── Switch Port Table ────────────────────────────────────────────────────────
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

// ─── Network Performance Table ────────────────────────────────────────────────
const NetworkPerfTable = ({ diagnostics, selectedId }) => {
  if (!diagnostics?.devices) return null;
  return (
    <div className="perf-table">
      <div className="perf-table__header">
        <span>Device</span><span>Latency</span><span>PktLoss</span><span>RTSP</span><span>HTTP</span><span>ONVIF</span><span>Status</span>
      </div>
      {diagnostics.devices.map((d, i) => (
        <div key={i} className={`perf-table__row ${selectedId === `node-${d.ip.replace(/\./g, '-')}` ? 'perf-row--selected' : ''}`}>
          <span className="perf-name">{d.name || d.ip}</span>
          <span className="perf-latency">{d.latency != null ? `${d.latency}ms` : '—'}</span>
          <span style={{ color: packetLossColor(d.packet_loss), fontSize: '10px', textAlign: 'center' }}>
            {d.packet_loss != null ? `${d.packet_loss}%` : '—'}
          </span>
          <span className={`perf-port ${d.ports?.rtsp ? 'port-up' : 'port-dn'}`}>{d.ports?.rtsp ? '●' : '○'}</span>
          <span className={`perf-port ${d.ports?.http ? 'port-up' : 'port-dn'}`}>{d.ports?.http ? '●' : '○'}</span>
          <span className={`perf-port ${d.ports?.onvif ? 'port-up' : 'port-dn'}`}>{d.ports?.onvif ? '●' : '○'}</span>
          <span className={`perf-status status--${d.status?.toLowerCase()}`}>{d.status}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Bandwidth Sparkline ──────────────────────────────────────────────────────
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

// ─── NVR Panel ────────────────────────────────────────────────────────────────
const NVRPanel = ({ d }) => (
  <div className="nvr-panel">
    <div className="nvr-panel__title"><Icon type="nvr" size={14}/> NVR Status</div>
    <div className="nvr-grid">
      <div className="nvr-stat">
        <span className="nvr-label">Connected</span>
        <span className={`nvr-val ${d.nvr_connected ? 'txt-green' : 'txt-red'}`}>
          {d.nvr_connected ? '✓ YES' : '✗ NO'}
        </span>
      </div>
      <div className="nvr-stat">
        <span className="nvr-label">Recording</span>
        <span className={`nvr-val ${d.recording_status === 'active' ? 'txt-green' : 'txt-red'}`}>
          {d.recording_status || 'Unknown'}
        </span>
      </div>
      <div className="nvr-stat">
        <span className="nvr-label">Storage</span>
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

// ─── Camera Stream Panel ──────────────────────────────────────────────────────
const CameraStreamPanel = ({ d }) => (
  <div className="stream-panel">
    <div className="stream-panel__title"><Icon type="video" size={14}/> Stream Health</div>
    <div className="stream-grid">
      <div className="stream-stat">
        <span className="stream-label">Bitrate</span>
        <span className="stream-val">{d.stream_bitrate_mbps != null ? `${d.stream_bitrate_mbps} Mbps` : '—'}</span>
      </div>
      <div className="stream-stat">
        <span className="stream-label">FPS</span>
        <span className="stream-val">{d.stream_fps != null ? d.stream_fps : '—'}</span>
      </div>
      <div className="stream-stat">
        <span className="stream-label">Status</span>
        <span className={`stream-val ${d.stream_status === 'healthy' ? 'txt-green' : 'txt-red'}`}>
          {d.stream_status || '—'}
        </span>
      </div>
      <div className="stream-stat">
        <span className="stream-label">Resolution</span>
        <span className="stream-val">{d.stream_resolution || '—'}</span>
      </div>
      <div className="stream-stat">
        <span className="stream-label">Codec</span>
        <span className="stream-val">{d.codec || '—'}</span>
      </div>
      <div className="stream-stat">
        <span className="stream-label">Dropped Frames</span>
        <span className={`stream-val ${d.dropped_frames > 0 ? 'txt-yellow' : 'txt-green'}`}>
          {d.dropped_frames != null ? d.dropped_frames : '—'}
        </span>
      </div>
    </div>
    <div className="stream-flags">
      <span className={`stream-flag ${d.rtsp_connected ? 'flag-ok' : 'flag-err'}`}>RTSP</span>
      <span className={`stream-flag ${d.onvif_connected ? 'flag-ok' : 'flag-err'}`}>ONVIF</span>
      <span className={`stream-flag ${d.recording ? 'flag-ok' : 'flag-err'}`}>REC</span>
    </div>
  </div>
);

// ─── PoE Panel ────────────────────────────────────────────────────────────────
const PoEPanel = ({ d }) => {
  if (!d.poe_power) return null;
  const { used, total } = d.poe_power;
  const pct = total > 0 ? (used / total) * 100 : 0;
  return (
    <div className="poe-panel">
      <div className="poe-panel__title"><Icon type="zap" size={14}/> PoE Power</div>
      <div className="poe-summary">
        <span className="poe-used">{used}W</span>
        <span className="poe-sep"> / </span>
        <span className="poe-total">{total}W</span>
        <span className="poe-pct">({pct.toFixed(0)}%)</span>
      </div>
      <div className="metric-bar">
        <div className="metric-bar__fill" style={{
          width: `${pct}%`,
          background: pct > 85 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#f59e0b'
        }}/>
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Topology() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [scanning, setScanning]         = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [metrics, setMetrics]           = useState(null);
  const [alerts, setAlerts]             = useState([]);
  const [diagnostics, setDiagnostics]   = useState(null);
  const [bwHistory, setBwHistory]       = useState([]);
  const [activeTab, setActiveTab]       = useState('details');
  const wsRef         = useRef(null);
  const prevUptimes   = useRef({});          // track uptime for reboot detection
  const prevBwRef     = useRef({});          // track bandwidth for spike detection
  const [sidebarOpen, setSidebarOpen] = useState(false);


  // ── Bandwidth spike detection ──
  const checkBandwidthSpike = useCallback((bwData) => {
    if (!bwData) return;
    const sentMbps = (bwData.sent_kbps || 0) / 1024;
    const recvMbps = (bwData.recv_kbps || 0) / 1024;
    const key = 'global';
    const prev = prevBwRef.current[key] || {};
    if (!prev.alerted && (sentMbps > BW_SPIKE_THRESHOLD_MBPS || recvMbps > BW_SPIKE_THRESHOLD_MBPS)) {
      const dir   = sentMbps > BW_SPIKE_THRESHOLD_MBPS ? '↑TX' : '↓RX';
      const val   = Math.max(sentMbps, recvMbps).toFixed(1);
      const alert = {
        node_id:   'bandwidth-spike',
        severity:  'warning',
        message:   `High bandwidth spike detected! ${dir} ${val} Mbps (threshold: ${BW_SPIKE_THRESHOLD_MBPS} Mbps)`,
        timestamp: new Date().toISOString(),
        ip:        'Network'
      };
      setAlerts(prev => [alert, ...prev]);
      prevBwRef.current[key] = { alerted: true };
    } else if (sentMbps < BW_SPIKE_THRESHOLD_MBPS && recvMbps < BW_SPIKE_THRESHOLD_MBPS) {
      prevBwRef.current[key] = { alerted: false };
    }
  }, []);

  // ── Unexpected reboot detection ──
  const checkUnexpectedReboot = useCallback((nodeId, newData) => {
    if (!newData.uptime) return;
    const prev = prevUptimes.current[nodeId];
    // If we have a previous uptime and new uptime is significantly smaller → reboot
    const parseUptimeSeconds = (str) => {
      if (!str) return null;
      let secs = 0;
      const d = str.match(/(\d+)\s*d/); if (d) secs += parseInt(d[1]) * 86400;
      const h = str.match(/(\d+)\s*h/); if (h) secs += parseInt(h[1]) * 3600;
      const m = str.match(/(\d+)\s*m/); if (m) secs += parseInt(m[1]) * 60;
      return secs;
    };
    const newSecs  = parseUptimeSeconds(newData.uptime);
    const prevSecs = parseUptimeSeconds(prev);
    if (prevSecs != null && newSecs != null && newSecs < prevSecs - 60) {
      const alert = {
        node_id:   nodeId,
        severity:  'critical',
        message:   `Device ${newData.ip || nodeId} rebooted unexpectedly! Reason: ${newData.reboot_reason || 'Unknown'}`,
        timestamp: new Date().toISOString(),
        ip:        newData.ip || nodeId
      };
      setAlerts(prev => [alert, ...prev]);
    }
    prevUptimes.current[nodeId] = newData.uptime;
  }, []);

  // ── Fetch topology ──
  const fetchTopology = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/topology`);
      const data = await res.json();
      if (!data?.nodes) return;
      setNodes(data.nodes.map(n => ({
        id: n.id, type: 'custom',
        position: n.position || { x: Math.random() * 500, y: Math.random() * 400 },
        data: { ...n }
      })));
      setEdges((data.edges || []).map((e, idx) => ({
        id: `e-${idx}`, source: e.source, target: e.target,
        animated: e.inferred,
        label: e.port_label || '',
        style: { stroke: e.inferred ? '#6366f1' : '#4b5563' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#4b5563' }
      })));
    } catch (err) { console.error('Topology fetch failed:', err); }
  }, [setNodes, setEdges]);

const fetchMetrics = useCallback(async () => {
  try { 
    const r = await fetch(`${API_BASE}/metrics`);
    const data = await r.json();
    setMetrics(data);
    setSidebarOpen(true);  // ← add this
  } catch {}
}, []);
  const fetchAlerts    = useCallback(async () => {
    try { const r = await fetch(`${API_BASE}/alerts?unacknowledged_only=true`); const d = await r.json(); setAlerts(Array.isArray(d) ? d : []); } catch {}
  }, []);
  const fetchBandwidth = useCallback(async () => {
    try { const r = await fetch(`${API_BASE}/bandwidth`); const d = await r.json(); setBwHistory(Array.isArray(d) ? d.reverse() : []); } catch {}
  }, []);

  // ── WebSocket ──
  const connectWebSocket = useCallback(() => {
    if (wsRef.current) wsRef.current.close();
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => console.log('[WS] Connected.');
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'NODE_UPDATE') {
          checkUnexpectedReboot(msg.id, msg.data);
          // Check for switch port down alert
          if (msg.data.switch_ports) {
            msg.data.switch_ports.forEach(p => {
              if (p.status === 'down') {
                setAlerts(prev => [{
                  node_id:   msg.id,
                  severity:  'warning',
                  message:   `Switch port ${p.port} is DOWN on ${msg.data.ip || msg.id}${p.connected_device ? ` (was: ${p.connected_device})` : ''}`,
                  timestamp: new Date().toISOString(),
                  ip:        msg.data.ip || msg.id
                }, ...prev]);
              }
            });
          }
          // NVR unreachable alert
          if (msg.data.type === 'nvr' && msg.data.nvr_connected === false) {
            setAlerts(prev => [{
              node_id:   msg.id,
              severity:  'critical',
              message:   `NVR ${msg.data.ip || msg.id} is UNREACHABLE — recording may be interrupted!`,
              timestamp: new Date().toISOString(),
              ip:        msg.data.ip || msg.id
            }, ...prev]);
          }
          setNodes(nds => nds.map(n =>
            n.id === msg.id ? { ...n, data: { ...n.data, ...msg.data } } : n
          ));
        } else if (msg.type === 'TOPOLOGY_UPDATE') {
          fetchTopology();
        } else if (msg.type === 'DIAGNOSTICS_UPDATE') {
          setDiagnostics(msg.data);
          const bw = msg.data.bandwidth;
          setBwHistory(prev => [...prev.slice(-99), bw]);
          checkBandwidthSpike(bw);
        } else if (msg.type === 'ALERT') {
          setAlerts(prev => [msg.data, ...prev]);
        }
      } catch (e) { console.error('[WS] Parse error:', e); }
    };
    ws.onclose = () => setTimeout(connectWebSocket, 5000);
    ws.onerror = (e) => { console.error('[WS] Error:', e); ws.close(); };
  }, [fetchTopology, setNodes, checkUnexpectedReboot, checkBandwidthSpike]);

  useEffect(() => {
    fetchTopology(); fetchMetrics(); fetchAlerts(); fetchBandwidth(); connectWebSocket();
    const interval = setInterval(fetchMetrics, 10000);
    return () => { clearInterval(interval); if (wsRef.current) wsRef.current.close(); };
  }, [fetchTopology, fetchMetrics, fetchAlerts, fetchBandwidth, connectWebSocket]);

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
    setEdges(eds => addEdge({ ...params, id: `e-${Date.now()}` }, eds));
    fetch(`${API_BASE}/edges`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: params.source, target: params.target })
    });
  }, [setEdges]);

const handleNodeClick = useCallback((_, node) => { 
  setSelectedNode(node); 
  setActiveTab('details');
  setSidebarOpen(true);  // ← add this
}, []);
  const triggerScan    = async () => { setScanning(true); try { await fetch(`${API_BASE}/scan`, { method: 'POST' }); } catch {} finally { setScanning(false); } };
  const savePositions  = async () => { await Promise.all(nodes.map(n => fetch(`${API_BASE}/nodes/${n.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: n.position }) }))); };
  const ackAlert       = async (nodeId) => { await fetch(`${API_BASE}/alerts/${nodeId}/acknowledge`, { method: 'POST' }); setAlerts(prev => prev.filter(a => a.node_id !== nodeId)); };
  const onDragStart    = (e, nd) => { e.dataTransfer.setData('application/reactflow', JSON.stringify(nd)); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver     = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onDrop         = useCallback((e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/reactflow');
    if (!raw) return;
    const nd = JSON.parse(raw);
    if (nodes.find(n => n.id === nd.id)) return;
    const bounds   = e.target.getBoundingClientRect();
    const position = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
    setNodes(nds => nds.concat({ id: nd.id, type: 'custom', position, data: nd }));
    fetch(`${API_BASE}/nodes/${nd.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position }) });
  }, [nodes, setNodes]);

  const sentHistory   = bwHistory.map(b => b?.sent_kbps || 0);
  const recvHistory   = bwHistory.map(b => b?.recv_kbps || 0);
  const latestBw      = bwHistory[bwHistory.length - 1] || {};
  const onlineCount   = nodes.filter(n => n.data?.status === 'online').length;
  const offlineCount  = nodes.filter(n => n.data?.status === 'offline').length;
  const degradedCount = nodes.filter(n => n.data?.status === 'degraded').length;

  // Group nodes by type for sidebar
  const nodesByType = nodes.reduce((acc, n) => {
    const t = n.data.type || 'other';
    if (!acc[t]) acc[t] = [];
    acc[t].push(n);
    return acc;
  }, {});

  const d = selectedNode?.data;

  return (
    <div className="topology-container">
      <AlertBanner alerts={alerts} onAck={ackAlert} />

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
        <div className="status-summary">
          <span className="badge badge--online">{onlineCount} Online</span>
          <span className="badge badge--offline">{offlineCount} Offline</span>
          {degradedCount > 0 && <span className="badge badge--degraded">{degradedCount} Degraded</span>}
        </div>
        {/* Hierarchy hint */}
        <div className="hierarchy-hint">
          {['core-switch','poe-switch','nvr','camera','server','switch'].map(type =>
            nodesByType[type]?.length ? (
              <div key={type} className="hier-group">
                <div className="hier-group__label">
                  <Icon type={type} size={11}/> {deviceTypeLabel(type)} ({nodesByType[type].length})
                </div>
              </div>
            ) : null
          )}
        </div>
        <div className="library-content">
          {nodes.length === 0 && <p className="empty-msg">No devices. Run a scan.</p>}
          {nodes.map(node => (
            <div key={node.id}
              className={`library-item status--${node.data.status}`}
              draggable onDragStart={e => onDragStart(e, node.data)}
              onClick={() => { setSelectedNode(node); setActiveTab('details'); }}>
              <div className="item-icon"><Icon type={node.data.type} /></div>
              <div className="item-info">
                <span className="item-ip">{node.data.ip}</span>
                <span className="item-mdl">{deviceTypeLabel(node.data.type)}</span>
              </div>
              <span className="item-dot" style={{ background: statusColor(node.data.status) }} />
            </div>
          ))}
        </div>
      </div>

      {/* ── MAIN CANVAS ── */}
      <div className="topology-canvas" onDrop={onDrop} onDragOver={onDragOver}>
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onNodeClick={handleNodeClick}
          onNodeDragStop={onNodeDragStop} nodeTypes={nodeTypes} fitView>
          <Background color="#1f2937" gap={20} />
          <Controls />
          <MiniMap nodeStrokeWidth={3} zoomable pannable maskColor="rgba(0,0,0,0.1)" />
          <Panel position="top-left" className="topo-panel">
            <button className="topo-btn topo-btn--primary" onClick={triggerScan} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Scan Network'}
            </button>
            <button className="topo-btn" onClick={savePositions}>Save Layout</button>
          </Panel>
          <Panel position="top-right" className="topo-legend">
            <div className="legend-item"><span className="dot dot--online"/>  Online</div>
            <div className="legend-item"><span className="dot dot--degraded"/> Degraded</div>
            <div className="legend-item"><span className="dot dot--offline"/> Offline</div>
          </Panel>
        </ReactFlow>
      </div>

      {/* ── RIGHT SIDEBAR ── */}
{sidebarOpen && (selectedNode || metrics) && (
        <div className="topology-sidebar">
          <div className="sidebar-header">
            <h3>{selectedNode ? deviceTypeLabel(d?.type) : 'System'}</h3>
<button className="close-btn" onClick={() => { setSelectedNode(null); setSidebarOpen(false); }}>×</button>
          </div>
          <div className="sidebar-tabs">
            {selectedNode && (
              <button className={`stab ${activeTab==='details'?'stab--active':''}`} onClick={() => setActiveTab('details')}>Details</button>
            )}
            <button className={`stab ${activeTab==='network'?'stab--active':''}`} onClick={() => setActiveTab('network')}>Network</button>
            {(!selectedNode || d?.model === 'VMS Host') && (
              <button className={`stab ${activeTab==='metrics'?'stab--active':''}`} onClick={() => setActiveTab('metrics')}>System</button>
            )}
            <button className={`stab ${activeTab==='alerts'?'stab--active':''}`} onClick={() => setActiveTab('alerts')}>
              Alerts {alerts.length > 0 && <span className="alert-badge">{alerts.length}</span>}
            </button>
          </div>

          <div className="sidebar-content">

            {/* ══ DETAILS TAB ══ */}
            {activeTab === 'details' && d && (
              <>
                {/* ── Core info ── */}
                <div className="section-title">Identity</div>
                <div className="detail-row"><label>IP Address</label><span>{d.ip}</span></div>
                <div className="detail-row"><label>Device Type</label><span>{deviceTypeLabel(d.type)}</span></div>
                <div className="detail-row"><label>Manufacturer</label><span>{d.manufacturer || 'Unknown'}</span></div>
                <div className="detail-row"><label>Model</label><span>{d.model || 'Unknown'}</span></div>
                <div className="detail-row">
                  <label>Status</label>
                  <span className={`status-pill ${d.status || 'offline'}`}>{(d.status||'offline').toUpperCase()}</span>
                </div>

                {/* ── Uptime & Reboot ── */}
                <div className="section-title" style={{ marginTop: 12 }}>🖥️ Uptime & Reboot</div>
                <div className="detail-row">
                  <label>Uptime</label>
                  <span>{d.uptime || 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <label>Last Reboot</label>
                  <span>{d.last_reboot || 'N/A'}</span>
                </div>
                {/* ✅ FIX: Reboot Reason */}
                <div className="detail-row">
                  <label>Reboot Reason</label>
                  <span className={`reboot-reason ${d.reboot_reason ? 'reboot-reason--set' : ''}`}>
                    {d.reboot_reason || 'No data'}
                  </span>
                </div>
                <div className="detail-row">
                  <label>Last Seen</label>
                  <span>{d.last_seen ? new Date(d.last_seen).toLocaleString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' }) : 'Never'}</span>
                </div>

                {/* ── Network Performance ── */}
                <div className="section-title" style={{ marginTop: 12 }}>📶 Network Performance</div>
                <div className="detail-row">
                  <label>Latency (Ping)</label>
                  <span>{d.latency != null ? `${Math.round(d.latency)} ms` : 'N/A'}</span>
                </div>
                {/* ✅ FIX: Packet Loss */}
                <div className="detail-row">
                  <label>Packet Loss</label>
                  <span style={{ color: packetLossColor(d.packet_loss), fontWeight: 600 }}>
                    {d.packet_loss != null ? `${d.packet_loss}%` : 'N/A'}
                    {d.packet_loss != null && (
                      <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 10, marginLeft: 6 }}>
                        {d.packet_loss < 1 ? '(Good)' : d.packet_loss < 5 ? '(Degraded)' : '(Critical)'}
                      </span>
                    )}
                  </span>
                </div>

                {/* ✅ FIX: PoE Panel for poe-switch */}
                {(d.type === 'poe-switch' || d.type === 'switch') && d.poe_power && (
                  <PoEPanel d={d} />
                )}

                {/* ✅ FIX: Switch Port Table */}
                {(d.type === 'poe-switch' || d.type === 'core-switch' || d.type === 'switch') && (
                  <>
                    <div className="section-title" style={{ marginTop: 12 }}>Switch Ports</div>
                    <SwitchPortTable ports={d.switch_ports} />
                  </>
                )}

                {/* ✅ FIX: NVR Panel */}
                {d.type === 'nvr' && (
                  <>
                    <div className="section-title" style={{ marginTop: 12 }}>📹 NVR Connectivity</div>
                    <NVRPanel d={d} />
                  </>
                )}

                {/* ✅ FIX: Camera Stream Health */}
                {d.type === 'camera' && (
                  <>
                    <div className="section-title" style={{ marginTop: 12 }}>📷 Stream Health</div>
                    <CameraStreamPanel d={d} />
                  </>
                )}
              </>
            )}

            {/* ══ NETWORK TAB ══ */}
            {activeTab === 'network' && (
              <div className="network-tab">
                {/* Bandwidth Utilization */}
                <div className="bw-section">
                  <div className="bw-header">
                    <span>Bandwidth Utilization</span>
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

                {/* Per-device latency + packet loss */}
                <div className="perf-section">
                  <div className="section-title">Device Latency &amp; Packet Loss</div>
                  <NetworkPerfTable diagnostics={diagnostics} selectedId={selectedNode?.id} />
                  {!diagnostics && <p className="empty-msg">Waiting for diagnostics data…</p>}
                </div>
              </div>
            )}

            {/* ══ SYSTEM TAB ══ */}
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

            {/* ══ ALERTS TAB ══ */}
            {activeTab === 'alerts' && (
              <div className="alerts-tab">
                {alerts.length === 0 ? (
                  <div className="no-alerts">
                    <Icon type="check" size={32} />
                    <p>No active alerts</p>
                  </div>
                ) : alerts.map((a, i) => {
                  const sev = a.severity || 'warning';
                  const sevColor = { critical: '#ef4444', warning: '#f59e0b', info: '#60a5fa' }[sev] || '#ef4444';
                  return (
                    <div key={i} className="alert-card" style={{ borderColor: `${sevColor}66`, borderLeftColor: sevColor }}>
                      <div className="alert-card__icon" style={{ color: sevColor }}><Icon type="alert" size={16} /></div>
                      <div className="alert-card__body">
                        <div className="alert-card__sev" style={{ color: sevColor, fontSize: 9, fontWeight: 700, marginBottom: 2 }}>
                          {sev.toUpperCase()}
                        </div>
                        <div className="alert-card__msg">{a.message}</div>
                        <div className="alert-card__meta">
                          <span>{a.ip}</span>
                          <span>{new Date(a.timestamp).toLocaleTimeString()}</span>
                        </div>
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
    </div>
  );
}