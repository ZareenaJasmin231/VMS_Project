import { useState, useEffect } from "react";
import Button from "../../components/shared/Button";
import Toggle from "../../components/shared/Toggle";
import "./IntegrationPage.css";
// Re-use UserSettingsPage styles for a consistent look
import "./UserSettingsPage.css"; 

function generateRandomId() {
  return Math.random().toString().slice(2, 18).padEnd(16, "0");
}

function Section({ title, children }) {
  return (
    <div className="us-section">
      <div className="us-section__title">{title}</div>
      <div className="us-section__body">{children}</div>
    </div>
  );
}

function SettingRow({ label, children }) {
  return (
    <div className="us-row">
      <span className="us-row__label">{label}</span>
      <div className="us-row__control">{children}</div>
    </div>
  );
}

export default function IntegrationPage() {
  const [connections, setConnections] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  // Form state
  const [formData, setFormData] = useState({
    id: generateRandomId(),
    type: "",
    isActive: true,
    serverName: "",
    serverIp: "",
    isConnected: false,
    host: "",
    port: "",
    username: "",
    password: "",
    streams: []
  });

  const fetchIntegrations = async () => {
    try {
      const token = localStorage.getItem("token");
      const headers = { Authorization: token ? `Bearer ${token}` : "" };
      const API_BASE = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${API_BASE}/api/integrations`, { headers });
      if (res.ok) {
        const data = await res.json();
        setConnections(data);
      }
    } catch (err) {
      console.error("Failed to fetch integrations", err);
    }
  };

  useEffect(() => {
    fetchIntegrations();
  }, []);

  const handleNewConnection = () => {
    setFormData({
      id: generateRandomId(),
      type: "",
      isActive: true,
      serverName: "",
      serverIp: "",
      isConnected: false,
      host: "",
      port: "",
      username: "",
      password: "",
      streams: []
    });
    setFormErrors({});
    setShowForm(true);
  };

  const handleEditConnection = (conn) => {
    setFormData({ ...conn });
    setFormErrors({});
    setShowForm(true);
  };

  const handleAddStream = () => {
    setFormData({
      ...formData,
      streams: [...formData.streams, { id: Date.now(), name: "", value: "" }]
    });
  };

  const handleRemoveStream = (id) => {
    setFormData({
      ...formData,
      streams: formData.streams.filter(s => s.id !== id)
    });
  };

  const handleStreamChange = (id, field, value) => {
    setFormData({
      ...formData,
      streams: formData.streams.map(s => s.id === id ? { ...s, [field]: value } : s)
    });
  };

  const handleDeleteConnection = async (id) => {
    try {
      const token = localStorage.getItem("token");
      const headers = { Authorization: token ? `Bearer ${token}` : "" };
      const API_BASE = import.meta.env.VITE_API_URL || "";
      await fetch(`${API_BASE}/api/integrations/${id}`, { method: "DELETE", headers });
      setConnections(connections.filter(c => c.id !== id));
    } catch (err) {
      console.error("Failed to delete integration", err);
    }
  };

  const handleSave = async () => {
    // Validation
    let errors = {};
    
    if (!formData.type.trim()) {
      errors.type = "Integration Type is required.";
    } else if (!/^[a-zA-Z0-9\s-_]+$/.test(formData.type.trim())) {
      errors.type = "Type contains invalid characters.";
    } else if (/^\d+$/.test(formData.type.trim())) {
      errors.type = "Type cannot be only numbers.";
    }

    if (!formData.serverName?.trim()) {
      errors.serverName = "Server Name is required.";
    }

    if (!formData.serverIp.trim()) {
      errors.serverIp = "Server IP is required.";
    } else {
      const ipRegex = /^(((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,11}|localhost|[a-zA-Z0-9-_]+)(:\d+)?$/;
      if (!ipRegex.test(formData.serverIp.trim())) {
        errors.serverIp = "Enter a valid IP address or hostname (port is optional).";
      }
    }

    if (!formData.host.trim()) {
      errors.host = "Host Address is required.";
    } else {
      const hostRegex = /^(((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,11}|localhost|[a-zA-Z0-9-_]+)(:\d+)?$/;
      if (!hostRegex.test(formData.host.trim())) {
        errors.host = "Enter a valid IP address or hostname.";
      }
    }

    if (!formData.port.trim()) {
      errors.port = "Port is required.";
    } else if (!/^\d+$/.test(formData.port.trim()) || parseInt(formData.port.trim(), 10) < 1 || parseInt(formData.port.trim(), 10) > 65535) {
      errors.port = "Port must be a number between 1 and 65535.";
    }
    
    let hasStreamError = false;
    for (let stream of formData.streams) {
      if (!stream.name.trim() || !stream.value.trim()) {
        hasStreamError = true;
      }
    }
    if (hasStreamError) {
      errors.streams = "All streams must have a Name and a Topic/Key.";
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setFormErrors({});

    try {
      const token = localStorage.getItem("token");
      const headers = { 
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "" 
      };
      
      const API_BASE = import.meta.env.VITE_API_URL || "";
      const exists = connections.find(c => c.id === formData.id);
      
      const res = await fetch(`${API_BASE}/api/integrations${exists ? `/${formData.id}` : ''}`, {
        method: exists ? "PUT" : "POST",
        headers,
        body: JSON.stringify(formData)
      });
      
      if (res.ok) {
        fetchIntegrations();
        setShowForm(false);
      } else {
        console.error("Failed to save integration");
      }
    } catch (err) {
      console.error("Error saving integration", err);
    }
  };

  const handleCancel = () => {
    setFormErrors({});
    setShowForm(false);
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            Integration <span>Settings</span>
          </h1>
          <p className="page-desc">Manage third-party integrations and connections.</p>
        </div>
        {!showForm && (
          <Button label="New Connection" onClick={handleNewConnection} />
        )}
      </div>

      <div className="us-body">
        {!showForm ? (
          <div className="integration-card">
          <h1 className="page-title" style={{ margin: "0" }}>
            Configured <span>Connections</span>
          </h1>
          {connections.length === 0 ? (
            <p className="page-desc" style={{ marginTop: "4px" }}>
              No connections configured. Click "New Connection" to add one.
            </p>
          ) : (
            <table className="integration-table" style={{ marginTop: "16px" }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Type</th>
                  <th>Server Name</th>
                  <th>Server IP</th>
                  <th>Host</th>
                  <th>Port</th>
                  <th style={{ width: "120px" }}>Status</th>
                  <th style={{ width: "60px", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((conn) => (
                  <tr key={conn.id}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}>{conn.id}</td>
                    <td style={{ fontWeight: 500 }}>{conn.type}</td>
                    <td>{conn.serverName || "-"}</td>
                    <td>{conn.serverIp || "-"}</td>
                    <td>{conn.host || "-"}</td>
                    <td>{conn.port || "-"}</td>
                    <td>
                      <div className={`status-badge ${conn.isActive ? "active" : ""}`}>
                        {conn.isActive ? "ACTIVE" : "INACTIVE"}
                      </div>
                    </td>
                    <td style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "8px", height: "100%" }}>
                      <button 
                        className="connection-action-btn edit-btn" 
                        onClick={() => handleEditConnection(conn)}
                        title="Edit Connection"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                      </button>
                      <button 
                        className="connection-action-btn delete-btn" 
                        onClick={() => handleDeleteConnection(conn.id)}
                        title="Delete Connection"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>
        ) : (
          <div className="integration-form">
            <Section title="General Settings">
              <SettingRow label="Connection ID">
                <input type="text" className="integration-input read-only" value={formData.id} readOnly />
              </SettingRow>
              <SettingRow label="Integration Type">
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
                  <input 
                    type="text" 
                    className="integration-input" 
                    value={formData.type} 
                    onChange={(e) => {
                      setFormData({ ...formData, type: e.target.value });
                      if (formErrors.type) setFormErrors({ ...formErrors, type: null });
                    }} 
                    placeholder="e.g. Redis, MQTT, Kafka"
                    style={formErrors.type ? { borderColor: "var(--red)" } : {}}
                  />
                  {formErrors.type && <span style={{ color: "var(--red)", fontSize: "13px" }}>{formErrors.type}</span>}
                </div>
              </SettingRow>
              <SettingRow label="Server Name">
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
                  <input 
                    type="text" 
                    className="integration-input" 
                    value={formData.serverName || ""} 
                    onChange={(e) => {
                      setFormData({ ...formData, serverName: e.target.value });
                      if (formErrors.serverName) setFormErrors({ ...formErrors, serverName: null });
                    }} 
                    placeholder="e.g. Main AI Server"
                    style={formErrors.serverName ? { borderColor: "var(--red)" } : {}}
                  />
                  {formErrors.serverName && <span style={{ color: "var(--red)", fontSize: "13px" }}>{formErrors.serverName}</span>}
                </div>
              </SettingRow>
              <SettingRow label="Server IP">
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
                  <div style={{ display: "flex", gap: "8px", width: "100%" }}>
                    <input 
                      type="text" 
                      className="integration-input" 
                      value={formData.serverIp} 
                      onChange={(e) => {
                        setFormData({ ...formData, serverIp: e.target.value, isConnected: false });
                        if (formErrors.serverIp) setFormErrors({ ...formErrors, serverIp: null });
                      }} 
                      placeholder="e.g. 192.168.126.201"
                      style={{ flex: 1, ...(formErrors.serverIp ? { borderColor: "var(--red)" } : {}) }}
                    />
                    <Button 
                      label={formData.isConnected ? "Connected" : "Connect"} 
                      onClick={async () => {
                        if (!formData.serverIp.trim()) return setFormErrors({ ...formErrors, serverIp: "Enter an IP first" });
                        try {
                          const token = localStorage.getItem("token");
                          const res = await fetch(`${import.meta.env.VITE_API_URL || ""}/api/integrations/ping`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json", Authorization: token ? `Bearer ${token}` : "" },
                            body: JSON.stringify({ serverIp: formData.serverIp.trim() })
                          });
                          if (res.ok) {
                            setFormData({ ...formData, isConnected: true });
                            setFormErrors({ ...formErrors, serverIp: null });
                          } else {
                            setFormData({ ...formData, isConnected: false });
                            setFormErrors({ ...formErrors, serverIp: "Could not reach IP" });
                          }
                        } catch (err) {
                          setFormData({ ...formData, isConnected: false });
                          setFormErrors({ ...formErrors, serverIp: "Connection failed" });
                        }
                      }}
                      variant={formData.isConnected ? "primary" : "secondary"}
                    />
                  </div>
                  {formErrors.serverIp && <span style={{ color: "var(--red)", fontSize: "13px" }}>{formErrors.serverIp}</span>}
                </div>
              </SettingRow>
              <SettingRow label="Status">
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ 
                    fontSize: "15px", 
                    fontWeight: 600, 
                    color: formData.isActive ? "var(--teal)" : "var(--text-primary)" 
                  }}>
                    {formData.isActive ? "ACTIVE" : "INACTIVE"}
                  </span>
                  <Toggle 
                    value={formData.isActive} 
                    onChange={(v) => setFormData({ ...formData, isActive: v })} 
                  />
                </div>
              </SettingRow>
            </Section>

            <Section title="Connection Details">
              <SettingRow label="Host Address">
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <input 
                    type="text" 
                    className="integration-input" 
                    value={formData.host} 
                    onChange={(e) => {
                      setFormData({ ...formData, host: e.target.value });
                      if (formErrors.host) setFormErrors({ ...formErrors, host: null });
                    }} 
                    placeholder="e.g. 127.0.0.1"
                    style={formErrors.host ? { borderColor: "var(--red)" } : {}}
                  />
                  {formErrors.host && <span style={{ color: "var(--red)", fontSize: "13px" }}>{formErrors.host}</span>}
                </div>
              </SettingRow>
              <SettingRow label="Port">
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <input 
                    type="text" 
                    className="integration-input" 
                    value={formData.port} 
                    onChange={(e) => {
                      setFormData({ ...formData, port: e.target.value });
                      if (formErrors.port) setFormErrors({ ...formErrors, port: null });
                    }} 
                    placeholder="e.g. 6379"
                    style={formErrors.port ? { borderColor: "var(--red)" } : {}}
                  />
                  {formErrors.port && <span style={{ color: "var(--red)", fontSize: "13px" }}>{formErrors.port}</span>}
                </div>
              </SettingRow>
              <SettingRow label="Username (Optional)">
                <input 
                  type="text" 
                  className="integration-input" 
                  value={formData.username} 
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })} 
                  placeholder="Enter username"
                />
              </SettingRow>
              <SettingRow label="Password (Optional)">
                <input 
                  type="password" 
                  className="integration-input" 
                  value={formData.password} 
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })} 
                  placeholder="Enter password"
                />
              </SettingRow>
            </Section>

            <Section title="Topics / Streams">
              <div style={{ marginBottom: "16px" }}>
                <Button label="+ Add Stream" onClick={handleAddStream} variant="secondary" size="small" />
                {formErrors.streams && <span style={{ color: "var(--red)", fontSize: "14px", marginLeft: "12px" }}>{formErrors.streams}</span>}
              </div>
              
              {formData.streams.length === 0 ? (
                <p style={{ color: "var(--text-primary)", fontSize: "16px", fontStyle: "italic", margin: "0 0 16px 0" }}>
                  No streams configured.
                </p>
              ) : (
                <div className="integration-streams">
                  {formData.streams.map((stream) => (
                    <div key={stream.id} className="stream-row">
                      <input 
                        type="text" 
                        className="integration-input" 
                        value={stream.name} 
                        onChange={(e) => handleStreamChange(stream.id, "name", e.target.value)} 
                        placeholder="Stream Name (e.g. Camera Events)"
                      />
                      <input 
                        type="text" 
                        className="integration-input" 
                        value={stream.value} 
                        onChange={(e) => handleStreamChange(stream.id, "value", e.target.value)} 
                        placeholder="Topic / Key (e.g. vms:events)"
                      />
                      <button className="stream-remove-btn" onClick={() => handleRemoveStream(stream.id)} title="Remove Stream">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <div className="integration-actions">
              <Button label="Cancel" onClick={handleCancel} variant="secondary" />
              <Button label="Save Connection" onClick={handleSave} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}




