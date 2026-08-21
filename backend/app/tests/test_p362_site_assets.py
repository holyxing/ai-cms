"""P3.6.2 单测 - site_assets 资源管理 (10 cases)

范围:
A. HY_ASSET_URL 标签 (3): 基础 + 缺资源 + 属性内嵌
B. RenderContextFactory.asset_urls (2): 注入 + 透传
C. asset_urls 透传到 build_site (2): 替换 + 不替换
D. Worker _run_layout_build 复制 site_assets (3): 复制 2 个 + 缺文件跳过 + 0 个
"""
import os
import shutil
import tempfile
from dataclasses import dataclass, field
import pytest

from app.services.layout_renderer import (
    RenderContext, render, SiteCtx, CategoryCtx, ContentCtx,
)
from app.services.render_context_factory import (
    RenderContextFactory, site_to_ctx,
)
from app.services.page_renderer import build_site, PageRenderer


# ===========================================================================
# Fixtures
# ===========================================================================

@dataclass
class Site:
    id: str = "s1"
    slug: str = "demo"
    name: str = "演示"
    slogan: str = ""
    description: str = ""
    url: str = ""
    settings: dict = field(default_factory=dict)


@dataclass
class Cat:
    id: str = "c1"
    name: str = "栏目"
    slug: str = "cat"
    parent_id: str = ""
    content_count: int = 0


@dataclass
class Cont:
    id: str = "ct1"
    title: str = "文章"
    slug: str = "art"
    body: str = ""
    category_id: str = "c1"
    status: str = "published"
    deleted_at: object = None
    is_deleted: bool = False
    published_at: object = None


@dataclass
class Layout:
    scope: str = "home"
    code: str = "default"
    html: str = ""
    is_default: bool = True
    deleted_at: object = None


# ===========================================================================
# A. HY_ASSET_URL 标签
# ===========================================================================

def _ctx_with_assets(asset_urls: dict) -> RenderContext:
    return RenderContext(
        site=SiteCtx(name="test", base_url="https://demo.com"),
        asset_urls=asset_urls,
    )


def test_A1_basic_self_closing():
    """<HY_ASSET_URL _name="site.css" /> (在 body 顶部) → 完整 URL"""
    ctx = _ctx_with_assets({"site.css": "https://demo.com/sites/demo/assets/site.css"})
    out = render('before <HY_ASSET_URL _name="site.css" /> after', ctx)
    assert 'https://demo.com/sites/demo/assets/site.css' in out
    assert 'HY_ASSET_URL' not in out
    assert ctx.warnings == []


def test_A2_asset_missing_returns_empty():
    """未上传的资源 → 空字符串"""
    ctx = _ctx_with_assets({})  # 空
    out = render('a<HY_ASSET_URL _name="missing.css" />b', ctx)
    assert 'HY_ASSET_URL' not in out
    # 资源不存在时返空, 不会加 warn (兌底)


def test_A3_name_alias():
    """兼容 _name 和 name 两种属性 (跟 HY_INCLUDE 一致)"""
    ctx = _ctx_with_assets({"a.js": "https://x.com/a.js"})
    out = render('x<HY_ASSET_URL name="a.js" />y', ctx)
    assert 'https://x.com/a.js' in out


def test_A4_in_link_tag_via_resolve_self_closing():
    """模板常见写法: <link rel="stylesheet" href="<HY_ASSET_URL _name='site.css'>">

    resolve_self_closing 先跑, 把内部 HY_ 标签替成 URL,
    结果是 <link rel="stylesheet" href="https://...">
    """
    ctx = _ctx_with_assets({"site.css": "https://x.com/site.css"})
    out = render(
        '<link rel="stylesheet" href="<HY_ASSET_URL _name=\'site.css\'>">',
        ctx,
    )
    assert 'href="https://x.com/site.css"' in out
    assert 'HY_ASSET_URL' not in out


# ===========================================================================
# B. RenderContextFactory.asset_urls
# ===========================================================================

def test_B1_factory_includes_asset_urls_in_base():
    """factory._base() 把 asset_urls 装进 RenderContext"""
    site = Site(id="s1", slug="demo", name="D")
    f = RenderContextFactory(site=site, cats=[], contents=[])
    f.asset_urls = {"site.css": "https://x.com/site.css"}
    ctx = f.for_home()
    assert ctx.asset_urls == {"site.css": "https://x.com/site.css"}


def test_B2_factory_default_empty_dict():
    """未调 load_assets 时, asset_urls 默认空 dict, HY_ASSET_URL 返空"""
    site = Site(id="s1", slug="demo", name="D")
    f = RenderContextFactory(site=site, cats=[], contents=[])
    ctx = f.for_home()
    assert ctx.asset_urls == {}
    out = render('<x src="<HY_ASSET_URL _name=\"x.css\" />">', ctx)
    assert 'src=""' in out


# ===========================================================================
# C. asset_urls 透传到 build_site
# ===========================================================================

def test_C1_build_site_uses_asset_urls():
    """build_site(asset_urls=...) 后, HY_ASSET_URL 渲染为正确 URL"""
    site = Site(id="s1", slug="demo", name="D")
    layout = Layout(scope="home", html='<link href="<HY_ASSET_URL _name=\"site.css\" />"><h1>HY_SITE_NAME</h1>')
    pages = build_site(
        site=site, cats=[], contents=[], layouts=[layout],
        base_url="https://demo.com",
        asset_urls={"site.css": "https://demo.com/sites/demo/assets/site.css"},
    )
    home = [p for p in pages if p.path == "index.html"][0]
    assert 'href="https://demo.com/sites/demo/assets/site.css"' in home.html
    assert "HY_SITE_NAME" not in home.html  # 已被替换


def test_C2_build_site_no_asset_urls_yields_empty_href():
    """build_site 不传 asset_urls 时, HY_ASSET_URL 返空"""
    site = Site(id="s1", slug="demo", name="D")
    layout = Layout(scope="home", html='<link href="<HY_ASSET_URL _name=\"site.css\" />">')
    pages = build_site(
        site=site, cats=[], contents=[], layouts=[layout],
    )
    home = [p for p in pages if p.path == "index.html"][0]
    assert 'href=""' in home.html


# ===========================================================================
# D. Worker 复制 site_assets 到 public/assets/
# ===========================================================================

@pytest.mark.asyncio
def test_D2_copy_logic_unit(tmp_path):
    """直接验证 shutil.copy2 调用 (抽出来方便单测)"""
    # 抽出来的函数: _copy_assets_to_public(assets, target_dir)
    from app.workers.publish import _copy_assets_to_public

    src_dir = tmp_path / "src"
    src_dir.mkdir()
    a1 = src_dir / "site.css"
    a1.write_text("x")
    a2 = src_dir / "main.js"
    a2.write_text("y")

    @dataclass
    class FakeAsset:
        name: str
        file_path: str

    target = tmp_path / "public"
    target.mkdir()
    copied = _copy_assets_to_public(
        [FakeAsset(name="site.css", file_path=str(a1)),
         FakeAsset(name="main.js", file_path=str(a2))],
        str(target),
    )
    assert copied == 2
    assert (target / "assets" / "site.css").exists()
    assert (target / "assets" / "main.js").exists()
    assert (target / "assets" / "site.css").read_text() == "x"


def test_D3_copy_skips_missing_file(tmp_path):
    """文件不存在的资源, 静默跳过 (不报错)"""
    from app.workers.publish import _copy_assets_to_public

    @dataclass
    class FakeAsset:
        name: str
        file_path: str

    target = tmp_path / "public"
    target.mkdir()
    copied = _copy_assets_to_public(
        [FakeAsset(name="missing.css", file_path="/nonexistent/x.css")],
        str(target),
    )
    assert copied == 0
    # 目录可能创建了但空 (或未创建), 只要里面没文件
    assets_dir = target / "assets"
    if assets_dir.exists():
        assert list(assets_dir.iterdir()) == []


def test_D4_empty_assets_returns_zero(tmp_path):
    """空资源列表, 不创建目录, 返回 0"""
    from app.workers.publish import _copy_assets_to_public

    target = tmp_path / "public"
    target.mkdir()
    copied = _copy_assets_to_public([], str(target))
    assert copied == 0
    assert not (target / "assets").exists()


def test_D5_copy_preserves_zip_relpath(tmp_path):
    """ZIP 原路径 css/main.css 发布到 public/css/main.css，不拍平到 assets/"""
    from app.workers.publish import _copy_assets_to_public

    src = tmp_path / "src" / "css"
    src.mkdir(parents=True)
    f = src / "main.css"
    f.write_text("body{}")

    @dataclass
    class FakeAsset:
        name: str
        file_path: str
        original_filename: str = ""
        site_id: str = ""

    target = tmp_path / "public"
    target.mkdir()
    copied = _copy_assets_to_public(
        [FakeAsset(
            name="main.css",
            file_path=str(f),
            original_filename="css/main.css",
        )],
        str(target),
    )
    assert copied == 1
    assert (target / "css" / "main.css").read_text() == "body{}"
    assert not (target / "assets" / "main.css").exists()
