"""D4: RenderContextFactory — 把 DB 模型装进 RenderContext

依据: docs/18-布局系统与标签占位符.md §13 (D4 SSG 集成)

设计:
- 纯函数: 给 site/cat/content → RenderContext
- 不接 db session, 由调用方 (publish worker) 预加载数据
- 注入: 内容列表 / 栏目列表 / partials (从文件系统读 _partials 目录)
- 时区: published_at → ISO 8601 (UTC)
- 富文本字段: body_html / prev_html / next_html 走 _SAFE_TAGS 不 escape

输入模型 (Pydantic-ish dataclass):
- SiteRow, CategoryRow, ContentRow (避免 ORM 依赖, 测试易)
- 也可接 ORM 对象 (duck typing)
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

from app.services.layout_renderer import (
    CategoryCtx, ContentCtx, RenderContext, SiteCtx, _make_item_ctx,
    estimate_read_time_label, normalize_content_body_html,
)

logger = logging.getLogger(__name__)

# ===========================================================================
# 适配层: ORM → Ctx
# ===========================================================================

# 简易 attribute 提取 (兼容 ORM 对象 / dict / dataclass)
def _get(obj, key, default=""):
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _to_iso(dt) -> str:
    """datetime → ISO 8601 UTC 字符串

    Pydantic 渲染时序列化
    """
    if dt is None:
        return ""
    if isinstance(dt, str):
        return dt
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    return str(dt)


def site_to_ctx(site, base_url: str = "") -> SiteCtx:
    """Site → SiteCtx

    base_url: 优先传, 否则 site.url
    slogan/keywords/icp/copyright/favicon_url 从 site.settings JSONB 读
    (Site 模型不设独立字段, 存为站点设置)
    """
    settings = _get(site, "settings", {}) or {}
    # copyright 可由 _get() 覆盖, 存 settings 也可
    # url 优先 base_url (调用方传), 否则 site.url (兑底)
    # 修 P1: Site 模型没 url 字段, 只用 base_url + slug 兑底
    site_slug = _get(site, "slug", "") or _get(site, "id", "site")
    fallback_url = base_url or f"http://{site_slug}.test"
    return SiteCtx(
        id=str(_get(site, "id", "")),
        name=_get(site, "name", ""),
        slogan=_get(site, "slogan", "") or settings.get("slogan", ""),
        description=_get(site, "description", "") or settings.get("description", ""),
        keywords=_get(site, "keywords", "") or settings.get("keywords", ""),
        logo_url=_get(site, "logo_url", ""),
        favicon_url=_get(site, "favicon_url", "") or settings.get("favicon_url", "") or _get(site, "logo_url", ""),
        url=base_url or _get(site, "url", "") or f"http://{site_slug}.test",
        icp=_get(site, "icp", "") or settings.get("icp", ""),
        copyright=_get(site, "copyright", "") or settings.get("copyright", ""),
        base_url=fallback_url,
        # P3.6.1 站点级 CSS/JS 自定义
        custom_css=settings.get("custom_css", "") or "",
        custom_js=settings.get("custom_js", "") or "",
        # P3.6.5+: 首页块配置 (hero/stats/products/cta)
        block_hero=settings.get("hero", {}) or {},
        block_stats=settings.get("stats", {}) or {},
        block_products=settings.get("products", {}) or {},
        block_cta=settings.get("cta", {}) or {},
    )


def category_to_ctx(cat) -> Optional[CategoryCtx]:
    """Category → CategoryCtx

    has_children: 通过 cat.seo.get("has_children") 或 children 关系
    返回 None 表示 cat 是 None
    """
    if cat is None:
        return None
    seo = _get(cat, "seo", {}) or {}
    has_children = bool(seo.get("has_children", False)) or bool(_get(cat, "child_count", 0))
    return CategoryCtx(
        id=str(_get(cat, "id", "")),
        name=_get(cat, "name", ""),
        slug=_get(cat, "slug", ""),
        description=_get(cat, "description", ""),
        cover_url=_get(cat, "cover_url", ""),
        # P3.8.9: ORM Category 没 url 字段, schema 才填. 派生走 /{slug}/
        url=_get(cat, "url", "") or f"/{_get(cat, 'slug', '')}/",
        parent_id=str(_get(cat, "parent_id", "") or ""),
        child_count=int(_get(cat, "content_count", 0) or 0),
        has_children=has_children,
        _seo=dict(seo),
    )


def _format_tags_html(tags: list[dict]) -> str:
    """把 tag 列表拼成 HTML 字符串 (HY_ITEM_TAGS 输出)

    tags: [{"name": "AI", "slug": "ai", "url": "/tag/ai.html"}, ...]
    空列表 → 返回空串 (ContentCtx.has_tags 派生自动 False)
    """
    if not tags:
        return ""
    parts = []
    for t in tags:
        name = _get(t, "name", "")
        if not name:
            continue
        url = _get(t, "url", "") or f"/tag/{_get(t, 'slug', '')}.html"
        # 跟 P3.6.1 布局 cheatsheet 一致: <a class="tag"> 紧凑可调
        parts.append(f'<a class="tag" href="{url}">{name}</a>')
    return "".join(parts)


def content_to_ctx(content, cat=None, tags: Optional[list] = None) -> Optional[ContentCtx]:
    """Content → ContentCtx

    cat: 关联栏目 (D3 filter + HY_ITEM_CAT_NAME 用)
    tags: 内容关联的 tag 列表, 每项 dict {name, slug, url?}
           缺省 (None) → 留空, HY_ITEM_TAGS 渲染为空串
    """
    if content is None:
        return None
    tags_list = tags if tags is not None else _get(content, "_tags_list", []) or []
    tags_html = _format_tags_html(tags_list)
    # P3.8.9: published_at 兑底 (老 seed / 异常状态可能为 None)
    _pub_at = _to_iso(
        _get(content, "published_at", None)
        or _get(content, "updated_at", None)
        or _get(content, "created_at", None)
    )
    meta_raw = _get(content, "metadata_", None)
    if not isinstance(meta_raw, dict):
        meta_raw = {}
    ctx = ContentCtx(
        id=str(_get(content, "id", "")),
        title=_get(content, "title", ""),
        subtitle=_get(content, "subtitle", ""),
        # D5: url 用 cat-slug/slug (跟 PageRenderer.content 路径一致)
        url=_get(content, "url", ""),
        summary=_get(content, "excerpt", "") or _get(content, "summary", ""),
        # P3.6.1: 兼容 cover_image (新) / cover_url (旧) 两种字段名
        cover_url=(
            _get(content, "cover_image", "")
            or _get(content, "cover_url", "")
        ),
        banner_url=(
            _get(content, "banner_image", "")
            or _get(content, "banner_url", "")
        ),
        is_featured=bool(_get(content, "is_featured", False)),
        author=(
            _get(content, "author_name", "")
            or _get(_get(content, "author", None), "name", "")
            or _get(content, "author", "")
        ),
        # P3.8.9: published_at 兑底 (老 seed / 异常状态可能为 None)
        published_at=_pub_at,
        # P3.8.9+: date_short 兑底 (老 seed / 异常状态可能为 None) — YYYY-MM-DD
        date_short=_pub_at[:10] if _pub_at else "",
        # P3.8.9+++: date_year 兑底 — YYYY
        date_year=_pub_at[:4] if _pub_at else "",
        hits=int(_get(content, "view_count", 0) or 0),
        body_html=_get(content, "body_html", ""),
        prev_html=_get(content, "prev_html", ""),
        next_html=_get(content, "next_html", ""),
        # 2026-06-08: 填充 tags_html (HY_ITEM_TAGS 渲染)
        tags_html=tags_html,
        _metadata=dict(meta_raw),
    )
    if cat is not None:
        ctx.cat_id = str(_get(cat, "id", ""))
        ctx.cat_name = _get(cat, "name", "")
        ctx.cat_slug = _get(cat, "slug", "")
        ctx.cat_url = _get(cat, "url", "")
    else:
        # D4 增量: cat 参数缺时, 从 content.category_id 反查
        cid = _get(content, "category_id", None)
        if cid:
            ctx.cat_id = str(cid)
    # D5: 如果没传 url, 用 cat-slug/content-slug 生成 (无论 cat 是否传入)
    if not ctx.url:
        cat_slug = ctx.cat_slug or _get(content, "category_slug", "")
        if cat_slug:
            slug = _get(content, "slug", "") or ctx.id
            ctx.url = f"/{cat_slug}/{slug}.html"
    # 派生属性
    _make_item_ctx(ctx)
    raw_body = _get(content, "body_html", "") or _get(content, "body", "")
    ctx.body_html = normalize_content_body_html(raw_body)
    ctx.read_time = estimate_read_time_label(ctx.body_html)
    return ctx


# ===========================================================================
# Factory
# ===========================================================================

class RenderContextFactory:
    """构造 RenderContext (含 contents/cats 数据注入)

    用法 (worker):
        factory = RenderContextFactory(db, site, partials_dir)
        ctx = factory.for_home()           # 首页
        ctx = factory.for_category(cat)    # 栏目页
        ctx = factory.for_content(content) # 详情页
    """

    def __init__(
        self,
        site,
        cats: Optional[Iterable] = None,
        contents: Optional[Iterable] = None,
        tags_by_content: Optional[dict] = None,
        partials: Optional[dict[str, str]] = None,
        partials_dir: Optional[Path] = None,
        base_url: str = "",
        build_id: str = "",
        now: Optional[datetime] = None,
    ) -> None:
        """
        tags_by_content: {content_id_str: [tag_dict, ...]}
            缺省 → 所有 content 的 tags 列表为空 (HY_ITEM_TAGS 渲染空)
        """
        self.site_ctx = site_to_ctx(site, base_url=base_url)
        self._site_id = str(_get(site, "id", "")) if site else ""
        self._db = None  # 由 load_menus() 注入
        # 提前把 cats 转 ctx (D3 query_contents/_cats 用)
        self.cats_data = [category_to_ctx(c) for c in (cats or []) if c is not None]
        # 按父子关系修正 has_children（content_count 不能代表子栏目数）
        for cat in self.cats_data:
            cat.has_children = any(c.parent_id == cat.id for c in self.cats_data)
        # 猫目以 id 为键, content_to_ctx 传 cat 让 HY_ITEM_URL 拿到 cat_slug
        self.cats_by_id = {str(_get(c, "id", "")): c for c in self.cats_data}
        # 填充子栏目的 parent_name / parent_url
        for cat_ctx in self.cats_data:
            if cat_ctx.parent_id:
                parent = self.cats_by_id.get(cat_ctx.parent_id)
                if parent:
                    cat_ctx.parent_name = parent.name
                    cat_ctx.parent_url = parent.url  # 后续会加 sites 前缀
        # 修正子栏目的 url：加上父栏目 slug 前缀
        for cat_ctx in self.cats_data:
            if cat_ctx.parent_id:
                parent = self.cats_by_id.get(cat_ctx.parent_id)
                if parent and parent.slug:
                    expected_prefix = f"/{parent.slug}/"
                    if not cat_ctx.url.startswith(expected_prefix):
                        cat_ctx.url = f"/{parent.slug}/{cat_ctx.slug}/"
        # contents: 传对应 cat 使 url/cat_* 字段填充
        self.contents_data = []
        tags_map = tags_by_content or {}
        for c in (contents or []):
            if c is None:
                continue
            cat_id = str(_get(c, "category_id", ""))
            cat = self.cats_by_id.get(cat_id) if cat_id else None
            cid = str(_get(c, "id", ""))
            self.contents_data.append(
                content_to_ctx(c, cat=cat, tags=tags_map.get(cid, []))
            )
        # 修正子栏目下文章的 url：加上父栏目 slug 前缀
        for ctx in self.contents_data:
            if ctx.cat_id and ctx.url:
                cat_ctx = self.cats_by_id.get(ctx.cat_id)
                if cat_ctx and cat_ctx.parent_id:
                    parent = self.cats_by_id.get(cat_ctx.parent_id)
                    if parent and parent.slug:
                        # url 形如 /child-slug/xxx.html → /parent-slug/child-slug/xxx.html
                        expected_prefix = f"/{parent.slug}/"
                        if not ctx.url.startswith(expected_prefix):
                            ctx.url = f"/{parent.slug}{ctx.url}"
        # 给所有 URL 加上 /sites/{site_slug} 前缀，确保链接在管理端访问时正确
        site_slug = _get(site, "slug", "") or ""
        if site_slug:
            url_prefix = f"/sites/{site_slug}"
            for cat_ctx in self.cats_data:
                if cat_ctx.url and not cat_ctx.url.startswith(url_prefix):
                    cat_ctx.url = url_prefix + cat_ctx.url
                if cat_ctx.parent_url and not cat_ctx.parent_url.startswith(url_prefix):
                    cat_ctx.parent_url = url_prefix + cat_ctx.parent_url
            for ctx in self.contents_data:
                if ctx.url and not ctx.url.startswith(url_prefix):
                    ctx.url = url_prefix + ctx.url
        self.partials = partials or {}
        self.partials_dir = partials_dir
        self.build_id = build_id
        self.now_dt = now or datetime.now(timezone.utc)
        self.now_iso = self.now_dt.isoformat()
        self.theme_version = 1  # 由调用方在 D5 worker 接进来
        # P3.6.2: 站点静态资源 URL 映射 {name: public_url}
        # 由 load_assets() 异步加载; 初始化为空 dict (避免 UnboundLocalError)
        self.asset_urls: dict[str, str] = {}
        self.media_urls: dict[str, str] = {}
        self.assets_by_category: dict[str, list[dict[str, str]]] = {"css": [], "js": [], "assets": []}
        # P3.7: HY_TEMPLATE 按 code 查 html (init 外部填, 默认空)
        self.templates_by_code: dict[str, str] = {}
        self._site_slug = _get(site, "slug", "") if site else ""

    async def load_menus(self, db) -> None:
        """异步加载站点菜单到 site_ctx

        P3.7.2 方案 B: 菜单功能已删, 本方法保留仅为不报 AttributeError, no-op.
        真正调用走 await factory.load_assets(db).
        """
        return

    async def load_assets(self, db) -> None:
        """异步加载站点静态资源 URL 映射 {name: public_url}

        用于 HY_ASSET_URL 标签: <link href="<HY_ASSET_URL site.css>">
        调用方 (worker): factory = RenderContextFactory(...); await factory.load_assets(db)
        """
        from sqlalchemy import select
        from app.models.site_asset import SiteAsset, public_relpath
        import uuid as _uuid
        if not self._site_id or not self._site_slug:
            return
        site_uuid = _uuid.UUID(self._site_id)
        rows = await db.execute(
            select(SiteAsset).where(SiteAsset.site_id == site_uuid)
        )
        assets = rows.scalars().all()
        # 公开 URL = ZIP 相对路径 (css/main.css)；旧数据仍为 assets/{name}
        self.asset_urls = {a.name: public_relpath(a) for a in assets}
        self.assets_by_category: dict[str, list[dict[str, str]]] = {
            'css': [], 'js': [], 'assets': [],
        }
        for a in assets:
            self.assets_by_category.setdefault(a.category, []).append({
                'name': a.name,
                'url': public_relpath(a),
                'content_type': a.content_type,
            })
        # 按 name 字典序稳定排序 (保证多次 build 顺序一致)
        for cat in self.assets_by_category.values():
            cat.sort(key=lambda x: x['name'])

    def _base(self) -> RenderContext:
        return RenderContext(
            site=self.site_ctx,
            partials=self.partials,
            partials_dir=self.partials_dir,
            cats_data=self.cats_data,
            contents_data=self.contents_data,
            templates_by_code=self.templates_by_code,
            build_id=self.build_id,
            now=self.now_iso,
            theme_version=self.theme_version,
            base_url=self.site_ctx.base_url,
            asset_urls=self.asset_urls,  # P3.6.2: 站点静态资源 URL 映射
            media_urls=self.media_urls,
            assets_by_category=self.assets_by_category,  # P3.6.5+: HY_SITE_CSS / HY_SITE_JS 用
        )

    def for_home(self) -> RenderContext:
        """首页: 全站最新内容, 无 cat/content

        Layouts (default scope=home): <HY_CONTENTS _limit="10" _order="newest">
        """
        ctx = self._base()
        # 2026-06-06: 注入全站内容供 _cat 过滤
        ctx.contents = self.contents_data
        return ctx

    def for_category(self, cat) -> RenderContext:
        """栏目页: 注入 cat, 列表通过 _cat filter

        Layouts (default scope=category): <HY_CONTENTS _cat="HY_CAT_SLUG">
        """
        ctx = self._base()
        cat_id = str(_get(cat, "id", ""))
        # 优先使用已修正 URL 前缀的 CategoryCtx
        ctx.category = self.cats_by_id.get(cat_id) or category_to_ctx(cat)
        # 2026-06-06: 把本栏目内容也注入 ctx.contents (供 HY_CONTENTS_COUNT / 列表渲染)
        ctx.contents = [c for c in self.contents_data if str(_get(c, "cat_id", "")) == cat_id]
        return ctx

    def for_content(self, content, cat=None) -> RenderContext:
        """详情页: 注入 cat + content (列表为空, 内容走单值标签)

        Layouts (default scope=content): <HY_CONTENT_TITLE/> <HY_CONTENT_BODY/>

        2026-06-08: 优先从 self.contents_data 里查找已带 tags_html 的 ContentCtx
                     避免重新构造丢失 tags (for_content 原始实现走 content_to_ctx 不传 tags)
        """
        ctx = self._base()
        cat_id = str(_get(cat, "id", "")) if cat else ""
        ctx.category = self.cats_by_id.get(cat_id) or category_to_ctx(cat)
        # 优先用已构造的 ContentCtx (自带 tags_html)
        target_id = str(_get(content, "id", ""))
        existing = next(
            (c for c in self.contents_data if str(_get(c, "id", "")) == target_id),
            None,
        )
        if existing is not None and getattr(existing, "tags_html", None):
            ctx.content = existing
        else:
            # 兑底: 重新构造 (tags 会在 HY_ITEM_TAGS 处渲染空)
            ctx.content = content_to_ctx(content, cat=cat)
        return ctx

    def for_site(self) -> RenderContext:
        """站点基础页 (sitemap/about): site 信息全, 无 cat/content 详情

        Layouts (default scope=site): <HY_SITE_NAME/>
        """
        return self._base()


# ===========================================================================
# 工具: 从 layout 列表挑 default
# ===========================================================================

def pick_default_layout(layouts: Iterable, scope: str):
    """从 layouts 列表挑 scope 对应的 default

    layouts: Layout ORM 对象列表 / 字典列表
    规则:
    1. is_default=True 且 scope 匹配
    2. P3.6+: 多个 is_default 时, 优先非 "default" code (用户创建的 code="home" / "site" / ...
       优先于 system seed 的 code="default" 占位)
    3. 找不到 → None (调用方决定 fallback)
    """
    candidates = [
        ly for ly in layouts
        if _get(ly, "scope", "") == scope
        and bool(_get(ly, "is_default", False))
        and not _get(ly, "deleted_at", None)
    ]
    if not candidates:
        return None
    # P3.6+ 多 candidate: code != "default" 优先
    non_default = [ly for ly in candidates if _get(ly, "code", "") != "default"]
    return non_default[0] if non_default else candidates[0]
