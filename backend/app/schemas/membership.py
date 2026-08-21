"""成员 / 邀请 schemas (P1.2b)

依据: docs/04b-数据模型.md §3.3, §3.4
"""
import uuid
import re
from datetime import datetime
from typing import Literal, Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.membership import SITE_ROLES

SiteRole = Literal["owner", "editor", "viewer"]
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# === 邀请 ===

class InvitationCreate(BaseModel):
    """创建邀请"""
    email: Annotated[str, Field(min_length=3, max_length=255, examples=["alice@example.com"])]
    name: SiteRole = Field(default="viewer", examples=["editor"])
    expires_in_days: int = Field(default=7, ge=1, le=90)

    # 简单的 regex 而非 EmailStr (EmailStr 要装 email-validator)
    # TODO P1.5: 装 email-validator 后换 EmailStr
    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.lower().strip()
        if not EMAIL_PATTERN.match(v):
            raise ValueError("邮箱格式不正确")
        return v


class InvitationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    email: str
    name: str
    invited_by: uuid.UUID
    expires_at: datetime
    accepted_at: datetime | None
    created_at: datetime


class InvitationWithToken(InvitationRead):
    """创建邀请返回时含 token (一次性明文显示, 之后不存)"""
    token: str
    accept_url: str


# === 接受邀请 ===

class AcceptInvitationRequest(BaseModel):
    token: Annotated[str, Field(min_length=32, max_length=64)]


class AcceptInvitationResponse(BaseModel):
    site_id: uuid.UUID
    site_name: str
    site_slug: str
    role: str


# === 成员 ===

class MemberRead(BaseModel):
    """成员列表项 (含 user 基本信息)"""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str
    user_name: str | None
    name: str
    invited_by: uuid.UUID | None
    joined_at: datetime


class MemberUpdate(BaseModel):
    """修改成员角色"""
    name: SiteRole

    @field_validator("name")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in SITE_ROLES:
            raise ValueError(f"role 必须是 {SITE_ROLES}")
        return v
