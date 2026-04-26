import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) ||
  "http://192.168.126.200:8000";

export const logUIAction = async (user, action, category, details = {}) => {
  if (!user) return;
console.log("LOG USER:", user);
  try {
    await fetch(`${API_BASE}/api/logs/ui`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_email: user.email || "Unknown",
        user_role: user.role || "Unknown",
        action,
        category,
        details,
        session_id: user.sessionId || "Unknown",
      }),
    });
  } catch (err) {
    console.error("[Logger] Failed to log UI action:", err);
  }
};

const useActivityLogger = () => {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();
  const lastPathname = useRef("");

  useEffect(() => {
    if (isAuthenticated && user && location.pathname !== lastPathname.current) {
      logUIAction(
        user,
        `Navigated to ${location.pathname}`,
        "navigation",
        { page: location.pathname }
      );
      lastPathname.current = location.pathname;
    }
  }, [location.pathname, isAuthenticated, user]);

  return {
    logAction: (action, category, details) =>
      logUIAction(user, action, category, details),
  };
};

export default useActivityLogger;