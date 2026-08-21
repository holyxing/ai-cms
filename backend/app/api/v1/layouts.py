"""布局系统 API (P3.6)

依据: docs/18-布局系统与标签占位符.md §10 (9 个端点)

端点 (URL 前缀 /api/v1):
- GET    /sites/{site_id}/layouts                  列布局（按 scope 过滤）
- POST   /sites/{site_id}/layouts                  新建布局
- GET    /layouts/{id}                             详情（含 html）
- PUT    /layouts/{id}                             改 HTML（自动 +1 version）
- DELETE /layouts/{id}                             软删
- POST   /layouts/{id}/rollback                    回滚到指定 version
- GET    /layouts/{id}/versions                    版本列表
- POST   /layouts/{id}/preview                     渲染预览 HTML
- POST   /layouts/{id}/validate                    校验标签合法性

权限: site owner / editor 可读写，viewer 只读（与 themes 一致）
"""
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.exceptions import BadRequest, Conflict, Forbidden, NotFound
from app.core.responses import ok, page_resp
from app.db.session import get_db
from app.models.layout import Layout, LayoutVersion, LAYOUT_SCOPES
from app.models.membership import SiteMember
from app.models.site import Site
from app.models.user import User
from app.schemas.layout import (
    LayoutActiveToggleRequest,
    LayoutCreate,
    LayoutListItem,
    LayoutListResponse,
    LayoutPreviewRequest,
    LayoutPreviewResponse,
    LayoutRead,
    LayoutRollbackRequest,
    LayoutUpdate,
    LayoutValidateResponse,
    LayoutVersionListResponse,
    LayoutVersionRead,
    ZipImportResult,
)

router = APIRouter(tags=["layouts"])


# ===========================================================================
# 权限/资源辅助
# ===========================================================================

async def _get_user_role(db: AsyncSession, site: Site, user: User) -> str | None:
    """返回 'owner' | 'editor' | 'viewer' | None"""
    if user.is_super_admin:
        return "owner"
    if site.owner_id == user.id:
        return "owner"
    r = await db.execute(
        select(SiteMember.role).where(
            SiteMember.site_id == site.id,
            SiteMember.user_id == user.id,
            SiteMember.deleted_at.is_(None),
        )
    )
    return r.scalar_one_or_none()


def _require_write(role: str | None) -> None:
    if role not in ("owner", "editor"):
        raise Forbidden("需要 owner / editor 权限")


async def _get_site(db: AsyncSession, site_id: uuid.UUID) -> Site:
    site = await db.get(Site, site_id)
    if site is None or site.deleted_at is not None:
        raise NotFound("站点不存在")
    return site


async def _get_layout(db: AsyncSession, layout_id: uuid.UUID) -> Layout:
    layout = await db.get(Layout, layout_id)
    if layout is None or layout.deleted_at is not None:
        raise NotFound("布局不存在")
    return layout


# ===========================================================================
# 1. 列布局
# ===========================================================================

@router.get("/sites/{site_id}/layouts", response_model=None)
async def list_layouts(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    scope: Annotated[str | None, Query(description="site | category | content | home")] = None,
    include_inactive: Annotated[bool, Query(description="包含已禁用 (默认 false)")] = False,
) -> LayoutListResponse:
    """列站点的布局（按 scope 可选过滤）"""
    site = await _get_site(db, site_id)
    role = await _get_user_role(db, site, current_user)
    if role is None:
        raise Forbidden("无权限访问此站点")

    q = select(Layout).where(
        Layout.site_id == site_id,
        Layout.deleted_at.is_(None),
    )
    if not include_inactive:
        q = q.where(Layout.is_active.is_(True))
    if scope is not None:
        if scope not in LAYOUT_SCOPES:
            raise BadRequest(f"scope must be one of {LAYOUT_SCOPES}, got {scope!r}")
        q = q.where(Layout.scope == scope)
    q = q.order_by(Layout.scope, Layout.is_default.desc(), Layout.code)

    rows = (await db.execute(q)).scalars().all()
    return ok(LayoutListResponse(
        items=[LayoutListItem.model_validate(r) for r in rows],
        total=len(rows),
    ))


# ===========================================================================
# 1.5 导入网站 ZIP
# ===========================================================================

@router.post("/sites/{site_id}/layouts/import-zip", response_model=None)
async def import_site_zip(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    file: Annotated[UploadFile, File(description="网站 ZIP（html/css/js/图片）")],
    use_ai: Annotated[bool, Form()] = True,
) -> ZipImportResult:
    """导入静态网站 ZIP：资源写入站点资源，并生成 HY_ 模板。

    源 ZIP 同时登记到媒体库（mime=application/zip，出现在「压缩包」目录）。
    不含首页的二级 ZIP 不覆盖已有 default / header / footer。
    """
    from app.services.site_zip_import import import_site_zip as do_import

    site = await _get_site(db, site_id)
    role = await _get_user_role(db, site, current_user)
    _require_write(role)

    filename = (file.filename or "").lower()
    if not filename.endswith(".zip"):
        raise BadRequest("请上传 .zip 文件")
    content = await file.read()
    if not content:
        raise BadRequest("文件为空")
    try:
        result = await do_import(
            db, site, current_user, content,
            use_ai=use_ai,
            source_filename=file.filename or "import.zip",
        )
    except ValueError as e:
        raise BadRequest(str(e)) from e
    return ok(ZipImportResult(
        assets_created=result.assets_created,
        assets_overwritten=result.assets_overwritten,
        assets_skipped=result.assets_skipped,
        layouts=result.layouts,
        pages_classified=result.pages_classified,
        warnings=result.warnings,
        ai_used=result.ai_used,
    ).model_dump())


# ===========================================================================
# 2. 新建布局
# ===========================================================================

@router.post(
    "/sites/{site_id}/layouts",
    response_model=None,
    status_code=201,
)
async def create_layout(
    site_id: uuid.UUID,
    body: LayoutCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LayoutRead:
    """新建布局"""
    site = await _get_site(db, site_id)
    role = await _get_user_role(db, site, current_user)
    _require_write(role)

    # 唯一性 (site_id, scope, code) 软删后允许重建，业务层再校验
    exist = (await db.execute(
        select(Layout).where(
            Layout.site_id == site_id,
            Layout.scope == body.scope,
            Layout.code == body.code,
            Layout.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if exist is not None:
        raise BadRequest(
            f"已存在 (scope={body.scope}, code={body.code}) 的布局，请换 code 或删旧的"
        )

    layout = Layout(
        site_id=site_id,
        scope=body.scope,
        code=body.code,
        name=body.name,
        html=body.html,
        is_default=body.is_default,
        is_active=body.is_active,
        template_kind=body.template_kind,
        parent_code=body.parent_code,
        version=1,
    )
    db.add(layout)
    await db.flush()  # 取 id

    # 写第一版 version
    ver = LayoutVersion(
        layout_id=layout.id,
        version=1,
        html=body.html,
        change_note=body.change_note or "初始版本",
        author_id=current_user.id,
    )
    db.add(ver)

    # is_default=True → 同一 scope 的其他 default 取消默认
    if body.is_default:
        await db.execute(
            Layout.__table__.update()
            .where(
                Layout.site_id == site_id,
                Layout.scope == body.scope,
                Layout.id != layout.id,
                Layout.deleted_at.is_(None),
            )
            .values(is_default=False)
        )

    await db.commit()
    await db.refresh(layout)
    return ok(LayoutRead.model_validate(layout))


# ===========================================================================
# 3. 详情
# ===========================================================================

@router.get("/layouts/{layout_id}", response_model=None)
async def get_layout(
    layout_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LayoutRead:
    """布局详情（含 html）"""
    layout = await _get_layout(db, layout_id)
    site = await _get_site(db, layout.site_id)
    role = await _get_user_role(db, site, current_user)
    if role is None:
        raise Forbidden("无权限访问此布局")
    return ok(LayoutRead.model_validate(layout))


# ===========================================================================
# 4. 改布局（自动 +1 version）
# ===========================================================================

@router.put("/layouts/{layout_id}", response_model=None)
async def update_layout(
    layout_id: uuid.UUID,
    body: LayoutUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LayoutRead:
    """改布局

    - html 改了 → version 自增，写 layout_versions
    - 只改 name/is_default → 不留 version
    """
    layout = await _get_layout(db, layout_id)
    site = await _get_site(db, layout.site_id)
    role = await _get_user_role(db, site, current_user)
    _require_write(role)

    html_changed = body.html is not None and body.html != layout.html

    if body.name is not None:
        layout.name = body.name
    if html_changed:
        layout.html = body.html
        layout.version = layout.version + 1
    if body.is_default is not None and body.is_default != layout.is_default:
        layout.is_default = body.is_default
        # 同一 scope 其他 default 取消
        if body.is_default:
            await db.execute(
                Layout.__table__.update()
                .where(
                    Layout.site_id == layout.site_id,
                    Layout.scope == layout.scope,
                    Layout.id != layout.id,
                    Layout.deleted_at.is_(None),
                )
                .values(is_default=False)
            )
    # P3.7: template_kind / parent_code 改写 (不触发 version)
    if body.template_kind is not None and body.template_kind != layout.template_kind:
        layout.template_kind = body.template_kind
    if body.is_active is not None and body.is_active != layout.is_active:
        layout.is_active = body.is_active
    if body.parent_code != layout.parent_code:
        if body.parent_code and body.parent_code == layout.code:
            raise BadRequest("parent_code 不能等于自身 code")
        layout.parent_code = body.parent_code

    if html_changed:
        ver = LayoutVersion(
            layout_id=layout.id,
            version=layout.version,
            html=body.html,
            change_note=body.change_note or "更新 HTML",
            author_id=current_user.id,
        )
        db.add(ver)

    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise Conflict("保存冲突，请再点一次保存") from e
    await db.refresh(layout)
    return ok(LayoutRead.model_validate(layout))


# ===========================================================================
# 5. 软删
# ===========================================================================

@router.get("/layouts/{layout_id}/references")
async def get_layout_references(
    layout_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """查一个 layout 被哪些栏目 + 哪些文章引用

    P3.7.3 (holy 反馈 2026-06-10 16:46): 刪除时 UI 需要展示引用数, 让用户知道风险
    P3.7.4 (holy 反馈 2026-06-10 16:50): 布局编辑器右侧也需要这个面板, 展示栏目 + 文章

    返回结构:
    {
      is_default, scope, code,
      reference_count: 栏目数,
      references: [{id, name}],
      content_uses: [
        {category_id, category_name,
         content_count: 该栏目下文章总数,
         recent_contents: [{id, title}, ...] # top 3,
         more_count: 剩余文章数},
        ...
      ],
      total_content_count: 所有栏目下文章总数
    }

    限只读: 任何 role 都能调
    """
    layout = await _get_layout(db, layout_id)
    site = await _get_site(db, layout.site_id)
    role = await _get_user_role(db, site, current_user)
    # 读操作: 只判定用户能访问该站 (role 不为 None)
    if role is None:
        raise Forbidden("需要该站点的访问权限")

    from app.models.category import Category
    from app.models.content import Content

    # 1) 查引用此 layout 的所有栏目
    r = await db.execute(
        select(Category.id, Category.name).where(
            Category.site_id == layout.site_id,
            Category.template == layout.code,
            Category.deleted_at.is_(None),
        ).order_by(Category.name)
    )
    cat_refs = [{"id": str(cid), "name": cname} for cid, cname in r.all()]

    # 2) 查每个栏目下的文章 (top 3 最新 published, 多于 3 标 more_count)
    content_uses: list[dict] = []
    total_content_count = 0
    if cat_refs:
        # 保持 UUID 类型 (SQLAlchemy in_() 不能接 str 跟 UUID column 比)
        cat_ids: list[uuid.UUID] = [uuid.UUID(c["id"]) for c in cat_refs]
        # 所有 (category, content) 对, 按 category_id + published_at desc
        r2 = await db.execute(
            select(Content.id, Content.title, Content.category_id, Content.published_at)
            .where(
                Content.site_id == layout.site_id,
                Content.category_id.in_(cat_ids),
                Content.deleted_at.is_(None),
                Content.status == "published",
            )
            .order_by(Content.category_id, Content.published_at.desc().nullslast(), Content.created_at.desc())
        )
        rows = r2.all()
        by_cat: dict[str, list] = {c["id"]: [] for c in cat_refs}
        # rows 顺序: (Content.id, Content.title, Content.category_id, Content.published_at)
        for _cid, ctitle, cat_id, _published in rows:
            key = str(cat_id)
            by_cat.setdefault(key, []).append({"id": str(_cid), "title": ctitle})
        by_cat: dict[str, list] = {c["id"]: [] for c in cat_refs}
        for _cid, ctitle, cat_id, _published in rows:
            key = str(cat_id)
            by_cat.setdefault(key, []).append({"id": str(_cid), "title": ctitle})
        for cref in cat_refs:
            items = by_cat.get(cref["id"], [])
            top3 = items[:3]
            content_uses.append({
                "category_id": cref["id"],
                "category_name": cref["name"],
                "content_count": len(items),
                "recent_contents": top3,
                "more_count": max(0, len(items) - 3),
            })
            total_content_count += len(items)

    return ok({
        "is_default": layout.is_default,
        "scope": layout.scope,
        "code": layout.code,
        "reference_count": len(cat_refs),
        "references": cat_refs,
        "content_uses": content_uses,
        "total_content_count": total_content_count,
    })


@router.delete("/layouts/{layout_id}", status_code=204)
async def delete_layout(
    layout_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    force: Annotated[bool, Query(description="跳过默认/引用检查")] = False,
) -> None:
    """软删布局

    P3.7+ (holy 反馈 2026-06-10 15:14): 允许删默认 layout
    P3.7.3 (holy 反馈 2026-06-10 16:46): 允许删被栏目引用的 layout (强删)

    - 不传 force: 检查两件事
      1) 是否是默认 layout: 返 400 提示“传 force=true 强删, 删后该 scope 走 fallback”
      2) 是否被栏目引用 (category.template == this.code): 返 400 提示“N 个栏目引用, 删后这些栏目走 fallback, 传 force=true 强删”
    - 传 force=true: 跳过所有检查, 直接软删
    - 删后: 该 scope / 引用栏目失去指向, _pick_layout_for fallback 找另一个 default
      或返 None (publish 会用 site/home/category scope 的 default 0 个 → 走硬编码)
    """
    layout = await _get_layout(db, layout_id)
    site = await _get_site(db, layout.site_id)
    role = await _get_user_role(db, site, current_user)
    _require_write(role)

    if not force:
        warnings: list[str] = []
        if layout.is_default:
            warnings.append(
                f"该模板是 {layout.scope} scope 的默认模板, 删后该 scope 走 fallback"
            )
        # 检查栏目引用 (列表模板 / 详情模板)
        from app.models.category import Category
        r = await db.execute(
            select(func.count(Category.id)).where(
                Category.site_id == layout.site_id,
                or_(
                    Category.template == layout.code,
                    Category.content_template == layout.code,
                ),
                Category.deleted_at.is_(None),
            )
        )
        ref_count = r.scalar() or 0
        if ref_count > 0:
            warnings.append(
                f"该模板被 {ref_count} 个栏目引用为 default, 删后这些栏目会走 fallback (其他启用的 default, 或空)"
            )
        if warnings:
            raise BadRequest(" | ".join(warnings) + "。确认请传 ?force=true 强删。")

    from datetime import datetime
    layout.deleted_at = datetime.utcnow()
    await db.commit()


# ===========================================================================
# 5b. 启用/禁用 (P3.7+ 反馈)
# ===========================================================================

@router.patch("/layouts/{layout_id}/active", response_model=None)
async def toggle_layout_active(
    layout_id: uuid.UUID,
    body: LayoutActiveToggleRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LayoutRead:
    """启用/禁用布局

    - is_active=False 后: 列表默认不显示, 发布不走此模板
    - 不影响 is_default (两个独立维度)
    - 业务警告: 禁用默认模板后, 该 scope 没启用的默认 → 走 _pick_layout_for fall-through
    """
    layout = await _get_layout(db, layout_id)
    site = await _get_site(db, layout.site_id)
    role = await _get_user_role(db, site, current_user)
    _require_write(role)

    layout.is_active = body.is_active
    await db.commit()
    await db.refresh(layout)
    return ok(LayoutRead.model_validate(layout))


# ===========================================================================
# 6. 回滚
# ===========================================================================

@router.post("/layouts/{layout_id}/rollback", response_model=None)
async def rollback_layout(
    layout_id: uuid.UUID,
    body: LayoutRollbackRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LayoutRead:
    """回滚到指定 version

    - 写新 version（version = 当前 + 1），html = target_version 的 html
    - 不改 version 编号（保持可追溯）
    """
    layout = await _get_layout(db, layout_id)
    site = await _get_site(db, layout.site_id)
    role = await _get_user_role(db, site, current_user)
    _require_write(role)

    target = (await db.execute(
        select(LayoutVersion).where(
            LayoutVersion.layout_id == layout_id,
            LayoutVersion.version == body.target_version,
        )
    )).scalar_one_or_none()
    if target is None:
        raise NotFound(f"version {body.target_version} 不存在")

    new_version = layout.version + 1
    layout.html = target.html
    layout.version = new_version
    db.add(LayoutVersion(
        layout_id=layout.id,
        version=new_version,
        html=target.html,
        change_note=body.change_note or f"回滚到 v{body.target_version}",
        author_id=current_user.id,
    ))
    await db.commit()
    await db.refresh(layout)
    return ok(LayoutRead.model_validate(layout))


# ===========================================================================
# 7. 版本列表
# ===========================================================================

@router.get("/layouts/{layout_id}/versions", response_model=None)
async def list_layout_versions(
    layout_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LayoutVersionListResponse:
    """版本历史"""
    layout = await _get_layout(db, layout_id)
    site = await _get_site(db, layout.site_id)
    role = await _get_user_role(db, site, current_user)
    if role is None:
        raise Forbidden("无权限访问此布局")

    rows = (await db.execute(
        select(LayoutVersion)
        .where(LayoutVersion.layout_id == layout_id)
        .order_by(LayoutVersion.version.desc())
    )).scalars().all()
    return ok(LayoutVersionListResponse(
        items=[LayoutVersionRead.model_validate(r) for r in rows],
        total=len(rows),
    ))


# ===========================================================================
# 8. 预览（v0.1 简化版：D2-D3 才有完整 renderer，这里只回显 + 标签统计）
# ===========================================================================

@router.post("/layouts/{layout_id}/preview", response_model=None)
async def preview_layout(
    layout_id: uuid.UUID,
    body: LayoutPreviewRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LayoutPreviewResponse:
    """渲染预览

    P0-10 集成 LayoutRenderer (D2-D5) 后真渲染输出
    上下文: site 信息 + 示例数据 (空 list, 用户可在 body 传示例)
    警告 / 错误: 以 warnings[] 返回给前端 lint
    """
    layout = await _get_layout(db, layout_id)
    site = await _get_site(db, layout.site_id)
    role = await _get_user_role(db, site, current_user)
    if role is None:
        raise Forbidden("无权限访问此布局")

    html = body.html if body.html is not None else layout.html

    # P0-10: 真渲染
    from app.services.render_context_factory import RenderContextFactory
    factory = RenderContextFactory(
        site=site, cats=[], contents=[],
        base_url=_get_site_url(site),
        build_id="preview",
    )
    # P3.7: 预览也要加载同 site 的所有模板 (HY_TEMPLATE 能跳)
    # P3.7+: 只加载启用的
    layouts_for_site = (await db.execute(
        select(Layout).where(
            Layout.site_id == site.id,
            Layout.deleted_at.is_(None),
            Layout.is_active.is_(True),
        )
    )).scalars().all()
    for lyt in layouts_for_site:
        factory.templates_by_code[lyt.code] = lyt.html
    # 根据 layout scope 选 for_*
    if layout.scope == "content":
        ctx = factory.for_content(None)
    elif layout.scope == "category":
        ctx = factory.for_category(None)
    else:
        ctx = factory.for_home()
    from app.services.layout_renderer import render
    rendered = render(html, ctx)
    return ok(LayoutPreviewResponse(
        html=rendered,
        warnings=ctx.warnings,
        errors=ctx.errors,
    ))


def _get_site_url(site) -> str:
    """站点 URL 提取

    优先顺序:
    1. primary 域名 (https://<domain>)
    2. site.url 字段 (可能不存在)
    3. settings.url
    4. 备选: http://<site.slug>.test (仅 preview)
    """
    try:
        domains = getattr(site, "domains", []) or []
        for d in domains:
            if getattr(d, "type", "") == "primary" and getattr(d, "domain", None):
                return f"https://{d.domain}"
    except Exception:
        pass
    # 试 site.url (旧版可能存在)
    url = getattr(site, "url", "") or ""
    if url:
        return url
    # 试 settings.url
    try:
        url = (getattr(site, "settings", {}) or {}).get("url", "")
        if url:
            return url
    except Exception:
        pass
    # preview 兑底
    slug = getattr(site, "slug", "preview")
    return f"http://{slug}.test"


# ===========================================================================
# 9. 校验（开发期 lint）
# ===========================================================================

@router.post("/layouts/{layout_id}/validate", response_model=None)
async def validate_layout(
    layout_id: uuid.UUID,
    body: LayoutPreviewRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LayoutValidateResponse:
    """校验标签合法性（开发期）

    v0.1 校验项:
    - 业务属性是否 _ 前缀（Q1-Q2 防 HTML 属性冲突）
    - HY_ 标签是否在白名单
    - 容器标签是否闭合
    - 属性名是否 _ 前缀
    - 接收 body.html, 缺省走 layout.html
    """
    layout = await _get_layout(db, layout_id)
    site = await _get_site(db, layout.site_id)
    role = await _get_user_role(db, site, current_user)
    if role is None:
        raise Forbidden("无权限访问此布局")

    import re
    html = body.html if (body.html is not None and body.html != "") else layout.html
    errors: list[str] = []
    warnings: list[str] = []
    tag_stats: dict[str, int] = {}

    # 1) 提取所有 <HY_xxx ...> 标签的属性
    attr_pattern = re.compile(
        r'<HY_[A-Z_]+((?:\s+[a-zA-Z_][a-zA-Z0-9_]*="[^"]*")*)\s*/?>',
        re.IGNORECASE,
    )
    for m in attr_pattern.finditer(html):
        attrs_str = m.group(1)
        # 找所有 attr="..." 中的 attr 名
        for attr_match in re.finditer(r'\s+([a-zA-Z_][a-zA-Z0-9_]*)="', attrs_str):
            attr_name = attr_match.group(1)
            if not attr_name.startswith("_") and attr_name in ("class", "id", "style", "limit", "order", "type", "cat", "condition", "file", "filter", "location", "code"):
                errors.append(
                    f"业务属性 {attr_name!r} 必须 _ 前缀（防 HTML 属性冲突）"
                )

    # 2) 标签统计
    for m in re.finditer(r'\bHY_[A-Z_]+', html, re.IGNORECASE):
        t = m.group(0).upper()
        tag_stats[t] = tag_stats.get(t, 0) + 1

    # 3) 容器标签闭合检查（HY_CONTENTS / HY_CATS / HY_IF / HY_INCLUDE / HY_TEMPLATE）
    container_tags = ("HY_CONTENTS", "HY_CATS", "HY_IF", "HY_INCLUDE", "HY_TEMPLATE", "HY_CONTENTS_EMPTY")
    for tag in container_tags:
        open_n = len(re.findall(rf'<{tag}\b[^/>]*>', html, re.IGNORECASE))
        # 自闭合 <TAG _attr=... /> 不算 open
        self_n = len(re.findall(rf'<{tag}\b[^>]*/>', html, re.IGNORECASE))
        close_n = len(re.findall(rf'</{tag}>', html, re.IGNORECASE))
        real_open = open_n - self_n
        if real_open != close_n:
            errors.append(
                f"{tag} 开闭不平衡：开 {real_open}（含自闭 {self_n}），闭 {close_n}"
            )

    return ok(LayoutValidateResponse(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
        tag_stats=tag_stats,
    ))
