"""远程部署 SSH 服务器配置

用于发布后将站点静态产物 rsync 到远程服务器。
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import TimestampMixin


class DeployServer(Base, TimestampMixin):
    """SSH 远程部署目标服务器（全局配置，可设默认）"""

    __tablename__ = "deploy_servers"
    __table_args__ = (
        CheckConstraint(
            "auth_type IN ('pem', 'password')",
            name="ck_deploy_servers_auth_type",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default="gen_random_uuid()",
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False, default=22, server_default="22")
    username: Mapped[str] = mapped_column(String(100), nullable=False)
    auth_type: Mapped[str] = mapped_column(String(20), nullable=False, default="pem")
    # Fernet 加密存储；二选一或 pem 类型用 private_key_path
    password_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    private_key_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Worker 容器内可读路径（如挂载 /keys/xxx.pem），与 encrypted 二选一
    private_key_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # 远程根目录，实际路径 = {remote_base_path}/{site_slug}/public/
    remote_base_path: Mapped[str] = mapped_column(
        String(500), nullable=False, default="/var/www/sites", server_default="/var/www/sites",
    )
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
