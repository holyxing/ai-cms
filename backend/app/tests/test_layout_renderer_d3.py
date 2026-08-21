"""LayoutRenderer D3 单测 - 20 cases

D3 范围:
A. HY_CONTENTS 循环 (5)
B. HY_CATS 循环 (4)
C. filter 链 (8)
D. 边界/安全 (3)
"""
from datetime import datetime
import pytest

from app.services.layout_renderer import (
    SiteCtx, CategoryCtx, ContentCtx, RenderContext,
    render, parse_filter_chain, apply_filters,
    _CatItemCtx,
)


def make_item(
    id="c1", title="标题1", url="/p/1", summary="摘要1",
    cover_url="/cover1.jpg", banner_url="", author="holy",
    published_at="2026-06-01T10:00:00Z", hits=100,
    cat_slug="tech", cat_id="cat-tech", cat_name="科技", cat_url="/tech",
    tags_html='<a>#标签1</a>',
    is_featured=False,
):
    """默认创建一条内容"""
    return ContentCtx(
        id=id, title=title, url=url, summary=summary,
        cover_url=cover_url, banner_url=banner_url, author=author,
        published_at=published_at, hits=hits,
        datetime=published_at, cat_slug=cat_slug, cat_id=cat_id,
        cat_name=cat_name, cat_url=cat_url, tags_html=tags_html,
        is_featured=is_featured,
    )


def make_ctx(contents=None, cats=None, **kwargs) -> RenderContext:
    site = kwargs.pop("site", SiteCtx(
        name="测试站", slogan="副", url="https://test.com",
        base_url="https://test.com",
    ))
    base_url = kwargs.pop("base_url", "https://test.com")
    return RenderContext(
        site=site,
        category=kwargs.pop("category", None),
        content=kwargs.pop("content", None),
        contents_data=contents or [],
        cats_data=cats or [],
        base_url=base_url,
        build_id=kwargs.pop("build_id", "v0.3-001"),
        now=kwargs.pop("now", "2026-06-06T10:00:00Z"),
        theme_version=3,
    )


# ===========================================================================
# A. HY_CONTENTS 循环 (5)
# ===========================================================================

def test_A1_loop_basic():
    """3 条内容 → 渲染 3 次"""
    contents = [
        make_item(id=f"c{i}", title=f"标题{i}", url=f"/p/{i}")
        for i in range(1, 4)
    ]
    ctx = make_ctx(contents=contents)
    out = render(
        '<HY_CONTENTS _limit="10">'
        '<li><a href="HY_ITEM_URL">HY_ITEM_TITLE</a></li>'
        '</HY_CONTENTS>',
        ctx,
    )
    assert out.count("<li>") == 3
    assert "标题1" in out
    assert "标题2" in out
    assert "标题3" in out


def test_A2_loop_with_order_newest():
    """_order=newest: 倒序（按 published_at 降序）"""
    contents = [
        make_item(id="c1", title="旧文", published_at="2026-01-01T00:00:00Z"),
        make_item(id="c2", title="新文", published_at="2026-06-01T00:00:00Z"),
        make_item(id="c3", title="中文", published_at="2026-03-01T00:00:00Z"),
    ]
    ctx = make_ctx(contents=contents)
    out = render(
        '<HY_CONTENTS _order="newest" _limit="10">'
        '|HY_ITEM_TITLE|'
        '</HY_CONTENTS>',
        ctx,
    )
    # 顺序: 新文(6) > 中文(3) > 旧文(1)
    assert out == "|新文||中文||旧文|"


def test_A3_loop_with_limit():
    """_limit=2: 只取 2 条"""
    contents = [
        make_item(id=f"c{i}", title=f"t{i}", published_at=f"2026-06-0{i}T00:00:00Z")
        for i in range(1, 6)
    ]
    ctx = make_ctx(contents=contents)
    out = render(
        '<HY_CONTENTS _limit="2" _order="newest">'
        'HY_ITEM_TITLE,'
        '</HY_CONTENTS>',
        ctx,
    )
    # newest 倒序: t5,t4
    assert "t5" in out and "t4" in out
    assert "t1" not in out
    assert "t3" not in out
    # 2 个 t
    assert out.count(",") == 2  # t5,t4,


def test_A4_loop_with_cat_filter():
    """_cat=tech: 只取 tech 栏目"""
    contents = [
        make_item(id="c1", title="tech1", cat_slug="tech"),
        make_item(id="c2", title="life1", cat_slug="life"),
        make_item(id="c3", title="tech2", cat_slug="tech"),
    ]
    ctx = make_ctx(contents=contents)
    out = render(
        '<HY_CONTENTS _cat="tech" _limit="10">'
        '<p>HY_ITEM_TITLE</p>'
        '</HY_CONTENTS>',
        ctx,
    )
    assert "tech1" in out
    assert "tech2" in out
    assert "life1" not in out


def test_A5_loop_with_item_meta():
    """HY_ITEM_META _type=author 读 author 字段"""
    contents = [
        make_item(id="c1", title="x", author="holy"),
        make_item(id="c2", title="y", author="alice"),
    ]
    ctx = make_ctx(contents=contents)
    out = render(
        '<HY_CONTENTS _limit="10">'
        '<span><HY_ITEM_META _type="author" /></span>'
        '</HY_CONTENTS>',
        ctx,
    )
    assert "<span>holy</span>" in out
    assert "<span>alice</span>" in out


# ===========================================================================
# B. HY_CATS 循环 (4)
# ===========================================================================

def test_B1_cats_type_children():
    """_type=children: 取当前 category 的子栏目"""
    cats = [
        CategoryCtx(id="c1", name="科技", slug="tech", parent_id="root"),
        CategoryCtx(id="c2", name="生活", slug="life", parent_id="root"),
        CategoryCtx(id="c3", name="AI", slug="ai", parent_id="c1"),  # 科技子
        CategoryCtx(id="c4", name="旅行", slug="travel", parent_id="c2"),  # 生活子
    ]
    ctx = make_ctx(cats=cats, category=CategoryCtx(id="c1", name="科技"))
    out = render(
        '<HY_CATS _type="children" _limit="20">'
        '<a href="HY_CAT_ITEM_URL">HY_CAT_ITEM_NAME</a>'
        '</HY_CATS>',
        ctx,
    )
    # 应只取 parent_id == c1 的: AI
    assert "AI" in out
    assert "科技" not in out  # 当前栏目不是子
    assert "生活" not in out


def test_B2_cats_type_root():
    """_type=root: 取所有根栏目"""
    cats = [
        CategoryCtx(id="c1", name="科技", slug="tech", parent_id=""),  # 根
        CategoryCtx(id="c2", name="生活", slug="life", parent_id=""),  # 根
        CategoryCtx(id="c3", name="AI", slug="ai", parent_id="c1"),  # 非根
    ]
    ctx = make_ctx(cats=cats)
    out = render(
        '<HY_CATS _type="root" _limit="20">'
        'HY_CAT_ITEM_NAME|'
        '</HY_CATS>',
        ctx,
    )
    assert "科技|" in out
    assert "生活|" in out
    assert "AI|" not in out


def test_B3_cats_type_children_no_current():
    """_type=children 但无当前 category → 返回空"""
    cats = [CategoryCtx(id="c1", name="X", parent_id="")]
    ctx = make_ctx(cats=cats)  # category=None
    out = render(
        '<HY_CATS _type="children" _limit="20">'
        'HY_CAT_ITEM_NAME,'
        '</HY_CATS>',
        ctx,
    )
    assert out == ""


def test_B4_cats_with_limit():
    """_limit=2: 只取 2 个"""
    cats = [CategoryCtx(id=f"c{i}", name=f"cat{i}", parent_id="") for i in range(1, 6)]
    ctx = make_ctx(cats=cats)
    out = render(
        '<HY_CATS _type="root" _limit="2">'
        'HY_CAT_ITEM_NAME,'
        '</HY_CATS>',
        ctx,
    )
    # 取 2 个
    assert "cat1" in out
    assert "cat2" in out
    assert "cat3" not in out


# ===========================================================================
# C. filter 链 (8)
# ===========================================================================

def test_C1_filter_truncate():
    """truncate(10): 截 10 字符"""
    chain = parse_filter_chain("truncate(10)")
    assert apply_filters("Hello World This is Long", chain) == "Hello Worl..."


def test_C2_filter_date():
    """date('Y-m-d'): 格式化 ISO 日期"""
    chain = parse_filter_chain("date('Y-m-d')")
    result = apply_filters("2026-06-06T10:30:00Z", chain)
    assert result == "2026-06-06"


def test_C3_filter_default():
    """default('X'): 空值时用 X"""
    chain = parse_filter_chain("default('暂无')")
    assert apply_filters("", chain) == "暂无"
    assert apply_filters("有值", chain) == "有值"


def test_C4_filter_upper_lower():
    """upper/lower: 大小写"""
    assert apply_filters("hello", parse_filter_chain("upper")) == "HELLO"
    assert apply_filters("WORLD", parse_filter_chain("lower")) == "world"


def test_C5_filter_chain_two():
    """链式: truncate(5) | upper"""
    chain = parse_filter_chain("truncate(5) | upper")
    assert apply_filters("hello world", chain) == "HELLO..."


def test_C6_filter_strip_html():
    """strip_html: 去 HTML 标签"""
    chain = parse_filter_chain("strip_html")
    assert apply_filters("<p>Hello <b>World</b></p>", chain) == "Hello World"


def test_C7_filter_urlencode():
    """urlencode: URL 编码"""
    chain = parse_filter_chain("urlencode")
    assert apply_filters("hello world", chain) == "hello%20world"
    assert apply_filters("中文", chain) == "%E4%B8%AD%E6%96%87"


def test_C8_filter_in_template():
    """filter 实际在 layout 里用: <HY_ITEM_SUMMARY _filter="truncate(50)" />"""
    contents = [
        make_item(id="c1", title="x", summary="x" * 100),
    ]
    ctx = make_ctx(contents=contents)
    out = render(
        '<HY_CONTENTS _limit="1">'
        '<p><HY_ITEM_SUMMARY _filter="truncate(10)" /></p>'
        '</HY_CONTENTS>',
        ctx,
    )
    assert "<p>xxxxxxxxxx...</p>" in out


# ===========================================================================
# D. 边界/安全 (3)
# ===========================================================================

def test_D1_empty_list_no_output():
    """空列表 → 循环输出空"""
    ctx = make_ctx(contents=[])  # 空
    out = render(
        '<HY_CONTENTS _limit="10">'
        '<li>HY_ITEM_TITLE</li>'
        '</HY_CONTENTS>',
        ctx,
    )
    assert out == ""


def test_D2_loop_with_if_in_template():
    """循环内 IF: HY_IF item.has_cover (应工作)
    HY_ITEM_COVER 不写在 HTML 属性内（那是禁止的, 见 D2 P5）
    """
    contents = [
        make_item(id="c1", title="有图", cover_url="/c1.jpg"),
        make_item(id="c2", title="无图", cover_url=""),
    ]
    ctx = make_ctx(contents=contents)
    out = render(
        '<HY_CONTENTS _limit="10">'
        '<li>'
        'HY_ITEM_TITLE'
        '<HY_IF _condition="content.has_cover">'
        '<span class="cover">HY_ITEM_COVER</span>'
        '</HY_IF>'
        '</li>'
        '</HY_CONTENTS>',
        ctx,
    )
    # 第一条有图, 第二条无图
    assert "有图" in out
    assert "无图" in out
    # 应只出现 1 次 <span class="cover">
    assert out.count('<span class="cover">') == 1
    assert "/c1.jpg" in out


def test_D3_filter_unknown_skipped():
    """未知 filter 跳过, 不报错"""
    chain = parse_filter_chain("unknown_filter | upper")
    result = apply_filters("hello", chain)
    assert result == "HELLO"  # upper 仍执行


# ===========================================================================
# F. HY_ITEM_TAGS 渲染 (2026-06-08: tags_html 不再 escape)
# ===========================================================================

def test_F1_hy_item_tags_renders_pre_formatted_html():
    """HY_ITEM_TAGS 输出预渲染的 HTML (在 _SAFE_TAGS 白名单, 不 escape)"""
    item = make_item(tags_html='<a class="tag" href="/tag/ai.html">AI</a>')
    ctx = make_ctx(contents=[item], content=item)
    out = render('<div><HY_ITEM_TAGS/></div>', ctx)
    assert out == '<div><a class="tag" href="/tag/ai.html">AI</a></div>'


def test_F2_hy_item_tags_empty():
    """tags_html 为空时, 渲染空串 (避免空 <a> 标签)"""
    item = make_item(tags_html='')
    ctx = make_ctx(contents=[item], content=item)
    out = render('<div>[<HY_ITEM_TAGS/>]</div>', ctx)
    assert out == '<div>[]</div>'


def test_F3_hy_item_tags_multiple():
    """多个 tag 拼接正确"""
    tags = (
        '<a class="tag" href="/tag/ai.html">AI</a>'
        '<a class="tag" href="/tag/python.html">Python</a>'
    )
    item = make_item(tags_html=tags)
    ctx = make_ctx(contents=[item], content=item)
    out = render('<HY_ITEM_TAGS/>', ctx)
    assert out == tags


def test_F4_hy_item_has_tags_condition():
    """has_tags 派生属性 + HY_IF 配合"""
    from app.services.layout_renderer import _make_item_ctx
    item_with = _make_item_ctx(make_item(id="a", tags_html='<a>#AI</a>'))
    item_without = _make_item_ctx(make_item(id="b", tags_html=''))
    # 验证 _make_item_ctx 派生 has_tags
    assert item_with.has_tags is True
    assert item_without.has_tags is False


# ===========================================================================
# G. 分页 / 相关文章 / 别名 (2026-08-17)
# ===========================================================================

def test_G1_pagination_renders_links():
    """HY_CONTENTS_PAGINATION 在列表超限时输出分页链接"""
    contents = [
        make_item(id=f"c{i}", title=f"标题{i}", url=f"/news/{i}.html", cat_id="cat1", cat_slug="news")
        for i in range(1, 26)
    ]
    cat = CategoryCtx(id="cat1", name="新闻", slug="news", url="/news/")
    ctx = make_ctx(contents=contents, category=cat)
    ctx.current_page = 1
    out = render(
        '<HY_CONTENTS _limit="10">'
        '<article><a href="<HY_ITEM_URL />"><HY_ITEM_TITLE /></a></article>'
        '</HY_CONTENTS>'
        '<HY_CONTENTS_PAGINATION _show_numbers="true" />',
        ctx,
    )
    assert 'class="pagination"' in out
    assert 'page-2.html' in out
    assert 'aria-current="page"' in out


def test_G2_related_list_excludes_current():
    """HY_RELATED_LIST 输出同栏目其他文章"""
    current = make_item(id="c1", title="当前", cat_id="cat1", cat_slug="news")
    others = [
        make_item(id="c2", title="相关一", url="/news/a.html", cat_id="cat1", cat_slug="news"),
        make_item(id="c3", title="相关二", url="/news/b.html", cat_id="cat1", cat_slug="news"),
    ]
    ctx = make_ctx(contents=[current, *others], content=current)
    out = render('<HY_RELATED_LIST _limit="5" />', ctx)
    assert "related-list" in out
    assert "相关一" in out
    assert "当前" not in out


def test_G3_pagination_alias():
    """HY_PAGINATION 是 HY_CONTENTS_PAGINATION 别名"""
    contents = [make_item(id=f"c{i}", cat_id="cat1", cat_slug="news") for i in range(15)]
    cat = CategoryCtx(id="cat1", slug="news", url="/news/")
    ctx = make_ctx(contents=contents, category=cat)
    out = render(
        '<HY_CONTENTS _limit="5"><span><HY_ITEM_TITLE /></span></HY_CONTENTS>'
        '<HY_PAGINATION />',
        ctx,
    )
    assert 'class="pagination"' in out
    assert 'page-2.html' in out


def test_H1_banner_featured_per_cat():
    """_banner=true：每子栏目取 1 条头条且必须有 Banner 图"""
    parent = CategoryCtx(id="p", slug="xinwen", name="新闻", parent_id="")
    c1 = CategoryCtx(id="c1", slug="bid", name="中标", parent_id="p")
    c2 = CategoryCtx(id="c2", slug="honor", name="荣誉", parent_id="p")
    contents = [
        make_item(id="a", title="头条A", cat_id="c1", cat_slug="bid", is_featured=True,
                  published_at="2026-08-12T10:00:00Z", cover_url="/a-thumb.webp",
                  banner_url="/a-banner.webp"),
        make_item(id="a2", title="普通A", cat_id="c1", cat_slug="bid", is_featured=False,
                  published_at="2026-08-11T10:00:00Z", cover_url="/a2.webp"),
        make_item(id="b", title="头条B", cat_id="c2", cat_slug="honor", is_featured=True,
                  published_at="2026-08-10T10:00:00Z", cover_url="/b-thumb.webp",
                  banner_url="/b-banner.webp"),
        make_item(id="b0", title="无Banner头条", cat_id="c2", cat_slug="honor", is_featured=True,
                  published_at="2026-08-13T10:00:00Z", cover_url="/only-thumb.webp", banner_url=""),
    ]
    ctx = make_ctx(contents=contents, cats=[parent, c1, c2], category=parent)
    out = render(
        '<HY_CONTENTS _banner="true"><li><HY_ITEM_TITLE /></li></HY_CONTENTS>',
        ctx,
    )
    assert "头条A" in out
    assert "头条B" in out
    assert "普通A" not in out
    assert "无Banner头条" not in out
    assert out.count("<li>") == 2


def test_H2_include_children_list_and_count():
    """_include_children 合并子栏目；COUNT 同步过滤"""
    parent = CategoryCtx(id="p", slug="xinwen", name="新闻", parent_id="")
    c1 = CategoryCtx(id="c1", slug="bid", name="中标", parent_id="p")
    contents = [
        make_item(id="a", title="A", cat_id="c1", cat_slug="bid", published_at="2026-08-12T10:00:00Z"),
        make_item(id="b", title="B", cat_id="c1", cat_slug="bid", published_at="2026-08-01T10:00:00Z"),
    ]
    ctx = make_ctx(contents=contents, cats=[parent, c1], category=parent)
    count = render('<HY_CONTENTS_COUNT _include_children="true" />', ctx)
    assert count == "2"
    out = render(
        '<HY_CONTENTS _include_children="true" _limit="10" _order="newest">'
        '<i><HY_ITEM_TITLE /></i></HY_CONTENTS>',
        ctx,
    )
    assert out.index("A") < out.index("B")


def test_H3_siblings_tabs_current_class():
    """_type=siblings + CURRENT_CLASS"""
    parent = CategoryCtx(id="p", slug="xinwen", parent_id="")
    c1 = CategoryCtx(id="c1", slug="bid", name="中标", url="/bid/", parent_id="p")
    c2 = CategoryCtx(id="c2", slug="honor", name="荣誉", url="/honor/", parent_id="p")
    ctx = make_ctx(cats=[parent, c1, c2], category=c1)
    out = render(
        '<HY_CATS _type="siblings">'
        '<a class="<HY_CAT_ITEM_CURRENT_CLASS />" href="<HY_CAT_ITEM_URL />"><HY_CAT_ITEM_NAME /></a>'
        '</HY_CATS>',
        ctx,
    )
    assert 'class="is-current"' in out
    assert "中标" in out and "荣誉" in out


def test_I1_news_detail_content_tags():
    """新闻详情：标题/日期/来源/正文走 HY 标签，去掉正文重复头部"""
    raw_body = (
        '<section class="article-detail-head"><div class="article-detail-container">'
        '<h1>旧标题</h1><div class="article-meta"><div>'
        '<time datetime="2026-08-12">2026.08.12</time><span>约 5 分钟阅读</span><span>旧来源</span>'
        '</div></div></div></section>'
        '<section class="article-detail-body"><div class="article-detail-container">'
        '<article class="news-article"><p class="lead">导语正文</p></article>'
        '</div></section>'
    )
    content = ContentCtx(
        id="n1",
        title="全链路技术护航",
        published_at="2026-08-19T06:54:26+00:00",
        body_html=raw_body,
        author="Admin",
    )
    from pathlib import Path
    from app.services.layout_renderer import normalize_content_body_html, estimate_read_time_label
    content.body_html = normalize_content_body_html(raw_body)
    content.read_time = estimate_read_time_label(content.body_html)
    ctx = make_ctx()
    ctx.content = content
    ctx.site.name = "霍因科技"
    tpl_path = Path(__file__).resolve().parents[1] / "templates" / "news_detail_content.html"
    tpl = tpl_path.read_text(encoding="utf-8")
    out = render(tpl, ctx)
    assert "全链路技术护航" in out
    assert "2026.08.19" in out
    assert "霍因科技" in out
    assert "分钟阅读" in out
    assert "导语正文" in out
    assert "旧标题" not in out
    assert "旧来源" not in out
