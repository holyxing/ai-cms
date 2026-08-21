"""主题管理 API (P2)

依据:
- docs/04b-数据模型.md §4.1-4.2
- docs/12-P2-决策.md §A2 (全局库 + 站级实例) + §B1 (新站自动 apply) + §B2 (切换不自动发布) + §B3 (改即存新 version) + §F2 (token sanitize)
- docs/10-权限矩阵.md §2.3 (owner/editor 可改, viewer 只读)

端点 (URL 前缀 /api/v1):
- GET    /themes                          主题库列表 (全局, 不分 site)
- GET    /themes/{id}                     主题详情
- POST   /themes                          创建 custom 主题 (从 base 复制)
- GET    /sites/{site_id}/themes/current  当前激活版本
- POST   /sites/{site_id}/themes/apply    应用主题 (= 新建 theme_version)
- PUT    /sites/{site_id}/themes/current  改 token (= 新建 theme_version)
- GET    /sites/{site_id}/themes/history  版本历史
- POST   /sites/{site_id}/themes/revert   回滚到指定 version
"""
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
settings = get_settings()
from app.core.deps import CurrentUser
from app.core.exceptions import BadRequest, Forbidden, NotFound
from app.core.responses import ok, page_resp
from app.db.session import get_db
from app.models.membership import SiteMember
from app.models.site import Site
from app.models.theme import Theme
from app.models.theme_version import ThemeVersion
from app.models.user import User
from app.schemas.theme import (
    ThemeCreate,
    ThemeListItem,
    ThemeRead,
    ThemeUpdate,
    validate_tokens,
)
from app.schemas.theme_version import (
    ThemeCurrentRead,
    ThemeReadLite,
    ThemeVersionListItem,
    ThemeVersionRead,
    ThemeVersionUpdate,
)

router = APIRouter(tags=["themes"])


# === 权限辅助 (与 P1 模块一致) ===
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
    role = r.scalar_one_or_none()
    return role


async def _get_site(db: AsyncSession, site_id: uuid.UUID) -> Site:
    site = await db.get(Site, site_id)
    if site is None or site.deleted_at is not None:
        raise NotFound("站点不存在")
    return site


# === 序列化 ===
def _to_list_item(t: Theme) -> ThemeListItem:
    color_obj = (t.default_tokens or {}).get("color", {})
    return ThemeListItem(
        id=t.id,
        code=t.code,
        display_name=t.display_name,
        type=t.type,
        template_name=t.template_name,
        # preview_image 可能是相对路径 (/previews/x.svg) 或完整 URL
        preview_image=(
            t.preview_image if (t.preview_image or "").startswith(("http://", "https://"))
            else (f"{settings.FRONTEND_BASE}{t.preview_image}" if t.preview_image else None)
        ),
        is_default=t.is_default,
        color_count=len(color_obj) if isinstance(color_obj, dict) else 0,
        primary_color=color_obj.get("primary") if isinstance(color_obj, dict) else None,
        # P3.10.4: layout edit 页 AI theme 兑底用 default_tokens (site 未应用主题时)
        default_tokens=t.default_tokens or {},
    )


def _to_version_read(v: ThemeVersion, author_name: str | None = None, theme_code: str | None = None) -> ThemeVersionRead:
    return ThemeVersionRead(
        id=v.id,
        site_id=v.site_id,
        theme_id=v.theme_id,
        version=v.version,
        tokens=v.tokens,
        is_active=v.is_active,
        is_ai_generated=v.is_ai_generated,
        prompt=v.prompt,
        change_note=v.change_note,
        author_id=v.author_id,
        author_name=author_name,
        theme_code=theme_code,
        created_at=v.created_at,
    )


# === 1. 主题库 (全局, 不分 site) ===
@router.get("/themes", response_model=None)
async def list_themes(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    type: Annotated[str | None, Query(description="preset | custom")] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
) -> dict[str, Any]:
    """主题库列表 - 全局共享"""
    q = select(Theme).where(Theme.deleted_at.is_(None))
    if type:
        q = q.where(Theme.type == type)
    cnt_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(cnt_q)).scalar_one()
    q = q.order_by(Theme.is_default.desc(), Theme.code).offset((page - 1) * page_size).limit(page_size)
    items = (await db.execute(q)).scalars().all()
    return page_resp(
        [_to_list_item(t) for t in items], total=total, page=page, page_size=page_size,
    )


@router.get("/themes/{theme_id}", response_model=None)
async def get_theme(
    theme_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """主题详情"""
    t = await db.get(Theme, theme_id)
    if t is None or t.deleted_at is not None:
        raise NotFound("主题不存在")
    return ok(ThemeRead.model_validate(t).model_dump(mode="json"))


@router.post("/themes", response_model=None, status_code=201)
async def create_custom_theme(
    body: ThemeCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """创建 custom 主题 (从 base 复制)"""
    # 唯一性
    exist = (await db.execute(select(Theme).where(Theme.code == body.code, Theme.deleted_at.is_(None)))).scalar_one_or_none()
    if exist is not None:
        raise BadRequest(f"code={body.code} 已存在")
    # base 校验
    if body.base_theme_id:
        base = await db.get(Theme, body.base_theme_id)
        if base is None or base.deleted_at is not None:
            raise BadRequest("base_theme_id 不存在")
    # token 校验 (F2)
    try:
        validate_tokens(body.default_tokens)
    except ValueError as e:
        raise BadRequest(f"token 校验失败: {e}")
    t = Theme(
        code=body.code,
        display_name=body.display_name,
        type="custom",
        base_theme_id=body.base_theme_id,
        template_name=body.template_name,
        preview_image=body.preview_image,
        is_default=False,
        default_tokens=body.default_tokens,
        tokens_schema=body.tokens_schema or {},
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return ok(ThemeRead.model_validate(t).model_dump(mode="json"), message="主题已创建")


# === 2. 站级应用 ===
async def _next_version(db: AsyncSession, site_id: uuid.UUID) -> int:
    r = await db.execute(
        select(func.coalesce(func.max(ThemeVersion.version), 0)).where(ThemeVersion.site_id == site_id)
    )
    return r.scalar_one() + 1


async def _deactivate_current(db: AsyncSession, site_id: uuid.UUID) -> None:
    """把当前 active version 设为非 active"""
    r = await db.execute(
        select(ThemeVersion).where(
            ThemeVersion.site_id == site_id, ThemeVersion.is_active == True,  # noqa: E712
        )
    )
    for v in r.scalars().all():
        v.is_active = False


@router.get("/sites/{site_id}/themes/current", response_model=None)
async def get_current_theme(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """当前激活主题版本"""
    site = await _get_site(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if role is None:
        raise Forbidden("无权访问该站点")
    r = await db.execute(
        select(ThemeVersion).where(
            ThemeVersion.site_id == site_id, ThemeVersion.is_active == True,  # noqa: E712
        )
    )
    v = r.scalar_one_or_none()
    if v is None:
        raise NotFound("站点尚未应用主题")
    theme = await db.get(Theme, v.theme_id)
    # author name
    author = await db.get(User, v.author_id)
    return ok(ThemeCurrentRead(
        version=_to_version_read(v, author_name=author.name if author else None,
                                 theme_code=theme.code if theme else None),
        theme=ThemeReadLite.model_validate(theme),
    ).model_dump(mode="json"))


@router.post("/sites/{site_id}/themes/apply", response_model=None, status_code=201)
async def apply_theme(
    site_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """应用主题 = 选 theme + 创建新 version

    Body: {"theme_id": "...", "change_note": "..."}
    """
    site = await _get_site(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if role not in ("owner", "editor"):
        raise Forbidden("需要 owner/editor 权限")
    theme_id_str = body.get("theme_id")
    if not theme_id_str:
        raise BadRequest("theme_id 必填")
    try:
        theme_id = uuid.UUID(theme_id_str)
    except ValueError:
        raise BadRequest("theme_id 格式错误")
    theme = await db.get(Theme, theme_id)
    if theme is None or theme.deleted_at is not None:
        raise NotFound("主题不存在")
    # 切换 = 新 version + 旧 deactivate
    await _deactivate_current(db, site_id)
    next_v = await _next_version(db, site_id)
    new_v = ThemeVersion(
        site_id=site_id,
        theme_id=theme_id,
        version=next_v,
        tokens=theme.default_tokens,  # 用主题库默认 tokens 作种子
        is_active=True,
        is_ai_generated=False,
        change_note=body.get("change_note", f"应用主题 {theme.code}"),
        author_id=current_user.id,
    )
    db.add(new_v)
    await db.commit()
    await db.refresh(new_v)
    return ok(
        _to_version_read(new_v, author_name=current_user.name, theme_code=theme.code).model_dump(mode="json"),
        message=f"已应用主题 {theme.display_name}，去发布？",
    )


@router.put("/sites/{site_id}/themes/current", response_model=None, status_code=201)
async def update_current_theme_tokens(
    site_id: uuid.UUID,
    body: ThemeVersionUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """改 token = 创建新 version (旧 deactivate)

    Body: {"tokens": {...}, "change_note": "..."}
    """
    site = await _get_site(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if role not in ("owner", "editor"):
        raise Forbidden("需要 owner/editor 权限")
    # 当前 active version
    r = await db.execute(
        select(ThemeVersion).where(
            ThemeVersion.site_id == site_id, ThemeVersion.is_active == True,  # noqa: E712
        )
    )
    current = r.scalar_one_or_none()
    if current is None:
        raise NotFound("站点尚未应用主题, 请先 apply")
    # 校验 tokens
    try:
        validate_tokens(body.tokens)
    except ValueError as e:
        raise BadRequest(f"token 校验失败: {e}")
    # 深度合并: 新 tokens 覆盖当前 tokens
    new_tokens = _deep_merge(current.tokens, body.tokens)
    await _deactivate_current(db, site_id)
    next_v = await _next_version(db, site_id)
    new_version = ThemeVersion(
        site_id=site_id,
        theme_id=current.theme_id,
        version=next_v,
        tokens=new_tokens,
        is_active=True,
        is_ai_generated=False,
        change_note=body.change_note,
        author_id=current_user.id,
    )
    db.add(new_version)
    await db.commit()
    await db.refresh(new_version)
    theme = await db.get(Theme, current.theme_id)
    return ok(
        _to_version_read(new_version, author_name=current_user.name,
                         theme_code=theme.code if theme else None).model_dump(mode="json"),
        message=f"已保存为 v{next_v}",
    )


@router.get("/sites/{site_id}/themes/history", response_model=None)
async def list_theme_history(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    """版本历史"""
    site = await _get_site(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if role is None:
        raise Forbidden("无权访问该站点")
    base_q = select(ThemeVersion).where(ThemeVersion.site_id == site_id)
    total = (await db.execute(select(func.count()).select_from(base_q.subquery()))).scalar_one()
    items = (await db.execute(
        base_q.order_by(ThemeVersion.version.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    # 关联 author/theme
    out = []
    for v in items:
        author = await db.get(User, v.author_id)
        theme = await db.get(Theme, v.theme_id)
        out.append(ThemeVersionListItem(
            id=v.id,
            version=v.version,
            is_active=v.is_active,
            is_ai_generated=v.is_ai_generated,
            change_note=v.change_note,
            author_id=v.author_id,
            author_name=author.name if author else None,
            theme_code=theme.code if theme else None,
            created_at=v.created_at,
        ))
    return page_resp(out, total=total, page=page, page_size=page_size)


@router.post("/sites/{site_id}/themes/revert/{version_id}", response_model=None, status_code=201)
async def revert_to_version(
    site_id: uuid.UUID,
    version_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """回滚到指定 version (创建新 version, 复制旧 tokens)"""
    site = await _get_site(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if role not in ("owner", "editor"):
        raise Forbidden("需要 owner/editor 权限")
    target = await db.get(ThemeVersion, version_id)
    if target is None or target.site_id != site_id:
        raise NotFound("目标版本不存在")
    if target.is_active:
        raise BadRequest("目标版本已是当前激活")
    await _deactivate_current(db, site_id)
    next_v = await _next_version(db, site_id)
    new_version = ThemeVersion(
        site_id=site_id,
        theme_id=target.theme_id,
        version=next_v,
        tokens=target.tokens,
        is_active=True,
        is_ai_generated=False,
        change_note=f"回滚到 v{target.version}",
        author_id=current_user.id,
    )
    db.add(new_version)
    await db.commit()
    await db.refresh(new_version)
    theme = await db.get(Theme, target.theme_id)
    return ok(
        _to_version_read(new_version, author_name=current_user.name,
                         theme_code=theme.code if theme else None).model_dump(mode="json"),
        message=f"已回滚到 v{target.version}，新版本为 v{next_v}",
    )


def _deep_merge(base: dict, overlay: dict) -> dict:
    """深度合并: overlay 覆盖 base 的同名 key"""
    out = dict(base)
    for k, v in overlay.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out
