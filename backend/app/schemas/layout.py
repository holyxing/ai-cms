"""布局系统 Pydantic schemas

依据: docs/18-布局系统与标签占位符.md §7, §10

- LayoutBase/Read/Create/Update: CRUD 端点用
- LayoutVersionRead: 版本列表 / 回滚用
- LayoutPreviewRequest/Response: 预览渲染
- LayoutValidateRequest/Response: 标签合法性校验
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.layout import LAYOUT_SCOPES, LAYOUT_TEMPLATE_KINDS


# ===========================================================================
# 基础
# ===========================================================================

class LayoutBase(BaseModel):
    """所有 Layout schema 的公共字段"""

    scope: str = Field(..., description="site | home | category | content | partial")
    code: str = Field(..., min_length=1, max_length=64, description="唯一编码 (default/magazine/header-modern/...)")
    name: str = Field(..., min_length=1, max_length=128, description="中文名")
    html: str = Field(..., min_length=1, description="HTML + HY_ 标签源码")
    is_default: bool = Field(default=False, description="是否该 scope 的默认 layout")
    is_active: bool = Field(default=True, description="是否启用 (禁用后不出现在列表默认, 不参与发布)")
    template_kind: str = Field(default="page", description="page (页面模板) | partial (子模板)")
    parent_code: Optional[str] = Field(default=None, max_length=64, description="父模板 code (页面模板嵌套用)")

    @field_validator("scope")
    @classmethod
    def _validate_scope(cls, v: str) -> str:
        if v not in LAYOUT_SCOPES:
            raise ValueError(f"scope must be one of {LAYOUT_SCOPES}, got {v!r}")
        return v

    @field_validator("template_kind")
    @classmethod
    def _validate_template_kind(cls, v: str) -> str:
        if v not in LAYOUT_TEMPLATE_KINDS:
            raise ValueError(f"template_kind must be one of {LAYOUT_TEMPLATE_KINDS}, got {v!r}")
        return v


# ===========================================================================
# CRUD
# ===========================================================================

class LayoutCreate(LayoutBase):
    """创建 layout（site_id 从 URL 取，不在 body）"""

    change_note: Optional[str] = Field(default=None, max_length=500)


class LayoutUpdate(BaseModel):
    """更新 layout（PUT）

    注意: html 改了才会自增 version（空 html = 只改 name/is_default，不留 version）
    """

    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    html: Optional[str] = Field(default=None, min_length=1)
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None
    template_kind: Optional[str] = Field(default=None, description="page | partial")
    parent_code: Optional[str] = Field(default=None, max_length=64)
    change_note: Optional[str] = Field(default=None, max_length=500)


class LayoutRead(LayoutBase):
    """读 layout（含 id / 时间戳 / version）"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    version: int
    created_at: datetime
    updated_at: datetime


class LayoutListItem(BaseModel):
    """列表项（不含 html，体量大）"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    scope: str
    code: str
    name: str
    is_default: bool
    is_active: bool = True
    version: int
    template_kind: str
    parent_code: Optional[str] = None
    updated_at: datetime


class LayoutListResponse(BaseModel):
    """列布局响应"""

    items: list[LayoutListItem]
    total: int


# ===========================================================================
# 版本
# ===========================================================================

class LayoutVersionRead(BaseModel):
    """版本历史项"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    layout_id: uuid.UUID
    version: int
    change_note: Optional[str]
    author_id: uuid.UUID
    created_at: datetime


class LayoutVersionListResponse(BaseModel):
    """版本列表响应"""

    items: list[LayoutVersionRead]
    total: int


class LayoutRollbackRequest(BaseModel):
    """回滚请求"""

    target_version: int = Field(..., ge=1, description="回滚到哪个 version")
    change_note: Optional[str] = Field(default=None, max_length=500)


class LayoutActiveToggleRequest(BaseModel):
    """启用/禁用请求 (P3.7+ 模板 disable 反馈)"""

    is_active: bool = Field(..., description="True=启用, False=禁用")


# ===========================================================================
# 预览
# ===========================================================================

class LayoutPreviewRequest(BaseModel):
    """渲染预览请求

    不传 = 用 layout 当前 html 渲染
    传 html = 用临时 html 渲染（不入库，仅预览）
    """

    html: Optional[str] = Field(default=None, min_length=1, description="可选：临时 HTML")


class LayoutPreviewResponse(BaseModel):
    """渲染预览响应"""

    html: str = Field(..., description="渲染后的 HTML")
    warnings: list[str] = Field(default_factory=list, description="非致命警告（未知标签等）")
    errors: list[str] = Field(default_factory=list, description="致命错误（必须改）")


# ===========================================================================
# 校验
# ===========================================================================

class LayoutValidateResponse(BaseModel):
    """校验响应（开发期 lint）"""

    valid: bool
    errors: list[str] = Field(default_factory=list, description="致命错误（位置精确到行）")
    warnings: list[str] = Field(default_factory=list, description="警告（未知标签 / 漏闭合等）")
    tag_stats: dict[str, int] = Field(
        default_factory=dict, description="各标签使用次数 {HY_SITE_NAME: 5, ...}"
    )


class ZipImportPageItem(BaseModel):
    path: str
    scope: str


class ZipImportLayoutItem(BaseModel):
    id: str
    scope: str
    code: str
    name: str
    action: str
    version: int


class ZipImportResult(BaseModel):
    """网站 ZIP 导入结果"""

    assets_created: int = 0
    assets_overwritten: int = 0
    assets_skipped: int = 0
    layouts: list[ZipImportLayoutItem] = Field(default_factory=list)
    pages_classified: list[ZipImportPageItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    ai_used: bool = False
