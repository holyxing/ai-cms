"""用户相关 schemas"""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserBase(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)


class UserCreate(UserBase):
    """创建用户（注册/管理员建）"""
    password: str = Field(min_length=8, max_length=128)
    is_super_admin: bool = False


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    avatar: str | None = None
    is_active: bool | None = None


class UserRead(UserBase):
    """读出的用户信息"""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    avatar: str | None = None
    is_active: bool
    is_super_admin: bool
    last_login_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class UserLogin(BaseModel):
    """登录请求"""
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class TokenPair(BaseModel):
    """token 对"""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshRequest(BaseModel):
    """刷新 token"""
    refresh_token: str


class AccessToken(BaseModel):
    """新 access token"""
    access_token: str
    token_type: str = "bearer"
    expires_in: int


# === P5.2 自助找回密码 ===

class ForgotPasswordRequest(BaseModel):
    """请求密码重置 (输入邮箱)"""
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    """请求响应 (dev 环境会返 reset_url 方便测试)"""
    message: str = "如果该邮箱存在, 重置链接已发送"
    # DEV 专用: 生产环境永远 null
    reset_url: str | None = None


class ResetPasswordRequest(BaseModel):
    """重置密码 (token + 新密码)"""
    token: str = Field(min_length=32, max_length=64)
    new_password: str = Field(min_length=8, max_length=128)


class ResetPasswordResponse(BaseModel):
    """重置成功响应"""
    message: str = "密码已重置, 请使用新密码登录"


# === P5.4 2FA TOTP ===

class TwoFactorSetupResponse(BaseModel):
    """2FA setup 阶段响应 (前端展示 QR code + recovery codes)

    注意: secret 只返这一次 (setup 期间), 启用后不再返明文
    """
    secret: str  # base32, 32 字符
    provisioning_uri: str  # otpauth://totp/...
    recovery_codes: list[str]  # 8 个明文 recovery codes (一次性)


class TwoFactorVerifySetup(BaseModel):
    """verify-setup: 用户输入第一个 6 位码确认扫码成功"""
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class TwoFactorStatus(BaseModel):
    """2FA 当前状态"""
    is_enabled: bool
    enabled_at: datetime | None = None
    # 未启用的恢复码数量 (用户可能用过几个)
    recovery_codes_remaining: int = 8


class TwoFactorDisableRequest(BaseModel):
    """禁用 2FA: 需要输入当前 TOTP code 或密码确认"""
    code: str | None = Field(default=None, min_length=6, max_length=10)
    password: str | None = Field(default=None, min_length=8, max_length=128)


class TwoFactorVerifyRequest(BaseModel):
    """login 后第二步: 输入 6 位码"""
    challenge_token: str = Field(min_length=20, max_length=512)
    code: str = Field(min_length=6, max_length=10)


class TwoFactorRecoverRequest(BaseModel):
    """login 后第二步 (recovery code 路径)"""
    challenge_token: str = Field(min_length=20, max_length=512)
    recovery_code: str = Field(min_length=8, max_length=20)


class LoginResponse2FA(BaseModel):
    """login 响应: 如果用户启用 2FA, 返 challenge 而非 access_token"""
    # 当 requires_2fa=False: 返下面 3 字段
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int | None = None
    user: dict | None = None
    # 当 requires_2fa=True: 返下面 2 字段
    requires_2fa: bool = False
    challenge_token: str | None = None
