/**
 * Analytics API Client
 * Handles all analytics-related API calls to the backend
 */

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const analyticsApi = axios.create({
  baseURL: `${API_BASE_URL}/api/analytics`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
analyticsApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ============================================
// Device Capabilities
// ============================================

export const getDeviceCapabilities = async (deviceId) => {
  const response = await analyticsApi.get(`/devices/${deviceId}/capabilities`);
  return response.data;
};

export const detectCapabilities = async (deviceId) => {
  const response = await analyticsApi.get(`/devices/${deviceId}/capabilities/detect`);
  return response.data;
};

// ============================================
// Analytics Configuration
// ============================================

export const createAnalyticsConfig = async (deviceId, configData) => {
  const response = await analyticsApi.post(`/devices/${deviceId}/configurations`, configData);
  return response.data;
};

export const getAnalyticsConfig = async (deviceId, configToken) => {
  const response = await analyticsApi.get(`/devices/${deviceId}/configurations/${configToken}`);
  return response.data;
};

// ============================================
// Rule Management
// ============================================

export const getRules = async (deviceId, configToken) => {
  const response = await analyticsApi.get(`/devices/${deviceId}/configurations/${configToken}/rules`);
  return response.data;
};

export const getRule = async (deviceId, configToken, ruleName) => {
  const response = await analyticsApi.get(`/devices/${deviceId}/configurations/${configToken}/rules/${ruleName}`);
  return response.data;
};

export const createRule = async (deviceId, configToken, ruleData) => {
  const response = await analyticsApi.post(`/devices/${deviceId}/configurations/${configToken}/rules`, ruleData);
  return response.data;
};

export const updateRule = async (deviceId, configToken, ruleName, updates) => {
  const response = await analyticsApi.put(`/devices/${deviceId}/configurations/${configToken}/rules/${ruleName}`, updates);
  return response.data;
};

export const deleteRule = async (deviceId, configToken, ruleName) => {
  const response = await analyticsApi.delete(`/devices/${deviceId}/configurations/${configToken}/rules/${ruleName}`);
  return response.data;
};

export const getRuleOptions = async (deviceId, configToken, ruleType = null) => {
  const url = ruleType 
    ? `/devices/${deviceId}/configurations/${configToken}/rules/options?rule_type=${ruleType}`
    : `/devices/${deviceId}/configurations/${configToken}/rules/options`;
  const response = await analyticsApi.get(url);
  return response.data;
};

// ============================================
// Analytics Events
// ============================================

export const getEvents = async (deviceId, limit = 100, offset = 0, ruleName = null) => {
  let url = `/devices/${deviceId}/events?limit=${limit}&offset=${offset}`;
  if (ruleName) url += `&rule_name=${ruleName}`;
  const response = await analyticsApi.get(url);
  return response.data;
};

export const acknowledgeEvent = async (deviceId, eventId) => {
  const response = await analyticsApi.post(`/devices/${deviceId}/events/${eventId}/acknowledge`);
  return response.data;
};

// ============================================
// Detected Objects
// ============================================

export const getDetectedObjects = async (deviceId, startTime, endTime, classType = null, limit = 100) => {
  let url = `/devices/${deviceId}/objects?start_time=${startTime}&end_time=${endTime}&limit=${limit}`;
  if (classType) url += `&class_type=${classType}`;
  const response = await analyticsApi.get(url);
  return response.data;
};

// ============================================
// Face Recognition
// ============================================

export const getFaceMatches = async (deviceId, limit = 50) => {
  const response = await analyticsApi.get(`/devices/${deviceId}/face-matches?limit=${limit}`);
  return response.data;
};

export const createFaceMatch = async (deviceId, matchData) => {
  const response = await analyticsApi.post(`/devices/${deviceId}/face-matches`, matchData);
  return response.data;
};

// ============================================
// License Plate Recognition
// ============================================

export const getLPRMatches = async (deviceId, limit = 50, plateNumber = null) => {
  let url = `/devices/${deviceId}/lpr-matches?limit=${limit}`;
  if (plateNumber) url += `&plate_number=${plateNumber}`;
  const response = await analyticsApi.get(url);
  return response.data;
};

export const createLPRMatch = async (deviceId, matchData) => {
  const response = await analyticsApi.post(`/devices/${deviceId}/lpr-matches`, matchData);
  return response.data;
};

// ============================================
// Statistics
// ============================================

export const getStatistics = async (deviceId, days = 7) => {
  const response = await analyticsApi.get(`/devices/${deviceId}/statistics?days=${days}`);
  return response.data;
};

// ============================================
// Health Check
// ============================================

export const healthCheck = async () => {
  const response = await analyticsApi.get('/health');
  return response.data;
};

export default analyticsApi;