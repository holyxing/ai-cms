"""站内通知写入助手"""
from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.content import Content
from app.models.deployment import Deployment
from app.models.site import Site
from app.models.user_notification import UserNotification


def _fmt_duration(ms: int | None) -> str:
    if ms is None or ms < 0:
        return "—"
    sec = ms / 1000.0
    if sec < 10:
        return f"{sec:.1f} 秒"
    return f"{int(round(sec))} 秒"


async def create_notification(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    title: str,
    body: str | None = None,
    link: str | None = None,
    level: str = "info",
    kind: str | None = None,
    duration_ms: int | None = None,
) -> UserNotification | None:
    """写入一条站内通知。level: success | error | info | warning"""
    if not user_id:
        return None
    n = UserNotification(
        user_id=user_id,
        title=(title or "")[:200],
        body=body,
        link=(link or None) and link[:500],
        level=(level or "info")[:20],
        kind=(kind or None) and kind[:64],
        duration_ms=duration_ms,
    )
    db.add(n)
    await db.flush()
    return n


async def notify_publish_finished(
    db: AsyncSession,
    deployment: Deployment,
    *,
    skip_if_retrying: bool = False,
) -> UserNotification | None:
    """静态发布终态 → 给 trigger_user 写一条消息。

    skip_if_retrying: 站点全量发布首次失败会自动重试时跳过，避免刷屏。
    """
    if skip_if_retrying:
        return None
    if not deployment.trigger_user_id:
        return None
    if deployment.status not in ("success", "failed"):
        return None

    site = await db.get(Site, deployment.site_id)
    site_name = site.name if site else "未知站点"
    scope = deployment.scope or "site"
    ok = deployment.status == "success"
    level = "success" if ok else "error"
    dur = deployment.duration_ms
    dur_text = _fmt_duration(dur)

    target_label = site_name
    scope_label = "整站"
    link = f"/sites/{deployment.site_id}/deploy-log"

    if scope == "category" and deployment.scope_id:
        cat = await db.get(Category, deployment.scope_id)
        target_label = cat.name if cat else str(deployment.scope_id)[:8]
        scope_label = "栏目"
        if cat:
            link = f"/c/{cat.id}"
    elif scope == "content" and deployment.scope_id:
        content = await db.get(Content, deployment.scope_id)
        target_label = content.title if content else str(deployment.scope_id)[:8]
        scope_label = "文章"
        if content:
            link = f"/contents/{content.id}"

    result_text = "成功" if ok else "失败"
    title = f"{scope_label}发布{result_text} · {target_label}"[:200]

    lines = [
        f"站点：{site_name}",
        f"对象：{scope_label}「{target_label}」",
        f"结果：{result_text}",
        f"耗时：{dur_text}",
    ]
    if deployment.content_count is not None:
        if scope == "site":
            lines.insert(2, f"内容：写入 {deployment.content_count} 篇快照")
        else:
            lines.insert(2, f"内容：生成 {deployment.content_count} 个页面")
    if not ok and deployment.error_message:
        err = deployment.error_message.strip().splitlines()[0][:200]
        lines.append(f"原因：{err}")

    return await create_notification(
        db,
        user_id=deployment.trigger_user_id,
        title=title,
        body="\n".join(lines),
        link=link,
        level=level,
        kind=f"publish.{scope}",
        duration_ms=dur,
    )
