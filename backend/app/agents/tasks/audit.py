"""AI 审计任务 (P3.3)

依据: docs/09-AI集成方案.md §4.5

输入: content_id (从 content 拿 body 审计)
输出: {score, issues, summary}
状态: validate → analyze → score (3 步)
"""
from __future__ import annotations
import json
import re
from typing import Any

from loguru import logger
from sqlalchemy import select

from app.agents.router import register
from app.services.llm.factory import get_provider_for_user
from app.services.llm.base import LLMMessage
from app.models.ai_run import AIRunStep


# 3 步状态机名 (前端可见)
_STEPS = ["validate", "analyze", "score"]


@register("audit")
async def ai_audit(run, db, provider_model) -> dict:
    """AI 审计: 对内容做 typo / seo / readability / compliance 检查.

    输入: input.content_id (UUID str) 或 input.text (str)
    输出: {score, summary, issues: [{span, type, severity, message, suggestion}]}
    """
    logger.info(f"AI audit 启动: run_id={run.id}")

    input_data = run.input or {}
    # P3.3 修复: content_id 在 caller's payload 是顶层 (AITaskStart.content_id),
    # 后端存到 run.content_id. input 字典里只放任务自定义参数.
    content_id = getattr(run, "content_id", None) or input_data.get("content_id")
    text: str = input_data.get("text", "").strip()
    title: str = input_data.get("title", "").strip()

    # === 1. validate ===
    if content_id:
        from app.models.content import Content, ContentVersion
        from uuid import UUID
        try:
            cid = UUID(str(content_id))
        except (ValueError, TypeError):
            raise ValueError(f"content_id 格式错: {content_id}")
        c = await db.get(Content, cid)
        if c is None:
            raise ValueError(f"内容不存在: {content_id}")
        title = c.title or ""
        # body 存于最新 content_version (contents 表不存 body, 只存元数据)
        ver_stmt = select(ContentVersion).where(
            ContentVersion.content_id == cid,
        ).order_by(ContentVersion.version_num.desc()).limit(1)
        v = (await db.execute(ver_stmt)).scalar_one_or_none()
        print(f"[audit debug] cid={cid} content.title={title!r} ver={v.version_num if v else 'NONE'} body_len={len(v.body) if v and v.body else 'EMPTY'}", flush=True)
        text = (v.body if v else "") or ""
        debug_info = f"final_text_len={len(text)}"
    if not text.strip():
        raise ValueError(f"text 不能为空 (传 content_id 或 text) [{debug_info}]")
    if len(text) > 20000:
        raise ValueError(f"text 超过 20000 字符 (当前 {len(text)})")

    from datetime import datetime, timezone

    # 写入 3 个 step 记录
    for i, name in enumerate(_STEPS, start=1):
        existing = (await db.execute(
            select(AIRunStep).where(
                AIRunStep.run_id == run.id, AIRunStep.step_name == name,
            )
        )).scalar_one_or_none()
        if existing is None:
            db.add(AIRunStep(
                run_id=run.id, step_name=name, step_order=i, status="pending",
            ))
    await db.flush()

    # === 2. analyze (LLM 调) ===
    analyze_step = (await db.execute(
        select(AIRunStep).where(
            AIRunStep.run_id == run.id, AIRunStep.step_name == "analyze",
        )
    )).scalar_one()
    analyze_step.status = "running"
    analyze_step.started_at = datetime.now(timezone.utc)
    await db.flush()

    # P3.4: YAML + DB 统一管理
    from app.agents.prompts import resolve_task_system_prompt
    _HARDCODED_AUDIT_PROMPT = (
        "你是一名严谨的中文内容审计专家. "
        "对给定内容做 4 维度检查:\n"
        "  1. typo   — 错别字/标点\n"
        "  2. seo    — 标题/首段/关键词\n"
        "  3. readability — 句长/段落/口语\n"
        "  4. compliance  — 敏感词/政治/广告法\n"
        "返回纯 JSON (不要 markdown ```):\n"
        '{"score": 0-100, "summary": "一句话总评", '
        '"issues": [{"span": [start, end], "type": "typo|seo|readability|compliance", '
        '"severity": "low|medium|high", "message": "问题描述", '
        '"suggestion": "建议改法"}]}'
    )
    system_prompt = await resolve_task_system_prompt(db, "audit", _HARDCODED_AUDIT_PROMPT)
    user_prompt = f"标题: {title}\n\n正文:\n{text}"

    provider = get_provider_for_user(
        user_id=run.user_id, provider_config=provider_model,
    )
    model = run.model or "qwen2.5:1.5b"

    accumulated: list[str] = []
    total_prompt_tokens = 0
    total_completion_tokens = 0
    async for chunk in provider.stream(
        [LLMMessage(role="system", content=system_prompt),
         LLMMessage(role="user", content=user_prompt)],
        model=model,
    ):
        if chunk.delta:
            accumulated.append(chunk.delta)
        if chunk.prompt_tokens:
            total_prompt_tokens = chunk.prompt_tokens
        if chunk.completion_tokens:
            total_completion_tokens = chunk.completion_tokens

    raw = "".join(accumulated).strip()

    # === 3. score (解析 + 验 span) ===
    parsed = _parse_audit_json(raw, text)
    issues = parsed.get("issues", [])
    # 校验 span 在 text 范围内, 越界裁剪
    for it in issues:
        sp = it.get("span") or [0, 0]
        if not isinstance(sp, list) or len(sp) != 2:
            it["span"] = [0, 0]
            continue
        s, e = int(sp[0]), int(sp[1])
        s = max(0, min(s, len(text)))
        e = max(s, min(e, len(text)))
        it["span"] = [s, e]
    score = int(parsed.get("score", 0))
    score = max(0, min(100, score))
    summary = str(parsed.get("summary", ""))

    output = {
        "score": score,
        "summary": summary,
        "issues": issues,
        "text_length": len(text),
        "tokens_used": total_prompt_tokens + total_completion_tokens,
        "steps_total": len(_STEPS),  # 让 worker 知道总步数
    }

    analyze_step.status = "success"
    analyze_step.finished_at = datetime.now(timezone.utc)
    analyze_step.output = {"score": score, "issue_count": len(issues)}
    analyze_step.delta = raw

    score_step = (await db.execute(
        select(AIRunStep).where(
            AIRunStep.run_id == run.id, AIRunStep.step_name == "score",
        )
    )).scalar_one()
    score_step.status = "success"
    score_step.finished_at = datetime.now(timezone.utc)
    score_step.output = output

    logger.info(
        f"AI audit 完成: run_id={run.id} score={score} issues={len(issues)}"
    )
    return output


def _parse_audit_json(raw: str, text: str) -> dict[str, Any]:
    """从 LLM 返的 raw 文本里抽 JSON. 容错:
    - 去掉 ```json ... ``` 包裹
    - 提取第一个 { ... } 段
    - 解析失败返空 (audit 可失败不能挂)
    """
    s = raw.strip()
    # 去掉 markdown code block
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*```$", "", s)
    # 找首个 { 末个 }
    if "{" in s:
        start = s.index("{")
        if "}" in s[start:]:
            end = s.rindex("}")
            s = s[start:end + 1]
    try:
        data = json.loads(s)
    except Exception as e:
        logger.warning(f"audit JSON 解析失败: {e}, raw={raw[:200]}")
        return {"score": 0, "summary": "审计解析失败", "issues": []}
    if not isinstance(data, dict):
        return {"score": 0, "summary": "审计解析失败", "issues": []}
    return data
