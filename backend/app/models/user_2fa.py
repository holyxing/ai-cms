"""2FA TOTP 模型 (P5.4)

依据: docs/05-开发路线图.md P5.4 + 用户使用手册 §4.9 安全

工作流:
1. 用户 POST /users/me/2fa/setup
   → 生成 base32 secret (32 字节) + 8 recovery codes
   → 存 user_2fa (is_enabled=False, 暂未生效)
   → 返 secret + provisioning_uri (otpauth://) + recovery_codes (明文一次性)
2. 用户用 authenticator app 扫码 + 输入 6 位码
   → POST /users/me/2fa/verify-setup {code}
   → 验证 TOTP code → is_enabled=True, enabled_at=now
3. 登录时: 用户名密码 + is_enabled → 返 {requires_2fa: true, challenge_token}
4. POST /auth/2fa/verify {challenge_token, code} → access_token
   OR POST /auth/2fa/recover {challenge_token, recovery_code} → access_token

安全:
- secret 用 Fernet 加密 (跟 AI provider API key 一样)
- recovery codes bcrypt 哈希 (8 个, 一次性)
- TOTP step window = ±1 (60s 容忍)
- 防重放: last_used_step 存库, 同 step 拒绝
- 防 brute force: failed_attempts 5 → locked 5min
- challenge_token: 5min JWT (跟 access_token 不同 type)
"""
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import TimestampMixin


class User2FA(Base, TimestampMixin):
    """用户 2FA TOTP 配置 (每个用户最多一行, 启用前也可创建)"""

    __tablename__ = "user_2fa"
    __table_args__ = (
        # user_id 已 unique=True, 不重复建索引
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
        unique=True,
    )
    # Fernet 加密的 base32 secret (32 字符明文 → 约 140 字符密文)
    secret_encrypted: Mapped[str] = mapped_column(String(512), nullable=False)
    # 是否启用 (setup 后需 verify-setup 才置 True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # bcrypt 哈希的 8 个 recovery codes (JSON list of str)
    recovery_codes: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    # 上次使用的 TOTP step (防重放, 30s/step)
    last_used_step: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    # brute force 保护
    failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)