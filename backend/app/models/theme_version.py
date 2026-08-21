"""主题版本 (ThemeVersion) 模型

依据: docs/04b-数据模型.md §4.2 (P2)
依据: docs/12-P2-决策.md §A2, §B3
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.site import Site
    from app.models.theme import Theme
    from app.models.user import User


class ThemeVersion(Base, TimestampMixin):
    """主题版本（站级应用实例）

    每个站每次"应用主题"或"改 token"都创建新 version
    1 个 site 同时只有 1 个 is_active=true (partial unique index 强制)
    """

    __tablename__ = "theme_versions"
    __table_args__ = (
        UniqueConstraint("site_id", "version", name="uq_theme_versions_site_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True,
        server_default="gen_random_uuid()",
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    theme_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("themes.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    # 引用哪个主题（应用 = 新建 version 引用该 theme）
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    # 1, 2, 3 ... 递增
    tokens: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # 站点当前的完整 tokens (可能人工调过)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_ai_generated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # AI 改主题的提示词 (回溯用)
    change_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # 人手改的备注 ("调亮主色")
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()",
    )

    # 关系
    site: Mapped["Site"] = relationship("Site", foreign_keys=[site_id])
    theme: Mapped["Theme"] = relationship("Theme", foreign_keys=[theme_id])
    author: Mapped["User"] = relationship("User", foreign_keys=[author_id])
