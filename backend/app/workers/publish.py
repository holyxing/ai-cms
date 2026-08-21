"""P2 发布任务 (Celery worker)

依据: docs/12-P2-决策.md §B6 (全量构建) + §C4 (后台任务) + §D1 (worker 内置 Node) +
      §E1 (build_log 64KB) + §E2 (10min 超时) + §E3 (worker 资源隔离) + §E4 (失败重试)

P2 范围: 同步构建到 /data/sites/{site_id}/public/ (Astro CLI)
P2.5: 接 Celery Beat (scheduled_publishes)

任务流 (run_publish):
1. 拉 deployment 记录
2. 状态 → building, started_at = now
3. 拉当前 active theme_version tokens
4. 拉所有 published contents, 生成 content_snapshots
5. 调用 Astro CLI: subprocess.run(['npx', 'astro', 'build'])
   - 注入 token 到 _template 的 theme.css
   - 注入 content data 到 _template/src/data/site.json
6. 状态 → success, finished_at, duration_ms, artifact_size
7. 失败 → 状态 → failed, error_message + build_log (后 64KB)
8. 失败且 retry_count < 1 → 重新入队 (E4 自动重试 1 次)

注: P2 起步不调 astro CLI (还没装 node + astro 依赖), 走 "P2 sync 兼容" 模式
    只写 content_snapshots, 写占位 artifact_path, build_log 写 "[Day 3 stub mode]"
    Day 3.5 接 astro 改 subprocess.run
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import traceback
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.workers.celery_app import celery_app
from app.core.config import get_settings
from app.db.session import AsyncSessionLocal
from app.models.content import Content, ContentVersion
from app.models.content_snapshot import ContentSnapshot
from app.models.category import Category
from app.models.deployment import Deployment
from app.models.site import Site
from app.models.theme import Theme
from app.models.theme_version import ThemeVersion
from app.models.layout import Layout

settings = get_settings()

# E2 决策: 10 分钟超时
TASK_SOFT_TIME_LIMIT = 540
TASK_TIME_LIMIT = 600

# E1 决策: build_log 尾部 64KB
BUILD_LOG_MAX_BYTES = 64 * 1024

# 站点构建产物路径 (用 slug, URL 友好; B5 简化)
def artifact_dir(site_slug: str) -> str:
    return f"/data/sites/{site_slug}/public"


# === 工具函数 ===
def _truncate_log(text: str, max_bytes: int = BUILD_LOG_MAX_BYTES) -> str:
    """保留尾部 N 字节, UTF-8 安全"""
    if not text:
        return ""
    encoded = text.encode("utf-8", errors="replace")
    if len(encoded) <= max_bytes:
        return text
    # 找到 max_bytes 处的字符边界
    truncated = encoded[-max_bytes:]
    # 跳过可能不完整的首字符
    while truncated and (truncated[0] & 0xC0) == 0x80:
        truncated = truncated[1:]
    return "...[truncated]...\n" + truncated.decode("utf-8", errors="replace")


async def _write_content_snapshots(db: AsyncSession, site_id: str, deployment_id: str) -> int:
    """写 content_snapshots, 返回写入条数"""
    r = await db.execute(
        select(Content).where(
            Content.site_id == site_id, Content.status == "published", Content.deleted_at.is_(None)
        )
    )
    contents = r.scalars().all()
    written = 0
    # P3.8.9: 同步 published_at (对于老 seed 数据 / 异常状态, 兑底 updated_at/created_at/now)
    from sqlalchemy import update as _upd
    from datetime import timezone as _tz
    from datetime import datetime as _dt
    now_utc = _dt.now(_tz.utc)
    for c in contents:
        if c.published_at is None:
            fallback = c.updated_at or c.created_at or now_utc
            if fallback.tzinfo is None:
                fallback = fallback.replace(tzinfo=_tz.utc)
            c.published_at = fallback
    for c in contents:
        exist = (await db.execute(
            select(ContentSnapshot).where(
                ContentSnapshot.content_id == c.id,
                ContentSnapshot.deployment_id == deployment_id,
            )
        )).scalar_one_or_none()
        if exist:
            continue
        # body 读 published_version_id 或最新 version
        version = None
        if c.published_version_id:
            version = await db.get(ContentVersion, c.published_version_id)
        if version is None:
            r2 = await db.execute(
                select(ContentVersion)
                .where(ContentVersion.content_id == c.id)
                .order_by(ContentVersion.version_num.desc())
                .limit(1)
            )
            version = r2.scalar_one_or_none()
        if version is None:
            continue
        body_html = version.body or ""
        body_json = {}
        if body_html and body_html.strip().startswith("{"):
            try:
                body_json = json.loads(body_html)
            except Exception:
                body_json = {}
        db.add(ContentSnapshot(
            content_id=c.id,
            deployment_id=deployment_id,
            version_id=version.id,
            title=c.title,
            slug=c.slug,
            body_html=body_html,
            body_json=body_json,
            taxonomy_paths={},
            published_at=c.published_at or datetime.now(timezone.utc),
        ))
        written += 1
    return written


async def _run_layout_build(db: AsyncSession, site: Site, contents: list) -> tuple[str, int, str]:
    """D5: 走 LayoutRenderer 路径 (D4 build_site + DiskWriter)

    代替 P2 stub 模式 (不需 Node + Astro 依赖)。
    P2.5 装 Node 后, 这个函数仅负责 生产 PageFile, 调 astro build 走 _run_astro_build。

    Returns:
        (build_log, artifact_size, status)
    """
    from app.models.layout import Layout
    from app.models.category import Category
    from app.models.site_asset import SiteAsset, public_relpath
    from app.models.media import Media
    from app.services.disk_writer import build_and_write
    log_lines = [f"[layout-build] start site={site.id} slug={site.slug}"]
    # P3.6.2: 加载站点静态资源 (HY_ASSET_URL 用)
    asset_urls: dict[str, str] = {}
    r_assets = await db.execute(
        select(SiteAsset).where(SiteAsset.site_id == site.id)
    )
    site_assets = r_assets.scalars().all()
    for a in site_assets:
        asset_urls[a.name] = public_relpath(a)
    if site_assets:
        log_lines.append(f"[layout-build] found {len(site_assets)} site assets: {list(asset_urls.keys())}")
    # 拉所有 layouts (P3.6.1: 不只 default, 栏目可能选 news-list 等)
    # P3.7+: 只拉启用的, 禁用模板的 code 不会被 HY_TEMPLATE 解析到
    r = await db.execute(
        select(Layout).where(
            Layout.site_id == site.id,
            Layout.deleted_at.is_(None),
            Layout.is_active.is_(True),
        )
    )
    layouts = r.scalars().all()
    log_lines.append(f"[layout-build] found {len(layouts)} default layouts")
    # 拉所有非删除栏目
    r2 = await db.execute(
        select(Category).where(
            Category.site_id == site.id,
            Category.deleted_at.is_(None),
        )
    )
    cats = r2.scalars().all()
    log_lines.append(f"[layout-build] found {len(cats)} categories")
    # P3.7.2 方案 B: 菜单功能已删, 不再读 site.settings.menu_*
    base_url = ""  # 留空走相对路径 /{slug}/
    menus_rendered: dict[str, str] = {}  # 字段保留兼容
    # P3.6.5+: HY_SITE_CSS / HY_SITE_JS 一键标签用 — 按 category 分组
    # 在 base_url 赋值后填充, 走同一 base_url 拼公开 URL
    assets_by_category: dict[str, list[dict[str, str]]] = {"css": [], "js": [], "assets": []}
    # 公开 URL = ZIP 相对路径 (css/main.css, assets/images/x.webp)
    for a in site_assets:
        url = public_relpath(a)
        assets_by_category.setdefault(a.category, []).append({
            "name": a.name, "url": url, "content_type": a.content_type,
        })
    for cat in assets_by_category.values():
        cat.sort(key=lambda x: x["name"])
    # HY_MEDIA：媒体库 id → 公开 URL（发布后会 inline 到 assets/）
    media_urls: dict[str, str] = {}
    r_media = await db.execute(
        select(Media).where(
            Media.site_id == site.id,
            Media.deleted_at.is_(None),
        )
    )
    for m in r_media.scalars().all():
        media_urls[str(m.id)] = f"/media/{m.object_key}"
    if media_urls:
        log_lines.append(f"[layout-build] found {len(media_urls)} media for HY_MEDIA")
    settings_json = site.settings or {}
    # P3.7.2 方案 B: 菜单功能删除, 不再读 site.settings.menu_*
    # HY_SITE_MENU 标签在 layout_renderer 中保留兼容 (已无 menu 数据, 标签渲染为空)
    # 计算输出目录
    output_dir = f"{settings.SITES_DATA_DIR}/{site.slug}/public"
    # 调 D4 build_site + DiskWriter
    try:
        pages, total = build_and_write(
            site=site, cats=cats, contents=contents, layouts=layouts,
            base_url=base_url,
            output_dir=output_dir,
            build_id=str(site.id),
            clean_before=True,
            menus_rendered=menus_rendered,
            asset_urls=asset_urls,
            assets_by_category=assets_by_category,  # P3.6.5+: HY_SITE_CSS/JS
            media_urls=media_urls,
        )
        log_lines.append(f"[layout-build] wrote {len(pages)} pages, {total} bytes to {output_dir}")
        # P3.9.4+ (holy 反馈 #12096 续): 静态发布图片真静态化 - 下载 /media/ → assets/, 改写 <img src>
        try:
            d_count, k_count, ml = _inline_content_media(output_dir)
            log_lines.extend(ml)
        except Exception as e:
            log_lines.append(f"[media-inline] failed: {e}")
        # P3.6.2: 复制 site_assets 到 public/assets/ (让 nginx 公开可访问)
        if site_assets:
            copied = _copy_assets_to_public(list(site_assets), output_dir)
            log_lines.append(f"[layout-build] copied {copied}/{len(site_assets)} assets to {output_dir}/assets")
        return ("\n".join(log_lines)), total, "layout-success"
    except Exception as e:
        log_lines.append(f"[layout-build] failed: {e}\n{traceback.format_exc()}")
        return ("\n".join(log_lines)), 0, "layout-failed"


def _copy_assets_to_public(site_assets, output_dir: str) -> int:
    """按 ZIP 相对路径复制到 {output_dir}/{rel_path}

    例: css/main.css → public/css/main.css
        assets/images/banners/hero.webp → public/assets/images/banners/hero.webp
    旧数据（无 ZIP 路径）仍落到 public/assets/{name}。

    文件不存在时静默跳过。返回成功复制数。
    """
    import shutil
    from app.models.site_asset import public_relpath
    if not site_assets:
        return 0
    copied = 0
    for a in site_assets:
        file_path = getattr(a, "file_path", None)
        name = getattr(a, "name", None)
        if not (file_path and name):
            continue
        if not os.path.isfile(file_path):
            continue
        rel = public_relpath(a)
        if ".." in rel.split("/"):
            continue
        dest = os.path.join(output_dir, rel)
        os.makedirs(os.path.dirname(dest) or output_dir, exist_ok=True)
        shutil.copy2(file_path, dest)
        copied += 1
    return copied


def _inline_content_media(output_dir: str) -> tuple[int, int, list[str]]:
    """P3.9.4+ (holy 反馈 #12096 续): 静态发布图片真静态化

    扫 output_dir 下所有 *.html, 提取 <img src="/media/..."> 引用,
    boto3 从 MinIO 拉到 {output_dir}/assets/{basename}, 改写 src 为 assets/{basename}。
    发布产物真正离线可看, 不再依赖 nginx → MinIO 反代。

    重复 URL 共享同一份本地文件 (去重)。

    Returns:
        (downloaded, html_files_modified, log_lines)
    """
    from app.core.config import get_settings
    import boto3

    cfg = get_settings()
    log: list[str] = []
    if not os.path.isdir(output_dir):
        log.append(f"[media-inline] output_dir not found: {output_dir}")
        return (0, 0, log)

    # 扫所有 html
    html_files = []
    for root, _, files in os.walk(output_dir):
        for f in files:
            if f.endswith(".html"):
                html_files.append(os.path.join(root, f))
    if not html_files:
        log.append(f"[media-inline] no html files in {output_dir}")
        return (0, 0, log)

    # 正则: <img src="/media/path/...png(?query)?" ...>
    img_re = re.compile(
        r'(<img\b[^>]*?\bsrc=["\'])(/media/[^"\']+)(["\'])',
        re.IGNORECASE,
    )

    # 1) 先收集所有去重后的 (key, src)
    seen: dict[str, str] = {}  # key -> src (MinIO 上的对象 key, 去 ?query)
    file_uses: dict[str, list[tuple[str, str, str, str]]] = {}  # key -> [(file, full_match, prefix, suffix)]
    for fpath in html_files:
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                html = f.read()
        except Exception:
            continue
        for m in img_re.finditer(html):
            full = m.group(0)
            prefix, src, suffix = m.group(1), m.group(2), m.group(3)
            # src 形如 /media/sites/.../2026/06/foo.png?X-Amz-...  → 剥 query
            key = src[len("/media/"):].split("?", 1)[0]
            if not key:
                continue
            seen.setdefault(key, src)
            file_uses.setdefault(key, []).append((fpath, full, prefix, suffix))

    if not seen:
        log.append(f"[media-inline] no /media/ images in {len(html_files)} htmls")
        return (0, 0, log)

    # 2) boto3 下载所有去重后的对象 → output_dir/assets/{basename}
    s3 = boto3.client(
        "s3",
        endpoint_url=f"http://{cfg.MINIO_ENDPOINT}",
        aws_access_key_id=cfg.MINIO_ACCESS_KEY,
        aws_secret_access_key=cfg.MINIO_SECRET_KEY,
        region_name="us-east-1",
    )
    assets_out = os.path.join(output_dir, "assets")
    os.makedirs(assets_out, exist_ok=True)
    downloaded = 0
    skipped = 0
    for key, src in seen.items():
        basename = os.path.basename(key)
        # 去 query 后的 key 已不含非法字符, 跟原始对象一致
        local = os.path.join(assets_out, basename)
        if os.path.isfile(local) and os.path.getsize(local) > 0:
            # 已存在, 复用 (避免跨页面重复下载)
            skipped += 1
        else:
            try:
                obj = s3.get_object(Bucket=cfg.MINIO_BUCKET, Key=key)
                with open(local, "wb") as out:
                    out.write(obj["Body"].read())
                downloaded += 1
            except Exception as e:
                log.append(f"[media-inline] failed to download {key}: {e}")
                continue
        # 3) 改写所有引用此 key 的 html: src="/media/...?" → src="assets/{basename}"
        new_src = f"assets/{basename}"
        for fpath, full, prefix, suffix in file_uses[key]:
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    html = f.read()
                new_html = html.replace(full, f"{prefix}{new_src}{suffix}", 1)
                if new_html != html:
                    with open(fpath, "w", encoding="utf-8") as f:
                        f.write(new_html)
            except Exception as e:
                log.append(f"[media-inline] failed to rewrite {fpath}: {e}")

    modified_files = sum(1 for uses in file_uses.values() for _ in uses)  # 总替换数
    log.append(
        f"[media-inline] downloaded={downloaded} reused={skipped} "
        f"unique_keys={len(seen)} rewrites={modified_files} -> {assets_out}"
    )
    return (downloaded, len(file_uses), log)


async def _run_astro_build(site: Site, tokens: dict, contents_data: list) -> tuple[str, int, str]:
    """调 Astro CLI 生成静态产物

    P2 起步 (没装 node): 返回 stub 状态
    P2.5: 真接 astro build

    返回: (build_log, artifact_size, status)
    """
    # === P2 起步: stub 模式 ===
    if not getattr(settings, "ASTRO_ENABLED", False):
        log = (
            f"[P2 stub mode] site={site.id} slug={site.slug}\n"
            f"[P2 stub mode] would build astro for {len(contents_data)} contents\n"
            f"[P2 stub mode] tokens.color.primary = {tokens.get('color', {}).get('primary', 'n/a')}\n"
            f"[P2 stub mode] artifact would be at {artifact_dir(str(site.id))}\n"
            f"[Day 3.5] enable ASTRO_ENABLED=true to run real `npx astro build`"
        )
        return log, 0, "stub"

    # === P2.5: 真构建 ===
    # 1. 复制 _template 到 /tmp/build/{site_id}/
    # 2. 注入 tokens 到 theme.css
    # 3. 注入 contents_data 到 src/data/site.json
    # 4. subprocess.run(['npx', 'astro', 'build'], cwd=tmp_dir)
    # 5. 复制 dist/ 到 /data/sites/{site_id}/public/
    # 6. 算 artifact_size
    tmp_dir = f"/tmp/astro_build/{site.id}"
    # 用 site.slug 作为公开路径 (B5 简化版, URL 友好)
    target_dir = f"{settings.SITES_DATA_DIR}/{site.slug}/public"

    # 清理 + 复制模板 (ignore node_modules, 后面 symlink)
    shutil.rmtree(tmp_dir, ignore_errors=True)
    shutil.copytree(
        settings.SSG_TEMPLATE_DIR,
        tmp_dir,
        ignore=shutil.ignore_patterns("node_modules", "dist", ".astro"),
    )
    # symlink 共享 node_modules (避免每个 build 重新 install)
    src_nm = os.path.join(settings.SSG_TEMPLATE_DIR, "node_modules")
    if os.path.isdir(src_nm):
        os.symlink(src_nm, os.path.join(tmp_dir, "node_modules"))

    # 注入 tokens 到 theme.css
    theme_css_path = os.path.join(tmp_dir, "src/styles/theme.css")
    if os.path.exists(theme_css_path):
        with open(theme_css_path, "r", encoding="utf-8") as f:
            css = f.read()
        # 替换 :root { ... } 里的变量
        new_vars = []
        for k, v in (tokens.get("color") or {}).items():
            new_vars.append(f"  --color-{k}: {v};")
        for k, v in (tokens.get("typography", {}).get("fontFamily") or {}).items():
            new_vars.append(f"  --font-{k}: {v};")
        for k, v in (tokens.get("typography", {}).get("fontSize") or {}).items():
            new_vars.append(f"  --text-{k}: {v};")
        for k, v in (tokens.get("spacing") or {}).items():
            new_vars.append(f"  --space-{k}: {v};")
        for k, v in (tokens.get("radius") or {}).items():
            new_vars.append(f"  --radius-{k}: {v};")
        css = re.sub(
            r":root\s*\{[^}]*\}",
            ":root {\n" + "\n".join(new_vars) + "\n}",
            css,
            count=1,
        )
        with open(theme_css_path, "w", encoding="utf-8") as f:
            f.write(css)

    # 注入 contents_data 到 src/data/site.json
    site_data_path = os.path.join(tmp_dir, "src/data/site.json")
    payload = {
        "site": {
            "id": str(site.id),
            "slug": site.slug,
            "name": site.name,
            "description": site.description,
        },
        "contents": contents_data,
        "last_build": datetime.now(timezone.utc).isoformat(),
    }
    with open(site_data_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    # 跑 npx astro build
    log_lines = [f"[astro] start build site={site.id}"]
    try:
        proc = subprocess.run(
            settings.ASTRO_BUILD_CMD.split(),
            cwd=tmp_dir,
            capture_output=True,
            text=True,
            timeout=settings.ASTRO_TIMEOUT_SECONDS,
        )
        log_lines.append(f"[astro] stdout:\n{proc.stdout[:8192]}")
        if proc.stderr:
            log_lines.append(f"[astro] stderr:\n{proc.stderr[:4096]}")
        if proc.returncode != 0:
            return ("\n".join(log_lines), 0, "failed")
    except subprocess.TimeoutExpired:
        log_lines.append(f"[astro] timeout after {settings.ASTRO_TIMEOUT_SECONDS}s")
        return ("\n".join(log_lines), 0, "failed")
    except FileNotFoundError as e:
        log_lines.append(f"[astro] npx not found: {e}")
        return ("\n".join(log_lines), 0, "failed")

    # 复制 dist/ 到 SITES_DATA_DIR/{site_id}/public/
    src_dist = os.path.join(tmp_dir, "dist")
    if not os.path.isdir(src_dist):
        log_lines.append(f"[astro] dist/ not found at {src_dist}")
        return ("\n".join(log_lines), 0, "failed")

    shutil.rmtree(target_dir, ignore_errors=True)
    shutil.copytree(src_dist, target_dir)
    # chmod 644 文件 / 755 目录, 让 nginx user (uid 101) 可读
    for root, dirs, files in os.walk(target_dir):
        os.chmod(root, 0o755)
        for fn in files:
            try:
                os.chmod(os.path.join(root, fn), 0o644)
            except OSError:
                pass

    # 算 artifact_size
    total = 0
    for root, _, files in os.walk(target_dir):
        for fn in files:
            try:
                total += os.path.getsize(os.path.join(root, fn))
            except OSError:
                pass

    log_lines.append(f"[astro] ok: {total} bytes at {target_dir}")
    return ("\n".join(log_lines), total, "success")


# === Celery 任务入口 ===
@celery_app.task(
    name="app.workers.publish.run",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    soft_time_limit=TASK_SOFT_TIME_LIMIT,
    time_limit=TASK_TIME_LIMIT,
)
def run_publish(self, deployment_id: str) -> dict:
    """Celery 任务: 跑一次部署

    Args:
        deployment_id: UUID 字符串

    Returns:
        {"deployment_id": ..., "status": "success|failed", "duration_ms": ...}
    """
    return _run_with_loop(deployment_id, retry_count=self.request.retries)


def _run_with_loop(deployment_id: str, retry_count: int = 0) -> dict:
    """在独立 event loop 中跑 async 任务 (避免 Celery worker 所在 loop 冲突)
    Celery 同步任务不能直接 await, 需要起独立 loop
    每个任务 dispose 旧 engine, 避免 asyncpg connection 跨 loop

    任务完成后再次 dispose, 主动关闭所有 asyncpg 连接, 避免连接延后 GC
    时 loop 已关报 'Event loop is closed' (P3.6.2 beat 任务踩过的坑)
    """
    from app.db.session import engine
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        # 丢弃 worker 启动时创建的连接池, 让新 loop 重新创建
        try:
            loop.run_until_complete(engine.dispose())
        except Exception:
            pass
        result = loop.run_until_complete(_run_publish_async(deployment_id, retry_count))
        # 任务完成后再次 dispose, 主动关闭连接
        try:
            loop.run_until_complete(engine.dispose())
        except Exception:
            pass
        return result
    finally:
        loop.close()


async def _run_publish_async(deployment_id: str, retry_count: int = 0) -> dict:
    """真正的异步实现"""
    async with AsyncSessionLocal() as db:
        d = await db.get(Deployment, deployment_id)
        if d is None:
            return {"error": f"deployment {deployment_id} not found"}
        if d.status == "success":
            return {"deployment_id": deployment_id, "status": "success", "skipped": "already success"}
        site = await db.get(Site, d.site_id)
        if site is None:
            return {"error": f"site {d.site_id} not found"}

        # 拉 theme_version tokens
        tokens = {}
        if d.theme_version_id:
            tv = await db.get(ThemeVersion, d.theme_version_id)
            if tv:
                tokens = tv.tokens or {}

        # 状态 building
        d.status = "building"
        d.started_at = datetime.now(timezone.utc)
        await db.commit()

        build_log = ""
        try:
            # 1. 写 content_snapshots
            written = await _write_content_snapshots(db, str(site.id), str(d.id))
            await db.commit()

            # 2. 准备 contents (供 layout-build 用, 有 ORM 关系)
            published_contents = (await db.execute(
                select(Content).where(Content.site_id == site.id, Content.status == "published", Content.deleted_at.is_(None))
            )).scalars().all()
            await _attach_body_html(db, published_contents)
            # 3. 选路径: LAYOUT_BUILD (D5) > ASTRO (P2.5) > stub (P2)
            if getattr(settings, "LAYOUT_BUILD_ENABLED", True) and not getattr(settings, "ASTRO_ENABLED", False):
                log, artifact_size, build_status = await _run_layout_build(db, site, list(published_contents))
            else:
                contents_data = [{"id": str(c.id), "title": c.title, "slug": c.slug} for c in published_contents]
                log, artifact_size, build_status = await _run_astro_build(site, tokens, contents_data)
            build_log += log
            if build_status == "layout-failed":
                raise RuntimeError(log)
            now = datetime.now(timezone.utc)
            d.status = "success"
            d.finished_at = now
            d.duration_ms = int((now - d.started_at).total_seconds() * 1000)
            d.content_count = written
            d.artifact_path = f"{settings.SITES_DATA_DIR}/{site.slug}/public"
            d.artifact_size = artifact_size
            d.build_log = _truncate_log(build_log)
            d.retry_count = retry_count
            await db.commit()
            # P2.6: 回写 site.publish_status
            from app.services.publish_status import recompute_and_persist
            try:
                await recompute_and_persist(db, site.id)
            except Exception as e:
                logger.warning(f"recompute publish_status failed: {e}")
            try:
                from app.services.notifications import notify_publish_finished
                await notify_publish_finished(db, d)
                await db.commit()
            except Exception as e:
                logger.warning(f"notify publish success failed: {e}")
            return {
                "deployment_id": deployment_id, "status": "success",
                "duration_ms": d.duration_ms, "content_count": written,
                "build_status": build_status,
            }
        except Exception as e:
            now = datetime.now(timezone.utc)
            build_log += f"\n[ERROR] {type(e).__name__}: {e}\n{traceback.format_exc()}"
            d.status = "failed"
            d.finished_at = now
            d.duration_ms = int((now - d.started_at).total_seconds() * 1000) if d.started_at else None
            d.error_message = str(e)[:1000]
            d.build_log = _truncate_log(build_log)
            d.retry_count = retry_count
            await db.commit()
            # P2.6: 失败也要回写 (可能是 failed 状态)
            from app.services.publish_status import recompute_and_persist
            try:
                await recompute_and_persist(db, site.id)
            except Exception as e:
                logger.warning(f"recompute publish_status failed: {e}")
            # E4: 失败时自动重试 1 次
            will_retry = retry_count < 1
            if will_retry:
                # 重新入队 (1 次)
                run_publish.apply_async(args=[deployment_id], retry=True)
            else:
                try:
                    from app.services.notifications import notify_publish_finished
                    await notify_publish_finished(db, d)
                    await db.commit()
                except Exception as ne:
                    logger.warning(f"notify publish fail failed: {ne}")
            return {
                "deployment_id": deployment_id, "status": "failed",
                "error": str(e)[:200], "retry_scheduled": will_retry,
            }


# ============================================================
# P3.6.1+: 栏目级 / 文章级发布任务
# ============================================================
def _mark_orphan_deployment(deployment_id: str, error_msg: str) -> None:
    """任务入口失败 (NameError / DB 不可用 / uuid 解析失败等) 时, 把 deployment 标 failed

    否则会卡在 pending 永远没人清, 站点 publish_status 永远 building
    """
    import asyncio as _asyncio
    from app.db.session import AsyncSessionLocal as _AS
    from datetime import datetime as _dt, timezone as _tz
    async def _do():
        try:
            did = uuid.UUID(deployment_id)
        except Exception:
            logger.error(f"orphan mark: invalid deployment_id {deployment_id!r}")
            return
        async with _AS() as db:
            d = await db.get(Deployment, did)
            if d is None:
                return
            if d.status in ("pending", "building"):
                d.status = "failed"
                d.finished_at = _dt.now(_tz.utc)
                d.error_message = f"Worker entry failure: {error_msg[:1000]}"
                await db.commit()
                logger.warning(f"orphan deployment {d.id} marked failed (entry failure)")
    try:
        _asyncio.run(_do())
    except Exception as e:
        logger.error(f"orphan mark itself failed: {e}")


@celery_app.task(
    name="app.workers.publish.run_publish_category",
    bind=True, acks_late=True, reject_on_worker_lost=True,
    soft_time_limit=TASK_SOFT_TIME_LIMIT, time_limit=TASK_TIME_LIMIT,
)
def run_publish_category(self, deployment_id: str) -> dict:
    """Celery 任务: 栏目级发布 (只重 build 该栏目页, 其他文件保留)"""
    # 用与 run_publish 一致的独立 loop, 避免 celery event loop 冲突
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        from app.db.session import engine
        try:
            loop.run_until_complete(engine.dispose())
        except Exception:
            pass
        return loop.run_until_complete(_run_publish_partial(deployment_id, scope="category"))
    except Exception as e:
        # 入口失败 (NameError / uuid 解析 / DB 不可用等) 也会让 deployment 卡 pending
        # 显式标 failed + 记录
        logger.error(f"run_publish_category entry crashed: {type(e).__name__}: {e}\n{traceback.format_exc()}")
        _mark_orphan_deployment(deployment_id, f"{type(e).__name__}: {e}")
        return {"deployment_id": deployment_id, "status": "failed", "error": f"{type(e).__name__}: {e}"}
    finally:
        try:
            loop.close()
        except Exception:
            pass


@celery_app.task(
    name="app.workers.publish.run_publish_content",
    bind=True, acks_late=True, reject_on_worker_lost=True,
    soft_time_limit=TASK_SOFT_TIME_LIMIT, time_limit=TASK_TIME_LIMIT,
)
def run_publish_content(self, deployment_id: str) -> dict:
    """Celery 任务: 文章级发布 (只重 build 该文章详情页 + 所属栏目页)"""
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        from app.db.session import engine
        try:
            loop.run_until_complete(engine.dispose())
        except Exception:
            pass
        return loop.run_until_complete(_run_publish_partial(deployment_id, scope="content"))
    except Exception as e:
        logger.error(f"run_publish_content entry crashed: {type(e).__name__}: {e}\n{traceback.format_exc()}")
        _mark_orphan_deployment(deployment_id, f"{type(e).__name__}: {e}")
        return {"deployment_id": deployment_id, "status": "failed", "error": f"{type(e).__name__}: {e}"}
    finally:
        try:
            loop.close()
        except Exception:
            pass


async def _run_publish_partial(deployment_id: str, scope: str) -> dict:
    """栏目级 / 文章级发布的内部实现 (复用 run_publish 的 build pipeline)

    区别:
    - build_and_write 不清空输出目录 (clean_before=False)
    - 只重 build 该 scope 涉及的页面 (其他文件保留)
    - deployment.scope / scope_id 已经在 API 层填好
    """
    from app.services.disk_writer import DiskWriter
    from app.services.page_renderer import build_site
    from app.models.content import Content
    from app.models.category import Category

    async with AsyncSessionLocal() as db:
        d = await db.get(Deployment, uuid.UUID(deployment_id))
        if d is None:
            return {"deployment_id": deployment_id, "status": "failed", "error": "deployment 不存在"}
        d.status = "building"
        d.started_at = datetime.now(timezone.utc)
        await db.commit()

        retry_count = d.retry_count
        log_lines = [f"[{scope}-publish] start deployment={d.id} site={d.site_id}"]

        try:
            site = await db.get(Site, d.site_id)
            if site is None:
                raise RuntimeError(f"site {d.site_id} 不存在")
            # 拉所有 layouts (栏目级发布仍要拉所有, 因为 site/home/category scope 都要重新 wrap)
            # P3.7+: 只拉启用的
            r = await db.execute(
                select(Layout).where(
                    Layout.site_id == site.id,
                    Layout.deleted_at.is_(None),
                    Layout.is_active.is_(True),
                )
            )
            layouts = r.scalars().all()
            # 拉所有 categories
            r2 = await db.execute(
                select(Category).where(Category.site_id == site.id, Category.deleted_at.is_(None))
            )
            cats = r2.scalars().all()
            # P3.7.2 方案 B: 菜单功能删除, 不再读 site.settings.menu_*
            base_url = ""
            menus_rendered: dict[str, str] = {}

            from app.models.site_asset import SiteAsset, public_relpath
            from app.models.media import Media

            r_assets = await db.execute(
                select(SiteAsset).where(SiteAsset.site_id == site.id)
            )
            site_assets = r_assets.scalars().all()
            asset_urls = {a.name: public_relpath(a) for a in site_assets}
            assets_by_category: dict[str, list[dict[str, str]]] = {"css": [], "js": [], "assets": []}
            for a in site_assets:
                assets_by_category.setdefault(a.category, []).append({
                    "name": a.name, "url": public_relpath(a), "content_type": a.content_type,
                })
            for cat in assets_by_category.values():
                cat.sort(key=lambda x: x["name"])
            media_urls: dict[str, str] = {}
            r_media = await db.execute(
                select(Media).where(Media.site_id == site.id, Media.deleted_at.is_(None))
            )
            for m in r_media.scalars().all():
                media_urls[str(m.id)] = f"/media/{m.object_key}"

            # === P3.6.1 增量: 根据 scope 决定要发布哪些 page ===
            output_dir = f"{settings.SITES_DATA_DIR}/{site.slug}/public"
            # site 全清，栏目/文章增量保留其他文件
            clean_before = (scope == "site")  # site 全清, 其他增量
            contents = await _load_contents(db, site.id)
            all_pages = build_site(
                site=site, cats=cats, contents=contents,
                tags_by_content=await _load_tags_by_content(db, site.id),
                layouts=layouts, base_url=base_url,
                build_id=str(site.id),
                menus_rendered=menus_rendered,
                asset_urls=asset_urls,
                assets_by_category=assets_by_category,
                media_urls=media_urls,
            )
            pages = all_pages
            if scope == "category" and d.scope_id:
                # 仅写当前栏目及其所有子栏目、这些栏目下的文章
                cats_by_id = {str(c.id): c for c in cats}
                target_id = str(d.scope_id)
                target_cat = cats_by_id.get(target_id)
                if target_cat is None:
                    raise RuntimeError(f"category {d.scope_id} 不存在")

                children_by_parent: dict[str, list[str]] = {}
                for c in cats:
                    parent_id = str(getattr(c, "parent_id", "") or "")
                    if parent_id:
                        children_by_parent.setdefault(parent_id, []).append(str(c.id))

                allowed_cat_ids: set[str] = set()
                stack = [target_id]
                while stack:
                    current_id = stack.pop()
                    if current_id in allowed_cat_ids:
                        continue
                    allowed_cat_ids.add(current_id)
                    stack.extend(children_by_parent.get(current_id, []))

                cat_dir_cache: dict[str, str] = {}

                def _cat_dir(cat_id: str) -> str:
                    cached = cat_dir_cache.get(cat_id)
                    if cached is not None:
                        return cached
                    cat = cats_by_id.get(cat_id)
                    if cat is None:
                        cat_dir_cache[cat_id] = ""
                        return ""
                    slug = getattr(cat, "slug", "") or ""
                    parent_id = str(getattr(cat, "parent_id", "") or "")
                    if not parent_id:
                        cat_dir_cache[cat_id] = slug
                        return slug
                    parent_dir = _cat_dir(parent_id)
                    full_dir = f"{parent_dir}/{slug}" if parent_dir else slug
                    cat_dir_cache[cat_id] = full_dir
                    return full_dir

                allowed_dirs = {
                    _cat_dir(cat_id)
                    for cat_id in allowed_cat_ids
                    if _cat_dir(cat_id)
                }

                def _is_category_subtree_page(path: str, page_type: str) -> bool:
                    if not path:
                        return False
                    if page_type == "category":
                        return any(
                            path == f"{cat_dir}/index.html" or path.startswith(f"{cat_dir}/page-")
                            for cat_dir in allowed_dirs
                        )
                    if page_type == "content":
                        return any(path.startswith(f"{cat_dir}/") for cat_dir in allowed_dirs)
                    return False

                pages = [p for p in all_pages if _is_category_subtree_page(p.path, p.page_type)]
                log_lines.append(
                    f"[category-publish] target subtree cats={len(allowed_cat_ids)} pages={len(pages)}"
                )

            writer = DiskWriter(output_dir)
            if clean_before:
                writer.clean_dir()
            total = writer.write_all(pages)
            try:
                d_count, k_count, ml = _inline_content_media(output_dir)
                log_lines.extend(ml)
            except Exception as e:
                log_lines.append(f"[media-inline] failed: {e}")
            if site_assets:
                copied = _copy_assets_to_public(list(site_assets), output_dir)
                log_lines.append(f"[{scope}-publish] copied {copied}/{len(site_assets)} assets")

            now = datetime.now(timezone.utc)
            d.status = "success"
            d.finished_at = now
            d.duration_ms = int((now - d.started_at).total_seconds() * 1000)
            d.content_count = len(pages)
            d.artifact_path = output_dir
            d.artifact_size = total
            d.build_log = _truncate_log("\n".join(log_lines))
            await db.commit()

            # P2.6: 重新计算并写回 sites.publish_status
            from app.services.publish_status import recompute_and_persist
            try:
                await recompute_and_persist(db, site.id)
            except Exception as e:
                logger.warning(f"recompute publish_status failed: {e}")

            try:
                from app.services.notifications import notify_publish_finished
                await notify_publish_finished(db, d)
                await db.commit()
            except Exception as e:
                logger.warning(f"notify publish partial success failed: {e}")

            return {
                "deployment_id": deployment_id, "status": "success",
                "scope": scope, "duration_ms": d.duration_ms,
                "pages": len(pages), "size": total,
            }
        except Exception as e:
            now = datetime.now(timezone.utc)
            log_lines.append(f"\n[ERROR] {type(e).__name__}: {e}")
            d.status = "failed"
            d.finished_at = now
            d.duration_ms = int((now - d.started_at).total_seconds() * 1000) if d.started_at else None
            d.error_message = str(e)[:1000]
            d.build_log = _truncate_log("\n".join(log_lines))
            d.retry_count = retry_count
            await db.commit()
            try:
                from app.services.notifications import notify_publish_finished
                await notify_publish_finished(db, d)
                await db.commit()
            except Exception as ne:
                logger.warning(f"notify publish partial fail failed: {ne}")
            return {
                "deployment_id": deployment_id, "status": "failed",
                "scope": scope, "error": str(e)[:200],
            }


async def _attach_body_html(db: AsyncSession, contents: list) -> None:
    """把 ContentVersion.body 挂到 ORM 实例，供 HY_CONTENT_BODY 渲染。

    Content 表本身没有 body 字段；实时预览会挂 body_html，
    文章级/栏目级静态发布以前漏了这一步，线上页正文就会是空的。
    """
    from app.models.content import ContentVersion
    for c in contents:
        v = None
        if c.published_version_id:
            v = await db.get(ContentVersion, c.published_version_id)
        if v is None:
            r = await db.execute(
                select(ContentVersion)
                .where(ContentVersion.content_id == c.id)
                .order_by(ContentVersion.version_num.desc())
                .limit(1)
            )
            v = r.scalar_one_or_none()
        c.body_html = (v.body or "") if v else ""


async def _load_contents(db: AsyncSession, site_id):
    """加载站点的所有 published 内容 (Content 对象, build_site 兼容)"""
    from app.models.content import Content
    r = await db.execute(
        select(Content).where(
            Content.site_id == site_id,
            Content.status == "published",
            Content.deleted_at.is_(None),
        )
    )
    contents = list(r.scalars().all())
    await _attach_body_html(db, contents)
    return contents


async def _load_tags_by_content(db: AsyncSession, site_id) -> dict:
    """加载站点所有内容的 tag 关联 (HY_ITEM_TAGS 用)

    返回: {content_id_str: [{"name": "AI", "slug": "ai"}, ...]}

    只取 type='tag' 的 taxonomy, 忽略 series/format/category。
    一次查询所有 (避免 N+1)。
    """
    from app.models.content import Content, ContentTaxonomy
    from app.models.taxonomy import Taxonomy
    r = await db.execute(
        select(ContentTaxonomy.content_id, Taxonomy.name, Taxonomy.slug)
        .join(Taxonomy, Taxonomy.id == ContentTaxonomy.taxonomy_id)
        .join(Content, Content.id == ContentTaxonomy.content_id)
        .where(
            Content.site_id == site_id,
            Content.status == "published",
            Content.deleted_at.is_(None),
            Taxonomy.type == "tag",
            Taxonomy.deleted_at.is_(None),
        )
    )
    out: dict = {}
    for content_id, name, slug in r.all():
        out.setdefault(str(content_id), []).append({"name": name, "slug": slug})
    return out
