"""栏目 + 文章 slug 强校验 (用户要求: 栏目必须英文, 文章发布到对应目录)

测试覆盖:
- 栏目页: slug 合法/不合法 路径生成
- 详情页: cat slug / content slug 双重校验
- PageRenderer 在 slug 缺失时返空页 + warn, 不写错路径
"""
from dataclasses import dataclass
from app.services.page_renderer import PageRenderer
from app.services.render_context_factory import RenderContextFactory


@dataclass
class FakeSite:
    id: str = "s1"
    slug: str = "test"
    name: str = "测试"
    url: str = "https://x.com"
    settings: dict = None


@dataclass
class FakeCat:
    id: str = "c1"
    name: str = "前端"
    slug: str = "frontend"
    parent_id: str = ""
    site_id: str = "s1"
    deleted_at: object = None


@dataclass
class FakeContent:
    id: str = "ct1"
    title: str = "A"
    slug: str = "a"
    status: str = "published"
    deleted_at: object = None
    is_deleted: bool = False
    category_id: str = "c1"
    body_html: str = "<p>body</p>"
    published_version_id: str = ""
    excerpt: str = ""
    cover_url: str = ""


@dataclass
class FakeLayout:
    id: str = "l1"
    scope: str = "content"
    code: str = "content"
    html: str = "<h1><HY_CONTENT_TITLE/></h1>"
    is_default: bool = True
    deleted_at: object = None


def test_category_legal_slug_path():
    """合法 slug → 正常路径"""
    site = FakeSite()
    factory = RenderContextFactory(site=site, cats=[FakeCat()], contents=[])
    pr = PageRenderer(factory, layouts=[
        FakeLayout(scope="category", code="cat", html="<h1>x</h1>"),
    ])
    p = pr.category(FakeCat())
    assert p.path == "frontend/index.html"
    assert p.html == "<h1>x</h1>"
    assert p.warnings == []


def test_category_chinese_slug_skipped():
    """中文 slug → 空页 + warn (绝不写到根目录)"""
    site = FakeSite()
    cat = FakeCat(slug="前端")  # 中文
    factory = RenderContextFactory(site=site, cats=[cat], contents=[])
    pr = PageRenderer(factory, layouts=[
        FakeLayout(scope="category", code="cat", html="<h1>x</h1>"),
    ])
    p = pr.category(cat)
    assert p.path == ""
    assert p.html == ""
    assert any("slug 不合法" in w for w in p.warnings)


def test_category_pinyin_slug_skipped():
    """拼音 slug (无连字符) 也拒绝 (项目要求英文)"""
    site = FakeSite()
    cat = FakeCat(slug="qianDuan")  # 拼音
    factory = RenderContextFactory(site=site, cats=[cat], contents=[])
    pr = PageRenderer(factory, layouts=[
        FakeLayout(scope="category", code="cat", html="<h1>x</h1>"),
    ])
    p = pr.category(cat)
    assert p.path == ""
    assert any("slug 不合法" in w for w in p.warnings)


def test_content_legal_slug_path():
    """合法 cat+content slug → 正常路径"""
    site = FakeSite()
    cat = FakeCat()
    ct = FakeContent()
    factory = RenderContextFactory(site=site, cats=[cat], contents=[ct])
    pr = PageRenderer(factory, layouts=[
        FakeLayout(scope="content", code="content", html="<h1>x</h1>"),
    ])
    p = pr.content(ct, cat=cat)
    assert p.path == "frontend/a.html"
    assert p.html == "<h1>x</h1>"


def test_content_invalid_cat_slug_skipped():
    """猫目 slug 不合法 → 跳过 (不写到 uncategorized)"""
    site = FakeSite()
    cat = FakeCat(slug="!@#")
    ct = FakeContent()
    factory = RenderContextFactory(site=site, cats=[cat], contents=[ct])
    pr = PageRenderer(factory, layouts=[
        FakeLayout(scope="content", code="content", html="<h1>x</h1>"),
    ])
    p = pr.content(ct, cat=cat)
    assert p.path == ""
    assert p.html == ""
    assert any("栏目 slug 不合法" in w for w in p.warnings)


def test_content_invalid_content_slug_skipped():
    """文章 slug 不合法 → 跳过"""
    site = FakeSite()
    cat = FakeCat()
    ct = FakeContent(slug="中文章")
    factory = RenderContextFactory(site=site, cats=[cat], contents=[ct])
    pr = PageRenderer(factory, layouts=[
        FakeLayout(scope="content", code="content", html="<h1>x</h1>"),
    ])
    p = pr.content(ct, cat=cat)
    assert p.path == ""
    assert any("文章" in w and "slug 不合法" in w for w in p.warnings)
