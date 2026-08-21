"""栏目 (Taxonomy) Pydantic schemas"""
import re
import uuid
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class TaxonomyBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=128, description="栏目名称")
    slug: str = Field(..., min_length=1, max_length=128, description="URL slug")
    description: Optional[str] = None
    type: Literal["category", "tag"] = "category"

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        if not SLUG_RE.match(v):
            raise ValueError("slug 只能包含小写字母、数字、连字符, 且不能以连字符开头/结尾")
        return v


class TaxonomyCreate(TaxonomyBase):
    parent_id: Optional[uuid.UUID] = Field(None, description="父栏目 id, 根栏目为 null")


class TaxonomyUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    slug: Optional[str] = Field(None, min_length=1, max_length=128)
    description: Optional[str] = None
    parent_id: Optional[uuid.UUID] = Field(None, description="传 null 表示移到根")
    order_num: Optional[int] = None
    seo: Optional[dict] = None

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v):
        if v is None:
            return v
        if not SLUG_RE.match(v):
            raise ValueError("slug 格式错误")
        return v


class TaxonomyRead(TaxonomyBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    parent_id: Optional[uuid.UUID]
    path: str
    order_num: int
    seo: dict
    created_at: str
    updated_at: str


class TaxonomyTreeNode(TaxonomyRead):
    """树形结构节点: 含 children"""

    depth: int
    children: list["TaxonomyTreeNode"] = []


# 前向引用
TaxonomyTreeNode.model_rebuild()
