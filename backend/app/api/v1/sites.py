"""站点管理 API (P1.1)

依据:
- docs/04b-数据模型.md §3.1, §3.2
- docs/10-权限矩阵.md §2.1 (super_admin 全部, owner 站内, editor/viewer 只读)
- docs/02-API-规范.md (分页 + 过滤 + 响应格式)

权限策略 (MVP):
- list/get: super_admin 看全部, 其他看自己成员站
- create: super_admin only (P1.2 之后 owner 也能)
- update/delete: super_admin 或 owner
"""
import os
import uuid
import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, SuperAdmin
from app.core.exceptions import BadRequest, Conflict, Forbidden, NotFound
from app.core.responses import ok, page_resp
from app.db.session import get_db
from app.models.site import Site, SiteDomain
from app.models.user import User
from app.schemas.site import (
    SiteCreate,
    SiteDomainCreate,
    SiteDomainRead,
    SiteDomainUpdate,
    SiteListItem,
    SiteRead,
    SiteUpdate,
)
from app.schemas.block import (
    SiteBlockUpdate,
    SiteCtaConfig,
    SiteHeroConfig,
    SiteProductsConfig,
    SiteStatsConfig,
)

router = APIRouter(prefix="/sites", tags=["sites"])
logger = logging.getLogger(__name__)


# === 辅助: 列出 user 可访问的站点 ===

async def _get_accessible_site_ids(db: AsyncSession, user: User) -> list[uuid.UUID] | None:
    """返回 user 可访问的 site_id 列表; None = 全部 (super_admin)
    
    包装 deps.get_accessible_site_ids 避免 API 层独立处理
    """
    from app.core.deps import get_accessible_site_ids
    return await get_accessible_site_ids(db, user)


async def _get_site_or_404(
    db: AsyncSession, site_id: uuid.UUID, user: User, *, with_deleted: bool = False
) -> Site:
    """取站点 (仅 404 判断, 不含权限)"""
    q = select(Site).where(Site.id == site_id)
    if not with_deleted:
        q = q.where(Site.deleted_at.is_(None))
    result = await db.execute(q)
    site = result.scalar_one_or_none()
    if not site:
        raise NotFound("站点不存在")
    return site


def _require_owner_or_admin(site: Site, user: User) -> None:
    """权限检查: super_admin 或 owner; 不通过抛 Forbidden"""
    if not user.is_super_admin and site.owner_id != user.id:
        raise Forbidden("需要 owner 权限")


async def _async_require_read_access(db: AsyncSession, site: Site, user: User) -> None:
    """读权限: super_admin / site owner / site member"""
    if user.is_super_admin or site.owner_id == user.id:
        return
    from app.models.membership import SiteMember
    result = await db.execute(
        select(SiteMember.id).where(
            SiteMember.site_id == site.id,
            SiteMember.user_id == user.id,
            SiteMember.deleted_at.is_(None),
        )
    )
    if result.scalar_one_or_none() is None:
        raise Forbidden("无权访问该站点")


# === 列表 ===

async def _aggregate_site_counts(db: AsyncSession, site_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[str, int]]:
    """一次拿所有站点的聚合统计 (contents / categories / layouts / media / deployments)
    避免 N+1. 返 {site_id: {'contents': N, 'categories': M, ...}}.
    """
    if not site_ids:
        return {}
    from app.models.content import Content
    from app.models.category import Category
    from app.models.layout import Layout
    from app.models.media import Media
    from app.models.deployment import Deployment
    from app.models.site_asset import SiteAsset
    from sqlalchemy import func, select

    out: dict[uuid.UUID, dict[str, int]] = {sid: {} for sid in site_ids}

    # 6 个查询, 各 GROUP BY site_id
    queries = [
        ("contents",     Content,     "site_id", "deleted_at"),
        ("categories",   Category,    "site_id", "deleted_at"),
        ("layouts",      Layout,      "site_id", "deleted_at"),
        ("media",        Media,       "site_id", "deleted_at"),
        # deployments 没 deleted_at, 硬删
        ("deployments",  Deployment,  "site_id", None),
        # P3.6.4: 站点资源 (site_assets 无软删, 硬删)
        ("assets",       SiteAsset,   "site_id", None),
    ]
    for key, model, fk, soft_field in queries:
        q = select(getattr(model, fk), func.count(model.id))
        if soft_field is not None:
            q = q.where(getattr(model, soft_field).is_(None))
        q = q.where(getattr(model, fk).in_(site_ids)).group_by(getattr(model, fk))
        rows = (await db.execute(q)).all()
        for sid, n in rows:
            out.setdefault(sid, {})[key] = int(n)
    return out


@router.get("", response_model=None)
async def list_sites(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    q: str | None = Query(default=None, description="搜索 name/slug"),
    status: str | None = Query(default=None, pattern="^(active|archived)$"),
):
    """站点列表 (分页 + 搜索 + 状态过滤)"""
    base = select(Site).where(Site.deleted_at.is_(None))

    # 多租户隔离
    accessible = await _get_accessible_site_ids(db, current_user)
    if accessible is not None:
        if not accessible:
            return page_resp([], total=0, page=page, page_size=page_size)
        base = base.where(Site.id.in_(accessible))

    # 状态过滤
    if status:
        base = base.where(Site.status == status)

    # 搜索
    if q:
        pattern = f"%{q}%"
        base = base.where(or_(Site.name.ilike(pattern), Site.slug.ilike(pattern)))

    # 总数
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # 分页
    items_q = (
        base.options(selectinload(Site.domains.and_(SiteDomain.deleted_at.is_(None))))
        .order_by(Site.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(items_q)
    sites = result.scalars().all()

    # P5: 把 domain_count 算出来 (用已 selectinload 的关系, 避免 N+1)
    site_ids = [s.id for s in sites]
    counts = await _aggregate_site_counts(db, site_ids)
    items_out = []
    for s in sites:
        d = SiteListItem.model_validate(s).model_dump(mode="json")
        d["domain_count"] = len([x for x in (s.domains or []) if x.deleted_at is None])
        c = counts.get(s.id, {})
        d["content_count"] = c.get("contents", 0)
        d["category_count"] = c.get("categories", 0)
        d["layout_count"] = c.get("layouts", 0)
        d["media_count"] = c.get("media", 0)
        d["deployment_count"] = c.get("deployments", 0)
        d["asset_count"] = c.get("assets", 0)
        items_out.append(d)

    return page_resp(items_out, total=total, page=page, page_size=page_size)


# === 详情 ===

@router.get("/{site_id}", response_model=None)
async def get_site(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """站点详情 (含域名列表)"""
    site = await _get_site_or_404(db, site_id, current_user)
    await _async_require_read_access(db, site, current_user)
    # P5: 预加载 domains (含未删除), 避免 Pydantic 序列化时 lazy IO
    site_q = (
        select(Site)
        .where(Site.id == site_id)
        .options(selectinload(Site.domains.and_(SiteDomain.deleted_at.is_(None))))
    )
    site = (await db.execute(site_q)).scalar_one()
    data = SiteRead.model_validate(site).model_dump(mode="json")

    # 关联域名
    domains_q = select(SiteDomain).where(
        SiteDomain.site_id == site_id,
        SiteDomain.deleted_at.is_(None),
    )
    domains = (await db.execute(domains_q)).scalars().all()
    data["domains"] = [SiteDomainRead.model_validate(d).model_dump(mode="json") for d in domains]

    return ok(data)


# === 创建 (super_admin only, MVP) ===

@router.post("", response_model=None, status_code=201)
async def create_site(
    body: SiteCreate,
    current_user: CurrentUser,  # P3.9.6 (holy 反馈 #12044-续): super_admin + owner 都能创建
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """创建站点 (super_admin 或 owner; owner_id = 当前用户)"""
    # slug 唯一性 (DB 也强制)
    exists = await db.execute(select(Site).where(Site.slug == body.slug, Site.deleted_at.is_(None)))
    if exists.scalar_one_or_none():
        raise Conflict(f"slug '{body.slug}' 已被占用", code=40901)

    site = Site(
        slug=body.slug,
        name=body.name,
        description=body.description,
        logo_url=body.logo_url,
        owner_id=current_user.id,  # 不再硬取 admin.id, 普通用户建站 owner 就是自己
        status="active",
        settings=body.settings,
    )
    db.add(site)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        # 提取约束名
        msg = str(e.orig) if e.orig else str(e)
        if "uq_sites_slug" in msg or "slug" in msg:
            raise Conflict(f"slug '{body.slug}' 已被占用", code=40901) from e
        raise Conflict("创建失败, 数据冲突", code=40900) from e
    await db.refresh(site)
    # P5: 预加载 domains, 避免 Pydantic 序列化时 lazy IO
    site_q = (
        select(Site)
        .where(Site.id == site.id)
        .options(selectinload(Site.domains.and_(SiteDomain.deleted_at.is_(None))))
    )
    site = (await db.execute(site_q)).scalar_one()
    return ok(SiteRead.model_validate(site).model_dump(mode="json"), message="创建成功")


# === 更新 ===

@router.patch("/{site_id}", response_model=None)
async def update_site(
    site_id: uuid.UUID,
    body: SiteUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """更新站点 (super_admin 或 owner)"""
    site = await _get_site_or_404(db, site_id, current_user)
    _require_owner_or_admin(site, current_user)

    data = body.model_dump(exclude_unset=True)

    # P5: 改 slug 时校验唯一性 (DB 也强制, 提前抛友好错)
    slug_changed = "slug" in data and data["slug"] and data["slug"] != site.slug
    if slug_changed:
        old_slug = site.slug
        new_slug = data["slug"]
        exists = await db.execute(
            select(Site).where(
                Site.slug == new_slug,
                Site.id != site_id,
                Site.deleted_at.is_(None),
            )
        )
        if exists.scalar_one_or_none():
            raise Conflict(f"slug '{new_slug}' 已被占用", code=40901)
    else:
        old_slug = site.slug

    for k, v in data.items():
        setattr(site, k, v)

    # F3 决策: status=archived 时写 nginx flag 文件, nginx 返回 410
    # status=active 时删 flag
    if "status" in data:
        from app.core.config import get_settings
        s = get_settings()
        flag_dir = f"{s.SITES_DATA_DIR}/_archived"
        os.makedirs(flag_dir, exist_ok=True)
        flag_file = os.path.join(flag_dir, site.slug)
        if data["status"] == "archived":
            with open(flag_file, "w") as f:
                f.write(f"archived at {datetime.now(timezone.utc).isoformat()}\n")
        elif data["status"] == "active" and os.path.exists(flag_file):
            os.remove(flag_file)

    await db.commit()

    # P5: 改 slug 时重建 nginx sites.map (避免新域名仍路由到旧 slug)
    if slug_changed:
        try:
            from app.core.nginx import rebuild_sites_map
            await rebuild_sites_map(db)
            logger.info(f"slug changed {old_slug} -> {site.slug}, sites.map rebuilt")
        except Exception as e:
            logger.warning(f"rebuild sites.map failed after slug change: {e}")

    # P5: 重新查, 预加载 domains, 避免 Pydantic 序列化时 lazy IO
    site_q = (
        select(Site)
        .where(Site.id == site_id)
        .options(selectinload(Site.domains.and_(SiteDomain.deleted_at.is_(None))))
    )
    site = (await db.execute(site_q)).scalar_one()
    return ok(SiteRead.model_validate(site).model_dump(mode="json"), message="更新成功")


# ===========================================================================
# P3.6.5+: 首页块配置 (hero / stats / products / cta)
# 存在 site.settings JSON, 模板用 <HY_SITE_HERO /> 等标签读
# 改后需 publish 才在静态产物里生效
# ===========================================================================

# 各块 schema 映射 (二次验证 content dict)
_BLOCK_SCHEMAS = {
    "hero": SiteHeroConfig,
    "stats": SiteStatsConfig,
    "products": SiteProductsConfig,
    "cta": SiteCtaConfig,
}


@router.get("/{site_id}/blocks", response_model=None)
async def list_site_blocks(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """拿一个站所有 4 个块的当前配置 (P3.6.5+)

    返回: { "hero": {...} | null, "stats": {...} | null, ... }
    settings 里没存过的块返 null
    """
    site = await _get_site_or_404(db, site_id, current_user)
    settings = site.settings or {}
    out = {name: settings.get(name) for name in _BLOCK_SCHEMAS}
    return ok(out)


@router.put("/{site_id}/blocks/{name}", response_model=None)
async def update_site_block(
    site_id: uuid.UUID,
    name: str,
    body: SiteBlockUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """改一个块配置 (P3.6.5+)

    name: hero / stats / products / cta
    body.content: 块 dict, 按 name schema 验证
    写 site.settings[name] = body.content (整体覆盖)
    改后需 publish 才在静态产物里生效
    """
    if name not in _BLOCK_SCHEMAS:
        raise BadRequest(
            f"未知块名 {name!r}, 可选: {', '.join(_BLOCK_SCHEMAS)}",
            code=40001,
        )
    site = await _get_site_or_404(db, site_id, current_user)
    _require_owner_or_admin(site, current_user)

    # 验证
    schema_cls = _BLOCK_SCHEMAS[name]
    try:
        validated = schema_cls.model_validate(body.content)
    except Exception as e:
        raise BadRequest(f"块 {name} 验证失败: {e}", code=40002)

    # 写 settings
    settings = dict(site.settings or {})
    settings[name] = validated.model_dump()
    site.settings = settings
    await db.commit()

    return ok(validated.model_dump(), message=f"块 {name} 保存成功")


# === P3.7 模板目录标签 (可自定义) ===

# 默认 5 个 scope 标签 (与 backend LAYOUT_SCOPES 同步: site/home/category/content/partial)
DEFAULT_TEMPLATE_SCOPE_LABELS: dict[str, str] = {
    "site": "站点布局",
    "home": "首页布局",
    "category": "栏目布局",
    "content": "详情布局",
    "partial": "子模板",
}


@router.get("/{site_id}/template-scope-labels", response_model=None)
async def get_template_scope_labels(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """获取站点自定义的模板目录名称

    5 个固定 scope, 用户可改显示名 (存 site.settings["template_scope_labels"])
    未改过的 scope 走 DEFAULT_TEMPLATE_SCOPE_LABELS
    """
    site = await _get_site_or_404(db, site_id, current_user)
    stored = (site.settings or {}).get("template_scope_labels", {}) or {}
    # 合并: 已存优先, 未存用默认
    merged = {**DEFAULT_TEMPLATE_SCOPE_LABELS, **stored}
    return ok(merged, message="ok")


@router.put("/{site_id}/template-scope-labels", response_model=None)
async def update_template_scope_labels(
    site_id: uuid.UUID,
    body: dict,  # {site: "整站壳", home: "着陆页", ...}
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """修改模板目录名称 (owner 或 super_admin)

    body 是 {scope_key: display_name} 的部分 dict, 只传要改的
    校验: scope_key 必须在 LAYOUT_SCOPES 内, display_name 非空 1-32 字
    """
    from app.models.layout import LAYOUT_SCOPES

    site = await _get_site_or_404(db, site_id, current_user)
    _require_owner_or_admin(site, current_user)

    if not isinstance(body, dict):
        raise BadRequest("body 必须是 {scope: name} 对象", code=40001)

    # 校验: key 必须是 5 个 scope 之一, value 非空
    cleaned: dict[str, str] = {}
    for k, v in body.items():
        if k not in LAYOUT_SCOPES:
            raise BadRequest(f"未知 scope: {k!r}, 必须是 {list(LAYOUT_SCOPES)} 之一", code=40002)
        if not isinstance(v, str) or not v.strip():
            raise BadRequest(f"{k} 名称不能为空", code=40003)
        cleaned[k] = v.strip()[:32]

    # 合并到 settings
    settings = dict(site.settings or {})
    existing = dict(settings.get("template_scope_labels", {}) or {})
    existing.update(cleaned)
    settings["template_scope_labels"] = existing
    site.settings = settings
    await db.commit()
    await db.refresh(site)

    # 返合并后的视图 (默认 + 覆盖)
    merged = {**DEFAULT_TEMPLATE_SCOPE_LABELS, **existing}
    return ok(merged, message="模板目录名称已保存")


# === 删除 (软删除) ===

@router.delete("/{site_id}", response_model=None)
async def delete_site(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """删除站点 (软删除, 30 天回收站)"""
    site = await _get_site_or_404(db, site_id, current_user)
    _require_owner_or_admin(site, current_user)

    from datetime import datetime, timezone
    site.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return ok(message="已删除 (30 天内可在回收站恢复)")


# === 回收站 ===

@router.get("/recycle-bin/list", response_model=None)
async def list_recycle_bin(
    admin: SuperAdmin,
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    q: str | None = Query(default=None),
):
    """回收站列表 (super_admin only)"""
    base = select(Site).where(Site.deleted_at.is_not(None))
    if q:
        pattern = f"%{q}%"
        base = base.where(or_(Site.name.ilike(pattern), Site.slug.ilike(pattern)))
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0
    items_q = base.order_by(Site.deleted_at.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(items_q)
    sites = result.scalars().all()
    return page_resp(
        [SiteListItem.model_validate(s).model_dump(mode="json") for s in sites],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/{site_id}/restore", response_model=None)
async def restore_site(
    site_id: uuid.UUID,
    admin: SuperAdmin,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """从回收站恢复 (super_admin only)"""
    result = await db.execute(
        select(Site).where(Site.id == site_id, Site.deleted_at.is_not(None))
    )
    site = result.scalar_one_or_none()
    if not site:
        raise NotFound("回收站中无此站点")
    site.deleted_at = None
    await db.commit()
    await db.refresh(site)
    return ok(SiteRead.model_validate(site).model_dump(mode="json"), message="已恢复")


@router.delete("/{site_id}/permanent", response_model=None)
async def permanent_delete_site(
    site_id: uuid.UUID,
    admin: SuperAdmin,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """永久删除 (super_admin only)"""
    result = await db.execute(
        select(Site).where(Site.id == site_id, Site.deleted_at.is_not(None))
    )
    site = result.scalar_one_or_none()
    if not site:
        raise NotFound("回收站中无此站点")
    # CASCADE 会清掉 site_domains / site_members
    await db.delete(site)
    await db.commit()
    return ok(message="已永久删除")


# === 域名子资源 ===

@router.post("/{site_id}/domains", response_model=None, status_code=201)
async def add_domain(
    site_id: uuid.UUID,
    body: SiteDomainCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """添加域名"""
    site = await _get_site_or_404(db, site_id, current_user)
    _require_owner_or_admin(site, current_user)

    # 唯一性
    exists = await db.execute(
        select(SiteDomain).where(
            SiteDomain.domain == body.domain, SiteDomain.deleted_at.is_(None)
        )
    )
    if exists.scalar_one_or_none():
        raise Conflict(f"域名 '{body.domain}' 已被占用", code=40901)

    domain = SiteDomain(
        site_id=site_id,
        domain=body.domain,
        type=body.type,
    )
    db.add(domain)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        msg = str(e.orig) if e.orig else str(e)
        if "uq_site_domains_domain" in msg or "domain" in msg:
            raise Conflict(f"域名 '{body.domain}' 已被占用", code=40901) from e
        raise Conflict("域名冲突", code=40900) from e
    await db.refresh(domain)
    # B5: 重写 nginx sites.map (inotify 会自动 reload)
    from app.core.nginx import rebuild_sites_map
    try:
        await rebuild_sites_map(db)
    except Exception as e:
        logger.warning(f"rebuild_sites_map failed after add_domain: {e}")
    return ok(SiteDomainRead.model_validate(domain).model_dump(mode="json"), message="添加成功")


@router.patch("/{site_id}/domains/{domain_id}", response_model=None)
async def update_domain(
    site_id: uuid.UUID,
    domain_id: uuid.UUID,
    body: SiteDomainUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """修改域名 (类型 / 重名校验)"""
    site = await _get_site_or_404(db, site_id, current_user)
    _require_owner_or_admin(site, current_user)

    result = await db.execute(
        select(SiteDomain).where(
            SiteDomain.id == domain_id,
            SiteDomain.site_id == site_id,
            SiteDomain.deleted_at.is_(None),
        )
    )
    domain = result.scalar_one_or_none()
    if not domain:
        raise NotFound("域名不存在")

    # 只允许改 type (域名字符串本身是唯一主键, 改名 = 删旧+加新, 走 "替换" 流程)
    updates = body.model_dump(exclude_unset=True)
    if "type" in updates:
        domain.type = updates["type"]
    if "domain" in updates and updates["domain"] and updates["domain"] != domain.domain:
        # 重命名: 拆为删+加 (需要分两步 tx 避免 uq_site_domains_domain 跟软删旧值冲突)
        new_domain_str = updates["domain"]
        # 唯一性检查
        exists = await db.execute(
            select(SiteDomain).where(
                SiteDomain.domain == new_domain_str,
                SiteDomain.deleted_at.is_(None),
                SiteDomain.id != domain.id,
            )
        )
        if exists.scalar_one_or_none():
            raise Conflict(f"域名 '{new_domain_str}' 已被占用", code=40901)
        # tx 1: 软删旧的 (commit, 让 uq 释放)
        from datetime import datetime as _dt, timezone as _tz
        old_type = domain.type
        domain.deleted_at = _dt.now(_tz.utc)
        try:
            await db.commit()
        except IntegrityError as e:
            await db.rollback()
            raise Conflict("域名冲突", code=40900) from e
        # tx 2: 加新的
        new_d = SiteDomain(
            site_id=site_id,
            domain=new_domain_str,
            type=old_type,
        )
        db.add(new_d)
        try:
            await db.commit()
        except IntegrityError as e:
            await db.rollback()
            raise Conflict(f"域名 '{new_domain_str}' 已被占用", code=40901) from e
        await db.refresh(new_d)
        from app.core.nginx import rebuild_sites_map
        try:
            await rebuild_sites_map(db)
        except Exception as e:
            logger.warning(f"rebuild_sites_map failed after rename_domain: {e}")
        return ok(SiteDomainRead.model_validate(new_d).model_dump(mode="json"), message="已重命名")

    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        msg = str(e.orig) if e.orig else str(e)
        if "uq_site_domains_domain" in msg or "domain" in msg:
            raise Conflict("域名冲突", code=40900) from e
        raise
    await db.refresh(domain)
    from app.core.nginx import rebuild_sites_map
    try:
        await rebuild_sites_map(db)
    except Exception as e:
        logger.warning(f"rebuild_sites_map failed after update_domain: {e}")
    return ok(SiteDomainRead.model_validate(domain).model_dump(mode="json"), message="已更新")


@router.delete("/{site_id}/domains/{domain_id}", response_model=None)
async def remove_domain(
    site_id: uuid.UUID,
    domain_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """删除域名 (软删除)"""
    site = await _get_site_or_404(db, site_id, current_user)
    _require_owner_or_admin(site, current_user)

    result = await db.execute(
        select(SiteDomain).where(
            SiteDomain.id == domain_id,
            SiteDomain.site_id == site_id,
            SiteDomain.deleted_at.is_(None),
        )
    )
    domain = result.scalar_one_or_none()
    if not domain:
        raise NotFound("域名不存在")

    from datetime import datetime, timezone
    domain.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    # B5: 重写 nginx sites.map
    from app.core.nginx import rebuild_sites_map
    try:
        await rebuild_sites_map(db)
    except Exception as e:
        logger.warning(f"rebuild_sites_map failed after remove_domain: {e}")
    return ok(message="已删除")


# === P6.2 #16: 站点批量操作 ===

from typing import Literal
from pydantic import BaseModel, Field

class BatchSiteRequest(BaseModel):
    action: Literal["delete", "restore"]
    site_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=50)


@router.post("/batch", response_model=None)
async def batch_site_action(
    payload: BatchSiteRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """批量动作: delete (软删) / restore (从回收站恢复)

    权限: super_admin 或 per-site owner
    """
    rows = (await db.execute(
        select(Site).where(Site.id.in_(payload.site_ids))
    )).scalars().all()
    by_id = {s.id: s for s in rows}
    now = datetime.now(timezone.utc)

    results: list[dict] = []
    succeeded = 0
    failed = 0

    for sid in payload.site_ids:
        s = by_id.get(sid)
        if not s:
            results.append({"site_id": str(sid), "success": False, "error": "不存在"})
            failed += 1
            continue
        # 权限: super_admin 全部, 否则要 owner
        if not current_user.is_super_admin and s.owner_id != current_user.id:
            results.append({"site_id": str(sid), "success": False, "error": "无权限"})
            failed += 1
            continue
        try:
            if payload.action == "delete":
                if s.deleted_at:
                    results.append({"site_id": str(sid), "success": False, "error": "已在回收站"})
                    failed += 1
                    continue
                s.deleted_at = now
                results.append({"site_id": str(sid), "success": True})
                succeeded += 1
            elif payload.action == "restore":
                if not s.deleted_at:
                    results.append({"site_id": str(sid), "success": False, "error": "未被删除"})
                    failed += 1
                    continue
                s.deleted_at = None
                results.append({"site_id": str(sid), "success": True})
                succeeded += 1
        except Exception as e:
            results.append({"site_id": str(sid), "success": False, "error": str(e)})
            failed += 1

    await db.commit()

    action_label = {"delete": "删除", "restore": "恢复"}[payload.action]
    msg = f"批量{action_label}站点: 成功 {succeeded}, 失败 {failed}"
    return ok({"results": results, "total": len(payload.site_ids), "succeeded": succeeded, "failed": failed}, message=msg)
