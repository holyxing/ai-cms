"""站点级回收站 — 统一列出/还原/永久删除软删数据

覆盖: 文章(content) / 栏目(category) / 模板(layout) / 媒体(media)

资源(site_assets) 目前为硬删, 不进回收站。
"""
from __future__ import annotations

import uuid
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.exceptions import BadRequest, Conflict, Forbidden, NotFound
from app.core.responses import ok
from app.db.session import get_db
from app.models.category import Category
from app.models.content import Content
from app.models.layout import Layout, LayoutVersion
from app.models.media import Media, MediaRelation
from app.models.membership import SiteMember
from app.models.site import Site
from app.models.user import User

router = APIRouter(tags=["site-trash"])

TrashType = Literal["content", "category", "layout", "media"]
ALL_TYPES: tuple[TrashType, ...] = ("content", "category", "layout", "media")
TYPE_LABEL = {
    "content": "文章",
    "category": "栏目",
    "layout": "模板",
    "media": "媒体资源",
}


class TrashBatchItem(BaseModel):
    type: TrashType
    id: uuid.UUID


class TrashBatchRequest(BaseModel):
    action: Literal["restore", "permanent"]
    items: list[TrashBatchItem] = Field(..., min_length=1, max_length=100)


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
        select(SiteMember).where(
            SiteMember.site_id == site.id,
            SiteMember.user_id == user.id,
            SiteMember.deleted_at.is_(None),
        )
    )
    m = r.scalar_one_or_none()
    return m.role if m else None


def _can_read(role: str | None) -> bool:
    return role in ("owner", "editor", "viewer")


def _can_write(role: str | None) -> bool:
    return role in ("owner", "editor")


def _can_delete(role: str | None) -> bool:
    return role == "owner"


def _item(
    *,
    item_type: TrashType,
    item_id: uuid.UUID,
    title: str,
    slug: str = "",
    deleted_at: datetime | None,
    extra: Optional[dict] = None,
) -> dict:
    return {
        "id": str(item_id),
        "type": item_type,
        "type_label": TYPE_LABEL[item_type],
        "title": title,
        "slug": slug or "",
        "deleted_at": deleted_at.isoformat() if deleted_at else None,
        "extra": extra or {},
    }


@router.get("/sites/{site_id}/trash", response_model=None)
async def list_site_trash(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    type: Annotated[Optional[TrashType], Query(description="按类型过滤")] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    q: Annotated[Optional[str], Query(description="搜索标题/slug")] = None,
):
    """列出站点回收站条目（软删除的文章/栏目/模板/媒体）"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问")

    types = (type,) if type else ALL_TYPES
    items: list[dict] = []
    counts: dict[str, int] = {t: 0 for t in ALL_TYPES}
    needle = (q or "").strip().lower()

    if "content" in types:
        rows = (await db.execute(
            select(Content).where(
                Content.site_id == site_id,
                Content.deleted_at.isnot(None),
            )
        )).scalars().all()
        counts["content"] = len(rows)
        for c in rows:
            if needle and needle not in (c.title or "").lower() and needle not in (c.slug or "").lower():
                continue
            items.append(_item(
                item_type="content", item_id=c.id, title=c.title or "(无标题)",
                slug=c.slug or "", deleted_at=c.deleted_at,
                extra={"status": c.status, "category_id": str(c.category_id) if c.category_id else None},
            ))

    if "category" in types:
        rows = (await db.execute(
            select(Category).where(
                Category.site_id == site_id,
                Category.deleted_at.isnot(None),
            )
        )).scalars().all()
        counts["category"] = len(rows)
        for c in rows:
            if needle and needle not in (c.name or "").lower() and needle not in (c.slug or "").lower():
                continue
            items.append(_item(
                item_type="category", item_id=c.id, title=c.name or "(无名称)",
                slug=c.slug or "", deleted_at=c.deleted_at,
                extra={"path": c.path, "parent_id": str(c.parent_id) if c.parent_id else None},
            ))

    if "layout" in types:
        rows = (await db.execute(
            select(Layout).where(
                Layout.site_id == site_id,
                Layout.deleted_at.isnot(None),
            )
        )).scalars().all()
        counts["layout"] = len(rows)
        for ly in rows:
            if needle and needle not in (ly.name or "").lower() and needle not in (ly.code or "").lower():
                continue
            items.append(_item(
                item_type="layout", item_id=ly.id, title=ly.name or ly.code or "(无名称)",
                slug=ly.code or "", deleted_at=ly.deleted_at,
                extra={"scope": ly.scope, "code": ly.code},
            ))

    if "media" in types:
        rows = (await db.execute(
            select(Media).where(
                Media.site_id == site_id,
                Media.deleted_at.isnot(None),
            )
        )).scalars().all()
        counts["media"] = len(rows)
        for m in rows:
            title = m.filename or m.object_key or "(无文件名)"
            if needle and needle not in title.lower() and needle not in (m.object_key or "").lower():
                continue
            items.append(_item(
                item_type="media", item_id=m.id, title=title,
                slug=m.object_key or "", deleted_at=m.deleted_at,
                extra={"mime": m.mime_type, "byte_size": m.size_bytes},
            ))

    items.sort(key=lambda x: x["deleted_at"] or "", reverse=True)
    total = len(items)
    start = (page - 1) * page_size
    page_items = items[start: start + page_size]

    return {
        "code": 0,
        "message": "ok",
        "data": {
            "items": page_items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "counts": counts,
        },
    }


@router.get("/sites/{site_id}/trash/counts", response_model=None)
async def site_trash_counts(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """各类型软删数量（侧栏角标）"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问")

    async def _count(model) -> int:
        return (await db.execute(
            select(func.count()).select_from(model).where(
                model.site_id == site_id,
                model.deleted_at.isnot(None),
            )
        )).scalar() or 0

    counts = {
        "content": await _count(Content),
        "category": await _count(Category),
        "layout": await _count(Layout),
        "media": await _count(Media),
    }
    return ok({"counts": counts, "total": sum(counts.values())})


@router.post("/sites/{site_id}/trash/{item_type}/{item_id}/restore", response_model=None)
async def restore_trash_item(
    site_id: uuid.UUID,
    item_type: TrashType,
    item_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """从回收站还原"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权还原")
    await _do_restore(db, site_id, item_type, item_id)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise Conflict("还原失败：唯一约束冲突") from e
    return ok(message=f"已还原{TYPE_LABEL[item_type]}")


@router.delete("/sites/{site_id}/trash/{item_type}/{item_id}/permanent", response_model=None)
async def permanent_delete_trash_item(
    site_id: uuid.UUID,
    item_type: TrashType,
    item_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """永久删除回收站条目（仅 owner）"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_delete(role):
        raise Forbidden("仅 owner 可永久删除")
    await _do_permanent(db, site, item_type, item_id)
    await db.commit()
    return ok(message=f"已永久删除{TYPE_LABEL[item_type]}")


@router.post("/sites/{site_id}/trash/batch", response_model=None)
async def batch_trash_action(
    site_id: uuid.UUID,
    body: TrashBatchRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """批量还原 / 永久删除。单条失败不中断其余条目。"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if body.action == "permanent":
        if not _can_delete(role):
            raise Forbidden("仅 owner 可批量永久删除")
    else:
        if not _can_write(role):
            raise Forbidden("无权批量还原")

    results: list[dict] = []
    succeeded = 0
    failed = 0

    for it in body.items:
        try:
            async with db.begin_nested():
                if body.action == "restore":
                    await _do_restore(db, site_id, it.type, it.id)
                else:
                    await _do_permanent(db, site, it.type, it.id)
            results.append({"type": it.type, "id": str(it.id), "success": True})
            succeeded += 1
        except Exception as e:  # noqa: BLE001
            err_msg = _exc_message(e)
            results.append({
                "type": it.type, "id": str(it.id),
                "success": False, "error": err_msg[:200],
            })
            failed += 1

    await db.commit()
    label = "还原" if body.action == "restore" else "永久删除"
    return ok(
        message=f"批量{label}完成：成功 {succeeded}，失败 {failed}",
        data={
            "results": results,
            "total": len(body.items),
            "succeeded": succeeded,
            "failed": failed,
        },
    )


def _exc_message(e: BaseException) -> str:
    detail = getattr(e, "detail", None)
    if isinstance(detail, dict) and detail.get("message"):
        return str(detail["message"])
    if isinstance(detail, str):
        return detail
    msg = getattr(e, "message", None)
    if msg:
        return str(msg)
    return str(e) or type(e).__name__


async def _do_restore(
    db: AsyncSession, site_id: uuid.UUID, item_type: TrashType, item_id: uuid.UUID,
) -> None:
    if item_type == "content":
        c = await db.get(Content, item_id)
        if not c or c.site_id != site_id or not c.deleted_at:
            raise NotFound("回收站中无此文章")
        clash = (await db.execute(
            select(Content.id).where(
                Content.site_id == site_id,
                Content.slug == c.slug,
                Content.id != c.id,
                Content.deleted_at.is_(None),
            )
        )).scalar_one_or_none()
        if clash:
            raise Conflict(f"slug '{c.slug}' 已被占用，请先修改或永久删除冲突文章")
        c.deleted_at = None
        if c.category_id:
            from sqlalchemy import update
            await db.execute(
                update(Category)
                .where(Category.id == c.category_id, Category.deleted_at.is_(None))
                .values(content_count=Category.content_count + 1)
            )

    elif item_type == "category":
        c = await db.get(Category, item_id)
        if not c or c.site_id != site_id or not c.deleted_at:
            raise NotFound("回收站中无此栏目")
        clash = (await db.execute(
            select(Category.id).where(
                Category.site_id == site_id,
                Category.slug == c.slug,
                Category.id != c.id,
                Category.deleted_at.is_(None),
            )
        )).scalar_one_or_none()
        if clash:
            raise Conflict(f"slug '{c.slug}' 已被占用，无法还原")
        if c.parent_id:
            parent = await db.get(Category, c.parent_id)
            if parent and parent.deleted_at:
                raise BadRequest("父栏目仍在回收站，请先还原父栏目")
        c.deleted_at = None

    elif item_type == "layout":
        ly = await db.get(Layout, item_id)
        if not ly or ly.site_id != site_id or not ly.deleted_at:
            raise NotFound("回收站中无此模板")
        clash = (await db.execute(
            select(Layout.id).where(
                Layout.site_id == site_id,
                Layout.code == ly.code,
                Layout.id != ly.id,
                Layout.deleted_at.is_(None),
            )
        )).scalar_one_or_none()
        if clash:
            raise Conflict(f"模板 code '{ly.code}' 已被占用，无法还原")
        ly.deleted_at = None

    elif item_type == "media":
        m = await db.get(Media, item_id)
        if not m or m.site_id != site_id or not m.deleted_at:
            raise NotFound("回收站中无此媒体")
        m.deleted_at = None


async def _do_permanent(
    db: AsyncSession, site: Site, item_type: TrashType, item_id: uuid.UUID,
) -> None:
    site_id = site.id
    if item_type == "content":
        from app.api.v1.contents import _hard_delete_content
        c = await db.get(Content, item_id)
        if not c or c.site_id != site_id:
            raise NotFound("内容不存在")
        if not c.deleted_at:
            raise BadRequest("只能永久删除已软删的内容")
        await _hard_delete_content(db, site, c)

    elif item_type == "category":
        c = await db.get(Category, item_id)
        if not c or c.site_id != site_id:
            raise NotFound("栏目不存在")
        if not c.deleted_at:
            raise BadRequest("只能永久删除已软删的栏目")
        descendants = (await db.execute(
            select(Category).where(
                Category.site_id == site_id,
                Category.path.like(f"{c.path}%"),
                Category.deleted_at.isnot(None),
            )
        )).scalars().all()
        for d in descendants:
            await db.delete(d)

    elif item_type == "layout":
        ly = await db.get(Layout, item_id)
        if not ly or ly.site_id != site_id:
            raise NotFound("模板不存在")
        if not ly.deleted_at:
            raise BadRequest("只能永久删除已软删的模板")
        vers = (await db.execute(
            select(LayoutVersion).where(LayoutVersion.layout_id == ly.id)
        )).scalars().all()
        for v in vers:
            await db.delete(v)
        await db.delete(ly)

    elif item_type == "media":
        m = await db.get(Media, item_id)
        if not m or m.site_id != site_id:
            raise NotFound("媒体不存在")
        if not m.deleted_at:
            raise BadRequest("只能永久删除已软删的媒体")
        rels = (await db.execute(
            select(MediaRelation).where(MediaRelation.media_id == m.id)
        )).scalars().all()
        for r in rels:
            await db.delete(r)
        await db.delete(m)
