"""媒体 (Media) 模型

依据: docs/04b-数据模型.md §3.9-3.11
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Integer,
    String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin


class MediaFolder(Base, TimestampMixin):
    """媒体分类文件夹 (邻接表)"""

    __tablename__ = "media_folders"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True,
        server_default="gen_random_uuid()",
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_folders.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None,
    )

    parent = relationship("MediaFolder", remote_side="MediaFolder.id",
                          backref="children")


class Media(Base, TimestampMixin):
    """媒体文件"""

    __tablename__ = "media"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True,
        server_default="gen_random_uuid()",
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_folders.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    uploader_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str] = mapped_column(
        String(512), nullable=False, unique=True,
    )
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    alt_text: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    metadata_: Mapped[dict] = mapped_column(
        "metadata", JSONB, nullable=False, server_default="{}",
    )
    # P3.6.2: 缩略图 (worker 异步生成 webp 200/800)
    thumb_small_key: Mapped[Optional[str]] = mapped_column(
        String(512), nullable=True,
    )
    thumb_large_key: Mapped[Optional[str]] = mapped_column(
        String(512), nullable=True,
    )
    thumb_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="pending",
    )
    # P3.6.2 G: 跨站共享标志 (true 则对所有站可见, 来源站记在 site_id)
    is_shared: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false",
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None,
    )

    # P3.6.2 F: 标签 (通过 MediaTagLink 多对多)
    tags: Mapped[list["MediaTag"]] = relationship(
        "MediaTag", secondary="media_tag_links",
        back_populates="medias",
    )


    __table_args__ = (
        CheckConstraint(
            "thumb_status IN ('pending', 'done', 'failed')",
            name="ck_media_thumb_status",
        ),
    )


class MediaTag(Base):
    """媒体标签 (P3.6.2 F: 替代文件夹的扁平化方案, site-scoped)"""

    __tablename__ = "media_tags"
    __table_args__ = (
        UniqueConstraint("site_id", "name", name="uq_media_tags_site_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True,
        server_default="gen_random_uuid()",
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    color: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()",
    )

    # 关联
    medias: Mapped[list["Media"]] = relationship(
        "Media", secondary="media_tag_links",
        back_populates="tags",
    )


class MediaTagLink(Base):
    """媒体-标签 N:N 关联表"""

    __tablename__ = "media_tag_links"

    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media.id", ondelete="CASCADE"),
        primary_key=True,
    )
    media_tag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_tags.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()",
    )


class MediaRelation(Base):
    """媒体-内容 N:N"""

    __tablename__ = "media_relations"
    __table_args__ = (
        CheckConstraint("role IN ('inline', 'cover', 'gallery')",
                        name="ck_media_relations_role"),
    )

    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media.id", ondelete="CASCADE"),
        primary_key=True,
    )
    content_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contents.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="inline",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()",
    )
