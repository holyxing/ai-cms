"""网站 ZIP 导入：纯函数单测（不解 DB）"""
import io
import zipfile

import pytest

from dataclasses import dataclass
from app.models.site_asset import public_relpath
from app.services.site_zip_import import (
    build_site_layout,
    category_group_from_path,
    classify_html_path,
    ensure_one_main,
    extract_zip,
    layout_display_name,
    group_htmls_by_category,
    layout_code_from_path,
    layout_stem_code,
    linked_asset_names,
    rewrite_css_urls,
    sanitize_asset_name,
    templatize_category,
    templatize_content,
    templatize_home,
)


def _zip_bytes(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_sanitize_asset_name_unique_and_safe():
    used: set[str] = set()
    a = sanitize_asset_name("css/style.css", used)
    b = sanitize_asset_name("js/style.css", used)
    assert a == "style.css"
    assert b.startswith("js-style") or b.startswith("style-")
    assert a != b
    c = sanitize_asset_name("图片.png", used)
    assert c.startswith("file") or c.endswith(".png")
    assert sanitize_asset_name("ok_logo-1.webp", set()) == "ok_logo-1.webp"


def test_classify_html_path_rules():
    home_html = "<html><body><h1>首页</h1></body></html>"
    assert classify_html_path("index.html", home_html) == "home"
    list_html = "<html><body>" + "".join(
        f'<article><h2>n{i}</h2></article>' for i in range(4)
    ) + "</body></html>"
    assert classify_html_path("news/index.html", list_html) == "category"
    words = " ".join(["正文"] * 90)
    article = f"<html><body><h1>标题</h1><p>{words}</p></body></html>"
    assert classify_html_path("news/hello.html", article) == "content"
    stub = "<html><body><div data-published-shell></div></body></html>"
    assert classify_html_path("about-company.html", stub) == "content"
    assert classify_html_path("pages/news-bid.html", stub) == "content"


def test_layout_display_name_includes_group_and_fallback():
    assert layout_display_name("default", "category") == "通用栏目列表（default · 站点兑底）"
    assert layout_display_name("default", "content") == "通用文章详情（default · 站点兑底）"
    assert layout_display_name("news", "category") == "新闻资讯 · 栏目列表"
    assert layout_display_name("product", "content") == "产品中心 · 文章详情"


def test_category_group_from_path_uses_folder_or_prefix():
    assert category_group_from_path("news/index.html") == "news"
    assert category_group_from_path("news/bid-award.html") == "news"
    assert category_group_from_path("about-company.html") == "about"
    assert category_group_from_path("product-haishi.html") == "product"
    assert category_group_from_path("index.html") == "default"


def test_group_htmls_by_category_one_list_one_detail():
    from dataclasses import dataclass

    @dataclass
    class H:
        rel_path: str
        scope: str
        html: str = ""

    htmls = [
        H("news/index.html", "category"),
        H("news/a.html", "content"),
        H("news/b.html", "content"),
        H("about-company.html", "content"),
    ]
    g = group_htmls_by_category(htmls)  # type: ignore[arg-type]
    assert set(g.keys()) == {"news", "about"}
    assert set(g["news"].keys()) == {"category", "content"}
    assert g["news"]["content"].rel_path == "news/a.html"
    assert g["about"]["content"].rel_path == "about-company.html"


def test_layout_code_from_path_uses_filename():
    used: set[str] = set()
    assert layout_code_from_path("pages/about-company.html", used) == "about-company"
    assert layout_code_from_path("about-company.html", used) == "about-company-2"
    assert layout_code_from_path("index.html", set()) == "default"


def test_layout_stem_code_skips_folder_index():
    assert layout_stem_code("index.html") == "default"
    assert layout_stem_code("news/index.html") == "default"
    assert layout_stem_code("pages/about-company.html") == "about-company"
    assert layout_stem_code("product-haishi.html") == "product-haishi"


def test_extract_zip_strips_root_and_classifies():
    html_index = b"<!DOCTYPE html><html><head><title>Home</title></head><body><header>H</header><h1>Hi</h1></body></html>"
    html_list = (
        b"<!DOCTYPE html><html><body><header>H</header>"
        + b"".join(b"<article><h2>n</h2></article>" for _ in range(4))
        + b"</body></html>"
    )
    data = _zip_bytes({
        "mysite/index.html": html_index,
        "mysite/news/index.html": html_list,
        "mysite/css/app.css": b"body{background:url(../img/logo.png)}",
        "mysite/js/app.js": b"console.log(1)",
        "mysite/img/logo.png": b"\x89PNG\r\n",
        "mysite/readme.txt": b"skip me",
    })
    htmls, assets, warnings = extract_zip(data)
    paths = {h.rel_path: h.scope for h in htmls}
    assert "index.html" in paths
    assert paths["index.html"] == "home"
    assert paths["news/index.html"] == "category"
    cats = {a.category for a in assets}
    assert cats == {"css", "js", "assets"}
    by_rel = {a.rel_path: a for a in assets}
    assert "css/app.css" in by_rel
    assert "img/logo.png" in by_rel
    assert by_rel["css/app.css"].name == "app.css"
    assert any("readme" in w for w in warnings)


def test_rewrite_css_urls_keeps_zip_relative_path():
    css = '.x{background-image:url("../assets/images/foo.webp")}'
    out = rewrite_css_urls(
        css,
        {"assets/images/foo.webp": "foo.webp"},
        "css",
    )
    assert 'url("../assets/images/foo.webp")' in out


def test_rewrite_css_urls_prefers_v3_over_pexels():
    css = (
        '.hero-slide:nth-child(1){background-color:#07192b;'
        'background-image:url("../assets/images/banners/home-products-pexels.webp");'
        'background-position:58% center;}'
    )
    out = rewrite_css_urls(
        css,
        {
            "assets/images/banners/home-products-pexels.webp": "home-products-pexels.webp",
            "assets/images/banner-hero-products-v3.webp": "banner-hero-products-v3.webp",
        },
        "css",
    )
    assert "banner-hero-products-v3.webp" in out
    assert "home-products-pexels.webp" not in out
    assert "background-position" not in out


def test_linked_asset_names_from_home_html():
    html = (
        '<link rel="stylesheet" href="css/main.css?v=1">'
        '<script src="js/main.js" defer></script>'
    )
    rel = {"css/main.css": "main.css", "js/main.js": "main.js", "css/secondary.css": "secondary.css"}
    assert linked_asset_names(html, "", rel, "css") == ["main.css"]
    assert linked_asset_names(html, "", rel, "js") == ["main.js"]


def test_public_relpath_prefers_zip_path():
    @dataclass
    class A:
        name: str = "hero.webp"
        original_filename: str = "assets/images/banners/hero.webp"
        file_path: str = ""
        site_id: str = ""

    assert public_relpath(A()) == "assets/images/banners/hero.webp"
    assert public_relpath(A(original_filename="hero.webp")) == "assets/hero.webp"


def test_extract_zip_rejects_path_traversal():
    data = _zip_bytes({"../etc/passwd": b"x"})
    with pytest.raises(ValueError, match="非法路径"):
        extract_zip(data)


def test_extract_zip_rejects_non_zip():
    with pytest.raises(ValueError, match="不是有效的 ZIP"):
        extract_zip(b"not-a-zip")


def test_build_site_layout_has_five_scope_hooks():
    html = build_site_layout(["site.css"], ["app.js"])
    assert '<HY_SITE_CSS _include="site.css" />' in html
    assert '<HY_SITE_JS _include="app.js" />' in html
    assert '<HY_TEMPLATE code="header" />' in html
    assert '<HY_TEMPLATE code="footer" />' in html
    assert "__LAYOUT_CONTENT__" in html
    assert "<main>__LAYOUT_CONTENT__</main>" not in html


def test_ensure_one_main_does_not_double_wrap():
    already = '<main id="main"><section class="hero"></section></main>'
    assert ensure_one_main(already) == already
    wrapped = ensure_one_main("<section>list</section>")
    assert wrapped.startswith("<main>")
    assert wrapped.count("<main") == 1


def test_templatize_category_wraps_articles():
    inner = "".join(f"<article><h2>t{i}</h2><p>s</p></article>" for i in range(3))
    out = templatize_category(inner)
    assert "<HY_CONTENTS" in out
    assert "<HY_ITEM_TITLE" in out
    assert "<HY_CONTENTS_PAGINATION" in out


def test_templatize_home_keeps_hero_slides():
    inner = """
<section class="hero" id="top">
  <div class="hero-track">
    <article class="hero-slide is-active" data-hero-slide>A</article>
    <article class="hero-slide" data-hero-slide>B</article>
  </div>
</section>
<section class="news">
  <article><h2>n1</h2></article>
  <article><h2>n2</h2></article>
  <article><h2>n3</h2></article>
</section>
"""
    out = templatize_home(inner)
    assert 'data-hero-slide' in out
    assert "A</article>" in out
    assert "<h2>n1</h2>" in out
    assert "<h2>n3</h2>" in out
    assert "<HY_SITE_HERO" not in out
    assert "<HY_CONTENTS" not in out

