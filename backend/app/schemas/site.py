"""站点相关 schemas (P1.1)

依据: docs/04b-数据模型.md §3.1, §3.2
      docs/02-API-规范.md
"""
from __future__ import annotations

import uuid
import re
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

SLUG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
DOMAIN_PATTERN = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$"
)


# === Site ===

class SiteBase(BaseModel):
    slug: Annotated[str, Field(min_length=1, max_length=64, examples=["my-blog"])]
    name: Annotated[str, Field(min_length=1, max_length=128, examples=["我的博客"])]
    description: str | None = Field(default=None, max_length=1000)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        if not SLUG_PATTERN.match(v):
            raise ValueError(
                "slug 只能包含小写字母、数字、连字符, 且首尾必须是字母或数字"
            )
        return v


class SiteCreate(SiteBase):
    """创建站点"""

    logo_url: str | None = None
    settings: dict[str, Any] = Field(default_factory=dict)


class SiteUpdate(BaseModel):
    """更新站点 (全字段可选)"""

    slug: Annotated[str | None, Field(default=None, min_length=1, max_length=64)] = None
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=1000)
    logo_url: str | None = None
    status: str | None = None
    settings: dict[str, Any] | None = None

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not SLUG_PATTERN.match(v):
            raise ValueError(
                "slug 只能包含小写字母、数字、连字符, 且首尾必须是字母或数字"
            )
        return v

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is not None and v not in ("active", "archived"):
            raise ValueError("status 必须是 active 或 archived")
        return v


class SiteRead(SiteBase):
    """读取站点"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    logo_url: str | None
    owner_id: uuid.UUID
    status: str
    # P2.6: 静态发布状态
    publish_status: str = "never_published"
    settings: dict[str, Any]
    domains: list[SiteDomainRead] = Field(default_factory=list)  # P5: 过滤 deleted_at 在 API 层做
    created_at: datetime
    updated_at: datetime


class SiteListItem(BaseModel):
    """列表项 (轻量, 减少字段)"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name: str
    description: str | None
    logo_url: str | None
    status: str
    # P2.6: 静态发布状态
    publish_status: str = "never_published"
    domain_count: int = 0  # P5: 列表里不返完整 domains, 只返数量
    # P3.6+: 聚合统计 (用子查询一次查, 避免 N+1)
    content_count: int = 0
    category_count: int = 0
    layout_count: int = 0
    media_count: int = 0
    deployment_count: int = 0
    asset_count: int = 0  # P3.6.4: 站点资源 (site_assets)
    created_at: datetime
    updated_at: datetime


# === SiteDomain ===

class SiteDomainBase(BaseModel):
    domain: Annotated[str, Field(min_length=3, max_length=255, examples=["example.com"])]
    type: str = Field(default="primary", examples=["primary"])

    @field_validator("domain")
    @classmethod
    def validate_domain(cls, v: str) -> str:
        v = v.lower().strip()
        if not DOMAIN_PATTERN.match(v):
            raise ValueError("域名格式不正确")
        return v

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in ("primary", "alias", "preview"):
            raise ValueError("type 必须是 primary/alias/preview")
        return v


class SiteDomainCreate(SiteDomainBase):
    pass


class SiteDomainUpdate(BaseModel):
    """P3.6.5: 修改域名 (全部可选, 走 PATCH 语义)"""
    domain: str | None = Field(default=None, min_length=3, max_length=255)
    type: str | None = None

    @field_validator("domain")
    @classmethod
    def validate_domain(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.lower().strip()
        if not DOMAIN_PATTERN.match(v):
            raise ValueError("域名格式不正确")
        return v

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if v not in ("primary", "alias", "preview"):
            raise ValueError("type 必须是 primary/alias/preview")
        return v


class SiteDomainRead(SiteDomainBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    ssl_status: str
    verified_at: datetime | None
    created_at: datetime
