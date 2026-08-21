"""2FA TOTP endpoints (P5.4)

依据: docs/05-开发路线图.md P5.4

端点列表:
- POST /auth/2fa/setup          → 生成 secret + recovery codes (is_enabled=False)
- POST /auth/2fa/verify-setup   → 输入第一个 6 位码 → is_enabled=True
- GET  /users/me/2fa/status     → 当前 2FA 状态
- POST /users/me/2fa/disable    → 禁用 2FA (需 code 或 password 确认)
- POST /users/me/2fa/regenerate-recovery-codes → 重生成 8 个 recovery codes
- POST /auth/2fa/verify         → login 第二步: challenge + code → access_token
- POST /auth/2fa/recover        → login 第二步: challenge + recovery_code → access_token
"""
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_api_key as decrypt, encrypt_api_key as encrypt
from app.core.deps import CurrentUser, get_current_user
from app.core.exceptions import BadRequest, NotFound, Unauthorized
from app.core.ratelimit import limiter as _limiter
from app.core.responses import ok
from app.core.security import (
    create_access_token,
    create_challenge_token,
    create_refresh_token,
    decode_challenge_token,
    verify_password,
)
from app.db.session import get_db
from app.models.user import User
from app.models.user_2fa import User2FA
from app.schemas.user import (
    LoginResponse2FA,
    TwoFactorDisableRequest,
    TwoFactorRecoverRequest,
    TwoFactorSetupResponse,
    TwoFactorStatus,
    TwoFactorVerifyRequest,
    TwoFactorVerifySetup,
)
from app.services import totp as totp_svc
from app.core.config import get_settings

router = APIRouter(prefix="/auth/2fa", tags=["2fa"])
settings = get_settings()

# 防 brute force: 5 次失败锁 5 分钟
MAX_FAILED_ATTEMPTS = 5
LOCK_MINUTES = 5


async def _get_or_create_2fa(db: AsyncSession, user_id) -> User2FA:
    """获取或创建 user_2fa 行 (创建时不启用)"""
    r = await db.execute(select(User2FA).where(User2FA.user_id == user_id))
    obj = r.scalar_one_or_none()
    if obj:
        return obj
    obj = User2FA(
        user_id=user_id,
        secret_encrypted="",  # setup 时填
        is_enabled=False,
        recovery_codes="[]",
    )
    db.add(obj)
    await db.flush()
    return obj


async def _lock_check(obj: User2FA) -> None:
    """检查锁定状态, 锁着抛 Unauthorized"""
    if obj.locked_until and obj.locked_until > datetime.now(timezone.utc):
        remaining = int((obj.locked_until - datetime.now(timezone.utc)).total_seconds() // 60) + 1
        raise Unauthorized(f"2FA 验证已锁定, 请 {remaining} 分钟后重试", code=40106)


async def _inc_failed(obj: User2FA) -> None:
    obj.failed_attempts += 1
    if obj.failed_attempts >= MAX_FAILED_ATTEMPTS:
        obj.locked_until = datetime.now(timezone.utc) + timedelta(minutes=LOCK_MINUTES)
        obj.failed_attempts = 0  # 重置, 下次再算


def _reset_failed(obj: User2FA) -> None:
    obj.failed_attempts = 0
    obj.locked_until = None


def _hash_recovery(code: str) -> str:
    """bcrypt 哈希 recovery code"""
    from app.core.security import hash_password
    return hash_password(code)


def _verify_recovery(code: str, hashed: str) -> bool:
    """bcrypt 验证"""
    from app.core.security import verify_password
    try:
        return verify_password(code, hashed)
    except Exception:
        return False


# === Setup 流程 ===

@router.post("/setup", response_model=None)
@_limiter.limit("10/minute")
async def setup_2fa(
    request: Request,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """初始化 2FA setup

    返回 secret + provisioning_uri + recovery_codes (一次性明文).
    前端用 qrcode 库渲染 provisioning_uri 成 QR code.
    用户扫码后调 verify-setup 输入第一个 6 位码激活.
    """
    # 防止已启用的用户重复 setup
    r = await db.execute(select(User2FA).where(User2FA.user_id == current_user.id))
    obj = r.scalar_one_or_none()
    if obj and obj.is_enabled:
        raise BadRequest("2FA 已启用, 如需重置请先禁用")

    obj = await _get_or_create_2fa(db, current_user.id)
    secret = totp_svc.generate_secret()
    obj.secret_encrypted = totp_svc.encrypt_secret(secret)
    codes = totp_svc.generate_recovery_codes(8)
    obj.recovery_codes = json.dumps([_hash_recovery(c) for c in codes])
    obj.is_enabled = False
    await db.commit()

    return ok(TwoFactorSetupResponse(
        secret=secret,
        provisioning_uri=totp_svc.provisioning_uri(current_user.email, secret),
        recovery_codes=codes,
    ).model_dump())


@router.post("/verify-setup", response_model=None)
@_limiter.limit("10/minute")
async def verify_setup(
    request: Request,
    body: TwoFactorVerifySetup,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """验证第一个 TOTP code, 激活 2FA"""
    r = await db.execute(select(User2FA).where(User2FA.user_id == current_user.id))
    obj = r.scalar_one_or_none()
    if not obj or not obj.secret_encrypted:
        raise NotFound("请先调 /auth/2fa/setup 初始化")
    if obj.is_enabled:
        raise BadRequest("2FA 已启用")

    await _lock_check(obj)

    secret = totp_svc.decrypt_secret(obj.secret_encrypted)
    is_valid, step = totp_svc.verify_code(secret, body.code)
    if not is_valid:
        await _inc_failed(obj)
        await db.commit()
        raise Unauthorized("TOTP 码错误", code=40107)

    obj.is_enabled = True
    obj.enabled_at = datetime.now(timezone.utc)
    obj.last_used_step = step
    _reset_failed(obj)
    await db.commit()

    return ok({"message": "2FA 已启用", "is_enabled": True})


# === 查询 / 管理 ===

@router.get("/status", response_model=None)
async def get_status(
    request: Request,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """查询当前 2FA 状态"""
    r = await db.execute(select(User2FA).where(User2FA.user_id == current_user.id))
    obj = r.scalar_one_or_none()
    if not obj:
        return ok(TwoFactorStatus(is_enabled=False, recovery_codes_remaining=0).model_dump())
    codes_remaining = len(json.loads(obj.recovery_codes))
    return ok(TwoFactorStatus(
        is_enabled=obj.is_enabled,
        enabled_at=obj.enabled_at,
        recovery_codes_remaining=codes_remaining,
    ).model_dump())


@router.post("/disable", response_model=None)
@_limiter.limit("5/minute")
async def disable_2fa(
    request: Request,
    body: TwoFactorDisableRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """禁用 2FA — 需 code 或 password 确认"""
    r = await db.execute(select(User2FA).where(User2FA.user_id == current_user.id))
    obj = r.scalar_one_or_none()
    if not obj or not obj.is_enabled:
        raise BadRequest("2FA 未启用")

    # 优先验 TOTP code
    if body.code and body.code.isdigit() and len(body.code) == 6:
        secret = totp_svc.decrypt_secret(obj.secret_encrypted)
        is_valid, _ = totp_svc.verify_code(secret, body.code)
        if not is_valid:
            raise Unauthorized("TOTP 码错误", code=40107)
    elif body.password:
        # 密码确认: 重新查 user
        ur = await db.execute(select(User).where(User.id == current_user.id))
        user = ur.scalar_one()
        if not verify_password(body.password, user.password_hash):
            raise Unauthorized("密码错误", code=40108)
    else:
        raise BadRequest("需提供 TOTP code 或 password")

    # 软删 (保留行用于审计, is_enabled=False)
    obj.is_enabled = False
    obj.enabled_at = None
    obj.last_used_step = 0
    obj.failed_attempts = 0
    obj.locked_until = None
    await db.commit()

    return ok({"message": "2FA 已禁用", "is_enabled": False})


@router.post("/regenerate-recovery-codes", response_model=None)
@_limiter.limit("5/minute")
async def regenerate_recovery_codes(
    request: Request,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """重新生成 8 个 recovery codes (旧码全部失效)

    注意: 这个端点本身应该有 code 二次确认, 这里简化为依赖 session 鉴权
    """
    r = await db.execute(select(User2FA).where(User2FA.user_id == current_user.id))
    obj = r.scalar_one_or_none()
    if not obj or not obj.is_enabled:
        raise BadRequest("2FA 未启用")

    codes = totp_svc.generate_recovery_codes(8)
    obj.recovery_codes = json.dumps([_hash_recovery(c) for c in codes])
    await db.commit()

    return ok({"recovery_codes": codes})


# === Login 第二步 ===

@router.post("/verify", response_model=None)
@_limiter.limit("10/minute")
async def verify_login(
    body: TwoFactorVerifyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Login 第二步: challenge_token + TOTP code → access_token"""
    try:
        payload = decode_challenge_token(body.challenge_token, expected_purpose="2fa")
    except Exception as e:
        raise Unauthorized(f"Challenge token 无效: {e}", code=40109)

    user_id = payload.get("sub")
    if not user_id:
        raise Unauthorized("Challenge token 缺少 subject", code=40109)

    r = await db.execute(select(User2FA).where(User2FA.user_id == user_id))
    obj = r.scalar_one_or_none()
    if not obj or not obj.is_enabled:
        raise Unauthorized("用户未启用 2FA", code=40110)

    await _lock_check(obj)

    secret = totp_svc.decrypt_secret(obj.secret_encrypted)
    is_valid, step = totp_svc.verify_code(secret, body.code)

    # 防重放: 同 step 拒绝
    if is_valid and step <= obj.last_used_step:
        is_valid = False

    if not is_valid:
        await _inc_failed(obj)
        await db.commit()
        raise Unauthorized("TOTP 码错误", code=40107)

    obj.last_used_step = step
    _reset_failed(obj)
    await db.commit()

    # 拿 user 信息
    ur = await db.execute(select(User).where(User.id == user_id))
    user = ur.scalar_one()

    # 更新登录信息
    user.last_login_at = datetime.now(timezone.utc)
    user.last_login_ip = request.client.host if request.client else None
    await db.commit()
    await db.refresh(user)

    # 跟 login 一样返 TokenPair
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    from app.schemas.user import UserRead
    return ok({
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": UserRead.model_validate(user).model_dump(mode="json"),
    })


@router.post("/recover", response_model=None)
@_limiter.limit("10/minute")
async def recover_login(
    body: TwoFactorRecoverRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Login 第二步 (recovery code 路径): challenge + recovery_code → access_token

    使用后该 recovery code 失效 (从哈希列表里移除)
    """
    try:
        payload = decode_challenge_token(body.challenge_token, expected_purpose="2fa")
    except Exception as e:
        raise Unauthorized(f"Challenge token 无效: {e}", code=40109)

    user_id = payload.get("sub")
    r = await db.execute(select(User2FA).where(User2FA.user_id == user_id))
    obj = r.scalar_one_or_none()
    if not obj or not obj.is_enabled:
        raise Unauthorized("用户未启用 2FA", code=40110)

    await _lock_check(obj)

    # 验证 recovery code (从哈希列表里找)
    hashes = json.loads(obj.recovery_codes)
    matched_idx = -1
    for i, h in enumerate(hashes):
        if _verify_recovery(body.recovery_code, h):
            matched_idx = i
            break

    if matched_idx == -1:
        await _inc_failed(obj)
        await db.commit()
        raise Unauthorized("Recovery code 错误", code=40111)

    # 移除已用的 recovery code
    hashes.pop(matched_idx)
    obj.recovery_codes = json.dumps(hashes)
    _reset_failed(obj)
    await db.commit()

    ur = await db.execute(select(User).where(User.id == user_id))
    user = ur.scalar_one()

    user.last_login_at = datetime.now(timezone.utc)
    user.last_login_ip = request.client.host if request.client else None
    await db.commit()
    await db.refresh(user)

    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    from app.schemas.user import UserRead
    return ok({
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": UserRead.model_validate(user).model_dump(mode="json"),
        "recovery_codes_remaining": len(hashes),
    })