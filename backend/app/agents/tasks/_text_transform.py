"""通用文本改写任务 (P3.1)

依据: docs/09-AI集成方案.md §4.1-4.2
依据: docs/13-P3-进度.md P3.1 计划

3 个任务 (rewrite/expand/shorten/polish/translate) 共用此函数
各任务只通过 OPERATION_PROMPT 区分 prompt 模板
"""
import re
from typing import Optional

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.router import register
from app.models.ai_run import AIRun, AIRunStep
from app.services.llm.base import LLMMessage
from app.services.llm.factory import get_provider_for_user


MAX_INPUT_CHARS = 8000  # 8K 字符上限 (P3.0 沿用)


# operation → system prompt 映射
OPERATION_PROMPTS: dict[str, str] = {
    "rewrite": "请改写以下文本, 保持原意但用不同的表达, 直接输出改写后的全文, 不要加任何前缀或解释。",
    "expand": "请扩写以下文本, 增加细节和深度, 直接输出扩写后的全文, 不要加任何前缀或解释。",
    "shorten": "请缩写以下文本, 保留核心信息, 直接输出缩写后的全文, 不要加任何前缀或解释。",
    "polish": "请润色以下文本, 让表达更流畅专业, 直接输出润色后的全文, 不要加任何前缀或解释。",
    "translate": "请将以下文本翻译为{target_lang}, 保持自然, 直接输出翻译后的全文, 不要加任何前缀或解释。",
    # P3.1 新增
    "draft": "请根据以下主题和大纲, 起一篇 Markdown 格式的文章, 控制在 {word_count} 字左右。直接输出文章, 不要加任何前缀或解释。",
    # P3.9.4+ 排版: 只调结构/样式, 严禁整篇重写、严禁删文字与媒体
    "format_html": (
        "你是排版助手。任务是「只调结构/样式」，输出必须看起来仍是同一篇文章。\n"
        "硬性要求:\n"
        "1. 禁止重写全文、禁止换成另一套版式。原文已是 HTML 时，必须保留原标签层级、class、id、style、data-*，只做最小修正。\n"
        "2. 禁止增删、改写、润色任何业务文字。\n"
        "3. 禁止改 font-size、color、width、height、text-align、背景（纯文本除外）。\n"
        "4. 仅当原文是纯文本时：用 <p>/<h2>/<h3>/<ul>/<ol> 分段，中文段落可加 style=\"text-indent: 2em;\"。\n"
        "5. 原文已是 HTML 时：不要包新的 section/article，不要把内容拆进新的 span。\n"
        "6. 必须原样保留全部媒体标签及全部属性（src/data-src/data-croporisrc/srcset/poster）。禁止删 src。\n"
        "7. @@AICMS_MEDIA_N@@ 必须原样保留在原位置。\n"
        "8. 直接输出完整 HTML，不要 markdown。"
    ),
}


_MEDIA_TAG_RE = re.compile(
    r"<img\b[^>]*/?>"
    r"|<(video|audio|iframe|picture)\b[^>]*>[\s\S]*?</\1>"
    r"|<source\b[^>]*/?>",
    re.IGNORECASE,
)


def _protect_media(html: str) -> tuple[str, list[str]]:
    """把媒体标签换成占位符, 防止 LLM 排版时删图/视频。"""
    media: list[str] = []

    def _repl(m: re.Match) -> str:
        media.append(m.group(0))
        return f"@@AICMS_MEDIA_{len(media) - 1}@@"

    return _MEDIA_TAG_RE.sub(_repl, html), media


def _restore_media(html: str, media: list[str]) -> str:
    """还原占位符; 若模型丢掉占位符则追加到文末, 保证媒体不丢。"""
    out = html
    missing: list[str] = []
    for i, tag in enumerate(media):
        token = f"@@AICMS_MEDIA_{i}@@"
        if token in out:
            out = out.replace(token, tag)
        else:
            missing.append(tag)
    if missing:
        out = out.rstrip() + "\n" + "\n".join(missing)
    return out


_IMG_TAG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_IMG_FALLBACK_SRC_ATTRS = (
    "data-src",
    "data-original",
    "data-croporisrc",
    "data-lazy-src",
    "data-actualsrc",
)


def _ensure_img_src(html: str) -> str:
    """微信懒加载图常只有 data-src；预览看 src，缺则从 data-* 补上。"""

    def _repl(m: re.Match) -> str:
        tag = m.group(0)
        if re.search(r"\bsrc\s*=", tag, re.IGNORECASE):
            return tag
        for attr in _IMG_FALLBACK_SRC_ATTRS:
            mm = re.search(rf'\b{attr}\s*=\s*["\']([^"\']+)["\']', tag, re.IGNORECASE)
            if mm:
                url = mm.group(1).strip()
                if url:
                    return re.sub(r"<img\b", f'<img src="{url}"', tag, count=1, flags=re.IGNORECASE)
        return tag

    return _IMG_TAG_RE.sub(_repl, html)


def _looks_like_html_fragment(text: str) -> bool:
    """已有结构标签则视为 HTML 正文片段（不必整篇丢给 LLM 重写）。"""
    if not text or "<" not in text:
        return False
    tags = len(re.findall(r"</?[a-zA-Z][^>]*>", text))
    return tags >= 3


def _local_format_html(html: str) -> str:
    """本地最小排版：已是 HTML 时秒级完成，避免 LLM 慢且截断。

    - 补 img src
    - 给无缩进的纯 <p> 加 text-indent（已有 style/缩进的不动）
    """
    out = _ensure_img_src(html)

    def _indent_p(m: re.Match) -> str:
        open_tag = m.group(0)
        if re.search(r"text-indent\s*:", open_tag, re.I):
            return open_tag
        style_m = re.search(r'\bstyle\s*=\s*("|\')([^"\']*)\1', open_tag, re.I)
        if style_m:
            quote, val = style_m.group(1), style_m.group(2)
            if not val.strip().endswith(";"):
                val = val.rstrip() + "; "
            else:
                val = val.rstrip() + " "
            new_style = f'style={quote}text-indent: 2em; {val}{quote}'
            return open_tag[: style_m.start()] + new_style + open_tag[style_m.end() :]
        # <p> 或 <p class="x">
        if open_tag.endswith("/>"):
            return open_tag
        return open_tag[:-1] + ' style="text-indent: 2em;">'

    out = re.sub(r"<p(\s[^>]*)?>", _indent_p, out, flags=re.IGNORECASE)
    return out


def _max_out_tokens(task_type: str, input_len: int) -> int:
    """控制生成长度：太高会极慢，太低会截断。"""
    if task_type == "format_html":
        return min(8_192, max(3_072, int(input_len * 0.9) + 512))
    if task_type == "polish":
        # 自然语言改样式/正文需要接近全文输出
        return min(12_288, max(4_096, int(input_len * 0.85) + 1_024))
    if task_type in ("rewrite", "expand", "shorten", "translate"):
        return min(12_288, max(4_096, int(input_len * 0.85) + 1_024))
    return 2048


def _basic_sanitize(text: str) -> str:
    """基础 XSS 清理"""
    text = re.sub(r"<script\b[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'\s+on\w+\s*=\s*["\'][^"\']*["\']', "", text, flags=re.IGNORECASE)
    text = re.sub(r"javascript\s*:", "", text, flags=re.IGNORECASE)
    return text


async def _text_transform_impl(
    run: AIRun,
    db: AsyncSession,
    provider_model: Optional[object] = None,
    task_type: str = "rewrite",
    max_input: int = MAX_INPUT_CHARS,
) -> dict:
    """通用文本改写主函数

    Args:
        run: AI run 记录
        db: async session
        provider_model: AIProvider 配置
        task_type: rewrite/expand/shorten/polish/translate/draft
        max_input: 输入字符上限

    Returns:
        dict: {result_text, operation, tokens_used, original_length, result_length}
    """
    logger.info(f"AI {task_type} 启动: run_id={run.id}")

    # P3.1 兼容: input 可能是 string (裸文本) 或 dict ({original_text, ...})
    if isinstance(run.input, str):
        input_data = {"original_text": run.input}
    else:
        input_data = run.input or {}
    original_text: str = input_data.get("original_text", "")
    operation: str = input_data.get("operation", task_type)
    target_language: Optional[str] = input_data.get("target_language")
    # P3.1 draft 专用
    word_count: Optional[int] = input_data.get("word_count")
    # P3.9.1+ (holy 反馈 #11470 续, Q5): user_prompt 优先 - 自由输入提示词覆盖默认 system prompt
    user_instruction: Optional[str] = input_data.get("user_prompt")

    # === 1. validate ===
    if not original_text.strip() and task_type != "draft":
        raise ValueError("original_text 不能为空")
    if task_type != "draft" and len(original_text) > max_input:
        raise ValueError(f"original_text 超过 {max_input} 字符限制")

    # 排版/润色 HTML 时保护媒体标签, 避免模型删 <img>/<video>
    media_tokens: list[str] = []
    protect_media = task_type in ("format_html", "polish") and bool(
        _MEDIA_TAG_RE.search(original_text)
    )
    if protect_media:
        original_text, media_tokens = _protect_media(original_text)
        logger.info(f"AI {task_type}: 已保护 {len(media_tokens)} 个媒体标签")

    # === 2. generate ===
    from sqlalchemy import select
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

    prompt_key: Optional[str] = input_data.get("prompt_key")
    force_llm = bool(
        (user_instruction and user_instruction.strip())
        or (prompt_key and str(prompt_key) not in ("", "task.format_html"))
    )

    # 已是 HTML 正文：本地快排（秒级），避免整篇丢 LLM 生成极慢、又易截断
    if task_type == "format_html" and not force_llm and _looks_like_html_fragment(original_text):
        result = _local_format_html(original_text)
        result = _basic_sanitize(result)
        if media_tokens:
            result = _restore_media(result, media_tokens)
            logger.info(f"AI {task_type}: 已还原 {len(media_tokens)} 个媒体标签")
        result = _ensure_img_src(result)
        from datetime import datetime, timezone
        gen_step.output = {"result_length": len(result), "mode": "local_fast"}
        gen_step.status = "success"
        gen_step.finished_at = datetime.now(timezone.utc)
        gen_step.delta = result
        logger.info(
            f"AI {task_type} 本地快排完成: run_id={run.id} len={len(result)}"
        )
        return {
            "result_text": result,
            "rewritten_text": result,
            "operation": operation,
            "original_length": len(original_text),
            "result_length": len(result),
            "tokens_used": 0,
            "mode": "local_fast",
        }

    # prompt (P3.4: YAML + DB 统一管理; user_prompt / prompt_key 可覆盖)
    from app.agents.prompts import resolve_prompt_content, resolve_task_system_prompt

    if user_instruction and user_instruction.strip():
        system_prompt = (
            f"{user_instruction.strip()}\n\n"
            f"重要: 直接输出最终文本, 不要加任何前缀/解释/引号包裹。"
            + (
                "\n必须原样保留全部 @@AICMS_MEDIA_N@@ 占位符, 禁止删除图片/视频相关占位。"
                if media_tokens
                else ""
            )
        )
    elif prompt_key:
        prompt_vars = input_data.get("prompt_vars") if isinstance(input_data.get("prompt_vars"), dict) else None
        system_prompt = await resolve_prompt_content(
            db,
            str(prompt_key),
            fallback=OPERATION_PROMPTS.get(operation, OPERATION_PROMPTS["rewrite"]),
            variables=prompt_vars,
        )
        if media_tokens and "@@AICMS_MEDIA_" not in system_prompt:
            system_prompt += "\n必须原样保留全部 @@AICMS_MEDIA_N@@ 占位符, 禁止删除图片/视频相关占位。"
    else:
        format_vars: dict = {}
        if target_language:
            format_vars["target_lang"] = target_language
        if word_count:
            format_vars["word_count"] = word_count
        system_prompt = await resolve_task_system_prompt(
            db,
            operation,
            OPERATION_PROMPTS.get(operation, OPERATION_PROMPTS["rewrite"]),
            variables=format_vars or None,
        )
        # 兼容旧 YAML 里的 {target_lang}/{word_count}
        if "{target_lang}" in system_prompt and target_language:
            system_prompt = system_prompt.format(target_lang=target_language)
        elif "{word_count}" in system_prompt and word_count:
            system_prompt = system_prompt.format(word_count=word_count)

    user_prompt = original_text
    messages = [
        LLMMessage(role="system", content=system_prompt),
        LLMMessage(role="user", content=user_prompt),
    ]

    provider = get_provider_for_user(
        user_id=run.user_id, provider_config=provider_model,
    )
    model = run.model or "qwen2.5:1.5b"

    max_out = _max_out_tokens(task_type, len(original_text))
    temperature = 0.2 if task_type in ("format_html", "polish") else 0.7

    accumulated: list[str] = []
    total_prompt_tokens = 0
    total_completion_tokens = 0
    finish_reason = ""
    async for chunk in provider.stream(
        messages, model=model, temperature=temperature, max_tokens=max_out,
    ):
        if chunk.delta:
            accumulated.append(chunk.delta)
            gen_step.delta = "".join(accumulated[-200:])
        if chunk.prompt_tokens:
            total_prompt_tokens = chunk.prompt_tokens
        if chunk.completion_tokens:
            total_completion_tokens = chunk.completion_tokens
        if chunk.finish_reason:
            finish_reason = chunk.finish_reason

    result = "".join(accumulated).strip()
    if finish_reason in ("length", "max_tokens"):
        logger.warning(
            f"AI {task_type}: 输出可能被截断 finish={finish_reason} "
            f"in={len(original_text)} out={len(result)} max_tokens={max_out}"
        )

    # === 3. sanitize + 还原媒体 ===
    result = _basic_sanitize(result)
    if media_tokens:
        result = _restore_media(result, media_tokens)
        logger.info(f"AI {task_type}: 已还原 {len(media_tokens)} 个媒体标签")
    if task_type == "format_html":
        result = _ensure_img_src(result)

    # === 4. save ===
    gen_step.output = {"result_length": len(result)}
    gen_step.status = "success"
    from datetime import datetime, timezone
    gen_step.finished_at = datetime.now(timezone.utc)
    gen_step.delta = result

    output = {
        "result_text": result,
        "operation": operation,
        "original_length": len(original_text),
        "result_length": len(result),
        "tokens_used": total_prompt_tokens + total_completion_tokens,
    }
    # 兼容 P3.0 rewrite schema
    output["rewritten_text"] = result
    logger.info(
        f"AI {task_type} 完成: run_id={run.id} tokens={output['tokens_used']} len={len(result)}"
    )
    return output


# ====== 任务注册 ======
@register("rewrite")
async def ai_rewrite(run, db, provider_model=None):
    return await _text_transform_impl(run, db, provider_model, task_type="rewrite", max_input=48000)


@register("expand")
async def ai_expand(run, db, provider_model=None):
    return await _text_transform_impl(run, db, provider_model, task_type="expand", max_input=48000)


@register("shorten")
async def ai_shorten(run, db, provider_model=None):
    return await _text_transform_impl(run, db, provider_model, task_type="shorten", max_input=48000)


@register("polish")
async def ai_polish(run, db, provider_model=None):
    # 文章 AI 增强可能处理较长 HTML
    return await _text_transform_impl(run, db, provider_model, task_type="polish", max_input=48000)


@register("translate")
async def ai_translate(run, db, provider_model=None):
    return await _text_transform_impl(run, db, provider_model, task_type="translate", max_input=48000)


@register("draft")
async def ai_draft(run, db, provider_model=None):
    return await _text_transform_impl(run, db, provider_model, task_type="draft")


# P3.9.4+ (holy 反馈 #11869 文章 AI 职能): 纯文本/Word → 结构化 HTML
@register("format_html")
async def ai_format_html(run, db, provider_model=None):
    # 样式增强同样可能超过默认 8K
    return await _text_transform_impl(run, db, provider_model, task_type="format_html", max_input=48000)
