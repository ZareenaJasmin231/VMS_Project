import React, { useState, useEffect } from 'react';
import './ProcessMetricsPanel.css';

const LiveStreamingReportModal = ({ isOpen, onClose }) => {
  const [report, setReport] = useState(null);
  const [processMetrics, setProcessMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      const fetchData = async () => {
        setLoading(true);
        try {
          const token = localStorage.getItem('token');
          const headers = { 'Authorization': token ? `Bearer ${token}` : '' };
          
          // Fetch real-time summary for active camera count
          const summaryRes = await fetch('/api/dashboard/summary', { headers });
          const summaryData = await summaryRes.json();
          setReport(summaryData);

          // Fetch exact real-time OS process metrics to measure MediaMTX exactly
          const processRes = await fetch('/api/dashboard/system-metrics/processes', { headers });
          if (processRes.ok) {
            const processData = await processRes.json();
            setProcessMetrics(processData);
          }
        } catch (err) {
          console.error('Failed to fetch data for live streaming report:', err);
        } finally {
          setLoading(false);
        }
      };
      fetchData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const activeStreams = report?.active_streams || 0;
  
  // Projected calculations (Hardware Requirements)
  const estimatedRamMB = activeStreams > 0 ? (activeStreams * 20) + 150 : 150;
  const estimatedNetworkMbps = activeStreams * 4;
  const estimatedDiskWriteMBps = activeStreams * 0.5;
  const cpuCores = activeStreams > 50 ? 4 : (activeStreams > 200 ? 8 : 2);

  // Exact Live Measurements (Finding MediaMTX process)
  let actualRamMB = 0;
  let actualCpuPercent = 0;
  
  if (processMetrics && processMetrics.processes) {
    const infra = processMetrics.processes.infrastructure || [];
    const mediamtxProcess = infra.find(p => (p.service || p.name || '').toLowerCase().includes('mediamtx'));
    if (mediamtxProcess) {
      actualRamMB = mediamtxProcess.ram_mb || 0;
      actualCpuPercent = mediamtxProcess.cpu_percent || 0;
    }
  }

  return (
    <div className="vms-modal-backdrop" onClick={onClose}>
      <div className="vms-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="vms-modal-header">
          <h3>📡 Live Streaming Performance (No AI)</h3>
          <button className="vms-modal-close" onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div className="vms-proc-loading">
            <div className="vms-proc-spinner"></div>
            <span>Gathering Real-Time Measurements...</span>
          </div>
        ) : (
          <div className="vms-modal-body">
            <div className="vms-recommendation-card" style={{ marginBottom: '20px', backgroundColor: '#eef2ff', color: '#333' }}>
              <strong>Info:</strong> This report shows the lightweight hardware requirements required for <strong>routing live video packets only</strong>, bypassing AI processing. It now compares projected hardware specs with the <strong>exact real-time OS usage</strong> of the streaming engine.
            </div>

            <div className="vms-baseline-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h4 style={{ margin: 0 }}>Current Live Streams</h4>
                <span className="vms-status-badge ok">Live Only Mode</span>
              </div>

              <div className="vms-baseline-grid">
                <div>
                  <span className="label">Active Cameras</span>
                  <span className="val" style={{ fontSize: '1.5em', color: '#2563eb' }}>{activeStreams}</span>
                </div>
                <div>
                  <span className="label">Actual RAM Used</span>
                  <span className="val" style={{ color: '#059669' }}>{actualRamMB} MB</span>
                </div>
                <div>
                  <span className="label">Actual CPU Used</span>
                  <span className="val" style={{ color: '#059669' }}>{actualCpuPercent}%</span>
                </div>
                <div>
                  <span className="label">Est. Network (In)</span>
                  <span className="val">{estimatedNetworkMbps} Mbps</span>
                </div>
              </div>
            </div>

            <h4>Projected Hardware Requirements (For Provisioning)</h4>
            <div className="vms-proc-table-wrapper">
              <table className="vms-proc-table">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Requirement for {activeStreams} Streams</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>CPU</strong></td>
                    <td>{cpuCores} Cores</td>
                    <td>Minimal usage (packet routing only). No GPU required.</td>
                  </tr>
                  <tr>
                    <td><strong>RAM</strong></td>
                    <td>{Math.max(4, Math.ceil(estimatedRamMB / 1024))} GB System RAM</td>
                    <td>Calculated requirement vs {actualRamMB} MB actually used right now.</td>
                  </tr>
                  <tr>
                    <td><strong>Network</strong></td>
                    <td>1 Gbps Ethernet</td>
                    <td>Critical. Ensure network switch can handle sustained {estimatedNetworkMbps} Mbps throughput.</td>
                  </tr>
                  <tr>
                    <td><strong>Storage</strong></td>
                    <td>Standard SSD</td>
                    <td>If recording is enabled, ensure storage supports {estimatedDiskWriteMBps} MB/s continuous sequential writes.</td>
                  </tr>
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
