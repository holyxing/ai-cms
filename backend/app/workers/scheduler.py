"""P3.5 状态机定时任务 - scheduled → published

依据: docs/05-开发路线图.md P3.5 (状态机) + docs/12-P2-决策.md §C2 (5 态)

每分钟跑一次, 扫描 status=scheduled AND scheduled_at <= now() 的内容
自动转为 published, 记录 published_at = now()。

注意:
- 这是"系统级"转换, 不走状态机权限 (只允许 scheduled → published 单向)
- 不调用 publish 端点的状态机 (因为端点校验 from=allowed, 同样允许)
- 不发 SSE/通知 (P4 范围)
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from sqlalchemy import select, update

from app.workers.celery_app import celery_app
from app.db.session import AsyncSessionLocal
from app.models.content import Content


@celery_app.task(
    name="app.workers.scheduler.promote_scheduled",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    soft_time_limit=50,
    time_limit=55,
)
def promote_scheduled_contents(self) -> dict:
    """每分钟跑 (Celery Beat 调度)

    Returns: {"promoted": n, "checked_at": iso}
    """
    return _run_with_loop()


def _run_with_loop() -> dict:
    """独立 event loop 跑 async (与 publish 任务同样的处置)

    关键: 任务完成后必须 dispose 一次, 关闭所有 asyncpg 连接, 再 close loop,
    避免连接延后 GC 时 loop 已关报 'Event loop is closed'
    """
    from app.db.session import engine
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        # 丢掉 worker 启动时创建的旧连接池
        try:
            loop.run_until_complete(engine.dispose())
        except Exception:
            pass
        result = loop.run_until_complete(_promote_async())
        # 任务完成后再次 dispose, 主动关闭连接
        try:
            loop.run_until_complete(engine.dispose())
        except Exception:
            pass
        return result
    finally:
        loop.close()


async def _promote_async() -> dict:
    """真正实现: scheduled AND scheduled_at <= now() → published"""
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        # 找出所有待发布的
        r = await db.execute(
            select(Content).where(
                Content.status == "scheduled",
                Content.scheduled_at.isnot(None),
                Content.scheduled_at <= now,
                Content.deleted_at.is_(None),
            )
        )
        targets = r.scalars().all()
        if not targets:
            return {"promoted": 0, "checked_at": now.isoformat()}

        # 批量更新
        ids = [c.id for c in targets]
        await db.execute(
            update(Content)
            .where(Content.id.in_(ids))
            .values(status="published", published_at=now, scheduled_at=None)
        )
        await db.commit()

        return {
            "promoted": len(ids),
            "ids": [str(i) for i in ids],
            "checked_at": now.isoformat(),
        }
