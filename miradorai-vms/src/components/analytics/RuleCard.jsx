/**
 * Rule Card Component
 * Displays individual rule with edit/delete actions
 */

import React, { useState } from 'react';
import './RuleCard.css';

const RuleCard = ({ rule, onUpdate, onDelete, deviceId, configToken }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isActive, setIsActive] = useState(rule.is_active);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const getRuleIcon = (ruleType) => {
    const icons = {
      'tt:LineDetector': '📏',
      'tt:FieldDetector': '🔲',
      'tt:LoiteringDetector': '⏱️',
      'tt:ObjectDetection': '👁️',
      'tt:FaceRecognition': '😀',
      'tt:LicensePlateRecognition': '🚗',
      'tt:LineCounting': '🔢',
      'tt:OccupancyCounting': '👥'
    };
    return icons[ruleType] || '📋';
  };

  const getRuleTypeName = (ruleType) => {
    const names = {
      'tt:LineDetector': 'Line Crossing',
      'tt:FieldDetector': 'Field Detector',
      'tt:LoiteringDetector': 'Loitering',
      'tt:ObjectDetection': 'Object Detection',
      'tt:FaceRecognition': 'Face Recognition',
      'tt:LicensePlateRecognition': 'License Plate',
      'tt:LineCounting': 'Line Counter',
      'tt:OccupancyCounting': 'Occupancy'
    };
    return names[ruleType] || ruleType;
  };

  const handleToggleActive = async () => {
    const newState = !isActive;
    const success = await onUpdate(rule.rule_name, { is_active: newState });
    if (success) {
      setIsActive(newState);
    }
  };

  const handleDelete = async () => {
    const success = await onDelete(rule.rule_name);
    if (success) {
      setShowDeleteConfirm(false);
    }
  };

  const formatParameter = (key, value) => {
    if (key === 'Direction') return `Direction: ${value}`;
    if (key === 'ClassFilter') return `Classes: ${value.join(', ')}`;
    if (key === 'TimeThreshold') return `Threshold: ${value}`;
    if (key === 'ConfidenceLevel') return `Confidence: ${Math.round(value * 100)}%`;
    if (key === 'Country') return `Country: ${value}`;
    return null;
  };

  const getDisplayParams = () => {
    const params = [];
    for (const [key, value] of Object.entries(rule.parameters)) {
      const formatted = formatParameter(key, value);
      if (formatted) params.push(formatted);
    }
    return params;
  };

  return (
    <div className={`rule-card ${!isActive ? 'inactive' : ''}`}>
      <div className="rule-card-header">
        <div className="rule-icon">{getRuleIcon(rule.rule_type)}</div>
        <div className="rule-info">
          <div className="rule-name">{rule.rule_name}</div>
          <div className="rule-type">{getRuleTypeName(rule.rule_type)}</div>
        </div>
        <div className="rule-actions">
          <button 
            className={`toggle-btn ${isActive ? 'active' : 'inactive'}`}
            onClick={handleToggleActive}
            title={isActive ? 'Disable rule' : 'Enable rule'}
          >
            {isActive ? '✓' : '○'}
          </button>
          <button 
            className="edit-btn"
            onClick={() => setIsEditing(true)}
            title="Edit rule"
          >
            ✎
          </button>
          <button 
            className="delete-btn"
            onClick={() => setShowDeleteConfirm(true)}
            title="Delete rule"
          >
            ×
          </button>
        </div>
      </div>
      
      <div className="rule-card-body">
        {getDisplayParams().length > 0 && (
          <div className="rule-params">
            {getDisplayParams().map((param, idx) => (
              <span key={idx} className="param-tag">{param}</span>
            ))}
          </div>
        )}
        
        {rule.parameters.Segments?.points && (
          <div className="rule-geometry">
            <span className="geometry-badge">
              📏 {rule.parameters.Segments.points.length} points
            </span>
          </div>
        )}
        
        {rule.parameters.Field?.points && (
          <div className="rule-geometry">
            <span className="geometry-badge">
              🔲 {rule.parameters.Field.points.length} points
            </span>
          </div>
        )}
      </div>
      
      <div className="rule-card-footer">
        <div className="rule-meta">
          <span>Created: {new Date(rule.created_at).toLocaleDateString()}</span>
        </div>
      </div>
      
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="confirm-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">⚠️</div>
            <h4>Delete Rule?</h4>
            <p>Are you sure you want to delete "{rule.rule_name}"? This action cannot be undone.</p>
            <div className="confirm-buttons">
              <button onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="confirm-delete" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RuleCard;