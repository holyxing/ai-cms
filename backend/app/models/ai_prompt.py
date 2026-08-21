"""AI Prompt 统一管理 (系统级可编辑提示词)

快捷操作 / 任务 system prompt / HTML 增强 共用一张表。
YAML 为内置默认；库内可覆盖，支持重置与导出导入（工具对接）。
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class AIPrompt(Base):
    __tablename__ = "ai_prompts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default="gen_random_uuid()",
    )
    # 稳定键：task.format_html / quick.title_candidates / enhance.style
    key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    # task | quick | enhance | import
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="task")
    # 关联 AI 任务类型（可选）
    task_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 内置原文，用于「重置」
    builtin_content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 模板变量名，如 ["target_lang", "word_count"]
    variables: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_customized: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now(),
    )
