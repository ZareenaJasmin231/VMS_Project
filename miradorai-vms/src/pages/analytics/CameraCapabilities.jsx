/**
 * Camera Capabilities Component
 * Displays what analytics features a camera supports
 */

import React, { useState, useEffect } from 'react';
import { getDeviceCapabilities, detectCapabilities } from '../../api/analyticsApi';
import './CameraCapabilities.css';

const CameraCapabilities = ({ deviceId, capabilities: propCapabilities }) => {
  const [capabilities, setCapabilities] = useState(propCapabilities);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    if (propCapabilities) {
      setCapabilities(propCapabilities);
    } else if (deviceId) {
      loadCapabilities();
    }
  }, [deviceId, propCapabilities]);

  const loadCapabilities = async () => {
    setLoading(true);
    try {
      const data = await getDeviceCapabilities(deviceId);
      setCapabilities(data);
    } catch (error) {
      console.error('Failed to load capabilities:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const data = await detectCapabilities(deviceId);
      setCapabilities(data);
    } catch (error) {
      console.error('Failed to detect capabilities:', error);
    } finally {
      setDetecting(false);
    }
  };

  const getSupportBadge = (supported) => {
    if (supported) {
      return <span className="support-badge supported">✓ Supported</span>;
    }
    return <span className="support-badge not-supported">✗ Not Supported</span>;
  };

  const getRuleSupportStatus = (ruleType) => {
    if (!capabilities?.supported_rule_types) return false;
    return capabilities.supported_rule_types.includes(ruleType);
  };

  if (loading) {
    return (
      <div className="capabilities-loading">
        <div className="spinner"></div>
        <p>Loading camera capabilities...</p>
      </div>
    );
  }

  return (
    <div className="camera-capabilities">
      <div className="capabilities-header">
        <h2>🎯 Camera Analytics Capabilities</h2>
        <button 
          className="detect-btn" 
          onClick={handleDetect}
          disabled={detecting}
        >
          {detecting ? 'Detecting...' : '🔍 Detect from Camera'}
        </button>
      </div>
      
      {capabilities?.error ? (
        <div className="capabilities-error">
          <p>⚠️ {capabilities.error}</p>
          <button onClick={handleDetect}>Try to Detect</button>
        </div>
      ) : (
        <>
          {/* Core Capabilities */}
          <div className="capabilities-section">
            <h3>Core Features</h3>
            <div className="capabilities-grid">
              <div className="capability-item">
                <span className="capability-name">Rule Engine:</span>
                {getSupportBadge(capabilities?.supports_rules)}
              </div>
              <div className="capability-item">
                <span className="capability-name">Analytics Modules:</span>
                {getSupportBadge(capabilities?.supports_analytics_modules)}
              </div>
              <div className="capability-item">
                <span className="capability-name">Rule Configuration:</span>
                {getSupportBadge(capabilities?.can_configure_rules)}
              </div>
              <div className="capability-item">
                <span className="capability-name">Metadata Streaming:</span>
                {getSupportBadge(capabilities?.supports_metadata)}
              </div>
            </div>
          </div>
          
          {/* Supported Rules */}
          <div className="capabilities-section">
            <h3>Supported Rules</h3>
            <div className="rules-grid-capabilities">
              <div className="rule-support-item">
                <span className="rule-icon">📏</span>
                <span>Line Crossing</span>
                {getSupportBadge(getRuleSupportStatus('tt:LineDetector'))}
              </div>
              <div className="rule-support-item">
                <span className="rule-icon">🔲</span>
                <span>Field Detection</span>
                {getSupportBadge(getRuleSupportStatus('tt:FieldDetector'))}
              </div>
              <div className="rule-support-item">
                <span className="rule-icon">⏱️</span>
                <span>Loitering</span>
                {getSupportBadge(getRuleSupportStatus('tt:LoiteringDetector'))}
              </div>
              <div className="rule-support-item">
                <span className="rule-icon">👁️</span>
                <span>Object Detection</span>
                {getSupportBadge(getRuleSupportStatus('tt:ObjectDetection'))}
              </div>
              <div className="rule-support-item">
                <span className="rule-icon">😀</span>
                <span>Face Recognition</span>
                {getSupportBadge(getRuleSupportStatus('tt:FaceRecognition'))}
              </div>
              <div className="rule-support-item">
                <span className="rule-icon">🚗</span>
                <span>License Plate</span>
                {getSupportBadge(getRuleSupportStatus('tt:LicensePlateRecognition'))}
              </div>
              <div className="rule-support-item">
                <span className="rule-icon">🔢</span>
                <span>Line Counting</span>
                {getSupportBadge(getRuleSupportStatus('tt:LineCounting'))}
              </div>
              <div className="rule-support-item">
                <span className="rule-icon">👥</span>
                <span>Occupancy</span>
                {getSupportBadge(getRuleSupportStatus('tt:OccupancyCounting'))}
              </div>
            </div>
          </div>
          
          {/* Limits */}
          <div className="capabilities-section">
            <h3>Limits</h3>
            <div className="limits-grid">
              <div className="limit-item">
                <span className="limit-label">Maximum Rules:</span>
                <span className="limit-value">{capabilities?.max_rules || 'Unknown'}</span>
              </div>
              <div className="limit-item">
                <span className="limit-label">Image Sending:</span>
                <span className="limit-value">
                  {capabilities?.image_sending_types?.join(', ') || 'Not specified'}
                </span>
              </div>
            </div>
          </div>
          
          {/* Summary */}
          <div className="capabilities-summary">
            <div className="summary-card">
              <div className="summary-icon">
                {capabilities?.supports_rules ? '✅' : '⚠️'}
              </div>
              <div className="summary-text">
                {capabilities?.supports_rules ? (
                  <p>This camera supports ONVIF analytics rules. You can create and manage rules directly on the camera.</p>
                ) : (
                  <p>This camera does not support ONVIF analytics rules. Rules will be processed server-side.</p>
                )}
              </div>
            </div>
          </div>
          
          {capabilities?.last_updated && (
            <div className="capabilities-footer">
              Last updated: {new Date(capabilities.last_updated).toLocaleString()}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CameraCapabilities;