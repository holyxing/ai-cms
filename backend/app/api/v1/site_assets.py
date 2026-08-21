"""站点资源 (SiteAsset) API (P3.6.2)

API:
- GET    /api/v1/sites/{site_id}/assets              列表
- POST   /api/v1/sites/{site_id}/assets              上传 (multipart: name + file)
- GET    /api/v1/sites/{site_id}/assets/{name}       详情 (按 name 索引)
- PATCH  /api/v1/sites/{site_id}/assets/{name}       更新 (rename / description)
- DELETE /api/v1/sites/{site_id}/assets/{name}       删除 (仅 owner)

权限: 跟 media 一致 (owner/editor 写, viewer 读)
"""
import os
import re
import uuid
import shutil
from pathlib import Path
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, Body
from fastapi.responses import FileResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import CurrentUser
from app.core.exceptions import BadRequest, Conflict, Forbidden, NotFound
from app.core.responses import ok
from app.db.session import get_db
from app.models.membership import SiteMember
from app.models.site import Site
from app.models.site_asset import SiteAsset, public_relpath
from app.models.user import User
from app.schemas.site_asset import (
    SiteAssetListResponse, SiteAssetRead, SiteAssetUpdate,
    SiteAssetContentUpdate, EDITABLE_MIME_PREFIXES, EDITABLE_MAX_BYTES,
    ASSET_CATEGORIES, validate_category_for_ext, validate_category_for_mime,
)

settings = get_settings()
router = APIRouter(tags=["site-assets"])

# 资源名校验 (跟 schema 同步, 避免不必要的 422)
_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_BLOCKED_EXTS = (".exe", ".bat", ".sh", ".php", ".py", ".pl", ".cgi")

# 允许的 MIME (CSS/JS/字体/图片/图标/SVG 是主力; 二进制也可以)
_ALLOWED_MIME_PREFIXES = (
    "text/", "application/javascript", "application/json",
    "application/xml", "application/font-", "application/x-font-",
    "font/", "image/", "audio/", "video/",
)


# === 权限 helper (跟 media.py 一致) ===

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


def _check_name(name: str) -> None:
    name = name.strip()
    if not _NAME_RE.match(name):
        raise BadRequest(
            "name 必须以字母/数字开头, 只能含 a-zA-Z0-9._-, 最长 128 字符"
        )
    if name.lower().endswith(_BLOCKED_EXTS):
        raise BadRequest(f"不允许的扩展名: {name}")


def _asset_dir(site_id: uuid.UUID, category: str = "assets") -> Path:
    """站点资源目录 (P3.6.5: 加 category 子目录)
    例: backend/ssg/site_assets/{site_id}/css/site.css
    """
    p = Path(settings.SITE_ASSETS_DIR) / str(site_id) / category
    p.mkdir(parents=True, exist_ok=True)
    return p


def _public_url(site_slug: str, asset: SiteAsset) -> str:
    """静态发布后的公开 URL，使用 public_relpath 保留子目录结构"""
    return f"/sites/{site_slug}/{public_relpath(asset)}"


def _to_read(a: SiteAsset, site_slug: str) -> SiteAssetRead:
    return SiteAssetRead(
        id=a.id,
        category=a.category,
        name=a.name,
        original_filename=a.original_filename,
        content_type=a.content_type,
        byte_size=a.byte_size,
        description=a.description,
        created_at=a.created_at,
        updated_at=a.updated_at,
        url=_public_url(site_slug, a),
    )


# === 端点 ===

@router.get("/sites/{site_id}/assets", response_model=None)
async def list_assets(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    category: Annotated[Optional[str], Query(description="过滤: css / js / assets")] = None,
):
    """列出站点资源 (P3.6.5: 支持按 category 过滤, 按 category+name 排序)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无访问权限")

    if category and category not in ASSET_CATEGORIES:
        raise BadRequest(f"category 必须是 {ASSET_CATEGORIES} 之一")

    q = select(SiteAsset).where(SiteAsset.site_id == site_id)
    if category:
        q = q.where(SiteAsset.category == category)
    q = q.order_by(SiteAsset.category.asc(), SiteAsset.name.asc())

    r = await db.execute(q)
    items = r.scalars().all()
    total_q = select(func.count()).select_from(SiteAsset).where(SiteAsset.site_id == site_id)
    if category:
        total_q = total_q.where(SiteAsset.category == category)
    total = await db.scalar(total_q)
    return ok(SiteAssetListResponse(
        items=[_to_read(a, site.slug) for a in items],
        total=total or 0,
    ))


@router.post("/sites/{site_id}/assets", response_model=None)
async def upload_asset(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    name: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    category: Annotated[str, Form(description="css / js / assets")] = "assets",
    description: Annotated[Optional[str], Form()] = None,
):
    """上传资源 (multipart: category + name + file)

    P3.6.5: category 必传 (默认 'assets'), 后端按 category 校验扩展名 + MIME
    - 同站点同 category 内 name 唯一
    - 大小限制 SITE_ASSET_MAX_SIZE (默认 5MB)
    """
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无写权限")

    _check_name(name)
    validate_category_for_ext(category, name)

    if not file.filename:
        raise BadRequest("文件名为空")

    # MIME 校验
    content_type = (file.content_type or "application/octet-stream").lower()
    if not (
        content_type.startswith(_ALLOWED_MIME_PREFIXES)
        or content_type in ("application/octet-stream",)
    ):
        raise BadRequest(f"不支持的 MIME: {content_type}")
    # P3.6.5: category 内 MIME 兼容性
    validate_category_for_mime(category, content_type)

    # 读全部字节 (有大小上限)
    content = await file.read()
    size = len(content)
    if size == 0:
        raise BadRequest("文件为空")
    if size > settings.SITE_ASSET_MAX_SIZE:
        raise BadRequest(
            f"文件过大: {size} bytes > 限制 {settings.SITE_ASSET_MAX_SIZE}"
        )

    # 落盘 (P3.6.5: 按 category 子目录存)
    asset_dir = _asset_dir(site_id, category)
    target = asset_dir / name
    with open(target, "wb") as f:
        f.write(content)

    # P3.6.5: 重名检查 (限定在同 category)
    r = await db.execute(
        select(SiteAsset).where(
            SiteAsset.site_id == site_id,
            SiteAsset.category == category,
            SiteAsset.name == name,
        )
    )
    existing = r.scalar_one_or_none()
    if existing:
        # 删掉刚写的文件 (避免孤儿)
        try:
            os.remove(target)
        except OSError:
            pass
        raise Conflict(f"资源 '{name}' 在 '{category}/' 已存在 (用 PATCH 更新或先 DELETE)")
    else:
        asset = SiteAsset(
            site_id=site_id,
            category=category,
            name=name,
            original_filename=file.filename,
            file_path=str(target),
            content_type=content_type,
            byte_size=size,
            description=description,
        )
        db.add(asset)

    await db.commit()
    await db.refresh(asset)
    return ok(_to_read(asset, site.slug))


@router.post("/sites/{site_id}/assets/import-from-url", response_model=None)
async def import_asset_from_url(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    body: Annotated[dict, Body()],
):
    """从外网 URL 拉取文件并写入站点资源 (AI 增强 · 图片本地化)

    body: { url: string, name?: string, category?: 'assets' }
    服务端代拉，避免浏览器 CORS。
    已按同源 URL / 内容 sha256 入库的资源会直接复用，不重复生成。
    """
    import hashlib
    import httpx
    from urllib.parse import urlparse, unquote

    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无写权限")

    raw_url = (body.get("url") or "").strip()
    if not raw_url or not raw_url.startswith(("http://", "https://")):
        raise BadRequest("url 必须是 http(s) 外链")

    category = (body.get("category") or "assets").strip()
    if category not in ASSET_CATEGORIES:
        raise BadRequest(f"category 必须是 {ASSET_CATEGORIES} 之一")

    url_key = raw_url[:200]

    async def _find_existing_by_url_or_hash(digest: str | None = None) -> SiteAsset | None:
        r = await db.execute(
            select(SiteAsset).where(
                SiteAsset.site_id == site_id,
                SiteAsset.category == category,
                SiteAsset.description.isnot(None),
            )
        )
        for a in r.scalars().all():
            desc = a.description or ""
            # 同源 URL（含历史 description: "imported from {url}"）
            if desc.startswith(f"imported from {url_key}") or (raw_url in desc):
                return a
            if digest and f"sha256:{digest}" in desc:
                return a
        return None

    # 拉取前：按源 URL 去重（避免重复下载）
    # 若历史误把微信防盗链小 GIF 入库，跳过复用并重新拉取
    existed = await _find_existing_by_url_or_hash()
    if existed:
        bad_placeholder = (
            (existed.byte_size or 0) < 4096
            and (existed.content_type or "").lower().startswith("image/gif")
            and any(x in raw_url.lower() for x in ("qpic.cn", "mmbiz"))
        )
        if not bad_placeholder:
            return ok(_to_read(existed, site.slug))
        # 继续走下方重新拉取；入库时若同名会换名，旧坏文件仍留着，可手动删

    # 先拉取，再按 Content-Type / URL 推断扩展名（CDN 常无后缀，禁止用 .bin）
    # 微信 CDN 无 Referer 时常返回「此图片来自微信公众平台」占位图，需伪装浏览器
    parsed_for_host = urlparse(raw_url)
    host = (parsed_for_host.netloc or "").lower()
    fetch_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    if any(x in host for x in ("qpic.cn", "mmbiz", "weixin.qq.com", "wechat.com")):
        fetch_headers["Referer"] = "https://mp.weixin.qq.com/"

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
            resp = await client.get(raw_url, headers=fetch_headers)
            resp.raise_for_status()
            content = resp.content
            content_type = (resp.headers.get("content-type") or "application/octet-stream").split(";")[0].strip().lower()
    except Exception as e:
        raise BadRequest(f"拉取外链失败: {e}") from e

    size = len(content)
    if size == 0:
        raise BadRequest("外链文件为空")
    if size > settings.SITE_ASSET_MAX_SIZE:
        raise BadRequest(f"文件过大: {size} bytes > 限制 {settings.SITE_ASSET_MAX_SIZE}")

    # 微信防盗链占位图多为极小 GIF；拒绝入库，避免「本地化成功但仍显示不可引用」
    if any(x in host for x in ("qpic.cn", "mmbiz")) and size < 4096 and content[:6] in (b"GIF87a", b"GIF89a"):
        raise BadRequest(
            "拉取到微信防盗链占位图（非原图）。请确认链接仍有效后重试；"
            "若仍失败，请手动下载后上传到站点资源。"
        )

    digest = hashlib.sha256(content).hexdigest()
    # 拉取后：按内容 hash 去重（同一文件不同 CDN URL）
    existed = await _find_existing_by_url_or_hash(digest)
    if existed:
        return ok(_to_read(existed, site.slug))

    _MIME_EXT = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
        "image/x-icon": ".ico",
        "image/vnd.microsoft.icon": ".ico",
        "image/bmp": ".bmp",
        "image/avif": ".webp",  # 无 avif 白名单时落 webp 名，实际仍存原字节
    }

    parsed = urlparse(raw_url)
    path_name = unquote(Path(parsed.path).name or "")
    path_name = re.sub(r"[^A-Za-z0-9._-]+", "-", path_name).strip(".-")
    url_ext = Path(path_name).suffix.lower() if path_name else ""
    mime_ext = _MIME_EXT.get(content_type, "")

    # 魔数兜底（无 Content-Type / 无后缀时）
    magic_ext = ""
    if content[:3] == b"\xff\xd8\xff":
        magic_ext = ".jpg"
    elif content[:8] == b"\x89PNG\r\n\x1a\n":
        magic_ext = ".png"
    elif content[:6] in (b"GIF87a", b"GIF89a"):
        magic_ext = ".gif"
    elif content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        magic_ext = ".webp"
    elif content.lstrip().startswith((b"<svg", b"<?xml")):
        magic_ext = ".svg"

    allowed_exts = (
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp",
        ".woff", ".woff2", ".ttf", ".otf", ".eot",
        ".txt", ".json", ".xml", ".pdf", ".mp4", ".webm", ".mp3",
    )
    ext = url_ext if url_ext in allowed_exts else (mime_ext or magic_ext or ".png")
    if ext == ".jpeg":
        ext = ".jpg"

    stem = Path(path_name).stem if path_name else "remote"
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip(".-") or "remote"
    stem = stem[:80]
    if not re.match(r"^[A-Za-z0-9]", stem):
        stem = f"img-{stem}"

    name = (body.get("name") or f"ext-{uuid.uuid4().hex[:8]}-{stem}{ext}").strip()
    # 若调用方给的 name 无合法后缀，强制补上
    if not any(name.lower().endswith(e) for e in allowed_exts):
        name = f"{name}{ext}"
    _check_name(name)
    try:
        validate_category_for_ext(category, name)
    except Exception as e:
        # 统一成业务 BadRequest，前端能读到 message
        raise BadRequest(getattr(e, "detail", None) or str(e)) from e

    if not (
        content_type.startswith(_ALLOWED_MIME_PREFIXES)
        or content_type in ("application/octet-stream",)
    ):
        if magic_ext or name.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp")):
            content_type = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".gif": "image/gif",
                ".webp": "image/webp",
                ".svg": "image/svg+xml",
                ".ico": "image/x-icon",
                ".bmp": "image/bmp",
            }.get(ext, "image/png")
        else:
            raise BadRequest(f"不支持的 MIME: {content_type}")

    try:
        validate_category_for_mime(category, content_type)
    except Exception:
        # MIME 不在白名单但已确认是图片字节 → 按扩展名校正
        if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp"):
            content_type = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".gif": "image/gif",
                ".webp": "image/webp",
                ".svg": "image/svg+xml",
                ".ico": "image/x-icon",
                ".bmp": "image/bmp",
            }.get(ext, "image/png")
        else:
            raise

    # 重名则换名
    base_name = name
    for i in range(0, 20):
        candidate = base_name if i == 0 else f"{Path(base_name).stem}-{i}{Path(base_name).suffix}"
        r = await db.execute(
            select(SiteAsset).where(
                SiteAsset.site_id == site_id,
                SiteAsset.category == category,
                SiteAsset.name == candidate,
            )
        )
        if not r.scalar_one_or_none():
            name = candidate
            break
    else:
        raise Conflict("无法生成唯一资源名")

    asset_dir = _asset_dir(site_id, category)
    target = asset_dir / name
    with open(target, "wb") as f:
        f.write(content)

    asset = SiteAsset(
        site_id=site_id,
        category=category,
        name=name,
        original_filename=path_name or name,
        file_path=str(target),
        content_type=content_type,
        byte_size=size,
        description=f"imported from {url_key} | sha256:{digest}",
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return ok(_to_read(asset, site.slug))


@router.get("/sites/{site_id}/assets/{category}/{name}", response_model=None)
async def get_asset(
    site_id: uuid.UUID,
    category: str,
    name: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """按 (category, name) 查资源 (P3.6.5: 路径带 category)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无访问权限")

    r = await db.execute(
        select(SiteAsset).where(
            SiteAsset.site_id == site_id,
            SiteAsset.category == category,
            SiteAsset.name == name,
        )
    )
    asset = r.scalar_one_or_none()
    if not asset:
        raise NotFound("资源不存在")
    return ok(_to_read(asset, site.slug))


@router.patch("/sites/{site_id}/assets/{category}/{name}", response_model=None)
async def update_asset(
    site_id: uuid.UUID,
    category: str,
    name: str,
    payload: SiteAssetUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """更新资源元数据 (rename / description). P3.6.5: name 不可跨 category."""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无写权限")

    r = await db.execute(
        select(SiteAsset).where(
            SiteAsset.site_id == site_id,
            SiteAsset.category == category,
            SiteAsset.name == name,
        )
    )
    asset = r.scalar_one_or_none()
    if not asset:
        raise NotFound("资源不存在")

    new_name = payload.name or asset.name
    if payload.name and payload.name != asset.name:
        _check_name(payload.name)
        # P3.6.5: 重命名保持同 category, 校验扩展名兼容
        validate_category_for_ext(category, payload.name)
        # 检查新名在同 category 内不冲突
        conflict = await db.execute(
            select(SiteAsset).where(
                SiteAsset.site_id == site_id,
                SiteAsset.category == category,
                SiteAsset.name == payload.name,
            )
        )
        if conflict.scalar_one_or_none():
            raise BadRequest(f"资源 '{payload.name}' 在 '{category}/' 已存在")
        # 重命名文件 (P3.6.5: 路径在 category 子目录下)
        old_path = Path(asset.file_path)
        new_path = _asset_dir(site_id, category) / payload.name
        if old_path.exists():
            shutil.move(str(old_path), str(new_path))
        asset.name = payload.name
        asset.file_path = str(new_path)

    if payload.description is not None:
        asset.description = payload.description

    await db.commit()
    await db.refresh(asset)
    return ok(_to_read(asset, site.slug))


@router.delete("/sites/{site_id}/assets/{category}/{name}")
async def delete_asset(
    site_id: uuid.UUID,
    category: str,
    name: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """删除资源 (P3.6.5: 路径带 category, 真删文件 + DB)"""
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_delete(role):
        raise Forbidden("仅 owner 可删除")

    r = await db.execute(
        select(SiteAsset).where(
            SiteAsset.site_id == site_id,
            SiteAsset.category == category,
            SiteAsset.name == name,
        )
    )
    asset = r.scalar_one_or_none()
    if not asset:
        raise NotFound("资源不存在")

    # 真删文件
    if asset.file_path and os.path.exists(asset.file_path):
        try:
            os.remove(asset.file_path)
        except OSError:
            pass  # 文件已不在, 静默

    await db.delete(asset)
    await db.commit()
    return ok({"deleted": name, "category": category})


# === P3.6.3: 在线编辑纯文本类资源 (CSS/JS/JSON/XML/SVG) ===

@router.get("/sites/{site_id}/assets/{category}/{name}/content")
async def get_asset_content(
    site_id: uuid.UUID,
    category: str,
    name: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """读取资源原始内容 (供在线编辑器用)

    返回: { content, content_type, editable }
    - editable=true: 可在编辑器里改
    - editable=false: 二进制资源, 需重新上传
    """
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无访问权限")

    r = await db.execute(
        select(SiteAsset).where(
            SiteAsset.site_id == site_id, SiteAsset.category == category, SiteAsset.name == name,
        )
    )
    asset = r.scalar_one_or_none()
    if not asset:
        raise NotFound("资源不存在")

    is_editable = asset.content_type.startswith(EDITABLE_MIME_PREFIXES) \
        and asset.byte_size <= EDITABLE_MAX_BYTES
    content = ""
    if is_editable and asset.file_path and os.path.exists(asset.file_path):
        try:
            with open(asset.file_path, "r", encoding="utf-8") as f:
                content = f.read()
        except UnicodeDecodeError:
            # 编码错误 → 不可编辑
            is_editable = False
    return ok({
        "name": asset.name,
        "content_type": asset.content_type,
        "byte_size": asset.byte_size,
        "editable": is_editable,
        "content": content,
    })


# P3.6.5+: 直接吐原始文件二进制, 用于 admin 缩略图预览 (不依赖发布后的 /sites/{slug}/assets/{name})
@router.get("/sites/{site_id}/assets/{category}/{name}/binary")
async def get_asset_binary(
    site_id: uuid.UUID,
    category: str,
    name: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """P3.6.5+ 原始文件二进制 (供 admin 预览, 不走 public URL)

    - 权限: 跟 read 一致 (viewer+ 可访问)
    - Cache-Control: 5 分钟 (后台改文件能及时看到)
    - 不存在的物理文件: 404 (不降级到 placeholder)
    """
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_read(role):
        raise Forbidden("无访问权限")

    r = await db.execute(
        select(SiteAsset).where(
            SiteAsset.site_id == site_id, SiteAsset.category == category, SiteAsset.name == name,
        )
    )
    asset = r.scalar_one_or_none()
    if not asset:
        raise NotFound("资源不存在")

    if not asset.file_path or not os.path.exists(asset.file_path):
        raise NotFound("文件不存在 (可能仅存于 DB, 物理文件丢失)")

    return FileResponse(
        asset.file_path,
        media_type=asset.content_type or "application/octet-stream",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.put("/sites/{site_id}/assets/{category}/{name}/content", response_model=None)
async def update_asset_content(
    site_id: uuid.UUID,
    category: str,
    name: str,
    payload: SiteAssetContentUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """在线更新资源内容 (纯文本类)

    - 只能编辑 text/* / javascript / json / xml / svg+xml
    - 改后 file_path 不变, byte_size 重算
    - 重启 nginx 不需要 (静态文件每次请求都重读)
    - 发布后才会出现在 public/assets/ (本接口不触发发布)
    """
    site = await _get_site_or_404(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无写权限")

    r = await db.execute(
        select(SiteAsset).where(
            SiteAsset.site_id == site_id, SiteAsset.category == category, SiteAsset.name == name,
        )
    )
    asset = r.scalar_one_or_none()
    if not asset:
        raise NotFound("资源不存在")

    if not asset.content_type.startswith(EDITABLE_MIME_PREFIXES):
        raise BadRequest(
            f"该资源类型不支持在线编辑: {asset.content_type} (仅 text/* / javascript / json / xml / svg+xml 可编辑)"
        )

    new_bytes = payload.content.encode("utf-8")
    if len(new_bytes) > EDITABLE_MAX_BYTES:
        raise BadRequest(f"内容过大: {len(new_bytes)} bytes > 限制 {EDITABLE_MAX_BYTES}")

    # 写文件
    if not asset.file_path:
        raise BadRequest("资源文件路径丢失, 请重新上传")

    # 备份原内容到临时 (避免部分写入损坏)
    backup = None
    if os.path.exists(asset.file_path):
        backup = asset.file_path + ".bak"
        shutil.copy2(asset.file_path, backup)

    try:
        with open(asset.file_path, "w", encoding="utf-8") as f:
            f.write(payload.content)
    except Exception as e:
        # 回滚
        if backup and os.path.exists(backup):
            shutil.copy2(backup, asset.file_path)
        raise BadRequest(f"写文件失败: {e}")
    finally:
        if backup and os.path.exists(backup):
            try:
                os.remove(backup)
            except OSError:
                pass

    # 更新元数据
    asset.byte_size = len(new_bytes)
    asset.original_filename = name  # 编辑后 original_filename 不变意义了, 同步成 name

    await db.commit()
    await db.refresh(asset)
    return ok(_to_read(asset, site.slug))
