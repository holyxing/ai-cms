"""发布前检查 (P3.6.4)

发布前扫描相关 Layout HTML, 提取资源引用, 跟 site_assets 对比, 列出缺失项。
目的: 避免"发布成功后 404" —— 模板引用的资源不存在时, 发布 API 返回 422。

设计: 复用 AssetDependencyCard 的提取逻辑 (前端已有 24 个 case 单测),
后端用 Python re 重新实现 (与前端独立, 但语义一致)。

P3.6.4 API 行为:
- 缺失资源 → 抛 Unprocessable, data 里返 {missing: [{name, scope, layout_id, layout_code}]}
- 用户可 body.force=true 强制发布 (跳过检查, 风险自负)
"""
import re
import uuid
from dataclasses import dataclass, asdict
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.layout import Layout
from app.models.site_asset import SiteAsset


# === 提取器 (跟前端 AssetDependencyCard 语义一致) ===

# <link ... href="...">: 用 [\s\S] 兼容多行
LINK_HREF_RE = re.compile(r'<link\b[^>]*?href=["\']([^"\']*?)["\']', re.IGNORECASE)
SCRIPT_SRC_RE = re.compile(r'<script\b[^>]*?src=["\']([^"\']*?)["\']', re.IGNORECASE)
# <HY_ASSET_URL _name="x" /> 或 name="x" 或 裸 attr  <HY_ASSET_URL x />
HY_ASSET_RE = re.compile(r'<HY_ASSET_URL\b([^>]*?)\s*\/?>', re.IGNORECASE)
HY_NAME_RE = re.compile(r'(?:\b_name|\bname)\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)
# 裸 attr 提取: <HY_ASSET_URL x /> 但不能是 _name= 这种
HY_BARE_RE = re.compile(r'^<HY_ASSET_URL\s+([A-Za-z0-9._-]+)', re.IGNORECASE)
# P3.6.5+: 一键标签提取, 同 HY_ASSET_URL 公式
HY_SITE_TAG_RE = re.compile(r'<HY_SITE_(CSS|JS)\b([^>]*?)\s*\/?>', re.IGNORECASE)


def _is_likely_asset_name(name: str) -> bool:
    """合法的资源名: 字母数字开头, 含 ._- 1-128 字符"""
    return bool(re.match(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$', name))


# 模板系统的动态占位符 (P3.6.5): 全部 HY_* 都不要当资源
# 例: HY_PAGE_URL / HY_SITE_NAME / HY_PAGE_TITLE / HY_SITE_DESCRIPTION
HY_PLACEHOLDER_PREFIX = "HY_"


def _is_placeholder(name: str) -> bool:
    return name.startswith(HY_PLACEHOLDER_PREFIX)


def extract_asset_name(ref: str) -> str | None:
    """从 ref 字符串里提取一个有效资源名, 识别 3 种形式:
    - 'site.css' (直接文件名)
    - '<HY_ASSET_URL _name="x" />' (嵌套在 link href 里)
    - 'https://...' / '/static/main.css' (绝对, 跳过)
    """
    s = ref.strip()
    # 嵌套 HY_ASSET_URL: 先尝试 _name="x" 或 name='x' 形式
    m = HY_NAME_RE.search(s)
    if m:
        return m.group(1) if _is_likely_asset_name(m.group(1)) else None
    # 裸 attr: <HY_ASSET_URL x /> 整体作为 ref
    m2 = HY_BARE_RE.match(s)
    if m2:
        n = m2.group(1)
        if n not in ('_name', 'name') and _is_likely_asset_name(n):
            return n
        return None
    # 纯文件名
    s = s.split('?')[0].split('#')[0]
    if re.match(r'^(\/|https?:|data:)', s, re.IGNORECASE):
        return None
    if '/' in s:
        return None
    return s if _is_likely_asset_name(s) else None


def extract_references(html: str) -> list[tuple[str, str]]:
    """返 [(name, source)] 列表, source ∈ {link, script, hy}.
    嵌套 HY_ASSET_URL (link href 里) 不再额外加 link 条目, 由 #3 抓 hy 一次.
    """
    out: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()

    def add(name: str, src: str) -> None:
        key = (name, src)
        if key not in seen:
            seen.add(key)
            out.append(key)

    if not html:
        return out

    # 1. <link href="...">
    for m in LINK_HREF_RE.finditer(html):
        ref = m.group(1)
        if '<HY_ASSET_URL' in ref:
            continue  # 嵌套, 让 #3 抓
        name = extract_asset_name(ref)
        if name and not _is_placeholder(name):
            add(name, 'link')

    # 2. <script src="...">
    for m in SCRIPT_SRC_RE.finditer(html):
        ref = m.group(1)
        if '<HY_ASSET_URL' in ref:
            continue
        name = extract_asset_name(ref)
        if name and not _is_placeholder(name):
            add(name, 'script')

    # 3. <HY_ASSET_URL ...> (任何位置)
    for m in HY_ASSET_RE.finditer(html):
        attrs = m.group(1)
        named = HY_NAME_RE.search(attrs)
        if named:
            name = named.group(1)
            # HY_ 前缀的 _name="..." 是合法的 (例 _name="HY_SITE_FAVICON"),
            # 但其他 HY_ 开头的值是模板占位符, 不应被识别为资源
            if _is_likely_asset_name(name) and not name.startswith(HY_PLACEHOLDER_PREFIX + 'ASSET'):
                add(name, 'hy')
            continue
        # 裸 attr
        bare_match = re.match(r'^\s*([A-Za-z0-9._-]+)\s*$', attrs)
        if bare_match:
            n = bare_match.group(1)
            if n not in ('_name', 'name') and _is_likely_asset_name(n):
                add(n, 'hy')

    # 4. P3.6.5+: <HY_SITE_CSS /> / <HY_SITE_JS /> — 一键全目录标签
    # 提 _include / _exclude 中点名的具体资源, 跟 <HY_ASSET_URL> 一样检查
    for tag_pat in HY_SITE_TAG_RE.finditer(html):
        attrs = tag_pat.group(2)
        include = re.search(r'\b_include\s*=\s*["\']([^"\']*)["\']', attrs)
        exclude = re.search(r'\b_exclude\s*=\s*["\']([^"\']*)["\']', attrs)
        inc_set = {x.strip() for x in include.group(1).split(",") if x.strip()} if include else None
        exc_set = {x.strip() for x in exclude.group(1).split(",") if x.strip()} if exclude else set()
        for n in (inc_set or set()):
            if n and not _is_placeholder(n):
                add(n, 'hy')
        for n in exc_set:
            if n and not _is_placeholder(n):
                add(n, 'hy')

    return out


# === 检查 ===

@dataclass
class MissingAsset:
    """发布前检查发现的缺失资源"""
    name: str
    source: str  # link / script / hy
    layout_id: str
    layout_code: str
    layout_scope: str  # site / category / content / home

    def to_dict(self) -> dict:
        return asdict(self)


async def _list_site_asset_names(db: AsyncSession, site_id: uuid.UUID) -> set[str]:
    """列出站点所有已上传资源名 (1 个查询, 避免 N+1)"""
    r = await db.execute(
        select(SiteAsset.name).where(SiteAsset.site_id == site_id)
    )
    return {row[0] for row in r.all()}


async def _list_layout_htmls(
    db: AsyncSession, site_id: uuid.UUID, scopes: Iterable[str]
) -> list[Layout]:
    """列出指定 scope 集合的所有 Layout (deleted_at IS NULL, 含 default + 非 default)"""
    r = await db.execute(
        select(Layout).where(
            Layout.site_id == site_id,
            Layout.scope.in_(list(scopes)),
            Layout.deleted_at.is_(None),
        )
    )
    return list(r.scalars().all())


async def check_missing_assets_for_site_publish(
    db: AsyncSession, site_id: uuid.UUID
) -> list[MissingAsset]:
    """整站发布: 检查所有 scope (site / category / content / home)

    一次拿所有 layout HTML, 一次拿所有 asset 名 → 内存 O(1) 交叉
    """
    layouts = await _list_layout_htmls(
        db, site_id, scopes=('site', 'category', 'content', 'home')
    )
    asset_names = await _list_site_asset_names(db, site_id)
    return _scan_layouts_for_missing(layouts, asset_names)


async def check_missing_assets_for_category_publish(
    db: AsyncSession, site_id: uuid.UUID, category_id: uuid.UUID
) -> list[MissingAsset]:
    """栏目发布: 检查 site + 站点 category scope 的所有 layout

    (栏目页都走 Layout(scope='category'), 跟具体栏目无关 — 该 category 的内容
    都会用这些 layout 渲染)
    """
    layouts = await _list_layout_htmls(db, site_id, scopes=('site', 'category'))
    asset_names = await _list_site_asset_names(db, site_id)
    return _scan_layouts_for_missing(layouts, asset_names)


async def check_missing_assets_for_content_publish(
    db: AsyncSession, site_id: uuid.UUID, content_id: uuid.UUID
) -> list[MissingAsset]:
    """文章发布: 检查 site + 该文章所属栏目对应的 content scope layouts

    简化: 拿 site + 全部 content scope layouts (跟栏目一样复用)
    """
    layouts = await _list_layout_htmls(db, site_id, scopes=('site', 'content'))
    asset_names = await _list_site_asset_names(db, site_id)
    return _scan_layouts_for_missing(layouts, asset_names)


def _scan_layouts_for_missing(
    layouts: list[Layout], asset_names: set[str]
) -> list[MissingAsset]:
    """扫所有 layout HTML, 收集缺失资源 (去重)"""
    out: list[MissingAsset] = []
    seen: set[tuple[str, str, str]] = set()  # (name, source, layout_id)
    for layout in layouts:
        refs = extract_references(layout.html or '')
        for name, source in refs:
            if name in asset_names:
                continue
            key = (name, source, str(layout.id))
            if key in seen:
                continue
            seen.add(key)
            out.append(MissingAsset(
                name=name, source=source,
                layout_id=str(layout.id),
                layout_code=layout.code,
                layout_scope=layout.scope,
            ))
    # 排序: 名字 → source → layout
    out.sort(key=lambda m: (m.name, m.source, m.layout_id))
    return out
