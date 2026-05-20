import React, { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};

// Change this to your backend URL if different
const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL)
  || "http://localhost:8000";
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  // Supervisor unlock — reset on logout / new session
  const [supervisorUnlocked, setSupervisorUnlocked] = useState(false);

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem("miradorai_user");
      if (savedUser) {
        const parsedUser = JSON.parse(savedUser);
        setUser(parsedUser);
      }
    } catch (e) {
      console.error("Failed to restore session:", e);
      localStorage.removeItem("miradorai_user");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ------------------------------------------------------------------
  // Sign Up — saves to MongoDB via backend
  // ------------------------------------------------------------------
  const signup = async (email, password, passwordConfirm, role) => {
    // Client-side validation first
    if (!email || !password || !passwordConfirm) {
      return { success: false, error: "All fields are required" };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: "Invalid email format" };
    }

    if (password.length < 6) {
      return { success: false, error: "Password must be at least 6 characters" };
    }

    if (password !== passwordConfirm) {
      return { success: false, error: "Passwords do not match" };
    }

    // Call backend
    try {
      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data.detail || "Signup failed" };
      }

      return { success: true, message: data.message };
    } catch (err) {
      console.error("[AUTH] Signup error:", err);
      return { success: false, error: "Cannot connect to server. Please try again." };
    }
  };

  // ------------------------------------------------------------------
  // Sign In — verifies against MongoDB via backend
  // ------------------------------------------------------------------
  const login = async (email, password, role) => {
    if (!email || !password) {
      return { success: false, error: "Email and password required" };
    }

    const validRoles = ["admin", "client", "operator"];
    const assignedRole = validRoles.includes(role) ? role : "client";

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role: assignedRole }),
      });

      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.detail || data.message || "Login failed" };
      }

      setUser(data.user);
      setSupervisorUnlocked(false);
      localStorage.setItem("miradorai_user", JSON.stringify(data.user));
      localStorage.setItem("miradorai_token", data.token);
      return { success: true };
    } catch (err) {
      console.error("[AUTH] Login error:", err);
      return { success: false, error: "Cannot connect to server. Please try again." };
    }
  };

  // ------------------------------------------------------------------
  // Supervisor unlock — client role uses this to access restricted pages
  // Password is set by admin via Settings > Supervisor Details (stored in localStorage)
  // Falls back to "supervisor123" if admin hasn't configured one yet
  // ------------------------------------------------------------------
  const unlockSupervisor = () => {
    setSupervisorUnlocked(true);
    return { success: true };
  };

  const lockSupervisor = () => setSupervisorUnlocked(false);

  // ------------------------------------------------------------------
  // Forgot Password — checks email exists in MongoDB via backend
  // ------------------------------------------------------------------
  const forgotPassword = async (email) => {
    if (!email) {
      return { success: false, error: "Email is required" };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: "Invalid email format" };
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data.detail || "Request failed" };
      }

      return { success: true, message: data.message };
    } catch (err) {
      console.error("[AUTH] Forgot password error:", err);
      return { success: false, error: "Cannot connect to server. Please try again." };
    }
  };

  // ------------------------------------------------------------------
  // Reset Password — updates password in MongoDB via backend
  // ------------------------------------------------------------------
  const resetPassword = async (email, newPassword, confirmPassword) => {
    if (!email || !newPassword || !confirmPassword) {
      return { success: false, error: "All fields are required" };
    }

    if (newPassword.length < 6) {
      return { success: false, error: "Password must be at least 6 characters" };
    }

    if (newPassword !== confirmPassword) {
      return { success: false, error: "Passwords do not match" };
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          new_password:     newPassword,
          confirm_password: confirmPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data.detail || "Reset failed" };
      }

      return { success: true, message: data.message };
    } catch (err) {
      console.error("[AUTH] Reset password error:", err);
      return { success: false, error: "Cannot connect to server. Please try again." };
    }
  };

  // ------------------------------------------------------------------
  // OAuth Login (Google) — kept local since it's mock/demo
  // ------------------------------------------------------------------
  const oauthLogin = (provider, selectedRole = "client", selectedEmail = null) => {
    if (provider !== "google") {
      return { success: false, error: "Unsupported OAuth provider" };
    }

    const candidateEmail = selectedEmail || "google.user@example.com";
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!candidateEmail || !emailRegex.test(candidateEmail)) {
      return { success: false, error: "Please select a valid Google account email" };
    }

    const userData = {
      id:            Date.now().toString(),
      email:         candidateEmail,
      role:          selectedRole,
      loginTime:     new Date().toISOString(),
      loginDate:     new Date().toLocaleDateString("en-US", {
        year:   "numeric",
        month:  "short",
        day:    "numeric",
        hour:   "2-digit",
        minute: "2-digit",
      }),
      sessionId:     Math.random().toString(36).substring(2, 11),
      oauthProvider: "google",
    };

    setUser(userData);
    localStorage.setItem("miradorai_user", JSON.stringify(userData));

    return {
      success: true,
      message: `Logged in as ${candidateEmail} with role ${selectedRole}.`,
    };
  };

  // ------------------------------------------------------------------
  // Logout
  // ------------------------------------------------------------------
  const logout = () => {
    setUser(null);
    setSupervisorUnlocked(false);
    localStorage.removeItem("miradorai_user");
    localStorage.removeItem("miradorai_token");
  };

  const isAdmin        = user?.role === "admin";
  const isClient       = user?.role === "client";
  const isOperator     = user?.role === "operator";
  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        isAdmin,
        isClient,
        isOperator,
        supervisorUnlocked,
        unlockSupervisor,
        lockSupervisor,
        login,
        signup,
        forgotPassword,
        resetPassword,
        oauthLogin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};