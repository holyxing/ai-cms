"""栏目 (Category) 模型

依据: docs/17-站点树重构.md §3.2

P2.7 重构: 从 Taxonomy 拆出, 独立成导航结构表
- 站点 1:N 栏目
- 栏目自引用 1:N (parent_id)
- 物化路径 path 邻接表双保险
- 跟 tag/series/format 完全解耦 (Taxonomy 表仍存这 3 类)

设计:
- id: UUID (沿用 PG gen_random_uuid)
- path: "/<id>/<id>/" 格式, 根为 "/<id>/"
- content_count: 反规范化, 拖入/移出时维护
- deleted_at: 软删除, 30 天清理
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.content import Content
    from app.models.site import Site


class Category(Base, TimestampMixin):
    """站点栏目 (导航结构)

    与 Taxonomy 的区别:
    - Type 字段: 不需要 (Category 单一类型, 语义清晰)
    - content_count: 反规范化, 树节点旁显示
    - 物理删除 vs Taxonomy 保留 type 字段
    """

    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True,
        server_default="gen_random_uuid()",
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False, server_default="/")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_num: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    seo: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    content_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # P3.6.1 (migrate 0020): 栏目列表模板 (引用 layouts.code, scope=category)
    template: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default="default",
    )
    # P3.9.5: 栏目详情模板 (引用 layouts.code, scope=content)
    content_template: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default="default",
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None,
    )

    # 自引用关系
    parent = relationship("Category", remote_side="Category.id", backref="children")
    # 内容反向 (lazy="select" 避免树构建时 N+1)
    contents = relationship("Content", back_populates="category", lazy="select")

    def __repr__(self) -> str:
        return f"<Category {self.name} (path={self.path})>"

    @property
    def depth(self) -> int:
        """路径深度: 0 = 根"""
        return max(0, self.path.count("/") - 2)

    def is_descendant_of(self, other: "Category") -> bool:
        """判断是否 other 的后代 (用于阻止循环引用)"""
        return self.path.startswith(other.path) and self.id != other.id
