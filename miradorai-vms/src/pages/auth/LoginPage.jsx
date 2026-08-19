import React, { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import "./LoginPage.css";
import useActivityLogger from "../../hooks/useActivityLogger";
import SpecularButton from "../../components/shared/SpecularButton";

const LoginPage = () => {
  const { login, forgotPassword, resetPassword, oauthLogin, accounts } = useAuth();
  const [activeForm, setActiveForm] = useState("signin"); // "signin" | "forgot"
  const [role, setRole] = useState("client");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { logAction } = useActivityLogger();

  useEffect(() => {
    // Log pre-authentication site visit
    fetch('/api/auth/visit', { method: 'POST' }).catch(() => {});
  }, []);

  // Sign In Form
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState("");

  const [oauthMessage, setOauthMessage] = useState("");
  const [oauthError, setOauthError] = useState("");
  const [showGoogleChooser, setShowGoogleChooser] = useState(false);
  const [googleAccount, setGoogleAccount] = useState("");


  // Forgot Password Form
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotError, setForgotError] = useState("");
  const [forgotStep, setForgotStep] = useState("email");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [forgotSuccess, setForgotSuccess] = useState("");

  const handleSignIn = async (e) => {
    e.preventDefault();
    setSignInError("");
    setIsLoading(true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = await login(signInEmail, signInPassword, role);

    if (!result.success) {
      setSignInError(result.error);
      setIsLoading(false);
      return;
    }

    // 🔥 Activity log — user logged in
    logAction("User logged in", "auth", { email: signInEmail });

    setIsLoading(false);
  };

  const handleGoogleLogin = () => {
    setOauthError("");
    setOauthMessage("");

    const firstChoice = accounts && accounts.length ? accounts[0].email : "";
    setGoogleAccount(firstChoice);
    setShowGoogleChooser(true);
  };

  const performGoogleLogin = async () => {
    setOauthError("");
    setOauthMessage("");

    if (!googleAccount) {
      setOauthError("Please select a Google account first.");
      return;
    }

    setIsLoading(true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = oauthLogin("google", role, googleAccount);

    if (!result.success) {
      setOauthError(result.error);
      setIsLoading(false);
      return;
    }

    const selectedExisting = accounts.find((acc) => acc.email === googleAccount);
    if (selectedExisting && selectedExisting.role && selectedExisting.role !== role) {
      setRole(selectedExisting.role);
    }

    // 🔥 Activity log — Google OAuth login
    logAction("User logged in", "auth", { email: googleAccount, method: "google" });

    setOauthMessage(result.message || "Logged in with Google successfully");
    setIsLoading(false);
    setShowGoogleChooser(false);
  };

  const cancelGoogleLogin = () => {
    setShowGoogleChooser(false);
    setOauthError("");
    setOauthMessage("");
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setForgotError("");
    setForgotSuccess("");
    setIsLoading(true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    if (forgotStep === "email") {
      const result = await forgotPassword(forgotEmail);
      if (!result.success) {
        setForgotError(result.error);
        setIsLoading(false);
        return;
      }

      setForgotSuccess(result.message);
      setForgotStep("reset");
      setIsLoading(false);
    } else {
      const result = await resetPassword(forgotEmail, resetNewPassword, resetConfirm);
      if (!result.success) {
        setForgotError(result.error);
        setIsLoading(false);
        return;
      }

      setForgotSuccess(result.message);
      setForgotEmail("");
      setResetNewPassword("");
      setResetConfirm("");
      setForgotStep("email");
      setIsLoading(false);

      setTimeout(() => {
        setActiveForm("signin");
        setForgotSuccess("");
      }, 2000);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        {/* Logo/Title */}
        <div className="login-header">
          <h1 className="login-title">
            {activeForm === "signin" && "Log in"}
            {activeForm === "forgot" && "Reset Password"}
          </h1>
          <p className="login-subtitle">MIRADOR VMS</p>
        </div>

        {/* Sign In Form */}
        {activeForm === "signin" && (
          <form onSubmit={handleSignIn} className="auth-form">
            {/* Role Selection */}
            <div className="role-selector">
              <label className="role-label">Login as:</label>
              <div className="role-options">
                <button
                  type="button"
                  className={`role-option ${role === "admin" ? "active" : ""}`}
                  onClick={() => setRole("admin")}
                >
                  Admin
                </button>
                <button
                  type="button"
                  className={`role-option ${role === "client" ? "active" : ""}`}
                  onClick={() => setRole("client")}
                >
                  Client
                </button>
                <button
                  type="button"
                  className={`role-option ${role === "operator" ? "active" : ""}`}
                  onClick={() => setRole("operator")}
                >
                  Operator
                </button>
              </div>
            </div>

            {/* Email Input */}
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                placeholder="Type your email"
                value={signInEmail}
                onChange={(e) => setSignInEmail(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>

            {/* Password Input */}
            <div className="form-group">
              <div className="password-header">
                <label>Password</label>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveForm("forgot");
                    setForgotEmail("");
                    setForgotStep("email");
                  }}
                  className="forgot-link"
                >
                  Forgot password?
                </a>
              </div>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Type your password"
                  value={signInPassword}
                  onChange={(e) => setSignInPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                >
                  {showPassword ? "👁" : "🚫"}
                </button>
              </div>
            </div>

            {/* Error */}
            {signInError && <div className="error-message">{signInError}</div>}

            {/* Sign In Button */}
            <SpecularButton
              type="submit"
              size="md"
              radius={8}
              tint="#10b981"
              tintOpacity={0.10}
              blur={4}
              textColor="#f0fff8"
              lineColor="#10b981"
              baseColor="#0d3326"
              intensity={1.2}
              shineSize={12}
              shineFade={38}
              thickness={1}
              followMouse
              proximity={220}
              disabled={isLoading || !signInEmail || !signInPassword}
              className="login-specular-btn"
            >
              {isLoading ? "Signing in..." : "Log in"}
            </SpecularButton>

            {/* Google Login */}
            <button
              type="button"
              className="btn-google"
              disabled={isLoading}
              onClick={handleGoogleLogin}
            >
              <svg viewBox="0 0 24 24" width="18" height="18">
                <text x="0" y="16" fontSize="16">G</text>
              </svg>
              Continue with Google
            </button>

            {showGoogleChooser && (
              <div className="google-chooser">
                <p>Select a Google account:</p>
                <select
                  value={googleAccount}
                  onChange={(e) => setGoogleAccount(e.target.value)}
                  disabled={isLoading}
                >
                  <option value="">-- Choose account --</option>
                  {accounts && accounts.length > 0 ? (
                    accounts.map((acct) => (
                      <option key={acct.email} value={acct.email}>
                        {acct.email} ({acct.role})
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="google.user@example.com">google.user@example.com</option>
                      <option value="admin.google@example.com">admin.google@example.com</option>
                      <option value="client.google@example.com">client.google@example.com</option>
                    </>
                  )}
                </select>
                <div className="google-chooser-actions">
                  <SpecularButton
                    type="button"
                    size="md"
                    radius={8}
                    tint="#10b981"
                    tintOpacity={0.10}
                    blur={4}
                    textColor="#f0fff8"
                    lineColor="#10b981"
                    baseColor="#0d3326"
                    intensity={1.2}
                    shineSize={12}
                    shineFade={38}
                    thickness={1}
                    followMouse
                    proximity={220}
                    onClick={performGoogleLogin}
                    disabled={isLoading || !googleAccount}
                    className="login-specular-btn"
                  >
                    Sign in with Google
                  </SpecularButton>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={cancelGoogleLogin}
                    disabled={isLoading}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {oauthError && <div className="error-message">{oauthError}</div>}
            {oauthMessage && <div className="success-message">{oauthMessage}</div>}

          </form>
        )}


        {/* Forgot Password Form */}
        {activeForm === "forgot" && (
          <form onSubmit={handleForgotPassword} className="auth-form">
            {forgotStep === "email" ? (
              <>
                <div className="form-group">
                  <label>Email Address</label>
                  <input
                    type="email"
                    placeholder="Type your email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                  <small className="form-hint">
                    We'll send a password reset link to this email
                  </small>
                </div>

                {forgotError && <div className="error-message">{forgotError}</div>}
                {forgotSuccess && (
                  <div className="success-message">{forgotSuccess}</div>
                )}

                <SpecularButton
                  type="submit"
                  size="md"
                  radius={8}
                  tint="#10b981"
                  tintOpacity={0.10}
                  blur={4}
                  textColor="#f0fff8"
                  lineColor="#10b981"
                  baseColor="#0d3326"
                  intensity={1.2}
                  shineSize={12}
                  shineFade={38}
                  thickness={1}
                  followMouse
                  proximity={220}
                  disabled={isLoading || !forgotEmail}
                  className="login-specular-btn"
                >
                  {isLoading ? "Sending..." : "Send Reset Link"}
                </SpecularButton>
              </>
            ) : (
              <>
                <div className="form-group">
                  <label>New Password</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter new password"
                      value={resetNewPassword}
                      onChange={(e) => setResetNewPassword(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={isLoading}
                    >
                      {showPassword ? "👁" : "🚫"}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label>Confirm Password</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Confirm password"
                      value={resetConfirm}
                      onChange={(e) => setResetConfirm(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={isLoading}
                    >
                      {showPassword ? "👁" : "🚫"}
                    </button>
                  </div>
                </div>

                {forgotError && <div className="error-message">{forgotError}</div>}
                {forgotSuccess && (
                  <div className="success-message">{forgotSuccess}</div>
                )}

                <SpecularButton
                  type="submit"
                  size="md"
                  radius={8}
                  tint="#10b981"
                  tintOpacity={0.10}
                  blur={4}
                  textColor="#f0fff8"
                  lineColor="#10b981"
                  baseColor="#0d3326"
                  intensity={1.2}
                  shineSize={12}
                  shineFade={38}
                  thickness={1}
                  followMouse
                  proximity={220}
                  disabled={isLoading || !resetNewPassword || !resetConfirm}
                  className="login-specular-btn"
                >
                  {isLoading ? "Resetting..." : "Reset Password"}
                </SpecularButton>
              </>
            )}

            {/* Back to Sign In */}
            <div className="form-footer">
              <button
                type="button"
                onClick={() => {
                  setActiveForm("signin");
                  setForgotEmail("");
                  setResetNewPassword("");
                  setResetConfirm("");
                  setForgotStep("email");
                  setForgotError("");
                  setForgotSuccess("");
                }}
                className="link-btn"
              >
                ← Back to Sign In
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Background */}
      <div className="login-background">
        <div className="bg-circle bg-circle-1"></div>
        <div className="bg-circle bg-circle-2"></div>
        <div className="bg-circle bg-circle-3"></div>
      </div>
    </div>
  );
};

export default LoginPage;