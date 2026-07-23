import React, { useState, useEffect } from 'react';
import './ProcessMetricsPanel.css';

const HardwareScalingReportModal = ({ isOpen, onClose }) => {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      const fetchReport = async () => {
        setLoading(true);
        try {
          const token = localStorage.getItem('token');
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
    system_gpu_status = {}, 
    current_measured_baseline = {}, 
    projections = [], 
    recommendation_summary = "" 
  } = report || {};

  return (
    <div className="vms-modal-backdrop" onClick={onClose}>
      <div className="vms-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="vms-modal-header">
          <h3>VMS Pure CPU Hardware Scaling & Performance Report</h3>
          <button className="vms-modal-close" onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div className="vms-proc-loading">
            <div className="vms-proc-spinner"></div>
            <span>Calculating CPU hardware baseline & scaling requirements...</span>
          </div>
        ) : (
          <div className="vms-modal-body">
            {/* System Mode Indicator Box */}
            <div className="vms-baseline-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h4 style={{ margin: 0 }}>Measured System Baseline & Mode</h4>
                <span className={`vms-status-badge ${system_gpu_status.gpu_active ? 'ok' : 'warn'}`}>
                  {system_gpu_status.mode || 'Pure CPU Software Mode (No GPU)'}
                </span>
              </div>

              <div className="vms-baseline-grid">
                <div>
                  <span className="label">Measured Streams</span>
                  <span className="val">{current_measured_baseline.active_streams_measured || 0} Streams</span>
                </div>
                <div>
                  <span className="label">Avg CPU / Stream</span>
                  <span className="val">{current_measured_baseline.avg_cpu_percent_per_camera}% Core</span>
                </div>
                <div>
                  <span className="label">Avg RAM / Stream</span>
                  <span className="val">{current_measured_baseline.avg_ram_mb_per_camera} MB</span>
                </div>
                <div>
                  <span className="label">Daily Storage / Cam</span>
                  <span className="val">{current_measured_baseline.estimated_daily_storage_per_camera_gb} GB / day</span>
                </div>
              </div>
            </div>

            {/* Pure CPU Projections Table */}
            <h4>Pure CPU Hardware Requirements Scaling Matrix</h4>
            <div className="vms-proc-table-wrapper">
              <table className="vms-proc-table">
                <thead>
                  <tr>
                    <th>Target Cameras</th>
                    <th>Required CPU Cores</th>
                    <th>RAM (GB)</th>
                    <th>Write Bandwidth</th>
                    <th>30-Day Storage</th>
                    <th>GPU Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {projections.map((p) => (
                    <tr key={p.target_cameras}>
                      <td><strong>{p.target_cameras} Cameras</strong></td>
                      <td><strong>{p.cpu_cores_pure_cpu || p.recommended_cpu_cores} Logical Cores</strong></td>
                      <td><strong>{p.recommended_ram_gb} GB RAM</strong></td>
                      <td>{p.write_throughput_mb_s} MB/s ({p.write_throughput_mbps} Mbps)</td>
                      <td><strong>{p.storage_30_days_tb} TB</strong></td>
                      <td>
                        <span className={`vms-status-badge ${(p.gpu_mode || '').includes('Recommended') ? 'warn' : 'ok'}`}>
                          {p.gpu_mode || 'Pure CPU Mode'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Recommendation Alert */}
            <div className="vms-recommendation-card">
              <strong>Scaling Recommendation:</strong> {recommendation_summary}
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

export default HardwareScalingReportModal;
