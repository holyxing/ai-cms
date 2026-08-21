"""内容 (Content) Pydantic schemas"""
import re
import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class ContentBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    subtitle: Optional[str] = Field(None, max_length=255)  # P3.5.2
    slug: str = Field(..., min_length=1, max_length=255)
    excerpt: Optional[str] = None
    # P3.6.1: 缩略图（列表卡片）
    cover_image: Optional[str] = Field(None, max_length=2000)
    # Banner 大图（栏目头条轮播）
    banner_image: Optional[str] = Field(None, max_length=2000)
    # 设为头条后进入栏目 banner 轮播
    is_featured: bool = False
    body: str = ""  # Tiptap HTML/JSON
    status: Literal["draft", "pending", "published", "scheduled", "archived"] = "draft"
    scheduled_at: Optional[datetime] = None  # status=scheduled 时必填
    # P2.7: 主栏目 (一对一, 决定导航位置)
    # tag/series/format 仍走 taxonomy_ids (N:N, 互不冲突)
    category_id: Optional[uuid.UUID] = None
    taxonomy_ids: list[uuid.UUID] = []
    primary_taxonomy_id: Optional[uuid.UUID] = None

    @field_validator("slug")
    @classmethod
    def v_slug(cls, v):
        if not SLUG_RE.match(v):
            raise ValueError("slug 格式: 小写字母/数字/连字符")
        return v


class ContentCreate(ContentBase):
    pass


class ContentUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    subtitle: Optional[str] = Field(None, max_length=255)  # P3.5.2
    slug: Optional[str] = None
    excerpt: Optional[str] = None
    # P3.6.1: 封面图
    cover_image: Optional[str] = Field(None, max_length=2000)
    banner_image: Optional[str] = Field(None, max_length=2000)
    is_featured: Optional[bool] = None
    body: Optional[str] = None
    status: Optional[Literal["draft", "pending", "published", "scheduled", "archived"]] = None
    scheduled_at: Optional[datetime] = None  # 传 null 表示取消计划
    # P2.7: 传 null 表示取消主栏目
    category_id: Optional[uuid.UUID] = None
    taxonomy_ids: Optional[list[uuid.UUID]] = None
    primary_taxonomy_id: Optional[uuid.UUID] = None
    # P3.9.1+ (holy 反馈 #11279 续): 多选栏目 = 复制多份副本
    # 传 None: 不动; 传 []: 只清 category_id; 传 [id1, id2, ...]: 同步 (增/减副本)
    category_ids: Optional[list[uuid.UUID]] = None

    @field_validator("slug")
    @classmethod
    def v_slug(cls, v):
        if v is None:
            return v
        if not SLUG_RE.match(v):
            raise ValueError("slug 格式错误")
        return v


class ContentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    author_id: uuid.UUID
    author_name: Optional[str] = None
    title: str
    subtitle: Optional[str] = None  # P3.5.2
    slug: str
    excerpt: Optional[str]
    # P3.6.1: 封面图
    cover_image: Optional[str] = None
    banner_image: Optional[str] = None
    is_featured: bool = False
    body: str = ""
    status: str
    scheduled_at: Optional[datetime]
    published_at: Optional[datetime]
    # P2.7
    category_id: Optional[uuid.UUID] = None
    taxonomy_ids: list[uuid.UUID] = []
    primary_taxonomy_id: Optional[uuid.UUID] = None
    # P3.9.1+ (holy 反馈 #11279 续): 副本溯源
    is_copy_of: Optional[uuid.UUID] = None
    view_count: int
    created_at: datetime
    updated_at: datetime


class ContentListItem(BaseModel):
    """列表项 (不含 body, 减少 payload)"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    author_id: uuid.UUID
    author_name: Optional[str] = None
    title: str
    subtitle: Optional[str] = None  # P3.5.2
    slug: str
    excerpt: Optional[str]
    # P3.6.1
    cover_image: Optional[str] = None
    banner_image: Optional[str] = None
    is_featured: bool = False
    status: str
    published_at: Optional[datetime]
    scheduled_at: Optional[datetime]
    # P2.7
    category_id: Optional[uuid.UUID] = None
    taxonomy_ids: list[uuid.UUID] = []
    primary_taxonomy_id: Optional[uuid.UUID] = None
    # P3.9.1+ (holy 反馈 #11279 续): 副本溯源
    is_copy_of: Optional[uuid.UUID] = None
    view_count: int
    created_at: datetime
    updated_at: datetime


class ContentVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    content_id: uuid.UUID
    version_num: int
    title: str
    body: str
    excerpt: Optional[str]
    author_id: uuid.UUID
    author_name: Optional[str] = None
    is_auto_save: bool
    created_at: datetime


class ContentPreviewRequest(BaseModel):
    """实时预览：用编辑器当前正文渲染（可不入库）。"""
    body: str = ""
