"""AI 调样式任务 (P3.4)

依据: docs/09-AI集成方案.md §4.4 (theme 任务)

输入:
  - current_tokens: dict  当前站点的 design tokens
  - instruction: str       自然语言描述, 如"主色换成深蓝, 字体更大"
  - site_id: UUID|None     可选, 用于未来读取站点上下文

输出:
  - diff_tokens: dict      partial tokens 覆盖对象 (只含要改的字段)
  - description: str       一句话说明改了什么
  - tokens_used: int

状态机: validate → analyze → generate (3 步)
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Optional

from loguru import logger
from sqlalchemy import select

from app.agents.router import register
from app.models.ai_run import AIRunStep
from app.services.llm.base import LLMMessage
from app.services.llm.factory import get_provider_for_user


# 3 步状态机
_STEPS = ["validate", "analyze", "generate"]

# system prompt: 让 LLM 严格返 JSON (partial tokens 覆盖对象)
# P3.4: 优先读 YAML, 兑底为硬编码字符串
_HARDCODED_THEME_PROMPT = """你是一名 UI 设计令牌 (design tokens) 专家.
用户会给你当前的 design tokens (JSON) 和一段自然语言描述.
你的任务: 根据描述, 输出**部分覆盖**的 tokens JSON, 只包含要改的字段.

输出约束:
1. **严格 JSON**, 不要 ```markdown``` 包裹, 不要任何解释.
2. 只输出要改的字段 (diff/overlay), 不要输出完整 tokens.
3. 颜色统一用 6/8 位 hex (如 "#2563eb" 或 "#2563ebff"), 不要 rgba/hsl.
4. 字体大小用 rem (如 "1.125rem").
5. 圆角用 px (如 "8px") 或 rem.
6. 阴影用 CSS box-shadow 完整语法.
7. 间距用 rem.
8. 一次最多改 5 个字段, 保持克制.

返回 schema:
{
  "description": "一句话说明你做了什么改动 (中文, 不超过 30 字)",
  "diff": {
    "color": { "primary": "#xxx", ... },
    "typography": { "fontSize": { "base": "1rem" }, ... },
    "radius": { "md": "8px" },
    "spacing": { ... },
    "shadow": { ... }
  }
}

可改字段参考 (在 diff 中点路径):
- color.primary / color.secondary / color.accent / color.background / color.text
- typography.fontFamily.base / typography.fontFamily.heading
- typography.fontSize.{xs,sm,base,lg,xl,2xl,3xl}
- typography.fontWeight.{normal,medium,bold}
- radius.{sm,md,lg,xl}
- spacing.{xs,sm,md,lg,xl}
- shadow.{sm,md,lg}"""


@register("theme")
async def ai_theme(run, db, provider_model) -> dict:
    """AI 调样式主函数.

    输入 (run.input):
      - current_tokens: dict  当前 tokens (必须)
      - instruction: str       自然语言描述 (必须)
      - site_id: str|None     可选

    输出:
      - diff_tokens: dict     partial overlay
      - description: str
      - tokens_used: int
      - steps_total: int
    """
    logger.info(f"AI theme 启动: run_id={run.id}")

    input_data: dict = run.input or {}
    current_tokens: Any = input_data.get("current_tokens")
    instruction: str = (input_data.get("instruction") or "").strip()
    site_id = input_data.get("site_id")

    # === 1. validate ===
    if not instruction:
        raise ValueError("instruction 不能为空")
    if len(instruction) > 500:
        raise ValueError(f"instruction 超过 500 字符 (当前 {len(instruction)})")

    # P3.10.4 (holy 反馈 #13214): current_tokens 允许为空, 从 site 当前 active theme version 拉取兑底
    if not isinstance(current_tokens, dict) or not current_tokens:
        if site_id:
            from app.models.theme_version import ThemeVersion
            tv = (await db.execute(
                select(ThemeVersion).where(
                    ThemeVersion.site_id == site_id, ThemeVersion.is_active == True,  # noqa: E712
                )
            )).scalar_one_or_none()
            if tv and isinstance(tv.tokens, dict) and tv.tokens:
                current_tokens = tv.tokens
                logger.info(f"AI theme 从 site={site_id} 拉取 current_tokens 兑底 ({len(tv.tokens)} 键)")
        if not isinstance(current_tokens, dict) or not current_tokens:
            raise ValueError(
                "current_tokens 不能为空且必须是 dict (请先应用主题或在传 site_id 让后端从站点 active theme 拉取)"
            )

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

    # 截断 tokens JSON 防止 prompt 过大
    tokens_str = json.dumps(current_tokens, ensure_ascii=False)
    if len(tokens_str) > 4000:
        tokens_str = tokens_str[:4000] + "..."

    user_prompt = (
        f"当前 tokens:\n{tokens_str}\n\n"
        f"用户需求: {instruction}\n\n"
        f"请输出 diff (只含要改的字段)."
    )

    provider = get_provider_for_user(
        user_id=run.user_id, provider_config=provider_model,
    )
    model = run.model or "qwen2.5:1.5b"

    from app.agents.prompts import resolve_task_system_prompt
    system_prompt = await resolve_task_system_prompt(db, "theme", _HARDCODED_THEME_PROMPT)

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

    # === 3. generate (解析 + 兜底) ===
    parsed = _parse_theme_json(raw, current_tokens)
    diff_tokens: dict = parsed.get("diff", {}) if isinstance(parsed, dict) else {}
    description: str = str(parsed.get("description", "已根据描述调整样式"))[:200] if isinstance(parsed, dict) else "已调整样式"

    # 兜底: 如果 diff 是空, 用 mock fallback (mock 模式常见空响应)
    if not diff_tokens:
        diff_tokens = _mock_diff(instruction, current_tokens)
        if not description:
            description = "已根据描述生成调样式建议 (mock)"

    output = {
        "diff_tokens": diff_tokens,
        "description": description,
        "instruction": instruction,
        "tokens_used": total_prompt_tokens + total_completion_tokens,
        "steps_total": len(_STEPS),
    }

    analyze_step.status = "success"
    analyze_step.finished_at = datetime.now(timezone.utc)
    analyze_step.output = {"diff_field_count": len(diff_tokens), "raw_len": len(raw)}
    analyze_step.delta = raw[:2000]

    gen_step = (await db.execute(
        select(AIRunStep).where(
            AIRunStep.run_id == run.id, AIRunStep.step_name == "generate",
        )
    )).scalar_one()
    gen_step.status = "success"
    gen_step.finished_at = datetime.now(timezone.utc)
    gen_step.output = output

    logger.info(
        f"AI theme 完成: run_id={run.id} diff_keys={list(diff_tokens.keys())}"
    )
    return output


def _parse_theme_json(raw: str, current_tokens: dict) -> dict:
    """从 LLM 返 raw 里抽 JSON. 容错同 audit."""
    s = raw.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*```$", "", s)
    if "{" in s:
        start = s.index("{")
        if "}" in s[start:]:
            end = s.rindex("}")
            s = s[start:end + 1]
    try:
        data = json.loads(s)
    except Exception as e:
        logger.warning(f"theme JSON 解析失败: {e}, raw={raw[:200]}")
        return {"diff": {}, "description": "解析失败, 请重试"}
    if not isinstance(data, dict):
        return {"diff": {}, "description": "解析失败, 请重试"}
    diff = data.get("diff")
    if not isinstance(diff, dict):
        diff = {}
    # 过滤掉非法值 (LLM 偶尔把 null/array 混进来)
    diff = _sanitize_diff(diff)
    return {"diff": diff, "description": str(data.get("description", ""))[:200]}


def _sanitize_diff(d: dict) -> dict:
    """只保留合法标量值, 防止 LLM 返奇怪类型搞坏前端."""
    out: dict = {}
    for k, v in d.items():
        if isinstance(v, dict):
            sub = _sanitize_diff(v)
            if sub:
                out[k] = sub
        elif isinstance(v, (str, int, float, bool)):
            out[k] = v
    return out


def _mock_diff(instruction: str, current_tokens: dict) -> dict:
    """Mock 兜底: 关键词匹配生成可用 diff.

    让 mock provider 或 LLM 失败时, UI 仍能演示.
    """
    ins = instruction.lower()
    diff: dict = {}

    # 主色变化
    if any(k in ins for k in ["蓝", "blue", "深蓝", "浅蓝"]):
        diff.setdefault("color", {})["primary"] = "#1e40af" if "深" in ins else "#3b82f6"
    elif any(k in ins for k in ["红", "red"]):
        diff.setdefault("color", {})["primary"] = "#dc2626"
    elif any(k in ins for k in ["绿", "green"]):
        diff.setdefault("color", {})["primary"] = "#16a34a"
    elif any(k in ins for k in ["紫", "purple"]):
        diff.setdefault("color", {})["primary"] = "#9333ea"

    # 字号
    if any(k in ins for k in ["大", "更大", "字大", "bigger", "larger"]):
        diff.setdefault("typography", {}).setdefault("fontSize", {})["base"] = "1.125rem"
    elif any(k in ins for k in ["小", "字小", "smaller"]):
        diff.setdefault("typography", {}).setdefault("fontSize", {})["base"] = "0.9375rem"

    # 圆角
    if any(k in ins for k in ["圆", "圆角", "round", "rounded"]):
        diff.setdefault("radius", {})["md"] = "12px"
    elif any(k in ins for k in ["方", "直角", "square"]):
        diff.setdefault("radius", {})["md"] = "0px"

    # 暗 / 亮
    if "暗" in ins or "dark" in ins:
        diff.setdefault("color", {})["background"] = "#0f172a"
        diff.setdefault("color", {})["text"] = "#e2e8f0"
    elif "亮" in ins or "light" in ins:
        diff.setdefault("color", {})["background"] = "#ffffff"
        diff.setdefault("color", {})["text"] = "#0f172a"

    return diff
