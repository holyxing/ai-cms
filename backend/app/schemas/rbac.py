"""RBAC: 角色/权限/用户管理 schemas (P0 需求, 2026-06-06)"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# === Permission ===
class PermissionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    resource: str
    description: Optional[str] = None


class PermissionGroup(BaseModel):
    """权限按 resource 分组 (UI 用)"""
    resource: str
    label: str
    permissions: list[PermissionRead]


# === Role ===
class RoleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str
    description: Optional[str] = None
    is_system: bool
    permission_count: int = 0
    user_count: int = 0
    created_at: datetime
    updated_at: datetime


class RoleDetail(RoleRead):
    """角色详情: 含权限 code 列表 + 用户列表"""
    permission_codes: list[str] = []


class RoleCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    permission_codes: list[str] = []


class RoleUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    permission_codes: Optional[list[str]] = None  # None = 不改, [] = 清空


# === User ===
class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str
    avatar: Optional[str] = None
    is_active: bool
    is_super_admin: bool
    last_login_at: Optional[datetime] = None
    last_login_ip: Optional[str] = None
    created_at: datetime
    role_codes: list[str] = []  # 全局角色 code 列表
    site_count: int = 0  # 关联站点数


class UserCreate(BaseModel):
    email: EmailStr
    name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=8, max_length=128)
    is_active: bool = True
    is_super_admin: bool = False
    role_codes: list[str] = []  # 全局角色 code 列表


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    password: Optional[str] = Field(None, min_length=8, max_length=128)
    is_active: Optional[bool] = None
    role_codes: Optional[list[str]] = None  # None = 不改


# === Site Member (用户-站点关联) ===
class SiteMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    site_name: str
    site_slug: str
    name: str  # site_members.name (owner/editor/viewer)
    joined_at: datetime


class UserSitesAssign(BaseModel):
    """重置用户的站点列表 (含角色)"""
    assignments: list[SiteAssignment] = Field(default_factory=list)


class SiteAssignment(BaseModel):
    site_id: uuid.UUID
    name: str  # owner/editor/viewer
