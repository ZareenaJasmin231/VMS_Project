from fastapi import APIRouter, HTTPException, Depends, Request
from typing import Optional
import re
from datetime import datetime
from app.schemas.auth import SignupRequest, LoginRequest, ForgotPasswordRequest, SupervisorPasswordRequest, SupervisorVerifyRequest, ResetPasswordRequest
from app.core.database import users_col, auth_logs_col, settings_col
from app.core.security import create_token, verify_token, require_admin
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.post("/signup")
def auth_signup(req: SignupRequest):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.email or not req.password:
        raise HTTPException(status_code=400, detail="Email and password are required")
    email_regex = r"^[^\s@]+@[^\s@]+\.[^\s@]+$"
    if not re.match(email_regex, req.email):
        raise HTTPException(status_code=400, detail="Invalid email format")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if req.role not in ("admin", "client", "operator"):
        raise HTTPException(status_code=400, detail="Role must be 'admin', 'client', or 'operator'")
    if users_col.find_one({"email": req.email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed_password = pwd_context.hash(req.password)
    user_doc = {
        "email":     req.email,
        "password":  hashed_password,
        "role":      req.role,
        "createdAt": datetime.utcnow().isoformat(),
    }
    try:
        users_col.insert_one(user_doc)
        print(f"[AUTH] ✅ Account created for: {req.email}")
    except Exception as e:
        print(f"[AUTH] ❌ Signup failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to create account")
    return {"success": True, "message": "Account created successfully! Please sign in."}


@router.post("/login")
def auth_login(req: LoginRequest, request: Request):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    user = users_col.find_one({"email": req.email})



    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not pwd_context.verify(req.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if user.get("role") != req.role:
        actual_role = user.get("role", "unknown").capitalize()
        attempted_role = req.role.capitalize()
        raise HTTPException(status_code=403, detail=f"Account registered as {actual_role}. Cannot login as {attempted_role}.")  



    if auth_logs_col is not None:
        try:
            auth_logs_col.insert_one({
                "type":      "login",
                "email":     user["email"],
                "role":      user["role"],
                "timestamp": datetime.utcnow().isoformat(),
                "ip":        request.client.host if request.client else None,
            })
        except Exception:
            pass
    token = create_token(user["email"], user["role"])
    return {
        "success": True,
        "token": token,
        "user": {
            "email": user["email"],
            "role": user["role"]
        }
    }

@router.post("/forgot-password")
def auth_forgot_password(req: ForgotPasswordRequest):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.email:
        raise HTTPException(status_code=400, detail="Email is required")
    user = users_col.find_one({"email": req.email})
    if not user:
        raise HTTPException(status_code=404, detail="No account found with this email. Please sign up instead.")
    print(f"[AUTH] 🔑 Password reset requested for: {req.email}")
    return {
        "success": True,
        "message": f"Password reset link sent to {req.email}. Check your email (demo mode)."
    }


@router.post("/supervisor-password")
def auth_set_supervisor_password(req: SupervisorPasswordRequest, user=Depends(require_admin)):
    if settings_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.password or not req.confirm_password:
        raise HTTPException(status_code=400, detail="Password and confirm password are required")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    if req.password != req.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    hashed_password = pwd_context.hash(req.password)
    settings_col.update_one(
        {"name": "supervisor_password"},
        {"$set": {"value": hashed_password, "updatedAt": datetime.utcnow().isoformat()}},
        upsert=True
    )
    print(f"[AUTH] ✅ Supervisor password updated by: {user.get('sub')}")
    return {"success": True, "message": "Supervisor password saved."}


@router.post("/verify-supervisor")
def auth_verify_supervisor(req: SupervisorVerifyRequest):
    if settings_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.password:
        raise HTTPException(status_code=400, detail="Password is required")

    stored = settings_col.find_one({"name": "supervisor_password"})
    if stored and stored.get("value"):
        if pwd_context.verify(req.password, stored["value"]):
            return {"success": True}
        raise HTTPException(status_code=401, detail="Incorrect supervisor password")

    # fallback default
    if req.password == "supervisor123":
        return {"success": True}
    raise HTTPException(status_code=401, detail="Incorrect supervisor password")


@router.post("/reset-password")
def auth_reset_password(req: ResetPasswordRequest):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.email or not req.new_password or not req.confirm_password:
        raise HTTPException(status_code=400, detail="All fields are required")
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if req.new_password != req.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    user = users_col.find_one({"email": req.email})
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    hashed_password = pwd_context.hash(req.new_password)
    users_col.update_one(
        {"email": req.email},
        {"$set": {"password": hashed_password, "updatedAt": datetime.utcnow().isoformat()}}
    )
    print(f"[AUTH] ✅ Password reset for: {req.email}")
    return {"success": True, "message": "Password reset successfully! Please sign in."}


# ------------------------------------------------------------------
# Basic endpoints
# ------------------------------------------------------------------
