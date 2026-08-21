"""主题版本 (ThemeVersion) Pydantic schemas

依据: docs/04b-数据模型.md §4.2
      docs/12-P2-决策.md §A2 + §B1 (自动 apply) + §B3 (改即存新 version)
"""
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ThemeVersionBase(BaseModel):
    tokens: dict[str, Any]
    change_note: str | None = Field(default=None, max_length=500)


class ThemeVersionCreateFromTheme(BaseModel):
    """应用主题 (从全局库选 theme)"""

    theme_id: uuid.UUID


class ThemeVersionUpdate(BaseModel):
    """改 token = 创建新 version"""

    tokens: dict[str, Any]
    change_note: str | None = Field(default=None, max_length=500)


class ThemeVersionRead(ThemeVersionBase):
    """主题版本详情"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    theme_id: uuid.UUID
    version: int
    is_active: bool
    is_ai_generated: bool
    prompt: str | None
    author_id: uuid.UUID
    author_name: str | None = None
    theme_code: str | None = None
    created_at: datetime


class ThemeVersionListItem(BaseModel):
    """版本列表项 (历史回滚用)"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version: int
    is_active: bool
    is_ai_generated: bool
    change_note: str | None
    author_id: uuid.UUID
    author_name: str | None = None
    theme_code: str | None = None
    created_at: datetime


class ThemeCurrentRead(BaseModel):
    """当前激活主题 (含主题库信息)"""

    model_config = ConfigDict(from_attributes=True)

    version: ThemeVersionRead
    theme: "ThemeReadLite"


class ThemeReadLite(BaseModel):
    """主题库信息 (在 version read 里嵌套)"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    display_name: str
    type: str
    is_default: bool
