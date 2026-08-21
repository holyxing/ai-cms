"""用户通知 (站内消息)

字段: id, user_id, title, body, link, level, kind, duration_ms, read_at, created_at
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import TimestampMixin


class UserNotification(Base, TimestampMixin):
    """用户站内通知"""

    __tablename__ = "user_notifications"
    __table_args__ = (
        Index("idx_user_notifications_user_created", "user_id", "created_at"),
        Index("idx_user_notifications_user_unread", "user_id", "read_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default="gen_random_uuid()",
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # success | error | info | warning
    level: Mapped[str] = mapped_column(String(20), nullable=False, default="info", server_default="info")
    # 如 publish.site / publish.category / publish.content
    kind: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
