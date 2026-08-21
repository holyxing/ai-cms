"""布局系统模型（Layout + LayoutVersion）

依据: docs/18-布局系统与标签占位符.md §7

- Layout: 站点级布局模板（HTML + HY_ 标签源码）
- LayoutVersion: 每次改 HTML 自增 version，可回滚

scope 枚举: site | category | content | home
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text,
    UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.site import Site
    from app.models.user import User


# 允许的 scope 值
# - 4 个 page scope: site (站点布局) / home (首页) / category (栏目) / content (详情)
# - 1 个 partial scope: partial (子模板, 可被 <HY_TEMPLATE code="x" /> 引用)
LAYOUT_SCOPES = ("site", "category", "content", "home", "partial")

# 模板种类: page (页面模板) / partial (子模板)
LAYOUT_TEMPLATE_KINDS = ("page", "partial")


class Layout(Base, TimestampMixin):
    """布局模板

    字段约定:
    - site_id + scope + code 唯一（未软删时）
    - html 含 HY_ 标签占位符，发布时由 LayoutRenderer 替换
    - version 字段随每次 PUT 自增（同时写入 layout_versions）
    - is_default: 当前 site 该 scope 的默认 layout（1 个 site + 1 scope 仅 1 个 default）
    """

    __tablename__ = "layouts"
    __table_args__ = (
        CheckConstraint(
            f"scope IN {LAYOUT_SCOPES}",
            name="ck_layouts_scope",
        ),
        CheckConstraint(
            f"template_kind IN {LAYOUT_TEMPLATE_KINDS}",
            name="ck_layouts_template_kind",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    html: Mapped[str] = mapped_column(Text, nullable=False)
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    # P3.7+: 启用/禁用 (默认 True). 禁用后不出现在列表默认, 不参与发布渲染
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    # P3.7 模板重构: 种类 + 嵌套父模板
    template_kind: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="page"
    )
    parent_code: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True
    )
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1"
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # 关系
    site: Mapped["Site"] = relationship("Site", foreign_keys=[site_id])
    versions: Mapped[list["LayoutVersion"]] = relationship(
        "LayoutVersion",
        back_populates="layout",
        cascade="all, delete-orphan",
        order_by="LayoutVersion.version",
    )

    def __repr__(self) -> str:
        return (
            f"<Layout id={self.id} site_id={self.site_id} "
            f"scope={self.scope!r} code={self.code!r} v={self.version}>"
        )


class LayoutVersion(Base):
    """布局版本历史（可回滚）

    每次 PUT /layouts/{id} → 新增 1 行（version = 上次 + 1）
    字段约定:
    - (layout_id, version) 唯一
    - html 全量快照（不是 diff）
    - author_id 强制
    """

    __tablename__ = "layout_versions"
    __table_args__ = (
        UniqueConstraint("layout_id", "version", name="uq_layout_versions_layout_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    layout_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("layouts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    html: Mapped[str] = mapped_column(Text, nullable=False)
    change_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )

    # 关系
    layout: Mapped["Layout"] = relationship("Layout", back_populates="versions")
    author: Mapped["User"] = relationship("User", foreign_keys=[author_id])
