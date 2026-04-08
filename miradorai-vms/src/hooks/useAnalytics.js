/**
 * Custom React Hook for Analytics
 * Provides analytics state and methods
 */

import { useState, useEffect, useCallback } from 'react';
import * as analyticsApi from '../api/analyticsApi';

export const useAnalytics = (deviceId, configToken) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rules, setRules] = useState([]);
  const [events, setEvents] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [ruleOptions, setRuleOptions] = useState({});

  // Load rules
  const loadRules = useCallback(async () => {
    if (!deviceId || !configToken) return;
    setLoading(true);
    try {
      const data = await analyticsApi.getRules(deviceId, configToken);
      setRules(data.rules || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setLoading(false);
    }
  }, [deviceId, configToken]);

  // Load events
  const loadEvents = useCallback(async (limit = 100) => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const data = await analyticsApi.getEvents(deviceId, limit);
      setEvents(data.events || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  // Load statistics
  const loadStatistics = useCallback(async (days = 7) => {
    if (!deviceId) return;
    try {
      const data = await analyticsApi.getStatistics(deviceId, days);
      setStatistics(data);
    } catch (err) {
      console.error('Failed to load statistics:', err);
    }
  }, [deviceId]);

  // Load capabilities
  const loadCapabilities = useCallback(async () => {
    if (!deviceId) return;
    try {
      const data = await analyticsApi.getDeviceCapabilities(deviceId);
      setCapabilities(data);
    } catch (err) {
      console.error('Failed to load capabilities:', err);
    }
  }, [deviceId]);

  // Load rule options
  const loadRuleOptions = useCallback(async () => {
    if (!deviceId || !configToken) return;
    try {
      const data = await analyticsApi.getRuleOptions(deviceId, configToken);
      setRuleOptions(data.rule_options || {});
    } catch (err) {
      console.error('Failed to load rule options:', err);
    }
  }, [deviceId, configToken]);

  // Create a new rule
  const createRule = useCallback(async (ruleData) => {
    if (!deviceId || !configToken) return null;
    setLoading(true);
    try {
      const result = await analyticsApi.createRule(deviceId, configToken, ruleData);
      await loadRules(); // Refresh rules list
      setError(null);
      return result;
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [deviceId, configToken, loadRules]);

  // Update an existing rule
  const updateRule = useCallback(async (ruleName, updates) => {
    if (!deviceId || !configToken) return false;
    setLoading(true);
    try {
      await analyticsApi.updateRule(deviceId, configToken, ruleName, updates);
      await loadRules(); // Refresh rules list
      setError(null);
      return true;
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [deviceId, configToken, loadRules]);

  // Delete a rule
  const deleteRule = useCallback(async (ruleName) => {
    if (!deviceId || !configToken) return false;
    setLoading(true);
    try {
      await analyticsApi.deleteRule(deviceId, configToken, ruleName);
      await loadRules(); // Refresh rules list
      setError(null);
      return true;
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [deviceId, configToken, loadRules]);

  // Acknowledge an event
  const acknowledgeEvent = useCallback(async (eventId) => {
    if (!deviceId) return false;
    try {
      await analyticsApi.acknowledgeEvent(deviceId, eventId);
      await loadEvents(); // Refresh events
      return true;
    } catch (err) {
      console.error('Failed to acknowledge event:', err);
      return false;
    }
  }, [deviceId, loadEvents]);

  // Initial load
  useEffect(() => {
    if (deviceId && configToken) {
      loadRules();
      loadRuleOptions();
    }
    if (deviceId) {
      loadEvents();
      loadStatistics();
      loadCapabilities();
    }
  }, [deviceId, configToken, loadRules, loadEvents, loadStatistics, loadCapabilities, loadRuleOptions]);

  return {
    loading,
    error,
    rules,
    events,
    statistics,
    capabilities,
    ruleOptions,
    createRule,
    updateRule,
    deleteRule,
    acknowledgeEvent,
    refreshRules: loadRules,
    refreshEvents: loadEvents,
    refreshStatistics: loadStatistics,
  };
};

export default useAnalytics;