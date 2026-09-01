import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

const UserSettingsContext = createContext();

export const useUserSettings = () => {
  const context = useContext(UserSettingsContext);
  if (!context) {
    throw new Error('useUserSettings must be used within UserSettingsProvider');
  }
  return context;
};

const defaultSettings = {
  treeView: true,
  showIn: "Views and Cameras",
  showNavPath: true,
  notifAlarms: true,
  notifTasks: true,
  notifDevMgmt: true,
  notifIntercom: true,
  snapMsg: false,
  snapOpen: true,
  snapFolder: "C:\\Users\\miradorwin\\Pictures",
  fullScreen: false,
  remTabs: true,
  remMonitors: true,
  alarmSound: "no-sound",
  alarmFile: "",
  callSound: "no-sound",
  callFile: "",
  smartSearch: true,
  invalidCertWarn: true,
};

export const UserSettingsProvider = ({ children }) => {
  const { user } = useAuth();
  const [settings, setSettings] = useState(defaultSettings);

  const getStorageKey = () => {
    return `mirador-user-settings-${user?.id || 'guest'}`;
  };

  useEffect(() => {
    try {
      const stored = localStorage.getItem(getStorageKey());
      if (stored) {
        setSettings({ ...defaultSettings, ...JSON.parse(stored) });
      } else {
        setSettings(defaultSettings);
      }
    } catch (e) {
      console.error("Failed to load user settings", e);
      setSettings(defaultSettings);
    }
  }, [user?.id]);

  const saveSettings = (newSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem(getStorageKey(), JSON.stringify(newSettings));
    } catch (e) {
      console.error("Failed to save user settings", e);
    }
  };

  return (
    <UserSettingsContext.Provider value={{ settings, saveSettings }}>
      {children}
    </UserSettingsContext.Provider>
  );
};
