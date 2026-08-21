"""站点成员 + 邀请模型 (P1.2b)

依据: docs/04b-数据模型.md §3.3, §3.4
"""
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import TimestampMixin


# === role 枚举 (Pydantic 与 DB Check 约束共用) ===
SITE_ROLES = ("owner", "editor", "viewer")


class SiteMember(Base, TimestampMixin):
    """站点成员 (已加入)"""

    __tablename__ = "site_members"
    __table_args__ = (
        CheckConstraint(
            "name IN ('owner', 'editor', 'viewer')",
            name="ck_site_members_role",
        ),
        Index(
            "uq_site_members_site_user",
            "site_id", "user_id",
            unique=True,
            postgresql_where="deleted_at IS NULL",
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
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    invited_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="now()"
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<SiteMember site={self.site_id} user={self.user_id} role={self.name}>"


class Invitation(Base):
    """邀请 (未注册或未接受)"""

    __tablename__ = "invitations"
    __table_args__ = (
        CheckConstraint(
            "name IN ('owner', 'editor', 'viewer')",
            name="ck_invitations_role",
        ),
        UniqueConstraint("token", name="uq_invitations_token"),
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
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    token: Mapped[str] = mapped_column(String(64), nullable=False)
    invited_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="now()"
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<Invitation {self.email} → site={self.site_id} role={self.name}>"
