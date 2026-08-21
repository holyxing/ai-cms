"""发布管理 API (P2)

依据:
- docs/04b-数据模型.md §4.3-4.4
- docs/12-P2-决策.md §B6 (全量构建) + §C4 (后台任务) + §C5 (回滚软链) + §E1-E4 (超时/重试/日志)

端点 (URL 前缀 /api/v1):
- POST   /sites/{site_id}/publish                触发发布 (202 + deployment_id)
- GET    /sites/{site_id}/publish/jobs           发布历史 (分页)
- GET    /publish/jobs/{deployment_id}           单个 deployment 详情 (轮询)
- POST   /sites/{site_id}/publish/rollback       回滚到旧 deployment

P2 范围: API 完整实现 + 同步跑"轻量"路径 (Day 3 接入 Celery + Astro build)。
本期 publish 同步动作: 创建 deployment → 标记 success → 写入占位 artifact_path + 0 content_count。
Day 3 接 Celery 后改为: 创建 deployment → 状态 pending → worker 跑 build → 状态 success/failed。
"""
import asyncio  # noqa: F401  # Day 3 异步改用
import uuid
import logging
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.exceptions import BadRequest, Forbidden, NotFound
from app.core.ratelimit import limiter as _limiter  # P4.2: 限流
from app.core.responses import ok, page_resp
from app.db.session import get_db
from app.models.content_snapshot import ContentSnapshot
from app.models.category import Category
from app.models.content import Content, ContentVersion
from app.models.deployment import Deployment
from app.models.membership import SiteMember
from app.models.site import Site
from app.models.theme_version import ThemeVersion
from app.models.user import User
from app.schemas.deployment import (
    DeploymentCreate,
    DeploymentJobAccepted,
    DeploymentListItem,
    DeploymentRead,
    DeploymentRollback,
    RecentDeployment,
    CategoryPublishCreate,
    ContentPublishCreate,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["publish"])


# === 权限辅助 (同 themes.py) ===
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


async def _get_site(db: AsyncSession, site_id: uuid.UUID) -> Site:
    site = await db.get(Site, site_id)
    if site is None or site.deleted_at is not None:
        raise NotFound("站点不存在")
    return site


def _to_read(d: Deployment) -> DeploymentRead:
    return DeploymentRead.model_validate(d)


def _to_list_item(d: Deployment) -> DeploymentListItem:
    return DeploymentListItem(
        id=d.id, status=d.status, triggered_by=d.triggered_by,
        duration_ms=d.duration_ms, content_count=d.content_count,
        artifact_size=d.artifact_size, retry_count=d.retry_count,
        error_message=d.error_message, created_at=d.created_at,
        finished_at=d.finished_at,
    )


async def _resolve_theme_version_id(
    db: AsyncSession,
    site_id: uuid.UUID,
    tv_id: uuid.UUID | None,
) -> uuid.UUID | None:
    """解析本次发布用的 theme_version。

    布局系统可独立出静态页，无主题时允许 None（worker 用空 tokens）。
    """
    if tv_id is None:
        r = await db.execute(
            select(ThemeVersion).where(
                ThemeVersion.site_id == site_id,
                ThemeVersion.is_active.is_(True),
            )
        )
        tv = r.scalar_one_or_none()
        return tv.id if tv else None
    tv = await db.get(ThemeVersion, tv_id)
    if tv is None or tv.site_id != site_id:
        raise BadRequest("theme_version_id 不存在")
    return tv.id


# === 同步"轻量"发布路径 (Day 3 接 Celery 后改异步) ===
async def _run_publish_sync(db: AsyncSession, deployment: Deployment, site: Site) -> None:
    """P2 范围内的同步实现:
    1. 标记 building
    2. 拉所有 published 内容, 写入 content_snapshots
    3. 标记 success + 写 artifact_path
    4. 失败 → 标记 failed + 写 error_message
    """
    try:
        deployment.status = "building"
        deployment.started_at = datetime.now(timezone.utc)
        await db.flush()
        # 拉 published 内容
        r = await db.execute(
            select(Content).where(
                Content.site_id == site.id, Content.status == "published", Content.deleted_at.is_(None)
            )
        )
        contents = r.scalars().all()
        # 写 snapshot
        for c in contents:
            # 检查是否已存在 (避免重复)
            exist = (await db.execute(
                select(ContentSnapshot).where(
                    ContentSnapshot.content_id == c.id,
                    ContentSnapshot.deployment_id == deployment.id,
                )
            )).scalar_one_or_none()
            if exist:
                continue
            # body 从最新 version 读 (优先 published_version_id, 否则最新)
            body_html = ""
            version = None
            if c.published_version_id:
                version = await db.get(ContentVersion, c.published_version_id)
            if version is None:
                # 拿最新 version
                r2 = await db.execute(
                    select(ContentVersion)
                    .where(ContentVersion.content_id == c.id)
                    .order_by(ContentVersion.version_num.desc())
                    .limit(1)
                )
                version = r2.scalar_one_or_none()
            if version is None:
                # content 没 version 记录, 跳过
                continue
            body_html = version.body or ""
            # body 解析: ContentVersion.body 是 Tiptap HTML 字符串
            import json as _json
            body_json = {}
            if body_html and body_html.strip().startswith("{"):
                try:
                    body_json = _json.loads(body_html)
                except Exception:
                    body_json = {}
            db.add(ContentSnapshot(
                content_id=c.id, deployment_id=deployment.id,
                version_id=version.id,
                title=c.title, slug=c.slug,
                body_html=body_html, body_json=body_json,
                taxonomy_paths={}, published_at=c.published_at or datetime.now(timezone.utc),
            ))
        # 标记 success
        deployment.status = "success"
        deployment.finished_at = datetime.now(timezone.utc)
        deployment.duration_ms = int((deployment.finished_at - deployment.started_at).total_seconds() * 1000)
        deployment.content_count = len(contents)
        deployment.artifact_path = f"/data/sites/{site.slug}/public"
        deployment.artifact_size = 0  # 真实构建才有
        deployment.build_log = f"[P2 sync mode] wrote {len(contents)} content snapshots\nDay 3: switch to celery + astro build"
        await db.commit()
    except Exception as e:
        deployment.status = "failed"
        deployment.finished_at = datetime.now(timezone.utc)
        deployment.error_message = str(e)[:1000]
        await db.commit()
        raise


# === 1. 触发发布 ===
@router.post("/sites/{site_id}/publish", response_model=None, status_code=202)
@_limiter.limit("5/minute")  # P4.2: 全站发布很贵, 防止滥用
async def trigger_publish(
    request: Request,  # P4.2: slowapi 限流需要
    site_id: uuid.UUID,
    body: DeploymentCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """触发发布 (P2: 同步轻量, Day 3: Celery 异步)"""
    site = await _get_site(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if role not in ("owner", "editor"):
        raise Forbidden("需要 owner/editor 权限")
    # 主题可选：ZIP 导入只生成布局，未 apply 主题时仍可发布
    tv_id = await _resolve_theme_version_id(db, site_id, body.theme_version_id)
    # P3.6.4: 发布前资源检查
    from app.services.publish_precheck import check_missing_assets_for_site_publish
    if not body.force:
        missing = await check_missing_assets_for_site_publish(db, site_id)
        if missing:
            from app.core.exceptions import Unprocessable
            raise Unprocessable(
                message=f"模板引用了 {len(missing)} 个未上传的资源, 发布会导致 404。\n"
                        f"上传资源后再发布, 或设 force=true 强制发布。",
                data={
                    "missing": [m.to_dict() for m in missing],
                    "hint": "传 body.force=true 跳过检查",
                },
            )
    # 创建 deployment
    d = Deployment(
        site_id=site_id, theme_version_id=tv_id,
        status="pending", triggered_by=body.triggered_by,
        trigger_user_id=current_user.id,
    )
    db.add(d)
    await db.commit()
    await db.refresh(d)
    # Day 3: Celery 异步 (C4 决策: 202 Accepted + 前端轮询)
    try:
        # 导人 task (避免 startup 时加载重)
        from app.workers.publish import run_publish
        run_publish.delay(str(d.id))
        logger.info("publish task enqueued: deployment=%s site=%s user=%s", d.id, site_id, current_user.id)
    except Exception as e:
        # 任务入队失败不阻塞用户 (部署记录仍建), 标记为 failed
        d.status = "failed"
        d.error_message = f"Celery 入队失败: {e}"
        await db.commit()
        logger.exception("publish task enqueue failed: deployment=%s", d.id)
    await db.refresh(d)
    return ok(DeploymentJobAccepted(
        deployment_id=d.id, status=d.status,
        message="发布任务已入队, 前端轮询详情" if d.status == "pending" else f"入队失败: {d.error_message}"
    ).model_dump(mode="json"))


# === 2. 发布历史 ===
@router.get("/sites/{site_id}/publish/jobs", response_model=None)
async def list_publish_jobs(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    status: Annotated[str | None, Query(description="pending|building|success|failed|cancelled")] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    """发布历史列表 (分页)"""
    site = await _get_site(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if role is None:
        raise Forbidden("无权访问该站点")
    base_q = select(Deployment).where(Deployment.site_id == site_id)
    if status:
        base_q = base_q.where(Deployment.status == status)
    total = (await db.execute(select(func.count()).select_from(base_q.subquery()))).scalar_one()
    items = (await db.execute(
        base_q.order_by(Deployment.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return page_resp([_to_list_item(d) for d in items], total=total, page=page, page_size=page_size)


# === 2.5 跨站: Dashboard 最新发布 (P3.9.5+ holy 反馈)
# 返回用户可访问的所有站点的最新成功发布, 供 Dashboard top 卡片使用
@router.get("/deployments/recent", response_model=None)
async def list_recent_deployments(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(default=3, ge=1, le=20),
    site_id: Annotated[uuid.UUID | None, Query(description="可选, 限定单站")] = None,
) -> dict[str, Any]:
    """跨站最近发布列表 (Dashboard 专用)

    权限: 跟 list_publish_jobs 一样, 仅返回用户可访问的站点.
    super_admin 看全部; 其他用户仅看自己 owner 或 member 的站.

    Returns: { data: [RecentDeployment, ...], total: int }
    """
    # 1. 先拿到可访问的 site_id 列表
    if current_user.is_super_admin:
        site_ids_q = select(Site.id)
    else:
        site_ids_q = select(Site.id).where(Site.owner_id == current_user.id)
        # 加上 member 关系
        member_site_ids = select(SiteMember.site_id).where(
            SiteMember.user_id == current_user.id,
            SiteMember.deleted_at.is_(None),
        )
        site_ids_q = site_ids_q.union(member_site_ids)
    if site_id:
        site_ids_q = site_ids_q.where(Site.id == site_id)

    # 2. JOIN Site 查 deployment (避免 N+1)
    rows = (await db.execute(
        select(Deployment, Site)
        .join(Site, Deployment.site_id == Site.id)
        .where(Deployment.site_id.in_(site_ids_q.subquery()))
        .where(Deployment.status == "success")  # 只看成功的, 避免 pending/failed 杂讯
        .order_by(Deployment.finished_at.desc().nullslast(), Deployment.created_at.desc())
        .limit(limit)
    )).all()

    # 3. P3.9.6+ (holy 反馈 #12565): 批量查每站的根栏目 (parent_id IS NULL, 最早建的)
    # 用窗口函数一次查完, 避免 N+1
    site_ids_in_result = list({d.site_id for d, _ in rows})
    root_cat_by_site: dict[uuid.UUID, uuid.UUID] = {}
    if site_ids_in_result:
        from sqlalchemy import func
        # 按 site_id 分组, 取 created_at 最早的那个根栏目
        root_q = (
            select(
                Category.site_id,
                Category.id,
                func.row_number().over(
                    partition_by=Category.site_id,
                    order_by=Category.created_at.asc(),
                ).label("rn"),
            )
            .where(
                Category.site_id.in_(site_ids_in_result),
                Category.parent_id.is_(None),
                Category.deleted_at.is_(None),
            )
            .subquery()
        )
        cat_rows = (await db.execute(
            select(root_q.c.site_id, root_q.c.id).where(root_q.c.rn == 1)
        )).all()
        for sid, cid in cat_rows:
            root_cat_by_site[sid] = cid

    items = [
        RecentDeployment(
            id=d.id,
            site_id=d.site_id,
            site_slug=s.slug,
            site_name=s.name,
            status=d.status,
            triggered_by=d.triggered_by,
            duration_ms=d.duration_ms,
            content_count=d.content_count,
            artifact_size=d.artifact_size,
            root_category_id=root_cat_by_site.get(d.site_id),  # P3.9.6+
            created_at=d.created_at,
            finished_at=d.finished_at,
        )
        for d, s in rows
    ]
    return ok({"items": items, "total": len(items)})


# === 3. 单个 deployment 详情 (轮询) ===
@router.get("/publish/jobs/{deployment_id}", response_model=None)
async def get_publish_job(
    deployment_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """deployment 详情 (前端 2s 轮询)"""
    d = await db.get(Deployment, deployment_id)
    if d is None:
        raise NotFound("部署不存在")
    # 权限: 站点成员可看
    site = await _get_site(db, d.site_id)
    role = await _get_user_role(db, site, current_user)
    if role is None:
        raise Forbidden("无权访问该部署")
    return ok(_to_read(d).model_dump(mode="json"))


# === 4. 回滚 ===
@router.post("/sites/{site_id}/publish/rollback", response_model=None, status_code=201)
@_limiter.limit("5/minute")  # P4.2: 回滚也是 IO 重操作
async def rollback_publish(
    request: Request,  # P4.2: slowapi 限流需要
    site_id: uuid.UUID,
    body: DeploymentRollback,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """回滚: 创建新 deployment, artifact_path 软链到旧 deployment"""
    site = await _get_site(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if role not in ("owner", "editor"):
        raise Forbidden("需要 owner/editor 权限")
    target = await db.get(Deployment, body.target_deployment_id)
    if target is None or target.site_id != site_id:
        raise NotFound("目标部署不存在")
    if target.status != "success":
        raise BadRequest("只能回滚到成功的部署")
    # 创建新 deployment (status=success 立即完成)
    d = Deployment(
        site_id=site_id, theme_version_id=target.theme_version_id,
        status="success", triggered_by="rollback",
        trigger_user_id=current_user.id,
        started_at=datetime.now(timezone.utc),
        finished_at=datetime.now(timezone.utc),
        duration_ms=0, content_count=target.content_count,
        artifact_path=target.artifact_path,  # 软链 (Day 3 用 ln -s 实现)
        artifact_size=target.artifact_size,
        build_log=f"[rollback] to deployment {target.id}",
    )
    db.add(d)
    await db.commit()
    await db.refresh(d)
    return ok(_to_read(d).model_dump(mode="json"),
              message=f"已回滚到 {target.created_at:%Y-%m-%d %H:%M} 的部署")


# ============================================================
# P3.6.1+: 栏目级 / 文章级发布
# ============================================================

@router.post("/sites/{site_id}/categories/{category_id}/static-publish", response_model=None, status_code=202)
@_limiter.limit("10/minute")  # P4.2: 栏目级增量发布
async def trigger_publish_category(
    request: Request,  # P4.2: slowapi 限流需要
    site_id: uuid.UUID,
    category_id: uuid.UUID,
    body: CategoryPublishCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """触发栏目级发布 (只重 build 该栏目, 不动其他)

    与整站发布区别:
    - artifact_path 仍是整站目录 (build_and_write 整体写), 但 worker 只刷这个栏目页
    - artifact_size 仍按全量算 (因为是软增量, 文件复用)
    - scope='category', scope_id=category_id
    """
    from app.models.category import Category
    site = await _get_site(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if role not in ("owner", "editor"):
        raise Forbidden("需要 owner/editor 权限")
    # 校验 category 存在 + 属于该 site
    cat = await db.get(Category, category_id)
    if cat is None or cat.site_id != site_id or cat.deleted_at is not None:
        raise BadRequest("栏目不存在或不属于该站点")
    tv_id = await _resolve_theme_version_id(db, site_id, body.theme_version_id)
    # P3.6.4: 发布前资源检查
    from app.services.publish_precheck import check_missing_assets_for_category_publish
    if not body.force:
        missing = await check_missing_assets_for_category_publish(db, site_id, category_id)
        if missing:
            from app.core.exceptions import Unprocessable
            raise Unprocessable(
                message=f"栏目模板引用了 {len(missing)} 个未上传的资源, 发布会导致 404。\n"
                        f"上传资源后再发布, 或设 force=true 强制发布。",
                data={
                    "missing": [m.to_dict() for m in missing],
                    "hint": "传 body.force=true 跳过检查",
                },
            )
    # 发布栏目时，同时把该栏目及子栏目下的非 published 文章改为 published
    from sqlalchemy import update as _upd
    from app.models.content import Content
    # 收集当前栏目及所有子栏目 ID
    all_cats = (await db.execute(
        select(Category).where(Category.site_id == site_id, Category.deleted_at.is_(None))
    )).scalars().all()
    cat_ids: set[uuid.UUID] = {category_id}
    stack = [category_id]
    children_map: dict[uuid.UUID, list[uuid.UUID]] = {}
    for c in all_cats:
        if c.parent_id:
            children_map.setdefault(c.parent_id, []).append(c.id)
    while stack:
        cid = stack.pop()
        for child_id in children_map.get(cid, []):
            if child_id not in cat_ids:
                cat_ids.add(child_id)
                stack.append(child_id)
    now_utc = datetime.now(timezone.utc)
    await db.execute(
        _upd(Content)
        .where(
            Content.site_id == site_id,
            Content.category_id.in_(cat_ids),
            Content.deleted_at.is_(None),
            Content.status != "published",
        )
        .values(status="published", published_at=now_utc)
    )

    d = Deployment(
        site_id=site_id, theme_version_id=tv_id,
        status="pending", triggered_by=body.triggered_by,
        trigger_user_id=current_user.id,
        scope="category", scope_id=category_id,
    )
    db.add(d)
    await db.commit()
    await db.refresh(d)
    try:
        from app.workers.publish import run_publish_category
        run_publish_category.delay(str(d.id))
        logger.info("publish-category task enqueued: deployment=%s cat=%s", d.id, category_id)
    except Exception as e:
        d.status = "failed"
        d.error_message = f"Celery 入队失败: {e}"
        await db.commit()
    return ok(_to_read(d).model_dump(mode="json"), message=f"栏目 {cat.name} 发布任务已入队")


@router.post("/sites/{site_id}/contents/{content_id}/static-publish", response_model=None, status_code=202)
@_limiter.limit("10/minute")  # P4.2: 文章级增量发布
async def trigger_publish_content(
    request: Request,  # P4.2: slowapi 限流需要
    site_id: uuid.UUID,
    content_id: uuid.UUID,
    body: ContentPublishCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """触发文章级发布 (只重 build 该文章详情页, 含所属栏目列表重排)

    scope='content', scope_id=content_id
    """
    from app.models.content import Content
    site = await _get_site(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if role not in ("owner", "editor"):
        raise Forbidden("需要 owner/editor 权限")
    c = await db.get(Content, content_id)
    if c is None or c.site_id != site_id or c.deleted_at is not None:
        raise BadRequest("文章不存在或不属于该站点")
    if c.status != "published":
        raise BadRequest(f"文章未发布, 当前状态: {c.status}, 请先发布到 published 再触发静态发布")
    tv_id = await _resolve_theme_version_id(db, site_id, body.theme_version_id)
    # P3.6.4: 发布前资源检查
    from app.services.publish_precheck import check_missing_assets_for_content_publish
    if not body.force:
        missing = await check_missing_assets_for_content_publish(db, site_id, content_id)
        if missing:
            from app.core.exceptions import Unprocessable
            raise Unprocessable(
                message=f"详情页模板引用了 {len(missing)} 个未上传的资源, 发布会导致 404。\n"
                        f"上传资源后再发布, 或设 force=true 强制发布。",
                data={
                    "missing": [m.to_dict() for m in missing],
                    "hint": "传 body.force=true 跳过检查",
                },
            )
    d = Deployment(
        site_id=site_id, theme_version_id=tv_id,
        status="pending", triggered_by=body.triggered_by,
        trigger_user_id=current_user.id,
        scope="content", scope_id=content_id,
    )
    db.add(d)
    await db.commit()
    await db.refresh(d)
    try:
        from app.workers.publish import run_publish_content
        run_publish_content.delay(str(d.id))
        logger.info("publish-content task enqueued: deployment=%s content=%s", d.id, content_id)
    except Exception as e:
        d.status = "failed"
        d.error_message = f"Celery 入队失败: {e}"
        await db.commit()
    return ok(_to_read(d).model_dump(mode="json"), message=f"文章 {c.title} 发布任务已入队")
