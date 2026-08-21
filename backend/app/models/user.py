"""User 模型 (P0 最小版)

后续阶段会扩展:
- 站点成员关系 (site_members)
- 角色表 (roles)
- 头像/资料
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import TimestampMixin


class User(Base, TimestampMixin):
    """用户表"""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    avatar: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # 状态
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_super_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # 登录相关
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_login_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)

    def __repr__(self) -> str:
        return f"<User {self.email}>"
