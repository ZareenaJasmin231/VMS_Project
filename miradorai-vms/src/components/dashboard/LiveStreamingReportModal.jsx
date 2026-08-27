import React, { useState, useEffect } from 'react';
import './ProcessMetricsPanel.css';

const LiveStreamingReportModal = ({ isOpen, onClose }) => {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let interval;
    if (isOpen) {
      const fetchMetrics = async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch('/api/dashboard/system-metrics/processes', {
            headers: { 'Authorization': token ? `Bearer ${token}` : '' }
          });
          const data = await res.json();
          setMetrics(data);
        } catch (err) {
          console.error('Failed to fetch real-time metrics:', err);
        } finally {
          setLoading(false);
        }
      };
      
      fetchMetrics();
      // Poll every 5 seconds to keep it real-time
      interval = setInterval(fetchMetrics, 5000);
    }
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const { processes = {} } = metrics || {};
  const ffmpegProcs = (processes.ffmpeg_processes || []).filter(p => !p.is_orphaned);
  const infraProcs = processes.infrastructure || [];
  const mediaMtxProc = infraProcs.find(p => (p.service || '').toLowerCase().includes('mediamtx')) || null;

  const activeStreams = ffmpegProcs.length;
  
  // Calculate exact live totals
  const totalFfmpegCpu = ffmpegProcs.reduce((acc, p) => acc + (p.cpu_percent || 0), 0);
  const totalFfmpegRam = ffmpegProcs.reduce((acc, p) => acc + (p.ram_mb || 0), 0);
  
  const mtxCpu = mediaMtxProc ? mediaMtxProc.cpu_percent : 0;
  const mtxRam = mediaMtxProc ? mediaMtxProc.ram_mb : 0;

  const exactTotalCpu = (totalFfmpegCpu + mtxCpu).toFixed(1);
  const exactTotalRam = (totalFfmpegRam + mtxRam).toFixed(1);

  return (
    <div className="vms-modal-backdrop" onClick={onClose}>
      <div className="vms-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px' }}>
        <div className="vms-modal-header">
          <h3>📡 Exact Real-Time Live Streaming Usage</h3>
          <button className="vms-modal-close" onClick={onClose}>✕</button>
        </div>

        {loading && !metrics ? (
          <div className="vms-proc-loading">
            <div className="vms-proc-spinner"></div>
            <span>Gathering live electrical & process usage...</span>
          </div>
        ) : (
          <div className="vms-modal-body">
            <div className="vms-recommendation-card" style={{ marginBottom: '20px', backgroundColor: '#eef2ff', color: '#333' }}>
              <strong>Live Telemetry Active:</strong> This report is now pulling exact, real-time CPU and RAM measurements directly from your operating system for every active camera stream and the routing engine.
            </div>

            <div className="vms-baseline-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h4 style={{ margin: 0 }}>Exact Real-Time Totals</h4>
                <span className="vms-status-badge ok">Polling Live OS Data</span>
              </div>

              <div className="vms-baseline-grid">
                <div>
                  <span className="label">Active Stream Processes</span>
                  <span className="val" style={{ fontSize: '1.5em', color: '#2563eb' }}>{activeStreams}</span>
                </div>
                <div>
                  <span className="label">Total Live CPU %</span>
                  <span className="val">{exactTotalCpu}%</span>
                </div>
                <div>
                  <span className="label">Total Live RAM</span>
                  <span className="val">{exactTotalRam} MB</span>
                </div>
                <div>
                  <span className="label">Router Engine</span>
                  <span className="val">{mediaMtxProc ? 'Online' : 'Offline'}</span>
                </div>
              </div>
            </div>

            <h4>Individual Camera Breakdown (Real-Time)</h4>
            <div className="vms-proc-table-wrapper" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              <table className="vms-proc-table">
                <thead>
                  <tr>
                    <th>Stream / IP</th>
                    <th>Process ID</th>
                    <th>Live CPU %</th>
                    <th>Live RAM (MB)</th>
                    <th>Uptime</th>
                  </tr>
                </thead>
                <tbody>
                  {/* MediaMTX Router Row */}
                  {mediaMtxProc && (
                    <tr style={{ backgroundColor: '#f8fafc', fontWeight: 'bold' }}>
                      <td>📡 MediaMTX (Main Router)</td>
                      <td><code>{mediaMtxProc.pid}</code></td>
                      <td>{mediaMtxProc.cpu_percent}%</td>
                      <td>{mediaMtxProc.ram_mb} MB</td>
                      <td>{mediaMtxProc.uptime_seconds ? `${Math.floor(mediaMtxProc.uptime_seconds / 60)}m ${mediaMtxProc.uptime_seconds % 60}s` : '-'}</td>
                    </tr>
                  )}
                  
                  {/* Individual FFmpeg Streams */}
                  {ffmpegProcs.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="vms-table-empty">No active stream processes found.</td>
                    </tr>
                  ) : (
                    ffmpegProcs.map((p, idx) => (
                      <tr key={`stream-${p.pid}-${idx}`}>
                        <td>📹 {p.camera_ip && p.camera_ip !== 'N/A' ? p.camera_ip : `Stream ${idx + 1}`}</td>
                        <td><code>{p.pid}</code></td>
                        <td>
                          <span className={`vms-metric-tag ${p.cpu_percent > 15 ? 'high' : ''}`}>
                            {p.cpu_percent}%
                          </span>
                        </td>
                        <td>
                          <span className={`vms-metric-tag ${p.ram_mb > 300 ? 'high' : ''}`}>
                            {p.ram_mb} MB
                          </span>
                        </td>
                        <td>{p.uptime_seconds ? `${Math.floor(p.uptime_seconds / 60)}m ${p.uptime_seconds % 60}s` : '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="vms-modal-footer">
          <button className="vms-proc-btn vms-proc-btn-primary" onClick={onClose}>Close Report</button>
        </div>
      </div>
    </div>
  );
};

export default LiveStreamingReportModal;
