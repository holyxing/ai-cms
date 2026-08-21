"""成员管理 + 邀请 API (P1.2b)

依据: docs/04b-数据模型.md §3.3, §3.4
      docs/10-权限矩阵.md

API 设计:
- 列表成员: GET /api/v1/sites/{site_id}/members
- 邀请: POST /api/v1/sites/{site_id}/invitations  (返回一次性 token)
- 列出邀请: GET /api/v1/sites/{site_id}/invitations
- 撤销邀请: DELETE /api/v1/sites/{site_id}/invitations/{inv_id}
- 改成员角色: PATCH /api/v1/sites/{site_id}/members/{member_id}
- 移除成员: DELETE /api/v1/sites/{site_id}/members/{member_id}
- 接受邀请: POST /api/v1/invitations/accept (需登录; 携带 token)
- 查看我的待接受邀请: GET /api/v1/invitations/mine

权限:
- 邀请/列邀请/改角色/移除: super_admin 或 site owner
- 接受: 任何登录用户 (token 校验)
"""
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import CurrentUser
from app.core.exceptions import BadRequest, Conflict, Forbidden, NotFound
from app.core.responses import ok, page_resp
from app.db.session import get_db
from app.models.membership import Invitation, SiteMember
from app.models.site import Site
from app.models.user import User
from app.schemas.membership import (
    AcceptInvitationRequest,
    AcceptInvitationResponse,
    InvitationCreate,
    InvitationRead,
    InvitationWithToken,
    MemberRead,
    MemberUpdate,
)

router = APIRouter(tags=["members"])


# === Helper ===

async def _get_site_or_404(db: AsyncSession, site_id: uuid.UUID) -> Site:
    """取站点, 不含权限 (权限在 endpoint 内做)"""
    result = await db.execute(
        select(Site).where(Site.id == site_id, Site.deleted_at.is_(None))
    )
    site = result.scalar_one_or_none()
    if not site:
        raise NotFound("站点不存在")
    return site


def _require_manage_members(site: Site, user: User) -> None:
    """管理成员权限: super_admin 或 site owner"""
    if not user.is_super_admin and site.owner_id != user.id:
        raise Forbidden("需要 owner 权限")


def _require_change_role(site: Site, user: User, member: SiteMember, new_role: str) -> None:
    """修改成员角色权限:
    - super_admin: 任意修改
    - site owner: 任意修改
    - 成员本人: 只能改自己的角色, 且不能升为 owner
    """
    if user.is_super_admin or site.owner_id == user.id:
        return
    if member.user_id != user.id:
        raise Forbidden("只能修改自己的成员身份")
    if new_role == "owner":
        raise Forbidden("无法将自己升级为 owner, 请联系站点 owner")


# === 成员 ===

@router.get("/sites/{site_id}/members", response_model=None)
async def list_members(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
):
    """站点成员列表 (含已注册 user 信息, 分页)"""
    site = await _get_site_or_404(db, site_id)
    # 看权限: 任何已加入该站的人都能看成员
    accessible = await _get_user_accessible_site_ids(db, current_user)
    if accessible is not None and site_id not in accessible:
        raise Forbidden("无权访问该站点")

    # 基础查询
    base = (
        select(SiteMember, User)
        .join(User, User.id == SiteMember.user_id)
        .where(SiteMember.site_id == site_id, SiteMember.deleted_at.is_(None))
    )

    # 总数
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # 分页
    q = base.order_by(SiteMember.joined_at.asc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(q)
    rows = result.all()

    items = []
    for m, u in rows:
        items.append({
            "id": m.id,
            "user_id": m.user_id,
            "user_email": u.email,
            "user_name": u.name,
            "name": m.name,
            "invited_by": m.invited_by,
            "joined_at": m.joined_at.isoformat() if m.joined_at else None,
        })

    return page_resp(items, total=total, page=page, page_size=page_size)


@router.patch("/sites/{site_id}/members/{member_id}", response_model=None)
async def update_member_role(
    site_id: uuid.UUID,
    member_id: uuid.UUID,
    body: MemberUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """修改成员角色 (owner → editor → viewer)"""
    site = await _get_site_or_404(db, site_id)

    result = await db.execute(
        select(SiteMember).where(
            SiteMember.id == member_id,
            SiteMember.site_id == site_id,
            SiteMember.deleted_at.is_(None),
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise NotFound("成员不存在")

    # 权限: super_admin/owner 任意改; 本人只能降级
    _require_change_role(site, current_user, member, body.name)

    # 业务规则: 同一站至少要有 1 个 owner
    if member.name == "owner" and body.name != "owner":
        owner_count = await db.execute(
            select(func.count()).select_from(SiteMember).where(
                SiteMember.site_id == site_id,
                SiteMember.name == "owner",
                SiteMember.deleted_at.is_(None),
            )
        )
        if (owner_count.scalar() or 0) <= 1:
            raise BadRequest("站内至少需要 1 个 owner, 请先添加新的 owner 再降级")

    member.name = body.name
    await db.commit()
    return ok(message="角色已更新")


@router.delete("/sites/{site_id}/members/{member_id}", response_model=None)
async def remove_member(
    site_id: uuid.UUID,
    member_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """移除成员 (软删除)"""
    site = await _get_site_or_404(db, site_id)
    _require_manage_members(site, current_user)

    result = await db.execute(
        select(SiteMember).where(
            SiteMember.id == member_id,
            SiteMember.site_id == site_id,
            SiteMember.deleted_at.is_(None),
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise NotFound("成员不存在")

    # 业务规则: 不能移除最后一个 owner
    if member.name == "owner":
        owner_count = await db.execute(
            select(func.count()).select_from(SiteMember).where(
                SiteMember.site_id == site_id,
                SiteMember.name == "owner",
                SiteMember.deleted_at.is_(None),
            )
        )
        if (owner_count.scalar() or 0) <= 1:
            raise BadRequest("站内至少需要 1 个 owner, 无法移除")

    from datetime import datetime, timezone
    member.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return ok(message="已移除")


# === 邀请 ===

@router.post("/sites/{site_id}/invitations", response_model=None, status_code=201)
async def create_invitation(
    site_id: uuid.UUID,
    body: InvitationCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """邀请新成员 (返回一次性 token)"""
    site = await _get_site_or_404(db, site_id)
    _require_manage_members(site, current_user)

    # 1. 该 email 是否已是成员
    user = await _get_user_by_email(db, body.email)
    if user:
        already = await db.execute(
            select(SiteMember).where(
                SiteMember.site_id == site_id,
                SiteMember.user_id == user.id,
                SiteMember.deleted_at.is_(None),
            )
        )
        if already.scalar_one_or_none():
            raise Conflict(f"{body.email} 已是站内成员", code=40901)

    # 2. 是否有未过期的 pending 邀请 (去重, 避免邮件刷屏)
    pending = await db.execute(
        select(Invitation).where(
            Invitation.site_id == site_id,
            Invitation.email == body.email,
            Invitation.accepted_at.is_(None),
            Invitation.deleted_at.is_(None),
            Invitation.expires_at > func.now(),
        )
    )
    if pending.scalar_one_or_none():
        raise Conflict(f"{body.email} 已有未过期的邀请", code=40902)

    # 3. 生成 token (URL-safe, 43 字符熵 ~256 bit)
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)

    inv = Invitation(
        site_id=site_id,
        email=body.email,
        name=body.name,
        token=token,
        invited_by=current_user.id,
        expires_at=expires_at,
    )
    db.add(inv)
    await db.commit()
    await db.refresh(inv)

    # 4. 返回 URL (前端页 /invitations/accept?token=XXX)
    settings = get_settings()
    accept_url = f"{settings.FRONTEND_BASE}/invitations/accept?token={token}"

    data = {
        "id": str(inv.id),
        "site_id": str(inv.site_id),
        "email": inv.email,
        "name": inv.name,
        "invited_by": str(inv.invited_by),
        "expires_at": inv.expires_at.isoformat(),
        "accepted_at": None,
        "created_at": inv.created_at.isoformat(),
        "token": token,
        "accept_url": accept_url,
    }
    return ok(data, message="邀请已创建")


@router.get("/sites/{site_id}/invitations", response_model=None)
async def list_invitations(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
):
    """列出站点的邀请 (含 pending / accepted / expired, 分页)"""
    site = await _get_site_or_404(db, site_id)
    _require_manage_members(site, current_user)

    # 基础
    base = (
        select(Invitation)
        .where(Invitation.site_id == site_id, Invitation.deleted_at.is_(None))
    )
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    result = await db.execute(
        base.order_by(Invitation.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )
    invs = result.scalars().all()
    now = datetime.now(timezone.utc)
    items = [
        {
            **InvitationRead.model_validate(i).model_dump(mode="json"),
            "status": (
                "accepted" if i.accepted_at
                else "expired" if i.expires_at < now
                else "pending"
            ),
        }
        for i in invs
    ]
    return page_resp(items, total=total, page=page, page_size=page_size)


@router.delete("/sites/{site_id}/invitations/{inv_id}", response_model=None)
async def revoke_invitation(
    site_id: uuid.UUID,
    inv_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """撤销邀请 (软删除, 接受后不可撤销)"""
    site = await _get_site_or_404(db, site_id)
    _require_manage_members(site, current_user)

    result = await db.execute(
        select(Invitation).where(
            Invitation.id == inv_id,
            Invitation.site_id == site_id,
            Invitation.deleted_at.is_(None),
        )
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise NotFound("邀请不存在")
    if inv.accepted_at:
        raise BadRequest("邀请已被接受, 无法撤销")

    from datetime import datetime, timezone
    inv.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return ok(message="已撤销")


# === 接受 / 我的 ===

@router.post("/invitations/accept", response_model=None)
async def accept_invitation(
    body: AcceptInvitationRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """接受邀请 (登录后用 token 兑换 site_member)"""
    result = await db.execute(
        select(Invitation).where(
            Invitation.token == body.token,
            Invitation.deleted_at.is_(None),
        )
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise NotFound("邀请不存在或已撤销")

    # email 必须匹配当前登录用户 (避免 token 泄露给其他人) - 先校验 (顺序重要)
    if inv.email.lower() != current_user.email.lower():
        raise Forbidden("该邀请发给了其他邮箱")

    # 状态校验
    now = datetime.now(timezone.utc)
    if inv.accepted_at:
        raise BadRequest("邀请已被接受")
    if inv.expires_at < now:
        raise BadRequest("邀请已过期, 请联系邀请人重新发送")

    # 站被软删了
    site = await _get_site_or_404(db, inv.site_id)

    # 不能重复
    already = await db.execute(
        select(SiteMember).where(
            SiteMember.site_id == inv.site_id,
            SiteMember.user_id == current_user.id,
            SiteMember.deleted_at.is_(None),
        )
    )
    if already.scalar_one_or_none():
        raise Conflict("你已是该站成员", code=40901)

    # 创建成员 + 标记接受
    member = SiteMember(
        site_id=inv.site_id,
        user_id=current_user.id,
        name=inv.name,
        invited_by=inv.invited_by,
    )
    db.add(member)
    inv.accepted_at = now
    await db.commit()

    return ok({
        "site_id": str(site.id),
        "site_name": site.name,
        "site_slug": site.slug,
        "role": inv.name,
    }, message="已加入")


@router.get("/invitations/mine", response_model=None)
async def list_my_invitations(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """列出我 (当前登录用户) 待接受的邀请"""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(Invitation, Site)
        .join(Site, Site.id == Invitation.site_id)
        .where(
            Invitation.email == current_user.email.lower(),
            Invitation.accepted_at.is_(None),
            Invitation.deleted_at.is_(None),
            Invitation.expires_at > now,
        )
        .order_by(Invitation.created_at.desc())
    )
    rows = result.all()
    items = [
        {
            **InvitationRead.model_validate(i).model_dump(mode="json"),
            "site_name": s.name,
            "site_slug": s.slug,
            "status": "pending",
        }
        for i, s in rows
    ]
    return page_resp(items, total=total, page=page, page_size=page_size)


# === 共享 helper: 查 user 可访问的站点 (用公共 deps.get_accessible_site_ids) ===

async def _get_user_accessible_site_ids(db: AsyncSession, user: User) -> list[uuid.UUID] | None:
    from app.core.deps import get_accessible_site_ids
    return await get_accessible_site_ids(db, user)


async def _get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(
        select(User).where(func.lower(User.email) == email.lower())
    )
    return result.scalar_one_or_none()
