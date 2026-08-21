"""全局搜索 API (P5.1 + P5.5)

跨站内容搜索 (admin ⌘K / /admin/search 用).

API:
- GET /api/v1/search?q=...&site_id=...&status=...&page=1&page_size=20
  返回: 内容列表 + 命中片段 (ts_headline) + ts_rank 排序

实现:
- tsvector 匹配 (title A + body B + excerpt C + slug D, 触发器已维护)
- pg_trgm 相似度 (英文/拉丁容错)
- CJK jieba 拆词 (P5.5 优化: '合作共赢' → ['合作','共赢'], OR tsquery, 不再每字 LIKE)
- ts_headline 片段高亮 (PostgreSQL 内置)

P5.5 优化:
- plainto_tsquery (AND) → jieba 拆词 + to_tsquery (OR) — 召回率 ↑
- ILIKE 从每字 → 每词 (N 个 LIKE 变 M 个, M << N) — 速度 ↑
- tsvector 已存 'simple' 分词 token, OR 拼能命中任一

权限:
- super_admin: 搜所有站
- 普通用户: 仅搜自己 site_member 的站
"""
import re
import uuid
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func as sql_func, literal, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.exceptions import BadRequest, Forbidden
from app.core.responses import page_resp
from app.db.session import get_db
from app.models.content import Content, ContentVersion
from app.models.membership import SiteMember
from app.models.site import Site
from app.models.user import User
from app.services.cjk import build_tsquery_safe, split_tokens_for_ilike, tokenize_for_search

router = APIRouter(tags=["search"])


async def _accessible_site_ids(db: AsyncSession, user: User) -> list[uuid.UUID]:
    """返回用户可访问的站 id 列表.
    - super_admin: 所有非删站
    - 普通用户: 自己 owner 的站 + 自己 site_member 的站
    """
    if user.is_super_admin:
        r = await db.execute(select(Site.id).where(Site.deleted_at.is_(None)))
        return [row[0] for row in r.all()]
    # owner
    r1 = await db.execute(
        select(Site.id).where(
            Site.owner_id == user.id, Site.deleted_at.is_(None)
        )
    )
    owner_ids = {row[0] for row in r1.all()}
    # member
    r2 = await db.execute(
        select(SiteMember.site_id).where(
            SiteMember.user_id == user.id,
            SiteMember.deleted_at.is_(None),
        )
    )
    member_ids = {row[0] for row in r2.all()}
    return list(owner_ids | member_ids)


@router.get("/search", response_model=None)
async def global_search(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    q: str = Query(..., min_length=1, max_length=200, description="搜索词"),
    site_id: Optional[uuid.UUID] = Query(None, description="限定站点 (None=跨站)"),
    status: Optional[Literal["draft", "pending", "published", "scheduled", "archived"]] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
):
    """全局搜索: 内容 (跨站) + ts_headline 片段高亮 + ts_rank 排序"""
    q_clean = q.strip()
    if not q_clean:
        raise BadRequest("搜索词不能为空")

    # 1) 拿到可访问的 site_id 列表
    accessible = await _accessible_site_ids(db, current_user)
    if not accessible:
        return page_resp([], 0, page, page_size)
    if site_id:
        if site_id not in accessible:
            raise Forbidden("无权访问该站点")
        site_filter = [site_id]
    else:
        site_filter = accessible

    # 2) 基础 query
    base = select(Content).where(
        Content.site_id.in_(site_filter),
        Content.deleted_at.is_(None),
    )
    if status:
        base = base.where(Content.status == status)

    # 3) 全文匹配条件 (P5.5: jieba 拆词 + OR tsquery + 每词 ILIKE)
    # tokens: e.g. ['AI', '协作'] 或 ['合作', '共赢']
    tokens = tokenize_for_search(q_clean)
    ts_query_str = build_tsquery_safe(tokens)
    if ts_query_str:
        ts_query = sql_func.to_tsquery('simple', literal(ts_query_str))
    else:
        # 全部被停用词去掉 — 兑底用 plainto (不会产生 token)
        ts_query = sql_func.plainto_tsquery('simple', sql_func.unaccent(literal(q_clean)))
    trgm_sim = sql_func.similarity(
        sql_func.unaccent(Content.title), sql_func.unaccent(literal(q_clean))
    )
    conditions = [
        Content.search_vector.op('@@')(ts_query),  # 1) tsvector 任一词命中 (OR)
        trgm_sim > 0.3,  # 2) trgm 相似度
        Content.title.ilike(f'%{q_clean}%'),  # 3) title 原字串子串 (兑底)
        Content.excerpt.ilike(f'%{q_clean}%'),  # 4) excerpt 原字串子串 (兑底)
    ]
    # 5) jieba 拆词 ILIKE (中文场景性能优化: M 个词 vs N 个字)
    if tokens:
        token_ilike_conditions = []
        for tok in tokens:
            token_ilike_conditions.append(Content.title.ilike(f'%{tok}%'))
            token_ilike_conditions.append(Content.excerpt.ilike(f'%{tok}%'))
        if token_ilike_conditions:
            conditions.append(or_(*token_ilike_conditions))
        # 6) body 命中 (走 content_versions)
        body_hits_subq = select(ContentVersion.content_id).where(
            or_(*[ContentVersion.body.ilike(f'%{tok}%') for tok in tokens])
        ).distinct().subquery()
        conditions.append(Content.id.in_(select(body_hits_subq.c.content_id)))

    base = base.where(or_(*conditions))

    # 4) 计数
    count_q = select(sql_func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # 5) 排序 + 分页: 一起 SELECT 标题高亮 (ts_headline)
    rank_expr = sql_func.ts_rank(Content.search_vector, ts_query)
    title_headline = sql_func.ts_headline(
        'simple',
        Content.title,
        ts_query,
        'MaxFragments=1,MaxWords=20,MinWords=5,StartSel=<mark>,StopSel=</mark>'
    )
    items_rows = (await db.execute(
        base.add_columns(title_headline.label("title_highlight"))
        .order_by(rank_expr.desc(), Content.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).all()

    if not items_rows:
        return page_resp([], 0, page, page_size)

    items = [row[0] for row in items_rows]
    hl_map = {row[0].id: row[1] for row in items_rows}

    # 7) 加载 site + author 信息
    site_ids = list({c.site_id for c in items})
    author_ids = list({c.author_id for c in items})

    sites_r = await db.execute(
        select(Site).where(Site.id.in_(site_ids))
    )
    sites_map = {s.id: s for s in sites_r.scalars().all()}

    authors_r = await db.execute(
        select(User).where(User.id.in_(author_ids))
    )
    authors_map = {u.id: u for u in authors_r.scalars().all()}

    out = []
    for c in items:
        site = sites_map.get(c.site_id)
        author = authors_map.get(c.author_id)
        out.append({
            "id": str(c.id),
            "site_id": str(c.site_id),
            "site_name": site.name if site else None,
            "site_slug": site.slug if site else None,
            "author_id": str(c.author_id),
            "author_name": author.name if author else None,
            "title": c.title,
            "title_highlight": hl_map.get(c.id) or c.title,
            "slug": c.slug,
            "excerpt": c.excerpt,
            "status": c.status,
            "category_id": str(c.category_id) if c.category_id else None,
            "updated_at": c.updated_at.isoformat(),
            "published_at": c.published_at.isoformat() if c.published_at else None,
        })

    return page_resp(out, total, page, page_size)
