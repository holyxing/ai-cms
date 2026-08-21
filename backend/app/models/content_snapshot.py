"""内容快照 (ContentSnapshot) 模型

依据: docs/04b-数据模型.md §4.4 (P2)
依据: docs/12-P2-决策.md §F1
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import TimestampMixin


class ContentSnapshot(Base, TimestampMixin):
    """已发布内容 HTML 快照

    每次部署 = 一次 content_snapshots 批量写入
    - content 软删不影响 snapshot (历史价值)
    - content hard delete → snapshot ON DELETE CASCADE 删
    - deployment 删 → snapshot 跟着删
    """

    __tablename__ = "content_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True,
        server_default="gen_random_uuid()",
    )
    content_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contents.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    deployment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("deployments.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_versions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    body_html: Mapped[str] = mapped_column(Text, nullable=False)
    # 渲染后冻结的 HTML
    body_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # 冻结的 Tiptap JSON
    taxonomy_paths: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # 冻结时的栏目路径
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
    )
