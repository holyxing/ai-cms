"""主题 (Theme) 模型

依据: docs/04b-数据模型.md §4.1 (P2)
依据: docs/12-P2-决策.md §A1, §A2
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.site import Site
    from app.models.user import User


class Theme(Base, TimestampMixin):
    """主题（全局主题库, 无 site_id）

    5 个内置 preset + 用户可创建的 custom
    custom 通过 base_theme_id 追溯来源
    """

    __tablename__ = "themes"
    __table_args__ = (
        CheckConstraint(
            "type IN ('preset', 'custom')",
            name="ck_themes_type",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True,
        server_default="gen_random_uuid()",
    )
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # 5 个内置: default / business / tech / magazine / minimal
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False, default="preset")
    # custom 主题的来源 preset
    base_theme_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("themes.id", ondelete="SET NULL"),
        nullable=True,
    )
    template_name: Mapped[str] = mapped_column(String(64), nullable=False)
    # 对应 Astro _template 内的子目录 (本期统一用 'default')
    preview_image: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # 新站点默认应用的主题（partial unique index 强制只有一个为 true）
    default_tokens: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # 主题设计者冻结的种子 tokens (与 04a §3.1 schema 一致)
    tokens_schema: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # AI 可改字段白名单 (JSON Schema)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # 自引用关系（custom → base preset）
    base_theme: Mapped[Optional["Theme"]] = relationship(
        "Theme", remote_side="Theme.id", foreign_keys=[base_theme_id],
    )
