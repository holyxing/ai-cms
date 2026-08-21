"""AI Run / RunStep / UsageDaily 模型 (P3.0)

依据: docs/09-AI集成方案.md §2.1-2.3

ai_runs: 一次 AI 任务运行
ai_run_steps: 状态机步骤 (validate→generate→sanitize→save)
ai_usage_daily: 每日用量汇总
"""
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    BigInteger, CheckConstraint, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.site import Site
    from app.models.ai_provider import AIProvider


class AIRun(Base, TimestampMixin):
    """AI 任务运行 (1 次 = 1 行)"""

    __tablename__ = "ai_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','running','success','failed','cancelled')",
            name="ck_ai_runs_status",
        ),
        CheckConstraint(
            "task_type IN ('rewrite','expand','shorten','polish','translate','draft','audit','theme','image','optimize_design','responsive','a11y','seo')",
            name="ck_ai_runs_task_type",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True,
        server_default="gen_random_uuid()",
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    site_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sites.id", ondelete="SET NULL"),
        nullable=True,
    )
    task_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # P3.9.6+ (holy 反馈 #12444): site_agent 多轮对话 - 同会话多个 run 共享 conversation_id
    conversation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True, index=True,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    current_step: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    steps_total: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    steps_done: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    input: Mapped[dict] = mapped_column(JSONB, nullable=False)
    output: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    provider_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ai_providers.id", ondelete="SET NULL"),
        nullable=True,
    )
    model: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    prompt_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 6), nullable=True,
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    content_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("contents.id", ondelete="SET NULL"),
        nullable=True,
    )
    layout_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("layouts.id", ondelete="SET NULL"),
        nullable=True,
    )
    design_lang: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    diff_html: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    diff_stats: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    theme_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("theme_versions.id", ondelete="SET NULL"),
        nullable=True,
    )


class AIRunStep(Base):
    """AI 状态机步骤 (1 run = 多 steps)"""

    __tablename__ = "ai_run_steps"
    __table_args__ = (
        UniqueConstraint("run_id", "step_order", name="uq_ai_run_steps_run_order"),
        CheckConstraint(
            "status IN ('pending','running','success','failed')",
            name="ck_ai_run_steps_status",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ai_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_name: Mapped[str] = mapped_column(String(64), nullable=False)
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    input: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    output: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    delta: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default="NOW()", nullable=False,
    )


class AIUsageDaily(Base):
    """每日用量汇总 (PK: user + date + task_type)"""

    __tablename__ = "ai_usage_daily"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    usage_date: Mapped[date] = mapped_column(Date, primary_key=True)
    task_type: Mapped[str] = mapped_column(String(32), primary_key=True)
    runs_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_used: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    cost_usd: Mapped[Decimal] = mapped_column(
        Numeric(10, 4), nullable=False, default=Decimal("0"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default="NOW()", nullable=False,
    )
