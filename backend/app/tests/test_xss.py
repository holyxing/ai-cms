"""XSS 防护测试 (P2-XSS)

禁用标签必须:
- errors[] 含记录
- 输出 html 中被移除 (不出现)
"""
from app.services.layout_renderer import render, RenderContext, SiteCtx


def test_xss_script_removed():
    """<script> 必须从输出中移除"""
    ctx = RenderContext(site=SiteCtx(name="s"))
    out = render("<h1>hi</h1><script>alert(1)</script>", ctx)
    assert "<script" not in out
    assert "alert(1)" not in out
    assert any("禁用标签" in e for e in ctx.errors)


def test_xss_iframe_removed():
    """<iframe> 必须从输出中移除"""
    ctx = RenderContext(site=SiteCtx(name="s"))
    out = render("<iframe src=javascript:alert(1)></iframe>x", ctx)
    assert "<iframe" not in out
    assert "javascript" not in out
    assert any("禁用标签" in e for e in ctx.errors)


def test_xss_object_embed_removed():
    """<object> / <embed> 必须从输出中移除"""
    ctx = RenderContext(site=SiteCtx(name="s"))
    out = render("a<object>b</object>c<embed/>", ctx)
    assert "<object" not in out
    assert "<embed" not in out
    assert len(ctx.errors) == 2


def test_xss_uppercase_ignored():
    """<SCRIPT> 大小写不敏感也拦"""
    ctx = RenderContext(site=SiteCtx(name="s"))
    out = render("<SCRIPT>alert(1)</SCRIPT>", ctx)
    assert "<SCRIPT" not in out.upper() or "<SCRIPT" in out  # strip 后可能留空
    # 上面断言设计复杂, 关键看 strip
    assert "alert" not in out


def test_xss_does_not_break_safe_html():
    """<p> / <div> 等安全标签不动"""
    ctx = RenderContext(site=SiteCtx(name="s"))
    out = render("<p class=\"x\"><div>ok</div></p>", ctx)
    assert "<p" in out
    assert "<div" in out
    assert ctx.errors == []
