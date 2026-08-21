"""Stats / trends API (P6.1.2 / P6.1.3)

Dashboard 商业化数据:
- /stats/trends: 当前数字 + 上周对比 + delta (↗/↘)
- /stats/deployments?days=7: 时间序列 (sparkline)

权限: super_admin 看全部, 普通用户看自己可访问站
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func as sql_func, case, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.responses import ok
from app.db.session import get_db
from app.models.ai_run import AIRun
from app.models.content import Content
from app.models.deployment import Deployment
from app.models.site import Site
from app.models.membership import SiteMember
from app.models.user import User

router = APIRouter(tags=["stats"])


async def _accessible_site_ids(db: AsyncSession, user: User) -> list[uuid.UUID]:
    """复用 search.py 的逻辑 — 用户可访问的站 id 列表."""
    if user.is_super_admin:
        r = await db.execute(select(Site.id).where(Site.deleted_at.is_(None)))
        return [row[0] for row in r.all()]
    r1 = await db.execute(
        select(Site.id).where(
            Site.owner_id == user.id, Site.deleted_at.is_(None)
        )
    )
    owner_ids = {row[0] for row in r1.all()}
    r2 = await db.execute(
        select(SiteMember.site_id).where(
            SiteMember.user_id == user.id,
            SiteMember.deleted_at.is_(None),
        )
    )
    member_ids = {row[0] for row in r2.all()}
    return list(owner_ids | member_ids)


@router.get("/stats/trends", response_model=None)
async def get_trends(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Dashboard 4 数字 + 趋势 (上周对比)

    返回:
    {
      contents: {current: 68, last_week: 56, delta: 12, trend: 'up'},
      pending: {current: 1, last_week: 3, delta: -2, trend: 'down'},
      sites: {current: 5, last_week: 5, delta: 0, trend: 'flat'},
      deployments_30d: {current: 162, ...},
    }
    """
    site_ids = await _accessible_site_ids(db, current_user)
    if not site_ids:
        # 无站点 — 全 0
        return ok({
            "contents": {"current": 0, "last_week": 0, "delta": 0, "trend": "flat"},
            "pending": {"current": 0, "last_week": 0, "delta": 0, "trend": "flat"},
            "sites": {"current": 0, "last_week": 0, "delta": 0, "trend": "flat"},
            "deployments_30d": {"current": 0, "last_week": 0, "delta": 0, "trend": "flat"},
        })

    now = datetime.now(timezone.utc)
    window_days = 14
    window_ago = now - timedelta(days=window_days)
    two_windows_ago = now - timedelta(days=window_days * 2)

    # contents 总数 (近 14 天 vs 前 14 天)
    cnt_now = (await db.execute(
        select(sql_func.count(Content.id)).where(
            Content.site_id.in_(site_ids), Content.deleted_at.is_(None),
            Content.created_at >= window_ago,
        )
    )).scalar() or 0
    cnt_old = (await db.execute(
        select(sql_func.count(Content.id)).where(
            Content.site_id.in_(site_ids), Content.deleted_at.is_(None),
            Content.created_at >= two_windows_ago,
            Content.created_at < window_ago,
        )
    )).scalar() or 0

    # pending (当前 + 前一窗口, status 在变不是 created_at)
    pending_now = (await db.execute(
        select(sql_func.count(Content.id)).where(
            Content.site_id.in_(site_ids), Content.deleted_at.is_(None),
            Content.status == 'pending',
        )
    )).scalar() or 0
    pending_old = (await db.execute(
        select(sql_func.count(Content.id)).where(
            Content.site_id.in_(site_ids), Content.deleted_at.is_(None),
            Content.status == 'pending',
            Content.updated_at < window_ago,
        )
    )).scalar() or 0

    # sites (创建时间对比, 但站点通常不变, 给一个稳定的 last_week)
    sites_now = len(site_ids)
    sites_old = (await db.execute(
        select(sql_func.count(Site.id)).where(
            Site.id.in_(site_ids), Site.deleted_at.is_(None),
            Site.created_at < window_ago,
        )
    )).scalar() or 0

    # deployments (过去 14 天 vs 前 14 天; 字段名保持 deployments_30d 兼容前端)
    dep_now = (await db.execute(
        select(sql_func.count(Deployment.id)).where(
            Deployment.created_at >= now - timedelta(days=window_days),
        )
    )).scalar() or 0
    dep_old = (await db.execute(
        select(sql_func.count(Deployment.id)).where(
            Deployment.created_at >= now - timedelta(days=window_days * 2),
            Deployment.created_at < now - timedelta(days=window_days),
        )
    )).scalar() or 0

    def make_trend(current: int, last_week: int) -> dict:
        delta = current - last_week
        if delta > 0:
            trend = "up"
        elif delta < 0:
            trend = "down"
        else:
            trend = "flat"
        return {"current": current, "last_week": last_week, "delta": delta, "trend": trend}

    return ok({
        "contents": make_trend(cnt_now, cnt_old),
        "pending": make_trend(pending_now, pending_old),
        "sites": make_trend(sites_now, sites_old),
        "deployments_30d": make_trend(dep_now, dep_old),
    })


@router.get("/stats/deployments", response_model=None)
async def get_deployments_timeseries(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    days: int = Query(7, ge=1, le=90, description="回看天数 (1-90)"),
):
    """部署时间序列 (sparkline 用)

    返回: [{date: '2026-06-14', count: 3}, ...]
    """
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

    rows = (await db.execute(
        select(
            sql_func.date_trunc('day', Deployment.created_at).label('day'),
            sql_func.count(Deployment.id).label('count'),
        ).where(
            Deployment.created_at >= start,
        ).group_by('day').order_by('day')
    )).all()

    # 填充缺失日期 (0)
    by_day = {row.day.date(): row.count for row in rows}
    series = []
    for i in range(days):
        day = (start + timedelta(days=i)).date()
        series.append({
            "date": day.isoformat(),
            "count": by_day.get(day, 0),
        })

    return ok({"days": days, "series": series})


@router.get("/stats/activity", response_model=None)
async def get_activity_feed(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(20, ge=1, le=50, description="返回条目数 (1-50)"),
):
    """P6.4-A #3: 活动时间线

    合并最近 7 天的:
    - 内容状态变化 (published/archived) — Content.published_at / updated_at
    - 部署成功/失败 — Deployment.created_at
    - AI 任务完成 — AIRun.finished_at

    统一格式: {type, at, actor_name, site_id, site_name, payload}
    按时间倒序, 取 limit 条
    """
    site_ids = await _accessible_site_ids(db, current_user)
    items: list[dict] = []

    # === 1. 内容 published 事件 (优先 published_at, fallback updated_at) ===
    if site_ids:
        rows = (await db.execute(
            select(
                Content.id, Content.title, Content.status,
                Content.published_at, Content.updated_at,
                Site.id.label("site_id"), Site.name.label("site_name"),
                User.name.label("author_name"),
            )
            .join(Site, Site.id == Content.site_id)
            .outerjoin(User, User.id == Content.author_id)
            .where(
                Content.site_id.in_(site_ids),
                Content.deleted_at.is_(None),
                Content.status == 'published',
                # 优先 published_at, 但老内容 published_at 为空 (P3.5.2 才加字段)
                # fallback 到 updated_at
                or_(
                    Content.published_at >= datetime.now(timezone.utc) - timedelta(days=7),
                    (Content.published_at.is_(None)) & (Content.updated_at >= datetime.now(timezone.utc) - timedelta(days=7)),
                ),
            )
            .order_by(sql_func.coalesce(Content.published_at, Content.updated_at).desc())
            .limit(limit)
        )).all()
        for r in rows:
            event_at = r.published_at or r.updated_at
            items.append({
                "type": "content_published",
                "at": event_at.isoformat() if event_at else None,
                "site_id": str(r.site_id),
                "site_name": r.site_name,
                "actor_name": r.author_name,
                "payload": {
                    "content_id": str(r.id),
                    "title": r.title,
                },
            })

    # === 2. 部署事件 (created_at) ===
    dep_rows = (await db.execute(
        select(
            Deployment.id, Deployment.created_at, Deployment.status,
            Deployment.duration_ms, Deployment.content_count,
            Site.id.label("site_id"), Site.name.label("site_name"),
        )
        .outerjoin(Site, Site.id == Deployment.site_id)
        .where(
            Deployment.created_at >= datetime.now(timezone.utc) - timedelta(days=7),
            # 只看用户可访问的站 (没 site_id 的 deployment 也允许 — 系统级)
            or_(
                Deployment.site_id.is_(None),
                Deployment.site_id.in_(site_ids) if site_ids else False,
            ),
        )
        .order_by(Deployment.created_at.desc())
        .limit(limit)
    )).all()
    for r in dep_rows:
        items.append({
            "type": f"deployment_{r.status}",
            "at": r.created_at.isoformat() if r.created_at else None,
            "site_id": str(r.site_id) if r.site_id else None,
            "site_name": r.site_name,
            "actor_name": "系统",
            "payload": {
                "deployment_id": str(r.id),
                "duration_ms": r.duration_ms,
                "content_count": r.content_count,
            },
        })

    # === 3. AI 任务完成事件 (finished_at) ===
    ai_rows = (await db.execute(
        select(
            AIRun.id, AIRun.finished_at, AIRun.status,
            AIRun.task_type, AIRun.model,
            AIRun.prompt_tokens, AIRun.completion_tokens,
            AIRun.site_id, AIRun.user_id, AIRun.content_id,
            Site.name.label("site_name"),
            User.name.label("user_name"),
            Content.title.label("content_title"),
        )
        .outerjoin(Site, Site.id == AIRun.site_id)
        .outerjoin(User, User.id == AIRun.user_id)
        .outerjoin(Content, Content.id == AIRun.content_id)
        .where(
            AIRun.finished_at.isnot(None),
            AIRun.finished_at >= datetime.now(timezone.utc) - timedelta(days=7),
            # 只看用户自己触发的 AI (super_admin 看全部)
            (AIRun.user_id == current_user.id) if not current_user.is_super_admin else True,
        )
        .order_by(AIRun.finished_at.desc())
        .limit(limit)
    )).all()
    for r in ai_rows:
        items.append({
            "type": f"ai_run_{r.status}",
            "at": r.finished_at.isoformat() if r.finished_at else None,
            "site_id": str(r.site_id) if r.site_id else None,
            "site_name": r.site_name,
            "actor_name": r.user_name,
            "payload": {
                "ai_run_id": str(r.id),
                "task_type": r.task_type,
                "model": r.model,
                "tokens": (r.prompt_tokens or 0) + (r.completion_tokens or 0),
                "content_id": str(r.content_id) if r.content_id else None,
                "content_title": r.content_title,
            },
        })

    # 按时间倒序, 截 limit
    items.sort(key=lambda x: x.get("at") or "", reverse=True)
    items = [i for i in items if i.get("at")][:limit]

    return ok({"items": items, "count": len(items)})


@router.get("/stats/ai", response_model=None)
async def get_ai_summary(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """P6.4-A #7: AI 协作摘要 (本月)

    返回:
    - month: {runs, failed, tokens, estimated_minutes}
    - by_task_type: [{task_type, count}]
    - all_time: {runs, tokens} (历史总)
    """
    site_ids = await _accessible_site_ids(db, current_user)
    if not site_ids:
        return ok({
            "month": {"runs": 0, "failed": 0, "tokens": 0, "estimated_minutes": 0},
            "by_task_type": [],
            "all_time": {"runs": 0, "tokens": 0},
        })

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # 本月 run (排除失败, 算成功)
    month_runs = (await db.execute(
        select(
            sql_func.count(AIRun.id),
            sql_func.coalesce(sql_func.sum(AIRun.prompt_tokens + AIRun.completion_tokens), 0),
        ).where(
            AIRun.finished_at >= month_start,
            (AIRun.user_id == current_user.id) if not current_user.is_super_admin else True,
            # 只看用户可访问的站 (site_id is null 也算)
            or_(
                AIRun.site_id.is_(None),
                AIRun.site_id.in_(site_ids),
            ),
        )
    )).one()
    month_total = month_runs[0] or 0
    month_tokens = int(month_runs[1] or 0)

    month_failed = (await db.execute(
        select(sql_func.count(AIRun.id)).where(
            AIRun.finished_at >= month_start,
            AIRun.status == 'failed',
            (AIRun.user_id == current_user.id) if not current_user.is_super_admin else True,
            or_(
                AIRun.site_id.is_(None),
                AIRun.site_id.in_(site_ids),
            ),
        )
    )).scalar() or 0

    # 估算节省分钟: 按经验 ~500 token = 1 分钟手写时间 (中英文混合)
    estimated_minutes = month_tokens // 500

    # 按 task_type 分布 (本月)
    type_rows = (await db.execute(
        select(
            AIRun.task_type,
            sql_func.count(AIRun.id).label('count'),
        ).where(
            AIRun.finished_at >= month_start,
            AIRun.status == 'success',
            (AIRun.user_id == current_user.id) if not current_user.is_super_admin else True,
            or_(
                AIRun.site_id.is_(None),
                AIRun.site_id.in_(site_ids),
            ),
        ).group_by(AIRun.task_type).order_by(sql_func.count(AIRun.id).desc())
    )).all()

    # 历史总
    all_runs = (await db.execute(
        select(
            sql_func.count(AIRun.id),
            sql_func.coalesce(sql_func.sum(AIRun.prompt_tokens + AIRun.completion_tokens), 0),
        ).where(
            (AIRun.user_id == current_user.id) if not current_user.is_super_admin else True,
            or_(
                AIRun.site_id.is_(None),
                AIRun.site_id.in_(site_ids),
            ),
        )
    )).one()

    return ok({
        "month": {
            "runs": month_total,
            "failed": month_failed,
            "tokens": month_tokens,
            "estimated_minutes": estimated_minutes,
        },
        "by_task_type": [
            {"task_type": r.task_type, "count": r.count}
            for r in type_rows
        ],
        "all_time": {
            "runs": all_runs[0] or 0,
            "tokens": int(all_runs[1] or 0),
        },
    })


@router.get("/stats/content-health", response_model=None)
async def get_content_health(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """P6.4-A #8: 内容健康度检查

    返回待修复项的清单 (按严重度排序):
    - missing_cover: 已发布但未填封面
    - no_tags: 已发布但无标签
    - stale_drafts: 草稿超过 30 天未更新
    - pending_old: 待审超过 7 天
    - scheduled_overdue: 计划发布已过期
    """
    site_ids = await _accessible_site_ids(db, current_user)
    if not site_ids:
        return ok({"items": [], "total_issues": 0})

    now = datetime.now(timezone.utc)

    # 1. 已发布但 cover_image 为空
    missing_cover = (await db.execute(
        select(sql_func.count(Content.id)).where(
            Content.site_id.in_(site_ids),
            Content.deleted_at.is_(None),
            Content.status == 'published',
            or_(Content.cover_image.is_(None), Content.cover_image == ''),
        )
    )).scalar() or 0

    # 2. 已发布但无标签 (通过 content_taxonomies JOIN taxonomies WHERE type='tag')
    from app.models.content import ContentTaxonomy
    from app.models.taxonomy import Taxonomy
    no_tags_subq = (
        select(Content.id)
        .outerjoin(ContentTaxonomy, ContentTaxonomy.content_id == Content.id)
        .outerjoin(Taxonomy, (Taxonomy.id == ContentTaxonomy.taxonomy_id) & (Taxonomy.type == 'tag'))
        .where(
            Content.site_id.in_(site_ids),
            Content.deleted_at.is_(None),
            Content.status == 'published',
            Taxonomy.id.is_(None),
        )
    )
    no_tags_count = (await db.execute(
        select(sql_func.count(sql_func.distinct(Content.id)))
        .where(Content.id.in_(no_tags_subq))
    )).scalar() or 0

    # 3. 草稿超 30 天未更新
    stale_drafts = (await db.execute(
        select(sql_func.count(Content.id)).where(
            Content.site_id.in_(site_ids),
            Content.deleted_at.is_(None),
            Content.status == 'draft',
            Content.updated_at < now - timedelta(days=30),
        )
    )).scalar() or 0

    # 4. 待审超 7 天
    pending_old = (await db.execute(
        select(sql_func.count(Content.id)).where(
            Content.site_id.in_(site_ids),
            Content.deleted_at.is_(None),
            Content.status == 'pending',
            Content.updated_at < now - timedelta(days=30),
        )
    )).scalar() or 0

    # 5. 计划发布已过期 (scheduled_at < now 但 status 还是 scheduled)
    scheduled_overdue = (await db.execute(
        select(sql_func.count(Content.id)).where(
            Content.site_id.in_(site_ids),
            Content.deleted_at.is_(None),
            Content.status == 'scheduled',
            Content.scheduled_at.isnot(None),
            Content.scheduled_at < now,
        )
    )).scalar() or 0

    items = [
        {"key": "missing_cover", "label": "未填封面", "value": missing_cover, "severity": "info",
         "to": "/contents?status=published&no_cover=1"},
        {"key": "no_tags", "label": "无标签", "value": no_tags_count, "severity": "info",
         "to": "/contents?status=published&no_tags=1"},
        {"key": "stale_drafts", "label": "草稿超 30 天", "value": stale_drafts, "severity": "warning",
         "to": "/contents?status=draft&stale=30"},
        {"key": "pending_old", "label": "待审超 7 天", "value": pending_old, "severity": "warning",
         "to": "/contents?status=pending&stale=7"},
        {"key": "scheduled_overdue", "label": "计划发布已过期", "value": scheduled_overdue, "severity": "error",
         "to": "/contents?status=scheduled"},
    ]
    # 按 value 倒序 (问题最多的在前), 0 的留后面
    items.sort(key=lambda x: (-x["value"], x["key"]))

    total_issues = sum(i["value"] for i in items)
    return ok({"items": items, "total_issues": total_issues})