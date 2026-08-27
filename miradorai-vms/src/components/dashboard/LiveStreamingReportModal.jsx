import React, { useState, useEffect } from 'react';
import './ProcessMetricsPanel.css';

const LiveStreamingReportModal = ({ isOpen, onClose }) => {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      const fetchReport = async () => {
        setLoading(true);
        try {
          const token = localStorage.getItem('token');
          // We can reuse the hardware scaling report API to get the current number of active streams
          const res = await fetch('/api/dashboard/hardware-scaling-report', {
            headers: { 'Authorization': token ? `Bearer ${token}` : '' }
          });
          const data = await res.json();
          setReport(data);
        } catch (err) {
          console.error('Failed to fetch hardware report:', err);
        } finally {
          setLoading(false);
        }
      };
      fetchReport();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const { 
    current_measured_baseline = {}, 
  } = report || {};

  const activeStreams = current_measured_baseline.active_streams_measured || 0;
  
  // Calculate Live Streaming specs based on active streams
  // RAM: ~20MB per stream (for MediaMTX)
  // Network: ~4 Mbps per stream = 0.5 MB/s
  const estimatedRamMB = activeStreams > 0 ? (activeStreams * 20) + 150 : 150; // base 150MB + 20MB per stream
  const estimatedNetworkMbps = activeStreams * 4;
  const estimatedDiskWriteMBps = activeStreams * 0.5; // if recording
  const cpuCores = activeStreams > 50 ? 4 : (activeStreams > 200 ? 8 : 2); // basic routing CPU

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
            <span>Calculating Live Streaming configurations...</span>
          </div>
        ) : (
          <div className="vms-modal-body">
            <div className="vms-recommendation-card" style={{ marginBottom: '20px', backgroundColor: '#eef2ff', color: '#333' }}>
              <strong>Info:</strong> This report shows the lightweight hardware requirements required for <strong>routing live video packets only</strong> (using MediaMTX), completely bypassing any heavy AI or analytics processing.
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
                  <span className="label">Est. Network (In)</span>
                  <span className="val">{estimatedNetworkMbps} Mbps</span>
                </div>
                <div>
                  <span className="label">Est. RAM Usage</span>
                  <span className="val">{estimatedRamMB} MB</span>
                </div>
                <div>
                  <span className="label">Est. Disk Write (If Rec)</span>
                  <span className="val">{estimatedDiskWriteMBps} MB/s</span>
                </div>
              </div>
            </div>

            <h4>Hardware Specifications Needed</h4>
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
                    <td>MediaMTX buffer allocations (~10-30MB/stream)</td>
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
