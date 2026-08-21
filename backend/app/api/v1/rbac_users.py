"""RBAC: 用户管理 + 站点成员管理 API (P0 需求, 2026-06-06)

端点 (8):
- GET    /users                                用户列表 (super_admin)
- POST   /users                                创建用户 (super_admin)
- GET    /users/{id}                           用户详情
- PATCH  /users/{id}                           改用户信息/角色/启停 (super_admin)
- DELETE /users/{id}                           软删用户 (super_admin, 不能删自己)
- GET    /users/{id}/sites                     用户可访问的站点列表
- PUT    /users/{id}/sites                     重置用户站点成员 (super_admin)
- GET    /sites/{id}/members                   站点的成员列表 (owner+)
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.responses import ok
from app.core.deps import CurrentUser, get_db, get_super_admin
from app.core.exceptions import BadRequest, Forbidden, NotFound
from app.core.security import hash_password
from app.db.session import get_db as _get_db
from app.models.membership import SITE_ROLES, SiteMember
from app.models.rbac import Permission, Role, RolePermission, UserRole
from app.models.site import Site
from app.models.user import User
from app.schemas.rbac import (
    SiteAssignment,
    SiteMemberRead,
    UserCreate,
    UserRead,
    UserSitesAssign,
    UserUpdate,
)

router = APIRouter()


# === Users ===

@router.get("/users", response_model=None)
async def list_users(
    db: Annotated[AsyncSession, Depends(_get_db)],
    admin: Annotated[User, Depends(get_super_admin)],
    q: str | None = Query(None, description="按邮箱/名称模糊搜索"),
    is_active: bool | None = Query(None),
    role_code: str | None = Query(None, description="按全局角色 code 过滤"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """用户列表 (super_admin)"""
    stmt = select(User).order_by(User.created_at.desc())

    if q:
        stmt = stmt.where(User.email.ilike(f"%{q}%") | User.name.ilike(f"%{q}%"))
    if is_active is not None:
        stmt = stmt.where(User.is_active == is_active)
    if role_code:
        stmt = stmt.join(UserRole, UserRole.user_id == User.id).join(
            Role, Role.id == UserRole.role_id
        ).where(Role.code == role_code)

    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(stmt)
    users = result.scalars().unique().all()
    return ok([await _build_user_read(db, u) for u in users])


@router.post("/users", response_model=None, status_code=201)
async def create_user(
    body: UserCreate,
    db: Annotated[AsyncSession, Depends(_get_db)],
    admin: Annotated[User, Depends(get_super_admin)],
):
    """创建用户 (super_admin)"""
    # 邮箱重复
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise BadRequest(f"邮箱 {body.email} 已被注册")

    user = User(
        email=body.email,
        name=body.name,
        password_hash=hash_password(body.password),
        is_active=body.is_active,
        is_super_admin=body.is_super_admin,
    )
    db.add(user)
    await db.flush()

    # 绑全局角色
    if body.role_codes:
        roles_q = await db.execute(
            select(Role).where(Role.code.in_(body.role_codes))
        )
        for r in roles_q.scalars().all():
            db.add(UserRole(user_id=user.id, role_id=r.id, assigned_by=admin.id))

    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise BadRequest(f"创建失败: {e.orig}")

    await db.refresh(user)
    return ok(await _build_user_read(db, user))


@router.get("/users/{user_id}", response_model=None)
async def get_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(_get_db)],
    admin: Annotated[User, Depends(get_super_admin)],
):
    user = await _get_user_or_404(db, user_id)
    return ok(await _build_user_read(db, user))


@router.patch("/users/{user_id}", response_model=None)
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    db: Annotated[AsyncSession, Depends(_get_db)],
    admin: Annotated[User, Depends(get_super_admin)],
):
    """改用户基本信息/启停/全局角色 (super_admin)
    注意: 不能直接改 is_super_admin 字段 (避免误操作), 通过 role_codes="super_admin" 改全局角色绑定
    """
    user = await _get_user_or_404(db, user_id)
    if user.id == admin.id and body.is_active is False:
        raise BadRequest("不能停用自己")

    if body.name is not None:
        user.name = body.name
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    if body.is_active is not None:
        user.is_active = body.is_active

    if body.role_codes is not None:
        # 删旧
        await db.execute(
            delete(UserRole).where(UserRole.user_id == user_id)
        )
        # 加新
        roles_q = await db.execute(
            select(Role).where(Role.code.in_(body.role_codes))
        )
        for r in roles_q.scalars().all():
            db.add(UserRole(user_id=user_id, role_id=r.id, assigned_by=admin.id))

    await db.commit()
    await db.refresh(user)
    return ok(await _build_user_read(db, user))


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(_get_db)],
    admin: Annotated[User, Depends(get_super_admin)],
):
    """软删用户 (super_admin, 不能删自己)
    注: 软删 = is_active=False, 保留数据
    """
    user = await _get_user_or_404(db, user_id)
    if user.id == admin.id:
        raise BadRequest("不能删除自己")
    user.is_active = False
    await db.commit()
    return ok(None)


# === User → Sites ===

@router.get("/users/{user_id}/sites", response_model=None)
async def get_user_sites(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(_get_db)],
    admin: Annotated[User, Depends(get_super_admin)],
):
    """用户可访问的站点列表 (super_admin)"""
    await _get_user_or_404(db, user_id)

    # owner 站点
    owner_q = await db.execute(
        select(Site.id, Site.name, Site.slug, Site.owner_id)
        .where(Site.owner_id == user_id, Site.deleted_at.is_(None))
    )
    owner_rows = owner_q.all()

    # member 站点
    member_q = await db.execute(
        select(SiteMember, Site.name, Site.slug)
        .join(Site, Site.id == SiteMember.site_id)
        .where(
            SiteMember.user_id == user_id,
            SiteMember.deleted_at.is_(None),
            Site.deleted_at.is_(None),
        )
    )
    member_rows = member_q.all()

    out: list[SiteMemberRead] = []
    seen: set[uuid.UUID] = set()
    for sid, sname, slug, _ in owner_rows:
        out.append(SiteMemberRead(
            id=uuid.uuid4(),  # owner 关系没有独立 id, 伪
            site_id=sid,
            site_name=sname,
            site_slug=slug,
            name="owner",
            joined_at=user.created_at,  # 用 user 创建时间近似
        ))
        seen.add(sid)
    for sm, sname, slug in member_rows:
        if sm.site_id in seen:
            continue  # owner 优先
        out.append(SiteMemberRead(
            id=sm.id,
            site_id=sm.site_id,
            site_name=sname,
            site_slug=slug,
            name=sm.name,
            joined_at=sm.joined_at,
        ))
    return ok(out)


@router.put("/users/{user_id}/sites", response_model=None)
async def assign_user_sites(
    user_id: uuid.UUID,
    body: UserSitesAssign,
    db: Annotated[AsyncSession, Depends(_get_db)],
    admin: Annotated[User, Depends(get_super_admin)],
):
    """重置用户的站点成员关系 (super_admin)
    全部覆盖: 删除现有 site_members, 按 body.assignments 重建
    """
    user = await _get_user_or_404(db, user_id)

    # 校验 role
    for a in body.assignments:
        if a.name not in SITE_ROLES:
            raise BadRequest(f"无效角色 {a.name}, 必须是 {SITE_ROLES}")

    # 校验 site 存在
    site_ids = [a.site_id for a in body.assignments]
    if site_ids:
        sites_q = await db.execute(
            select(Site.id).where(Site.id.in_(site_ids), Site.deleted_at.is_(None))
        )
        existing_sites = {row[0] for row in sites_q.all()}
        missing = set(site_ids) - existing_sites
        if missing:
            raise BadRequest(f"站点不存在: {missing}")

    # 删旧 (软删)
    await db.execute(
        delete(SiteMember).where(
            SiteMember.user_id == user_id,
            SiteMember.deleted_at.is_(None),
        )
    )

    # 加新
    for a in body.assignments:
        db.add(SiteMember(
            user_id=user_id,
            site_id=a.site_id,
            name=a.name,
            invited_by=admin.id,
        ))

    await db.commit()
    return ok(await get_user_sites(user_id, db, admin))


# === Site → Members ===

@router.get("/sites/{site_id}/all-members", response_model=None)
async def list_site_members(
    site_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(_get_db)],
    current: CurrentUser,
):
    """站点的成员列表 (owner+ / super_admin)"""
    # 鉴权: super_admin 或 该站点的 owner/editor
    if not current.is_super_admin:
        # 查是否是该站点的 owner/editor
        sm = await db.execute(
            select(SiteMember).where(
                SiteMember.site_id == site_id,
                SiteMember.user_id == current.id,
                SiteMember.name.in_(("owner", "editor")),
                SiteMember.deleted_at.is_(None),
            )
        )
        if not sm.scalar_one_or_none():
            # 也检查 sites.owner_id
            site = await db.execute(select(Site).where(Site.id == site_id))
            s = site.scalar_one_or_none()
            if not s or s.owner_id != current.id:
                raise Forbidden("无权查看该站点成员")

    q = await db.execute(
        select(SiteMember, Site.name, Site.slug, User.email, User.name)
        .join(Site, Site.id == SiteMember.site_id)
        .join(User, User.id == SiteMember.user_id)
        .where(
            SiteMember.site_id == site_id,
            SiteMember.deleted_at.is_(None),
        )
        .order_by(SiteMember.joined_at)
    )
    rows = q.all()
    return ok([
        SiteMemberRead(
            id=sm.id,
            site_id=sm.site_id,
            site_name=sname,
            site_slug=slug,
            name=sm.name,
            joined_at=sm.joined_at,
        )
        for sm, sname, slug, email, name in rows
    ])


# === Helpers ===

async def _get_user_or_404(db: AsyncSession, user_id: uuid.UUID) -> User:
    r = await db.execute(select(User).where(User.id == user_id))
    u = r.scalar_one_or_none()
    if not u:
        raise NotFound(f"用户 {user_id} 不存在")
    return u


async def _build_user_read(db: AsyncSession, u: User) -> UserRead:
    # 全局角色 codes
    roles_q = await db.execute(
        select(Role.code)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == u.id)
    )
    role_codes = [r[0] for r in roles_q.all()]

    # 站点数 (owner + member 去重)
    owner_count_q = await db.execute(
        select(func.count()).select_from(Site)
        .where(Site.owner_id == u.id, Site.deleted_at.is_(None))
    )
    member_count_q = await db.execute(
        select(func.count()).select_from(SiteMember)
        .where(SiteMember.user_id == u.id, SiteMember.deleted_at.is_(None))
    )
    site_count = (owner_count_q.scalar() or 0) + (member_count_q.scalar() or 0)

    return UserRead(
        id=u.id,
        email=u.email,
        name=u.name,
        avatar=u.avatar,
        is_active=u.is_active,
        is_super_admin=u.is_super_admin,
        last_login_at=u.last_login_at,
        last_login_ip=u.last_login_ip,
        created_at=u.created_at,
        role_codes=role_codes,
        site_count=site_count,
    )
