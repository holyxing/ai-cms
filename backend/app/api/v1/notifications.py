"""用户通知 API

GET    /api/v1/notifications?unread=1&page=1&page_size=50
PATCH  /api/v1/notifications/{id}/read
POST   /api/v1/notifications/read-all
DELETE /api/v1/notifications/{id}
DELETE /api/v1/notifications  (清空我的全部)
"""
from datetime import datetime, timezone
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.exceptions import NotFound
from app.core.responses import ok
from app.db.session import get_db
from app.models.user_notification import UserNotification

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _to_out(n: UserNotification) -> dict:
    return {
        "id": str(n.id),
        "title": n.title,
        "body": n.body,
        "link": n.link,
        "level": n.level or "info",
        "kind": n.kind,
        "duration_ms": n.duration_ms,
        "read_at": n.read_at.isoformat() if n.read_at else None,
        "created_at": n.created_at.isoformat(),
    }


@router.get("", response_model=None)
async def list_notifications(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    unread: Optional[int] = Query(None, description="1 = 仅未读"),
    level: Optional[str] = Query(None, description="success|error|info|warning"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
):
    base = select(UserNotification).where(UserNotification.user_id == current_user.id)
    count_q = select(func.count()).select_from(UserNotification).where(
        UserNotification.user_id == current_user.id
    )
    if unread == 1:
        base = base.where(UserNotification.read_at.is_(None))
        count_q = count_q.where(UserNotification.read_at.is_(None))
    if level in ("success", "error", "info", "warning"):
        base = base.where(UserNotification.level == level)
        count_q = count_q.where(UserNotification.level == level)
    total = int((await db.execute(count_q)).scalar() or 0)
    q = base.order_by(UserNotification.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    items = (await db.execute(q)).scalars().all()
    unread_count = int((await db.execute(
        select(func.count()).select_from(UserNotification).where(
            UserNotification.user_id == current_user.id,
            UserNotification.read_at.is_(None),
        )
    )).scalar() or 0)
    return ok({
        "items": [_to_out(n) for n in items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "unread_count": unread_count,
    })


@router.patch("/{notification_id}/read", response_model=None)
async def mark_read(
    notification_id: UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    n = await db.get(UserNotification, notification_id)
    if n is None or n.user_id != current_user.id:
        raise NotFound("通知不存在")
    if n.read_at is None:
        n.read_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(n)
    return ok(_to_out(n))


@router.post("/read-all", response_model=None)
async def mark_all_read(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    now = datetime.now(timezone.utc)
    await db.execute(
        update(UserNotification)
        .where(
            UserNotification.user_id == current_user.id,
            UserNotification.read_at.is_(None),
        )
        .values(read_at=now)
    )
    await db.commit()
    return ok({"ok": True})


@router.delete("/{notification_id}", response_model=None)
async def delete_notification(
    notification_id: UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    n = await db.get(UserNotification, notification_id)
    if n is None or n.user_id != current_user.id:
        raise NotFound("通知不存在")
    await db.delete(n)
    await db.commit()
    return ok({"ok": True})


@router.delete("", response_model=None)
async def clear_notifications(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    r = await db.execute(
        delete(UserNotification).where(UserNotification.user_id == current_user.id)
    )
    await db.commit()
    return ok({"ok": True, "deleted": r.rowcount or 0})
