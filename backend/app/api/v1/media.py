"""媒体 (Media) API (P1.5)

API:
- POST   /api/v1/sites/{site_id}/media/presign     取得 presigned PUT URL
- POST   /api/v1/sites/{site_id}/media/confirm     上传完成后回 API 登记
- GET    /api/v1/sites/{site_id}/media             列表 (filter by folder/mime)
- GET    /api/v1/sites/{site_id}/media/{id}        详情
- PATCH  /api/v1/sites/{site_id}/media/{id}        更新 (filename/alt_text/folder)
- DELETE /api/v1/sites/{site_id}/media/{id}        软删除 (并真删 MinIO 对象)

Folders:
- GET    /api/v1/sites/{site_id}/media-folders
- POST   /api/v1/sites/{site_id}/media-folders

权限:
- 读: super_admin / site owner / site member
- 写 (上传/更新): super_admin / site owner / site editor
- 删: super_admin / site owner
"""
import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query, Request, UploadFile, File, Form
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.exceptions import BadRequest, Forbidden, NotFound
from app.core.ratelimit import limiter as _limiter
from app.core.responses import ok, page_resp
from app.db.session import get_db
from app.models.media import Media, MediaFolder, MediaRelation, MediaTag, MediaTagLink
from app.models.content import Content, ContentVersion
from app.models.membership import SiteMember
from app.models.site import Site
from app.models.user import User
from app.schemas.media import (
    MediaConfirm, MediaFolderCreate, MediaFolderRead,
    MediaListItem, MediaRead, MediaUpdate,
    MediaUsageItem, MediaUsageResponse,
    MediaTagCreate, MediaTagUpdate, MediaTagRead, MediaTagAttach,
    PresignRequest, PresignResponse,
)
from app.services import minio_client
from app.core.config import get_settings
settings = get_settings()

router = APIRouter(tags=["media"])


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


def _can_read(role): return role in ("owner", "editor", "viewer")
def _can_write(role): return role in ("owner", "editor")
def _can_delete(role): return role == "owner"


def _ext_from_mime(mime: str) -> str:
    return {
        "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
        "image/webp": ".webp", "image/svg+xml": ".svg",
        "image/avif": ".avif", "image/heic": ".heic", "image/heif": ".heif",
        "application/pdf": ".pdf",
        "video/mp4": ".mp4", "video/webm": ".webm",
        "audio/mpeg": ".mp3", "audio/wav": ".wav",
        "application/zip": ".zip", "text/plain": ".txt",
    }.get(mime, ".bin")


def _to_list_item(m: Media, uploader_name: str | None = None) -> dict:
    # P3.6.2: 缩略图 URL (优先 thumb_small, 无则原图)
    thumb_small = (
        minio_client.presign_get_url(m.thumb_small_key, 3600)
        if m.thumb_small_key else None
    )
    thumb_large = (
        minio_client.presign_get_url(m.thumb_large_key, 3600)
        if m.thumb_large_key else None
    )
    return {
        "id": str(m.id),
        "site_id": str(m.site_id),
        "folder_id": str(m.folder_id) if m.folder_id else None,
        "filename": m.filename,
        "mime_type": m.mime_type,
        "size_bytes": m.size_bytes,
        "width": m.width,
        "height": m.height,
        "alt_text": m.alt_text,
        "url": minio_client.presign_get_url(m.object_key, 3600),
        "thumb_small_url": thumb_small,
        "thumb_large_url": thumb_large,
        "thumb_status": m.thumb_status,
        "is_shared": m.is_shared,
        "uploader_id": str(m.uploader_id),
        "uploader_name": uploader_name,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def _trigger_thumb_task(media_id: str) -> None:
    """上传成功后触发缩略图生成 (失败也不影响上传主流程)"""
    try:
        from app.workers.media import generate_thumbnails
        generate_thumbnails.delay(str(media_id))
    except Exception as e:
        import logging
        logging.warning(f"触发缩略图任务失败 {media_id}: {e}")


# === Presign 上传 ===

@router.post("/sites/{site_id}/media/presign", response_model=None)
@_limiter.limit("60/minute")  # P4.2: presign 一次只拿一个 URL, 防滥用刷签名
async def presign_upload(
    request: Request,  # P4.2: slowapi 限流需要
    site_id: uuid.UUID,
    body: PresignRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """取得 presigned PUT URL, 客户端用此 URL 直传 MinIO"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权上传")

    from app.schemas.media import ALLOWED_MIME, MAX_SIZE
    if body.mime_type not in ALLOWED_MIME:
        raise BadRequest(f"不支持的 mime 类型: {body.mime_type}")
    if body.size_bytes > MAX_SIZE:
        raise BadRequest(f"文件过大 (上限 {MAX_SIZE // 1024 // 1024} MB)")

    # 校验 folder
    if body.folder_id:
        r = await db.execute(
            select(MediaFolder).where(
                MediaFolder.id == body.folder_id,
                MediaFolder.site_id == site_id,
                MediaFolder.deleted_at.is_(None),
            )
        )
        if not r.scalar_one_or_none():
            raise BadRequest("folder 不存在")

    ext = _ext_from_mime(body.mime_type)
    object_key = minio_client.make_object_key(str(site_id), ext)
    presign = minio_client.presign_put_url(object_key, body.mime_type, expires_seconds=600)

    return ok({
        "object_key": object_key,
        "upload_url": presign["upload_url"],
        "method": presign["method"],
        "expires_in": presign["expires_in"],
        "public_url": presign["public_url"],
        "headers": presign["headers"],
    }, message="已生成上传 URL, 10 分钟内有效")


@router.post("/sites/{site_id}/media/upload", response_model=None, status_code=201)
@_limiter.limit("60/minute")  # P4.2: 直传上传也限, 防刷
async def direct_upload(
    request: Request,  # P4.2: slowapi 限流需要
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    file: UploadFile = File(...),
    folder_id: str = Form(""),  # 客户端传 string, 后端转 uuid
    alt_text: str = Form(""),
    width: int = Form(0),
    height: int = Form(0),
    replace: bool = Form(False, description="同 filename 覆盖 (保留 id + object_key)"),
):
    """API 代理上传 (避开 presigned host问题)

    P3.6.2 H: replace=true 启用同名替换. 选中同 site (非软删) 同 filename 的记录,
    保留 id + object_key, MinIO put_object 覆盖, DB 更新 mime/size/dim/alt,
    清空 thumb (让 worker 重生), 触发新 thumb 任务.
    """
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权上传")

    content = await file.read()
    if not content:
        raise BadRequest("文件为空")
    if len(content) > 50 * 1024 * 1024:
        raise BadRequest("文件过大 (上限 50 MB)")

    # mime 校验
    from app.schemas.media import ALLOWED_MIME
    if file.content_type and file.content_type not in ALLOWED_MIME:
        raise BadRequest(f"不支持的 mime 类型: {file.content_type}")

    if folder_id:
        try:
            folder_uuid = uuid.UUID(folder_id)
        except ValueError:
            raise BadRequest("folder_id 格式错误")
        r = await db.execute(
            select(MediaFolder).where(
                MediaFolder.id == folder_uuid,
                MediaFolder.site_id == site_id,
                MediaFolder.deleted_at.is_(None),
            )
        )
        if not r.scalar_one_or_none():
            raise BadRequest("folder 不存在")
        actual_folder_id = folder_uuid
    else:
        actual_folder_id = None

    ext = _ext_from_mime(file.content_type or "application/octet-stream")
    filename = file.filename or "upload"

    # P3.6.2 H: 同名替换检查
    existing: Media | None = None
    if replace:
        r = await db.execute(
            select(Media).where(
                Media.site_id == site_id,
                Media.filename == filename,
                Media.deleted_at.is_(None),
            )
        )
        existing = r.scalar_one_or_none()

    if existing:
        # 覆盖: 保留 id + object_key, 重写 MinIO, 更新字段, 清 thumb
        object_key = existing.object_key
        from io import BytesIO
        minio_client.get_minio().put_object(
            settings.MINIO_BUCKET,
            object_key,
            BytesIO(content),
            length=len(content),
            content_type=file.content_type or "application/octet-stream",
        )
        existing.mime_type = file.content_type or existing.mime_type
        existing.size_bytes = len(content)
        existing.width = width or None
        existing.height = height or None
        existing.alt_text = alt_text or existing.alt_text
        existing.folder_id = actual_folder_id
        # 清 thumb 让 worker 重生
        existing.thumb_small_key = None
        existing.thumb_large_key = None
        existing.thumb_status = "pending"
        await db.commit()
        await db.refresh(existing)
        m = existing
    else:
        object_key = minio_client.make_object_key(str(site_id), ext)
        from io import BytesIO
        minio_client.get_minio().put_object(
            settings.MINIO_BUCKET,
            object_key,
            BytesIO(content),
            length=len(content),
            content_type=file.content_type or "application/octet-stream",
        )
        m = Media(
            site_id=site_id, folder_id=actual_folder_id,
            uploader_id=current_user.id,
            filename=filename,
            object_key=object_key,
            mime_type=file.content_type or "application/octet-stream",
            size_bytes=len(content),
            width=width or None, height=height or None,
            alt_text=alt_text or None,
        )
        db.add(m)
        await db.commit()
        await db.refresh(m)

    # P3.6.2: 触发缩略图生成
    _trigger_thumb_task(str(m.id))

    return ok({
        "id": str(m.id), "site_id": str(m.site_id),
        "folder_id": str(m.folder_id) if m.folder_id else None,
        "uploader_id": str(m.uploader_id),
        "uploader_name": current_user.name,
        "filename": m.filename, "object_key": m.object_key,
        "mime_type": m.mime_type, "size_bytes": m.size_bytes,
        "width": m.width, "height": m.height,
        "alt_text": m.alt_text,
        "url": minio_client.presign_get_url(m.object_key, 3600),
        "thumb_small_url": None,  # 待 worker 生成
        "thumb_status": "pending",
        "is_shared": m.is_shared,
        "created_at": m.created_at.isoformat(),
        "updated_at": m.updated_at.isoformat(),
    }, message="已上传" if not existing else "已替换同名文件")


@router.post("/sites/{site_id}/media/confirm", response_model=None, status_code=201)
@_limiter.limit("60/minute")  # P4.2: 确认也是写操作
async def confirm_upload(
    request: Request,  # P4.2: slowapi 限流需要
    site_id: uuid.UUID,
    body: MediaConfirm,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """客户端 PUT 到 MinIO 后, 调此 API 登记 Media 记录"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权上传")

    # 验证 object 真存在
    if not minio_client.object_exists(body.object_key):
        raise BadRequest("文件未上传到 MinIO, 请先 PUT 到 upload_url")

    # 校验 folder
    if body.folder_id:
        r = await db.execute(
            select(MediaFolder).where(
                MediaFolder.id == body.folder_id,
                MediaFolder.site_id == site_id,
                MediaFolder.deleted_at.is_(None),
            )
        )
        if not r.scalar_one_or_none():
            raise BadRequest("folder 不存在")

    m = Media(
        site_id=site_id, folder_id=body.folder_id,
        uploader_id=current_user.id,
        filename=body.filename, object_key=body.object_key,
        mime_type=body.mime_type, size_bytes=body.size_bytes,
        width=body.width, height=body.height,
        alt_text=body.alt_text,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)

    # P3.6.2: 触发缩略图生成
    _trigger_thumb_task(str(m.id))

    return ok({
        "id": str(m.id),
        "site_id": str(m.site_id),
        "folder_id": str(m.folder_id) if m.folder_id else None,
        "uploader_id": str(m.uploader_id),
        "uploader_name": current_user.name,
        "filename": m.filename,
        "object_key": m.object_key,
        "mime_type": m.mime_type,
        "size_bytes": m.size_bytes,
        "width": m.width,
        "height": m.height,
        "alt_text": m.alt_text,
        "url": minio_client.presign_get_url(m.object_key, 3600),
        "thumb_small_url": None,  # 待 worker 生成
        "thumb_status": "pending",
        "is_shared": False,
        "created_at": m.created_at.isoformat(),
        "updated_at": m.updated_at.isoformat(),
    }, message="媒体已登记")


# === 列表 / 详情 ===

@router.get("/sites/{site_id}/media", response_model=None)
async def list_media(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    folder_id: Optional[uuid.UUID] = None,
    mime_prefix: Optional[str] = None,
    q: Optional[str] = None,
    tags: Optional[str] = Query(None, description="逗号分隔 tag 名, AND 匹配"),
    only_shared: bool = Query(False, description="只看跨站共享池 (is_shared=true)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """媒体列表 (分页 + 搜索 + mime 过滤)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问")

    from sqlalchemy import func
    # P3.6.2 G: 默认查询 = 本站 (site_id) ∪ 共享池 (is_shared=true)
    base = select(Media).where(
        Media.deleted_at.is_(None),
        (Media.site_id == site_id) | (Media.is_shared.is_(True)),
    )
    if only_shared:
        # P3.6.2 G: 只看共享池
        base = base.where(Media.is_shared.is_(True))
    if folder_id is not None:
        base = base.where(Media.folder_id == folder_id)
    if mime_prefix:
        base = base.where(Media.mime_type.like(f"{mime_prefix}%"))
    if q:
        # 文件名模糊 (不区分大小写)
        base = base.where(Media.filename.ilike(f"%{q}%"))
    if tags:
        # P3.6.2 F: 按 tag 名 AND 过滤 (媒体必须同时拥有所有指定 tag)
        tag_names = [t.strip() for t in tags.split(",") if t.strip()]
        for tn in tag_names:
            base = base.where(
                Media.id.in_(
                    select(MediaTagLink.media_id)
                    .join(MediaTag, MediaTag.id == MediaTagLink.media_tag_id)
                    .where(MediaTag.site_id == site_id, MediaTag.name == tn)
                )
            )

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    items = (await db.execute(
        base.order_by(Media.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()

    # 加载 uploader
    uploader_ids = list({m.uploader_id for m in items})
    uploaders = {}
    if uploader_ids:
        r = await db.execute(select(User).where(User.id.in_(uploader_ids)))
        uploaders = {u.id: u for u in r.scalars()}

    out = [_to_list_item(m, uploaders.get(m.uploader_id).name if m.uploader_id in uploaders else None) for m in items]

    # P3.6.2 F: 批量取每个 media 的 tags
    media_ids = [m.id for m in items]
    tags_map: dict[uuid.UUID, list[dict]] = {mid: [] for mid in media_ids}
    if media_ids:
        r = await db.execute(
            select(MediaTagLink.media_id, MediaTag.id, MediaTag.name, MediaTag.color)
            .join(MediaTag, MediaTag.id == MediaTagLink.media_tag_id)
            .where(MediaTagLink.media_id.in_(media_ids))
        )
        for mid, tid, name, color in r.all():
            tags_map[mid].append({"id": str(tid), "name": name, "color": color})
    for item, m in zip(out, items):
        item["tags"] = tags_map.get(m.id, [])

    return page_resp(out, total, page, page_size)


@router.get("/sites/{site_id}/media/{media_id}", response_model=None)
async def get_media(
    site_id: uuid.UUID,
    media_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """媒体详情"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问")

    m = await db.get(Media, media_id)
    if not m or m.site_id != site_id or m.deleted_at:
        raise NotFound("媒体不存在")

    uploader = await db.get(User, m.uploader_id)
    thumb_small = (
        minio_client.presign_get_url(m.thumb_small_key, 3600)
        if m.thumb_small_key else None
    )
    thumb_large = (
        minio_client.presign_get_url(m.thumb_large_key, 3600)
        if m.thumb_large_key else None
    )
    # P3.6.2 F: 单条也返 tags
    tags_r = await db.execute(
        select(MediaTag.id, MediaTag.name, MediaTag.color)
        .join(MediaTagLink, MediaTagLink.media_tag_id == MediaTag.id)
        .where(MediaTagLink.media_id == m.id)
    )
    return ok({
        "id": str(m.id), "site_id": str(m.site_id),
        "folder_id": str(m.folder_id) if m.folder_id else None,
        "uploader_id": str(m.uploader_id),
        "uploader_name": uploader.name if uploader else None,
        "filename": m.filename, "object_key": m.object_key,
        "mime_type": m.mime_type, "size_bytes": m.size_bytes,
        "width": m.width, "height": m.height,
        "alt_text": m.alt_text,
        "url": minio_client.presign_get_url(m.object_key, 3600),
        "thumb_small_url": thumb_small,
        "thumb_large_url": thumb_large,
        "thumb_status": m.thumb_status,
        "is_shared": m.is_shared,
        "tags": [{"id": str(tid), "name": n, "color": c} for tid, n, c in tags_r.all()],
        "created_at": m.created_at.isoformat(),
        "updated_at": m.updated_at.isoformat(),
    })


@router.patch("/sites/{site_id}/media/{media_id}", response_model=None)
async def update_media(
    site_id: uuid.UUID,
    media_id: uuid.UUID,
    body: MediaUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """更新媒体 (filename / alt_text / folder / is_shared)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权修改")

    m = await db.get(Media, media_id)
    if not m or m.site_id != site_id or m.deleted_at:
        raise NotFound("媒体不存在")

    if body.filename is not None:
        m.filename = body.filename
    if body.alt_text is not None:
        m.alt_text = body.alt_text
    if getattr(body, "is_shared", None) is not None:
        # 仅 super_admin 可设 is_shared
        if not current_user.is_super_admin:
            raise Forbidden("仅 super_admin 可改共享状态")
        m.is_shared = body.is_shared
    if body.folder_id is not None:
        if body.folder_id:
            r = await db.execute(
                select(MediaFolder).where(
                    MediaFolder.id == body.folder_id,
                    MediaFolder.site_id == site_id,
                    MediaFolder.deleted_at.is_(None),
                )
            )
            if not r.scalar_one_or_none():
                raise BadRequest("folder 不存在")
        m.folder_id = body.folder_id

    await db.commit()
    await db.refresh(m)
    # 查 uploader 名字
    u = await db.get(User, m.uploader_id)
    return ok(_to_list_item(m, u.name if u else None), message="已更新")


@router.delete("/sites/{site_id}/media/{media_id}", response_model=None)
async def delete_media(
    site_id: uuid.UUID,
    media_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    force: bool = Query(False, description="跳过引用检查, 强制删除"),
):
    """软删除 + 真删 MinIO 对象 (P3.6.1: 有引用时需要 force=true)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_delete(role):
        raise Forbidden("仅 owner 可删除")

    m = await db.get(Media, media_id)
    if not m or m.site_id != site_id or m.deleted_at:
        raise NotFound("媒体不存在")

    # P3.6.1: 引用检查 (未 force 时, 有引用报错 409)
    if not force:
        from sqlalchemy import func as sqlfunc
        from app.models.layout import Layout
        # 文章主表 (封面图)
        n_contents_cover = (await db.execute(
            select(sqlfunc.count()).select_from(Content).where(
                Content.site_id == site_id,
                Content.deleted_at.is_(None),
                Content.cover_image.contains(m.object_key),
            )
        )).scalar() or 0
        # 内容版本 (body)
        n_contents_body = (await db.execute(
            select(sqlfunc.count(sqlfunc.distinct(ContentVersion.content_id)))
            .select_from(ContentVersion)
            .join(Content, ContentVersion.content_id == Content.id)
            .where(
                Content.site_id == site_id,
                Content.deleted_at.is_(None),
                ContentVersion.body.contains(m.object_key),
            )
        )).scalar() or 0
        n_layouts = (await db.execute(
            select(sqlfunc.count()).select_from(Layout).where(
                Layout.site_id == site_id,
                Layout.deleted_at.is_(None),
                Layout.html.contains(m.object_key),
            )
        )).scalar() or 0
        total = n_contents_cover + n_contents_body + n_layouts
        if total > 0:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=409,
                detail={"code": 40901, "message": f"该媒体被 {total} 处引用 (文章封面 {n_contents_cover} / 文章内容 {n_contents_body} / 模板 {n_layouts}), 如确认要删请传 force=true", "count": total},
            )

    m.deleted_at = datetime.now(timezone.utc)
    # 同步删关联
    rels = (await db.execute(
        select(MediaRelation).where(MediaRelation.media_id == m.id)
    )).scalars().all()
    for r in rels:
        await db.delete(r)
    await db.commit()

    # 真删 MinIO 对象 (软删表先, 不影响主流程)
    minio_client.remove_object(m.object_key)

    return ok(message="已删除")


# P3.6.1: 引用计数 (扫 contents.body + layouts.html 找含 object_key 的记录)
@router.get("/sites/{site_id}/media/{media_id}/usage", response_model=None)
async def get_media_usage(
    site_id: uuid.UUID,
    media_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """返回该媒体被哪些文章/模板引用

    原理: 扫 contents.body 和 layouts.html, grep object_key (该路径在生成的 HTML 中是稳定引用标识)
    """
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问")

    m = await db.get(Media, media_id)
    if not m or m.site_id != site_id or m.deleted_at:
        raise NotFound("媒体不存在")

    # 扫 contents.cover_image + ContentVersion.body
    refs: list[MediaUsageItem] = []
    needle = m.object_key  # 例: sites/19cf.../2026/06/abc.png
    contents_q = await db.execute(
        select(Content).where(
            Content.site_id == site_id,
            Content.deleted_at.is_(None),
        )
    )
    for c in contents_q.scalars():
        # 封面图
        if c.cover_image and needle in c.cover_image:
            idx = c.cover_image.find(needle)
            ctx = c.cover_image[max(0, idx - 30):idx + len(needle) + 30]
            refs.append(MediaUsageItem(
                type="content",
                id=str(c.id),
                title=c.title,
                context=ctx,
            ))

    # 扫 ContentVersion.body (文章真实内容)
    versions_q = await db.execute(
        select(ContentVersion, Content).join(
            Content, ContentVersion.content_id == Content.id
        ).where(
            Content.site_id == site_id,
            Content.deleted_at.is_(None),
            ContentVersion.body.contains(needle),
        )
    )
    seen_content_ids: set[str] = set()
    for v, c in versions_q.all():
        if str(c.id) in seen_content_ids:
            continue
        seen_content_ids.add(str(c.id))
        idx = v.body.find(needle)
        ctx = v.body[max(0, idx - 30):idx + len(needle) + 30]
        refs.append(MediaUsageItem(
            type="content",
            id=str(c.id),
            title=c.title,
            context=ctx,
        ))

    # 扫 layouts.html
    from app.models.layout import Layout
    layouts_q = await db.execute(
        select(Layout).where(
            Layout.site_id == site_id,
            Layout.deleted_at.is_(None),
        )
    )
    for L in layouts_q.scalars():
        if L.html and needle in L.html:
            idx = L.html.find(needle)
            ctx = L.html[max(0, idx - 30):idx + len(needle) + 30]
            refs.append(MediaUsageItem(
                type="layout",
                id=str(L.id),
                title=f"{L.scope}/{L.code}",
                context=ctx,
            ))

    return ok(MediaUsageResponse(
        media_id=str(media_id),
        object_key=m.object_key,
        count=len(refs),
        references=refs,
    ).model_dump())


# === 文件夹 ===

@router.get("/sites/{site_id}/media-folders", response_model=None)
async def list_folders(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
):
    """列出所有文件夹 (扁平, 分页)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问")

    base = select(MediaFolder).where(
        MediaFolder.site_id == site_id,
        MediaFolder.deleted_at.is_(None),
    )
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    r = await db.execute(
        base.order_by(MediaFolder.path)
            .offset((page - 1) * page_size).limit(page_size)
    )
    folders = r.scalars().all()
    return page_resp([{
        "id": str(f.id), "site_id": str(f.site_id),
        "parent_id": str(f.parent_id) if f.parent_id else None,
        "name": f.name, "path": f.path,
    } for f in folders], total=total, page=page, page_size=page_size)


@router.post("/sites/{site_id}/media-folders", response_model=None, status_code=201)
async def create_folder(
    site_id: uuid.UUID,
    body: MediaFolderCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """创建文件夹"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权创建")

    parent = None
    if body.parent_id:
        parent = await db.get(MediaFolder, body.parent_id)
        if not parent or parent.site_id != site_id or parent.deleted_at:
            raise BadRequest("父文件夹不存在")

    f = MediaFolder(site_id=site_id, parent_id=body.parent_id, name=body.name, path="")
    db.add(f)
    await db.flush()
    if parent:
        f.path = f"{parent.path}{f.id}/"
    else:
        f.path = f"/{f.id}/"
    await db.commit()
    await db.refresh(f)

    return ok({
        "id": str(f.id), "site_id": str(f.site_id),
        "parent_id": str(f.parent_id) if f.parent_id else None,
        "name": f.name, "path": f.path,
    }, message="已创建")


# === P3.6.2 F: 媒体标签 (替代文件夹的扁平化方案) ===

@router.get("/sites/{site_id}/media-tags", response_model=None)
async def list_tags(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    q: Optional[str] = None,
):
    """列出该站的所有标签 (含 media_count)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问")

    from sqlalchemy import func
    base = select(MediaTag).where(MediaTag.site_id == site_id)
    if q:
        base = base.where(MediaTag.name.ilike(f"%{q}%"))

    r = await db.execute(base.order_by(MediaTag.name))
    tags = r.scalars().all()

    # 批量查 media_count
    tag_ids = [t.id for t in tags]
    counts = {}
    if tag_ids:
        cnt = await db.execute(
            select(MediaTagLink.media_tag_id, func.count(MediaTagLink.media_id))
            .where(MediaTagLink.media_tag_id.in_(tag_ids))
            .group_by(MediaTagLink.media_tag_id)
        )
        counts = {row[0]: row[1] for row in cnt.all()}

    out = [MediaTagRead(
        id=str(t.id), site_id=str(t.site_id), name=t.name, color=t.color,
        media_count=counts.get(t.id, 0),
        created_at=t.created_at,
    ).model_dump(mode="json") for t in tags]
    return ok(out)


@router.post("/sites/{site_id}/media-tags", response_model=None, status_code=201)
async def create_tag(
    site_id: uuid.UUID,
    body: MediaTagCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """创建标签 (同 site 同名不允许)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权创建")

    name = body.name.strip()
    if not name:
        raise BadRequest("name 不能为空")

    r = await db.execute(
        select(MediaTag).where(
            MediaTag.site_id == site_id, MediaTag.name == name,
        )
    )
    if r.scalar_one_or_none():
        raise BadRequest(f"标签 '{name}' 已存在")

    t = MediaTag(site_id=site_id, name=name, color=body.color)
    db.add(t)
    await db.commit()
    await db.refresh(t)

    return ok(MediaTagRead(
        id=str(t.id), site_id=str(t.site_id), name=t.name, color=t.color,
        media_count=0, created_at=t.created_at,
    ).model_dump(mode="json"), message="已创建")


@router.patch("/sites/{site_id}/media-tags/{tag_id}", response_model=None)
async def update_tag(
    site_id: uuid.UUID,
    tag_id: uuid.UUID,
    body: MediaTagUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """更新标签 (改名/换色)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权修改")

    t = await db.get(MediaTag, tag_id)
    if not t or t.site_id != site_id:
        raise NotFound("标签不存在")

    if body.name is not None:
        new_name = body.name.strip()
        if not new_name:
            raise BadRequest("name 不能为空")
        # 查重 (改名后)
        if new_name != t.name:
            r = await db.execute(
                select(MediaTag).where(
                    MediaTag.site_id == site_id, MediaTag.name == new_name,
                )
            )
            if r.scalar_one_or_none():
                raise BadRequest(f"标签 '{new_name}' 已存在")
        t.name = new_name
    if body.color is not None:
        t.color = body.color

    await db.commit()
    await db.refresh(t)

    return ok(MediaTagRead(
        id=str(t.id), site_id=str(t.site_id), name=t.name, color=t.color,
        media_count=0, created_at=t.created_at,
    ).model_dump(mode="json"), message="已更新")


@router.delete("/sites/{site_id}/media-tags/{tag_id}", response_model=None)
async def delete_tag(
    site_id: uuid.UUID,
    tag_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """删除标签 (自动解除所有 media 关联)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_delete(role):
        raise Forbidden("仅 owner 可删除")

    t = await db.get(MediaTag, tag_id)
    if not t or t.site_id != site_id:
        raise NotFound("标签不存在")

    # 删 N:N 链接 (cascade)
    await db.delete(t)
    await db.commit()
    return ok(message="已删除")


@router.post("/sites/{site_id}/media/{media_id}/tags", response_model=None)
async def set_media_tags(
    site_id: uuid.UUID,
    media_id: uuid.UUID,
    body: MediaTagAttach,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """全量设置 media 的标签 (传 [] 清空)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权修改")

    m = await db.get(Media, media_id)
    if not m or m.site_id != site_id or m.deleted_at:
        raise NotFound("媒体不存在")

    # 校验所有 tag_id 都属于该 site
    new_tag_ids: list[uuid.UUID] = []
    if body.tag_ids:
        try:
            new_tag_ids = [uuid.UUID(t) for t in body.tag_ids]
        except ValueError:
            raise BadRequest("tag_id 格式错误")
        r = await db.execute(
            select(MediaTag).where(
                MediaTag.id.in_(new_tag_ids),
                MediaTag.site_id == site_id,
            )
        )
        found = {t.id for t in r.scalars()}
        if len(found) != len(set(new_tag_ids)):
            raise BadRequest("部分 tag_id 不存在或不属于该站")

    # 全量替换: 清旧 + 写新
    await db.execute(
        MediaTagLink.__table__.delete().where(MediaTagLink.media_id == m.id)
    )
    for tid in new_tag_ids:
        db.add(MediaTagLink(media_id=m.id, media_tag_id=tid))
    await db.commit()

    return ok(message=f"已设置 {len(new_tag_ids)} 个标签")


@router.get("/sites/{site_id}/media/{media_id}/tags", response_model=None)
async def get_media_tags(
    site_id: uuid.UUID,
    media_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """返回 media 当前的标签"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无权访问")

    m = await db.get(Media, media_id)
    if not m or m.site_id != site_id or m.deleted_at:
        raise NotFound("媒体不存在")

    r = await db.execute(
        select(MediaTag).join(
            MediaTagLink, MediaTagLink.media_tag_id == MediaTag.id
        ).where(MediaTagLink.media_id == m.id)
    )
    tags = r.scalars().all()
    return ok([{
        "id": str(t.id), "name": t.name, "color": t.color,
    } for t in tags])


# === P3.6.2 G: 全局素材库 (跨站共享) ===

@router.post("/sites/{site_id}/media/{media_id}/share", response_model=None)
async def share_media(
    site_id: uuid.UUID,
    media_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """将媒体标记为跨站共享 (super_admin only)"""
    if not current_user.is_super_admin:
        raise Forbidden("仅 super_admin 可共享")

    m = await db.get(Media, media_id)
    if not m or m.site_id != site_id or m.deleted_at:
        raise NotFound("媒体不存在")
    m.is_shared = True
    await db.commit()
    await db.refresh(m)
    return ok(message="已共享到全局素材库")


@router.post("/sites/{site_id}/media/{media_id}/unshare", response_model=None)
async def unshare_media(
    site_id: uuid.UUID,
    media_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """取消共享"""
    if not current_user.is_super_admin:
        raise Forbidden("仅 super_admin 可取消共享")

    m = await db.get(Media, media_id)
    if not m or m.site_id != site_id or m.deleted_at:
        raise NotFound("媒体不存在")
    m.is_shared = False
    await db.commit()
    return ok(message="已取消共享")
