"""P3.6.5+: HY_SITE_CSS / HY_SITE_JS 一键全目录标签

验证:
- F1: HY_SITE_CSS 输出 <link rel="stylesheet" href="..."> 每行一个
- F2: HY_SITE_JS 输出 <script src="..."></script>
- F3: _include 白名单
- F4: _exclude 黑名单
- F5: assets_by_category 为空 → 输出空字符串
- F6: name 按字典序排序 (稳定)
- F7: HY_SITE_CSS 输出走 _SAFE_TAGS 不 escape
- F8: 发布 422 检查扫到 HY_SITE_CSS _include 的具体名字
"""
from app.services.layout_renderer import RenderContext, resolve_self_closing
from app.services.publish_precheck import extract_references


def _ctx():
    return RenderContext(assets_by_category={
        "css": [
            {"name": "responsive.css", "url": "/sites/demo/assets/responsive.css", "content_type": "text/css"},
            {"name": "site.css", "url": "/sites/demo/assets/site.css", "content_type": "text/css"},
            {"name": "style.css", "url": "/sites/demo/assets/style.css", "content_type": "text/css"},
        ],
        "js": [
            {"name": "analytics.js", "url": "/sites/demo/assets/analytics.js", "content_type": "application/javascript"},
            {"name": "main.js", "url": "/sites/demo/assets/main.js", "content_type": "application/javascript"},
        ],
    })


def test_F1_hy_site_css_outputs_all_link_tags():
    """F1: HY_SITE_CSS 列出 css/ 全部, 3 行 link"""
    out = resolve_self_closing("<HY_SITE_CSS />", _ctx())
    assert out.count('<link rel="stylesheet"') == 3
    assert 'responsive.css' in out
    assert 'site.css' in out
    assert 'style.css' in out


def test_F2_hy_site_js_outputs_all_script_tags():
    """F2: HY_SITE_JS 列出 js/ 全部"""
    out = resolve_self_closing("<HY_SITE_JS />", _ctx())
    assert out.count('<script src=') == 2
    assert 'analytics.js' in out
    assert 'main.js' in out


def test_F3_include_whitelist():
    """F3: _include 白名单只输出指定"""
    out = resolve_self_closing('<HY_SITE_CSS _include="site.css" />', _ctx())
    assert 'site.css' in out
    assert 'responsive.css' not in out
    assert 'style.css' not in out


def test_F4_exclude_blacklist():
    """F4: _exclude 黑名单排除指定"""
    out = resolve_self_closing('<HY_SITE_JS _exclude="analytics.js" />', _ctx())
    assert 'main.js' in out
    assert 'analytics.js' not in out


def test_F5_empty_assets_yields_empty():
    """F5: 目录空 → 输出空字符串"""
    ctx = RenderContext(assets_by_category={"css": [], "js": [], "assets": []})
    assert resolve_self_closing("<HY_SITE_CSS />", ctx) == ""
    assert resolve_self_closing("<HY_SITE_JS />", ctx) == ""


def test_F6_sorted_by_name():
    """F6: name 按字典序排序 (保证 build 稳定)"""
    out = resolve_self_closing("<HY_SITE_CSS />", _ctx())
    pos_responsive = out.find('responsive.css')
    pos_site = out.find('site.css')
    pos_style = out.find('style.css')
    assert pos_responsive < pos_site < pos_style


def test_F7_output_not_html_escaped():
    """F7: 输出是真 HTML 标签, 不是 &lt;link&gt;"""
    out = resolve_self_closing("<HY_SITE_CSS />", _ctx())
    assert '<link rel="stylesheet"' in out
    assert '&lt;link' not in out
    assert '&amp;lt;' not in out


def test_F8_precheck_scans_include_exclude():
    """F8: 发布前 precheck 扫到 _include/_exclude 里的具体名字, 缺了就报"""
    refs = extract_references(
        '<HY_SITE_CSS _include="present.css" />'
        '<HY_SITE_JS _exclude="missing.js" />'
    )
    # extract_references 返 list[tuple[name, source]]
    by_name = {name: source for name, source in refs}
    assert "present.css" in by_name
    assert "missing.js" in by_name
    assert by_name["present.css"] == "hy"
    assert by_name["missing.js"] == "hy"
