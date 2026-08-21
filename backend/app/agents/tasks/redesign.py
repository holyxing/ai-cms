"""AI 重设计任务 (P3.9)

holy 反馈 2026-06-10 23:05 (#10859):
- LayoutEditPage 「富文本」改名为「AI 设计」
- 加 4 个 AI 动作: optimize_design / responsive / a11y / seo
- 4 套设计语言预设: github / linear / notion / transwarp
- AI 输出新 HTML, 走 diff 对比, 用户接受/拒绝

依据: docs/09-AI集成方案.md §4 (任务注册体系)

4 个任务共用此函数 (通过 task_type 区分 prompt 模板)
每个任务输出格式:
  {
    "result_html": str,           # LLM 输出的新 HTML
    "description": str,           # 1 句话说明改了什么
    "diff_html": str,             # (同 result_html)
    "diff_stats": {added, removed, changed},  # 改动量统计
    "design_lang": str,           # 用的哪个设计语言
  }

输出协议 (LLM 端):
  <description>...</description>
  ===HTML_START===
  <html>...</html>
  ===HTML_END===
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.router import register
from app.models.ai_run import AIRun, AIRunStep
from app.services.llm.base import LLMMessage
from app.services.llm.factory import get_provider_for_user


# 4 个任务类型
TASK_TYPES = ("optimize_design", "responsive", "a11y", "seo")

# 输入字符上限 (HTML 模板通常 5K-30K, 留 30K buffer)
MAX_INPUT_CHARS = 30_000

# 输出分隔符
HTML_START_TAG = "===HTML_START==="
HTML_END_TAG = "===HTML_END==="

# 设计语言预设 (用在前端下拉)
DESIGN_LANGS = ("github", "linear", "notion", "transwarp")

# 设计语言描述 (拼到 system prompt 后面)
DESIGN_LANG_DESCRIPTIONS = {
    "github": (
        "GitHub 设计语言: 代码风, 等宽字体, 主色 #0969da, 紧凑 16-24px padding, "
        "锐角 4px, 阴影极少, 强调功能性"
    ),
    "linear": (
        "Linear 设计语言: 极简风, 大留白, 主色 #5e6ad2, 圆角 6-8px, 阴影轻, "
        "居中对齐, 重视觉冲击力"
    ),
    "notion": (
        "Notion 设计语言: 文档风, 友好, 主色 #37352f, 圆角 4-6px, 阴影中等, "
        "居左对齐, 重内容阅读"
    ),
    "transwarp": (
        "星环科技设计语言: 数据感, 主色 #2563eb, 圆角 4px, 阴影 4-8px, "
        "横排卡片 (图左文右), 重心智感"
    ),
}


def _basic_sanitize_html(html: str) -> str:
    """基础 XSS 清理 (跟 _text_transform 一致)"""
    html = re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'\s+on\w+\s*=\s*["\'][^"\']*["\']', "", html, flags=re.IGNORECASE)
    html = re.sub(r"javascript\s*:", "", html, flags=re.IGNORECASE)
    return html


def _parse_llm_output(raw: str) -> tuple[str, str]:
    """从 LLM 输出抽 (description, html)

    协议:
      <description>...</description>
      ===HTML_START===
      <html>...</html>
      ===HTML_END===

    兼容: LLM 可能不带 <description> 标签, 直接 HTML_START
    """
    desc = ""
    html = raw.strip()

    # 1) 抽 <description> 标签
    m = re.search(r"<description>(.*?)</description>", raw, flags=re.DOTALL | re.IGNORECASE)
    if m:
        desc = m.group(1).strip()

    # 2) 抽 ===HTML_START=== ===HTML_END=== 段
    m = re.search(
        re.escape(HTML_START_TAG) + r"\s*(.*?)\s*" + re.escape(HTML_END_TAG),
        raw,
        flags=re.DOTALL,
    )
    if m:
        html = m.group(1).strip()
    else:
        # fallback: LLM 没按协议, 整段当 HTML
        # 去掉 <description> 标签保留的部分
        html = re.sub(r"<description>.*?</description>", "", raw, flags=re.DOTALL).strip()
        # 去掉 markdown ```html ``` 包裹
        html = re.sub(r"^```(?:html|HTML)?\s*", "", html)
        html = re.sub(r"\s*```\s*$", "", html)

    return desc, html


def _calc_diff_stats(old_html: str, new_html: str) -> dict:
    """粗略计算 diff 统计 (按行)"""
    old_lines = [l for l in old_html.split("\n") if l.strip()]
    new_lines = [l for l in new_html.split("\n") if l.strip()]
    old_set = set(old_lines)
    new_set = set(new_lines)
    added = len(new_set - old_set)
    removed = len(old_set - new_set)
    changed = max(0, (len(new_lines) - len(old_lines)) // 2)  # 粗估
    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "old_lines": len(old_lines),
        "new_lines": len(new_lines),
    }


async def _redesign_impl(
    run: AIRun,
    db: AsyncSession,
    provider_model: Optional[object] = None,
    task_type: str = "optimize_design",
) -> dict:
    """重设计主函数 (optimize_design/responsive/a11y/seo 共用)"""
    logger.info(f"AI {task_type} 启动: run_id={run.id}")

    # === 1. validate 输入 ===
    input_data = run.input or {}
    if isinstance(input_data, str):
        input_data = {"html": input_data}
    html: str = input_data.get("html", "").strip()
    design_lang: str = input_data.get("design_lang", "linear")
    if design_lang not in DESIGN_LANGS:
        design_lang = "linear"

    if not html:
        raise ValueError("html 不能为空 (P3.9 redesign 需要模板 HTML 作为输入)")
    if len(html) > MAX_INPUT_CHARS:
        raise ValueError(f"html 超过 {MAX_INPUT_CHARS} 字符限制, 请简化模板")

    # === 2. generate (走 LLM 流式) ===
    from app.agents.prompts import resolve_task_system_prompt

    # 加载 YAML/DB prompt
    system_prompt = await resolve_task_system_prompt(db, task_type, "")
    # 追加设计语言描述 (对 optimize_design 有效, 其他任务忽略)
    if task_type == "optimize_design" and design_lang:
        lang_desc = DESIGN_LANG_DESCRIPTIONS.get(design_lang, "")
        if lang_desc:
            system_prompt = system_prompt + f"\n\n## 本次使用的设计语言: {lang_desc}\n"

    # 准备 generate step
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

    # LLM 调用
    provider = get_provider_for_user(
        user_id=run.user_id, provider_config=provider_model,
    )
    model = run.model or "qwen2.5:1.5b"

    user_prompt = f"```html\n{html}\n```"

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

    # === 3. sanitize (XSS) ===
    desc, new_html = _parse_llm_output(raw)
    new_html = _basic_sanitize_html(new_html)

    # === 4. 算 diff_stats ===
    diff_stats = _calc_diff_stats(html, new_html)

    # === 5. save ===
    gen_step.output = {
        "description": desc,
        "result_length": len(new_html),
        "design_lang": design_lang,
    }
    gen_step.status = "success"
    gen_step.finished_at = datetime.now(timezone.utc)
    gen_step.delta = new_html

    # P3.9: 同时写 run.diff_html / diff_stats (前端 stream 完直接读)
    run.diff_html = new_html
    run.diff_stats = diff_stats

    # 写 run.output (兼容前端 streamRun 拿 output)
    output = {
        "result_html": new_html,
        "description": desc,
        "diff_html": new_html,
        "diff_stats": diff_stats,
        "design_lang": design_lang,
        "tokens_used": total_prompt_tokens + total_completion_tokens,
    }
    logger.info(
        f"AI {task_type} 完成: run_id={run.id} tokens={output['tokens_used']} "
        f"new_len={len(new_html)} diff={diff_stats}"
    )
    return output


# ====== 任务注册 (4 个共用 _redesign_impl) ======
@register("optimize_design")
async def ai_optimize_design(run, db, provider_model=None):
    return await _redesign_impl(run, db, provider_model, task_type="optimize_design")


@register("responsive")
async def ai_responsive(run, db, provider_model=None):
    return await _redesign_impl(run, db, provider_model, task_type="responsive")


@register("a11y")
async def ai_a11y(run, db, provider_model=None):
    return await _redesign_impl(run, db, provider_model, task_type="a11y")


@register("seo")
async def ai_seo(run, db, provider_model=None):
    return await _redesign_impl(run, db, provider_model, task_type="seo")
