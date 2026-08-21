"""栏目 (Taxonomy) 模型

依据: docs/04b-数据模型.md §3.5

设计:
- 树结构: parent_id 邻接表 + path 物化路径
- type: 'category' (P1.3 先做) / 'tag' (P1.3 后期)
- slug 唯一性: (site_id, slug, type) 联合唯一
- 物化路径维护: 移动节点时同步更新所有后代的 path
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.site import Site


class Taxonomy(Base, TimestampMixin):
    """栏目 / 标签"""

    __tablename__ = "taxonomies"
    __table_args__ = (
        CheckConstraint("type IN ('category', 'tag')", name="ck_taxonomies_type"),
        {"comment": "栏目树: 邻接表 + 物化路径"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True,
        server_default="gen_random_uuid()",
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("taxonomies.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False, server_default="category")
    path: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_num: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    seo: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    # 自引用关系
    parent = relationship("Taxonomy", remote_side="Taxonomy.id", backref="children")

    def __repr__(self) -> str:
        return f"<Taxonomy {self.name} ({self.type})>"

    @property
    def depth(self) -> int:
        """路径深度: 0 = 根"""
        return self.path.count("/") - 2  # 路径格式 "/a/b/c/" → 2 段 → 1 深度

    def is_descendant_of(self, other: "Taxonomy") -> bool:
        """判断是否 other 的后代 (用于阻止循环引用)"""
        return self.path.startswith(other.path) and self.id != other.id
