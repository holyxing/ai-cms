"""D4: PageRenderer — 按页面类型选 default layout, 渲染成 html 字符串

依据: docs/18-布局系统与标签占位符.md §13

设计:
- 纯函数: site + page(类型+payload) → html string
- 不写盘, 由 D5 worker 决定输出位置
- 错误处理: 没有 default layout → 返回空字符串 + warn
- 多个 url 别名 (home + page1, page2, ...): 走 _limit + _order
- 分页: 详情页不参与, 列表页 (home/category) 走 _page 属性

Page 4 种:
- home:      /                 scope=home
- category:  /cat-slug/        scope=category
- content:   /cat-slug/xx-slug scope=content
- site:      /about/, /sitemap scope=site

输出 PageFile (dataclass) 包含 path + html, worker 负责写
"""
from __future__ import annotations

import logging
import re
import urllib.parse
from dataclasses import dataclass, field
from typing import Iterable, Optional

from app.services.layout_renderer import (
    RenderContext, render,
)
from app.services.render_context_factory import (
    RenderContextFactory, category_to_ctx, content_to_ctx, pick_default_layout,
)


def _get(obj, key, default=""):
    """页面渲染器内部属性访问 (重复 render_context_factory._get)"""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)

logger = logging.getLogger(__name__)

# ZIP 原站：首页 .site-header 初始与 banner 同色（深蓝），滚动后变白；
# 内页用 .sub-header 始终白底。导入只抽了一份首页 header，内页也套上深蓝菜单。
# 非首页给 body 加 hy-inner-page，用 CSS 套上与 .scrolled 相同的白菜单（不依赖 JS，
# 避免 main.js 在 scrollY=0 时把 scrolled 去掉）。
_INNER_HEADER_STYLE = """<style id="hy-inner-header">
body.hy-inner-page .site-header {
  --nav-surface: #fff;
  position: fixed;
  height: 66px;
  color: var(--ink, #071421);
  background: #fff;
  border-color: #e6ecef;
  box-shadow: 0 8px 24px rgba(7,20,33,.08);
}
/* 与内页顶栏高度对齐，避免 76px 预留造成菜单与正文之间空隙 */
body.hy-inner-page main { padding-top: 66px; }
body.hy-inner-page .site-header .header-brand img { filter: none; }
body.hy-inner-page .site-header .simple-dropdown {
  color: var(--ink, #071421);
  background: #fff;
  border-color: #dce5ea;
  border-top-color: #26afc4;
  box-shadow: 0 18px 38px rgba(4,20,32,.16);
}
body.hy-inner-page .site-header .simple-dropdown strong { color: #667783; border-bottom-color: #dfe7ec; }
body.hy-inner-page .site-header .simple-dropdown a { color: #1b2b37; border-bottom-color: #edf1f4; }
body.hy-inner-page .site-header .simple-dropdown a:hover,
body.hy-inner-page .site-header .simple-dropdown a:focus-visible { color: #087f9e; background: #f6f9fa; }
/* 导入正文会带上原站 ue-reveal；CMS 页不再跑入场观察，未加 is-in-view 会整段透明 */
html.ue-enhanced .post-body .ue-reveal,
html.ue-enhanced .post-body .ue-reveal.is-in-view {
  opacity: 1;
  transform: none;
}
</style>
"""


def _is_home_page_path(page_path: str | None) -> bool:
    path = (page_path or "").replace("\\", "/").lstrip("/")
    return path in ("", "index.html")


def _apply_inner_page_header(html: str, page_path: str | None) -> str:
    """非首页：白菜单。首页保持深蓝（与 banner 一致）。"""
    if not html or _is_home_page_path(page_path):
        return html
    if "hy-inner-page" not in html:
        def _add_body_class(m: re.Match) -> str:
            tag = m.group(0)
            if re.search(r"\bclass\s*=", tag, re.I):
                return re.sub(r'(\bclass=["\'])', r"\1hy-inner-page ", tag, count=1)
            return tag[:-1] + ' class="hy-inner-page">'
        html = re.sub(r"<body\b[^>]*>", _add_body_class, html, count=1, flags=re.I)
    if 'id="hy-inner-header"' not in html:
        if "</head>" in html:
            html = html.replace("</head>", _INNER_HEADER_STYLE + "</head>", 1)
        else:
            html = _INNER_HEADER_STYLE + html
    # 原站空壳：JS 会把 data-published-shell 换成新 main，CMS 正文被挤到页脚后或整段透明
    html = re.sub(
        r"<div[^>]*\bdata-published-shell\b[^>]*>\s*</div>",
        "",
        html,
        flags=re.I,
    )
    return html


# ===========================================================================
# PageFile
# ===========================================================================

@dataclass
class PageFile:
    """单页输出: 路径 + html 内容

    path: 相对 public 根, 例 'index.html', 'tech/index.html',
          'tech/why-ai/index.html', 'sitemap.xml'
    """
    path: str
    html: str
    page_type: str  # home | category | content | site
    title: str = ""
    status_code: int = 200  # 内容已删/无 layout 时 404 (worker 决策)
    warnings: list = field(default_factory=list)  # D4: 透传 RenderContext.warnings
    errors: list = field(default_factory=list)  # slug 不合法等错误

    def __lt__(self, other: "PageFile") -> bool:
        return self.path < other.path


# ===========================================================================
# PageRenderer
# ===========================================================================

class PageRenderer:
    """按页面类型 + factory 渲染

    用法:
        renderer = PageRenderer(factory, layouts, site_slug, base_url)
        files = []
        files.append(renderer.home())
        for cat in cats: files.append(renderer.category(cat))
        for c in contents: files.append(renderer.content(c, cat))
    """

    def __init__(
        self,
        factory: RenderContextFactory,
        layouts: Iterable,
        site_slug: str = "",
    ) -> None:
        self.factory = factory
        self.layouts = list(layouts)
        self.site_slug = site_slug or _get(factory.site_ctx, "slug", "")
        # 父栏目 slug 查找表 (cat_id → parent_slug)
        self._cat_by_id = {c.id: c for c in factory.cats_data}

    def _cat_dir(self, cat_ctx) -> str:
        """栏目的完整目录路径（含父栏目 slug 前缀）。
        例：子栏目 hangyedongtai 的父栏目是 xinwenzixun → 'xinwenzixun/hangyedongtai'
        """
        slug = cat_ctx.slug if cat_ctx else ""
        if not slug:
            return ""
        parent_id = cat_ctx.parent_id if cat_ctx else ""
        if parent_id:
            parent = self._cat_by_id.get(parent_id)
            if parent and parent.slug:
                return f"{parent.slug}/{slug}"
        return slug

    def _render_with_layout(self, scope: str, ctx: RenderContext) -> str:
        """从 layouts 找 default, 调 renderer 渲染"""
        layout = pick_default_layout(self.layouts, scope=scope)
        if layout is None:
            warn = f"no default layout for scope={scope}, site={self.site_slug}"
            logger.warning(warn)
            ctx.warnings.append(warn)
            return ""
        html_str = _get(layout, "html", "")
        return render(html_str, ctx, strip_scripts=False)

    def _pick_layout_for(self, scope: str, code: str | None):
        """P3.6.1: 优先选 code 匹配的 layout, 兑底 is_default

        - 栏目页 scope=category: cat.template 优先, 找不到兑底 default
        - 其他 scope 走 _render_with_layout (纯 is_default)
        """
        if not code or code == "default":
            return pick_default_layout(self.layouts, scope=scope)
        for ly in self.layouts:
            ly_scope = _get(ly, "scope", "")
            ly_code = _get(ly, "code", "")
            if ly_scope == scope and ly_code == code and not _get(ly, "deleted_at", None):
                return ly
        # 兑底: 仍取 default
        return pick_default_layout(self.layouts, scope=scope)

    def _render_category_layout(self, cat, ctx: RenderContext) -> str:
        """P3.6.1: 栏目页渲染, 选 layout 逻辑 = 选模板"""
        code = _get(cat, "template", None) or "default"
        layout = self._pick_layout_for("category", code)
        if layout is None:
            warn = f"no category layout (code={code!r}), site={self.site_slug}"
            logger.warning(warn)
            ctx.warnings.append(warn)
            return ""
        return render(_get(layout, "html", ""), ctx, strip_scripts=False)

    def _render_with_layout_obj(self, layout, ctx: RenderContext) -> str:
        """不递归, 用指定 layout 对象渲染"""
        html_str = _get(layout, "html", "")
        return render(html_str, ctx, strip_scripts=False)

    def _wrap_with_site_layout(self, inner_html: str, ctx: RenderContext) -> str:
        """用 site scope layout 包装 home/cat/content (全局 header/footer)

        机制: site layout 里有 `__LAYOUT_CONTENT__` 占位, 替换为 inner_html
        额外: 从 inner_html 提取 <title>...</title>, 替换 site layout 的 <title>...</title>
        如果没 site layout 或没占位, 原样返回
        """
        site_layout = pick_default_layout(self.layouts, scope="site")
        if site_layout is None:
            # P3.6.1: 兑底路径也要注入 custom_css/custom_js
            site_ctx = self.factory.for_site()
            site_ctx.page_path = ctx.page_path  # P3.6.5+ fix: 透传当前页 path
            return self._inject_custom_code(inner_html, site_ctx.site)
        site_ctx = self.factory.for_site()
        site_ctx.page_path = ctx.page_path  # P3.6.5+ fix: 透传当前页 path, 包壳里 <HY_SITE_CSS> 算深度
        # P3.8.9: 透传当前页 cat/content 给 site layout
        # 让 <HY_PAGE_TITLE> / <HY_PAGE_URL> 渲染出当前页 (而不是兑底 site.name)
        site_ctx.category = ctx.category
        site_ctx.content = ctx.content
        outer = self._render_with_layout_obj(site_layout, site_ctx)

        # 提取 inner 的 title
        import re as _re
        title_m = _re.search(r'<title>(.*?)</title>', inner_html, _re.IGNORECASE | _re.DOTALL)
        page_title = title_m.group(1).strip() if title_m else ""
        if page_title:
            # 替换 outer 里的 title
            # P3.8.9: 用 html.escape 不用 re.escape (后者会转义空格等跟 HTML 无害的字符)
            import html as _html
            outer = _re.sub(
                r'<title>.*?</title>',
                f'<title>{_html.escape(page_title)}</title>',
                outer,
                count=1,
                flags=_re.IGNORECASE | _re.DOTALL,
            )

        if "__LAYOUT_CONTENT__" not in outer:
            outer = outer.replace("</body>", inner_html + "</body>") if "</body>" in outer else outer
            # 兑底路径也要注入 custom_css/custom_js
            return _apply_inner_page_header(
                self._inject_custom_code(outer, site_ctx.site), ctx.page_path
            )

        outer = outer.replace("__LAYOUT_CONTENT__", inner_html)
        # P3.6.1: 注入站点级 custom_css (</head> 前) 和 custom_js (</body> 前)
        return _apply_inner_page_header(
            self._inject_custom_code(outer, site_ctx.site), ctx.page_path
        )

    def _inject_custom_code(self, html: str, site_ctx_obj) -> str:
        """注入 custom_css (<head>) 和 custom_js (</body>) 站点级自定义代码

        site_ctx_obj: SiteCtx 实例 (不是 RenderContext)
        """
        css = (getattr(site_ctx_obj, "custom_css", "") or "").strip()
        js = (getattr(site_ctx_obj, "custom_js", "") or "").strip()
        if css:
            # 直接嵌入 <style> (避免额外 HTTP 请求)
            style_block = f"\n<style id=\"site-custom-css\">\n{css}\n</style>\n"
            if "</head>" in html:
                html = html.replace("</head>", style_block + "</head>", 1)
            else:
                html = style_block + html
        if js:
            script_block = f"\n<script id=\"site-custom-js\">\n{js}\n</script>\n"
            if "</body>" in html:
                html = html.replace("</body>", script_block + "</body>", 1)
            else:
                html = html + script_block
        return html

    # -------------------- 4 个页面方法 --------------------

    def home(self) -> PageFile:
        """首页: scope=home, path=index.html"""
        ctx = self.factory.for_home()
        ctx.page_path = "index.html"  # P3.6.5+ fix: 供 HY_SITE_CSS/JS 算深度
        html = self._render_with_layout("home", ctx)
        html = self._wrap_with_site_layout(html, ctx)
        return PageFile(
            path="index.html",
            html=html,
            page_type="home",
            title=self.factory.site_ctx.name,
            warnings=ctx.warnings,  # D4: 透传 warn (错别默认 layout)
        )

    def category(self, cat, page_num: int = 1) -> PageFile:
        """栏目页: scope=category, path=cat-slug/index.html (page 1) 或 page-N.html

        分页: 第 2 页起为 cat-slug/page-2.html, 第 3 页 page-3.html ...
        P3.6.1: 渲染前按 cat.template 选 layout (default / news-list / ...)
        """
        cat_ctx = category_to_ctx(cat)
        ctx = self.factory.for_category(cat)
        ctx.current_page = max(1, page_num)
        slug = cat_ctx.slug
        cat_dir = self._cat_dir(cat_ctx)
        # P3.6.5+ fix: page_path 供 HY_SITE_CSS/JS 算相对路径深度
        if page_num <= 1:
            ctx.page_path = f"{cat_dir}/index.html"
        else:
            ctx.page_path = f"{cat_dir}/page-{page_num}.html"
        # D3: HY_CATS 用的 category_item 已在 query_cats 内部处理
        # P3.6.1: 按栏目 template 选 layout
        html = self._render_category_layout(cat, ctx)
        html = self._wrap_with_site_layout(html, ctx)
        # 严格验证: 栏目 slug 合法 (空/中文/拼音都会被拦)
        if not slug or not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", slug):
            ctx.warnings.append(
                f"栏目 {cat_ctx.id} slug 不合法: {slug!r}, 跳过写盘"
            )
            return PageFile(
                path="", html="", page_type="category", title=cat_ctx.name,
                warnings=ctx.warnings, errors=ctx.errors,
            )
        if page_num <= 1:
            path = f"{cat_dir}/index.html"
        else:
            path = f"{cat_dir}/page-{page_num}.html"
        return PageFile(
            path=path, html=html, page_type="category",
            title=cat_ctx.name,
            warnings=ctx.warnings,
        )

    def content(self, content, cat=None) -> PageFile:
        """详情页: scope=content, path=cat-slug/xx-slug.html

        严格验证: 栏目 slug 和文章 slug 都必须合法
        缺失时返回空页 + 警告 (避免错误路径)
        """
        cat_ctx = category_to_ctx(cat) if cat else None
        ctx = self.factory.for_content(content, cat=cat_ctx)
        content_ctx = ctx.content

        # P3.6.5+ fix: page_path 供 HY_SITE_CSS/JS 算相对路径深度
        content_slug = _get(content, "slug", "") or content_ctx.id
        cat_slug = (cat_ctx.slug if cat_ctx else "")
        cat_dir = self._cat_dir(cat_ctx) if cat_ctx else ""
        ctx.page_path = f"{cat_dir}/{content_slug}.html"
        content_layout_code = _get(cat, "content_template", None) if cat else None
        layout = self._pick_layout_for("content", content_layout_code)
        if layout is None:
            warn = f"no content layout (code={content_layout_code!r}), site={self.site_slug}"
            logger.warning(warn)
            ctx.warnings.append(warn)
            html = ""
        else:
            html = render(_get(layout, "html", ""), ctx)
        html = self._wrap_with_site_layout(html, ctx)

        # 严格验证: 栏目必须有 slug
        if not cat_slug or not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", cat_slug):
            ctx.warnings.append(
                f"文章 {content_ctx.id} 栏目 slug 不合法: {cat_slug!r}, 跳过写盘"
            )
            return PageFile(
                path="", html="", page_type="content", title=content_ctx.title,
                warnings=ctx.warnings, errors=ctx.errors,
            )

        # 严格验证: 文章 slug 合法
        slug = _get(content, "slug", "") or content_ctx.id
        if not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", slug):
            ctx.warnings.append(
                f"文章 {content_ctx.id} slug 不合法: {slug!r}, 跳过写盘"
            )
            return PageFile(
                path="", html="", page_type="content", title=content_ctx.title,
                warnings=ctx.warnings, errors=ctx.errors,
            )

        return PageFile(
            path=f"{cat_dir}/{slug}.html",
            html=html, page_type="content",
            title=content_ctx.title,
            warnings=ctx.warnings,
        )

    def site_page(self, slug: str, name: str = "") -> PageFile:
        """站点级静态页 (about/sitemap 走 scope=site)

        slug: 路径 (例 'about', 'contact')
        """
        ctx = self.factory.for_site()
        # P3.6.5+ fix: site page 走 site scope (不再套 site/site 包壳)
        # page_path 供 HY_SITE_CSS/JS 算深度 (site page 本身就是顶层 layout, 默认 depth=0)
        ctx.page_path = f"{slug}/index.html"
        html = self._render_with_layout("site", ctx)
        return PageFile(
            path=f"{slug}/index.html",
            html=html, page_type="site",
            title=name or slug,
            warnings=ctx.warnings,
        )


# ===========================================================================
# SitemapBuilder
# ===========================================================================

class SitemapBuilder:
    """生成 sitemap.xml (v0.1 简单版)

    包含: 首页 + 所有栏目页 + 所有已发布内容页
    """
    SITE_URL = "https://example.com"  # 由调用方覆盖

    def __init__(self, site_url: str = ""):
        self.site_url = (site_url or self.SITE_URL).rstrip("/")

    def build(
        self,
        pages: list[PageFile],
        lastmod: str = "",
    ) -> PageFile:
        """从已渲染的 pages 提取 url + lastmod

        lastmod: ISO 日期 (用于整个 sitemap 顶层 <lastmod>)
        """
        urls = []
        for p in pages:
            if not p.html or p.status_code != 200:
                continue
            # path → url
            url = f"{self.site_url}/{p.path}".replace("//", "/").replace(":/", "://")
            urls.append({
                "loc": url,
                "lastmod": lastmod,
                "changefreq": self._freq(p.page_type),
                "priority": self._priority(p.page_type),
            })
        xml = self._render_xml(urls)
        return PageFile(
            path="sitemap.xml", html=xml, page_type="site",
            title="Sitemap", status_code=200,
        )

    def _freq(self, page_type: str) -> str:
        return {
            "home": "daily",
            "category": "weekly",
            "content": "monthly",
            "site": "monthly",
        }.get(page_type, "weekly")

    def _priority(self, page_type: str) -> str:
        return {
            "home": "1.0",
            "category": "0.8",
            "content": "0.6",
            "site": "0.5",
        }.get(page_type, "0.5")

    def _render_xml(self, urls: list[dict]) -> str:
        """渲染 sitemap.xml (XML 1.0 + sitemap 0.9 namespace)"""
        lines = ['<?xml version="1.0" encoding="UTF-8"?>']
        lines.append('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
        for u in urls:
            lines.append("  <url>")
            lines.append(f"    <loc>{self._xml_escape(u['loc'])}</loc>")
            if u.get("lastmod"):
                lines.append(f"    <lastmod>{u['lastmod']}</lastmod>")
            lines.append(f"    <changefreq>{u['changefreq']}</changefreq>")
            lines.append(f"    <priority>{u['priority']}</priority>")
            lines.append("  </url>")
        lines.append("</urlset>")
        return "\n".join(lines)

    def _xml_escape(self, s: str) -> str:
        return (s.replace("&", "&amp;")
                 .replace("<", "&lt;")
                 .replace(">", "&gt;")
                 .replace('"', "&quot;")
                 .replace("'", "&apos;"))


# ===========================================================================
# 全流程 build_site (D4 顶层)
# ===========================================================================

def build_site(
    site,
    cats: list,
    contents: list,
    layouts: list,
    base_url: str = "",
    build_id: str = "",
    now=None,
    include_unpublished: bool = False,
    menus_header: Optional[dict] = None,
    menus_footer: Optional[dict] = None,
    menus_rendered: Optional[dict] = None,
    tags_by_content: Optional[dict] = None,
    asset_urls: Optional[dict] = None,
    assets_by_category: Optional[dict] = None,
    media_urls: Optional[dict] = None,
) -> list[PageFile]:
    """一站式: 渲染所有页面 + sitemap

    纯函数, 不写盘, 返 PageFile 列表

    P0-9 兜底过滤: 默认仅渲染 status='published' 且未软删的内容/栏目
    设置 include_unpublished=True 可关闭 (仅测试用)

    菜单加载 (P3.6.1 站点头部 需求):
    - menus_header / menus_footer: items_json (调用方预先从 db 加载)
    - menus_rendered: 已渲染好的 menu_header_html / menu_footer_html
                     (调用方传这个跳过, 性能更好, 避免重复渲)
    """
    from datetime import datetime, timezone
    # P0-9: 兑底过滤 - 避免不传 status 导致非发布内容被构建
    if not include_unpublished:
        cats = [c for c in (cats or []) if _get(c, "deleted_at", None) is None]
        contents = [c for c in (contents or [])
                    if _get(c, "deleted_at", None) is None
                    and (_get(c, "status", "published") in ("published", ""))
                    and not _get(c, "is_deleted", False)]
    factory = RenderContextFactory(
        site=site, cats=cats, contents=contents,
        tags_by_content=tags_by_content,
        base_url=base_url, build_id=build_id, now=now,
    )
    # P3.6.2: 站点静态资源 URL 映射 (HY_ASSET_URL 用)
    if asset_urls:
        factory.asset_urls = asset_urls
    # P3.7: HY_TEMPLATE 按 code 预加载 (所有 scope 的 page + partial 都注册进去)
    # 防重名: 后加载覆盖前加载 (scope=partial 优先)
    templates_by_code: dict[str, str] = {}
    for layout in (layouts or []):
        code = _get(layout, "code")
        html = _get(layout, "html")
        if code and html is not None:
            templates_by_code[code] = html
    if templates_by_code:
        factory.templates_by_code = templates_by_code
    # P3.6.5+: HY_SITE_CSS / HY_SITE_JS 一键全目录标签
    if assets_by_category:
        factory.assets_by_category = assets_by_category
    if media_urls:
        factory.media_urls = media_urls
    # 填入菜单 (优先用已渲染的, 否则用 items_json 现场渲染 (需要 db))
    if menus_rendered:
        factory.site_ctx.menu_header_html = menus_rendered.get("header", "")
        factory.site_ctx.menu_footer_html = menus_rendered.get("footer", "")
    renderer = PageRenderer(factory, layouts=layouts)
    files = []
    # 1. 首页
    files.append(renderer.home())
    # 2. 栏目页 (含分页静态页)
    DEFAULT_CAT_PAGE_SIZE = 20
    for cat in cats:
        cat_id = str(_get(cat, "id", ""))
        cat_contents = [
            c for c in contents
            if str(_get(c, "category_id", "")) == cat_id
        ]
        total_pages = max(1, (len(cat_contents) + DEFAULT_CAT_PAGE_SIZE - 1) // DEFAULT_CAT_PAGE_SIZE)
        for page_num in range(1, total_pages + 1):
            files.append(renderer.category(cat, page_num=page_num))
    # 3. 详情页
    cat_by_id = {str(_get(c, "id", "")): c for c in cats}
    for c in contents:
        cat_id = str(_get(c, "category_id", ""))
        cat = cat_by_id.get(cat_id) if cat_id else None
        files.append(renderer.content(c, cat=cat))
    # 4. sitemap
    sm = SitemapBuilder(site_url=base_url or _get(site, "url", ""))
    files.append(sm.build(files, lastmod=(now or datetime.now(timezone.utc)).strftime("%Y-%m-%d")))
    return sorted(files)
