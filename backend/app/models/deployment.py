"""静态发布 (Deployment) 模型

依据: docs/04b-数据模型.md §4.3 (P2)
依据: docs/12-P2-决策.md §B6, §D1, §E1-E4
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, String, Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.site import Site
    from app.models.theme_version import ThemeVersion
    from app.models.user import User


class Deployment(Base, TimestampMixin):
    """静态发布记录

    一次"发布" = 一个 deployment 记录
    状态: pending → building → success / failed / cancelled
    """

    __tablename__ = "deployments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','building','success','failed','cancelled')",
            name="ck_deployments_status",
        ),
        CheckConstraint(
            "triggered_by IN ('manual','scheduled','api','rollback')",
            name="ck_deployments_triggered_by",
        ),
        CheckConstraint(
            "scope IN ('site','category','content')",
            name="ck_deployments_scope",
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
    theme_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("theme_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    triggered_by: Mapped[str] = mapped_column(String(20), nullable=False)
    trigger_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    content_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # 本次发布的文章数
    artifact_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # /data/sites/{site_id}/public
    artifact_size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    # 字节
    build_log: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # astro build 输出 (后 64KB)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 自动重试次数
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # === P3.6.1: 发布粒度 (site / category / content) ===
    scope: Mapped[str] = mapped_column(
        String(20), nullable=False, default="site", server_default="site",
    )
    # 粒度: site 整站 / category 栏目级 / content 文章级
    scope_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True,
    )
    # category/content 发布时填, 对应 categories.id / contents.id
    # (site 发布时为 null)

    # 关系
    site: Mapped["Site"] = relationship("Site", foreign_keys=[site_id])
    theme_version: Mapped[Optional["ThemeVersion"]] = relationship(
        "ThemeVersion", foreign_keys=[theme_version_id],
    )
    trigger_user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[trigger_user_id])
