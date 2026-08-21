"""AI 提取 CSS/JS 资源任务 (P3.9.4)

holy 反馈 2026-06-11 22:00 (#11869):
- 模板 AI 职能: 页面布局 + 样式 css/js 整理, 能独立生成 css/js 文件, 上传到资源目录
- 方案 A: 全自动 (提取+整理+上传+替换, 一气呵成)
- 文件名带版本号: styles-v1.css, scripts-v1.js (递增, 旧版保留)

依据: docs/09-AI集成方案.md §4 (任务注册体系)

任务: extract_assets (一个任务同时处理 CSS + JS)

LLM 输出协议:
  <description>...</description>
  ===CSS_START===
  /* organized CSS */
  ===CSS_END===
  ===JS_START===
  // organized JS
  ===JS_END===

后端流程:
  1. 解析 LLM 输出, 抽 CSS / JS 段
  2. 写文件到 /app/ssg/site_assets/{site_id}/css/{name} 跟 /js/{name}
     文件名: styles-v1.css, app-v1.js (按当前 max version +1 递增)
  3. 创建 SiteAsset 记录 (category=css/js, description=AI 提取)
  4. 替换 HTML 里的 <style>...</style> 为 <link rel="stylesheet" href="/sites/{slug}/assets/{name}">
            跟 <script>...</script> 为 <script src="/sites/{slug}/assets/{name}"></script>
  5. 返回新 HTML (onApply 写入 HTML 编辑器)
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from loguru import logger
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.router import register
from app.core.config import get_settings
from app.models.ai_run import AIRun, AIRunStep
from app.models.site import Site
from app.models.site_asset import SiteAsset
from app.services.llm.base import LLMMessage
from app.services.llm.factory import get_provider_for_user


TASK_TYPES = ("extract_assets",)

MAX_INPUT_CHARS = 30_000

# 输出分隔符
CSS_START_TAG = "===CSS_START==="
CSS_END_TAG = "===CSS_END==="
JS_START_TAG = "===JS_START==="
JS_END_TAG = "===JS_END==="

# 默认 CSS / JS 文件名 (按版本递增)
DEFAULT_CSS_NAME = "styles"
DEFAULT_JS_NAME = "scripts"


def _parse_llm_output(raw: str) -> tuple[str, str, str]:
    """从 LLM 输出抽 (description, css, js)"""
    desc = ""
    css = ""
    js = ""

    # description
    m = re.search(r"<description>(.*?)</description>", raw, flags=re.DOTALL | re.IGNORECASE)
    if m:
        desc = m.group(1).strip()

    # css
    m = re.search(
        re.escape(CSS_START_TAG) + r"\s*(.*?)\s*" + re.escape(CSS_END_TAG),
        raw,
        flags=re.DOTALL,
    )
    if m:
        css = m.group(1).strip()
    else:
        # fallback: 找 <style>...</style> 整段
        style_blocks = re.findall(r"<style[^>]*>(.*?)</style>", raw, flags=re.DOTALL | re.IGNORECASE)
        if style_blocks:
            css = "\n\n".join(b.strip() for b in style_blocks)

    # js
    m = re.search(
        re.escape(JS_START_TAG) + r"\s*(.*?)\s*" + re.escape(JS_END_TAG),
        raw,
        flags=re.DOTALL,
    )
    if m:
        js = m.group(1).strip()
    else:
        # fallback: 找 <script>...</script> (无 src)
        script_blocks = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", raw, flags=re.DOTALL | re.IGNORECASE)
        if script_blocks:
            js = "\n\n".join(b.strip() for b in script_blocks)

    return desc, css, js


def _next_version_name(base: str, ext: str, scan_dir: Path) -> str:
    """下一个版本号: base-v1.ext, base-v2.ext ...
    扫描 scan_dir 找最大版本号 +1
    """
    if not scan_dir.exists():
        return f"{base}-v1.{ext}"
    # 找现有 max version
    pattern = re.compile(rf"^{re.escape(base)}-v(\d+)\.{re.escape(ext)}$")
    max_v = 0
    for f in scan_dir.iterdir():
        if f.is_file():
            m = pattern.match(f.name)
            if m:
                v = int(m.group(1))
                if v > max_v:
                    max_v = v
    return f"{base}-v{max_v + 1}.{ext}"


def _replace_inline_with_external(html: str, css_link: Optional[str], js_src: Optional[str]) -> str:
    """把 HTML 里的 <style>...</style> 跟 <script>(内联)</script> 替换为外链

    - <style>...</style> → 第一个之前插入 <link rel="stylesheet" href="..."> (在 </head> 前)
    - <script>(内联)</script> → 第一个之前插入 <script src="..."></script> (在 </body> 前)
    """
    out = html

    if css_link:
        # 删所有 <style>...</style> 整段
        out = re.sub(r"<style\b[^>]*>.*?</style>", "", out, flags=re.DOTALL | re.IGNORECASE)
        # 第一个 </head> 前插 <link>
        link_tag = f'<link rel="stylesheet" href="{css_link}">'
        if "</head>" in out.lower():
            out = re.sub(r"</head>", f"{link_tag}\n</head>", out, count=1, flags=re.IGNORECASE)
        else:
            out = link_tag + "\n" + out

    if js_src:
        # 删所有 <script>(无 src)...</script> 内联脚本
        out = re.sub(
            r"<script(?![^>]*\bsrc=)[^>]*>.*?</script>",
            "",
            out,
            flags=re.DOTALL | re.IGNORECASE,
        )
        # 第一个 </body> 前插 <script src=...>
        script_tag = f'<script src="{js_src}"></script>'
        if "</body>" in out.lower():
            out = re.sub(r"</body>", f"{script_tag}\n</body>", out, count=1, flags=re.IGNORECASE)
        else:
            out = out + "\n" + script_tag

    return out


async def _extract_assets_impl(
    run: AIRun,
    db: AsyncSession,
    provider_model: Optional[object] = None,
    task_type: str = "extract_assets",
) -> dict:
    """extract_assets 主函数 (P3.9.4)

    流程:
      1. validate (html + site_id 必填)
      2. LLM 流式生成 CSS + JS
      3. 写文件到 site_assets 目录 (category=css/js, name=base-vN.ext)
      4. 创建 SiteAsset 记录
      5. 替换 HTML 内联为外链
      6. 返回新 HTML + 上传 URL
    """
    logger.info(f"AI {task_type} 启动: run_id={run.id}")

    # === 1. validate ===
    input_data = run.input or {}
    if isinstance(input_data, str):
        input_data = {"html": input_data}
    html: str = input_data.get("html", "").strip()
    # P3.9.4 修复: site_id 从 run.site_id 读 (API 端已经写入), 不再要求 input 里带
    site_id = run.site_id

    if not html:
        raise ValueError("html 不能为空 (extract_assets 需要模板 HTML 作为输入)")
    if site_id is None:
        raise ValueError("site_id 必填 (extract_assets 需要知道上传到哪个站点)")
    if len(html) > MAX_INPUT_CHARS:
        raise ValueError(f"html 超过 {MAX_INPUT_CHARS} 字符限制, 请简化模板")

    settings = get_settings()

    # 校验 site 存在 + 拿 slug (用于写 publish 目录)
    site_r = await db.execute(
        select(Site).where(Site.id == site_id, Site.deleted_at.is_(None))
    )
    site: Optional[Site] = site_r.scalar_one_or_none()
    if site is None:
        raise ValueError(f"站点 {site_id} 不存在")

    # 写入目标: /var/www/sites/{slug}/public/assets/{category}/
    # (nginx alias 映射 /sites/{slug}/assets/* → /var/www/sites/{slug}/public/assets/*)
    publish_assets_dir = Path(settings.SITES_DATA_DIR) / site.slug / "public" / "assets"

    # === 2. LLM generate ===
    stmt = select(AIRunStep).where(
        AIRunStep.run_id == run.id,
        AIRunStep.step_name == "generate",
    )
    gen_step = (await db.execute(stmt)).scalar_one_or_none()
    if gen_step is None:
        gen_step = AIRunStep(
            run_id=run.id, step_name="generate", step_order=2, status="running",
        )
        db.add(gen_step)
        await db.flush()

    # 加载 YAML/DB prompt
    from app.agents.prompts import resolve_task_system_prompt
    system_prompt = await resolve_task_system_prompt(db, task_type, "")

    user_prompt = f"```html\n{html}\n```"

    provider = get_provider_for_user(
        user_id=run.user_id, provider_config=provider_model,
    )
    model = run.model or "qwen2.5:1.5b"

    messages = [
        LLMMessage(role="system", content=system_prompt),
        LLMMessage(role="user", content=user_prompt),
    ]

    accumulated: list[str] = []
    total_prompt_tokens = 0
    total_completion_tokens = 0
    async for chunk in provider.stream(messages, model=model):
        if chunk.delta:
            accumulated.append(chunk.delta)
            gen_step.delta = "".join(accumulated[-200:])
        if chunk.prompt_tokens:
            total_prompt_tokens = chunk.prompt_tokens
        if chunk.completion_tokens:
            total_completion_tokens = chunk.completion_tokens

    raw = "".join(accumulated).strip()

    # === 3. parse LLM output ===
    desc, css_content, js_content = _parse_llm_output(raw)
    if not desc:
        desc = "已提取并整理 CSS/JS 资源, 上传至站点资源目录"

    uploaded_assets: list[dict] = []  # {category, name, url, size}

    # === 4. upload CSS → publish 目录 (nginx 直接服务) ===
    css_link = None
    if css_content.strip():
        css_dir = publish_assets_dir / "css"
        css_name = _next_version_name(DEFAULT_CSS_NAME, "css", css_dir)
        css_dir.mkdir(parents=True, exist_ok=True)
        css_path = css_dir / css_name
        css_path.write_text(css_content, encoding="utf-8")

        # 写 SiteAsset
        css_asset = SiteAsset(
            site_id=site_id,
            category="css",
            name=css_name,
            original_filename=css_name,
            file_path=str(css_path),
            content_type="text/css",
            byte_size=len(css_content.encode("utf-8")),
            description=f"AI 提取 ({desc[:80]})",
        )
        db.add(css_asset)

        css_link = f"/sites/{site.slug}/assets/{css_name}"
        uploaded_assets.append({
            "category": "css",
            "name": css_name,
            "url": css_link,
            "size": len(css_content.encode("utf-8")),
        })
        logger.info(f"  上传 CSS: {css_name} ({len(css_content)} chars)")

    # === 5. upload JS → publish 目录 (nginx 直接服务) ===
    js_src = None
    if js_content.strip():
        js_dir = publish_assets_dir / "js"
        js_name = _next_version_name(DEFAULT_JS_NAME, "js", js_dir)
        js_dir.mkdir(parents=True, exist_ok=True)
        js_path = js_dir / js_name
        js_path.write_text(js_content, encoding="utf-8")

        js_asset = SiteAsset(
            site_id=site_id,
            category="js",
            name=js_name,
            original_filename=js_name,
            file_path=str(js_path),
            content_type="application/javascript",
            byte_size=len(js_content.encode("utf-8")),
            description=f"AI 提取 ({desc[:80]})",
        )
        db.add(js_asset)

        js_src = f"/sites/{site.slug}/assets/{js_name}"
        uploaded_assets.append({
            "category": "js",
            "name": js_name,
            "url": js_src,
            "size": len(js_content.encode("utf-8")),
        })
        logger.info(f"  上传 JS: {js_name} ({len(js_content)} chars)")

    await db.flush()

    # === 6. 替换 HTML 内联 ===
    new_html = _replace_inline_with_external(html, css_link, js_src)

    # === 7. save ===
    diff_stats = {
        "added": 1 if css_link else 0,
        "removed": 1 if css_content else 0,
        "changed": 0,
        "old_lines": len(html.splitlines()),
        "new_lines": len(new_html.splitlines()),
    }

    gen_step.output = {
        "description": desc,
        "result_length": len(new_html),
        "uploaded_assets": uploaded_assets,
    }
    gen_step.status = "success"
    gen_step.finished_at = datetime.now(timezone.utc)
    gen_step.delta = new_html

    run.diff_html = new_html
    run.diff_stats = diff_stats

    output = {
        "result_html": new_html,
        "description": desc,
        "diff_html": new_html,
        "diff_stats": diff_stats,
        "uploaded_assets": uploaded_assets,
        "tokens_used": total_prompt_tokens + total_completion_tokens,
    }
    logger.info(
        f"AI {task_type} 完成: run_id={run.id} tokens={output['tokens_used']} "
        f"uploaded={len(uploaded_assets)} new_len={len(new_html)}"
    )
    return output


# ====== 任务注册 ======
@register("extract_assets")
async def ai_extract_assets(run, db, provider_model=None):
    return await _extract_assets_impl(run, db, provider_model, task_type="extract_assets")
