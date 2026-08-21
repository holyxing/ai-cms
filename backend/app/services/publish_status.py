"""P2.6: 站点 publish_status 计算 (单一权威)

依据: 用户要求 2026-06-05

枚举 (sites.publish_status):
- never_published   从未发布
- building          有正在 pending/building 的 deployment
- published         最新一次 deployment = success
- failed            最新一次 deployment = failed, 且没有更早的 success
- out_of_sync        已发布过, 但站点有未发布的草稿/修改 (P2.6 暂不实现)

使用方:
- workers/publish.py: deployment 终态时调用 recompute_and_persist
- api/v1/sites.py: 列表/详情用 compute_for_sites 批量补 (懒加载兜底)
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.deployment import Deployment
from app.models.site import Site

# P3.6.4+: 1h 外的 pending 视为孤儿 (worker 崩溃/异常退出没标终态), 忽略
ORPHAN_THRESHOLD_MINUTES = 60

# === 状态常量 ===
NEVER_PUBLISHED = "never_published"
BUILDING = "building"
PUBLISHED = "published"
FAILED = "failed"
OUT_OF_SYNC = "out_of_sync"  # P2.6 暂不触发, 仅预留 enum

ALL_STATUSES = (NEVER_PUBLISHED, BUILDING, PUBLISHED, FAILED, OUT_OF_SYNC)


async def compute_for_site(db: AsyncSession, site_id: uuid.UUID) -> str:
    """计算单个站点的 publish_status (不写库)

    规则 (按优先级):
    1. 有任何 pending/building 的 deployment → building
    2. 取最新一次终态 deployment:
       - success → published
       - failed / cancelled → failed (若此前还有 success 算 published 更友好, 这里取严格 latest)
    3. 没有任何 deployment → never_published
    """
    # 1. 检查是否有正在跑的 (1h 内的才信, 1h 外的当孤儿)
    from datetime import datetime, timezone, timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=ORPHAN_THRESHOLD_MINUTES)
    in_flight_q = (
        select(Deployment.id)
        .where(
            Deployment.site_id == site_id,
            Deployment.status.in_(("pending", "building")),
        )
        .limit(20)
    )
    in_flight_rows = (await db.execute(in_flight_q)).all()
    for (did,) in in_flight_rows:
        d = await db.get(Deployment, did)
        if d and d.created_at and d.created_at >= cutoff:
            return BUILDING

    # 2. 取最新一条终态 deployment
    latest_q = (
        select(Deployment.status)
        .where(
            Deployment.site_id == site_id,
        )
        .order_by(Deployment.created_at.desc())
        .limit(1)
    )
    latest_status = (await db.execute(latest_q)).scalar_one_or_none()
    if latest_status is None:
        return NEVER_PUBLISHED
    if latest_status == "success":
        return PUBLISHED
    # failed / cancelled
    return FAILED


async def recompute_and_persist(db: AsyncSession, site_id: uuid.UUID) -> str:
    """重算并写回 sites.publish_status

    worker 在 deployment 进入终态 (success/failed/cancelled) 时调用
    """
    new_status = await compute_for_site(db, site_id)
    site = await db.get(Site, site_id)
    if site is None:
        return new_status
    if site.publish_status != new_status:
        site.publish_status = new_status
        await db.commit()
    return new_status


async def compute_for_sites(
    db: AsyncSession, site_ids: list[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """批量算 (懒加载兜底用, 不写库)

    性能: 对每个 site_id 跑两条小查询 (in-flight + latest)
    N<=100 时可接受, 列表分页 page_size<=100 已限制
    """
    out: dict[uuid.UUID, str] = {}
    for sid in site_ids:
        out[sid] = await compute_for_site(db, sid)
    return out
