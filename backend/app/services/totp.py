"""TOTP service (P5.4 2FA)

依据: RFC 6238 (TOTP) + 业界事实标准 (Google/Microsoft Authenticator)

设计:
- secret: 32 字节随机 → base32 编码 (32 字符明文)
- 算法: HMAC-SHA1, 6 位数字, 30s step (Google Authenticator 默认)
- provisioning URI: otpauth://totp/{issuer}:{user}?secret=...&issuer=...
  → 用 QR code library 转 PNG/SVG (前端可用 qrcode.react 自己生成)
- verify: pyotp.TOTP.verify(code, valid_window=1) 容忍 ±30s

为什么不直接用 pyotp:
- pyotp 是个好库, 我们用 pyotp.totp.TOTP 做 verify
- 但 secret 生成 + provisioning URI 我们自己控制 (issuer/label 标准化)

依赖: pyotp (轻量, ~10KB)
"""
import base64
import io
import secrets
from typing import Tuple

import pyotp

from app.core.crypto import decrypt_api_key as decrypt, encrypt_api_key as encrypt

# Issuer 显示在 authenticator app 里 (e.g. "AI-CMS")
ISSUER = "AI-CMS"
# secret 长度 (字节) — base32 后 32 字符
SECRET_BYTES = 20
# 6 位数字
DIGITS = 6
# 30s step
INTERVAL = 30


def generate_secret() -> str:
    """生成 base32 TOTP secret (32 字符)

    RFC 6238 推荐 160 bit (20 字节), base32 编码后 32 字符.
    用 secrets.token_bytes 保证密码学安全.
    """
    return base64.b32encode(secrets.token_bytes(SECRET_BYTES)).decode("ascii").rstrip("=")


def encrypt_secret(secret: str) -> str:
    """加密 secret (Fernet, 跟 AI provider API key 一致)"""
    return encrypt(secret)


def decrypt_secret(secret_encrypted: str) -> str:
    """解密 secret (Fernet)"""
    return decrypt(secret_encrypted)


def provisioning_uri(user_email: str, secret: str) -> str:
    """生成 otpauth:// URI, 用 QR code 库扫码

    格式: otpauth://totp/AI-CMS:user@example.com?secret=BASE32SECRET&issuer=AI-CMS
    """
    return pyotp.totp.TOTP(secret).provisioning_uri(name=user_email, issuer_name=ISSUER)


def verify_code(secret: str, code: str, valid_window: int = 1) -> Tuple[bool, int]:
    """验证 TOTP code

    Args:
        secret: base32 TOTP secret (明文)
        code: 6 位数字 (用户输入)
        valid_window: 容忍窗口 (默认 1 = ±30s = 60s 总窗口)

    Returns:
        (is_valid, step): step 是当前 TOTP step (用于防重放存 last_used_step)
    """
    # 防 brute force: 必须是 6 位数字
    code = code.strip().replace(" ", "")
    if not code.isdigit() or len(code) != DIGITS:
        return False, 0

    totp = pyotp.totp.TOTP(secret, digits=DIGITS, interval=INTERVAL)
    step = totp.timecode(datetime_now())  # 当前 step
    is_valid = totp.verify(code, valid_window=valid_window)
    return is_valid, step if is_valid else 0


def current_step() -> int:
    """返回当前 TOTP step (用于防重放检查)"""
    return pyotp.totp.TOTP("placeholder").timecode(datetime_now())


def generate_recovery_codes(count: int = 8) -> list[str]:
    """生成 N 个 recovery codes (一次性, 16 字符 URL-safe)

    格式: xxxx-xxxx (4-4) — 易手抄/读
    存储: bcrypt 哈希 (前端拿明文, 后端存哈希)
    """
    codes = []
    for _ in range(count):
        # 8 字节 = 11 字符 url-safe, 取前 8 字符
        raw = secrets.token_urlsafe(8)[:8].upper()
        # 4-4 分组
        codes.append(f"{raw[:4]}-{raw[4:]}")
    return codes


def datetime_now():
    """避免循环引用, 统一 import"""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)