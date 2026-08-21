"""内容 (Content) API (P1.4)

API:
- GET    /api/v1/sites/{site_id}/contents              列表 (filter by status)
- POST   /api/v1/sites/{site_id}/contents              创建 (含初始版本)
- GET    /api/v1/sites/{site_id}/contents/{id}         详情 (含 body)
- PATCH  /api/v1/sites/{site_id}/contents/{id}         更新 (创建新版本)
- DELETE /api/v1/sites/{site_id}/contents/{id}         软删除
- POST   /api/v1/sites/{site_id}/contents/batch        批量动作 (P6.2 #16)
- GET    /api/v1/sites/{site_id}/contents/{id}/versions  版本列表
- POST   /api/v1/sites/{site_id}/contents/{id}/lock    协作锁

权限:
- 读: super_admin / site owner / site member
- 写: super_admin / site owner / site editor
- 删: super_admin / site owner
"""
import uuid
import re
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.exceptions import BadRequest, Conflict, Forbidden, NotFound
from app.core.responses import ok, page_resp
from app.db.session import get_db
from app.models.content import Content, ContentTaxonomy, ContentVersion
from app.models.category import Category
from app.models.membership import SiteMember
from app.models.site import Site
from app.models.taxonomy import Taxonomy
from app.models.user import User
from app.schemas.content import (
    ContentCreate, ContentListItem, ContentPreviewRequest, ContentRead, ContentUpdate,
    ContentVersionRead,
)

router = APIRouter(tags=["contents"])

# 协作锁过期时间
LOCK_TTL_MINUTES = 5
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


# === 权限 helper ===

async def _get_site_or_404(db: AsyncSession, site_id: uuid.UUID) -> Site:
    r = await db.execute(
        select(Site).where(Site.id == site_id, Site.deleted_at.is_(None))
    )
    site = r.scalar_one_or_none()
    if not site:
        raise NotFound("站点不存在")
    return site


async def _get_user_role(db: AsyncSession, site: Site, user: User) -> str | None:
    if user.is_super_admin:
        return "owner"
    if site.owner_id == user.id:
        return "owner"
    r = await db.execute(
        select(SiteMember.name).where(
            SiteMember.site_id == site.id,
            SiteMember.user_id == user.id,
            SiteMember.deleted_at.is_(None),
        )
    )
    return r.scalar_one_or_none()


def _can_read(role: str | None) -> bool:
    return role in ("owner", "editor", "viewer")


def _can_write(role: str | None) -> bool:
    return role in ("owner", "editor")


def _slugify_ascii(raw: str, fallback: str = "cat") -> str:
    """生成发布可用的 ASCII slug：英文保留，中文转全拼。"""
    from pypinyin import Style, lazy_pinyin

    pinyin = "".join(lazy_pinyin((raw or "").lower(), style=Style.NORMAL))
    s = re.sub(r"[^a-z0-9-]+", "-", pinyin)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:64] or fallback


async def _ensure_valid_category_slug(
    db: AsyncSession,
    site_id: uuid.UUID,
    cat: Category,
) -> str:
    """旧 Excel 导入栏目可能带中文 slug；首次发文章时自动修正为可发布 slug。"""
    if cat.slug and SLUG_RE.match(cat.slug):
        return cat.slug

    base = _slugify_ascii(cat.slug or cat.name, fallback=f"cat-{str(cat.id)[:8]}")
    if base == "cat":
        base = f"cat-{str(cat.id)[:8]}"

    existing_q = await db.execute(
        select(Category.slug).where(
            Category.site_id == site_id,
            Category.deleted_at.is_(None),
            Category.id != cat.id,
        )
    )
    existing_slugs = {s for s in existing_q.scalars().all() if s}

    slug = base
    n = 2
    while slug in existing_slugs:
        slug = f"{base}-{n}"[:64]
        n += 1

    cat.slug = slug
    db.add(cat)
    return slug


def _can_delete(role: str | None) -> bool:
    return role == "owner"


# === P3.9.1+ (holy 反馈 #11279 续): 复制内容到另一栏目 (多选副本) ===
async def _duplicate_content_to_category(
    db: AsyncSession,
    source: Content,
    target_category_id: uuid.UUID,
    site_id: uuid.UUID,
    author: "User",
) -> Content:
    """从主稿 source 复制一份新 content 到 target_category_id 栏目。
    副本独立 row, 独立 status/published_at/view_count=0/slug 唯一后缀, 独立版本快照。
    """
    # 1) 拿主稿最新 body
    last_v = (await db.execute(
        select(ContentVersion)
        .where(ContentVersion.content_id == source.id)
        .order_by(ContentVersion.version_num.desc())
        .limit(1)
    )).scalar_one_or_none()
    body = last_v.body if last_v else ""

    # 2) 生成唯一 slug (主稿 slug 后面加 -copy-{nanoid 6})
    import secrets
    suffix = secrets.token_hex(3)  # 6 chars
    new_slug = f"{source.slug}-copy-{suffix}"

    # 3) 创建副本 content
    new_c = Content(
        site_id=site_id,
        author_id=author.id,
        title=source.title,
        subtitle=source.subtitle,
        slug=new_slug,
        excerpt=source.excerpt,
        cover_image=source.cover_image,
        banner_image=getattr(source, "banner_image", None),
        is_featured=bool(getattr(source, "is_featured", False)),
        status=source.status,  # 独立发布: 复制时跟主稿状态, 之后可独立改
        category_id=target_category_id,
        is_copy_of=source.id,  # 指向主稿
        view_count=0,
        # published_at 不复制 (独立发布: 副本需手动发布)
    )
    db.add(new_c)
    await db.flush()  # 拿 new_c.id

    # 4) 创建 v1 版本快照 (深 copy body)
    db.add(ContentVersion(
        content_id=new_c.id, version_num=1,
        title=source.title, body=body, excerpt=source.excerpt,
        author_id=author.id, is_auto_save=False,
    ))

    # 5) 栏目 content_count +1
    await db.execute(
        update(Category)
        .where(Category.id == target_category_id)
        .values(content_count=Category.content_count + 1)
    )

    return new_c


# === 端点 ===

@router.get("/sites/{site_id}/contents", response_model=None)
async def list_contents(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    status: Optional[Literal["draft", "pending", "published", "scheduled", "archived"]] = None,
    taxonomy_id: Optional[uuid.UUID] = None,
    category_id: Optional[uuid.UUID] = None,
    q: Optional[str] = Query(None, description="标题/正文搜索"),
    no_cover: bool = Query(False, description="仅无封面"),
    no_tags: bool = Query(False, description="仅无标签"),
    stale_days: Optional[int] = Query(None, ge=1, le=365, description="超过 N 天未更新"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """内容列表 (分页)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问该站点")

    # 基础查询
    base = select(Content).where(
        Content.site_id == site_id,
        Content.deleted_at.is_(None),
    )
    if status:
        base = base.where(Content.status == status)
    if taxonomy_id:
        # 旧 API: 多对多栏目, P2.7 起只匹配 tag/series/format (category 已迁出)
        base = base.join(ContentTaxonomy, ContentTaxonomy.content_id == Content.id).where(
            ContentTaxonomy.taxonomy_id == taxonomy_id,
        )
    if category_id:
        # P2.7: 主栏目一对一过滤
        base = base.where(Content.category_id == category_id)
    if no_cover:
        base = base.where(or_(Content.cover_image.is_(None), Content.cover_image == ''))
    if no_tags:
        tag_subq = (
            select(ContentTaxonomy.content_id)
            .join(Taxonomy, Taxonomy.id == ContentTaxonomy.taxonomy_id)
            .where(Taxonomy.type == 'tag')
        )
        base = base.where(~Content.id.in_(tag_subq))
    if stale_days:
        cutoff = datetime.now(timezone.utc) - timedelta(days=stale_days)
        base = base.where(Content.updated_at < cutoff)
    if q:
        # P4.1 全文检索 v2: tsvector 匹配 (title A + body B + excerpt C + slug D) +
        # pg_trgm 相似度 (拼音/拼写容错) + ILIKE body 兜底 (老版本漏刷 / 边角 case)
        # 中文拆字: zhparser 装不上 (Alpine 编不了), 退化方案
        #   - simple config 不分字, '协作' 不会被 '2026年ai协作趋势' 命中
        #   - 兜底: 拆 query 成单字, 每个字 ILIKE 命中
        from sqlalchemy import or_, and_, func as _func, literal
        import re as _re
        q_clean = q.strip()
        if q_clean:
            # 拆 CJK 单字 + 保留非 CJK 词
            cjk_chars = _re.findall(r'[\u4e00-\u9fff]', q_clean)
            # 重要: unaccent() 参数是字面量字符串, 必须用 literal() 防止 SA 当列名
            ts_query = _func.plainto_tsquery('simple', _func.unaccent(literal(q_clean)))
            # trgm 相似度 (英文/拉丁词, 拼音/拼写容错)
            trgm_sim = _func.similarity(
                _func.unaccent(Content.title), _func.unaccent(literal(q_clean))
            )
            conditions = [
                Content.search_vector.op('@@')(ts_query),  # 1) tsvector 全词命中
                trgm_sim > 0.3,  # 2) trgm 相似度
                Content.title.ilike(f'%{q_clean}%'),  # 3) title 子串
                Content.excerpt.ilike(f'%{q_clean}%'),  # 4) excerpt 子串
            ]
            # 5) 中文拆字: 任一字命中 title 或 body (通过 search_vector 不行, 改用 ILIKE title + excerpt + body 最新版)
            if cjk_chars:
                from app.models.content import ContentVersion
                # body 走 ILIKE (中文 token 拼接问题, ILIKE 最稳)
                body_hits_subq = select(ContentVersion.content_id).where(
                    or_(*[ContentVersion.body.ilike(f'%{c}%') for c in cjk_chars])
                ).distinct().subquery()
                conditions.extend([
                    Content.title.ilike(any_(f'%{c}%') for c in cjk_chars) if False else None,
                    Content.id.in_(select(body_hits_subq.c.content_id)),
                ])
                # 简化: 任意单字 ILIKE title
                for c in cjk_chars:
                    conditions.append(Content.title.ilike(f'%{c}%'))

            base = base.where(or_(*[c for c in conditions if c is not None]))
            # ts_rank 排序 (命中率高的在前, 一样的话按 updated_at)
            base = base.order_by(
                _func.ts_rank(Content.search_vector, ts_query).desc(),
                Content.updated_at.desc(),
            )

    # 计数
    from sqlalchemy import func
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # 分页
    if q and q.strip():
        # q 路径上面已 order_by ts_rank, 不再覆写
        items = (await db.execute(
            base.offset((page - 1) * page_size)
            .limit(page_size)
        )).scalars().all()
    else:
        items = (await db.execute(
            base.order_by(Content.updated_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )).scalars().all()

    # 加载 author + taxonomy
    author_ids = list({c.author_id for c in items})
    authors = {}
    if author_ids:
        r = await db.execute(select(User).where(User.id.in_(author_ids)))
        authors = {u.id: u for u in r.scalars()}

    # 加载 taxonomy 关联
    ct_map: dict[uuid.UUID, list[uuid.UUID]] = {}
    primary_map: dict[uuid.UUID, uuid.UUID] = {}
    if items:
        r = await db.execute(
            select(ContentTaxonomy).where(
                ContentTaxonomy.content_id.in_([c.id for c in items])
            )
        )
        for ct in r.scalars().all():
            ct_map.setdefault(ct.content_id, []).append(ct.taxonomy_id)
            if ct.is_primary:
                primary_map[ct.content_id] = ct.taxonomy_id

    out = []
    for c in items:
        author = authors.get(c.author_id)
        out.append(ContentListItem(
            id=c.id, site_id=c.site_id, author_id=c.author_id,
            author_name=author.name if author else None,
            title=c.title, subtitle=c.subtitle, slug=c.slug, excerpt=c.excerpt,
            cover_image=c.cover_image,
            banner_image=getattr(c, "banner_image", None),
            is_featured=bool(getattr(c, "is_featured", False)),
            status=c.status, published_at=c.published_at,
            scheduled_at=c.scheduled_at,
            category_id=c.category_id,
            taxonomy_ids=ct_map.get(c.id, []),
            primary_taxonomy_id=primary_map.get(c.id),
            is_copy_of=c.is_copy_of,  # P3.9.1+ holy 反馈 #11279 续: 副本溯源
            view_count=c.view_count,
            created_at=c.created_at, updated_at=c.updated_at,
        ).model_dump(mode="json"))

    return page_resp(out, total, page, page_size)


# === 回收站 (P3.5) ===
# 注意: 必须在 /{content_id} 路由之前注册, 否则会被 path param 抢走

@router.get("/sites/{site_id}/contents/trash", response_model=None)
async def list_trash(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """已软删除文章列表 (P3.5 全流程: 删除/恢复)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问该站点")

    base = select(Content).where(
        Content.site_id == site_id,
        Content.deleted_at.isnot(None),
    )

    from sqlalchemy import func
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    items = (await db.execute(
        base.order_by(Content.deleted_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()

    # 加载 author
    author_ids = list({c.author_id for c in items})
    authors = {}
    if author_ids:
        r = await db.execute(select(User).where(User.id.in_(author_ids)))
        authors = {u.id: u for u in r.scalars()}

    out = []
    for c in items:
        author = authors.get(c.author_id)
        out.append({
            "id": str(c.id),
            "site_id": str(c.site_id),
            "author_id": str(c.author_id),
            "author_name": author.name if author else None,
            "title": c.title,
            "slug": c.slug,
            "excerpt": c.excerpt,
            "status": c.status,
            "category_id": str(c.category_id) if c.category_id else None,
            "is_copy_of": str(c.is_copy_of) if c.is_copy_of else None,
            "view_count": c.view_count,
            "created_at": c.created_at.isoformat(),
            "updated_at": c.updated_at.isoformat(),
            "deleted_at": c.deleted_at.isoformat() if c.deleted_at else None,
        })

    return page_resp(out, total, page, page_size)


@router.post("/sites/{site_id}/contents", response_model=None, status_code=201)
async def create_content(
    site_id: uuid.UUID,
    body: ContentCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """创建内容 (含初始版本 v1)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权创建内容")

    # 校验 taxonomy_ids
    valid_tax_ids = set()
    if body.taxonomy_ids:
        r = await db.execute(
            select(Taxonomy).where(
                Taxonomy.id.in_(body.taxonomy_ids),
                Taxonomy.site_id == site_id,
                Taxonomy.deleted_at.is_(None),
            )
        )
        valid_tax_ids = {t.id for t in r.scalars().all()}
        if len(valid_tax_ids) != len(set(body.taxonomy_ids)):
            raise BadRequest("部分 taxonomy_id 不存在或不属于该站点")
    if body.primary_taxonomy_id and body.primary_taxonomy_id not in valid_tax_ids:
        raise BadRequest("primary_taxonomy_id 必须在 taxonomy_ids 内")

    # P2.7: 校验 category_id
    if body.category_id:
        cat = await db.get(Category, body.category_id)
        if not cat or cat.site_id != site_id or cat.deleted_at:
            raise BadRequest("category_id 不存在或不属于该站点")
        # 兼容早期 Excel 导入：首次发文章时自动把旧中文 slug 修正为可发布 slug
        await _ensure_valid_category_slug(db, site_id, cat)
    if body.slug and not SLUG_RE.match(body.slug):
        raise BadRequest(f"文章 slug 不合法: {body.slug!r}")

    # P3.6+: 创建即发布需要 publish 权限 + published_at
    from app.services.content_status import check_transition
    check_transition(
        from_status="none", to_status=body.status,
        user=current_user, user_role=role, via_endpoint="create",
    )
    pub_at = None
    if body.status == "published":
        pub_at = datetime.now(timezone.utc)

    c = Content(
        site_id=site_id, author_id=current_user.id,
        title=body.title, subtitle=body.subtitle, slug=body.slug,
        excerpt=body.excerpt, cover_image=body.cover_image,
        banner_image=body.banner_image,
        is_featured=bool(body.is_featured),
        status=body.status,
        category_id=body.category_id,
        published_at=pub_at,  # P3.6+ 创建即发布
    )
    db.add(c)
    try:
        await db.flush()  # 拿 id, 可能 UniqueViolation
    except IntegrityError as e:
        await db.rollback()
        if "uq_contents_site_slug" in str(e.orig):
            raise Conflict(f"slug '{body.slug}' 在该站点已存在", code=40901) from e
        raise

    # 初始版本 v1
    v1 = ContentVersion(
        content_id=c.id, version_num=1,
        title=body.title, body=body.body, excerpt=body.excerpt,
        author_id=current_user.id, is_auto_save=False,
    )
    db.add(v1)

    # 关联 tag/series/format (N:N)
    for tid in body.taxonomy_ids:
        is_primary = (tid == body.primary_taxonomy_id)
        db.add(ContentTaxonomy(content_id=c.id, taxonomy_id=tid, is_primary=is_primary))

    # P2.7: 维护 categories.content_count (+1)
    if c.category_id:
        from sqlalchemy import update
        await db.execute(
            update(Category)
            .where(Category.id == c.category_id)
            .values(content_count=Category.content_count + 1)
        )

    await db.commit()
    await db.refresh(c)
    return ok({
        "id": str(c.id),
        "site_id": str(c.site_id),
        "author_id": str(c.author_id),
        "title": c.title, "subtitle": c.subtitle, "slug": c.slug,
        "excerpt": c.excerpt, "cover_image": c.cover_image,
        "banner_image": getattr(c, "banner_image", None),
        "is_featured": bool(getattr(c, "is_featured", False)),
        "body": body.body,
        "status": c.status,
        "category_id": str(c.category_id) if c.category_id else None,
        "taxonomy_ids": [str(tid) for tid in body.taxonomy_ids],
        "primary_taxonomy_id": str(body.primary_taxonomy_id) if body.primary_taxonomy_id else None,
        "view_count": 0,
        "created_at": c.created_at.isoformat(),
        "updated_at": c.updated_at.isoformat(),
    }, message="内容已创建")


@router.get("/sites/{site_id}/contents/{content_id}", response_model=None)
async def get_content(
    site_id: uuid.UUID,
    content_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """内容详情 (含 body)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问")

    c = await db.get(Content, content_id)
    if not c or c.site_id != site_id or c.deleted_at:
        raise NotFound("内容不存在")

    # body 取最新版本
    latest_v = (await db.execute(
        select(ContentVersion)
        .where(ContentVersion.content_id == c.id)
        .order_by(ContentVersion.version_num.desc())
        .limit(1)
    )).scalar_one_or_none()
    body = latest_v.body if latest_v else ""

    # 栏目关联
    cts = (await db.execute(
        select(ContentTaxonomy).where(ContentTaxonomy.content_id == c.id)
    )).scalars().all()
    tax_ids = [ct.taxonomy_id for ct in cts]
    primary = next((ct.taxonomy_id for ct in cts if ct.is_primary), None)

    author = await db.get(User, c.author_id)

    return ok({
        "id": str(c.id), "site_id": str(c.site_id),
        "author_id": str(c.author_id),
        "author_name": author.name if author else None,
        "title": c.title, "subtitle": c.subtitle, "slug": c.slug, "excerpt": c.excerpt,
        "cover_image": c.cover_image,
        "banner_image": getattr(c, "banner_image", None),
        "is_featured": bool(getattr(c, "is_featured", False)),
        "body": body, "status": c.status,
        "published_at": c.published_at.isoformat() if c.published_at else None,
        "scheduled_at": c.scheduled_at.isoformat() if c.scheduled_at else None,
        "category_id": str(c.category_id) if c.category_id else None,
        "taxonomy_ids": [str(tid) for tid in tax_ids],
        "primary_taxonomy_id": str(primary) if primary else None,
        "is_copy_of": str(c.is_copy_of) if c.is_copy_of else None,
        "view_count": c.view_count,
        "created_at": c.created_at.isoformat(),
        "updated_at": c.updated_at.isoformat(),
    })


@router.patch("/sites/{site_id}/contents/{content_id}", response_model=None)
async def update_content(
    site_id: uuid.UUID,
    content_id: uuid.UUID,
    body: ContentUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """更新内容 (创建新版本 v_n+1)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权修改")

    c = await db.get(Content, content_id)
    if not c or c.site_id != site_id or c.deleted_at:
        raise NotFound("内容不存在")

    # 协作锁
    if c.locked_by and c.locked_by != current_user.id:
        # 检查过期
        if c.locked_at and (datetime.now(timezone.utc) - c.locked_at).total_seconds() < LOCK_TTL_MINUTES * 60:
            raise Conflict("内容正在被其他人编辑, 请稍后再试", code=40903)

    # 更新字段
    if body.title is not None:
        c.title = body.title
    if "subtitle" in body.model_fields_set:
        c.subtitle = body.subtitle
    if body.slug is not None:
        c.slug = body.slug
    if body.excerpt is not None:
        c.excerpt = body.excerpt
    if "cover_image" in body.model_fields_set:
        # 传 null 清除, 传字符串覆盖
        c.cover_image = body.cover_image
    if "banner_image" in body.model_fields_set:
        c.banner_image = body.banner_image
    if body.is_featured is not None:
        c.is_featured = body.is_featured
    if body.status is not None:
        # P3.5 状态机: 校验 + 权限
        from app.services.content_status import check_transition
        check_transition(
            from_status=c.status, to_status=body.status,
            user=current_user, user_role=role, via_endpoint="patch",
        )
        # published → 记录 published_at
        if body.status == "published" and c.status != "published":
            c.published_at = datetime.now(timezone.utc)
        # scheduled → 记录 scheduled_at (或清除)
        if body.status == "scheduled":
            if "scheduled_at" in body.model_fields_set and body.scheduled_at is not None:
                c.scheduled_at = body.scheduled_at
            elif c.scheduled_at is None:
                raise BadRequest("status=scheduled 必须传 scheduled_at")
        else:
            # 跳离 scheduled → 清除 scheduled_at
            if c.status == "scheduled" and body.status != "scheduled":
                c.scheduled_at = None
        c.status = body.status
    elif "scheduled_at" in body.model_fields_set:
        # 只调时间不跳状态: 仍处于 scheduled 时允许调整时间
        if c.status == "scheduled":
            c.scheduled_at = body.scheduled_at
        elif body.scheduled_at is not None:
            # 不在 scheduled 态但想设时间 → 无意义, 报
            raise BadRequest("只有 scheduled 状态下才能设 scheduled_at")

    # P2.7: category_id 变更 (维护 content_count)
    if "category_id" in body.model_fields_set:
        old_cat = c.category_id
        new_cat = body.category_id
        if new_cat != old_cat:
            # 旧栏目 -1
            if old_cat:
                await db.execute(
                    update(Category)
                    .where(Category.id == old_cat)
                    .values(content_count=Category.content_count - 1)
                )
            # 新栏目 +1 (允许 None 表示取消主栏目)
            if new_cat:
                cat = await db.get(Category, new_cat)
                if not cat or cat.site_id != site_id or cat.deleted_at:
                    raise BadRequest("category_id 不存在或不属于该站点")
                await db.execute(
                    update(Category)
                    .where(Category.id == new_cat)
                    .values(content_count=Category.content_count + 1)
                )
            c.category_id = new_cat

    # P3.9.1+ (holy 反馈 #11279 续): 多选栏目 = 复制多份副本
    # - 传 None: 不动 (单选走 category_id 字段)
    # - 传 [] / [id1, id2, ...]: 同步副本状态
    #   - 主稿不变, 缺则复制 (加), 多余则删 (减)
    #   - 副本独立 content row, 独立 status/version/published_at
    if body.category_ids is not None:
        # 1) 禁止在副本上再复制 (避免链式)
        if c.is_copy_of is not None:
            raise BadRequest("副本不能再复制为多个其他副本, 请在主稿上操作 (复制列表仅在主稿生效)")
        # 2) 校验: 所有 category_id 必属于该站
        target_cats = set(body.category_ids)
        if target_cats:
            r = await db.execute(
                select(Category).where(
                    Category.id.in_(target_cats),
                    Category.site_id == site_id,
                    Category.deleted_at.is_(None),
                )
            )
            valid_cats = {row.id for row in r.scalars().all()}
            if valid_cats != target_cats:
                raise BadRequest("部分 category_id 不存在或不属于该站点")
        # 3) 同步: 主稿设为 category_ids[0], 缺则复制, 多余则删
        new_primary = body.category_ids[0] if body.category_ids else None
        # 3a) 旧主稿 category_id 可能不在新选里 → 旧主稿换 category_id 到第一个新选
        old_primary = c.category_id
        if old_primary != new_primary:
            if old_primary:
                await db.execute(
                    update(Category)
                    .where(Category.id == old_primary)
                    .values(content_count=Category.content_count - 1)
                )
            if new_primary:
                await db.execute(
                    update(Category)
                    .where(Category.id == new_primary)
                    .values(content_count=Category.content_count + 1)
                )
            c.category_id = new_primary
        # 3b) 当前所有副本
        existing_copies = (await db.execute(
            select(Content).where(
                Content.is_copy_of == c.id,
                Content.deleted_at.is_(None),
            )
        )).scalars().all()
        existing_copy_cats = {cp.category_id for cp in existing_copies}
        target_secondary = target_cats - {new_primary}  # 主稿以外的其他栏
        # 3c) 加: 选里但副本里没有的
        for cat_id in target_secondary - existing_copy_cats:
            await _duplicate_content_to_category(db, c, cat_id, site_id, current_user)
        # 3d) 删: 副本里有但选里没有的
        for cp in existing_copies:
            if cp.category_id not in target_secondary:
                await db.delete(cp)
                # content_count -1
                if cp.category_id:
                    await db.execute(
                        update(Category)
                        .where(Category.id == cp.category_id)
                        .values(content_count=Category.content_count - 1)
                    )

    # 创建新版本 (如果 body 改了)
    if body.body is not None:
        last_v = (await db.execute(
            select(ContentVersion)
            .where(ContentVersion.content_id == c.id)
            .order_by(ContentVersion.version_num.desc())
            .limit(1)
        )).scalar_one_or_none()
        next_num = (last_v.version_num + 1) if last_v else 1
        new_v = ContentVersion(
            content_id=c.id, version_num=next_num,
            title=c.title, body=body.body, excerpt=c.excerpt,
            author_id=current_user.id, is_auto_save=False,
        )
        db.add(new_v)
        await db.flush()
        # 已发布文章保存后，静态发布读 published_version_id；须同步到最新版本
        if c.status == "published":
            c.published_version_id = new_v.id

    # 栏目关联
    if body.taxonomy_ids is not None:
        # 删旧的
        old_cts = (await db.execute(
            select(ContentTaxonomy).where(ContentTaxonomy.content_id == c.id)
        )).scalars().all()
        for ct in old_cts:
            await db.delete(ct)
        # 加新的
        valid_tax_ids = set()
        if body.taxonomy_ids:
            r = await db.execute(
                select(Taxonomy.id).where(
                    Taxonomy.id.in_(body.taxonomy_ids),
                    Taxonomy.site_id == site_id,
                    Taxonomy.deleted_at.is_(None),
                )
            )
            valid_tax_ids = {row[0] for row in r.all()}
            if len(valid_tax_ids) != len(set(body.taxonomy_ids)):
                raise BadRequest("部分 taxonomy_id 不存在")
        for tid in body.taxonomy_ids:
            is_primary = (tid == body.primary_taxonomy_id)
            db.add(ContentTaxonomy(content_id=c.id, taxonomy_id=tid, is_primary=is_primary))

    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        if "uq_contents_site_slug" in str(e.orig):
            raise Conflict(f"slug '{body.slug}' 已被占用", code=40901) from e
        raise
    await db.refresh(c)
    return ok(message="已更新")


async def _render_content_preview_html(
    db: AsyncSession,
    site: Site,
    content: Content,
    *,
    body_override: str | None = None,
) -> str:
    """用栏目详情模板实时渲染文章 HTML（预览用，不写盘）。"""
    from app.models.layout import Layout
    from app.models.site_asset import SiteAsset, public_relpath
    from app.services.page_renderer import PageRenderer
    from app.services.render_context_factory import RenderContextFactory

    cat = await db.get(Category, content.category_id) if content.category_id else None

    latest_v = (await db.execute(
        select(ContentVersion)
        .where(ContentVersion.content_id == content.id)
        .order_by(ContentVersion.version_num.desc())
        .limit(1)
    )).scalar_one_or_none()
    content.body_html = body_override if body_override is not None else (latest_v.body if latest_v else "")

    layouts = (await db.execute(
        select(Layout).where(
            Layout.site_id == site.id,
            Layout.deleted_at.is_(None),
            Layout.is_active.is_(True),
        )
    )).scalars().all()

    site_assets = (await db.execute(
        select(SiteAsset).where(SiteAsset.site_id == site.id)
    )).scalars().all()
    asset_urls = {a.name: public_relpath(a) for a in site_assets}
    assets_by_category: dict[str, list[dict[str, str]]] = {"css": [], "js": [], "assets": []}
    for a in site_assets:
        assets_by_category.setdefault(a.category, []).append({
            "name": a.name,
            "url": public_relpath(a),
            "content_type": a.content_type,
        })
    for items in assets_by_category.values():
        items.sort(key=lambda x: x["name"])

    cats = [cat] if cat else []
    contents = [content]
    factory = RenderContextFactory(
        site=site,
        cats=cats,
        contents=contents,
        base_url="",
        build_id="preview",
    )
    factory.asset_urls = asset_urls
    factory.assets_by_category = assets_by_category
    templates_by_code = {
        ly.code: ly.html for ly in layouts if ly.code and ly.html is not None
    }
    if templates_by_code:
        factory.templates_by_code = templates_by_code

    renderer = PageRenderer(factory, layouts=layouts)
    page = renderer.content(content, cat=cat)
    html = page.html or ""
    if site.slug:
        base_href = f"/sites/{site.slug}/{cat.slug}/" if cat else f"/sites/{site.slug}/"
        html = _inject_preview_base_href(html, base_href)
    return html


def _inject_preview_base_href(html: str, base_href: str) -> str:
    """注入 <base>，使预览页相对 CSS/JS 指向 /sites/{slug}/ 静态资源。"""
    import re

    if re.search(r"<base\b", html, re.I):
        return html
    base_tag = f'<base href="{base_href}">'
    match = re.search(r"(<head[^>]*>)", html, re.I)
    if match:
        pos = match.end()
        return html[:pos] + base_tag + html[pos:]
    return f"<!doctype html><html><head>{base_tag}</head><body>{html}</body></html>"


@router.get("/sites/{site_id}/contents/{content_id}/preview-html", response_class=HTMLResponse)
async def preview_content_html(
    site_id: uuid.UUID,
    content_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """实时预览：按栏目详情模板渲染最新已保存正文（新窗带 token 打开用）。"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问")

    c = await db.get(Content, content_id)
    if not c or c.site_id != site_id or c.deleted_at:
        raise NotFound("内容不存在")

    html = await _render_content_preview_html(db, site, c)
    return HTMLResponse(html)


@router.post("/sites/{site_id}/contents/{content_id}/preview-html", response_class=HTMLResponse)
async def preview_content_html_with_body(
    site_id: uuid.UUID,
    content_id: uuid.UUID,
    payload: ContentPreviewRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """实时预览：用请求体中的正文渲染（与编辑器当前 HTML 一致，不入库）。"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问")

    c = await db.get(Content, content_id)
    if not c or c.site_id != site_id or c.deleted_at:
        raise NotFound("内容不存在")

    html = await _render_content_preview_html(db, site, c, body_override=payload.body)
    return HTMLResponse(html)


@router.post("/sites/{site_id}/contents/{content_id}/publish", response_model=None)
async def publish_content(
    site_id: uuid.UUID,
    content_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """发布内容 (draft/pending/scheduled → published, 记录 published_at)

    P3.5 状态机:
    - archived → published 不允许 (必须先 restore 到 draft)
    - editor 不可发布 (需 owner)
    - pending 状态下, owner 可发布 (= 审批通过)
    - scheduled 状态下, owner 可发布 (= 立即发布, 取消计划)
    """
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权发布")

    c = await db.get(Content, content_id)
    if not c or c.site_id != site_id or c.deleted_at:
        raise NotFound("内容不存在")

    # 发布前校验: 所属栏目必须有合法 slug (发布到 <cat-slug>/<slug>.html)
    if c.category_id:
        cat = await db.get(Category, c.category_id)
        if not cat or cat.deleted_at:
            raise BadRequest("所属栏目不存在或已删除")
        if not cat.slug or not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", cat.slug):
            raise BadRequest(f"栏目 slug 不合法: {cat.slug!r} (必须是英文小写+连字符)")
    if not c.slug or not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", c.slug):
        raise BadRequest(f"文章 slug 不合法: {c.slug!r}")

    # 状态机: 校验 + 权限
    from app.services.content_status import check_transition
    check_transition(
        from_status=c.status, to_status="published",
        user=current_user, user_role=role, via_endpoint="publish",
    )

    latest_v = (await db.execute(
        select(ContentVersion)
        .where(ContentVersion.content_id == c.id)
        .order_by(ContentVersion.version_num.desc())
        .limit(1)
    )).scalar_one_or_none()

    # 已是 published：同步最新正文版本，便于「保存并发布」重生成静态页
    if c.status == "published" and c.published_at:
        if latest_v:
            c.published_version_id = latest_v.id
            await db.commit()
        return ok({
            "id": str(c.id),
            "status": c.status,
            "published_at": c.published_at.isoformat(),
        }, message="已是发布状态，已同步最新正文版本")

    c.status = "published"
    c.published_at = datetime.now(timezone.utc)
    c.scheduled_at = None  # 清掉计划时间
    if latest_v:
        c.published_version_id = latest_v.id
    await db.commit()
    await db.refresh(c)
    return ok({
        "id": str(c.id),
        "status": c.status,
        "published_at": c.published_at.isoformat() if c.published_at else None,
    }, message="发布成功")


@router.post("/sites/{site_id}/contents/{content_id}/archive", response_model=None)
async def archive_content(
    site_id: uuid.UUID,
    content_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """归档 (任何状态 → archived) - P3.5 专用端点, owner 限定"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权归档")

    c = await db.get(Content, content_id)
    if not c or c.site_id != site_id or c.deleted_at:
        raise NotFound("内容不存在")

    from app.services.content_status import check_transition
    check_transition(
        from_status=c.status, to_status="archived",
        user=current_user, user_role=role, via_endpoint="archive",
    )

    if c.status == "archived":
        return ok({"id": str(c.id), "status": c.status}, message="已是归档")

    c.status = "archived"
    c.scheduled_at = None
    await db.commit()
    await db.refresh(c)
    return ok({"id": str(c.id), "status": c.status}, message="已归档")


@router.post("/sites/{site_id}/contents/{content_id}/restore", response_model=None)
async def restore_content(
    site_id: uuid.UUID,
    content_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """从回收站恢复 OR 从归档恢复到 draft (二合一)
    P3.5: 回收站走 deleted_at 路径, 归档走 status 路径
    """
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权恢复")

    c = await db.get(Content, content_id)
    if not c or c.site_id != site_id:
        raise NotFound("内容不存在")

    # 路径 1: 从软删回收站恢复
    if c.deleted_at:
        c.deleted_at = None
        if c.category_id:
            await db.execute(
                update(Category)
                .where(Category.id == c.category_id, Category.deleted_at.is_(None))
                .values(content_count=Category.content_count + 1)
            )
        await db.commit()
        await db.refresh(c)
        return ok(message="已恢复 (从回收站)")

    # 路径 2: 从归档恢复 (→ draft)
    if c.status == "archived":
        from app.services.content_status import check_transition
        check_transition(
            from_status="archived", to_status="draft",
            user=current_user, user_role=role, via_endpoint="restore",
        )
        c.status = "draft"
        await db.commit()
        await db.refresh(c)
        return ok(message="已恢复 (从归档, 状态=草稿)")

    raise BadRequest("内容未被删除或归档,无需恢复")


@router.delete("/sites/{site_id}/contents/{content_id}", response_model=None)
async def delete_content(
    site_id: uuid.UUID,
    content_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """软删除内容 (级联 content_taxonomies)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_delete(role):
        raise Forbidden("仅 owner 可删除")

    c = await db.get(Content, content_id)
    if not c or c.site_id != site_id or c.deleted_at:
        raise NotFound("内容不存在")

    now = datetime.now(timezone.utc)
    c.deleted_at = now
    # P2.8 D3: 维护 categories.content_count (-1) 如果有主栏目
    if c.category_id:
        await db.execute(
            update(Category)
            .where(Category.id == c.category_id, Category.deleted_at.is_(None))
            .values(content_count=Category.content_count - 1)
        )

    # P3.9.1+ (holy 反馈 #11279 续): 删主稿级联软删所有副本
    # 副本独立的 content_count 也需 -1 (每个副本都有自己的 category_id)
    if c.is_copy_of is None:
        # 是主稿 (不是副本), 才需要 cascade
        copies = (await db.execute(
            select(Content).where(
                Content.is_copy_of == c.id,
                Content.deleted_at.is_(None),
            )
        )).scalars().all()
        for cp in copies:
            cp.deleted_at = now
            if cp.category_id:
                await db.execute(
                    update(Category)
                    .where(Category.id == cp.category_id, Category.deleted_at.is_(None))
                    .values(content_count=Category.content_count - 1)
                )
    # 同步清关联
    cts = (await db.execute(
        select(ContentTaxonomy).where(ContentTaxonomy.content_id == c.id)
    )).scalars().all()
    # content_taxonomies 不软删, 直接 hard delete (CASCADE)
    for ct in cts:
        await db.delete(ct)

    # P3.5.2: 已发布的文章, 同步清静态文件
    static_result = None
    was_published = c.status == "published" or c.published_at is not None
    if was_published:
        from app.services.static_cleanup import delete_content_static
        static_result = delete_content_static(
            site_id=str(site.id), site_slug=site.slug, content_slug=c.slug
        )

    # versions 永不删
    await db.commit()
    msg = "已删除" + (", 已同步清静态文件" if static_result and static_result["removed"] else "")
    return ok(message=msg, data=static_result)


@router.get("/sites/{site_id}/contents/{content_id}/versions", response_model=None)
async def list_versions(
    site_id: uuid.UUID,
    content_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """版本列表 (倒序)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问")

    c = await db.get(Content, content_id)
    if not c or c.site_id != site_id or c.deleted_at:
        raise NotFound("内容不存在")

    vs = (await db.execute(
        select(ContentVersion, User)
        .join(User, User.id == ContentVersion.author_id)
        .where(ContentVersion.content_id == c.id)
        .order_by(ContentVersion.version_num.desc())
    )).all()

    out = [
        {
            "id": str(v.id),
            "content_id": str(v.content_id),
            "version_num": v.version_num,
            "title": v.title,
            "body": v.body,
            "excerpt": v.excerpt,
            "author_id": str(v.author_id),
            "author_name": u.name,
            "is_auto_save": v.is_auto_save,
            "created_at": v.created_at.isoformat(),
        }
        for v, u in vs
    ]
    return ok(out)

# === 永久删除 (P3.5 回收站) ===

async def _hard_delete_content(db: AsyncSession, site: Site, c: Content) -> dict | None:
    """物理删除单篇内容（调用方负责 commit）"""
    from app.models.content_snapshot import ContentSnapshot
    from app.services.static_cleanup import delete_content_static

    static_result = delete_content_static(
        site_id=str(site.id), site_slug=site.slug, content_slug=c.slug
    )
    # 先删快照（version_id 外键 RESTRICT，否则删 versions 会失败）
    snaps = (await db.execute(
        select(ContentSnapshot).where(ContentSnapshot.content_id == c.id)
    )).scalars().all()
    for snap in snaps:
        await db.delete(snap)
    cts = (await db.execute(
        select(ContentTaxonomy).where(ContentTaxonomy.content_id == c.id)
    )).scalars().all()
    for ct in cts:
        await db.delete(ct)
    vs = (await db.execute(
        select(ContentVersion).where(ContentVersion.content_id == c.id)
    )).scalars().all()
    for v in vs:
        await db.delete(v)
    await db.delete(c)
    return static_result


@router.delete("/sites/{site_id}/contents/{content_id}/permanent", response_model=None)
async def permanent_delete_content(
    site_id: uuid.UUID,
    content_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """永久删除 (真删) - 仅 owner (不可逆)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_delete(role):
        raise Forbidden("仅 owner 可永久删除")

    c = await db.get(Content, content_id)
    if not c or c.site_id != site_id:
        raise NotFound("内容不存在")
    if not c.deleted_at:
        raise BadRequest("只能永久删除已软删的内容,请先移到回收站")

    static_result = await _hard_delete_content(db, site, c)
    await db.commit()
    msg = "已永久删除" + (", 已同步清静态文件" if static_result and static_result.get("removed") else "")
    return ok(message=msg, data=static_result)


# === 导入 HTML：服务端代拉外链（绕过浏览器 CORS）===

_FETCH_REMOTE_MAX = 5 * 1024 * 1024  # 5MB
_FETCH_BLOCKED_HOSTS = {
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "metadata.google.internal",
}


class FetchRemoteRequest(BaseModel):
    url: str = Field(..., min_length=8, max_length=2048)


def _is_blocked_fetch_host(host: str) -> bool:
    h = (host or "").lower().strip().rstrip(".")
    if not h or h in _FETCH_BLOCKED_HOSTS:
        return True
    if h.endswith(".localhost") or h.endswith(".local"):
        return True
    # 粗略拦内网 / 链路本地
    if h.startswith("10.") or h.startswith("192.168.") or h.startswith("169.254."):
        return True
    if h.startswith("172."):
        try:
            second = int(h.split(".")[1])
            if 16 <= second <= 31:
                return True
        except (IndexError, ValueError):
            pass
    return False


@router.post("/sites/{site_id}/contents/fetch-remote", response_model=None)
async def fetch_remote_text(
    site_id: uuid.UUID,
    payload: FetchRemoteRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """代拉外链文本（HTML/CSS/JS），供「导入 HTML · 网络 URL」使用。"""
    import httpx
    from urllib.parse import urlparse

    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无写权限")

    raw_url = (payload.url or "").strip()
    if not raw_url.startswith(("http://", "https://")):
        raise BadRequest("url 必须是 http(s) 外链")

    parsed = urlparse(raw_url)
    if _is_blocked_fetch_host(parsed.hostname or ""):
        raise BadRequest("不允许拉取该主机")

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,text/css,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
            resp = await client.get(raw_url, headers=headers)
            resp.raise_for_status()
            final_url = str(resp.url)
            final_host = urlparse(final_url).hostname or ""
            if _is_blocked_fetch_host(final_host):
                raise BadRequest("重定向目标主机不允许拉取")
            content = resp.content
            content_type = (resp.headers.get("content-type") or "text/plain").split(";")[0].strip().lower()
    except BadRequest:
        raise
    except Exception as e:
        raise BadRequest(f"拉取失败: {e}") from e

    if len(content) == 0:
        raise BadRequest("外链内容为空")
    if len(content) > _FETCH_REMOTE_MAX:
        raise BadRequest(f"内容过大: {len(content)} bytes > {_FETCH_REMOTE_MAX}")

    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("utf-8", errors="replace")

    return ok({
        "url": raw_url,
        "final_url": final_url,
        "content_type": content_type,
        "text": text,
    })


# === P6.2 #16: 批量操作 ===

class BatchContentRequest(BaseModel):
    action: Literal["delete", "archive", "publish", "restore", "permanent"]
    content_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=100)


@router.post("/sites/{site_id}/contents/batch", response_model=None)
async def batch_content_action(
    site_id: uuid.UUID,
    payload: BatchContentRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """批量动作: delete (软删) / archive / publish / restore / permanent (物理删)

    权限: 复用现有 endpoint 的语义
    - delete / permanent: 仅 owner
    - archive: editor + owner
    - publish: editor + owner
    - restore: editor + owner (从归档回 draft, 从回收站恢复)

    返回 per-id 结果, 不会因为单条失败而中断其他
    """
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)

    # 权限校验: delete / permanent 严格, 其他 _can_write
    if payload.action in ("delete", "permanent"):
        if not _can_delete(role):
            raise Forbidden("仅 owner 可批量删除")
    else:
        if not _can_write(role):
            raise Forbidden(f"无权批量{payload.action}")

    # 一次查所有目标内容
    rows = (await db.execute(
        select(Content).where(
            Content.id.in_(payload.content_ids),
            Content.site_id == site_id,
        )
    )).scalars().all()
    by_id = {c.id: c for c in rows}
    now = datetime.now(timezone.utc)

    results: list[dict] = []
    succeeded = 0
    failed = 0

    for cid in payload.content_ids:
        c = by_id.get(cid)
        if not c:
            results.append({"content_id": str(cid), "success": False, "error": "不存在或非本站内容"})
            failed += 1
            continue
        try:
            if payload.action == "delete":
                if c.deleted_at:
                    results.append({"content_id": str(cid), "success": False, "error": "已在回收站"})
                    failed += 1
                    continue
                c.deleted_at = now
                # content_count 维护
                if c.category_id:
                    await db.execute(
                        update(Category)
                        .where(Category.id == c.category_id, Category.deleted_at.is_(None))
                        .values(content_count=Category.content_count - 1)
                    )
                # 级联副本 (主稿才需要)
                if c.is_copy_of is None:
                    copies = (await db.execute(
                        select(Content).where(
                            Content.is_copy_of == c.id,
                            Content.deleted_at.is_(None),
                        )
                    )).scalars().all()
                    for cp in copies:
                        cp.deleted_at = now
                        if cp.category_id:
                            await db.execute(
                                update(Category)
                                .where(Category.id == cp.category_id, Category.deleted_at.is_(None))
                                .values(content_count=Category.content_count - 1)
                            )
                # 清 content_taxonomies
                cts = (await db.execute(
                    select(ContentTaxonomy).where(ContentTaxonomy.content_id == c.id)
                )).scalars().all()
                for ct in cts:
                    await db.delete(ct)
                results.append({"content_id": str(cid), "success": True})
                succeeded += 1

            elif payload.action == "archive":
                if c.deleted_at:
                    results.append({"content_id": str(cid), "success": False, "error": "已删除, 不可归档"})
                    failed += 1
                    continue
                if c.status == "archived":
                    results.append({"content_id": str(cid), "success": False, "error": "已是归档状态"})
                    failed += 1
                    continue
                from app.services.content_status import check_transition
                check_transition(
                    from_status=c.status, to_status="archived",
                    user=current_user, user_role=role, via_endpoint="batch_archive",
                )
                c.status = "archived"
                results.append({"content_id": str(cid), "success": True})
                succeeded += 1

            elif payload.action == "publish":
                if c.deleted_at:
                    results.append({"content_id": str(cid), "success": False, "error": "已删除, 不可发布"})
                    failed += 1
                    continue
                if c.status == "published" and c.published_at:
                    results.append({"content_id": str(cid), "success": True, "noop": True})
                    succeeded += 1
                    continue
                # slug 校验
                if not c.slug or not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", c.slug):
                    results.append({"content_id": str(cid), "success": False, "error": f"slug 不合法: {c.slug!r}"})
                    failed += 1
                    continue
                from app.services.content_status import check_transition
                check_transition(
                    from_status=c.status, to_status="published",
                    user=current_user, user_role=role, via_endpoint="batch_publish",
                )
                c.status = "published"
                c.published_at = now
                c.scheduled_at = None
                results.append({"content_id": str(cid), "success": True})
                succeeded += 1

            elif payload.action == "restore":
                # 路径 1: 从回收站恢复
                if c.deleted_at:
                    c.deleted_at = None
                    if c.category_id:
                        await db.execute(
                            update(Category)
                            .where(Category.id == c.category_id, Category.deleted_at.is_(None))
                            .values(content_count=Category.content_count + 1)
                        )
                    results.append({"content_id": str(cid), "success": True})
                    succeeded += 1
                    continue
                # 路径 2: 从归档回 draft
                if c.status == "archived":
                    from app.services.content_status import check_transition
                    check_transition(
                        from_status="archived", to_status="draft",
                        user=current_user, user_role=role, via_endpoint="batch_restore",
                    )
                    c.status = "draft"
                    results.append({"content_id": str(cid), "success": True})
                    succeeded += 1
                    continue
                results.append({"content_id": str(cid), "success": False, "error": "未被删除或归档"})
                failed += 1

            elif payload.action == "permanent":
                if not c.deleted_at:
                    results.append({"content_id": str(cid), "success": False, "error": "不在回收站"})
                    failed += 1
                    continue
                await _hard_delete_content(db, site, c)
                results.append({"content_id": str(cid), "success": True})
                succeeded += 1
        except (BadRequest, Forbidden) as e:
            results.append({"content_id": str(cid), "success": False, "error": e.message if hasattr(e, "message") else str(e)})
            failed += 1

    await db.commit()

    action_label = {
        "delete": "删除", "archive": "归档", "publish": "发布",
        "restore": "恢复", "permanent": "永久删除",
    }[payload.action]
    msg = f"批量{action_label}: 成功 {succeeded}, 失败 {failed}"
    return ok({"results": results, "total": len(payload.content_ids), "succeeded": succeeded, "failed": failed}, message=msg)
