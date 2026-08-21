"""AI Provider 模型 (P3.0)

依据: docs/09-AI集成方案.md §2.1
依据: docs/05-开发路线图.md P3

每个用户可配多个 provider (OpenAI / Anthropic / Ollama)
is_default=true 最多一条 (应用层约束)
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class AIProvider(Base, TimestampMixin):
    """AI 服务商配置 (per user)

    P3.0 范围: 1 provider (ollama)
    P3.1+ TODO: openai / anthropic, api_key_encrypted Fernet 加密
    """

    __tablename__ = "ai_providers"
    __table_args__ = (
        CheckConstraint(
            "provider IN ('openai','anthropic','ollama')",
            name="ck_ai_providers_provider",
        ),
        UniqueConstraint("user_id", "name", name="uq_ai_providers_user_name"),
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
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    api_key_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    base_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    extra_config: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # 软删除
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
