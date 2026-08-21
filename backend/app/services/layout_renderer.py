"""Layout 渲染器 v0.1

依据: docs/18-布局系统与标签占位符.md §3-§5, §8

D2 范围（v0.1）:
- ✅ 自闭合单值标签 <HY_xxx /> + 文本中 HY_xxx
- ✅ 条件标签 <HY_IF _condition="...">...</HY_IF>
- ✅ 包含标签 <HY_INCLUDE _file="xxx.html" />
- ✅ 注释 <!--HY_ xxx --> 跳过
- ✅ 转义 \\<HY_xxx\\> 输出原文
- ✅ XSS escape（html.escape）
- ✅ 警告：未知标签 / 属性 / 未闭合 IF
- ✅ 递归深度限制（防死循环）

D3 范围（v0.2）: HY_CONTENTS / HY_CATS 容器循环 + filter

设计:
- 6 阶段 pipeline（注释 → 转义保护 → INCLUDE → IF → 单值 → 还原）
- RenderContext 提供 site/cat/content/partials 数据
- 容器标签（D3）走同套管线但需要递归传 item
"""
from __future__ import annotations

import html
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

# ===========================================================================
# 常量与白名单
# ===========================================================================

# 已知单值标签（D2），D3 再加容器类
# 安全标签（输出富文本/预渲染块，不 escape）
_SAFE_TAGS = frozenset({
    "HY_CONTENT_BODY", "HY_CONTENT_PREV", "HY_CONTENT_NEXT",
    "HY_SITE_MENU", "HY_SITE_BREADCRUMB", "HY_BREADCRUMB",
    # 2026-06-08: HY_ITEM_TAGS 输出是预渲染的 <a class="tag"> HTML (在 factory 拼好)
    # 内容已由 taxonomy 控制 (admin 端可写), 但为了安全仍走 _SAFE_TAGS 白名单
    "HY_ITEM_TAGS",
    # P3.6.5+: HY_SITE_CSS / HY_SITE_JS 输出是预渲染的 <link> / <script> HTML (server 拼好)
    # URL 是从 site_assets.name 拼的, 名字是用户输的但只能走 isValidName 过滤
    "HY_SITE_CSS", "HY_SITE_JS",
    # P3.6.5+: 首页块标签输出 server 拼好的 HTML (用户填的字符串已 _esc 转义过)
    "HY_SITE_HERO", "HY_SITE_STATS", "HY_SITE_PRODUCTS", "HY_SITE_CTA",
    # 分页 / 相关文章 / 精选 / 详情正文别名
    "HY_CONTENTS_PAGINATION", "HY_PAGINATION",
    "HY_RELATED_LIST", "HY_HOME_FEATURED", "HY_ITEM_BODY",
})


KNOWN_SELF_CLOSING_TAGS = frozenset({
    # GLOBAL
    "HY_NOW", "HY_BUILD_ID", "HY_THEME_VERSION", "HY_BASE_URL",
    # SITE
    "HY_SITE_NAME", "HY_SITE_SLOGAN", "HY_SITE_DESCRIPTION", "HY_SITE_KEYWORDS",
    "HY_SITE_LOGO", "HY_SITE_FAVICON", "HY_SITE_URL", "HY_SITE_ICP",
    "HY_SITE_COPYRIGHT", "HY_SITE_BREADCRUMB", "HY_SITE_MENU",
    "HY_BREADCRUMB",
    # CATEGORY
    "HY_CAT_ID", "HY_CAT_NAME", "HY_CAT_SLUG", "HY_CAT_DESCRIPTION",
    "HY_CAT_COVER", "HY_CAT_URL", "HY_CAT_PARENT_NAME", "HY_CAT_PARENT_URL", "HY_CAT_META",
    # CONTENTS
    "HY_CONTENTS_PAGINATION", "HY_CONTENTS_COUNT",
    # CONTENT
    "HY_CONTENT_TITLE", "HY_CONTENT_BODY", "HY_CONTENT_URL",
    "HY_CONTENT_META", "HY_CONTENT_PREV", "HY_CONTENT_NEXT",
    # P3.6+ CONTENT 扩展 (P3.8.9 同步: _lookup_value 已实现, KNOWN 漏了)
    "HY_CONTENT_SUBTITLE", "HY_CONTENT_SUMMARY", "HY_CONTENT_EXCERPT",
    "HY_CONTENT_CAT_NAME", "HY_CONTENT_CAT_URL",
    "HY_CONTENT_DATE", "HY_CONTENT_DATE_SHORT", "HY_CONTENT_KEYWORDS", "HY_CONTENT_AUTHOR",
    "HY_CONTENT_PUBLISH_DATE", "HY_CONTENT_READ_TIME",
    "HY_CONTENT_PREV_URL", "HY_CONTENT_NEXT_URL",
    # P3.6+ PAGE 扩展 (site layout 里 <link canonical> / <meta og:title> 用)
    "HY_PAGE_TITLE", "HY_PAGE_URL", "HY_PAGE_DESC", "HY_PAGE_KEYWORDS",
    # P3.8.9+++++: 导航菜单选中态 (site layout nav 用)
    "HY_MENU_ACTIVE",
    # HY_CONTENTS 循环内的 item 子标签 (D3)
    "HY_ITEM_ID", "HY_ITEM_TITLE", "HY_ITEM_URL", "HY_ITEM_SUMMARY", "HY_ITEM_EXCERPT",
    "HY_ITEM_COVER", "HY_ITEM_BANNER", "HY_ITEM_DATE", "HY_ITEM_DATE_YEAR", "HY_ITEM_DATETIME", "HY_ITEM_AUTHOR",
    "HY_ITEM_CAT_NAME", "HY_ITEM_CAT_URL", "HY_ITEM_CAT_SLUG", "HY_ITEM_SUBTITLE",
    "HY_ITEM_TAGS", "HY_ITEM_HITS",
    "HY_ITEM_META",
    # HY_CATS 循环内的 cat_item 子标签 (D3)
    "HY_CAT_ITEM_ID", "HY_CAT_ITEM_NAME", "HY_CAT_ITEM_SLUG",
    "HY_CAT_ITEM_URL", "HY_CAT_ITEM_COVER", "HY_CAT_ITEM_DESCRIPTION",
    "HY_CAT_ITEM_HAS_CHILDREN", "HY_CAT_ITEM_CHILD_COUNT",
    "HY_CAT_ITEM_CURRENT_CLASS",
    # P3.6.2 站点级静态资源 (模板自带的 CSS/JS/字体/Logo)
    "HY_ASSET_URL",
    # 站点内页链接: 按 page_path 深度自动加 ../ 前缀
    "HY_SITE_LINK",
    # P3.6.5+: 一键引入全目录资源 (发多个 link/script)
    "HY_SITE_CSS", "HY_SITE_JS",
    # P3.6.5+: 首页块标签 (从 site.settings.hero/stats/products/cta 读, 输出完整 HTML)
    "HY_SITE_HERO", "HY_SITE_STATS", "HY_SITE_PRODUCTS", "HY_SITE_CTA",
    # P3.7 模板重构: 嵌套模板标签 <HY_TEMPLATE code="header-modern" />
    # 渲染时从 ctx.templates_by_code 查 code 对应 HTML, 递归走 pipeline
    "HY_TEMPLATE",
    # 别名 / 编辑器 cheatsheet 常用标签
    "HY_PAGINATION", "HY_NAV", "HY_FOOTER",
    "HY_HOME_HERO", "HY_HOME_FEATURED",
    "HY_ITEM_BODY", "HY_ITEM_PUBLISH_DATE",
    # 详情页相关文章 / 媒体库引用
    "HY_RELATED_LIST", "HY_MEDIA",
})

# 容器标签（D3 才用，列出来方便 lint 报错时区分）
CONTAINER_TAGS = frozenset({"HY_CONTENTS", "HY_CATS", "HY_IF", "HY_INCLUDE", "HY_TEMPLATE", "HY_CONTENTS_EMPTY"})

# 全部合法 HY_ 标签
ALL_KNOWN_TAGS = KNOWN_SELF_CLOSING_TAGS | CONTAINER_TAGS

# IF 条件支持的真值（v0.1 简化版）
TRUE_CONDITIONS = frozenset({"true", "1", "yes", "y", "on"})

# 包含最大递归深度
MAX_INCLUDE_DEPTH = 10

# D3: 循环 + filter 常量
# ===========================================================================

# 循环排序选项
CONTENTS_ORDERS = ("newest", "oldest", "hits", "random")
CATS_TYPES = ("children", "siblings", "all", "root")

# XSS 黑名单标签（用户写在 layout 里的）
# 1) 起始标签 (用于第一轮 strip)
_DANGEROUS_OPEN = re.compile(
    r'<\s*(script|iframe|object|embed|form)\b[^>]*>',
    re.IGNORECASE,
)
# 2) 匹配整对 (起始 + 内容 + 结束), 用于完整的 script 块
_DANGEROUS_PAIR = re.compile(
    r'<\s*(script|iframe|object|embed|form)\b[^>]*>.*?</\s*\1\s*>',
    re.IGNORECASE | re.DOTALL,
)
DANGEROUS_TAGS = _DANGEROUS_PAIR


# ===========================================================================
# 渲染上下文
# ===========================================================================

@dataclass
class SiteCtx:
    """站点上下文"""
    id: str = ""
    name: str = ""
    slogan: str = ""
    description: str = ""
    keywords: str = ""
    logo_url: str = ""
    favicon_url: str = ""
    url: str = ""
    icp: str = ""
    copyright: str = ""
    base_url: str = ""  # 站点根 URL
    breadcrumb_html: str = ""  # 预渲染的面包屑 HTML
    menu_header_html: str = ""
    menu_footer_html: str = ""
    # P3.6.1 站点级 CSS/JS 自定义 (从 site.settings["custom_css"] / ["custom_js"] 读)
    custom_css: str = ""
    custom_js: str = ""

    # P3.6.5+: 首页块配置 (从 site.settings["hero"]/["stats"]/["products"]/["cta"] 读)
    # dict 格式 (跟 Pydantic schema SiteHeroConfig 等保持一致)
    # 模板用 <HY_SITE_HERO /> <HY_SITE_STATS /> <HY_SITE_PRODUCTS /> <HY_SITE_CTA /> 读
    block_hero: dict = field(default_factory=dict)
    block_stats: dict = field(default_factory=dict)
    block_products: dict = field(default_factory=dict)
    block_cta: dict = field(default_factory=dict)

    def get(self, field_name: str) -> str:
        """META 标签 _type=xxx 查询"""
        return getattr(self, field_name, "")


@dataclass
class CategoryCtx:
    """栏目上下文"""
    id: str = ""
    name: str = ""
    slug: str = ""
    description: str = ""
    cover_url: str = ""
    url: str = ""
    parent_name: str = ""
    parent_url: str = ""   # 父栏目发布 URL，面包屑用
    parent_id: str = ""  # D3 _type=children 过滤用
    has_children: bool = False
    has_description: bool = False
    child_count: int = 0  # HY_CAT_ITEM_CHILD_COUNT 用
    breadcrumb_html: str = ""
    _seo: dict = field(default_factory=dict)  # HY_CAT_META 读取 seo 扩展字段

    def get(self, field_name: str) -> str:
        val = getattr(self, field_name, None)
        if val not in (None, ""):
            return str(val)
        if self._seo and field_name in self._seo:
            return str(self._seo.get(field_name) or "")
        return ""


@dataclass
class ContentCtx:
    """内容详情上下文

    字段: 详情页用 主体; 列表项用 主要为 item.* 字段
    详情 vs 列表 共用同个类（避免重复定义）
    """
    id: str = ""
    title: str = ""
    subtitle: str = ""  # 2026-06-06: HY_CONTENT_SUBTITLE
    body_html: str = ""
    url: str = ""
    cover_url: str = ""
    banner_url: str = ""
    author: str = ""
    published_at: str = ""
    date_short: str = ""  # P3.8.9+: YYYY-MM-DD 短日期 (HY_ITEM_DATE 渲染)
    date_year: str = ""  # P3.8.9+++: YYYY 年份 (HY_ITEM_DATE_YEAR 渲染)
    hits: int = 0
    has_cover: bool = False
    has_banner: bool = False
    is_featured: bool = False  # 头条：栏目 banner
    prev_html: str = ""
    next_html: str = ""
    breadcrumb_html: str = ""
    summary: str = ""  # HY_ITEM_SUMMARY 用
    datetime: str = ""  # HY_ITEM_DATETIME 用 (ISO 完整)
    read_time: str = ""  # HY_CONTENT_READ_TIME 用
    cat_name: str = ""  # HY_ITEM_CAT_NAME 用
    cat_url: str = ""  # HY_ITEM_CAT_URL 用
    cat_slug: str = ""  # D3 _cat 过滤用
    cat_id: str = ""  # D3 _cat 过滤用
    tags_html: str = ""  # HY_ITEM_TAGS 用
    has_tags: bool = False  # HY_IF item.has_tags 用
    has_summary: bool = False  # HY_IF item.has_summary 用
    has_featured: bool = False  # HY_IF content.has_featured 用
    _metadata: dict = field(default_factory=dict)  # HY_CONTENT_META 读取 metadata 扩展字段

    def get(self, field_name: str) -> Any:
        val = getattr(self, field_name, None)
        if val not in (None, ""):
            return val
        if self._metadata and field_name in self._metadata:
            return self._metadata.get(field_name) or ""
        return ""


@dataclass
class _CatItemCtx:
    """HY_CATS 循环内的单条栏目子上下文"""
    id: str = ""
    name: str = ""
    slug: str = ""
    url: str = ""
    cover_url: str = ""
    description: str = ""
    has_children: bool = False
    child_count: int = 0
    is_current: bool = False  # 与当前栏目相同
    has_current: bool = False  # HY_IF cat_item.has_current

    def get(self, field_name: str) -> Any:
        return getattr(self, field_name, "")


@dataclass
class RenderContext:
    """渲染总上下文

    partials: 包含文件 dict (file_name -> html)
              路径：partials 目录在文件系统（生产用）
              或 dict 注入（测试用）
    """
    site: SiteCtx = field(default_factory=SiteCtx)
    category: Optional[CategoryCtx] = None
    content: Optional[ContentCtx] = None
    category_item: Optional[_CatItemCtx] = None  # D3: HY_CATS 循环内的当前栏目 item
    partials: dict[str, str] = field(default_factory=dict)
    partials_dir: Optional[Path] = None
    # P3.7 模板重构: 按 code 索引的模板字典 (HY_TEMPLATE 用)
    # code 是 site 全局唯一的 (scope 限定, 但同 scope 下唯一)
    # 例: {"header-modern": "<header>...</header>", "footer-corp": "<footer>...</footer>"}
    templates_by_code: dict[str, str] = field(default_factory=dict)
    # 跟踪 HY_TEMPLATE 正在渲染的 code 栈 (防环)
    rendering_codes: set = field(default_factory=set)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    build_id: str = ""
    now: str = ""
    theme_version: int = 1
    base_url: str = ""

    # ----- D3 循环数据源 -----
    # 生产环境: 从 DB 查
    # 测试环境: 直接注入 list
    contents_provider: Optional[Callable[[dict], list[ContentCtx]]] = None
    cats_provider: Optional[Callable[[dict], list[CategoryCtx]]] = None
    # 注入的原始数据（优先级高于 provider，测试用）
    contents_data: list[ContentCtx] = field(default_factory=list)
    cats_data: list[CategoryCtx] = field(default_factory=list)
    # 2026-06-06: 页面级内容列表 (for_category 过滤本栏目, for_home 全部)
    contents: list[ContentCtx] = field(default_factory=list)

    # P3.6.2: 站点静态资源 URL 映射 {name: public_url}
    # 用于 HY_ASSET_URL 标签; 由 RenderContextFactory 从 site_assets 表加载
    asset_urls: dict[str, str] = field(default_factory=dict)
    # 媒体库 {media_id: public_url}，HY_MEDIA _id 用
    media_urls: dict[str, str] = field(default_factory=dict)
    # 栏目/首页分页：当前页码（PageRenderer 注入）
    current_page: int = 1
    # 最近一次 HY_CONTENTS 循环的分页元数据（HY_CONTENTS_PAGINATION 用）
    _last_contents_pagination: Optional[dict] = field(default=None, repr=False)

    # P3.6.5+: 按 category 分组的资源列表 (含 name/url/content_type)
    # 用于 HY_SITE_CSS / HY_SITE_JS 一键全引用标签
    assets_by_category: dict[str, list[dict[str, str]]] = field(default_factory=dict)

    # P3.6.5+ fix: 当前页 相对 public 根的 path (例 'index.html', 'about/index.html')
    # 由 PageRenderer 在调 for_xxx() 后设置
    # 用于 HY_SITE_CSS/JS/HY_ASSET_URL 算出真正的相对路径 (assets/ 或 ../assets/)
    # 替代之前的 <base href> 方案, 纯静态文件 + nginx 都能用
    page_path: str = ""

    def filter_contents(self, attrs: dict) -> list[ContentCtx]:
        """D3: 过滤 + 排序内容列表（不含分页切片）

        业务属性:
        - _cat: slug/id
        - _include_children: 含子栏目（父栏目页）
        - _include_siblings: 含同级兄弟栏目文章（案例中心子栏目列表用）
        - _featured / _banner: 仅头条；_banner 默认再要求 Banner 图且每栏目 1 条
        - _has_cover: 必须有缩略图
        - _has_banner: 必须有 Banner 图
        - _limit_per_cat: 每个栏目最多 N 条（排序后截断）
        - _order: newest | oldest | hits | random
        """
        if self.contents_data:
            items = list(self.contents_data)
        elif self.contents_provider is not None:
            items = list(self.contents_provider(attrs))
        else:
            return []

        def _truthy(key: str) -> bool:
            return str(attrs.get(key, "")).lower() in ("true", "1", "yes", "on")

        banner = _truthy("_banner")
        include_children = (
            _truthy("_include_children") if "_include_children" in attrs else banner
        )
        include_siblings = _truthy("_include_siblings")
        want_featured = _truthy("_featured") if "_featured" in attrs else banner
        want_banner = _truthy("_has_banner") if "_has_banner" in attrs else banner
        want_cover = _truthy("_has_cover") if "_has_cover" in attrs else False

        cat_filter = attrs.get("_cat")
        if cat_filter:
            allowed_ids: set[str] = set()
            matched = [
                c for c in self.cats_data
                if c.slug == cat_filter or c.id == cat_filter
            ]
            for parent in matched:
                allowed_ids.add(parent.id)
                if include_children:
                    allowed_ids |= {
                        c.id for c in self.cats_data if c.parent_id == parent.id
                    }
            if allowed_ids:
                items = [
                    c for c in items
                    if c.cat_id in allowed_ids or c.cat_slug == cat_filter or c.cat_id == cat_filter
                ]
            else:
                items = [
                    c for c in items
                    if c.cat_slug == cat_filter or c.cat_id == cat_filter
                ]
        elif self.category is not None and self.category.id:
            cat_id = self.category.id
            if include_siblings and self.category.parent_id:
                # 同级兄弟栏目：案例中心各子栏目共享案例库
                parent_id = self.category.parent_id
                allowed = {
                    c.id for c in self.cats_data
                    if c.parent_id == parent_id or c.id == parent_id
                }
                allowed.add(cat_id)
                items = [c for c in items if c.cat_id in allowed]
            elif include_children:
                children = [c for c in self.cats_data if c.parent_id == cat_id]
                if children:
                    # 父栏目：包含自身及子栏目的文章
                    allowed = {cat_id} | {c.id for c in children}
                else:
                    # 叶子栏目：只显示自己的文章
                    allowed = {cat_id}
                items = [c for c in items if c.cat_id in allowed]
            else:
                items = [c for c in items if c.cat_id == cat_id]

        # _exclude_self: 排除当前文章（用于"更多资讯"）
        if _truthy("_exclude_self") and self.content and self.content.id:
            items = [c for c in items if c.id != self.content.id]

        if want_featured:
            items = [c for c in items if getattr(c, "is_featured", False)]
        if want_banner:
            items = [
                c for c in items
                if c.banner_url or getattr(c, "has_banner", False)
            ]
        if want_cover:
            items = [c for c in items if c.cover_url or getattr(c, "has_cover", False)]

        order = attrs.get("_order", "newest")
        if order == "newest":
            items.sort(key=lambda c: c.published_at, reverse=True)
        elif order == "oldest":
            items.sort(key=lambda c: c.published_at)
        elif order == "hits":
            items.sort(key=lambda c: c.hits, reverse=True)
        elif order == "random":
            import random
            random.shuffle(items)

        if "_limit_per_cat" in attrs:
            limit_per_cat = attrs.get("_limit_per_cat")
        elif banner:
            limit_per_cat = "1"
        else:
            limit_per_cat = None
        if limit_per_cat is not None and str(limit_per_cat).strip() != "":
            n = max(1, int(limit_per_cat))
            seen: dict[str, int] = {}
            limited: list[ContentCtx] = []
            for c in items:
                key = c.cat_id or c.cat_slug or c.id
                cnt = seen.get(key, 0)
                if cnt >= n:
                    continue
                seen[key] = cnt + 1
                limited.append(c)
            items = limited

        return items

    def query_contents(self, attrs: dict) -> list[ContentCtx]:
        """D3: 根据 attrs 查内容列表（含分页）

        attrs keys (业务属性都加 _ 前缀):
        - _limit: int
        - _order: newest | oldest | hits | random
        - _cat: slug 或 id (按栏目过滤, 不传则按当前 category)
        - _page: int (分页；缺省用 ctx.current_page)
        - _include_children / _featured / _has_cover / _has_banner / _banner / _limit_per_cat
        """
        items = self.filter_contents(attrs)
        page = int(attrs.get("_page") or self.current_page or 1)
        page_size = int(attrs.get("_limit", 20))
        start = (page - 1) * page_size
        self._last_contents_pagination = {
            "page": page,
            "page_size": page_size,
            "total": len(items),
        }
        return items[start:start + page_size]

    def query_cats(self, attrs: dict) -> list[CategoryCtx]:
        """D3: 根据 attrs 查栏目列表

        attrs keys:
        - _type: children (默认, 当前栏目的子) | all (所有根) | root
        - _limit: int
        """
        _type = attrs.get("_type", "children")
        limit = int(attrs.get("_limit", 20))

        if _type == "children":
            if self.category is None or not self.category.id:
                return []
            # 过滤子栏目
            items = [c for c in self.cats_data if c.parent_id == self.category.id]
        elif _type == "siblings":
            # 新闻 Tab：有子栏用子栏；叶子页用同父兄弟（含自己）
            if self.category is None or not self.category.id:
                return []
            children = [c for c in self.cats_data if c.parent_id == self.category.id]
            if children:
                items = children
            else:
                parent_id = self.category.parent_id or ""
                if parent_id:
                    items = [c for c in self.cats_data if c.parent_id == parent_id]
                else:
                    items = [c for c in self.cats_data if c.id == self.category.id]
        elif _type in ("all", "root"):
            items = [c for c in self.cats_data if c.parent_id is None or c.parent_id == ""]
        else:
            ctx_warnings = self.warnings
            ctx_warnings.append(f"未知 _type: {_type!r}")
            return []

        return items[:limit]


# ===========================================================================
# 工具：属性解析
# ===========================================================================

# P3.6.2: 允许属性值用单/双引号 (例: _name='site.css')
_ATTR_RE = re.compile(
    r'''([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(["'])([^"']*)\2''',
)


def parse_attrs(s: str) -> dict[str, str]:
    """解析 'key1="v1" key2='v2'' → dict

    P3.6.2: 属性值支持单/双引号
    """
    return {m.group(1): m.group(3) for m in _ATTR_RE.finditer(s)}


# ===========================================================================
# 阶段 1：移除注释
# ===========================================================================

_COMMENT_RE = re.compile(r'<!--HY_[^>]*?-->', re.DOTALL)


def strip_comments(html_str: str) -> str:
    return _COMMENT_RE.sub('', html_str)


# ===========================================================================
# 阶段 2：保护转义
# ===========================================================================

# 匹配 \<HY_xxx\> （不区分大小写，xxx 不含 >）
_ESCAPE_RE = re.compile(r'\\<(HY_[A-Z_]+[A-Z0-9_]*)\\>', re.IGNORECASE)


def protect_escapes(html_str: str) -> tuple[str, dict[str, str]]:
    """把转义的标签换成占位符，避免后续阶段误处理

    返回 (处理后 HTML, 占位符 dict)
    """
    placeholders: dict[str, str] = {}

    def repl(m: re.Match) -> str:
        token = m.group(0)  # 原文 \<HY_xxx\>
        key = f"__HY_ESC_{uuid.uuid4().hex[:8]}__"
        placeholders[key] = token
        return key

    return _ESCAPE_RE.sub(repl, html_str), placeholders


# ===========================================================================
# 阶段 3：解析 INCLUDE
# ===========================================================================

_INCLUDE_RE = re.compile(
    r'<(HY_INCLUDE)\b([^>]*)>',
    re.IGNORECASE,
)


def resolve_includes(
    html_str: str,
    ctx: RenderContext,
    depth: int = 0,
) -> str:
    """把 <HY_INCLUDE _file="x.html" /> 替换为对应文件内容

    - partials 优先 ctx.partials (dict)
    - 否则查 ctx.partials_dir / x.html
    - 防路径穿越：禁止 .. 和绝对路径
    - 递归深度限制
    """
    if depth >= MAX_INCLUDE_DEPTH:
        ctx.errors.append(f"INCLUDE 递归超过 {MAX_INCLUDE_DEPTH} 层")
        return html_str

    def repl(m: re.Match) -> str:
        tag = m.group(1).upper()
        attrs = parse_attrs(m.group(2))
        file_name = attrs.get("_file") or attrs.get("file")  # 兼容旧写法

        if not file_name:
            ctx.errors.append(f"{tag} 缺少 _file 属性")
            return f"<!-- {tag} missing _file -->"

        # 路径安全检查
        if ".." in file_name or file_name.startswith("/"):
            ctx.errors.append(f"{tag} 路径非法: {file_name!r}")
            return f"<!-- {tag} bad path -->"

        # 1) dict 优先
        if file_name in ctx.partials:
            sub_html = ctx.partials[file_name]
        # 2) 查文件系统
        elif ctx.partials_dir is not None:
            full_path = (ctx.partials_dir / file_name).resolve()
            # 防穿越
            if not str(full_path).startswith(str(ctx.partials_dir.resolve())):
                ctx.errors.append(f"{tag} 路径穿越被拦: {file_name!r}")
                return f"<!-- {tag} traversal blocked -->"
            if not full_path.is_file():
                ctx.errors.append(f"{tag} 文件不存在: {file_name!r}")
                return f"<!-- {tag} not found -->"
            try:
                sub_html = full_path.read_text(encoding="utf-8")
            except OSError as e:
                ctx.errors.append(f"{tag} 读文件失败: {e}")
                return f"<!-- {tag} read error -->"
        else:
            ctx.errors.append(f"{tag} partial 未注册: {file_name!r}")
            return f"<!-- {tag} not registered -->"

        # 递归解析子内容
        return render_pipeline(sub_html, ctx, depth=depth + 1)

    return _INCLUDE_RE.sub(repl, html_str)


# ===========================================================================
# 阶段 3.5：解析 HY_TEMPLATE (P3.7 模板重构)
# ===========================================================================

_TEMPLATE_RE = re.compile(
    r'<(HY_TEMPLATE)\b([^>/]*?)(/?)>',
    re.IGNORECASE,
)


def resolve_templates(
    html_str: str,
    ctx: RenderContext,
    depth: int = 0,
) -> str:
    """把 <HY_TEMPLATE code="x" /> 替换为 templates_by_code[x] 内容

    - 查 ctx.templates_by_code[code] (worker publish 预加载了当前 site 所有 partial + 同 scope 的 page)
    - 递归走 render_pipeline (子模板可引用更深的子模板, 最多 MAX_INCLUDE_DEPTH 层防环)
    - code 必须 _ 前缀 (防 HTML 属性冲突)
    """
    if depth >= MAX_INCLUDE_DEPTH:
        ctx.errors.append(f"模板递归超过 {MAX_INCLUDE_DEPTH} 层")
        return html_str

    def repl(m: re.Match) -> str:
        tag = m.group(1).upper()
        attrs = parse_attrs(m.group(2))
        code = attrs.get("code") or attrs.get("_code")
        if not code:
            ctx.errors.append(f"{tag} 缺少 code 属性")
            return f"<!-- {tag} missing code -->"
        if code not in ctx.templates_by_code:
            ctx.errors.append(f"{tag} 模板未注册: code={code!r}")
            return f"<!-- {tag} code={code!r} not found -->"
        # P3.7 防环: 跟踪 code 栈
        if code in ctx.rendering_codes:
            ctx.errors.append(
                f"{tag} 检测到环: code={code!r} 已在渲染栈 {sorted(ctx.rendering_codes)}"
            )
            return f"<!-- {tag} cycle detected: {code} -->"
        sub_html = ctx.templates_by_code[code]
        ctx.rendering_codes.add(code)
        try:
            # 递归走完整 pipeline (子模板自己也可含 HY_TEMPLATE)
            return render_pipeline(sub_html, ctx, depth=depth + 1)
        finally:
            ctx.rendering_codes.discard(code)

    return _TEMPLATE_RE.sub(repl, html_str)


# ===========================================================================
# 阶段 4：解析 IF
# ===========================================================================

_IF_RE = re.compile(
    r'<HY_IF\b([^>]*)>(.*?)</HY_IF>',
    re.DOTALL | re.IGNORECASE,
)


def _eval_condition(cond: str, ctx: RenderContext) -> bool:
    """评估条件表达式

    v0.1 支持的语法：
    - 字面量: true / false / 1 / 0 / yes / no
    - 属性: cat.has_children / content.has_cover / site.xxx
    - 集合 count: contents.count / cats.count / contents.count > 0 / cats.count >= 1
    - 空检查: contents / cats (空集合 = false, 非空 = true)
    - 取反: !content.has_cover / !cat.has_children (P3.8.9++)
    """
    cond = cond.strip()
    # P3.8.9++: 处理 ! 取反: !xxx.has_yyy / !contents.count
    if cond.startswith("!"):
        return not _eval_condition(cond[1:].strip(), ctx)
    if not cond:
        return False

    low = cond.lower()
    if low in TRUE_CONDITIONS:
        return True
    if low in ("false", "0", "no", "n", "off", ""):
        return False

    # contents / cats 作为集合名 (空检查)
    collections = {
        "contents": ctx.contents_data or [],
        "cats": ctx.cats_data or [],
    }

    # 比较运算: collection.count OP num (P0-5)
    m = re.match(
        r'(contents|cats)\.?\s*(count|length|len)?\s*(>=|<=|!=|>|<|==|=)\s*(\d+)',
        cond, re.IGNORECASE,
    )
    if m:
        coll_name = m.group(1).lower()
        op = m.group(3)
        n = int(m.group(4))
        actual = len(collections.get(coll_name, []))
        return _compare(actual, op, n)

    # contents.count (无运算符 → 数字)
    m = re.match(r'(contents|cats)\.?\s*(count|length|len)$', cond, re.IGNORECASE)
    if m:
        # 返回数字 → Python if 调用时会判断 truthy, 0 = False, >0 = True
        return bool(len(collections.get(m.group(1).lower(), [])))

    # contents / cats 集合名 (空检查)
    if low in collections:
        return bool(collections[low])

    # xxx.yyy 形式（属性检查：has_xxx 或普通属性非空判断）
    m = re.match(r'(\w+)\.(\w+)', cond)
    if m:
        scope = m.group(1).lower()
        attr_name = m.group(2)
        target = {
            "site": ctx.site,
            "cat": ctx.category,
            "content": ctx.content,
            "cat_item": ctx.category_item,
            "item": ctx.content,
        }.get(scope)
        if target is None:
            return False
        return bool(getattr(target, attr_name, False))

    # 其他 → 未知条件 = false，并发警告
    ctx.warnings.append(f"未知条件: {cond!r}（v0.1 支持: has_xxx / contents/cats 集合名与 .count）")
    return False


def _compare(a, op, b) -> bool:
    """比较运算符"""
    if op == ">" or op == "==":
        # == 在 regex 里是 =, 统一补
        pass
    if op in (">",):
        return a > b
    if op in ("<",):
        return a < b
    if op in (">=",):
        return a >= b
    if op in ("<=",):
        return a <= b
    if op in ("==", "="):
        return a == b
    if op in ("!=",):
        return a != b
    return False


def resolve_ifs(html_str: str, ctx: RenderContext) -> str:
    """处理 <HY_IF _condition="...">...</HY_IF>

    警告：嵌套 IF 不支持（v0.1）
    """

    def repl(m: re.Match) -> str:
        attrs = parse_attrs(m.group(1))
        inner = m.group(2)
        cond = attrs.get("_condition") or attrs.get("condition") or ""
        if _eval_condition(cond, ctx):
            # 真值 → 递归解析内部（里面可能含 INCLUDE / 单值标签）
            return resolve_self_closing(inner, ctx)
        return ""

    return _IF_RE.sub(repl, html_str)


# ===========================================================================
# D3: Filter 链
# ===========================================================================

# filter 调用语法: name('arg1', 'arg2')
# 双引号也支持: name("arg1")
# 也支持无参: upper (零参)
_FILTER_RE = re.compile(r"""
    \s* ([a-z_]+)            # filter 名
    (?:\(\s*(.*?)\s*\))?     # 可选的 (参数)
    \s* $
""", re.VERBOSE)


def parse_filter_chain(filter_str: str) -> list[tuple[str, list[str]]]:
    """解析 _filter="truncate(80) | date('Y-m-d')"

    返回: [(filter_name, [arg1, arg2]), ...]
    """
    if not filter_str:
        return []
    chain = []
    # 用 | 分隔, 但不能是字符串内的 |
    parts = re.split(r'\s*\|\s*', filter_str.strip())
    for part in parts:
        m = _FILTER_RE.match(part)
        if not m:
            continue
        name = m.group(1)
        args_str = m.group(2) or ""
        # 解析参数: 'a', 'b', "c", 123
        args = []
        if args_str.strip():
            for a in re.finditer(r'''(?:"([^"]*)"|'([^']*)'|([^,]+))''', args_str):
                args.append(a.group(1) or a.group(2) or a.group(3).strip())
        chain.append((name, args))
    return chain


def apply_filters(value: Any, chain: list[tuple[str, list[str]]], ctx: "RenderContext" = None) -> Any:
    """应用 filter 链到 value

    ctx: 可选, abs_url filter 需要 base_url
    """
    import html as html_mod
    for name, args in chain:
        try:
            if name == "truncate" and args:
                n = int(args[0])
                if isinstance(value, str):
                    value = value[:n] + ("..." if len(value) > n else "")
            elif name == "date" and args:
                fmt = args[0]
                # 简单日期格式化 (仅支持 Y/m/d/H/i/s)
                v = str(value or "")
                # 尝试从 ISO 解析
                if "T" in v:
                    try:
                        from datetime import datetime
                        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
                        value = dt.strftime(_format_date_token(fmt))
                    except (ValueError, TypeError):
                        value = v
                else:
                    value = v
            elif name == "default" and args:
                if not value:
                    value = args[0]
            elif name == "upper":
                value = str(value).upper()
            elif name == "lower":
                value = str(value).lower()
            elif name == "strip_html":
                value = re.sub(r'<[^>]+>', '', str(value))
            elif name == "urlencode":
                from urllib.parse import quote
                value = quote(str(value), safe="")
            elif name == "abs_url":
                v = str(value or "")
                if v and not v.startswith(("http://", "https://", "//", "data:", "mailto:")):
                    # 相对路径转绝对 (用 base_url)
                    # ctx 可能是 RenderContext (有 base_url / site.base_url) 或 None
                    base = ""
                    if ctx is not None:
                        base = getattr(ctx, "base_url", "") or ""
                        if not base and getattr(ctx, "site", None) is not None:
                            base = getattr(ctx.site, "base_url", "") or getattr(ctx.site, "url", "")
                    base = base.rstrip("/")
                    if v.startswith("/"):
                        value = base + v
                    else:
                        value = base + "/" + v
                # 已是绝对 URL → 不动
            else:
                pass  # 未知 filter 跳过
        except (ValueError, TypeError, IndexError):
            pass  # 单个 filter 失败不影响链
    return value


def _format_date_token(fmt: str) -> str:
    """PHP-style date() → Python strftime 近似映射"""
    mapping = {
        "Y": "%Y", "y": "%y",
        "m": "%m", "n": "%-m",
        "d": "%d", "j": "%-d",
        "H": "%H", "G": "%-H",
        "i": "%M", "s": "%S",
    }
    out = []
    i = 0
    while i < len(fmt):
        ch = fmt[i]
        if ch == "\\" and i + 1 < len(fmt):
            out.append(fmt[i + 1])
            i += 2
        elif ch in mapping:
            out.append(mapping[ch])
            i += 1
        else:
            out.append(ch)
            i += 1
    return "".join(out)


# ===========================================================================
# D3: 容器循环（HY_CONTENTS / HY_CATS）
# ===========================================================================

_LOOP_RE = re.compile(
    r'<(HY_CONTENTS|HY_CATS)\b([^>]*)>(.*?)</HY_(?:CONTENTS|CATS)>',
    re.DOTALL | re.IGNORECASE,
)

_EMPTY_RE = re.compile(
    r'<HY_CONTENTS_EMPTY\b[^>]*>(.*?)</HY_CONTENTS_EMPTY>',
    re.DOTALL | re.IGNORECASE,
)


def _make_item_ctx(content: ContentCtx) -> ContentCtx:
    """D3: 给 item 计算派生属性"""
    if content.cover_url:
        content.has_cover = True
    if content.banner_url:
        content.has_banner = True
    if content.summary:
        content.has_summary = True
    if content.tags_html:
        content.has_tags = True
    if content.is_featured:
        content.has_featured = True
    return content


def _make_cat_item_ctx(cat: CategoryCtx, *, current_id: str = "") -> _CatItemCtx:
    """D3: 栏目 item 包装"""
    is_current = bool(current_id) and cat.id == current_id
    return _CatItemCtx(
        id=cat.id,
        name=cat.name,
        slug=cat.slug,
        url=cat.url,
        cover_url=cat.cover_url,
        description=cat.description,
        has_children=cat.has_children,
        child_count=cat.child_count,
        is_current=is_current,
        has_current=is_current,
    )


def resolve_loops(html_str: str, ctx: RenderContext) -> str:
    """D3: 处理 <HY_CONTENTS ...>...</HY_CONTENTS> 和 <HY_CATS ...>...</HY_CATS>

    嵌套限制: HY_CONTENTS 不可嵌套 HY_CONTENTS/HY_CATS（D3 不支持嵌套循环）
    HY_CONTENTS_EMPTY 在外层处理: 循环外若有, 列表空时输出包裹内容
    """

    def repl(m: re.Match) -> str:
        tag = m.group(1).upper()
        attrs = parse_attrs(m.group(2))
        # P3.6+: loop attrs 也可能有 HY_ 标签占位符, e.g. _cat="HY_CAT_SLUG"
        # 必须在 query_contents 前替换, 否则 query_contents 拿字面 "HY_CAT_SLUG" 查不到
        for k, v in list(attrs.items()):
            attrs[k] = _resolve_attr_value(v, ctx)
        inner = m.group(3)

        if tag == "HY_CONTENTS":
            items = ctx.query_contents(attrs)
            rendered = []
            for item in items:
                _make_item_ctx(item)
                # 复制 ctx, 但把 content 替换为 item
                item_ctx = _clone_with_item(ctx, item=item)
                rendered.append(render_pipeline(inner, item_ctx, depth=0))
            out = "".join(rendered)
            # 缓存空状态判定
            ctx._last_loop_empty = (len(items) == 0)
            return out
        else:  # HY_CATS
            cats = ctx.query_cats(attrs)
            cur_id = ctx.category.id if ctx.category else ""
            rendered = []
            for cat in cats:
                cat_item = _make_cat_item_ctx(cat, current_id=cur_id)
                item_ctx = _clone_with_item(ctx, item=cat_item)
                rendered.append(render_pipeline(inner, item_ctx, depth=0))
            out = "".join(rendered)
            ctx._last_loop_empty = (len(cats) == 0)
            return out

    return _LOOP_RE.sub(repl, html_str)


def resolve_empty(html_str: str, ctx: RenderContext) -> str:
    """D3: 处理 <HY_CONTENTS_EMPTY>...</HY_CONTENTS_EMPTY>

    只在上一个 HY_CONTENTS 空时输出 (用 ctx._last_loop_empty 标志)
    """
    if not getattr(ctx, "_last_loop_empty", False):
        # 移除空状态标签 (不输出)
        return _EMPTY_RE.sub("", html_str)

    def repl(m: re.Match) -> str:
        inner = m.group(1)
        # 内嵌单值/IF 也需要解析
        return resolve_self_closing(inner, ctx)

    return _EMPTY_RE.sub(repl, html_str)


def _clone_with_item(ctx: RenderContext, item: Any) -> RenderContext:
    """D3: 克隆 ctx 但把 item 注入对应字段

    - item 是 ContentCtx → 设为 ctx.content (覆盖详情页上下文)
    - item 是 _CatItemCtx → 设为 ctx.category_item (新字段)
    """
    import copy
    new_ctx = copy.copy(ctx)
    if isinstance(item, ContentCtx):
        new_ctx.content = item
    elif isinstance(item, _CatItemCtx):
        new_ctx.category_item = item
    return new_ctx


# ===========================================================================
# 阶段 5：解析单值标签
# ===========================================================================

# 匹配 <HY_xxx attr="..." /> 或 <HY_xxx attr="..."></HY_xxx> 或 文本中 HY_xxx
# P3.6.2: 允许属性值用单/双引号 (例: <HY_ASSET_URL _name='site.css' />)
_TAG_SELF_CLOSING_RE = re.compile(
    r'''<(HY_[A-Z_][A-Z0-9_]*)((?:\s+[a-zA-Z_][a-zA-Z0-9_]*(?:=["'][^"']*["']))*)\s*/?>''',
)

# 文本中独立的 HY_xxx（不在标签内、不带尖括号）
_TEXT_TAG_RE = re.compile(
    r'(?<![<\w])(HY_[A-Z_][A-Z0-9_]*)\b(?![^<]*>)',
)


# P3.8.9: 从 prev_html/next_html 抽 href
# 模板 <a class="prev" href="<...>">← 上一篇</a> → 取 href 给 HY_CONTENT_PREV_URL
_HREF_RE = re.compile(r'href="([^"]+)"')

def _extract_href(html: str) -> str:
    """从 <a href="...">xxx</a> 里抽 href

    背景: prev_html/next_html 是整块 <a> 标签, 模板用 <a href="HY_CONTENT_PREV_URL"> 想要裸 URL
    """
    if not html:
        return ""
    m = _HREF_RE.search(html)
    return m.group(1) if m else ""


def _format_publish_date(raw: str, fmt: str) -> str:
    """HY_ITEM_PUBLISH_DATE / HY_CONTENT_PUBLISH_DATE：简单日期格式"""
    if not raw:
        return ""
    fmt = (fmt or "YYYY-MM-DD").strip()
    ymd = raw[:10] if len(raw) >= 10 else raw
    if fmt.upper() == "YYYY-MM-DD":
        return ymd
    if fmt.upper() == "YYYY.MM.DD":
        return ymd.replace("-", ".") if len(ymd) >= 10 else ymd
    if fmt.upper() == "YYYY":
        return raw[:4] if len(raw) >= 4 else raw
    # 兜底 ISO 截断
    return ymd


_ARTICLE_DETAIL_HEAD_RE = re.compile(
    r'<section\b[^>]*\bclass=["\'][^"\']*article-detail-head[^"\']*["\'][^>]*>.*?</section>',
    re.I | re.S,
)
_ARTICLE_DETAIL_BODY_RE = re.compile(
    r'<section\b[^>]*\bclass=["\'][^"\']*article-detail-body[^"\']*["\'][^>]*>\s*'
    r'<div\b[^>]*\bclass=["\'][^"\']*article-detail-container[^"\']*["\'][^>]*>\s*'
    r'<article\b[^>]*\bclass=["\'][^"\']*news-article[^"\']*["\'][^>]*>(.*?)</article>\s*'
    r'</div>\s*</section>',
    re.I | re.S,
)
_ARTICLE_DETAIL_CONTAINER_RE = re.compile(
    r'^\s*<div\b[^>]*\bclass=["\'][^"\']*article-detail-container[^"\']*["\'][^>]*>(.*?)</div>\s*$',
    re.I | re.S,
)
_NEWS_ARTICLE_RE = re.compile(
    r'^\s*<article\b[^>]*\bclass=["\'][^"\']*news-article[^"\']*["\'][^>]*>(.*?)</article>\s*$',
    re.I | re.S,
)


_IMPORTED_STYLE_RE = re.compile(
    r'<style\b[^>]*data-hy-imported[^>]*>.*?</style>\s*',
    re.I | re.S,
)
# 案例详情：正文里不应重复 hero/nav/overview/related（模板 case-detail 已渲染）
_CASE_DETAIL_HERO_RE = re.compile(
    r'<section\b[^>]*\bclass=["\'][^"\']*case-detail-v2-hero[^"\']*["\'][^>]*>.*?</section>\s*',
    re.I | re.S,
)
_CASE_DETAIL_NAV_RE = re.compile(
    r'<nav\b[^>]*\bclass=["\'][^"\']*case-detail-v2-nav[^"\']*["\'][^>]*>.*?</nav>\s*',
    re.I | re.S,
)
_CASE_DETAIL_OVERVIEW_RE = re.compile(
    r'<section\b[^>]*\bclass=["\'][^"\']*case-detail-v2-overview[^"\']*["\'][^>]*>.*?</section>\s*',
    re.I | re.S,
)
_CASE_DETAIL_RELATED_RE = re.compile(
    r'<section\b[^>]*\bclass=["\'][^"\']*case-detail-v2-related[^"\']*["\'][^>]*>.*?</section>\s*',
    re.I | re.S,
)
_CASE_DETAIL_MAIN_RE = re.compile(
    r'<main\b[^>]*\bclass=["\'][^"\']*case-detail-v2[^"\']*["\'][^>]*>(.*?)</main>',
    re.I | re.S,
)


def normalize_content_body_html(html: str) -> str:
    """去掉正文里重复的详情页头部/外壳和内联样式（模板用 HY_CONTENT_* 渲染）"""
    if not html:
        return html
    # 剥掉导入时写入的 <style data-hy-imported> 块（站点资源已有 CSS）
    out = _IMPORTED_STYLE_RE.sub("", html).strip()
    out = _ARTICLE_DETAIL_HEAD_RE.sub("", out, count=1).strip()
    m = _ARTICLE_DETAIL_BODY_RE.search(out)
    if m:
        out = m.group(1).strip()
    else:
        # 兜底：仅剥 container + news-article 外壳
        cm = _ARTICLE_DETAIL_CONTAINER_RE.match(out)
        if cm:
            out = cm.group(1).strip()
        am = _NEWS_ARTICLE_RE.match(out)
        if am:
            out = am.group(1).strip()
    # 案例详情：导入整页时剥掉与模板重复的区块（含误导入的其他案例 hero）
    out = _CASE_DETAIL_HERO_RE.sub("", out).strip()
    out = _CASE_DETAIL_NAV_RE.sub("", out).strip()
    out = _CASE_DETAIL_OVERVIEW_RE.sub("", out).strip()
    out = _CASE_DETAIL_RELATED_RE.sub("", out).strip()
    main_m = _CASE_DETAIL_MAIN_RE.search(out)
    if main_m:
        out = main_m.group(1).strip()
    return out.strip()


def estimate_read_time_label(html: str) -> str:
    """按正文字数估算阅读时长（中文约 400 字/分钟）"""
    text = re.sub(r"<[^>]+>", " ", html or "")
    text = re.sub(r"\s+", "", text)
    if not text:
        return "约 1 分钟阅读"
    minutes = max(1, round(len(text) / 400))
    return f"约 {minutes} 分钟阅读"


def _pagination_page_url(ctx: RenderContext, page_num: int) -> str:
    """静态站点分页链接（跟 PageRenderer.category 路径规则一致）"""
    if page_num <= 1:
        if ctx.category and ctx.category.slug:
            return f"{ctx.category.slug}/index.html"
        return "index.html"
    if ctx.category and ctx.category.slug:
        return f"{ctx.category.slug}/page-{page_num}.html"
    return f"page-{page_num}.html"


def _render_contents_pagination(ctx: RenderContext, attrs: dict[str, str]) -> str:
    """HY_CONTENTS_PAGINATION / HY_PAGINATION 输出分页 HTML"""
    pag = getattr(ctx, "_last_contents_pagination", None)
    if not pag:
        return ""
    page = pag["page"]
    page_size = pag["page_size"]
    total = pag["total"]
    if total <= page_size:
        return ""
    total_pages = (total + page_size - 1) // page_size
    show_numbers = attrs.get("_show_numbers", "true").lower() not in ("false", "0", "no")

    parts = ['<nav class="pagination">']
    if page > 1:
        parts.append(f'<a class="prev" href="{_pagination_page_url(ctx, page - 1)}">上一页</a>')
    if show_numbers:
        for n in range(1, total_pages + 1):
            if n == page:
                parts.append(f'<span class="current" aria-current="page">{n}</span>')
            else:
                parts.append(f'<a href="{_pagination_page_url(ctx, n)}">{n}</a>')
    if page < total_pages:
        parts.append(f'<a class="next" href="{_pagination_page_url(ctx, page + 1)}">下一页</a>')
    parts.append("</nav>")
    return "".join(parts)


def _render_related_list(ctx: RenderContext, attrs: dict[str, str]) -> str:
    """HY_RELATED_LIST：同栏目相关文章（排除当前篇）"""
    if ctx.content is None:
        return ""
    limit = int(attrs.get("_limit", 5))
    cat_id = getattr(ctx.content, "cat_id", "") or ""
    current_id = ctx.content.id
    items = [
        c for c in ctx.contents_data
        if c.cat_id == cat_id and c.id != current_id
    ]
    items.sort(key=lambda c: c.published_at, reverse=True)
    items = items[:limit]
    if not items:
        return ""
    lines = ['<aside class="related-reading"><h3>相关阅读</h3>', '<ul class="related-list">']
    for item in items:
        title = _esc(item.title)
        lines.append(f'<li><a href="{item.url}">{title}</a></li>')
    lines.append("</ul></aside>")
    return "\n".join(lines)


def _render_home_featured(ctx: RenderContext, attrs: dict[str, str]) -> str:
    """HY_HOME_FEATURED：首页精选内容网格（默认卡片结构）"""
    limit = int(attrs.get("_limit", 6))
    order = attrs.get("_order", "newest")
    items = ctx.filter_contents({"_order": order})[:limit]
    if not items:
        return ""
    lines = ['<div class="featured-grid">']
    for item in items:
        title = _esc(item.title)
        cover = item.cover_url
        cover_html = (
            f'<img src="{_esc(cover)}" alt="{title}" loading="lazy" />'
            if cover else ""
        )
        lines.append(
            f'<article class="featured-card">'
            f'<a href="{item.url}">{cover_html}<h3>{title}</h3></a>'
            f'</article>'
        )
    lines.append("</div>")
    return "\n".join(lines)


def _lookup_value(tag: str, attrs: dict[str, str], ctx: RenderContext) -> str:
    """根据标签名取对应值"""
    # --- 别名归一 ---
    if tag == "HY_PAGINATION":
        tag = "HY_CONTENTS_PAGINATION"
    elif tag == "HY_HOME_HERO":
        tag = "HY_SITE_HERO"
    elif tag == "HY_NAV":
        tag = "HY_SITE_MENU"
        attrs = {**attrs, "_location": attrs.get("_location", "header")}
    elif tag == "HY_FOOTER":
        tag = "HY_SITE_MENU"
        attrs = {**attrs, "_location": attrs.get("_location", "footer")}

    if tag == "HY_SITE_BREADCRUMB":
        return ctx.site.breadcrumb_html
    if tag == "HY_SITE_MENU":
        loc = attrs.get("_location", "").lower()
        if loc == "header":
            return ctx.site.menu_header_html
        if loc == "footer":
            return ctx.site.menu_footer_html
        return ""
    if tag == "HY_BREADCRUMB":
        # 按 context 自动
        if ctx.content is not None and ctx.content.breadcrumb_html:
            return ctx.content.breadcrumb_html
        if ctx.category is not None and ctx.category.breadcrumb_html:
            return ctx.category.breadcrumb_html
        return ctx.site.breadcrumb_html

    if tag == "HY_NOW":
        return ctx.now
    if tag == "HY_BUILD_ID":
        return ctx.build_id
    if tag == "HY_THEME_VERSION":
        return str(ctx.theme_version)
    if tag == "HY_BASE_URL":
        return ctx.base_url

    # CATEGORY
    if tag.startswith("HY_CAT_") and ctx.category is not None:
        if tag == "HY_CAT_ID":
            return ctx.category.id
        if tag == "HY_CAT_NAME":
            return ctx.category.name
        if tag == "HY_CAT_SLUG":
            return ctx.category.slug
        if tag == "HY_CAT_DESCRIPTION":
            return ctx.category.description
        if tag == "HY_CAT_COVER":
            return ctx.category.cover_url
        if tag == "HY_CAT_URL":
            return ctx.category.url
        if tag == "HY_CAT_PARENT_NAME":
            return ctx.category.parent_name
        if tag == "HY_CAT_PARENT_URL":
            return ctx.category.parent_url
        if tag == "HY_CAT_META":
            field_name = attrs.get("_type") or attrs.get("type", "")
            return str(ctx.category.get(field_name) or "")

    # CONTENT
    if tag.startswith("HY_CONTENT_") and ctx.content is not None:
        if tag == "HY_CONTENT_TITLE":
            return ctx.content.title
        if tag == "HY_CONTENT_BODY":
            return ctx.content.body_html
        if tag == "HY_CONTENT_URL":
            return ctx.content.url
        if tag == "HY_CONTENT_SUBTITLE":
            return getattr(ctx.content, "subtitle", "") or ""
        if tag in ("HY_CONTENT_SUMMARY", "HY_CONTENT_EXCERPT"):
            return getattr(ctx.content, "summary", "") or ""
        if tag == "HY_CONTENT_CAT_NAME":
            return getattr(ctx.content, "cat_name", "") or ""
        if tag == "HY_CONTENT_CAT_URL":
            return getattr(ctx.content, "cat_url", "") or ""
        if tag == "HY_CONTENT_DATE":
            return getattr(ctx.content, "published_at", "") or ""
        if tag == "HY_CONTENT_DATE_SHORT":
            # P3.8.9: 短日期格式 YYYY-MM-DD (避免 ISO 8601 全字符串太丑)
            raw = getattr(ctx.content, "published_at", "") or ""
            return raw[:10] if raw else ""
        if tag == "HY_CONTENT_KEYWORDS":
            return getattr(ctx.content, "keywords", "") or ""
        if tag == "HY_CONTENT_AUTHOR":
            return getattr(ctx.content, "author", "") or ""
        if tag == "HY_CONTENT_PUBLISH_DATE":
            raw = getattr(ctx.content, "published_at", "") or getattr(ctx.content, "datetime", "") or ""
            return _format_publish_date(raw, attrs.get("_format", "YYYY-MM-DD"))
        if tag == "HY_CONTENT_READ_TIME":
            return getattr(ctx.content, "read_time", "") or ""
        if tag == "HY_CONTENT_META":
            field_name = attrs.get("_type") or attrs.get("type", "")
            return str(ctx.content.get(field_name) or "")
        if tag == "HY_CONTENT_PREV":
            return ctx.content.prev_html
        if tag == "HY_CONTENT_NEXT":
            return ctx.content.next_html
        # P3.8.9: HY_CONTENT_PREV_URL / NEXT_URL 拆 prev_html/next_html 里的 href
        if tag == "HY_CONTENT_PREV_URL":
            return _extract_href(ctx.content.prev_html) or ""
        if tag == "HY_CONTENT_NEXT_URL":
            return _extract_href(ctx.content.next_html) or ""

    # P3.8.9: PAGE 字段 (site layout head 里 <link canonical> / <meta og:title> 用)
    # 优先级: content (详情页) > category (栏目页) > site
    if tag in ("HY_PAGE_TITLE", "HY_PAGE_URL", "HY_PAGE_DESC", "HY_PAGE_KEYWORDS"):
        if ctx.content is not None:
            if tag == "HY_PAGE_TITLE":
                return ctx.content.title or ""
            if tag == "HY_PAGE_URL":
                return ctx.content.url or ""
            if tag == "HY_PAGE_DESC":
                return ctx.content.summary or ""
            if tag == "HY_PAGE_KEYWORDS":
                return ""
        if ctx.category is not None:
            if tag == "HY_PAGE_TITLE":
                return ctx.category.name or ""
            if tag == "HY_PAGE_URL":
                return ctx.category.url or ""
            if tag == "HY_PAGE_DESC":
                return ctx.category.description or ""
            if tag == "HY_PAGE_KEYWORDS":
                return ""
        # 兑底: site
        if tag == "HY_PAGE_TITLE":
            return ctx.site.name or ""
        if tag == "HY_PAGE_URL":
            return ctx.site.url or ""
        if tag == "HY_PAGE_DESC":
            return ctx.site.description or ""
        if tag == "HY_PAGE_KEYWORDS":
            return ctx.site.keywords or ""
        return ""

    # SITE 字段
    site_fields = {
        "HY_SITE_NAME": "name",
        "HY_SITE_SLOGAN": "slogan",
        "HY_SITE_DESCRIPTION": "description",
        "HY_SITE_KEYWORDS": "keywords",
        "HY_SITE_LOGO": "logo_url",
        "HY_SITE_FAVICON": "favicon_url",
        "HY_SITE_URL": "url",
        "HY_SITE_ICP": "icp",
        "HY_SITE_COPYRIGHT": "copyright",
    }
    if tag in site_fields:
        return str(getattr(ctx.site, site_fields[tag], "") or "")

    # P3.8.9+++++: HY_MENU_ACTIVE _match="/path/" — 导航菜单选中态
    # 用法: <a href="/news/" class="nav-link<HY_MENU_ACTIVE _match="/news/" />">新闻</a>
    # 匹**配**返**回** ' active' (CSS 拼到 class), 否**则**空**字**符**串**
    if tag == "HY_MENU_ACTIVE":
        match_path = attrs.get("_match", "").strip()
        if not match_path:
            return ""
        # page_path 例: 'news/index.html', 'product/haishi.html', 'index.html'
        cur_path = "/" + ctx.page_path if ctx.page_path else "/"
        # '/' 匹**配**首页 (page_path=index.html)
        if match_path == "/":
            if ctx.page_path in ("index.html", "", None):
                return " active"
            return ""
        # 匹**配**规则: cur_path 以 match_path 开头 (或**整**段**相**等)
        if cur_path.rstrip("/") == match_path.rstrip("/"):
            return " active"
        if cur_path.startswith(match_path):
            return " active"
        return ""

    # P3.6.5+: 首页块标签 (从 site.settings 读 hero/stats/products/cta)
    # 模板里用 <HY_SITE_HERO /> <HY_SITE_STATS /> <HY_SITE_PRODUCTS /> <HY_SITE_CTA />
    # 1) hero: 一个 hero 区 (badge/title/subtitle/desc + 2 CTA)
    # 2) stats: 4 个数字 (data-count 动画)
    # 3) products: 3 个产品卡
    # 4) cta: 底部行动召唤
    if tag in ("HY_SITE_HERO", "HY_SITE_STATS", "HY_SITE_PRODUCTS", "HY_SITE_CTA"):
        return _render_site_block(tag, ctx)

    # P3.6.5+ fix: 算出当前页相对 public 根的深度, 用于资源 URL 加 '../' 前缀
    # page_path 例: 'index.html' → depth=0, 'about/index.html' → depth=1
    # 这样栏目子页能正确取到 public/assets/ 下的资源 (用 ../assets/x)
    # 首页用 assets/x 拿同层
    def _rel_prefix() -> str:
        depth = ctx.page_path.count("/") if ctx.page_path else 0
        return "../" * depth

    # P3.6.2: HY_ASSET_URL <name> = 站点静态资源公开 URL
    # 支持多种调用形式 (模板选最直观的):
    #   1) <link href="<HY_ASSET_URL _name='site.css' />">  (推荐: 外层用单引号)
    #   2) <HY_ASSET_URL _name="site.css" />  (独立占位, 在 body 中)
    #   3) <link href="<HY_ASSET_URL site.css />">  (兼容, 假装 attr)
    if tag == "HY_ASSET_URL":
        name = attrs.get("_name") or attrs.get("name", "")
        if not name:
            # 试 _: attrs 里任意 key 的 value 作为 name (兼容 <HY_ASSET_URL site.css />)
            for v in attrs.values():
                if v and not v.startswith("_"):
                    name = v
                    break
        if name and hasattr(ctx, "asset_urls") and name in ctx.asset_urls:
            return f"{_rel_prefix()}{ctx.asset_urls[name]}"
        # 资源未上传 → 返回空 (前端不渲染 link/script)
        return ""

    # 站点内页链接: <a href="<HY_SITE_LINK _path='chanpinzhongxin/haishi.html' />">
    if tag == "HY_SITE_LINK":
        path = (attrs.get("_path") or attrs.get("path") or "").strip().lstrip("/")
        if not path:
            return ""
        return f"{_rel_prefix()}{path}"

    # P3.6.5+: 一键引入全目录
    # <HY_SITE_CSS />  → 该站点 css/ 目录下所有资源，每个生成一行 <link rel="stylesheet" href="...">
    # <HY_SITE_JS />   → 同上, 生成 <script src="...">（不支持 async/defer 状语, 模板自己包）
    # 可选 _include="a,b,c" 白名单逗号分隔, 只输出名单里的; _exclude="x,y" 黑名单
    if tag in ("HY_SITE_CSS", "HY_SITE_JS"):
        cat = "css" if tag == "HY_SITE_CSS" else "js"
        if not hasattr(ctx, "assets_by_category"):
            return ""
        items = ctx.assets_by_category.get(cat, [])
        if not items:
            return ""
        include = attrs.get("_include", "").strip()
        exclude = attrs.get("_exclude", "").strip()
        inc_set = {x.strip() for x in include.split(",") if x.strip()} if include else None
        exc_set = {x.strip() for x in exclude.split(",") if x.strip()} if exclude else set()
        lines: list[str] = []
        prefix = _rel_prefix()
        for it in items:
            n = it["name"]
            if inc_set is not None and n not in inc_set:
                continue
            if n in exc_set:
                continue
            url = f"{prefix}{it['url']}"
            if cat == "css":
                lines.append(f'<link rel="stylesheet" href="{url}">')
            else:
                lines.append(f'<script src="{url}"></script>')
        return "\n    ".join(lines)

    # 2026-06-08: HY_CONTENTS_COUNT = 当前页面过滤后的内容总数
    # ctx.contents 在 for_category 已按本栏目过滤 (for_home 是全站), 跟容器循环 ctx.contents_data 同源
    # 不受 _limit/_order 影响 (只受 _cat 影响), 体现「本页面有几篇文章」的语义
    if tag == "HY_CONTENTS_COUNT":
        # 支持与 HY_CONTENTS 相同的过滤属性，便于 toolbar 显示「含子栏目」总数
        if attrs:
            return str(len(ctx.filter_contents(attrs)))
        pag = getattr(ctx, "_last_contents_pagination", None)
        if pag and "total" in pag:
            return str(pag["total"])
        items = ctx.contents or ctx.contents_data
        return str(len(items))
    if tag == "HY_CONTENTS_PAGINATION":
        return _render_contents_pagination(ctx, attrs)
    if tag == "HY_RELATED_LIST":
        return _render_related_list(ctx, attrs)
    if tag == "HY_HOME_FEATURED":
        return _render_home_featured(ctx, attrs)
    if tag == "HY_MEDIA":
        media_id = attrs.get("_id") or attrs.get("id", "")
        if media_id and media_id in ctx.media_urls:
            return ctx.media_urls[media_id]
        return ""

    # D3: HY_ITEM_* (在 HY_CONTENTS 循环内, ctx.content 已被替换为 item)
    if tag.startswith("HY_ITEM_") and ctx.content is not None:
        if tag == "HY_ITEM_BODY":
            return getattr(ctx.content, "body_html", "") or ""
        if tag == "HY_ITEM_PUBLISH_DATE":
            raw = getattr(ctx.content, "published_at", "") or getattr(ctx.content, "datetime", "") or ""
            return _format_publish_date(raw, attrs.get("_format", "YYYY-MM-DD"))
        item_field_map = {
            "HY_ITEM_ID": "id",
            "HY_ITEM_TITLE": "title",
            "HY_ITEM_URL": "url",
            "HY_ITEM_SUMMARY": "summary",
            "HY_ITEM_EXCERPT": "summary",  # 2026-06-06: alias for HY_ITEM_SUMMARY
            "HY_ITEM_COVER": "cover_url",
            "HY_ITEM_BANNER": "banner_url",
            "HY_ITEM_DATE": "date_short",  # P3.8.9+: 走短日期 (YYYY-MM-DD), 跟 HY_CONTENT_DATE_SHORT 对齐
            "HY_ITEM_DATE_YEAR": "date_year",  # P3.8.9+++: 年份 (YYYY)
            "HY_ITEM_DATETIME": "datetime",
            "HY_ITEM_AUTHOR": "author",
            "HY_ITEM_CAT_NAME": "cat_name",
            "HY_ITEM_CAT_URL": "cat_url",
            "HY_ITEM_CAT_SLUG": "cat_slug",
            "HY_ITEM_SUBTITLE": "subtitle",
            "HY_ITEM_TAGS": "tags_html",
            "HY_ITEM_HITS": "hits",
        }
        if tag in item_field_map:
            val = str(getattr(ctx.content, item_field_map[tag], "") or "")
            # 旧数据仅有 cover：Banner 展示可回退缩略图（_banner 过滤仍要求 banner_image）
            if tag == "HY_ITEM_BANNER" and not val:
                val = str(getattr(ctx.content, "cover_url", "") or "")
            return val
        if tag == "HY_ITEM_META":
            field_name = attrs.get("_type") or attrs.get("type", "")
            return str(ctx.content.get(field_name) or "")

    # D3: HY_CAT_ITEM_* (在 HY_CATS 循环内)
    if tag.startswith("HY_CAT_ITEM_") and ctx.category_item is not None:
        ci = ctx.category_item
        if tag == "HY_CAT_ITEM_ID":
            return ci.id
        if tag == "HY_CAT_ITEM_NAME":
            return ci.name
        if tag == "HY_CAT_ITEM_SLUG":
            return ci.slug
        if tag == "HY_CAT_ITEM_URL":
            return ci.url
        if tag == "HY_CAT_ITEM_COVER":
            return ci.cover_url
        if tag == "HY_CAT_ITEM_DESCRIPTION":
            return ci.description
        if tag == "HY_CAT_ITEM_HAS_CHILDREN":
            return "1" if ci.has_children else ""
        if tag == "HY_CAT_ITEM_CHILD_COUNT":
            return str(ci.child_count)
        if tag == "HY_CAT_ITEM_CURRENT_CLASS":
            return "is-current" if ci.is_current else ""

    # 容器标签不归这里（D3）
    if tag in CONTAINER_TAGS:
        return ""

    return ""


# ===========================================================================
# P3.6.5+: 首页块渲染 (hero / stats / products / cta)
# 从 ctx.site.block_{name} 读 dict, 拼出完整 HTML
# 缺数据 (settings 还没存) 返空串, 模板可在外套 HY_IF 判断
# ===========================================================================

import html as _html


def _esc(s: str) -> str:
    """P3.6.5+: 块输出需要 XSS escape (用户填的字符串)"""
    return _html.escape(str(s or ""), quote=True)


def _render_site_block(tag: str, ctx: RenderContext) -> str:
    """<HY_SITE_HERO /> / <HY_SITE_STATS /> / <HY_SITE_PRODUCTS /> / <HY_SITE_CTA />

    读 site.settings.{name}, 返完整 HTML
    """
    if tag == "HY_SITE_HERO":
        h = ctx.site.block_hero
        if not h or not h.get("title"):
            return ""
        badge = _esc(h.get("badge", ""))
        title = _esc(h.get("title", ""))
        subtitle = _esc(h.get("subtitle", ""))  # alias
        desc = _esc(h.get("desc", ""))
        c1 = h.get("cta_primary") or {}
        c2 = h.get("cta_secondary") or {}
        c1_html = _render_cta_button(c1) if c1.get("label") else ""
        c2_html = _render_cta_button(c2) if c2.get("label") else ""
        cta_row = ""
        if c1_html or c2_html:
            cta_row = f'  <div class="cta-row">\n    {c1_html}\n    {c2_html}\n  </div>'
        return (
            f'  <div class="hero-badge">\n'
            f'    <span class="dot"></span>\n'
            f'    {badge}\n'
            f'  </div>\n'
            f'  <h1>{title}</h1>\n'
            f'  <p class="hero-slogan">{subtitle}</p>\n'
            f'  <p class="hero-desc">{desc}</p>'
            f'{cta_row}'
        ).rstrip()
    if tag == "HY_SITE_STATS":
        s = ctx.site.block_stats
        items = s.get("items") if s else None
        if not items:
            return ""
        lines = ['  <div class="stats-grid">']
        for it in items:
            v = int(it.get("value", 0) or 0)
            suf = _esc(it.get("suffix", ""))
            lab = _esc(it.get("label", ""))
            lines.append(
                f'    <div class="stat">'
                f'<div class="stat-value" data-count="{v}" data-suffix="{suf}">0{suf}</div>'
                f'<div class="stat-label">{lab}</div></div>'
            )
        lines.append('  </div>')
        return "\n".join(lines)
    if tag == "HY_SITE_PRODUCTS":
        p = ctx.site.block_products
        items = p.get("items") if p else None
        if not items:
            return ""
        lines = ['  <div class="products-grid">']
        for it in items:
            nm = _esc(it.get("name", ""))
            ds = _esc(it.get("desc", ""))
            hr = _esc(it.get("href", ""))
            ic = _esc(it.get("icon", ""))
            inner_name = (
                f'<a href="{hr}">{nm}</a>' if hr else f'<span>{nm}</span>'
            )
            icon_html = f'<div class="product-icon">{ic}</div>' if ic else ""
            desc_html = f'<p class="product-desc">{ds}</p>' if ds else ""
            lines.append(
                f'    <div class="product-card">'
                f'{icon_html}'
                f'<h3 class="product-name">{inner_name}</h3>'
                f'{desc_html}'
                f'</div>'
            )
        lines.append('  </div>')
        return "\n".join(lines)
    if tag == "HY_SITE_CTA":
        c = ctx.site.block_cta
        if not c or not c.get("title"):
            return ""
        title = _esc(c.get("title", ""))
        desc = _esc(c.get("desc", ""))
        label = _esc(c.get("cta_label", ""))
        href = _esc(c.get("cta_href", ""))
        desc_html = f'<p class="cta-desc">{desc}</p>' if desc else ""
        btn_html = ""
        if label and href:
            btn_html = f'<a class="btn btn-primary" href="{href}">{label} →</a>'
        elif label:
            btn_html = f'<span class="btn btn-primary">{label}</span>'
        return (
            f'  <div class="cta-inner">\n'
            f'    <h2 class="cta-title">{title}</h2>\n'
            f'    {desc_html}\n'
            f'    {btn_html}\n'
            f'  </div>'
        ).rstrip()
    return ""


def _render_cta_button(c: dict) -> str:
    """P3.6.5+: 渲染 Hero/CTA 的按钮 <a>"""
    label = _esc(c.get("label", ""))
    href = _esc(c.get("href", ""))
    style = c.get("style", "primary")
    target = c.get("target", "_self")
    if not label or not href:
        return ""
    target_attr = f' target="{target}"' if target == "_blank" else ""
    rel_attr = ' rel="noopener noreferrer"' if target == "_blank" else ""
    return f'<a class="btn btn-{style}" href="{href}"{target_attr}{rel_attr}>{label} →</a>'

def resolve_self_closing(html_str: str, ctx: RenderContext) -> str:
    """处理 <HY_xxx ... /> 形式（含属性）和 文本中 HY_xxx"""

    # 5.1 处理 <HY_xxx ... /> 形式
    def tag_repl(m: re.Match) -> str:
        tag = m.group(1).upper()
        attrs = parse_attrs(m.group(2))

        # 业务属性必须 _ 前缀（防 HTML 冲突）—— 容错：没 _ 的 warn 但不报死
        for k in attrs:
            if not k.startswith("_") and k in (
                "class", "id", "style", "limit", "order", "type",
                "cat", "condition", "file", "filter", "location",
            ):
                ctx.warnings.append(
                    f"业务属性 {k!r} 应加 _ 前缀（v0.1 兼容但警告）"
                )

        if tag not in ALL_KNOWN_TAGS:
            ctx.warnings.append(f"未知 HY_ 标签: {tag!r}")
            return m.group(0)  # 保留原样

        if tag in CONTAINER_TAGS:
            # 容器标签不在本阶段处理（D3 实现）
            return m.group(0)

        val = _lookup_value(tag, attrs, ctx)
        # D3: 应用 filter 链 (P0-4: 传 ctx 让 abs_url 拿到 base_url)
        filter_str = attrs.get("_filter") or attrs.get("filter")
        if filter_str:
            val = apply_filters(val, parse_filter_chain(filter_str), ctx=ctx)
        if tag in _SAFE_TAGS:
            return val or ""
        return html.escape(val, quote=True) if val else ""

    out = _TAG_SELF_CLOSING_RE.sub(tag_repl, html_str)

    # 5.2 处理文本中的独立 HY_xxx（无属性 / 无尖括号）
    def text_repl(m: re.Match) -> str:
        tag = m.group(1).upper()
        if tag not in KNOWN_SELF_CLOSING_TAGS:
            # P0-7: 对称 warn, 跟 <HY_FAKE/> 形式一致
            ctx.warnings.append(f"未知 HY_ 标签(文本): {tag!r}")
            return m.group(0)
        if tag in CONTAINER_TAGS:
            # 容器标签不能在文本位置 (只在 <HY_CONTENTS>...</HY_CONTENTS> 里)
            return m.group(0)
        val = _lookup_value(tag, {}, ctx)
        if tag in _SAFE_TAGS:
            return val or ""
        return html.escape(val, quote=True) if val else ""

    out = _TEXT_TAG_RE.sub(text_repl, out)
    return out


# ===========================================================================
# 阶段 6：属性值内嵌标签解析 (P0-3)
# ===========================================================================
# 匹配 attr="...<HY_xxx .../>..." 形式
# 例: <a href="<HY_CONTENT_URL/>"> 或 <img src="<HY_SITE_LOGO/>" />
# v0.1 限制: 只支持单层 (属性值里不能再有 HTML 标签, 纯文本+HY_标签)
_ATTR_EMBED_RE = re.compile(
    r'(\w+)="([^"]*(?:<HY_[A-Z_][A-Z0-9_]*(?:\s+[^"]*?)?/?>|HY_[A-Z_][A-Z0-9_]*)[^"]*)"',
    re.IGNORECASE,
)


def _resolve_attr_value(value: str, ctx: RenderContext) -> str:
    """P3.6+: 单个 attr value 里的 HY_ 占位符替换

    背景: resolve_attr_embeds 在 resolve_loops 之后才走, 导致
    <HY_CONTENTS _cat="HY_CAT_SLUG"> 里的 _cat 拿到字面 "HY_CAT_SLUG" 查不到内容
    解决: loop 解析前先调一次本函数, 走同样的标签扫描, 但只对 attr value
    """
    if not value or "HY_" not in value:
        return value

    def tag_repl(tm: re.Match) -> str:
        tag = tm.group(1).upper()
        attrs = parse_attrs(tm.group(2))
        if tag not in ALL_KNOWN_TAGS or tag in CONTAINER_TAGS:
            return tm.group(0)
        val = _lookup_value(tag, attrs, ctx)
        return val or ""

    def bare_repl(tm: re.Match) -> str:
        tag = tm.group(1).upper()
        attrs = parse_attrs(tm.group(2))
        if tag not in ALL_KNOWN_TAGS or tag in CONTAINER_TAGS:
            return tm.group(0)
        val = _lookup_value(tag, attrs, ctx)
        return val or ""

    out = _TAG_SELF_CLOSING_RE.sub(tag_repl, value)
    bare_re = re.compile(r'\b(HY_[A-Z_][A-Z0-9_]*)((?:\s+[a-zA-Z_][a-zA-Z0-9_]*="[^"]*")*)\b')
    out = bare_re.sub(bare_repl, out)
    return out


def resolve_attr_embeds(html_str: str, ctx: RenderContext) -> str:
    """P0-3: 解析 HTML 属性值里嵌入的 HY_ 标签

    例 1: <a href="<HY_CONTENT_URL/>"> → <a href="/tech/1/">
    例 2: <meta content="HY_SITE_DESCRIPTION"> → <meta content="...">
    阶段顺序: resolve_self_closing 之后, 此时大部分标签已渲染
    """

    def repl(m: re.Match) -> str:
        attr_name = m.group(1)
        attr_value = m.group(2)
        # 提取属性值里的 <HY_xxx .../> 标签
        # 用 _TAG_SELF_CLOSING_RE 扫描 attr_value
        def tag_repl(tm: re.Match) -> str:
            tag = tm.group(1).upper()
            attrs = parse_attrs(tm.group(2))
            # 只解析白名单标签
            if tag not in ALL_KNOWN_TAGS or tag in CONTAINER_TAGS:
                return tm.group(0)
            val = _lookup_value(tag, attrs, ctx)
            # filter
            fs = attrs.get("_filter") or attrs.get("filter")
            if fs:
                val = apply_filters(val, parse_filter_chain(fs))
            # 链接/URL 类不 escape, 文本类 escape
            if tag in _SAFE_TAGS:
                return val or ""
            return html.escape(val, quote=True) if val else ""

        # 优先扫描 <HY_xxx .../> 自闭合形式
        new_value = _TAG_SELF_CLOSING_RE.sub(tag_repl, attr_value)
        # 2026-06-06: 再扫裸 HY_XXX (属性值只放一个标签的简化形式)
        # 模式: 全是 HY_XXX[attrs]  没别的
        bare_re = re.compile(r'\b(HY_[A-Z_][A-Z0-9_]*)((?:\s+[a-zA-Z_][a-zA-Z0-9_]*="[^"]*")*)\b')
        def bare_repl(tm: re.Match) -> str:
            tag = tm.group(1).upper()
            attrs = parse_attrs(tm.group(2))
            if tag not in ALL_KNOWN_TAGS or tag in CONTAINER_TAGS:
                return tm.group(0)
            val = _lookup_value(tag, attrs, ctx)
            fs = attrs.get("_filter") or attrs.get("filter")
            if fs:
                val = apply_filters(val, parse_filter_chain(fs))
            if tag in _SAFE_TAGS:
                return val or ""
            return html.escape(val, quote=True) if val else ""
        new_value = bare_re.sub(bare_repl, new_value)
        return f'{attr_name}="{new_value}"'

    return _ATTR_EMBED_RE.sub(repl, html_str)


# ===========================================================================
# Pipeline 入口
# ===========================================================================

def render_pipeline(
    html_str: str,
    ctx: RenderContext,
    depth: int = 0,
    strip_scripts: bool = True,
) -> str:
    """8 阶段渲染管线 (P0-3 后增为 8)

    1) 移除注释
    2) 保护转义
    3) 解析 INCLUDE（递归）
    4) 解析 LOOP (HY_CONTENTS / HY_CATS)
    5) 解析 EMPTY (HY_CONTENTS_EMPTY)
    6) 解析 IF
    7) 解析单值标签
    8) 解析属性值内嵌标签 (P0-3) - 最后一步, 处理 <a href="<HY_xxx/>">
    9) 还原转义

    strip_scripts: 为 False 时跳过 XSS 黑名单过滤（layout 模板可信）
    """
    if depth >= MAX_INCLUDE_DEPTH:
        ctx.errors.append(f"渲染递归超过 {MAX_INCLUDE_DEPTH} 层")
        return ""

    if strip_scripts:
        # XSS 黑名单: 检测 + 从输出中移除 (不止记录 errors, 还要在结果中 strip)
        # 阶段 0: 先剥整对 (script ... /script)
        pair_matches = list(_DANGEROUS_PAIR.finditer(html_str))
        for m in pair_matches:
            ctx.errors.append(f"禁用标签: {m.group(0)[:60]}")
        out = _DANGEROUS_PAIR.sub("", html_str)
        # 阶段 0.1: 再剥单标签 (如 <iframe ...> 没成对)
        open_matches = list(_DANGEROUS_OPEN.finditer(out))
        for m in open_matches:
            ctx.errors.append(f"禁用标签: {m.group(0)}")
        out = _DANGEROUS_OPEN.sub("", out)
    else:
        out = html_str

    out = strip_comments(out)
    out, placeholders = protect_escapes(out)
    out = resolve_includes(out, ctx, depth=depth)
    # P3.7: HY_TEMPLATE 嵌套解析 (在 include 之后, IF/loop 之前)
    out = resolve_templates(out, ctx, depth=depth)
    # D3: 循环必须在 IF 前 (循环体里可能有 IF, 但 IF 里的 content.has_cover 依赖 cloned ctx)
    out = resolve_loops(out, ctx)
    out = resolve_empty(out, ctx)
    out = resolve_ifs(out, ctx)
    out = resolve_self_closing(out, ctx)
    # P0-3: 属性值内嵌标签
    out = resolve_attr_embeds(out, ctx)

    # 还原转义
    for key, original in placeholders.items():
        out = out.replace(key, original)

    return out


def render(html_str: str, ctx: RenderContext, *, strip_scripts: bool = True) -> str:
    """对外 API：D2 完整渲染

    示例:
        ctx = RenderContext(site=SiteCtx(name="My Site"))
        result = render("<h1>HY_SITE_NAME</h1>", ctx)

    strip_scripts: 为 False 时保留 <script> 标签（layout 模板可信）
    """
    return render_pipeline(html_str, ctx, depth=0, strip_scripts=strip_scripts)
