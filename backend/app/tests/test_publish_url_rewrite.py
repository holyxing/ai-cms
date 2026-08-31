"""发布产物 URL 改写：/sites/{slug}/ → 相对路径；ZIP 英文占位路径 → slug 路径"""
import os
import tempfile

from app.workers.publish import _rewrite_admin_urls, _rewrite_legacy_urls, LEGACY_URL_MAP


def test_rewrite_admin_urls_depth_one():
    with tempfile.TemporaryDirectory() as tmp:
        sub = os.path.join(tmp, "guanyuwomen")
        os.makedirs(sub)
        fpath = os.path.join(sub, "gongsijieshao.html")
        with open(fpath, "w", encoding="utf-8") as f:
            f.write(
                '<img src="/sites/huoyinkeji/assets/images/banner.webp" alt="">'
                '<a href="/sites/huoyinkeji/xinwenzixun/">新闻</a>'
            )
        modified, _ = _rewrite_admin_urls(tmp, "huoyinkeji")
        assert modified == 1
        with open(fpath, "r", encoding="utf-8") as f:
            html = f.read()
        assert 'src="../assets/images/banner.webp"' in html
        assert 'href="../xinwenzixun/"' in html


def test_rewrite_admin_urls_root_index():
    with tempfile.TemporaryDirectory() as tmp:
        fpath = os.path.join(tmp, "index.html")
        with open(fpath, "w", encoding="utf-8") as f:
            f.write('<img src="/sites/huoyinkeji/assets/logo.png">')
        modified, _ = _rewrite_admin_urls(tmp, "huoyinkeji")
        assert modified == 1
        with open(fpath, "r", encoding="utf-8") as f:
            html = f.read()
        assert 'src="assets/logo.png"' in html


def test_rewrite_legacy_product_center_url():
    with tempfile.TemporaryDirectory() as tmp:
        sub = os.path.join(tmp, "guanyuwomen")
        os.makedirs(sub)
        fpath = os.path.join(sub, "lianxiwomen.html")
        with open(fpath, "w", encoding="utf-8") as f:
            f.write('<a href="../product-center/product-haishi.html">海石</a>')
        modified, _ = _rewrite_legacy_urls(tmp)
        assert modified == 1
        with open(fpath, "r", encoding="utf-8") as f:
            html = f.read()
        assert 'href="../chanpinzhongxin/haishi.html"' in html
        assert "product-center" not in html
