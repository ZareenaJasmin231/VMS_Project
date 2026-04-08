/**
 * Rules Manager Component
 * Create, edit, and delete analytics rules
 */

import React, { useState } from 'react';
import useAnalytics from '../../hooks/useAnalytics';
import RuleCard from '../../components/analytics/RuleCard';
import LineDrawer from '../../components/analytics/LineDrawer';
import PolygonDrawer from '../../components/analytics/PolygonDrawer';
import './RulesManager.css';

const RulesManager = ({ deviceId, configToken, rules, loading }) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedRuleType, setSelectedRuleType] = useState('');
  const [ruleForm, setRuleForm] = useState({
    rule_name: '',
    rule_type: '',
    parameters: {}
  });
  const [drawingMode, setDrawingMode] = useState(null); // 'line', 'polygon'
  const [drawnPoints, setDrawnPoints] = useState([]);
  
  const { 
    createRule, 
    updateRule, 
    deleteRule, 
    ruleOptions,
    capabilities 
  } = useAnalytics(deviceId, configToken);

  // Get available rule types based on device capabilities
  const getAvailableRuleTypes = () => {
    if (capabilities?.supported_rule_types) {
      return capabilities.supported_rule_types;
    }
    // Default rule types
    return [
      'tt:LineDetector',
      'tt:FieldDetector',
      'tt:LoiteringDetector',
      'tt:ObjectDetection',
      'tt:FaceRecognition',
      'tt:LicensePlateRecognition'
    ];
  };

  const getRuleTypeName = (type) => {
    const names = {
      'tt:LineDetector': 'Line Crossing Detector',
      'tt:FieldDetector': 'Field/Area Detector',
      'tt:LoiteringDetector': 'Loitering Detector',
      'tt:ObjectDetection': 'Object Detection',
      'tt:FaceRecognition': 'Face Recognition',
      'tt:LicensePlateRecognition': 'License Plate Recognition',
      'tt:LineCounting': 'Line Crossing Counter',
      'tt:OccupancyCounting': 'Occupancy Counter'
    };
    return names[type] || type;
  };

  const handleRuleTypeChange = (type) => {
    setSelectedRuleType(type);
    setRuleForm({
      ...ruleForm,
      rule_type: type,
      parameters: {}
    });
    
    // Reset drawing mode
    setDrawingMode(null);
    setDrawnPoints([]);
  };

  const handleCreateRule = async () => {
    if (!ruleForm.rule_name || !ruleForm.rule_type) {
      alert('Please fill in rule name and type');
      return;
    }
    
    const result = await createRule(ruleForm);
    if (result) {
      setShowCreateModal(false);
      setRuleForm({ rule_name: '', rule_type: '', parameters: {} });
      setDrawingMode(null);
      setDrawnPoints([]);
    }
  };

  const handleDrawingComplete = (points) => {
    if (selectedRuleType === 'tt:LineDetector') {
      setRuleForm({
        ...ruleForm,
        parameters: {
          ...ruleForm.parameters,
          Segments: { points }
        }
      });
    } else if (selectedRuleType === 'tt:FieldDetector' || selectedRuleType === 'tt:LoiteringDetector') {
      setRuleForm({
        ...ruleForm,
        parameters: {
          ...ruleForm.parameters,
          Field: { points }
        }
      });
    }
    setDrawingMode(null);
  };

  const renderRuleForm = () => {
    const options = ruleOptions[selectedRuleType] || {};
    
    return (
      <div className="rule-form-container">
        <h3>Configure {getRuleTypeName(selectedRuleType)}</h3>
        
        {/* Rule Name */}
        <div className="form-group">
          <label>Rule Name:</label>
          <input
            type="text"
            value={ruleForm.rule_name}
            onChange={(e) => setRuleForm({ ...ruleForm, rule_name: e.target.value })}
            placeholder="e.g., FrontGate_Line"
            required
          />
        </div>
        
        {/* Drawing Area for Geometry Rules */}
        {(selectedRuleType === 'tt:LineDetector' || 
          selectedRuleType === 'tt:FieldDetector' || 
          selectedRuleType === 'tt:LoiteringDetector') && (
          <div className="drawing-area">
            <label>Draw on Camera View:</label>
            <div className="drawing-preview">
              {selectedRuleType === 'tt:LineDetector' && (
                <LineDrawer
                  onComplete={handleDrawingComplete}
                  existingPoints={ruleForm.parameters?.Segments?.points}
                />
              )}
              {(selectedRuleType === 'tt:FieldDetector' || selectedRuleType === 'tt:LoiteringDetector') && (
                <PolygonDrawer
                  onComplete={handleDrawingComplete}
                  existingPoints={ruleForm.parameters?.Field?.points}
                />
              )}
            </div>
          </div>
        )}
        
        {/* Class Filter for Object Detection */}
        {(selectedRuleType === 'tt:ObjectDetection' || selectedRuleType === 'tt:LineDetector') && (
          <div className="form-group">
            <label>Object Classes to Detect:</label>
            <div className="checkbox-group">
              {['Person', 'Vehicle', 'Face', 'LicensePlate', 'Animal', 'Bicycle'].map(cls => (
                <label key={cls}>
                  <input
                    type="checkbox"
                    checked={(ruleForm.parameters.ClassFilter || []).includes(cls)}
                    onChange={(e) => {
                      let filter = ruleForm.parameters.ClassFilter || [];
                      if (e.target.checked) {
                        filter.push(cls);
                      } else {
                        filter = filter.filter(c => c !== cls);
                      }
                      setRuleForm({
                        ...ruleForm,
                        parameters: { ...ruleForm.parameters, ClassFilter: filter }
                      });
                    }}
                  />
                  {cls}
                </label>
              ))}
            </div>
          </div>
        )}
        
        {/* Direction for Line Detector */}
        {selectedRuleType === 'tt:LineDetector' && (
          <div className="form-group">
            <label>Direction:</label>
            <select
              value={ruleForm.parameters.Direction || 'Any'}
              onChange={(e) => setRuleForm({
                ...ruleForm,
                parameters: { ...ruleForm.parameters, Direction: e.target.value }
              })}
            >
              <option value="Any">Any Direction</option>
              <option value="Left">Left to Right</option>
              <option value="Right">Right to Left</option>
            </select>
          </div>
        )}
        
        {/* Time Threshold for Loitering */}
        {selectedRuleType === 'tt:LoiteringDetector' && (
          <div className="form-group">
            <label>Loitering Time Threshold:</label>
            <select
              value={ruleForm.parameters.TimeThreshold || 'PT30S'}
              onChange={(e) => setRuleForm({
                ...ruleForm,
                parameters: { ...ruleForm.parameters, TimeThreshold: e.target.value }
              })}
            >
              <option value="PT10S">10 seconds</option>
              <option value="PT30S">30 seconds</option>
              <option value="PT1M">1 minute</option>
              <option value="PT5M">5 minutes</option>
            </select>
          </div>
        )}
        
        {/* Confidence Level */}
        {(selectedRuleType === 'tt:ObjectDetection' || selectedRuleType === 'tt:FaceRecognition') && (
          <div className="form-group">
            <label>Confidence Threshold: {Math.round((ruleForm.parameters.ConfidenceLevel || 0.5) * 100)}%</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={ruleForm.parameters.ConfidenceLevel || 0.5}
              onChange={(e) => setRuleForm({
                ...ruleForm,
                parameters: { ...ruleForm.parameters, ConfidenceLevel: parseFloat(e.target.value) }
              })}
            />
          </div>
        )}
        
        {/* Country for LPR */}
        {selectedRuleType === 'tt:LicensePlateRecognition' && (
          <div className="form-group">
            <label>Country:</label>
            <select
              value={ruleForm.parameters.Country || 'US'}
              onChange={(e) => setRuleForm({
                ...ruleForm,
                parameters: { ...ruleForm.parameters, Country: e.target.value }
              })}
            >
              <option value="US">United States</option>
              <option value="GB">United Kingdom</option>
              <option value="DE">Germany</option>
              <option value="FR">France</option>
              <option value="JP">Japan</option>
              <option value="CN">China</option>
            </select>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rules-manager">
      <div className="rules-header">
        <h2>⚙️ Analytics Rules</h2>
        <button 
          className="create-rule-btn"
          onClick={() => setShowCreateModal(true)}
        >
          + Create New Rule
        </button>
      </div>
      
      {loading && <div className="loading">Loading rules...</div>}
      
      {!loading && rules.length === 0 && (
        <div className="no-rules">
          <div className="no-rules-icon">📋</div>
          <p>No analytics rules configured yet</p>
          <button onClick={() => setShowCreateModal(true)}>
            Create Your First Rule
          </button>
        </div>
      )}
      
      <div className="rules-grid">
        {rules.map(rule => (
          <RuleCard
            key={rule.rule_name}
            rule={rule}
            onUpdate={updateRule}
            onDelete={deleteRule}
            deviceId={deviceId}
            configToken={configToken}
          />
        ))}
      </div>
      
      {/* Create Rule Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create Analytics Rule</h2>
              <button className="close-btn" onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            
            <div className="modal-body">
              {!selectedRuleType ? (
                <div className="rule-type-selector">
                  <h3>Select Rule Type</h3>
                  <div className="rule-types-grid">
                    {getAvailableRuleTypes().map(type => (
                      <div
                        key={type}
                        className="rule-type-card"
                        onClick={() => handleRuleTypeChange(type)}
                      >
                        <div className="rule-type-icon">
                          {type === 'tt:LineDetector' && '📏'}
                          {type === 'tt:FieldDetector' && '🔲'}
                          {type === 'tt:LoiteringDetector' && '⏱️'}
                          {type === 'tt:ObjectDetection' && '👁️'}
                          {type === 'tt:FaceRecognition' && '😀'}
                          {type === 'tt:LicensePlateRecognition' && '🚗'}
                          {type === 'tt:LineCounting' && '🔢'}
                          {type === 'tt:OccupancyCounting' && '👥'}
                        </div>
                        <div className="rule-type-name">{getRuleTypeName(type)}</div>
                        <div className="rule-type-desc">
                          {type === 'tt:LineDetector' && 'Trigger when objects cross a line'}
                          {type === 'tt:FieldDetector' && 'Detect objects entering/exiting an area'}
                          {type === 'tt:LoiteringDetector' && 'Alert when objects linger too long'}
                          {type === 'tt:ObjectDetection' && 'Detect specific object types'}
                          {type === 'tt:FaceRecognition' && 'Recognize faces from database'}
                          {type === 'tt:LicensePlateRecognition' && 'Read and recognize license plates'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                renderRuleForm()
              )}
            </div>
            
            <div className="modal-footer">
              {selectedRuleType && (
                <>
                  <button 
                    className="back-btn"
                    onClick={() => {
                      setSelectedRuleType('');
                      setRuleForm({ rule_name: '', rule_type: '', parameters: {} });
                    }}
                  >
                    ← Back
                  </button>
                  <button 
                    className="create-btn"
                    onClick={handleCreateRule}
                  >
                    Create Rule
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RulesManager;