import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const API_BASE = import.meta.env.VITE_API_URL;


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

  // Global click listener for comprehensive tracking
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    
    const handleGlobalClick = (e) => {
      // Find the closest interactive element
      const target = e.target.closest('button, a, input, select, [role="button"], .vs-station-card, .alp-row, [class*="card"]');
      if (target) {
        let elementText = target.innerText || target.value || target.getAttribute('aria-label') || target.tagName;
        // Clean up the text
        if (typeof elementText === 'string') {
          elementText = elementText.substring(0, 60).replace(/\n/g, ' ').trim();
        }
        
        // Exclude empty clicks or generic wrappers if they don't have useful text
        if (elementText) {
          logUIAction(user, `Clicked on '${elementText}'`, "click", {
            page: location.pathname,
            element: target.tagName,
            className: target.className,
            text: elementText
          });
        }
      }
    };
    
    document.addEventListener("click", handleGlobalClick, { capture: true });
    return () => document.removeEventListener("click", handleGlobalClick, { capture: true });
  }, [isAuthenticated, user, location.pathname]);

  return {
    logAction: (action, category, details) =>
      logUIAction(user, action, category, details),
  };
};

export default useActivityLogger;