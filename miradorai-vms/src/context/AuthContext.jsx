import React, { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);

  // Load accounts and user from localStorage on mount
  useEffect(() => {
    try {
      const savedAccounts = localStorage.getItem("miradorai_accounts");
      if (savedAccounts) {
        setAccounts(JSON.parse(savedAccounts));
      }

      // Try to restore session from localStorage
      const savedUser = localStorage.getItem("miradorai_user");
      if (savedUser) {
        const parsedUser = JSON.parse(savedUser);
        // Restore the session - user will be logged in immediately
        setUser(parsedUser);
      }
    } catch (e) {
      console.error("Failed to load saved data:", e);
      // Clear invalid data
      localStorage.removeItem("miradorai_user");
      localStorage.removeItem("miradorai_accounts");
    } finally {
      // Mark loading as complete
      setIsLoading(false);
    }
  }, []);

  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password) => {
    // At least 6 characters
    return password.length >= 6;
  };

  const signup = (email, password, passwordConfirm, role) => {
    // Validation
    if (!email || !password || !passwordConfirm) {
      return { success: false, error: "All fields are required" };
    }

    if (!validateEmail(email)) {
      return { success: false, error: "Invalid email format" };
    }

    if (!validatePassword(password)) {
      return {
        success: false,
        error: "Password must be at least 6 characters",
      };
    }

    if (password !== passwordConfirm) {
      return { success: false, error: "Passwords do not match" };
    }

    // Check if account already exists
    if (accounts.some((acc) => acc.email === email)) {
      return { success: false, error: "Email already registered" };
    }

    // Create new account
    const newAccount = {
      id: Date.now().toString(),
      email,
      password, // In production, hash this!
      role,
      createdAt: new Date().toISOString(),
    };

    const updatedAccounts = [...accounts, newAccount];
    setAccounts(updatedAccounts);
    localStorage.setItem("miradorai_accounts", JSON.stringify(updatedAccounts));

    return { success: true, message: "Account created successfully! Please sign in." };
  };

  const login = (email, password, role) => {
    // Validation
    if (!email || !password) {
      return { success: false, error: "Email and password required" };
    }

    // Check if account exists with matching credentials
    const account = accounts.find(
      (acc) => acc.email === email && acc.password === password
    );

    if (!account) {
      return { success: false, error: "Invalid email or password" };
    }

    // Check if role matches
    if (account.role !== role) {
      return {
        success: false,
        error: `This account is registered as ${account.role}. Please select the correct role.`,
      };
    }

    const userData = {
      id: account.id,
      email,
      role,
      loginTime: new Date().toISOString(),
      loginDate: new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      sessionId: Math.random().toString(36).substring(2, 11),
    };

    setUser(userData);
    localStorage.setItem("miradorai_user", JSON.stringify(userData));
    return { success: true };
  };

  const forgotPassword = (email) => {
    // Validation
    if (!email) {
      return { success: false, error: "Email is required" };
    }

    if (!validateEmail(email)) {
      return { success: false, error: "Invalid email format" };
    }

    // Check if account exists (in production, send reset link)
    const account = accounts.find((acc) => acc.email === email);

    if (!account) {
      // For security, don't reveal if account exists
      // But for demo, we'll be helpful
      return {
        success: false,
        error: "No account found with this email. Please sign up instead.",
      };
    }

    // In production, send password reset email with token
    // For now, return success message
    return {
      success: true,
      message: `Password reset link sent to ${email}. Check your email (demo mode).`,
    };
  };

  const resetPassword = (email, newPassword, confirmPassword) => {
    if (!email || !newPassword || !confirmPassword) {
      return { success: false, error: "All fields are required" };
    }

    if (!validatePassword(newPassword)) {
      return {
        success: false,
        error: "Password must be at least 6 characters",
      };
    }

    if (newPassword !== confirmPassword) {
      return { success: false, error: "Passwords do not match" };
    }

    // Find and update account
    const accountIndex = accounts.findIndex((acc) => acc.email === email);
    if (accountIndex === -1) {
      return { success: false, error: "Account not found" };
    }

    const updatedAccounts = [...accounts];
    updatedAccounts[accountIndex].password = newPassword;
    setAccounts(updatedAccounts);
    localStorage.setItem("miradorai_accounts", JSON.stringify(updatedAccounts));

    return { success: true, message: "Password reset successfully! Please sign in." };
  };

  const oauthLogin = (provider, selectedRole = "client", selectedEmail = null) => {
    if (provider !== "google") {
      return { success: false, error: "Unsupported OAuth provider" };
    }

    const candidateEmail = selectedEmail || "google.user@example.com";
    if (!candidateEmail || !validateEmail(candidateEmail)) {
      return { success: false, error: "Please select a valid Google account email" };
    }

    const existingAccount = accounts.find((acc) => acc.email === candidateEmail);
    const roleToUse = existingAccount ? existingAccount.role : selectedRole;

    let account = existingAccount;
    if (!account) {
      account = {
        id: Date.now().toString(),
        email: candidateEmail,
        password: "",
        role: roleToUse,
        oauthProvider: "google",
        createdAt: new Date().toISOString(),
      };

      const updatedAccounts = [...accounts, account];
      setAccounts(updatedAccounts);
      localStorage.setItem("miradorai_accounts", JSON.stringify(updatedAccounts));
    }

    const userData = {
      id: account.id,
      email: account.email,
      role: roleToUse,
      loginTime: new Date().toISOString(),
      loginDate: new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      sessionId: Math.random().toString(36).substring(2, 11),
      oauthProvider: "google",
    };

    setUser(userData);
    localStorage.setItem("miradorai_user", JSON.stringify(userData));

    return { success: true, message: `Logged in as ${account.email} with role ${account.role}.` };
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("miradorai_user");
  };

  const isAdmin = user?.role === "admin";
  const isClient = user?.role === "client";
  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        isAdmin,
        isClient,
        accounts,
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
