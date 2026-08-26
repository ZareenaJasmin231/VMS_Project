import React, { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import "./LoginPage.css";
import useActivityLogger from "../../hooks/useActivityLogger";
import SpecularButton from "../../components/shared/SpecularButton";

const PasswordRules = ({ password }) => {
  const rules = [
    { label: "At least 8 characters long", test: p => p.length >= 8 },
    { label: "One uppercase letter", test: p => /[A-Z]/.test(p) },
    { label: "One lowercase letter", test: p => /[a-z]/.test(p) },
    { label: "One number", test: p => /[0-9]/.test(p) },
    { label: "One special character", test: p => /[!@#$%^&*(),.?":{}|<>]/.test(p) }
  ];

  return (
    <div style={{ marginTop: '8px', fontSize: '12px' }}>
      {rules.map((rule, idx) => {
        const passed = rule.test(password || "");
        return (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', color: passed ? '#10b981' : '#6b7280' }}>
            {passed ? (
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" style={{ marginRight: '6px' }}><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" style={{ marginRight: '6px' }}><circle cx="12" cy="12" r="10"/></svg>
            )}
            <span style={{ textDecoration: passed ? 'line-through' : 'none' }}>{rule.label}</span>
          </div>
        )
      })}
    </div>
  );
};

const LoginPage = () => {
  const { login, completeLogin,  oauthLogin, accounts, signup } = useAuth();
  const [activeForm, setActiveForm] = useState("signin"); // "signin" | "forgot" | "signup"
  const [role, setRole] = useState("client");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
  const [activeSessionWarning, setActiveSessionWarning] = useState(null);

  // Sign Up Form
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpConfirm, setSignUpConfirm] = useState("");
  const [signUpError, setSignUpError] = useState("");
  const [signUpSuccess, setSignUpSuccess] = useState("");

  const [oauthMessage, setOauthMessage] = useState("");
  const [oauthError, setOauthError] = useState("");
  const [showGoogleChooser, setShowGoogleChooser] = useState(false);
  const [googleAccount, setGoogleAccount] = useState("");


  // Forgot Password Form
  // const [forgotEmail, setForgotEmail] = useState("");
  // const [forgotError, setForgotError] = useState("");
  // const [forgotStep, setForgotStep] = useState("email");
  // const [resetNewPassword, setResetNewPassword] = useState("");
  // const [resetConfirm, setResetConfirm] = useState("");
  // const [forgotSuccess, setForgotSuccess] = useState("");
  const [requiresCaptcha, setRequiresCaptcha] = useState(false);
  const [captchaId, setCaptchaId] = useState(null);
  const [captchaText, setCaptchaText] = useState("");
  const [captchaImageBase64, setCaptchaImageBase64] = useState("");
  const [robotChecked, setRobotChecked] = useState(false);

  const fetchCaptcha = async () => {
    try {
      const res = await fetch("/api/auth/captcha");
      const data = await res.json();
      setCaptchaId(data.captcha_id);
      setCaptchaImageBase64(data.image_base64);
      setCaptchaText("");
    } catch (err) {
      console.error("Failed to fetch CAPTCHA", err);
    }
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    setSignInError("");
    setActiveSessionWarning(null);
    setIsLoading(true);

    if (requiresCaptcha && (!robotChecked || !captchaId || !captchaText)) {
      setSignInError("Please verify you are not a robot and enter the CAPTCHA text");
      setIsLoading(false);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = await login(signInEmail, signInPassword, role, captchaId, captchaText);

    if (!result.success) {
      setSignInError(result.error);
      if (result.requires_captcha) {
        setRequiresCaptcha(true);
        if (!captchaImageBase64) {
          fetchCaptcha();
        } else if (captchaId) {
           // Refetch captcha on failure if it's already showing
           fetchCaptcha();
        }
      }
      setIsLoading(false);
      return;
    }

    if (result.has_active_session) {
      setActiveSessionWarning({ user: result.user, token: result.token });
      setIsLoading(false);
      return;
    }

    // Reset CAPTCHA on success
    setRequiresCaptcha(false);
    setCaptchaId(null);
    setCaptchaText("");
    setRobotChecked(false);

    // 🔥 Activity log — user logged in
    logAction("User logged in", "auth", { email: signInEmail });

    setIsLoading(false);
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setSignUpError("");
    setSignUpSuccess("");
    setIsLoading(true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = await signup(signUpEmail, signUpPassword, signUpConfirm, role);
    if (!result.success) {
      setSignUpError(result.error);
    } else {
      setSignUpSuccess(result.message);
      logAction("User signed up", "auth", { email: signUpEmail });
      setTimeout(() => {
        setActiveForm("signin");
        setSignInEmail(signUpEmail);
        setSignUpEmail("");
        setSignUpPassword("");
        setSignUpConfirm("");
        setSignUpSuccess("");
      }, 2000);
    }
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
            {activeForm === "signup" && "Create Account"}
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
                {/* <a
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
                </a> */}
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
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
                </button>
              </div>
            </div>

            {/* CAPTCHA */}
            {requiresCaptcha && (
              <div className="form-group captcha-group" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', border: '1px solid #333', borderRadius: '4px', backgroundColor: 'rgba(0,0,0,0.2)' }}>
                  <input 
                    type="checkbox" 
                    id="robotCheck"
                    checked={robotChecked}
                    onChange={(e) => setRobotChecked(e.target.checked)}
                    style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                  />
                  <label htmlFor="robotCheck" style={{ margin: 0, cursor: 'pointer', fontSize: '1rem', flex: 1 }}>
                    I'm not a robot
                  </label>
                  <img src="https://www.gstatic.com/recaptcha/api2/logo_48.png" alt="captcha icon" style={{ width: '28px', opacity: 0.7 }} />
                </div>

                {robotChecked && captchaImageBase64 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <img src={captchaImageBase64} alt="CAPTCHA" style={{ flex: 1, borderRadius: '4px', border: '1px solid #333', height: '70px', objectFit: 'cover', width: '100%' }} />
                      <button 
                        type="button" 
                        onClick={fetchCaptcha} 
                        className="btn-secondary" 
                        style={{ padding: 0, fontSize: '1.2rem', height: '32px', width: '32px', minWidth: '32px', minHeight: '32px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
                        title="Reload CAPTCHA"
                      >
                        ↻
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Enter the letters above"
                      value={captchaText}
                      onChange={(e) => setCaptchaText(e.target.value)}
                      disabled={isLoading}
                      required={robotChecked}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {signInError && <div className="error-message">{signInError}</div>}

            {/* Warning */}
            {activeSessionWarning && (
              <div className="warning-message">
                <p>This user already has an active session on another device.</p>
                <div className="warning-message-actions">
                  <button 
                    type="button"
                    onClick={() => setActiveSessionWarning(null)}
                    style={{ background: 'rgba(255,255,255,0.05)', color: '#d1d5db', border: '1px solid rgba(255,255,255,0.1)', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}
                  >
                    Cancel
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      completeLogin(activeSessionWarning.user, activeSessionWarning.token);
                      logAction("User logged in (concurrent)", "auth", { email: signInEmail });
                    }}
                    style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', border: '1px solid rgba(59, 130, 246, 0.4)', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}
                  >
                    Continue Anyway
                  </button>
                </div>
              </div>
            )}

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

            <div style={{ textAlign: "center", marginTop: "1rem", fontSize: "0.9rem", color: "#9ca3af" }}>
              Don't have an account?{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); setActiveForm("signup"); }} style={{ color: "#10b981", textDecoration: "none" }}>
                Sign up
              </a>
            </div>

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
        {false && activeForm === "forgot" && (
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
                      {showPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
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
                      {showPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
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
        )} */}

        {/* Sign Up Form */}
        {activeForm === "signup" && (
          <form onSubmit={handleSignUp} className="auth-form">
            <div className="role-selector">
              <label className="role-label">Register as:</label>
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

            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                placeholder="Type your email"
                value={signUpEmail}
                onChange={(e) => setSignUpEmail(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>

            <div className="form-group">
              <label>Password</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Minimum 8 characters"
                  value={signUpPassword}
                  onChange={(e) => setSignUpPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
                </button>
              </div>
              <PasswordRules password={signUpPassword} />
            </div>

            <div className="form-group">
              <label>Confirm Password</label>
              <div className="password-input-wrapper">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm your password"
                  value={signUpConfirm}
                  onChange={(e) => setSignUpConfirm(e.target.value)}
                  disabled={isLoading}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  disabled={isLoading}
                >
                  {showConfirmPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
                </button>
              </div>
            </div>

            {signUpError && <div className="error-message">{signUpError}</div>}
            {signUpSuccess && <div className="success-message">{signUpSuccess}</div>}

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
              disabled={isLoading || !signUpEmail || !signUpPassword || !signUpConfirm}
              className="login-specular-btn"
            >
              {isLoading ? "Creating account..." : "Sign up"}
            </SpecularButton>

            <div style={{ textAlign: "center", marginTop: "1rem", fontSize: "0.9rem", color: "#9ca3af" }}>
              Already have an account?{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); setActiveForm("signin"); }} style={{ color: "#10b981", textDecoration: "none" }}>
                Log in
              </a>
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