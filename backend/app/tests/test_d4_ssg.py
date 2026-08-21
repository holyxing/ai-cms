"""D4 单测 - 15 cases

D4 范围:
A. RenderContextFactory 适配 (4)
B. PageRenderer 4 种页面 (4)
C. SitemapBuilder (3)
D. build_site 全流程 (4)
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
import pytest

from app.services.render_context_factory import (
    RenderContextFactory, site_to_ctx, category_to_ctx, content_to_ctx,
    pick_default_layout,
)
from app.services.page_renderer import (
    PageRenderer, PageFile, SitemapBuilder, build_site,
)


# ===========================================================================
# 共享 fixtures
# ===========================================================================

@dataclass
class Site:
    id: str = "s1"
    slug: str = "test"
    name: str = "测试站"
    slogan: str = "副"
    description: str = "一个测试站"
    url: str = "https://test.com"
    logo_url: str = "/logo.png"


@dataclass
class Cat:
    id: str = "c1"
    name: str = "科技"
    slug: str = "tech"
    parent_id: str = ""
    content_count: int = 2
    url: str = "/tech"
    seo: dict = field(default_factory=dict)


@dataclass
class Cont:
    id: str = "ct1"
    title: str = "文章 1"
    url: str = "/tech/1"
    excerpt: str = "摘要 1"
    cover_url: str = "/c1.jpg"
    author_name: str = "holy"
    published_at: datetime = field(default_factory=lambda: datetime(2026, 6, 1, tzinfo=timezone.utc))
    view_count: int = 100
    category_id: str = "c1"


def make_layout(scope: str, html: str, is_default=True):
    return dict(
        id=f"l-{scope}", scope=scope, code=scope,
        html=html, is_default=is_default, deleted_at=None,
    )


# ===========================================================================
# A. RenderContextFactory 适配 (4)
# ===========================================================================

def test_A1_site_to_ctx():
    """site ORM → SiteCtx, 字段完整"""
    site = Site()
    ctx = site_to_ctx(site, base_url="https://x.com")
    assert ctx.name == "测试站"
    assert ctx.base_url == "https://x.com"
    assert ctx.id == "s1"


def test_A2_category_to_ctx():
    """Cat → CategoryCtx, has_children 通过 seo 标识"""
    cat = Cat(seo={"has_children": True, "cover": "/c.jpg"})
    ctx = category_to_ctx(cat)
    assert ctx.name == "科技"
    assert ctx.has_children is True
    assert ctx.url == "/tech"


def test_A3_content_to_ctx_derives_props():
    """Cont → ContentCtx, has_cover / published_at 派生"""
    content = Cont(cover_url="/c.jpg", excerpt="摘要")
    ctx = content_to_ctx(content)
    assert ctx.has_cover is True
    assert ctx.has_summary is True
    assert ctx.published_at.startswith("2026-06-01")
    assert ctx.author == "holy"


def test_A4_factory_for_pages():
    """for_home / for_category / for_content 注入正确"""
    site = Site()
    cat = Cat()
    content = Cont()
    factory = RenderContextFactory(site=site, cats=[cat], contents=[content])
    home = factory.for_home()
    assert home.content is None
    assert home.category is None
    cat_page = factory.for_category(cat)
    assert cat_page.category.name == "科技"
    detail = factory.for_content(content, cat=cat)
    assert detail.content.title == "文章 1"
    assert detail.content.cat_slug == "tech"


# ===========================================================================
# B. PageRenderer 4 种页面 (4)
# ===========================================================================

def test_B1_renderer_home():
    """scope=home, path=index.html"""
    site = Site()
    cat = Cat()
    content = Cont()
    factory = RenderContextFactory(site=site, cats=[cat], contents=[content])
    layouts = [make_layout("home", "<h1><HY_SITE_NAME/></h1>")]
    r = PageRenderer(factory, layouts=layouts)
    f = r.home()
    assert f.path == "index.html"
    assert f.page_type == "home"
    assert "测试站" in f.html


def test_B2_renderer_category():
    """scope=category, path=cat-slug/index.html, 列表自动过滤本栏目"""
    site = Site()
    cat = Cat()
    c1 = Cont(id="ct1", title="文A", url="/tech/1", category_id="c1")
    c2 = Cont(id="ct2", title="文B", url="/tech/2", category_id="c1")
    c3 = Cont(id="ct3", title="外站文", url="/other/1", category_id="c-other")
    factory = RenderContextFactory(site=site, cats=[cat], contents=[c1, c2, c3])
    layouts = [make_layout(
        "category",
        "<h2><HY_CAT_NAME/></h2><ul><HY_CONTENTS _limit=\"10\"><li>HY_ITEM_TITLE</li></HY_CONTENTS></ul>"
    )]
    r = PageRenderer(factory, layouts=layouts)
    f = r.category(cat)
    assert f.path == "tech/index.html"
    assert f.page_type == "category"
    assert "文A" in f.html
    assert "文B" in f.html
    assert "外站文" not in f.html  # 自动过滤本栏目


def test_B3_renderer_content():
    """scope=content, path=cat-slug/xx-slug.html (D5 修正: 用 content.slug)"""
    site = Site()
    cat = Cat()
    content = Cont()
    factory = RenderContextFactory(site=site, cats=[cat], contents=[content])
    layouts = [make_layout("content", "<h1><HY_CONTENT_TITLE/></h1><div><HY_CONTENT_BODY/></div>")]
    r = PageRenderer(factory, layouts=layouts)
    f = r.content(content, cat=cat)
    # D5: path 用 content.slug, 不是 url.split("/")[-1]
    # Cont().url = "/tech/1" (为兼容旧逻辑) + 新逻辑优先 slug
    # 但 Cont() dataclass 无 slug 字段 → 走 fallback id
    # 用真 slug 测试
    assert f.path.endswith(".html")
    assert "文章 1" in f.html


def test_inner_page_gets_white_header_home_does_not():
    """非首页套白菜单；首页保持原 header（与 banner 同色）"""
    site = Site()
    cat = Cat()
    content = Cont()
    factory = RenderContextFactory(site=site, cats=[cat], contents=[content])
    layouts = [
        make_layout(
            "site",
            '<html><head></head><body><header class="site-header"></header>__LAYOUT_CONTENT__</body></html>',
        ),
        make_layout("home", '<section class="hero">home</section>'),
        make_layout("content", "<article>detail</article>"),
        make_layout("category", "<section>list</section>"),
    ]
    r = PageRenderer(factory, layouts=layouts)
    home = r.home()
    assert "hy-inner-page" not in home.html
    assert 'id="hy-inner-header"' not in home.html
    inner = r.content(content, cat=cat)
    assert "hy-inner-page" in inner.html
    assert 'id="hy-inner-header"' in inner.html
    assert "body.hy-inner-page main { padding-top: 66px; }" in inner.html
    assert "position: fixed;" in inner.html
    cat_page = r.category(cat)
    assert "hy-inner-page" in cat_page.html


def test_B3b_renderer_content_uses_slug():
    """D5: 详情页 path = cat-slug/{content.slug}.html"""
    site = Site()
    cat = Cat()
    # 含 slug 字段的 content
    @dataclass
    class ContWithSlug:
        id: str = "ct-uuid"
        title: str = "有 slug"
        slug: str = "my-article"
        excerpt: str = "x"
        cover_url: str = ""
        published_at: datetime = field(default_factory=lambda: datetime(2026, 6, 1, tzinfo=timezone.utc))
        view_count: int = 0
        category_id: str = "c1"
    factory = RenderContextFactory(site=site, cats=[cat], contents=[ContWithSlug()])
    layouts = [make_layout("content", "<h1><HY_CONTENT_TITLE/></h1>")]
    r = PageRenderer(factory, layouts=layouts)
    f = r.content(ContWithSlug(), cat=cat)
    assert f.path == "tech/my-article.html"


def test_B4_renderer_no_default_layout_warns():
    """没有 default layout → 返回空 + warn (PageFile.warnings 透传)"""
    site = Site()
    factory = RenderContextFactory(site=site, cats=[], contents=[])
    layouts = []  # 空
    r = PageRenderer(factory, layouts=layouts)
    f = r.home()
    assert f.html == ""
    assert any("no default layout" in w for w in f.warnings)


# ===========================================================================
# C. SitemapBuilder (3)
# ===========================================================================

def test_C1_sitemap_basic():
    """3 个 PageFile → 3 个 url 节点"""
    pages = [
        PageFile(path="index.html", html="<h1>home</h1>", page_type="home"),
        PageFile(path="tech/index.html", html="<h2>tech</h2>", page_type="category"),
        PageFile(path="tech/1.html", html="<h3>1</h3>", page_type="content"),
    ]
    sm = SitemapBuilder(site_url="https://x.com")
    sm_file = sm.build(pages, lastmod="2026-06-06")
    assert sm_file.path == "sitemap.xml"
    assert "<loc>https://x.com/index.html</loc>" in sm_file.html
    assert "<loc>https://x.com/tech/index.html</loc>" in sm_file.html
    assert "<loc>https://x.com/tech/1.html</loc>" in sm_file.html
    assert "<lastmod>2026-06-06</lastmod>" in sm_file.html


def test_C2_sitemap_skips_empty_pages():
    """空 html 的 PageFile 不入 sitemap"""
    pages = [
        PageFile(path="index.html", html="<h1>home</h1>", page_type="home"),
        PageFile(path="404.html", html="", page_type="content"),  # 跳过
    ]
    sm = SitemapBuilder(site_url="https://x.com")
    sm_file = sm.build(pages)
    assert "index.html" in sm_file.html
    assert "404.html" not in sm_file.html


def test_C3_sitemap_xml_escape():
    """特殊字符 (?&) 转义"""
    pages = [
        PageFile(path="search.html?q=a&b=c", html="x", page_type="site"),
    ]
    sm = SitemapBuilder(site_url="https://x.com")
    sm_file = sm.build(pages)
    assert "&amp;" in sm_file.html


# ===========================================================================
# D. build_site 全流程 (4)
# ===========================================================================

def test_D1_build_site_full_flow():
    """1 home + 1 cat + 2 contents + 1 sitemap = 5 PageFile"""
    site = Site()
    cat = Cat()
    c1 = Cont(id="ct1", title="A", url="/tech/1")
    c2 = Cont(id="ct2", title="B", url="/tech/2")
    layouts = [
        make_layout("home", "<h1><HY_SITE_NAME/></h1><HY_CONTENTS _limit=\"5\"><li>HY_ITEM_TITLE</li></HY_CONTENTS>"),
        make_layout("category", "<h2><HY_CAT_NAME/></h2><HY_CONTENTS><li>HY_ITEM_TITLE</li></HY_CONTENTS>"),
        make_layout("content", "<h1><HY_CONTENT_TITLE/></h1>"),
        make_layout("site", "<p>x</p>"),
    ]
    files = build_site(site, cats=[cat], contents=[c1, c2], layouts=layouts, base_url="https://test.com")
    assert len(files) == 5
    types = sorted(f.page_type for f in files)
    assert types == ["category", "content", "content", "home", "site"]
    # 按 path 排序
    paths = [f.path for f in files]
    assert paths == sorted(paths)


def test_D2_build_site_sitemap_lastmod():
    """build_site 自动生成 sitemap, lastmod = today"""
    site = Site()
    layouts = [make_layout("home", "<h1>x</h1>")]
    files = build_site(site, cats=[], contents=[], layouts=layouts, base_url="https://test.com", now=datetime(2026, 6, 6, tzinfo=timezone.utc))
    sm = next(f for f in files if f.path == "sitemap.xml")
    assert "<lastmod>2026-06-06</lastmod>" in sm.html


def test_D3_build_site_only_home_no_data():
    """空数据 → 仅 home + sitemap (2 文件)"""
    site = Site()
    layouts = [make_layout("home", "<h1><HY_SITE_NAME/></h1>")]
    files = build_site(site, cats=[], contents=[], layouts=layouts, base_url="https://test.com")
    # 1 home + 1 sitemap = 2 (空 contents 不创建内容页, 空 cats 不创建栏目页)
    paths = [f.path for f in files]
    assert "index.html" in paths
    assert "sitemap.xml" in paths


def test_D4_pick_default_layout_ignores_deleted():
    """pick_default_layout 跳过 deleted_at 非空"""
    layouts = [
        dict(id="l1", scope="home", is_default=True, deleted_at=datetime(2026, 1, 1, tzinfo=timezone.utc)),
        dict(id="l2", scope="home", is_default=True, deleted_at=None),  # 活着的 default
    ]
    picked = pick_default_layout(layouts, scope="home")
    assert picked["id"] == "l2"


# ===========================================================================
# P3.6.5+ fix: HY_SITE_CSS / HY_ASSET_URL 按 page_path 算相对深度
# ===========================================================================

def test_E1_hy_site_css_relative_depth_home():
    """首页 depth=0 → 输出 assets/style.css (同层)"""
    site = Site()
    factory = RenderContextFactory(site=site, cats=[], contents=[])
    factory.assets_by_category = {
        "css": [{"name": "style.css", "url": "assets/style.css", "content_type": "text/css"}],
    }
    layouts = [make_layout("home", '<HY_SITE_CSS />')]
    r = PageRenderer(factory, layouts=layouts)
    f = r.home()
    assert f.path == "index.html"
    assert 'href="assets/style.css"' in f.html
    assert "../" not in f.html  # 首页不该有 ../


def test_E2_hy_site_css_relative_depth_category():
    """栏目子页 depth=1 → 输出 ../assets/style.css (上溯一层)"""
    site = Site()
    cat = Cat(slug="about")
    factory = RenderContextFactory(site=site, cats=[cat], contents=[])
    factory.assets_by_category = {
        "css": [{"name": "style.css", "url": "assets/style.css", "content_type": "text/css"}],
    }
    # layout 包含 <HY_SITE_CSS />, 但要走 site/site 包壳才能渲染 → 加 site layout
    layouts = [
        make_layout("site", "<head><HY_SITE_CSS /></head><body>__LAYOUT_CONTENT__</body>"),
        make_layout("category", "<h1>x</h1>"),
    ]
    r = PageRenderer(factory, layouts=layouts)
    f = r.category(cat)
    assert f.path == "about/index.html"
    assert 'href="../assets/style.css"' in f.html


def test_E3_hy_site_css_relative_depth_content():
    """详情页 depth=1 → 输出 ../assets/style.css"""
    @dataclass
    class ContWithSlug:
        id: str = "ct-x"
        title: str = "X"
        slug: str = "hello"
        url: str = ""
        excerpt: str = ""
        cover_url: str = ""
        published_at: datetime = field(default_factory=lambda: datetime(2026, 6, 1, tzinfo=timezone.utc))
        view_count: int = 0
        category_id: str = "c1"
    site = Site()
    cat = Cat(slug="about")
    content = ContWithSlug()
    factory = RenderContextFactory(site=site, cats=[cat], contents=[content])
    factory.assets_by_category = {
        "css": [{"name": "style.css", "url": "assets/style.css", "content_type": "text/css"}],
    }
    layouts = [
        make_layout("site", "<head><HY_SITE_CSS /></head><body>__LAYOUT_CONTENT__</body>"),
        make_layout("content", "<h1>x</h1>"),
    ]
    r = PageRenderer(factory, layouts=layouts)
    f = r.content(content, cat=cat)
    assert f.path == "about/hello.html"
    assert 'href="../assets/style.css"' in f.html


def test_E4_hy_site_css_no_base_href_in_output():
    """P3.6.5+ fix: 不再输出 <base href> (改用 page_path 算相对路径)"""
    site = Site()
    factory = RenderContextFactory(site=site, cats=[], contents=[])
    factory.assets_by_category = {
        "css": [{"name": "style.css", "url": "assets/style.css", "content_type": "text/css"}],
    }
    layouts = [
        make_layout("site", '<head><HY_SITE_CSS /></head><body>__LAYOUT_CONTENT__</body>'),
        make_layout("home", "<h1>home</h1>"),
    ]
    r = PageRenderer(factory, layouts=layouts)
    f = r.home()
    assert "<base " not in f.html, f"不应该有 <base>: {f.html[:300]}"


def test_E5_hy_asset_url_relative_depth():
    """HY_ASSET_URL 也按 page_path 加 ../ 前缀 (独立占位形式)"""
    site = Site()
    cat = Cat(slug="about")
    factory = RenderContextFactory(site=site, cats=[cat], contents=[])
    factory.asset_urls = {"logo.png": "assets/logo.png"}
    # 独立占位形式 (在 body 内) — 这个 path 走主 pipeline
    layouts = [make_layout("category", '<img src="<HY_ASSET_URL _name=\'logo.png\' />">')]
    r = PageRenderer(factory, layouts=layouts)
    f = r.category(cat)
    # HY_ASSET_URL 解析在主 pipeline, 会被替换为 URL
    assert "../assets/logo.png" in f.html
    # 首页 depth=0 → 不加 ../
    f2 = r.home()
    # home layout 没改还是 default, 跑 E1 已覆盖首页 case, 这里不重复


def test_E6_hy_site_link_relative_depth():
    """HY_SITE_LINK 按 page_path 加 ../ 前缀"""
    site = Site()
    cat = Cat(slug="chanpinzhongxin")
    factory = RenderContextFactory(site=site, cats=[cat], contents=[])
    layouts = [make_layout("category", '<a href="<HY_SITE_LINK _path=\'chanpinzhongxin/haishi.html\' />">')]
    r = PageRenderer(factory, layouts=layouts)
    f = r.category(cat)
    assert 'href="../chanpinzhongxin/haishi.html"' in f.html
    layouts_home = [make_layout("home", '<a href="<HY_SITE_LINK _path=\'index.html\' />">')]
    r2 = PageRenderer(factory, layouts=layouts_home)
    f2 = r2.home()
    assert 'href="index.html"' in f2.html


# ===========================================================================
# P3.6.5+: 首页块渲染 (从 site.settings 读 hero/stats/products/cta)
# ===========================================================================

def test_F1_hy_site_hero_empty():
    """site.settings.hero 空 → 标签输出空串"""
    site = Site()
    factory = RenderContextFactory(site=site, cats=[], contents=[])
    layouts = [make_layout("home", '<section><HY_SITE_HERO /></section>')]
    r = PageRenderer(factory, layouts=layouts)
    f = r.home()
    assert "<HY_SITE_HERO" not in f.html, f"标签没替换: {f.html[:300]}"
    # 空 settings 时只保留空 section
    assert "<section></section>" in f.html or "<section>\n</section>" in f.html


def test_F2_hy_site_hero_full():
    """site.settings.hero 完整 → 渲染出 badge/title/2 CTA"""
    site = Site()
    factory = RenderContextFactory(site=site, cats=[], contents=[])
    factory.site_ctx.block_hero = {
        "badge": "测试徽章",
        "title": "测试标题",
        "subtitle": "测试副标题",
        "desc": "测试描述",
        "cta_primary": {"label": "主按钮", "href": "/primary/", "style": "primary"},
        "cta_secondary": {"label": "次按钮", "href": "/secondary/", "style": "ghost"},
    }
    layouts = [make_layout("home", '<section><HY_SITE_HERO /></section>')]
    r = PageRenderer(factory, layouts=layouts)
    f = r.home()
    assert "测试徽章" in f.html
    assert "<h1>测试标题</h1>" in f.html
    assert 'href="/primary/"' in f.html
    assert 'href="/secondary/"' in f.html
    assert "btn-primary" in f.html
    assert "btn-ghost" in f.html


def test_F3_hy_site_stats():
    """site.settings.stats 4 个数字"""
    site = Site()
    factory = RenderContextFactory(site=site, cats=[], contents=[])
    factory.site_ctx.block_stats = {
        "items": [
            {"value": 200, "suffix": "+", "label": "客户"},
            {"value": 10, "suffix": "+", "label": "行业"},
            {"value": 1000, "suffix": "万+", "label": "数据"},
            {"value": 98, "suffix": "%", "label": "准确率"},
        ]
    }
    layouts = [make_layout("home", '<section><HY_SITE_STATS /></section>')]
    r = PageRenderer(factory, layouts=layouts)
    f = r.home()
    assert 'data-count="200"' in f.html
    assert 'data-count="98"' in f.html
    assert 'data-suffix="万+"' in f.html
    assert "客户" in f.html
    assert "准确率" in f.html
    assert '<div class="stats-grid">' in f.html


def test_F4_hy_site_cta():
    """site.settings.cta 完整 → 渲染 title + 按钮"""
    site = Site()
    factory = RenderContextFactory(site=site, cats=[], contents=[])
    factory.site_ctx.block_cta = {
        "title": "CTA测试",
        "desc": "CTA描述",
        "cta_label": "开始",
        "cta_href": "/start/",
    }
    layouts = [make_layout("home", '<section><HY_SITE_CTA /></section>')]
    r = PageRenderer(factory, layouts=layouts)
    f = r.home()
    assert "CTA测试" in f.html
    assert "CTA描述" in f.html
    assert 'href="/start/"' in f.html
    assert "开始" in f.html


def test_F5_hy_site_hero_xss_escape():
    """hero 块 XSS escape: 用户输入 <script> 不会执行"""
    site = Site()
    factory = RenderContextFactory(site=site, cats=[], contents=[])
    factory.site_ctx.block_hero = {
        "badge": "<script>alert(1)</script>",
        "title": "正常标题",
        "desc": "有 <b>HTML</b>",
    }
    layouts = [make_layout("home", '<section><HY_SITE_HERO /></section>')]
    r = PageRenderer(factory, layouts=layouts)
    f = r.home()
    # 危险字符被 escape
    assert "<script>alert(1)</script>" not in f.html
    assert "&lt;script&gt;" in f.html or "&lt;script" in f.html
