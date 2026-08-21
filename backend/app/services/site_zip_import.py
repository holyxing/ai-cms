"""网站 ZIP 导入：资源入库 + 按 5 类 scope 生成 HY_ 模板

范围（产品约定）:
- 导入 css/js/图片等到 site_assets
- 生成 site / home / category / content / partial 模板
- 不自动创建栏目或文章
- 含首页的整站 ZIP：更新 default / header / footer；按栏目分组各生成 1 份列表 + 1 份详情模板（同组页面共用，不按单页拆模板）
- 不含首页的二级 ZIP：不覆盖已有模板和资源；相同 header/footer 复用；每个栏目分组最多新增 1 列表 + 1 详情
- 分类：路径规则打底，有 AI Provider 时再微调

依据: docs/18-布局系统与标签占位符.md · 霍因科技站模板结构
"""
from __future__ import annotations

import io
import json
import mimetypes
import os
import re
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.layout import Layout, LayoutVersion
from app.models.site import Site
from app.models.site_asset import SiteAsset
from app.models.user import User

# ---- 限制，防止 zip bomb ----
ZIP_MAX_BYTES = 80 * 1024 * 1024
UNCOMPRESSED_MAX_BYTES = 200 * 1024 * 1024
MAX_FILES = 400
MAX_HTML = 80
HTML_FILE_MAX = 2 * 1024 * 1024

_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
_BLOCKED_EXTS = {".exe", ".bat", ".sh", ".php", ".py", ".pl", ".cgi", ".html", ".htm"}

CSS_EXTS = {".css"}
JS_EXTS = {".js", ".mjs"}
ASSET_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".mp4", ".webm", ".mp3", ".json",
}

HEADER_RE = re.compile(r"<header\b[^>]*>.*?</header>", re.I | re.S)
FOOTER_RE = re.compile(r"<footer\b[^>]*>.*?</footer>", re.I | re.S)
BODY_RE = re.compile(r"<body\b[^>]*>(.*?)</body>", re.I | re.S)
TITLE_RE = re.compile(r"<title\b[^>]*>(.*?)</title>", re.I | re.S)
H1_RE = re.compile(r"<h1\b[^>]*>(.*?)</h1>", re.I | re.S)
LINK_CSS_RE = re.compile(
    r"""<link\b[^>]*rel=["']stylesheet["'][^>]*>""",
    re.I,
)
SCRIPT_SRC_RE = re.compile(r"""<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>\s*</script>""", re.I)
HREF_SRC_RE = re.compile(
    r"""(?P<attr>href|src)=["'](?P<url>[^"']+)["']""",
    re.I,
)
CSS_URL_RE = re.compile(r"""url\(\s*['"]?([^'")]+)['"]?\s*\)""", re.I)
ARTICLE_RE = re.compile(r"<article\b[^>]*>.*?</article>", re.I | re.S)


@dataclass
class ZipHtmlFile:
    rel_path: str
    html: str
    scope: str  # home | category | content


@dataclass
class ZipAssetFile:
    rel_path: str
    name: str
    category: str  # css | js | assets
    data: bytes
    content_type: str


@dataclass
class ImportResult:
    assets_created: int = 0
    assets_overwritten: int = 0
    assets_skipped: int = 0
    layouts: list[dict] = field(default_factory=list)
    pages_classified: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    ai_used: bool = False


def sanitize_asset_name(rel_path: str, used: set[str]) -> str:
    """把 zip 内路径变成合法 site_asset.name"""
    raw = rel_path.replace("\\", "/")
    base = Path(raw).name
    stem, ext = os.path.splitext(base)
    stem = _NAME_RE.sub("-", stem).strip(".-") or "file"
    ext = ext.lower()
    parent = Path(raw).parent.name
    parent = _NAME_RE.sub("-", parent).strip(".-")
    name = f"{stem}{ext}"
    if name in used and parent:
        name = f"{parent}-{stem}{ext}"[:128]
    n = 2
    origin = name
    while name in used:
        stem2, ext2 = os.path.splitext(origin)
        name = f"{stem2}-{n}{ext2}"[:128]
        n += 1
    used.add(name)
    return name


def category_for_ext(ext: str) -> Optional[str]:
    ext = ext.lower()
    if ext in CSS_EXTS:
        return "css"
    if ext in JS_EXTS:
        return "js"
    if ext in ASSET_EXTS:
        return "assets"
    return None


def looks_like_list(html: str) -> bool:
    articles = len(ARTICLE_RE.findall(html))
    if articles >= 3:
        return True
    if len(re.findall(r'class=["\'][^"\']*(news-list|post-list|card-list|item-list)', html, re.I)) >= 1:
        if html.lower().count("<article") >= 2 or html.lower().count("class=\"card") >= 3:
            return True
    li_links = len(re.findall(r"<li\b[^>]*>\s*<a\b", html, re.I))
    return li_links >= 8


def looks_like_article(html: str) -> bool:
    if not H1_RE.search(html):
        return False
    text = re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.I | re.S)
    text = re.sub(r"<style\b[^>]*>.*?</style>", "", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    return len(text.split()) >= 80


def classify_html_path(rel_path: str, html: str) -> str:
    """路径规则打底：根目录 index/home=首页；子目录 index=栏目；其它 html=详情。

    二级页 (about-company.html / news-bid.html) 即使在 zip 根目录也不是首页。
    """
    p = rel_path.replace("\\", "/").lstrip("/")
    name = Path(p).name.lower()
    depth = p.count("/")
    if name in ("index.html", "index.htm", "home.html", "default.html") and depth == 0:
        return "home"
    if name in ("index.html", "index.htm") and depth >= 1:
        if looks_like_article(html) and not looks_like_list(html):
            return "content"
        return "category"
    if looks_like_list(html) and not looks_like_article(html):
        return "category"
    if looks_like_article(html):
        return "content"
    return "content"


def category_group_from_path(rel_path: str) -> str:
    """栏目分组键（同一栏目共用一套列表+详情模板）。

    - 子目录页面：取第一级目录名（news/foo.html → news）
    - 根目录页面：取文件名第一个连字符前缀（news-bid.html → news）
    """
    p = rel_path.replace("\\", "/").lstrip("/")
    parts = Path(p).parts
    if len(parts) >= 2:
        raw = parts[0].lower()
    else:
        stem = Path(p).stem.lower()
        raw = stem.split("-", 1)[0] if "-" in stem else stem
    code = _NAME_RE.sub("-", raw).strip("-")
    code = re.sub(r"-{2,}", "-", code)
    if not code or code in ("index", "home", "default"):
        return "default"
    return code[:64]


def group_htmls_by_category(htmls: list[ZipHtmlFile]) -> dict[str, dict[str, ZipHtmlFile]]:
    """按栏目分组；每组每种 scope 只保留一个代表 HTML（列表/详情各一）。"""
    groups: dict[str, dict[str, ZipHtmlFile]] = {}
    for h in htmls:
        if h.scope == "home":
            continue
        g = category_group_from_path(h.rel_path)
        bucket = groups.setdefault(g, {})
        if h.scope not in bucket:
            bucket[h.scope] = h
    return groups


def layout_stem_code(rel_path: str) -> str:
    """文件名 → layout.code（不含重名后缀）。index/home/default → default"""
    stem = Path(rel_path.replace("\\", "/")).stem.lower()
    code = _NAME_RE.sub("-", stem).strip("-")
    code = re.sub(r"-{2,}", "-", code)
    if not code or code in ("index", "home", "default"):
        return "default"
    return code[:64]


def layout_code_from_path(rel_path: str, used: set[str]) -> str:
    """用文件名生成 layout.code；index/home/default → default，重名自动加后缀"""
    code = layout_stem_code(rel_path)
    origin = code
    n = 2
    while code in used:
        code = f"{origin}-{n}"[:64]
        n += 1
    used.add(code)
    return code


def page_title_from_html(html: str, fallback: str) -> str:
    m = TITLE_RE.search(html)
    if not m:
        return fallback[:128]
    title = re.sub(r"<[^>]+>", "", m.group(1)).strip()
    title = re.split(r"[｜|·\-—]", title, maxsplit=1)[0].strip()
    return (title or fallback)[:128]


# 常见 ZIP 分组 code → 中文栏目名（导入时写入 layout.name）
_GROUP_ZH: dict[str, str] = {
    "news": "新闻资讯",
    "product": "产品中心",
    "products": "产品中心",
    "about": "关于我们",
    "cases": "成功案例",
    "solutions": "解决方案",
    "company": "公司介绍",
    "contact": "联系我们",
    "trial": "产品试用",
    "industry": "行业应用",
}


def group_display_label(code: str, rep_html: str = "") -> str:
    """栏目分组 code → 可读中文名（优先内置映射，其次页面 title）"""
    if code in _GROUP_ZH:
        return _GROUP_ZH[code]
    if rep_html:
        t = page_title_from_html(rep_html, code)
        if t and t.lower() != code.lower() and len(t) <= 32:
            return t
    return code


def layout_display_name(code: str, scope: str, rep_html: str = "") -> str:
    """生成带栏目语义的可读模板名。

    - code=default：站点兑底模板（未指定 template 的栏目/文章使用）
    - 其它 code：{栏目名} · 栏目列表/文章详情
    """
    if scope == "category":
        kind = "栏目列表"
    elif scope == "content":
        kind = "文章详情"
    elif scope == "home":
        return "首页布局"
    elif scope == "site":
        return "站点布局"
    elif scope == "partial":
        return code if code in ("header", "footer") else f"子模板 {code}"
    else:
        kind = scope
    if code == "default":
        return f"通用{kind}（default · 站点兑底）"
    label = group_display_label(code, rep_html)
    return f"{label} · {kind}"


def strip_zip_root(names: list[str]) -> str:
    """若所有文件都在同一顶层目录下，返回该前缀（含 /）"""
    cleaned = [n.replace("\\", "/") for n in names if n and not n.endswith("/")]
    if not cleaned:
        return ""
    first = cleaned[0].split("/")
    if len(first) < 2:
        return ""
    root = first[0] + "/"
    if all(n.startswith(root) for n in cleaned):
        return root
    return ""


def extract_zip(data: bytes) -> tuple[list[ZipHtmlFile], list[ZipAssetFile], list[str]]:
    """解压并分类 html / 静态资源。返回 (htmls, assets, warnings)"""
    warnings: list[str] = []
    if len(data) > ZIP_MAX_BYTES:
        raise ValueError(f"ZIP 过大（>{ZIP_MAX_BYTES // (1024 * 1024)}MB）")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise ValueError(f"不是有效的 ZIP: {e}") from e

    infos = zf.infolist()
    if len(infos) > MAX_FILES:
        raise ValueError(f"ZIP 内文件过多（>{MAX_FILES}）")
    total_uncomp = sum(i.file_size for i in infos)
    if total_uncomp > UNCOMPRESSED_MAX_BYTES:
        raise ValueError("解压后体积过大，已拒绝")

    names = [i.filename for i in infos if not i.is_dir()]
    for n in names:
        if ".." in n.replace("\\", "/") or n.startswith("/"):
            raise ValueError(f"非法路径: {n}")
    prefix = strip_zip_root(names)

    htmls: list[ZipHtmlFile] = []
    assets: list[ZipAssetFile] = []
    used_names: set[str] = set()

    for info in infos:
        if info.is_dir():
            continue
        rel = info.filename.replace("\\", "/")
        if prefix and rel.startswith(prefix):
            rel = rel[len(prefix):]
        if not rel or rel.startswith("__MACOSX/") or Path(rel).name.startswith("."):
            continue
        ext = Path(rel).suffix.lower()
        raw = zf.read(info)
        if ext in {".html", ".htm"}:
            if len(htmls) >= MAX_HTML:
                warnings.append(f"HTML 超过 {MAX_HTML} 个，已截断")
                continue
            if len(raw) > HTML_FILE_MAX:
                warnings.append(f"跳过过大 HTML: {rel}")
                continue
            try:
                html = raw.decode("utf-8")
            except UnicodeDecodeError:
                html = raw.decode("gb18030", errors="replace")
            htmls.append(ZipHtmlFile(rel_path=rel, html=html, scope=classify_html_path(rel, html)))
            continue
        cat = category_for_ext(ext)
        if not cat:
            warnings.append(f"跳过不支持的文件: {rel}")
            continue
        if ext in _BLOCKED_EXTS:
            continue
        name = sanitize_asset_name(rel, used_names)
        mime = mimetypes.guess_type(rel)[0] or "application/octet-stream"
        assets.append(ZipAssetFile(
            rel_path=rel, name=name, category=cat, data=raw, content_type=mime,
        ))
    return htmls, assets, warnings


def _norm_for_compare(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def pick_common_block(htmls: list[str], regex: re.Pattern) -> str:
    """多数页面共有的 header/footer 取出现次数最多的一份"""
    blocks = []
    for h in htmls:
        m = regex.search(h)
        if m:
            blocks.append(m.group(0))
    if not blocks:
        return ""
    counts = Counter(_norm_for_compare(b) for b in blocks)
    best_key, n = counts.most_common(1)[0]
    if n < max(1, (len(htmls) + 1) // 2) and len(htmls) > 1:
        # 不到半数相同则仍用出现最多的
        pass
    for b in blocks:
        if _norm_for_compare(b) == best_key:
            return b
    return blocks[0]


def extract_body(html: str) -> str:
    m = BODY_RE.search(html)
    return m.group(1).strip() if m else html


def strip_chrome(html: str, header: str, footer: str) -> str:
    """去掉 head 外壳、公共头尾、外链 css/js，得到页面主体"""
    body = extract_body(html)
    if header:
        body = body.replace(header, "", 1)
    if footer:
        body = body.replace(footer, "", 1)
    body = LINK_CSS_RE.sub("", body)
    body = SCRIPT_SRC_RE.sub("", body)
    body = re.sub(r"<style\b[^>]*>.*?</style>", "", body, flags=re.I | re.S)
    return body.strip()


def resolve_zip_asset_name(url: str, page_dir: str, rel_to_name: dict[str, str]) -> str | None:
    """把页面里的相对 href/src 解析成 site_asset.name"""
    if url.startswith(("http://", "https://", "data:", "mailto:", "tel:", "#", "//")):
        return None
    cleaned = url.split("?")[0].split("#")[0]
    joined = os.path.normpath(str(Path(page_dir or ".") / cleaned)).replace("\\", "/")
    if joined.startswith("../"):
        joined = joined.replace("../", "")
    return rel_to_name.get(cleaned) or rel_to_name.get(joined) or rel_to_name.get(Path(cleaned).name)


def linked_asset_names(html: str, page_dir: str, rel_to_name: dict[str, str], kind: str) -> list[str]:
    """按 ZIP 页面 <link>/<script> 收集 css 或 js 的 asset.name，保持引用顺序"""
    names: list[str] = []
    if kind == "css":
        for m in re.finditer(r"<link\b[^>]*>", html, re.I):
            tag = m.group(0)
            if "stylesheet" not in tag.lower():
                continue
            hm = re.search(r'''href=["']([^"']+)["']''', tag, re.I)
            if not hm:
                continue
            name = resolve_zip_asset_name(hm.group(1), page_dir, rel_to_name)
            if name and name.lower().endswith(".css") and name not in names:
                names.append(name)
        return names
    for m in re.finditer(r'''<script\b[^>]*\bsrc=["']([^"']+)["']''', html, re.I):
        name = resolve_zip_asset_name(m.group(1), page_dir, rel_to_name)
        if name and name.lower().endswith((".js", ".mjs")) and name not in names:
            names.append(name)
    return names


def extra_asset_tags(css_names: list[str], js_names: list[str]) -> str:
    bits: list[str] = []
    if css_names:
        bits.append(f'<HY_SITE_CSS _include="{ ",".join(css_names) }" />')
    if js_names:
        bits.append(f'<HY_SITE_JS _include="{ ",".join(js_names) }" />')
    return ("\n".join(bits) + "\n") if bits else ""


def rewrite_local_urls(html: str, rel_to_name: dict[str, str], page_dir: str) -> str:
    """本地 href/src 换成 HY_ASSET_URL；站点 CSS/JS 由 site layout 统一装载，这里只改 img 等"""

    def repl(m: re.Match) -> str:
        attr = m.group("attr")
        url = m.group("url")
        name = resolve_zip_asset_name(url, page_dir, rel_to_name)
        if not name:
            return m.group(0)
        if attr.lower() == "href" and name.lower().endswith((".css", ".js")):
            return m.group(0)  # css/js 由 HY_SITE_CSS/JS 处理
        return f'{attr}="<HY_ASSET_URL _name="{name}" />"'

    return HREF_SRC_RE.sub(repl, html)


def rewrite_css_urls(css: str, rel_to_name: dict[str, str], css_dir: str) -> str:
    """url() 保持 ZIP 相对路径；若同时有 pexels 占位图和 banner-hero-*-v3 设计稿，改用 v3。"""
    zip_rels = [k.replace("\\", "/") for k in rel_to_name if "/" in k.replace("\\", "/")]
    if not zip_rels:
        zip_rels = [k.replace("\\", "/") for k in rel_to_name]

    def pick_zip_rel(joined: str) -> str | None:
        joined = joined.replace("\\", "/")
        if "/" in joined and joined in rel_to_name:
            return joined
        name = Path(joined).name
        for r in zip_rels:
            if Path(r).name == name:
                return r
        if joined in rel_to_name:
            return joined
        if name in rel_to_name:
            return name
        return None

    def prefer_v3(zip_rel: str) -> str:
        name = Path(zip_rel).name.lower()
        if "pexels" not in name:
            return zip_rel
        stem = re.sub(r"-pexels$", "", Path(name).stem, flags=re.I)
        stem = re.sub(r"^home-", "", stem, flags=re.I)
        needle = f"banner-hero-{stem}-v3."
        for r in zip_rels:
            if needle in r.lower():
                return r
        return zip_rel

    def repl(m: re.Match) -> str:
        url = m.group(1).strip()
        if url.startswith(("http://", "https://", "data:", "#")):
            return m.group(0)
        cleaned = url.split("?")[0]
        joined = os.path.normpath(str(Path(css_dir or ".") / cleaned)).replace("\\", "/")
        zip_rel = pick_zip_rel(joined) or pick_zip_rel(cleaned)
        if not zip_rel:
            return m.group(0)
        zip_rel = prefer_v3(zip_rel)
        rel = os.path.relpath(zip_rel, start=css_dir or ".").replace("\\", "/")
        return f'url("{rel}")'

    out = CSS_URL_RE.sub(repl, css)
    # v3 设计稿不再使用 pexels 的裁切偏移（否则顶部会露出亮带，看起来像空白条）
    out = re.sub(
        r'(background-image:\s*url\("[^"]*banner-hero-[^"]*-v3\.webp"\);)\s*background-position:\s*[^;]+;',
        r"\1",
        out,
    )
    return out


def replace_site_name(html: str, site_name: str) -> str:
    if not site_name or len(site_name) < 2:
        return html
    return html.replace(site_name, "<HY_SITE_NAME />")


def templatize_category(inner: str) -> str:
    """把重复 article/卡片收成 HY_CONTENTS 循环"""
    arts = list(ARTICLE_RE.finditer(inner))
    if len(arts) >= 2:
        first = arts[0].group(0)
        card = first
        card = re.sub(r"(<h[1-3]\b[^>]*>)(.*?)(</h[1-3]>)", r"\1<a href=\"<HY_ITEM_URL />\"><HY_ITEM_TITLE /></a>\3", card, count=1, flags=re.I | re.S)
        card = re.sub(r"""(<img\b[^>]*\bsrc=["'])[^"']+(["'])""", r'\1<HY_ITEM_COVER />\2', card, count=1, flags=re.I)
        card = re.sub(r"(<p\b[^>]*>)(.*?)(</p>)", r"\1<HY_ITEM_SUMMARY />\3", card, count=1, flags=re.I | re.S)
        card = re.sub(r"(<time\b[^>]*>)(.*?)(</time>)", r"\1<HY_ITEM_DATE />\3", card, count=1, flags=re.I | re.S)
        start, end = arts[0].start(), arts[-1].end()
        wrapped = (
            f'<HY_CONTENTS _limit="12" _order="newest">\n{card}\n</HY_CONTENTS>\n'
            f'<HY_CONTENTS_EMPTY><p class="empty">该栏目暂无内容</p></HY_CONTENTS_EMPTY>\n'
            f'<HY_CONTENTS_PAGINATION _show_numbers="true" />'
        )
        return inner[:start] + wrapped + inner[end:]
    # 无 article 时在末尾补标准列表
    return (
        inner
        + '\n<HY_CONTENTS _limit="12" _order="newest">\n'
        + '  <article class="card">\n'
        + '    <h3><a href="<HY_ITEM_URL />"><HY_ITEM_TITLE /></a></h3>\n'
        + '    <p><HY_ITEM_SUMMARY /></p>\n'
        + '    <time><HY_ITEM_DATE /></time>\n'
        + "  </article>\n"
        + "</HY_CONTENTS>\n"
        + '<HY_CONTENTS_PAGINATION _show_numbers="true" />\n'
    )


def templatize_content(inner: str) -> str:
    out = inner
    out = H1_RE.sub("<h1><HY_CONTENT_TITLE /></h1>", out, count=1)
    # 最大文本块粗略替换为正文：第一个 <article> 或 .content / .post-body
    out = re.sub(
        r'(<(?:article|div)\b[^>]*class=["\'][^"\']*(?:post-body|article-body|content-body|entry-content)[^"\']*["\'][^>]*>)(.*?)(</(?:article|div)>)',
        r"\1<HY_CONTENT_BODY />\3",
        out,
        count=1,
        flags=re.I | re.S,
    )
    if "<HY_CONTENT_BODY" not in out:
        out += "\n<article class=\"post-body\"><HY_CONTENT_BODY /></article>\n"
    return out


def templatize_home(inner: str) -> str:
    """首页保留 ZIP 静态营销结构。

    首页里的 <article> 是产品卡片 / 方案节点 / 新闻样例，不是 CMS 列表。
    若走 templatize_category，会把第一张到最后一张 article 之间全部收成 HY_CONTENTS，
    发布时库里没有文章就会变成「该栏目暂无内容」。
    """
    return inner


def rewrite_chrome_tags(html: str, rel_to_name: dict[str, str], page_dir: str, site_name: str) -> str:
    html = rewrite_local_urls(html, rel_to_name, page_dir)
    html = replace_site_name(html, site_name)
    return html


def ensure_one_main(html: str) -> str:
    """页面有且仅有一层 <main>。

    原站 CSS 是 `main { padding-top: 76px }` 给固定顶栏留空。
    站点壳若再包一层 <main>，padding 会加两次，顶栏和 banner 之间出现白条。
    """
    if re.search(r"<main\b", html, re.I):
        return html
    return f"<main>\n{html}\n</main>"


def build_site_layout(css_names: list[str], js_names: list[str]) -> str:
    css_attr = ""
    if css_names:
        css_attr = f' _include="{ ",".join(css_names) }"'
    js_attr = ""
    if js_names:
        js_attr = f' _include="{ ",".join(js_names) }"'
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><HY_PAGE_TITLE /> · <HY_SITE_NAME /></title>
  <meta name="description" content="<HY_PAGE_DESC />">
  <HY_SITE_CSS{css_attr} />
</head>
<body>
  <HY_TEMPLATE code="header" />
  __LAYOUT_CONTENT__
  <HY_TEMPLATE code="footer" />
  <HY_SITE_JS{js_attr} />
</body>
</html>
"""


def default_header() -> str:
    return """<header class="site-header">
  <a class="brand" href="/"><HY_SITE_NAME /></a>
  <nav>
    <a href="/" class="nav-link<HY_MENU_ACTIVE _match="/" />">首页</a>
  </nav>
</header>
"""


def default_footer() -> str:
    return """<footer class="site-footer">
  <p><HY_SITE_COPYRIGHT /> · <HY_SITE_ICP /></p>
</footer>
"""


async def _ai_refine_scopes(
    htmls: list[ZipHtmlFile],
    user: User,
    db: AsyncSession,
) -> tuple[bool, list[str]]:
    """用默认 AI Provider 微调分类；失败则静默跳过"""
    warnings: list[str] = []
    try:
        from app.models.ai_provider import AIProvider
        from app.services.llm.base import LLMMessage
        from app.services.llm.factory import get_provider_for_user
        from app.services.llm.mock import MockProvider

        stmt = select(AIProvider).where(
            AIProvider.user_id == user.id,
            AIProvider.is_default.is_(True),
            AIProvider.deleted_at.is_(None),
        )
        provider_model = (await db.execute(stmt)).scalar_one_or_none()
        if provider_model is None:
            warnings.append("未配置默认 AI Provider，分类仅用路径规则")
            return False, warnings
        provider = get_provider_for_user(user_id=user.id, provider_config=provider_model)
        if isinstance(provider, MockProvider):
            warnings.append("未配置可用 AI Provider，分类仅用路径规则")
            return False, warnings

        lines = []
        for h in htmls[:40]:
            title_m = TITLE_RE.search(h.html)
            title = re.sub(r"<[^>]+>", "", title_m.group(1)).strip() if title_m else ""
            snippet = re.sub(r"\s+", " ", h.html)[:400]
            lines.append(f"- path={h.rel_path} heuristic={h.scope} title={title}\n  snippet={snippet}")
        prompt = (
            "将下列静态网页分到 home / category / content 三类。"
            "home=整站首页；category=列表/栏目；content=文章详情。"
            "只输出 JSON：{\"files\": {\"相对路径\": \"home|category|content\"}}\n\n"
            + "\n".join(lines)
        )
        model = getattr(provider_model, "model", None) or "qwen2.5:1.5b"
        resp = await provider.generate(
            [
                LLMMessage(role="system", content="你是 CMS 页面分类器，只输出 JSON。"),
                LLMMessage(role="user", content=prompt),
            ],
            model=model,
            temperature=0.2,
            max_tokens=1024,
        )
        text = (resp.content or "").strip()
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            warnings.append("AI 分类无 JSON，沿用规则结果")
            return False, warnings
        data = json.loads(m.group(0))
        mapping = data.get("files") or {}
        changed = 0
        for h in htmls:
            v = mapping.get(h.rel_path)
            if v in ("home", "category", "content") and v != h.scope:
                h.scope = v
                changed += 1
        warnings.append(f"AI 调整了 {changed} 个页面的分类")
        return True, warnings
    except Exception as e:
        logger.warning(f"ZIP 导入 AI 分类跳过: {e}")
        warnings.append(f"AI 分类失败，沿用规则: {e}")
        return False, warnings


async def _upsert_layout(
    db: AsyncSession,
    site_id: UUID,
    author_id: UUID,
    scope: str,
    code: str,
    name: str,
    html: str,
    template_kind: str,
    is_default: bool,
    overwrite: bool = True,
) -> dict:
    exist = (await db.execute(
        select(Layout).where(
            Layout.site_id == site_id,
            Layout.scope == scope,
            Layout.code == code,
            Layout.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if exist and not overwrite:
        return {
            "id": str(exist.id),
            "scope": scope,
            "code": code,
            "name": exist.name,
            "action": "reused",
            "version": exist.version,
        }
    note = "ZIP 导入覆盖" if exist else "ZIP 导入创建"
    action = "overwritten" if exist else "created"
    if exist:
        html_changed = exist.html != html
        if html_changed:
            exist.html = html
            exist.version = exist.version + 1
            db.add(LayoutVersion(
                layout_id=exist.id,
                version=exist.version,
                html=html,
                change_note=note,
                author_id=author_id,
            ))
        # ZIP 覆盖时同步显示名（HTML 未变也要更新，否则重导入名称仍是旧值）
        if exist.name != name:
            exist.name = name
        exist.template_kind = template_kind
        exist.is_active = True
        if is_default:
            exist.is_default = True
        layout = exist
    else:
        layout = Layout(
            site_id=site_id,
            scope=scope,
            code=code,
            name=name,
            html=html,
            is_default=is_default,
            is_active=True,
            template_kind=template_kind,
            version=1,
        )
        db.add(layout)
        await db.flush()
        db.add(LayoutVersion(
            layout_id=layout.id,
            version=1,
            html=html,
            change_note=note,
            author_id=author_id,
        ))
    if is_default:
        await db.execute(
            Layout.__table__.update()
            .where(
                Layout.site_id == site_id,
                Layout.scope == scope,
                Layout.id != layout.id,
                Layout.deleted_at.is_(None),
            )
            .values(is_default=False)
        )
        layout.is_default = True
    await db.flush()
    return {
        "id": str(layout.id),
        "scope": scope,
        "code": code,
        "name": name,
        "action": action,
        "version": layout.version,
    }


def _safe_zip_dest(site_id: UUID, rel_path: str) -> Path:
    """按 ZIP 相对路径落到 site_assets/{site_id}/...，拒绝 .. 越界"""
    settings = get_settings()
    root = (Path(settings.SITE_ASSETS_DIR) / str(site_id)).resolve()
    rel = rel_path.replace("\\", "/").lstrip("/")
    if not rel or ".." in Path(rel).parts:
        raise ValueError(f"非法路径: {rel_path}")
    dest = (root / rel).resolve()
    if dest != root and not str(dest).startswith(str(root) + os.sep):
        raise ValueError(f"非法路径: {rel_path}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    return dest


async def _upsert_asset(
    db: AsyncSession,
    site_id: UUID,
    item: ZipAssetFile,
    data: bytes,
    overwrite: bool = True,
) -> str:
    """按 ZIP 相对路径写入磁盘。overwrite=False 时已有同名资源直接跳过。返回 created|overwritten|skipped"""
    settings = get_settings()
    if len(data) > settings.SITE_ASSET_MAX_SIZE:
        raise ValueError(f"资源过大: {item.name} ({len(data)} bytes)")
    dest = _safe_zip_dest(site_id, item.rel_path)
    zip_rel = item.rel_path.replace("\\", "/")[:256]

    r = await db.execute(
        select(SiteAsset).where(
            SiteAsset.site_id == site_id,
            SiteAsset.category == item.category,
            SiteAsset.name == item.name,
        )
    )
    existing = r.scalar_one_or_none()
    if existing and not overwrite:
        return "skipped"
    dest.write_bytes(data)
    if existing:
        old = existing.file_path
        existing.file_path = str(dest)
        existing.byte_size = len(data)
        existing.content_type = item.content_type
        existing.original_filename = zip_rel
        existing.description = f"ZIP 导入覆盖 ({item.rel_path})"
        if old and old != str(dest) and os.path.isfile(old):
            try:
                os.remove(old)
            except OSError:
                pass
        return "overwritten"
    db.add(SiteAsset(
        site_id=site_id,
        category=item.category,
        name=item.name,
        original_filename=zip_rel,
        file_path=str(dest),
        content_type=item.content_type,
        byte_size=len(data),
        description=f"ZIP 导入 ({item.rel_path})",
    ))
    return "created"


async def _archive_source_zip_to_media(
    db: AsyncSession,
    site: Site,
    user: User,
    zip_bytes: bytes,
    filename: str,
) -> Optional[str]:
    """把导入用的源 ZIP 登记到媒体库，mime=application/zip，出现在「压缩包」目录"""
    from io import BytesIO

    from app.models.media import Media
    from app.services import minio_client

    name = Path(filename or "import.zip").name
    if not name.lower().endswith(".zip"):
        name = f"{name}.zip"

    existing = (await db.execute(
        select(Media).where(
            Media.site_id == site.id,
            Media.filename == name,
            Media.mime_type.like("application/zip%"),
            Media.deleted_at.is_(None),
        )
    )).scalar_one_or_none()

    settings = get_settings()
    try:
        object_key = existing.object_key if existing else minio_client.make_object_key(str(site.id), ".zip")
        minio_client.get_minio().put_object(
            settings.MINIO_BUCKET,
            object_key,
            BytesIO(zip_bytes),
            length=len(zip_bytes),
            content_type="application/zip",
        )
        if existing:
            existing.size_bytes = len(zip_bytes)
            existing.mime_type = "application/zip"
            existing.thumb_status = "done"
            existing.alt_text = existing.alt_text or "ZIP 导入源文件"
            return str(existing.id)
        m = Media(
            site_id=site.id,
            uploader_id=user.id,
            filename=name,
            object_key=object_key,
            mime_type="application/zip",
            size_bytes=len(zip_bytes),
            alt_text="ZIP 导入源文件",
            thumb_status="done",
        )
        db.add(m)
        await db.flush()
        return str(m.id)
    except Exception as e:
        logger.warning(f"源 ZIP 写入媒体库失败: {e}")
        return None


async def import_site_zip(
    db: AsyncSession,
    site: Site,
    user: User,
    zip_bytes: bytes,
    use_ai: bool = True,
    source_filename: str = "import.zip",
) -> ImportResult:
    htmls, assets, warnings = extract_zip(zip_bytes)
    result = ImportResult(warnings=warnings)
    if not htmls:
        raise ValueError("ZIP 里没有 HTML 文件")

    ai_used = False
    if use_ai:
        ai_used, ai_warns = await _ai_refine_scopes(htmls, user, db)
        result.ai_used = ai_used
        result.warnings.extend(ai_warns)

    existing_rows = (await db.execute(
        select(Layout.scope, Layout.code).where(
            Layout.site_id == site.id,
            Layout.deleted_at.is_(None),
        )
    )).all()
    existing_keys = {(r.scope, r.code) for r in existing_rows}
    has_existing = bool(existing_keys)
    has_home_in_zip = any(h.scope == "home" for h in htmls)
    incremental = has_existing and not has_home_in_zip

    if not has_home_in_zip:
        if incremental:
            result.warnings.append("ZIP 无首页，按二级增量导入：不覆盖已有 default / header / footer / 同名资源")
        else:
            htmls[0].scope = "home"
            result.warnings.append(f"未识别到首页，已将 {htmls[0].rel_path} 作为首页")

    rel_to_name = {a.rel_path: a.name for a in assets}
    # 也按 basename 索引（HTML img 偶发只写文件名）
    for a in assets:
        rel_to_name.setdefault(Path(a.rel_path).name, a.name)

    rewritten: list[ZipAssetFile] = []
    for a in assets:
        data = a.data
        if a.category == "css":
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError:
                text = data.decode("latin-1", errors="replace")
            text = rewrite_css_urls(text, rel_to_name, str(Path(a.rel_path).parent))
            data = text.encode("utf-8")
        rewritten.append(ZipAssetFile(
            rel_path=a.rel_path, name=a.name, category=a.category,
            data=data, content_type=a.content_type,
        ))

    for a in rewritten:
        try:
            action = await _upsert_asset(db, site.id, a, a.data, overwrite=not incremental)
        except ValueError as e:
            result.warnings.append(str(e))
            continue
        if action == "created":
            result.assets_created += 1
        elif action == "overwritten":
            result.assets_overwritten += 1
        else:
            result.assets_skipped += 1

    all_html = [h.html for h in htmls]
    zip_header = pick_common_block(all_html, HEADER_RE)
    zip_footer = pick_common_block(all_html, FOOTER_RE)

    by_scope: dict[str, list[ZipHtmlFile]] = {"home": [], "category": [], "content": []}
    for h in htmls:
        by_scope.setdefault(h.scope, []).append(h)
        result.pages_classified.append({"path": h.rel_path, "scope": h.scope})

    def pick_rep(scope: str) -> Optional[ZipHtmlFile]:
        items = by_scope.get(scope) or []
        return items[0] if items else None

    def inner_of(item: Optional[ZipHtmlFile]) -> str:
        if not item:
            return ""
        raw = strip_chrome(item.html, zip_header, zip_footer)
        page_dir = str(Path(item.rel_path).parent)
        raw = rewrite_chrome_tags(raw, rel_to_name, page_dir if page_dir != "." else "", site.name or "")
        return raw

    async def add_layout(
        scope: str, code: str, name: str, html: str, kind: str, is_def: bool, overwrite: bool,
    ) -> None:
        info = await _upsert_layout(
            db, site.id, user.id, scope, code, name, html, kind, is_def, overwrite=overwrite,
        )
        result.layouts.append(info)
        existing_keys.add((scope, code))

    if incremental:
        # 页头页脚：已有则复用；ZIP 里有且不同则新建 header-2 / footer-2
        for kind_code, extracted, label in (
            ("header", zip_header, "页头"),
            ("footer", zip_footer, "页脚"),
        ):
            if ("partial", kind_code) in existing_keys:
                if extracted:
                    result.warnings.append(f"已有 {kind_code}，复用同一份")
                await add_layout("partial", kind_code, label, "", "partial", False, overwrite=False)
                continue
            html = extracted or (default_header() if kind_code == "header" else default_footer())
            html = rewrite_chrome_tags(html, rel_to_name, "", site.name or "")
            if kind_code == "header" and "<HY_SITE_NAME" not in html:
                html = replace_site_name(html, site.name or "") or html
            await add_layout("partial", kind_code, label, html, "partial", False, overwrite=False)

        used_by_scope: dict[str, set[str]] = {}
        for scope, code in existing_keys:
            used_by_scope.setdefault(scope, set()).add(code)

        grouped = group_htmls_by_category(htmls)
        named = 0
        for g, bucket in grouped.items():
            for scope in ("category", "content"):
                h = bucket.get(scope)
                if not h:
                    continue
                if (scope, g) in existing_keys:
                    continue
                inner = inner_of(h)
                d = str(Path(h.rel_path).parent)
                if d == ".":
                    d = ""
                page_css = [n for n in linked_asset_names(h.html, d, rel_to_name, "css")]
                page_js = [n for n in linked_asset_names(h.html, d, rel_to_name, "js")]
                body = extra_asset_tags(page_css, page_js)
                body += templatize_category(inner) if scope == "category" else templatize_content(inner)
                name = layout_display_name(g, scope, h.html)
                await add_layout(scope, g, name[:128], ensure_one_main(body), "page", False, overwrite=False)
                used_by_scope.setdefault(scope, set()).add(g)
                named += 1
        if named:
            result.warnings.append(f"已按栏目分组新增 {named} 个列表/详情模板（每组最多 1 列表 + 1 详情）")

        if rewritten:
            result.warnings.append("新 CSS/JS 已入库；已有站点布局未改写，请在对应模板用 HY_SITE_CSS / HY_SITE_JS 引用")
    else:
        header = zip_header or default_header()
        footer = zip_footer or default_footer()
        header = rewrite_chrome_tags(header, rel_to_name, "", site.name or "")
        footer = rewrite_chrome_tags(footer, rel_to_name, "", site.name or "")
        if "<HY_SITE_NAME" not in header:
            header = replace_site_name(header, site.name or "") or header

        home_item = pick_rep("home")
        home_dir = str(Path(home_item.rel_path).parent) if home_item else ""
        if home_dir == ".":
            home_dir = ""
        css_names = linked_asset_names(home_item.html if home_item else "", home_dir, rel_to_name, "css")
        js_names = linked_asset_names(home_item.html if home_item else "", home_dir, rel_to_name, "js")
        if not css_names:
            css_names = [a.name for a in rewritten if a.category == "css"]
        if not js_names:
            js_names = [a.name for a in rewritten if a.category == "js"]

        inner_css: list[str] = []
        inner_js: list[str] = []
        for h in htmls:
            if h.scope == "home":
                continue
            d = str(Path(h.rel_path).parent)
            if d == ".":
                d = ""
            for n in linked_asset_names(h.html, d, rel_to_name, "css"):
                if n not in css_names and n not in inner_css:
                    inner_css.append(n)
            for n in linked_asset_names(h.html, d, rel_to_name, "js"):
                if n not in js_names and n not in inner_js:
                    inner_js.append(n)
        extra = extra_asset_tags(inner_css, inner_js)

        home_inner = ensure_one_main(
            templatize_home(inner_of(pick_rep("home"))) or "<section><HY_SITE_HERO /></section>\n"
        )
        cat_inner = ensure_one_main(
            extra + (templatize_category(inner_of(pick_rep("category"))) if pick_rep("category") else templatize_category(""))
        )
        content_inner = ensure_one_main(
            extra + (
                templatize_content(inner_of(pick_rep("content"))) if pick_rep("content") else (
                    "<article>\n  <h1><HY_CONTENT_TITLE /></h1>\n  <HY_CONTENT_BODY />\n</article>\n"
                )
            )
        )
        site_html = build_site_layout(css_names, js_names)
        cat_rep = pick_rep("category")
        content_rep = pick_rep("content")
        specs = [
            ("site", "default", layout_display_name("default", "site"), site_html, "page", True),
            ("home", "default", layout_display_name("default", "home"), home_inner, "page", True),
            ("category", "default", layout_display_name("default", "category", cat_rep.html if cat_rep else ""), cat_inner, "page", True),
            ("content", "default", layout_display_name("default", "content", content_rep.html if content_rep else ""), content_inner, "page", True),
            ("partial", "header", "页头", header, "partial", False),
            ("partial", "footer", "页脚", footer, "partial", False),
        ]
        for scope, code, name, html, kind, is_def in specs:
            await add_layout(scope, code, name, html, kind, is_def, overwrite=True)

        grouped = group_htmls_by_category(htmls)
        named = 0
        for g, bucket in grouped.items():
            if g == "default":
                continue
            for scope in ("category", "content"):
                h = bucket.get(scope)
                if not h:
                    continue
                inner = inner_of(h)
                d = str(Path(h.rel_path).parent)
                if d == ".":
                    d = ""
                page_css = [n for n in linked_asset_names(h.html, d, rel_to_name, "css") if n not in css_names]
                page_js = [n for n in linked_asset_names(h.html, d, rel_to_name, "js") if n not in js_names]
                body = extra_asset_tags(page_css, page_js)
                body += templatize_category(inner) if scope == "category" else templatize_content(inner)
                name = layout_display_name(g, scope, h.html)
                await add_layout(scope, g, name[:128], ensure_one_main(body), "page", False, overwrite=True)
                named += 1
        if named:
            result.warnings.append(f"已按栏目分组额外创建 {named} 个列表/详情模板（每组 1 列表 + 1 详情，同栏目页面共用）")

    media_id = await _archive_source_zip_to_media(db, site, user, zip_bytes, source_filename)
    if media_id:
        result.warnings.append("源 ZIP 已保存到媒体库「压缩包」")
    else:
        result.warnings.append("源 ZIP 未能写入媒体库，导入结果不受影响")

    await db.commit()
    return result
