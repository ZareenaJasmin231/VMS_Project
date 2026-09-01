import { useState, useEffect } from 'react';

export function useNotificationPermission() {
  const [permission, setPermission] = useState('default');
  
  useEffect(() => {
    if (typeof Notification !== 'undefined') {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return 'denied';
    
    const asked = localStorage.getItem('notif_permission_asked');
    if (!asked || permission === 'default') {
      try {
        const result = await Notification.requestPermission();
        setPermission(result);
        localStorage.setItem('notif_permission_asked', 'true');
        return result;
      } catch (e) {
        console.error("Failed to request notification permission:", e);
        return 'denied';
      }
    }
    return permission;
  };

  return { permission, requestPermission };
}
