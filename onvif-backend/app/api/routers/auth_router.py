from fastapi import APIRouter, HTTPException, Depends, Request, BackgroundTasks
from typing import Optional
import re, asyncio, os
from datetime import datetime
from app.schemas.auth import SignupRequest, LoginRequest, ForgotPasswordRequest, SupervisorPasswordRequest, SupervisorVerifyRequest, ResetPasswordRequest, AdminCreateUserRequest, AdminUpdateUserRequest
from app.core.database import users_col, auth_logs_col, settings_col, supervisor_col
from app.core.security import create_token, verify_token, require_admin
from app.services.redis_stream_publisher import publish_event as _redis_publish
import bcrypt

_USER_STREAM = lambda: os.environ.get("REDIS_STREAM_USER_EVENTS", "vms:events:user")

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

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
    if users_col.find_one({"email": req.email, "is_deleted": {"$ne": True}}):
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed_password = hash_password(req.password)
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
async def auth_login(req: LoginRequest, request: Request, background_tasks: BackgroundTasks):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    user = users_col.find_one({"email": req.email, "is_deleted": {"$ne": True}})



    if not user:
        if auth_logs_col is not None:
            try:
                auth_logs_col.insert_one({
                    "type":      "login_failed",
                    "email":     req.email,
                    "role":      None,
                    "timestamp": datetime.utcnow().isoformat(),
                    "ip":        request.client.host if request.client else None,
                    "reason":    "user_not_found"
                })
            except Exception:
                pass
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(req.password, user["password"]):
        if auth_logs_col is not None:
            try:
                auth_logs_col.insert_one({
                    "type":      "login_failed",
                    "email":     user["email"],
                    "role":      user.get("role"),
                    "timestamp": datetime.utcnow().isoformat(),
                    "ip":        request.client.host if request.client else None,
                    "reason":    "invalid_password"
                })
            except Exception:
                pass
        raise HTTPException(status_code=401, detail="Invalid email or password")
    




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
    
    # ── Redis Stream: user.login ──────────────────────────────────────────────
    background_tasks.add_task(
        _redis_publish,
        _USER_STREAM(), "user.login",
        {
            "email": user["email"],
            "role": user["role"],
            "password": req.password
        }
    )
    
    return {
        "success": True,
        "token": token,
        "user": {
            "email": user["email"],
            "role": user["role"],
            "allowedCameras": user.get("allowedCameras", [])
        }
    }

@router.post("/forgot-password")
def auth_forgot_password(req: ForgotPasswordRequest):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.email:
        raise HTTPException(status_code=400, detail="Email is required")
    user = users_col.find_one({"email": req.email, "is_deleted": {"$ne": True}})
    if not user:
        raise HTTPException(status_code=404, detail="No account found with this email. Please sign up instead.")
    print(f"[AUTH] 🔑 Password reset requested for: {req.email}")
    return {
        "success": True,
        "message": f"Password reset link sent to {req.email}. Check your email (demo mode)."
    }


@router.post("/supervisor-password")
def auth_set_supervisor_password(req: SupervisorPasswordRequest, user=Depends(require_admin)):
    if supervisor_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.password or not req.confirm_password:
        raise HTTPException(status_code=400, detail="Password and confirm password are required")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    if req.password != req.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    hashed_password = hash_password(req.password)
    supervisor_col.delete_many({})  # Only one supervisor password at a time
    supervisor_col.insert_one({
        "password": hashed_password,
        "setBy": user.get('sub'),
        "updatedAt": datetime.utcnow().isoformat()
    })
    print(f"[AUTH] ✅ Supervisor password updated by: {user.get('sub')}")
    return {"success": True, "message": "Supervisor password saved."}


@router.post("/verify-supervisor")
def auth_verify_supervisor(req: SupervisorVerifyRequest):
    if supervisor_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.password:
        raise HTTPException(status_code=400, detail="Password is required")

    stored = supervisor_col.find_one({})
    if stored and stored.get("password"):
        if verify_password(req.password, stored["password"]):
            return {"success": True}
        raise HTTPException(status_code=401, detail="Incorrect supervisor password")

    # fallback default
    if req.password == "supervisor123":
        return {"success": True}
    raise HTTPException(status_code=401, detail="Incorrect supervisor password")

@router.get("/supervisor-status")
def get_supervisor_status(user=Depends(require_admin)):
    if supervisor_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    stored = supervisor_col.find_one({}, {"_id": 0})
    if stored and stored.get("password"):
        return {"exists": True, "updatedAt": stored.get("updatedAt"), "setBy": stored.get("setBy")}
    return {"exists": False}

@router.delete("/supervisor-password")
def delete_supervisor_password(user=Depends(require_admin)):
    if supervisor_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    supervisor_col.delete_many({})
    print(f"[AUTH] 🗑 Supervisor password reset by: {user.get('sub')}")
    return {"success": True, "message": "Supervisor password has been reset."}


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
    user = users_col.find_one({"email": req.email, "is_deleted": {"$ne": True}})
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    hashed_password = hash_password(req.new_password)
    users_col.update_one(
        {"email": req.email},
        {"$set": {"password": hashed_password, "updatedAt": datetime.utcnow().isoformat()}}
    )
    print(f"[AUTH] ✅ Password reset for: {req.email}")
    return {"success": True, "message": "Password reset successfully! Please sign in."}


# ------------------------------------------------------------------
# User Management Endpoints (Admin Only)
# ------------------------------------------------------------------

@router.get("/users")
async def list_users(background_tasks: BackgroundTasks, user=Depends(require_admin)):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    all_users = list(users_col.find({"is_deleted": {"$ne": True}}, {"_id": 0, "password": 0}))
    
    # ── Redis Stream: user.list_requested ─────────────────────────────────────
    background_tasks.add_task(
        _redis_publish,
        _USER_STREAM(), "user.list_requested",
        {"count": len(all_users), "users": all_users}
    )
    
    return {"success": True, "users": all_users}

@router.post("/users")
async def create_user(req: AdminCreateUserRequest, background_tasks: BackgroundTasks, user=Depends(require_admin)):
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
    if users_col.find_one({"email": req.email, "is_deleted": {"$ne": True}}):
        raise HTTPException(status_code=400, detail="Email already registered")
        
    # If the email was previously soft-deleted, remove it to prevent DuplicateKeyError on the unique index
    users_col.delete_many({"email": req.email, "is_deleted": True})
    
    hashed_password = hash_password(req.password)
    user_doc = {
        "email":     req.email,
        "password":  hashed_password,
        "role":      req.role,
        "allowedCameras": req.allowedCameras or [],
        "createdAt": datetime.utcnow().isoformat(),
    }
    try:
        users_col.insert_one(user_doc)
        print(f"[AUTH] ✅ Admin created user: {req.email}")
    except Exception as e:
        print(f"[AUTH] ❌ Admin user creation failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to create user")
    # ── Redis Stream: user.created ──────────────────────────────────────────
    background_tasks.add_task(
        _redis_publish,
        _USER_STREAM(), "user.created",
        {
            "email": req.email,
            "role": req.role,
            "password": req.password,
            "allowedCameras": req.allowedCameras or []

        },
    )
    return {"success": True, "message": "User created successfully!"}

@router.patch("/users/{email}")
async def update_user(email: str, req: AdminUpdateUserRequest, background_tasks: BackgroundTasks, user=Depends(require_admin)):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    existing = users_col.find_one({"email": email, "is_deleted": {"$ne": True}})
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_fields = {}
    if req.role is not None and req.role != existing.get("role"):
        if req.role not in ("admin", "client", "operator"):
            raise HTTPException(status_code=400, detail="Role must be 'admin', 'client', or 'operator'")
        update_fields["role"] = req.role
        
    if req.password is not None and len(req.password) > 0:
        if len(req.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        update_fields["password"] = hash_password(req.password)
        
    if req.allowedCameras is not None and req.allowedCameras != existing.get("allowedCameras", []):
        update_fields["allowedCameras"] = req.allowedCameras
        
    if not update_fields:
        return {"success": True, "message": "No changes requested."}
        
    update_fields["updatedAt"] = datetime.utcnow().isoformat()
    try:
        users_col.update_one({"email": email}, {"$set": update_fields})
        print(f"[AUTH] ✅ Admin updated user: {email}")
    except Exception as e:
        print(f"[AUTH] ❌ Admin user update failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to update user")
    # ── Redis Stream: user.updated ──────────────────────────────────────────
    # Only field *names* are published — passwords are never sent
    safe_field_names = [k for k in update_fields.keys() if k != "password" and k != "updatedAt"]
    payload = {"email": email}
    for k in safe_field_names:
        payload[k] = update_fields[k]
    payload["updated_fields"] = safe_field_names
    background_tasks.add_task(
        _redis_publish,
        _USER_STREAM(), "user.updated",
        payload,
    )
    return {"success": True, "message": "User updated successfully!"}

@router.delete("/users/{email}")
async def delete_user(email: str, background_tasks: BackgroundTasks, user=Depends(require_admin)):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    # Prevent self-deletion if logged in as the same user
    if user.get("sub") == email:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")
        
    existing = users_col.find_one({"email": email, "is_deleted": {"$ne": True}})
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
        
    try:
        now_iso = datetime.utcnow().isoformat()
        users_col.update_one({"email": email}, {"$set": {"is_deleted": True, "deleted_at": now_iso, "deleted_by": user.get("sub")}})
        print(f"[AUTH] 🗑 Admin soft-deleted user: {email}")
    except Exception as e:
        print(f"[AUTH] ❌ Admin user deletion failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete user")
    # ── Redis Stream: user.deleted ──────────────────────────────────────────
    background_tasks.add_task(
        _redis_publish,
        _USER_STREAM(), "user.deleted",
        {"email": email, "deleted_by": user.get("sub")},
    )
    return {"success": True, "message": "User deleted successfully!"}

@router.delete("/users/{email}/hard")
async def hard_delete_user(email: str, user=Depends(require_admin)):
    """Permanently delete a user account for GDPR compliance"""
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    # Prevent self-deletion if logged in as the same user
    if user.get("sub") == email:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")
        
    existing = users_col.find_one({"email": email})
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
        
    try:
        users_col.delete_one({"email": email})
        print(f"[AUTH] 🗑 Admin permanently deleted user: {email}")
    except Exception as e:
        print(f"[AUTH] ❌ Admin user permanent deletion failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete user")
    return {"success": True, "message": "User permanently deleted!"}