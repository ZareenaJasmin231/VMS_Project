/**
 * Main Analytics Dashboard Page
 * Displays analytics overview, statistics, and rule management
 */

import React, { useState, useEffect } from 'react';
import useAnalytics from '../../hooks/useAnalytics';
import RulesManager from './RulesManager';
import CameraCapabilities from './CameraCapabilities';
import './AnalyticsPage.css';

const AnalyticsPage = ({ onNavigate }) => {
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [selectedConfigToken, setSelectedConfigToken] = useState('default');
  const [devices, setDevices] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');

  const {
    loading,
    error,
    rules,
    events,
    statistics,
    capabilities,
    acknowledgeEvent,
    refreshStatistics,
  } = useAnalytics(selectedDeviceId, selectedConfigToken);

  // Fetch devices from main API - FIXED ENDPOINT
  useEffect(() => {
    const fetchDevices = async () => {
      try {
        // Changed from /api/devices to /api/cameras
        const response = await fetch('/api/cameras');
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Fetched cameras:', data);
        
        setDevices(data || []);
        if (data && data.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(data[0].ip || data[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch devices:', err);
      }
    };
    fetchDevices();
  }, [selectedDeviceId]);

  // Auto-refresh statistics every 30 seconds
  useEffect(() => {
    if (activeTab === 'overview' && selectedDeviceId) {
      const interval = setInterval(() => {
        refreshStatistics();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [activeTab, selectedDeviceId, refreshStatistics]);

  const handleDeviceChange = (deviceId) => {
    setSelectedDeviceId(deviceId);
    setActiveTab('overview');
  };

  const getEventIcon = (eventType) => {
    switch (eventType) {
      case 'crossed': return '🚶';
      case 'loitering': return '⏱️';
      case 'object_detected': return '👁️';
      case 'face_match': return '😀';
      case 'plate_match': return '🚗';
      case 'motion': return '🎬';
      default: return '📢';
    }
  };

  const getEventColor = (eventType) => {
    switch (eventType) {
      case 'crossed': return '#f59e0b';
      case 'loitering': return '#ef4444';
      case 'object_detected': return '#10b981';
      case 'face_match': return '#8b5cf6';
      case 'plate_match': return '#3b82f6';
      default: return '#6b7280';
    }
  };

  return (
    <div className="analytics-page">
      {/* Header */}
      <div className="analytics-header">
        <h1>📊 Video Analytics</h1>
        <div className="device-selector">
          <label>Camera:</label>
          <select 
            value={selectedDeviceId || ''} 
            onChange={(e) => handleDeviceChange(e.target.value)}
          >
            <option value="">Select a camera</option>
            {devices.map(device => (
              <option key={device.ip || device.id} value={device.ip || device.id}>
                {device.name || device.device_name || device.ip || device.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      {selectedDeviceId && (
        <div className="analytics-tabs">
          <button 
            className={activeTab === 'overview' ? 'active' : ''}
            onClick={() => setActiveTab('overview')}
          >
            📈 Overview
          </button>
          <button 
            className={activeTab === 'rules' ? 'active' : ''}
            onClick={() => setActiveTab('rules')}
          >
            ⚙️ Rules
          </button>
          <button 
            className={activeTab === 'events' ? 'active' : ''}
            onClick={() => setActiveTab('events')}
          >
            🔔 Events
          </button>
          <button 
            className={activeTab === 'capabilities' ? 'active' : ''}
            onClick={() => setActiveTab('capabilities')}
          >
            🎯 Capabilities
          </button>
        </div>
      )}

      {/* Content */}
      {error && (
        <div className="analytics-error">
          ⚠️ {error}
        </div>
      )}

      {loading && !statistics && (
        <div className="analytics-loading">
          <div className="spinner"></div>
          <p>Loading analytics data...</p>
        </div>
      )}

      {selectedDeviceId && activeTab === 'overview' && statistics && (
        <div className="analytics-overview">
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon">📋</div>
              <div className="stat-info">
                <div className="stat-value">{statistics.active_rules || 0}</div>
                <div className="stat-label">Active Rules</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">🔔</div>
              <div className="stat-info">
                <div className="stat-value">{statistics.total_events || 0}</div>
                <div className="stat-label">Events (7 days)</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">👁️</div>
              <div className="stat-info">
                <div className="stat-value">{statistics.total_objects_detected || 0}</div>
                <div className="stat-label">Objects Detected</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">😀</div>
              <div className="stat-info">
                <div className="stat-value">{statistics.face_matches || 0}</div>
                <div className="stat-label">Face Matches</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">🚗</div>
              <div className="stat-info">
                <div className="stat-value">{statistics.lpr_matches || 0}</div>
                <div className="stat-label">License Plates</div>
              </div>
            </div>
          </div>

          <div className="chart-section">
            <h3>Events by Type</h3>
            <div className="events-chart">
              {statistics.events_by_type && Object.entries(statistics.events_by_type).map(([type, count]) => (
                <div key={type} className="chart-bar">
                  <div className="chart-label">{type}</div>
                  <div className="chart-bar-container">
                    <div 
                      className="chart-bar-fill"
                      style={{ 
                        width: `${(count / statistics.total_events) * 100}%`,
                        backgroundColor: getEventColor(type)
                      }}
                    />
                  </div>
                  <div className="chart-count">{count}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="chart-section">
            <h3>Objects Detected by Class</h3>
            <div className="objects-grid">
              {statistics.objects_by_class && Object.entries(statistics.objects_by_class).map(([className, count]) => (
                <div key={className} className="object-card">
                  <div className="object-icon">
                    {className === 'Person' && '👤'}
                    {className === 'Vehicle' && '🚗'}
                    {className === 'Face' && '😀'}
                    {className === 'LicensePlate' && '🔢'}
                    {!['Person', 'Vehicle', 'Face', 'LicensePlate'].includes(className) && '📦'}
                  </div>
                  <div className="object-name">{className}</div>
                  <div className="object-count">{count}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedDeviceId && activeTab === 'rules' && (
        <RulesManager 
          deviceId={selectedDeviceId} 
          configToken={selectedConfigToken}
          rules={rules}
          loading={loading}
        />
      )}

      {selectedDeviceId && activeTab === 'events' && (
        <div className="events-section">
          <h2>Recent Events</h2>
          <div className="events-list">
            {events.length === 0 && !loading && (
              <div className="no-events">No events yet</div>
            )}
            {events.map(event => (
              <div key={event._id} className={`event-item ${event.is_acknowledged ? 'acknowledged' : ''}`}>
                <div className="event-icon" style={{ backgroundColor: getEventColor(event.event_type) }}>
                  {getEventIcon(event.event_type)}
                </div>
                <div className="event-details">
                  <div className="event-title">
                    <strong>{event.rule_name}</strong>
                    <span className="event-type">{event.event_type}</span>
                  </div>
                  <div className="event-time">
                    {new Date(event.triggered_at).toLocaleString()}
                  </div>
                  {event.object_ids?.length > 0 && (
                    <div className="event-objects">
                      Objects: {event.object_ids.join(', ')}
                    </div>
                  )}
                </div>
                {!event.is_acknowledged && (
                  <button 
                    className="acknowledge-btn"
                    onClick={() => acknowledgeEvent(event._id)}
                  >
                    Acknowledge
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedDeviceId && activeTab === 'capabilities' && (
        <CameraCapabilities 
          deviceId={selectedDeviceId}
          capabilities={capabilities}
        />
      )}
    </div>
  );
};

export default AnalyticsPage;