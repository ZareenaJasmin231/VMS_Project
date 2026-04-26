const API_BASE = import.meta.env.VITE_API_URL || "http://192.168.126.200:8000";

export const logUI = async ({ action, category, details = {} }) => {
  try {
    const user = JSON.parse(localStorage.getItem("user"));

    await fetch(`${API_BASE}/api/logs/ui`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_email: user?.email || "unknown",
        user_role: user?.role || "unknown",
        action,
        category,
        details,
      }),
    });
  } catch (err) {
    console.error("Logging failed:", err);
  }
};