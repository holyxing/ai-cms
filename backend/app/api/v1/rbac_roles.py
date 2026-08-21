"""RBAC: 角色 + 权限管理 API (P0 需求, 2026-06-06)

端点 (8):
- GET    /permissions                          权限树 (按 resource 分组)
- GET    /roles                                角色列表
- POST   /roles                                创建角色 (super_admin)
- GET    /roles/{id}                           角色详情
- PATCH  /roles/{id}                           改名称/描述/权限 (super_admin)
- DELETE /roles/{id}                           删角色 (super_admin, 系统角色不可删)
- POST   /roles/{id}/clone                     复制角色 (super_admin)
- GET    /roles/{id}/users                     角色的用户列表 (super_admin)
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.responses import ok
from app.core.deps import CurrentUser, get_db, get_super_admin
from app.core.exceptions import BadRequest, Forbidden, NotFound
from app.db.session import get_db as _get_db
from app.models.rbac import Permission, Role, RolePermission, UserRole
from app.models.user import User
from app.schemas.rbac import (
    PermissionGroup,
    PermissionRead,
    RoleCreate,
    RoleDetail,
    RoleRead,
    RoleUpdate,
    UserRead,
)

router = APIRouter()


# 权限分类标签 (UI 友好)
RESOURCE_LABELS = {
    "site": "站点管理",
    "member": "成员管理",
    "category": "栏目管理",
    "content": "内容管理",
    "media": "媒体管理",
    "theme": "主题与布局",
    "deployment": "发布管理",
    "ai": "AI 功能",
    "user": "用户管理",
    "role": "角色管理",
    "system": "系统管理",
}


# === Permissions ===

@router.get("/permissions", response_model=None)
async def list_permissions_grouped(
    db: Annotated[AsyncSession, Depends(_get_db)],
    _: CurrentUser,
):
    """权限树 (按 resource 分组, 给角色编辑 UI 用)"""
    result = await db.execute(
        select(Permission).order_by(Permission.resource, Permission.code)
    )
    all_perms = result.scalars().all()

    by_resource: dict[str, list[PermissionRead]] = {}
    for p in all_perms:
        by_resource.setdefault(p.resource, []).append(
            PermissionRead.model_validate(p)
        )

    return ok([
        PermissionGroup(
            resource=res,
            label=RESOURCE_LABELS.get(res, res),
            permissions=perms,
        )
        for res, perms in by_resource.items()
    ])


# === Roles ===

@router.get("/roles", response_model=None)
async def list_roles(
    db: Annotated[AsyncSession, Depends(_get_db)],
    _: CurrentUser,
    q: str | None = Query(None, description="按名称/code 模糊搜索"),
):
    """角色列表 (全员可看, 用于下拉选择)"""
    stmt = select(
        Role,
        func.count(func.distinct(RolePermission.permission_id)).label("perm_count"),
        func.count(func.distinct(UserRole.user_id)).label("user_count"),
    ).outerjoin(RolePermission, RolePermission.role_id == Role.id).outerjoin(
        UserRole, UserRole.role_id == Role.id
    ).group_by(Role.id).order_by(Role.is_system.desc(), Role.code)

    if q:
        stmt = stmt.where(Role.name.ilike(f"%{q}%") | Role.code.ilike(f"%{q}%"))

    result = await db.execute(stmt)
    rows = result.all()
    return ok([
        RoleRead(
            id=r.id,
            code=r.code,
            name=r.name,
            description=r.description,
            is_system=r.is_system,
            permission_count=perm_count or 0,
            user_count=user_count or 0,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for (r, perm_count, user_count) in rows
    ])


@router.post("/roles", response_model=None, status_code=201)
async def create_role(
    body: RoleCreate,
    db: Annotated[AsyncSession, Depends(_get_db)],
    admin: Annotated[User, Depends(get_super_admin)],
):
    """创建角色 (super_admin)"""
    # 校验 code 不重复
    existing = await db.execute(select(Role).where(Role.code == body.code))
    if existing.scalar_one_or_none():
        raise BadRequest(f"角色代码 {body.code} 已存在")

    role = Role(
        code=body.code,
        name=body.name,
        description=body.description,
        is_system=False,
    )
    db.add(role)
    await db.flush()

    # 绑定权限
    if body.permission_codes:
        perms = await db.execute(
            select(Permission).where(Permission.code.in_(body.permission_codes))
        )
        perm_objs = perms.scalars().all()
        for p in perm_objs:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))

    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise BadRequest(f"创建失败: {e.orig}")

    return ok(await _build_role_detail(db, role))


@router.get("/roles/{role_id}", response_model=None)
async def get_role(
    role_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(_get_db)],
    _: CurrentUser,
):
    role = await _get_role_or_404(db, role_id)
    return ok(await _build_role_detail(db, role))


@router.patch("/roles/{role_id}", response_model=None)
async def update_role(
    role_id: uuid.UUID,
    body: RoleUpdate,
    db: Annotated[AsyncSession, Depends(_get_db)],
    admin: Annotated[User, Depends(get_super_admin)],
):
    """改名称/描述/权限 (super_admin)
    系统角色可以改名/描述, 但**不能**改 code 和 is_system, 也不能改 permission_codes
    """
    role = await _get_role_or_404(db, role_id)

    if body.name is not None:
        role.name = body.name
    if body.description is not None:
        role.description = body.description

    # 权限更新: 系统角色不允许
    if body.permission_codes is not None and role.is_system:
        raise BadRequest("系统内置角色的权限不可修改, 如需调整请创建自定义角色")

    if body.permission_codes is not None:
        # 删旧
        await db.execute(
            delete(RolePermission).where(RolePermission.role_id == role_id)
        )
        # 加新
        perms = await db.execute(
            select(Permission).where(Permission.code.in_(body.permission_codes))
        )
        for p in perms.scalars().all():
            db.add(RolePermission(role_id=role_id, permission_id=p.id))

    role.updated_at = func.now()
    await db.commit()
    await db.refresh(role)
    return ok(await _build_role_detail(db, role))


@router.delete("/roles/{role_id}", status_code=204)
async def delete_role(
    role_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(_get_db)],
    admin: Annotated[User, Depends(get_super_admin)],
):
    """删角色 (super_admin, 系统角色不可删, 需先转移用户)"""
    role = await _get_role_or_404(db, role_id)
    if role.is_system:
        raise BadRequest("系统内置角色不可删除")

    # 检查是否还有用户绑这个角色
    user_count_q = await db.execute(
        select(func.count()).select_from(UserRole).where(UserRole.role_id == role_id)
    )
    if user_count_q.scalar() > 0:
        raise BadRequest("该角色下还有用户, 请先转移用户到其他角色")

    await db.delete(role)
    await db.commit()
    return ok(None)


@router.post("/roles/{role_id}/clone", response_model=None, status_code=201)
async def clone_role(
    role_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(_get_db)],
    admin: Annotated[User, Depends(get_super_admin)],
):
    """复制角色 (super_admin) - 用于基于内置角色创建自定义角色"""
    src = await _get_role_or_404(db, role_id)
    src_detail = await _build_role_detail(db, src)

    # 生成新 code: 原 code + "_copy_<rand>"
    new_code = f"{src.code}_copy_{uuid.uuid4().hex[:6]}"
    new_role = Role(
        code=new_code,
        name=f"{src.name} (副本)",
        description=src.description,
        is_system=False,
    )
    db.add(new_role)
    await db.flush()

    # 复制权限
    perms = await db.execute(
        select(Permission).where(Permission.code.in_(src_detail.permission_codes))
    )
    for p in perms.scalars().all():
        db.add(RolePermission(role_id=new_role.id, permission_id=p.id))

    await db.commit()
    return ok(await _build_role_detail(db, new_role))


@router.get("/roles/{role_id}/users", response_model=None)
async def list_role_users(
    role_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(_get_db)],
    admin: Annotated[User, Depends(get_super_admin)],
):
    """角色的用户列表 (super_admin)"""
    role = await _get_role_or_404(db, role_id)
    users_q = await db.execute(
        select(User)
        .join(UserRole, UserRole.user_id == User.id)
        .where(UserRole.role_id == role_id)
        .order_by(User.email)
    )
    users = users_q.scalars().all()
    return ok([await _build_user_read(db, u) for u in users])


# === Helpers ===

async def _get_role_or_404(db: AsyncSession, role_id: uuid.UUID) -> Role:
    r = await db.execute(select(Role).where(Role.id == role_id))
    role = r.scalar_one_or_none()
    if not role:
        raise NotFound(f"角色 {role_id} 不存在")
    return role


async def _build_role_detail(db: AsyncSession, role: Role) -> RoleDetail:
    perms = await db.execute(
        select(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .where(RolePermission.role_id == role.id)
    )
    perm_codes = [p[0] for p in perms.all()]

    user_count = await db.execute(
        select(func.count()).select_from(UserRole).where(UserRole.role_id == role.id)
    )

    return RoleDetail(
        id=role.id,
        code=role.code,
        name=role.name,
        description=role.description,
        is_system=role.is_system,
        permission_count=len(perm_codes),
        user_count=user_count.scalar() or 0,
        created_at=role.created_at,
        updated_at=role.updated_at,
        permission_codes=perm_codes,
    )
