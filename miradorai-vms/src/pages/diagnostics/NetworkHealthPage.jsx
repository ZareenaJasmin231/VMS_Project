import React, { useState, useEffect } from "react";
import { 
  Zap, 
  Activity, 
  Globe, 
  ShieldCheck, 
  Search, 
  Terminal, 
  AlertCircle,
  Clock,
  ArrowUp,
  ArrowDown
} from "lucide-react";
import "./NetworkHealthPage.css";

const API_BASE = "http://localhost:80";

const NetworkHealthPage = () => {
  const [data, setData] = useState({ devices: [], bandwidth: { sent_kbps: 0, recv_kbps: 0 } });
  const [loading, setLoading] = useState(true);
  const [diagnosingIp, setDiagnosingIp] = useState("");
  const [diagResult, setDiagResult] = useState(null);
  const [isPinging, setIsPinging] = useState(false);

  useEffect(() => {
    const fetchLatest = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/infrastructure/diagnostics/latest`);
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error("Fetch diagnostics error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchLatest();
    const interval = setInterval(fetchLatest, 5000);
    return () => clearInterval(interval);
  }, []);

  const runInstantCheck = async () => {
    if (!diagnosingIp) return;
    setIsPinging(true);
    setDiagResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/infrastructure/diagnostics/ping/${diagnosingIp}`);
      const json = await res.json();
      setDiagResult(json);
    } catch (err) {
      setDiagResult({ error: "Check failed" });
    } finally {
      setIsPinging(false);
    }
  };

  return (
    <div className="network-health">
      <div className="diagnostics-header">
        <div className="title-group">
          <h2>Network Command Center</h2>
          <p>Real-time infrastructure health and bandwidth monitoring</p>
        </div>
        <div className="bandwidth-summary">
          <div className="bw-item in">
            <ArrowDown size={14} />
            <span>{data.bandwidth.recv_kbps.toLocaleString()} <small>kbps</small></span>
          </div>
          <div className="bw-item out">
            <ArrowUp size={14} />
            <span>{data.bandwidth.sent_kbps.toLocaleString()} <small>kbps</small></span>
          </div>
        </div>
      </div>

      <div className="diagnostics-grid">
        {/* Connectivity Status List */}
        <div className="diag-card connectivity-list">
          <div className="card-header">
            <Activity size={18} />
            <h3>Connectivity Matrix</h3>
          </div>
          <div className="device-table-container">
            <table className="device-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>IP Address</th>
                  <th>Latency</th>
                  <th>Ports</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.devices.map((dev, i) => (
                  <tr key={i}>
                    <td className="dev-name">{dev.name || 'Unknown'}</td>
                    <td className="dev-ip">{dev.ip}</td>
                    <td className="dev-latency">
                      {dev.latency ? (
                        <span className={dev.latency > 100 ? 'bad' : dev.latency > 50 ? 'warn' : 'good'}>
                          {dev.latency}ms
                        </span>
                      ) : '--'}
                    </td>
                    <td className="dev-ports">
                      <span className={`port-tag ${dev.ports.rtsp ? 'open' : ''}`}>RTSP</span>
                      <span className={`port-tag ${dev.ports.http ? 'open' : ''}`}>HTTP</span>
                      <span className={`port-tag ${dev.ports.onvif ? 'open' : ''}`}>ONVIF</span>
                    </td>
                    <td>
                      <span className={`status-pill ${dev.status.toLowerCase()}`}>
                        {dev.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Diagnostic Terminal */}
        <div className="diag-card instant-tool">
          <div className="card-header">
            <Terminal size={18} />
            <h3>Diagnostic Terminal</h3>
          </div>
          <div className="tool-body">
            <p className="tool-hint">Enter an IP to perform a manual connectivity probe.</p>
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Target IP (e.g. 192.168.1.10)"
                value={diagnosingIp}
                onChange={(e) => setDiagnosingIp(e.target.value)}
              />
              <button onClick={runInstantCheck} disabled={isPinging}>
                {isPinging ? 'Probing...' : <Zap size={16} />}
              </button>
            </div>

            {diagResult && (
              <div className="result-area">
                <div className="result-header">
                  <span>Probe Result</span>
                  <Clock size={12} />
                </div>
                <div className={`result-box ${diagResult.status?.toLowerCase()}`}>
                   <p>Target: <strong>{diagResult.ip}</strong></p>
                   <p>Status: <strong>{diagResult.status || 'Error'}</strong></p>
                   {diagResult.latency && <p>Latency: <strong>{diagResult.latency}ms</strong></p>}
                   {diagResult.error && <p className="error">{diagResult.error}</p>}
                </div>
              </div>
            )}
          </div>

          <div className="info-tips">
            <div className="tip-item">
              <ShieldCheck size={14} />
              <span>ONVIF Discovery uses port 8080 by default.</span>
            </div>
            <div className="tip-item">
              <AlertCircle size={14} />
              <span>High latency (&gt;100ms) can cause RTSP jitter.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NetworkHealthPage;
