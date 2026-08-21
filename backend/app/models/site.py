"""站点 + 域名模型 (P1.1)

依据: docs/04b-数据模型.md §3.1, §3.2
"""
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin


class Site(Base, TimestampMixin):
    """站点表"""

    __tablename__ = "sites"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_sites_slug"),
        CheckConstraint(
            "status IN ('active', 'archived')",
            name="ck_sites_status",
        ),
        CheckConstraint(
            "publish_status IN ('never_published', 'building', 'published', 'failed', 'out_of_sync')",
            name="ck_sites_publish_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default="gen_random_uuid()",
    )
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="active"
    )
    # P2.6: 静态发布状态, 由 worker 在 deployment 完成时回写
    publish_status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="never_published", index=True,
    )
    settings: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    # 关系
    domains: Mapped[list["SiteDomain"]] = relationship(
        back_populates="site",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Site {self.slug}>"


class SiteDomain(Base, TimestampMixin):
    """站点域名"""

    __tablename__ = "site_domains"
    __table_args__ = (
        UniqueConstraint("domain", name="uq_site_domains_domain"),
        CheckConstraint(
            "type IN ('primary', 'alias', 'preview')",
            name="ck_site_domains_type",
        ),
        CheckConstraint(
            "ssl_status IN ('pending', 'active', 'failed')",
            name="ck_site_domains_ssl",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default="gen_random_uuid()",
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    domain: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False, server_default="primary")
    ssl_status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="pending")
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # 关系
    site: Mapped["Site"] = relationship(back_populates="domains")

    def __repr__(self) -> str:
        return f"<SiteDomain {self.domain}>"
