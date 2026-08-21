"""栏目 (Category) Pydantic schemas

依据: docs/17-站点树重构.md §4.1
"""
import re
import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class CategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=128, description="栏目名称")
    slug: str = Field(..., min_length=1, max_length=128, description="URL slug, 同站下唯一")
    description: Optional[str] = Field(None, max_length=1000)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        if not SLUG_RE.match(v):
            raise ValueError("slug 只能包含小写字母、数字、连字符, 不能以连字符开头/结尾")
        return v


class CategoryCreate(CategoryBase):
    """创建栏目"""

    parent_id: Optional[uuid.UUID] = Field(None, description="父栏目 id, 根栏目传 null")
    # 栏目列表模板代码, 引用 layouts.code (scope=category)
    template: Optional[str] = Field(
        "default", max_length=64, description="栏目列表模板代码"
    )
    # 栏目详情模板代码, 引用 layouts.code (scope=content)
    content_template: Optional[str] = Field(
        "default", max_length=64, description="栏目详情模板代码"
    )


class CategoryUpdate(BaseModel):
    """更新栏目 (全字段可选)"""

    name: Optional[str] = Field(None, min_length=1, max_length=128)
    slug: Optional[str] = Field(None, min_length=1, max_length=128)
    description: Optional[str] = Field(None, max_length=1000)
    parent_id: Optional[uuid.UUID] = Field(None, description="传 null 表示移到根")
    order_num: Optional[int] = None
    seo: Optional[dict] = None
    # 栏目列表模板代码
    template: Optional[str] = Field(None, max_length=64)
    # 栏目详情模板代码
    content_template: Optional[str] = Field(None, max_length=64)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not SLUG_RE.match(v):
            raise ValueError("slug 格式错误")
        return v


class CategoryRead(CategoryBase):
    """读取栏目 (扁平)"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    parent_id: Optional[uuid.UUID]
    path: str
    order_num: int
    seo: dict
    content_count: int
    template: str = "default"  # 栏目列表模板
    content_template: str = "default"  # 栏目详情模板
    created_at: str
    updated_at: str


class CategoryTreeNode(CategoryRead):
    """树形结构节点: 含 children"""

    children: list["CategoryTreeNode"] = []


# 前向引用
CategoryTreeNode.model_rebuild()
