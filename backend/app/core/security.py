"""JWT 安全工具"""
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from passlib.context import CryptContext

from app.core.config import get_settings

settings = get_settings()

# 密码哈希
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """哈希密码"""
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """验证密码"""
    return pwd_context.verify(plain, hashed)


def create_access_token(
    subject: str | int,
    expires_delta: timedelta | None = None,
    extra: dict[str, Any] | None = None,
) -> str:
    """创建 access token"""
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )
    to_encode: dict[str, Any] = {
        "sub": str(subject),
        "exp": expire,
        "type": "access",
        "iat": datetime.now(timezone.utc),
    }
    if extra:
        to_encode.update(extra)
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(subject: str | int) -> str:
    """创建 refresh token"""
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode = {
        "sub": str(subject),
        "exp": expire,
        "type": "refresh",
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    """解码 token, 失败抛异常"""
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])


def create_challenge_token(subject: str | int, purpose: str = "2fa") -> str:
    """创建 2FA challenge token (P5.4)

    用途: login 通过用户名密码后, 需 2FA 验证时返给前端的临时 token
    区别于 access_token:
    - type="challenge" (不是 access/refresh)
    - expires 5 分钟 (短)
    - 不能用来调任何业务 API, 只能用来调 /auth/2fa/verify
    """
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    to_encode = {
        "sub": str(subject),
        "exp": expire,
        "type": "challenge",
        "purpose": purpose,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_challenge_token(token: str, expected_purpose: str = "2fa") -> dict[str, Any]:
    """解码 challenge token, 验证 type + purpose"""
    payload = decode_token(token)
    if payload.get("type") != "challenge":
        from jwt import InvalidTokenError
        raise InvalidTokenError("Token 类型错误")
    if payload.get("purpose") != expected_purpose:
        from jwt import InvalidTokenError
        raise InvalidTokenError("Challenge purpose 不匹配")
    return payload
