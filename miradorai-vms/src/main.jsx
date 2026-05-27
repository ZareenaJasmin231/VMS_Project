import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

// Global Fetch Interceptor to attach JWT token
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let [resource, config] = args;

  // Apply only to API calls
  if (typeof resource === 'string' && (resource.includes(':80') || resource.includes('/api/'))) {
    const token = localStorage.getItem('miradorai_token');
    if (token) {
      config = config || {};
      config.headers = {
        ...config.headers,
        Authorization: `Bearer ${token}`
      };
    }
  }

  const response = await originalFetch(resource, config);

  // Handle unauthorized responses globally — but only redirect once
  if (response.status === 401 && !resource.includes('/api/auth/')) {
    console.warn("Unauthorized API call:", resource);
    // Don't auto-redirect; let the app handle auth state naturally
  }

  return response;
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <App />
);
