"""认证相关接口"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import ExpiredSignatureError, InvalidTokenError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import CurrentUser, get_current_user
from app.core.exceptions import BadRequest, TokenInvalid, Unauthorized
from app.core.ratelimit import limiter as _limiter
from app.core.responses import ok
from app.core.security import (
    create_access_token,
    create_challenge_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.db.session import get_db
from app.models.user import User
from app.models.user_2fa import User2FA
from app.schemas.user import (
    RefreshRequest,
    TokenPair,
    UserCreate,
    UserLogin,
    UserRead,
)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()
bearer_scheme = HTTPBearer(auto_error=False)


@router.post("/login", response_model=None)
@_limiter.limit("10/minute")
async def login(
    body: UserLogin,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """登录"""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        raise Unauthorized("邮箱或密码错误", code=40105)

    if not user.is_active:
        raise Unauthorized("账户已停用", code=40104)

    # 更新登录信息
    user.last_login_at = datetime.now(timezone.utc)
    user.last_login_ip = request.client.host if request.client else None
    await db.commit()
    await db.refresh(user)

    # 生成 tokens
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)

    # P5.4: 如果用户启用 2FA, 不返 access_token, 改返 challenge_token
    r2fa = await db.execute(select(User2FA).where(User2FA.user_id == user.id))
    twofa = r2fa.scalar_one_or_none()
    if twofa and twofa.is_enabled:
        challenge = create_challenge_token(user.id, purpose="2fa")
        return ok({
            "requires_2fa": True,
            "challenge_token": challenge,
            "token_type": "bearer",
        })

    return ok({
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": UserRead.model_validate(user).model_dump(mode="json"),
    })


@router.post("/refresh", response_model=None)
@_limiter.limit("20/minute")
async def refresh_token(
    request: Request,
    body: RefreshRequest,
):
    """刷新 access token"""
    try:
        payload = decode_token(body.refresh_token)
    except ExpiredSignatureError:
        raise TokenInvalid("Refresh token 已过期")
    except InvalidTokenError:
        raise TokenInvalid("Refresh token 无效")

    if payload.get("type") != "refresh":
        raise TokenInvalid("Token 类型错误")

    user_id = payload.get("sub")
    if not user_id:
        raise TokenInvalid("Token 缺少 subject")

    access = create_access_token(user_id)
    return ok({
        "access_token": access,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    })


@router.get("/me", response_model=None)
async def me(current_user: CurrentUser):
    """当前用户信息"""
    return ok({"user": UserRead.model_validate(current_user).model_dump(mode="json")})


@router.post("/logout", response_model=None)
async def logout(current_user: CurrentUser):
    """登出 (前端清 token 即可, 后端可做黑名单, MVP 不做)"""
    return ok(message="已登出")


@router.post("/register", response_model=None)
@_limiter.limit("5/minute")
async def register(
    request: Request,
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    """注册 (MVP 开放注册, 第一个注册的自动成为超管; 后续默认普通用户)"""
    # 检查邮箱是否已存在
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise BadRequest("邮箱已被注册", code=40001)

    # 检查是否第一个用户 -> 自动超管
    from sqlalchemy import func as sql_func
    count_q = await db.execute(select(sql_func.count()).select_from(User))
    user_count = count_q.scalar() or 0
    is_first = user_count == 0

    user = User(
        email=body.email,
        name=body.name,
        password_hash=hash_password(body.password),
        is_super_admin=is_first or body.is_super_admin,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return ok({
        "user": UserRead.model_validate(user).model_dump(mode="json"),
        "is_first_user": is_first,
    }, message="注册成功" + (" (你是第一个用户, 已自动成为超管)" if is_first else ""))


# === P5.2 自助找回密码 ===

import secrets
from datetime import timedelta
from fastapi import Request

from app.models.password_reset import PasswordReset
from app.schemas.user import (
    ForgotPasswordRequest, ForgotPasswordResponse,
    ResetPasswordRequest, ResetPasswordResponse,
)
from app.services.mailer import send_password_reset_email

# Token 有效期 1 小时
PASSWORD_RESET_TTL = timedelta(hours=1)


@router.post("/forgot-password", response_model=None)
@_limiter.limit("5/minute")
async def forgot_password(
    body: ForgotPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """请求密码重置

    流程:
    1. 查 user (不存在也返 ok, 防泄漏)
    2. 生成 32 字节 token
    3. 写 password_resets
    4. 发邮件 (dev: 控制台日志 + 返 reset_url)
    """
    client_ip = request.client.host if request.client else None
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    response_data = {"message": "如果该邮箱存在, 重置链接已发送", "reset_url": None}
    settings = get_settings()

    if not user:
        # 邮箱不存在: 仍返 ok (防 enumeration 攻击)
        return ok(response_data)

    # 生成 token
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + PASSWORD_RESET_TTL
    pr = PasswordReset(
        user_id=user.id,
        token=token,
        expires_at=expires_at,
        ip_address=client_ip,
    )
    db.add(pr)
    await db.commit()

    reset_url = f"{settings.PUBLIC_URL}/reset-password?token={token}"
    ok_send = await send_password_reset_email(
        to_email=user.email,
        reset_url=reset_url,
        user_name=user.name,
    )
    if not ok_send:
        # 邮件发送失败, 也返 ok (避免泄漏), 但 dev 日志会出
        pass

    # DEV 环境返 reset_url 方便 E2E 测试
    if settings.ENV == "dev":
        response_data["reset_url"] = reset_url

    return ok(response_data)


@router.post("/reset-password", response_model=None)
@_limiter.limit("5/minute")
async def reset_password(
    body: ResetPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """重置密码 (用 token + 新密码)

    流程:
    1. 查 token (unique index)
    2. 校验: 未过期 + 未使用
    3. 改 user.password_hash
    4. 标记 token used
    5. 撤销用户所有未过期的 refresh_tokens (强制重新登录)
    """
    result = await db.execute(
        select(PasswordReset).where(PasswordReset.token == body.token)
    )
    pr = result.scalar_one_or_none()

    if not pr:
        raise BadRequest("无效的重置链接")
    if pr.used:
        raise BadRequest("该重置链接已被使用")
    if pr.expires_at < datetime.now(timezone.utc):
        raise BadRequest("重置链接已过期, 请重新申请")

    # 找 user
    user_r = await db.execute(select(User).where(User.id == pr.user_id))
    user = user_r.scalar_one_or_none()
    if not user:
        raise BadRequest("用户不存在")

    # 改密码
    user.password_hash = hash_password(body.new_password)
    pr.used = True
    await db.commit()

    # 注: refresh token 是无状态 JWT (不存 DB). 密码改了后, 旧 refresh token
    #      调 /refresh 仍能换新 access_token (subject=user.id). 前端需清 localStorage
    #      强迫用户重新登录. 未来要真撤销可加 RefreshToken 表 (本项目不存).
    return ok(ResetPasswordResponse().model_dump())


@router.get("/password-reset-token-info", response_model=None)
async def password_reset_token_info(
    token: str = Query(..., min_length=32, max_length=64),
    db: AsyncSession = Depends(get_db),
):
    """检查 token 状态 (前端 reset-password 页用, 显示"链接已过期"等)

    返回: {valid: bool, expired: bool, used: bool, email_hint: str | null}
    """
    result = await db.execute(
        select(PasswordReset).where(PasswordReset.token == token)
    )
    pr = result.scalar_one_or_none()
    if not pr:
        return ok({"valid": False, "expired": False, "used": False, "email_hint": None})

    now = datetime.now(timezone.utc)
    expired = pr.expires_at < now
    valid = (not pr.used) and (not expired)

    # 取邮箱前 3 字符 + *** (不暴露完整邮箱)
    user_r = await db.execute(select(User.email).where(User.id == pr.user_id))
    email = user_r.scalar_one_or_none()
    email_hint = None
    if email and "@" in email:
        local, domain = email.split("@", 1)
        email_hint = f"{local[:3]}***@{domain}"

    return ok({
        "valid": valid,
        "expired": expired,
        "used": pr.used,
        "email_hint": email_hint,
    })
