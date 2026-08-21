"""D5 单测 - 6 cases

D5 范围:
A. DiskWriter 写盘 (4)
B. build_and_write 顶层 (2)
"""
import os
import tempfile
from pathlib import Path
import pytest

from app.services.disk_writer import DiskWriter, build_and_write, _safe_path
from app.services.page_renderer import PageFile


# ===========================================================================
# A. DiskWriter 写盘 (4)
# ===========================================================================

def test_A1_write_one():
    """单文件写盘, 返字节数"""
    with tempfile.TemporaryDirectory() as d:
        w = DiskWriter(d)
        html = "<h1>hi</h1>"
        size = w.write_one(PageFile(path="index.html", html=html, page_type="home"))
        assert size == len(html.encode("utf-8"))
        assert (Path(d) / "index.html").exists()
        assert (Path(d) / "index.html").read_text() == html


def test_A2_write_all_nested_dirs():
    """嵌套目录自动创建"""
    with tempfile.TemporaryDirectory() as d:
        w = DiskWriter(d)
        pages = [
            PageFile(path="index.html", html="x", page_type="home"),
            PageFile(path="tech/post.html", html="y", page_type="content"),
            PageFile(path="tech/ai/intro.html", html="z", page_type="content"),
        ]
        w.write_all(pages)
        assert (Path(d) / "index.html").exists()
        assert (Path(d) / "tech/post.html").exists()
        assert (Path(d) / "tech/ai/intro.html").exists()


def test_A3_write_rejects_traversal():
    """../ 越界被拒绝"""
    with tempfile.TemporaryDirectory() as d:
        w = DiskWriter(d)
        with pytest.raises(ValueError, match="unsafe path"):
            w.write_one(PageFile(path="../etc/passwd", html="x", page_type="home"))


def test_A4_write_rejects_absolute():
    """/ 开头被拒绝"""
    with tempfile.TemporaryDirectory() as d:
        w = DiskWriter(d)
        with pytest.raises(ValueError, match="unsafe path"):
            w.write_one(PageFile(path="/etc/passwd", html="x", page_type="home"))


# ===========================================================================
# B. build_and_write 顶层 (2)
# ===========================================================================

def test_B1_build_and_write_no_dir_returns_zero():
    """output_dir 为空 → 不写盘, 返 0 字节"""
    from dataclasses import dataclass, field
    from datetime import datetime, timezone

    @dataclass
    class Site:
        id: str = "s1"
        slug: str = "test"
        name: str = "测试站"
        url: str = "https://x.com"

    @dataclass
    class Cat:
        id: str = "c1"
        name: str = "科技"
        slug: str = "tech"
        parent_id: str = ""
        url: str = "/tech"
        seo: dict = field(default_factory=dict)

    @dataclass
    class Cont:
        id: str = "ct1"
        title: str = "A"
        url: str = "/tech/1"
        category_id: str = "c1"

    layouts = [dict(id="l1", scope="home", code="home",
                    html="<h1><HY_SITE_NAME/></h1>",
                    is_default=True, deleted_at=None)]
    pages, total = build_and_write(
        site=Site(), cats=[Cat()], contents=[Cont()], layouts=layouts,
        output_dir="",  # 不写
    )
    assert total == 0
    assert len(pages) >= 2  # 至少 home + sitemap


def test_B2_build_and_write_actual_files():
    """真写盘: sitemap + index + 详情"""
    from dataclasses import dataclass, field
    from datetime import datetime, timezone

    @dataclass
    class Site:
        id: str = "s1"
        slug: str = "test"
        name: str = "测试站"
        url: str = "https://x.com"

    @dataclass
    class Cat:
        id: str = "c1"
        name: str = "科技"
        slug: str = "tech"
        parent_id: str = ""
        url: str = "/tech"
        seo: dict = field(default_factory=dict)

    @dataclass
    class Cont:
        id: str = "ct1"
        title: str = "A"
        url: str = "/tech/1"
        slug: str = "1"  # D5: page path 用 slug
        excerpt: str = "x"
        cover_url: str = ""
        published_at: datetime = field(default_factory=lambda: datetime(2026, 6, 1, tzinfo=timezone.utc))
        view_count: int = 0
        category_id: str = "c1"

    layouts = [
        dict(id="l1", scope="home", code="home",
             html="<h1><HY_SITE_NAME/></h1><HY_CONTENTS _limit=\"5\"><li>HY_ITEM_TITLE</li></HY_CONTENTS>",
             is_default=True, deleted_at=None),
        dict(id="l2", scope="category", code="cat",
             html="<h2><HY_CAT_NAME/></h2><HY_CONTENTS _limit=\"10\"><li>HY_ITEM_TITLE</li></HY_CONTENTS>",
             is_default=True, deleted_at=None),
        dict(id="l3", scope="content", code="art",
             html="<h1><HY_CONTENT_TITLE/></h1>",
             is_default=True, deleted_at=None),
        dict(id="l4", scope="site", code="site",
             html="<body><header>site-header</header>__LAYOUT_CONTENT__<footer>site-footer</footer></body>", is_default=True, deleted_at=None),
    ]
    with tempfile.TemporaryDirectory() as d:
        pages, total = build_and_write(
            site=Site(), cats=[Cat()], contents=[Cont()], layouts=layouts,
            output_dir=d, base_url="https://x.com", clean_before=True,
        )
        # 文件落盘
        assert (Path(d) / "index.html").exists()
        assert (Path(d) / "tech" / "index.html").exists()
        assert (Path(d) / "tech" / "1.html").exists()
        assert (Path(d) / "sitemap.xml").exists()
        # 内容渲染
        html = (Path(d) / "index.html").read_text()
        assert "测试站" in html
        assert "A" in html  # 内容标题
        # sitemap
        sm = (Path(d) / "sitemap.xml").read_text()
        assert "https://x.com/index.html" in sm
        assert "https://x.com/tech/1.html" in sm
