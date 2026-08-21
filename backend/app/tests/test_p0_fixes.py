"""P0 bug 修复回归测试 - 10 cases

P0-1: site_to_ctx 读 settings JSONB
P0-3: 属性值内嵌标签解析
P0-4: abs_url filter 真实现
P0-5: IF 条件升级 (contents.count > 0)
P0-6: _safe_path 漏 ~ 和 \\0
P0-7: 未知标签文本中对称 warn
P0-9: build_site 加 status 过滤兜底
"""
import pytest

from app.services.layout_renderer import (
    render, apply_filters, parse_filter_chain, _eval_condition,
    ContentCtx, RenderContext, SiteCtx, CategoryCtx,
)
from app.services.render_context_factory import (
    site_to_ctx, content_to_ctx, category_to_ctx,
)
from app.services.disk_writer import _safe_path
from app.services.page_renderer import build_site, PageFile


# ===========================================================================
# P0-1: site_to_ctx 读 settings JSONB (2 cases)
# ===========================================================================

def test_P0_1_settings_slogan():
    """Site.settings.slogan → SiteCtx.slogan"""
    class Site:
        id = "s1"
        name = "测试站"
        url = "https://x.com"
        settings = {"slogan": "副标", "keywords": "k1,k2", "icp": "京ICP-123"}

    ctx = site_to_ctx(Site())
    assert ctx.slogan == "副标"
    assert ctx.keywords == "k1,k2"
    assert ctx.icp == "京ICP-123"


def test_P0_1_settings_overrides_empty_field():
    """显式字段为空时, settings 补上"""
    class Site:
        id = "s1"
        name = "x"
        slogan = ""  # 空, 应该读 settings
        url = "https://x.com"
        settings = {"slogan": "settings 的副标"}

    ctx = site_to_ctx(Site())
    assert ctx.slogan == "settings 的副标"


# ===========================================================================
# P0-3: 属性值内嵌标签 (3 cases)
# ===========================================================================

def test_P0_3_a_href_with_hy_content_url():
    """<a href="<HY_CONTENT_URL/>"> 解析"""
    ctx = RenderContext(
        site=SiteCtx(name="s"),
        content=ContentCtx(url="/tech/1", title="t"),
    )
    out = render('<a href="<HY_CONTENT_URL/>">x</a>', ctx)
    assert 'href="/tech/1"' in out


def test_P0_3_img_src_with_hy_site_logo():
    """<img src="<HY_SITE_LOGO/>" /> 解析"""
    ctx = RenderContext(
        site=SiteCtx(name="s", logo_url="/logo.png"),
    )
    out = render('<img src="<HY_SITE_LOGO/>" alt="logo" />', ctx)
    assert 'src="/logo.png"' in out
    assert 'alt="logo"' in out


def test_P0_3_meta_content_with_hy_value():
    """<meta content="<HY_SITE_NAME/>" /> 解析"""
    ctx = RenderContext(site=SiteCtx(name="测试站"))
    out = render('<meta name="og:site_name" content="<HY_SITE_NAME/>" />', ctx)
    assert 'content="测试站"' in out


# ===========================================================================
# P0-4: abs_url filter (3 cases)
# ===========================================================================

def test_P0_4_abs_url_relative():
    """/cover.jpg → https://x.com/cover.jpg"""
    ctx = RenderContext(site=SiteCtx(name="s", base_url="https://x.com"))
    out = apply_filters("/cover.jpg", parse_filter_chain("abs_url"), ctx=ctx)
    assert out == "https://x.com/cover.jpg"


def test_P0_4_abs_url_already_absolute():
    """已是绝对 URL, 不变"""
    ctx = RenderContext(site=SiteCtx(name="s", base_url="https://x.com"))
    out = apply_filters("https://cdn.com/x.jpg", parse_filter_chain("abs_url"), ctx=ctx)
    assert out == "https://cdn.com/x.jpg"


def test_P0_4_abs_url_no_ctx():
    """无 ctx, 不变 (向后兼容)"""
    out = apply_filters("/cover.jpg", parse_filter_chain("abs_url"))
    assert out == "/cover.jpg"


# ===========================================================================
# P0-5: IF 条件升级 (3 cases)
# ===========================================================================

def test_P0_5_count_gt_zero_empty():
    """空 contents: count > 0 = False"""
    ctx = RenderContext(site=SiteCtx(name="s"), contents_data=[])
    assert _eval_condition("contents.count > 0", ctx) is False


def test_P0_5_count_eq_zero_empty():
    """空 contents: count == 0 = True"""
    ctx = RenderContext(site=SiteCtx(name="s"), contents_data=[])
    assert _eval_condition("contents.count == 0", ctx) is True


def test_P0_5_count_gt_zero_nonempty():
    """非空 contents: count > 0 = True"""
    ctx = RenderContext(
        site=SiteCtx(name="s"),
        contents_data=[ContentCtx(), ContentCtx(), ContentCtx()],
    )
    assert _eval_condition("contents.count > 0", ctx) is True


# ===========================================================================
# P0-6: _safe_path (4 cases)
# ===========================================================================

def test_P0_6_tilde_blocked():
    """~/etc/passwd 拒绝"""
    with pytest.raises(ValueError, match="unsafe path"):
        _safe_path("~/etc/passwd")


def test_P0_6_nul_byte_blocked():
    """NUL 字节 拒绝"""
    with pytest.raises(ValueError, match="unsafe path"):
        _safe_path("foo\x00.html")


def test_P0_6_percent00_blocked():
    """%00 截断 拒绝"""
    with pytest.raises(ValueError, match="unsafe path"):
        _safe_path("foo%00.html")


def test_P0_6_normal_path_ok():
    """正常路径 通过"""
    assert _safe_path("tech/index.html") == "tech/index.html"


# ===========================================================================
# P0-7: 文本中未知标签 warn
# ===========================================================================

def test_P0_7_text_unknown_tag_warns():
    """HY_FAKE 文本 → ctx.warnings 加一条"""
    ctx = RenderContext(site=SiteCtx(name="s"))
    render("hello HY_FAKE_FAKE world", ctx)
    assert any("未知 HY_ 标签" in w and "HY_FAKE_FAKE" in w for w in ctx.warnings)


# ===========================================================================
# P0-9: build_site status 过滤
# ===========================================================================

def test_P0_9_filters_unpublished():
    """默认 build_site 过滤 status != published"""
    from dataclasses import dataclass, field
    from datetime import datetime, timezone

    @dataclass
    class Site:
        id: str = "s1"
        slug: str = "test"
        name: str = "x"
        url: str = "https://x.com"

    @dataclass
    class Cat:
        id: str = "c1"
        name: str = "c"
        slug: str = "tech"
        parent_id: str = ""

    @dataclass
    class Cont:
        id: str = "ct1"
        title: str = "A"
        slug: str = "a"
        status: str = "draft"  # 未发布
        deleted_at: object = None
        category_id: str = "c1"

    layouts = [dict(id="l1", scope="home", code="home", html="<h1>x</h1>",
                    is_default=True, deleted_at=None)]

    # 默认: draft 不被渲染
    pages = build_site(Site(), cats=[Cat()], contents=[Cont()], layouts=layouts)
    paths = [p.path for p in pages]
    assert "tech/a.html" not in paths  # draft 被过滤

    # include_unpublished=True: draft 也在
    pages2 = build_site(Site(), cats=[Cat()], contents=[Cont()], layouts=layouts,
                       include_unpublished=True)
    paths2 = [p.path for p in pages2]
    assert "tech/a.html" in paths2


# ===========================================================================
# 综合: 属性内嵌 + filter + IF 一起
# ===========================================================================

def test_combo_attr_embed_with_filter():
    """<a href="<HY_CONTENT_URL _filter=\"abs_url\"/>"> 综合 (双引号属性值)"""
    ctx = RenderContext(
        site=SiteCtx(name="s", base_url="https://x.com"),
        content=ContentCtx(url="/tech/1", title="t"),
    )
    out = render('<a href="<HY_CONTENT_URL _filter=\"abs_url\"/>">x</a>', ctx)
    assert 'href="https://x.com/tech/1"' in out
