"""栏目 (Taxonomy) API (P1.3, P2.7 deprecated)

API (P2.7 起: category 已迁出, 本文件仅剩 tag/series/format):
- GET    /api/v1/sites/{site_id}/taxonomies              列表 (扁平, 可选 ?tree=true)
- POST   /api/v1/sites/{site_id}/taxonomies              创建
- GET    /api/v1/sites/{site_id}/taxonomies/{id}         详情
- PATCH  /api/v1/sites/{site_id}/taxonomies/{id}         更新 (含移动 parent)
- DELETE /api/v1/sites/{site_id}/taxonomies/{id}         软删除 (级联子栏目)

⚠️ P2.7 deprecation:
- 导航结构 (category) 已迁到独立 /api/v1/categories (见 app/api/v1/categories.py)
- 本端点仅供 tag/series/format 使用
- ?type=category 返 400 (CHECK 约束已去)

权限:
- 读: super_admin / site owner / site member
- 写: super_admin / site owner / site editor
- 软删: super_admin / site owner
"""
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.exceptions import BadRequest, Conflict, Forbidden, NotFound
from app.core.responses import ok, page_resp
from app.db.session import get_db
from app.models.membership import SiteMember
from app.models.site import Site
from app.models.taxonomy import Taxonomy
from app.models.user import User
from app.schemas.taxonomy import (
    TaxonomyCreate,
    TaxonomyRead,
    TaxonomyTreeNode,
    TaxonomyUpdate,
)

router = APIRouter(tags=["taxonomies"])


# === 权限 helper ===

async def _get_site_or_404(db: AsyncSession, site_id: uuid.UUID) -> Site:
    result = await db.execute(
        select(Site).where(Site.id == site_id, Site.deleted_at.is_(None))
    )
    site = result.scalar_one_or_none()
    if not site:
        raise NotFound("站点不存在")
    return site


async def _get_user_role(db: AsyncSession, site: Site, user: User) -> str | None:
    """返回 user 在 site 的角色: 'owner' | 'editor' | 'viewer' | None (无访问)"""
    if user.is_super_admin:
        return "owner"  # super_admin 视为最高权限
    if site.owner_id == user.id:
        return "owner"
    result = await db.execute(
        select(SiteMember.name).where(
            SiteMember.site_id == site.id,
            SiteMember.user_id == user.id,
            SiteMember.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


def _can_read(role: str | None) -> bool:
    return role in ("owner", "editor", "viewer")


def _can_write(role: str | None) -> bool:
    return role in ("owner", "editor")


def _can_delete(role: str | None) -> bool:
    return role == "owner"


# === 物化路径维护 ===

def _make_path(parent_path: str | None, self_id: uuid.UUID) -> str:
    """构造物化路径: 根 /<id>/, 子 /<parent_path><id>/"""
    if parent_path:
        return f"{parent_path}{self_id}/"
    return f"/{self_id}/"


async def _update_descendant_paths(
    db: AsyncSession, old_path: str, new_path: str
) -> None:
    """节点移动后, 更新所有后代的 path (前缀替换)"""
    if old_path == new_path:
        return
    result = await db.execute(
        select(Taxonomy).where(
            Taxonomy.path.like(f"{old_path}%"),
            Taxonomy.path != old_path,
            Taxonomy.deleted_at.is_(None),
        )
    )
    for t in result.scalars().all():
        # 把 t.path 的 old_path 前缀替换为 new_path
        t.path = new_path + t.path[len(old_path):]
    await db.flush()


async def _is_descendant(
    db: AsyncSession, ancestor_id: uuid.UUID, candidate_id: uuid.UUID
) -> bool:
    """判断 candidate 是否 ancestor 的后代"""
    anc = await db.get(Taxonomy, ancestor_id)
    if not anc:
        return False
    cand = await db.get(Taxonomy, candidate_id)
    if not cand:
        return False
    return cand.path.startswith(anc.path) and cand.id != anc.id


# === 端点 ===

@router.get("/sites/{site_id}/taxonomies", response_model=None)
async def list_taxonomies(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    type: Literal["tag", "series", "format"] | None = Query(None),
    tree: bool = Query(False, description="是否返回树形结构"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
):
    """列出站点的栏目 (默认扁平)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问该站点")

    # 基础查询
    base = select(Taxonomy).where(
        Taxonomy.site_id == site_id,
        Taxonomy.deleted_at.is_(None),
    )
    if type:
        base = base.where(Taxonomy.type == type)

    # 总数
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # 分页查询
    q = base.order_by(Taxonomy.path, Taxonomy.order_num).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(q)
    items = result.scalars().all()

    if not tree:
        return page_resp([_to_read_dict(t) for t in items], total=total, page=page, page_size=page_size)

    # 构造树
    nodes = {
        t.id: {
            **_to_read_dict(t),
            "depth": t.depth,
            "children": [],
        }
        for t in items
    }
    roots: list[dict] = []
    for t in items:
        node = nodes[t.id]
        if t.parent_id and t.parent_id in nodes:
            nodes[t.parent_id]["children"].append(node)
        else:
            roots.append(node)
    return page_resp(roots, total=total, page=page, page_size=page_size)


@router.post("/sites/{site_id}/taxonomies", response_model=None, status_code=201)
async def create_taxonomy(
    site_id: uuid.UUID,
    body: TaxonomyCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """创建栏目"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权创建栏目")

    # 校验 parent_id
    if body.parent_id:
        parent = await db.get(Taxonomy, body.parent_id)
        if not parent or parent.site_id != site_id or parent.deleted_at:
            raise BadRequest("父栏目不存在或不属于该站点")
        if parent.type != body.type:
            raise BadRequest("父栏目 type 不匹配")

    t = Taxonomy(
        site_id=site_id,
        parent_id=body.parent_id,
        name=body.name,
        slug=body.slug,
        type=body.type,
        path="",  # 插入后填
        description=body.description,
        order_num=0,
    )
    db.add(t)
    try:
        await db.flush()  # 拿 id (可能 UniqueViolationError)
        t.path = _make_path(
            (await db.get(Taxonomy, body.parent_id)).path if body.parent_id else None,
            t.id,
        )
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        if "uq_taxonomies_site_slug_type" in str(e.orig):
            raise Conflict(f"slug '{body.slug}' 在该站点 type='{body.type}' 下已存在", code=40901) from e
        raise
    await db.refresh(t)
    return ok(_to_read_dict(t), message="栏目已创建")


@router.get("/sites/{site_id}/taxonomies/{tax_id}", response_model=None)
async def get_taxonomy(
    site_id: uuid.UUID,
    tax_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """栏目详情"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问")

    t = await db.get(Taxonomy, tax_id)
    if not t or t.site_id != site_id or t.deleted_at:
        raise NotFound("栏目不存在")

    # 子栏目数
    children_count = (await db.execute(
        select(Taxonomy.id).where(
            Taxonomy.parent_id == tax_id,
            Taxonomy.deleted_at.is_(None),
        )
    )).scalars().all()

    data = _to_read_dict(t)
    data["children_count"] = len(children_count)
    return ok(data)


@router.patch("/sites/{site_id}/taxonomies/{tax_id}", response_model=None)
async def update_taxonomy(
    site_id: uuid.UUID,
    tax_id: uuid.UUID,
    body: TaxonomyUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """更新栏目 (含移动 parent)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权修改")

    t = await db.get(Taxonomy, tax_id)
    if not t or t.site_id != site_id or t.deleted_at:
        raise NotFound("栏目不存在")

    # 移动 parent?
    if "parent_id" in body.model_fields_set:
        new_parent_id = body.parent_id
        if new_parent_id == t.id:
            raise BadRequest("不能将自己设为父栏目")
        if new_parent_id:
            # 不能移到自己的后代下
            if await _is_descendant(db, t.id, new_parent_id):
                raise BadRequest("不能将栏目移动到自己的后代下")
            new_parent = await db.get(Taxonomy, new_parent_id)
            if not new_parent or new_parent.site_id != site_id or new_parent.deleted_at:
                raise BadRequest("父栏目不存在")
            if new_parent.type != t.type:
                raise BadRequest("父栏目 type 不匹配")

        old_path = t.path
        if new_parent_id:
            t.parent_id = new_parent_id
            t.path = _make_path((await db.get(Taxonomy, new_parent_id)).path, t.id)
        else:
            t.parent_id = None
            t.path = _make_path(None, t.id)
        await _update_descendant_paths(db, old_path, t.path)

    if body.name is not None:
        t.name = body.name
    if body.slug is not None:
        t.slug = body.slug
    if body.description is not None:
        t.description = body.description
    if body.order_num is not None:
        t.order_num = body.order_num
    if body.seo is not None:
        t.seo = body.seo

    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        if "uq_taxonomies_site_slug_type" in str(e.orig):
            raise Conflict(f"slug '{body.slug}' 已被占用", code=40901)
        raise
    await db.refresh(t)
    return ok(_to_read_dict(t), message="已更新")


@router.delete("/sites/{site_id}/taxonomies/{tax_id}", response_model=None)
async def delete_taxonomy(
    site_id: uuid.UUID,
    tax_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """软删除栏目 (级联所有子栏目)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_delete(role):
        raise Forbidden("仅 owner 可删除栏目")

    t = await db.get(Taxonomy, tax_id)
    if not t or t.site_id != site_id or t.deleted_at:
        raise NotFound("栏目不存在")

    # 级联软删所有后代
    descendants = (await db.execute(
        select(Taxonomy).where(
            Taxonomy.path.like(f"{t.path}%"),
            Taxonomy.deleted_at.is_(None),
        )
    )).scalars().all()

    now = datetime.now(timezone.utc)
    for d in descendants:
        d.deleted_at = now
    await db.commit()
    return ok(message=f"已删除栏目及 {len(descendants) - 1} 个子栏目")


# === 工具 ===

def _to_read_dict(t: Taxonomy) -> dict:
    return {
        "id": str(t.id),
        "site_id": str(t.site_id),
        "parent_id": str(t.parent_id) if t.parent_id else None,
        "name": t.name,
        "slug": t.slug,
        "type": t.type,
        "path": t.path,
        "description": t.description,
        "order_num": t.order_num,
        "seo": t.seo or {},
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }
