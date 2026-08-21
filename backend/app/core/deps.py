"""通用依赖: 鉴权等"""
from typing import Annotated

import jwt
from fastapi import Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import TokenInvalid, Unauthorized
from app.core.security import decode_token
from app.db.session import get_db
from app.models.user import User

settings = get_settings()

# Bearer token scheme（auto_error=False 让错误走我们自己的处理）
bearer_scheme = HTTPBearer(auto_error=False)


def _resolve_access_token(
    credentials: HTTPAuthorizationCredentials | None,
    access_token: str | None,
) -> str:
    """Bearer 优先；预览 iframe/新窗可用 query access_token。"""
    if credentials is not None and credentials.credentials:
        return credentials.credentials
    if access_token:
        return access_token
    raise Unauthorized("缺少认证凭据")


async def get_current_user(
    request: Request,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
    ],
    db: Annotated[AsyncSession, Depends(get_db)],
    access_token: Annotated[str | None, Query(description="预览用 JWT（iframe/新窗）")] = None,
) -> User:
    """获取当前登录用户"""
    token = _resolve_access_token(credentials, access_token)
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise Unauthorized("Token 已过期", code=40101)
    except jwt.InvalidTokenError as e:
        raise TokenInvalid(f"Token 无效: {e}")

    if payload.get("type") != "access":
        raise TokenInvalid("Token 类型错误")

    user_id = payload.get("sub")
    if not user_id:
        raise TokenInvalid("Token 缺少 subject")

    # 从 DB 查用户
    result = await db.execute(select(User).where(User.id == uuid_from_str(user_id)))
    user = result.scalar_one_or_none()

    if not user:
        raise Unauthorized("用户不存在", code=40103)
    if not user.is_active:
        raise Unauthorized("用户已停用", code=40104)

    return user


def uuid_from_str(s: str):
    import uuid as _uuid
    try:
        return _uuid.UUID(s)
    except (ValueError, AttributeError):
        raise TokenInvalid("无效的 user id")


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_super_admin(current_user: CurrentUser) -> User:
    """要求超管"""
    if not current_user.is_super_admin:
        from app.core.exceptions import Forbidden
        raise Forbidden("需要超管权限")
    return current_user


SuperAdmin = Annotated[User, Depends(get_super_admin)]


# === 共享: 查询 user 可访问的 site_id 集合 ===
async def get_accessible_site_ids(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: User,
) -> list["uuid.UUID"] | None:
    """返回 user 可访问的 site_id 列表; None = 全部 (super_admin)

    规则 (P1.2b 起):
    - super_admin: 全部
    - site owner (sites.owner_id): 自己 owner 的站
    - site member (site_members): 已加入的站
    """
    import uuid
    from app.models.site import Site
    from app.models.membership import SiteMember

    if user.is_super_admin:
        return None

    q1 = select(Site.id).where(Site.owner_id == user.id, Site.deleted_at.is_(None))
    q2 = select(SiteMember.site_id).where(
        SiteMember.user_id == user.id, SiteMember.deleted_at.is_(None)
    )
    result = await db.execute(q1.union(q2))
    return [row[0] for row in result.all()]
