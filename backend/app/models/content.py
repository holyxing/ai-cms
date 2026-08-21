"""内容 (Content) 模型

依据: docs/04b-数据模型.md §3.6-3.8
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Integer,
    String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.site import Site
    from app.models.taxonomy import Taxonomy
    from app.models.user import User
    from app.models.category import Category



class Content(Base, TimestampMixin):
    """内容"""

    __tablename__ = "contents"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft','pending','published','scheduled','archived')",
            name="ck_contents_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True,
        server_default="gen_random_uuid()",
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    subtitle: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # P3.5.2
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    excerpt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # P3.6.1 (migrate 0020): 封面图 / 列表缩略图
    cover_image: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Banner 大图（栏目头条轮播，与 cover_image 分离）
    banner_image: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # 头条：栏目 banner 轮播取各子栏目的头条文章
    is_featured: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false",
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="draft",
    )
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    published_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True,
    )
    locked_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True,
    )
    locked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    search_vector = mapped_column(TSVECTOR, nullable=True)
    metadata_: Mapped[dict] = mapped_column(
        "metadata", JSONB, nullable=False, server_default="{}",
    )
    view_count: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0",
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None,
    )
    # P2.7: 主栏目 (一文一栏目, 与 ContentTaxonomy N:N 的 tag/series/format 并存)
    category_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    # P3.9.1+ (holy 反馈 #11279 续): 副本溯源
    # - NULL: 主稿
    # - 非 NULL: 副本, 指向主稿 content.id (CASCADE: 删主稿自动删副本)
    is_copy_of: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contents.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )

    # 关系
    versions: Mapped[list["ContentVersion"]] = relationship(
        "ContentVersion", back_populates="content",
        cascade="all, delete-orphan",
        order_by="ContentVersion.version_num.desc()",
    )
    category: Mapped[Optional["Category"]] = relationship(
        "Category", back_populates="contents", lazy="joined",
    )
    # P3.8.9: author relationship for HY_CONTENT_AUTHOR 模板标签
    # 用 foreign_keys 消除 ambiguous (Content 跟 User 有 author_id 跟 locked_by 两个 FK)
    author: Mapped["User"] = relationship(
        "User", lazy="joined", foreign_keys=[author_id],
    )


class ContentTaxonomy(Base):
    """内容-栏目 N:N"""

    __tablename__ = "content_taxonomies"

    content_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contents.id", ondelete="CASCADE"),
        primary_key=True,
    )
    taxonomy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("taxonomies.id", ondelete="CASCADE"),
        primary_key=True,
    )
    is_primary: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()",
    )


class ContentVersion(Base):
    """内容版本 (永不删)"""

    __tablename__ = "content_versions"
    __table_args__ = (
        UniqueConstraint("content_id", "version_num",
                         name="uq_content_versions_num"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True,
        server_default="gen_random_uuid()",
    )
    content_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contents.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    version_num: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    excerpt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    is_auto_save: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()",
    )

    content = relationship("Content", back_populates="versions")
