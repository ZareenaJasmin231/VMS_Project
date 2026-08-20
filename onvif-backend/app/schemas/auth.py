from pydantic import BaseModel

class SignupRequest(BaseModel):
    email:    str
    password: str
    role:     str = "client"

from typing import Optional, List

class LoginRequest(BaseModel):
    email:    str
    password: str
    role:     str = "client"
    captcha_id: Optional[str] = None
    captcha_text: Optional[str] = None

class ForgotPasswordRequest(BaseModel):
    email: str

class SupervisorPasswordRequest(BaseModel):
    password:         str
    confirm_password: str

class SupervisorVerifyRequest(BaseModel):
    password: str

class ResetPasswordRequest(BaseModel):
    email:            str
    new_password:     str
    confirm_password: str

from typing import Optional, List

class AdminCreateUserRequest(BaseModel):
    email:    str
    password: str
    role:     str = "client"
    allowedCameras: Optional[List[str]] = None

class AdminUpdateUserRequest(BaseModel):
    role:     Optional[str] = None
    password: Optional[str] = None
    allowedCameras: Optional[List[str]] = None

