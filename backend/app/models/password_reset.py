"""密码重置模型 (P5.2 自助找回密码)

依据: docs/05-开发路线图.md P5 阶段 + 用户手册 FAQ

工作流:
1. 用户 POST /auth/forgot-password 提交邮箱
   → 生成 32 字节 token (secrets.token_urlsafe), 存 password_resets
   → 发送邮件 (生产: SMTP; 开发: 控制台日志)
2. 用户点邮件链接 /auth/reset-password?token=xxx
   → 前端调 POST /auth/reset-password {token, new_password}
   → 校验 token 未过期 (默认 1h) + 未使用
   → 改 user.password_hash + 标记 token used
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Boolean, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import TimestampMixin


class PasswordReset(Base, TimestampMixin):
    """密码重置请求 (一次性 token, 默认 1h 过期)"""

    __tablename__ = "password_resets"
    __table_args__ = (
        Index("idx_password_resets_token", "token", unique=True),
        Index("idx_password_resets_user", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default="gen_random_uuid()",
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    # 32-byte URL-safe token (secrets.token_urlsafe(32))
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    # 过期时间 (默认 1h)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # 是否已使用 (成功后置 True, 防止重复提交)
    used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 客户端 IP (审计)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
