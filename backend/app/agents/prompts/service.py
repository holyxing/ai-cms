"""AI Prompt 服务：种子、解析、导出导入"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.prompts.loader import clear_cache, get_system_prompt as get_yaml_system_prompt
from app.agents.prompts.registry import builtin_by_key, builtin_catalog, builtin_llm_defaults
from app.models.ai_prompt import AIPrompt

_TEMP_MIN, _TEMP_MAX = 0.0, 2.0
_TOKENS_MIN, _TOKENS_MAX = 256, 32_000


def clamp_temperature(value: float) -> float:
    return max(_TEMP_MIN, min(_TEMP_MAX, float(value)))


def clamp_max_tokens(value: int) -> int:
    return max(_TOKENS_MIN, min(_TOKENS_MAX, int(value)))


def _llm_from_item(item: dict[str, Any]) -> tuple[float, int]:
    t, m = builtin_llm_defaults(
        str(item.get("category") or "task"),
        item.get("task_type"),
        str(item.get("key") or ""),
    )
    if item.get("temperature") is not None:
        t = float(item["temperature"])
    if item.get("max_tokens") is not None:
        m = int(item["max_tokens"])
    return t, m


async def ensure_prompts_seeded(db: AsyncSession) -> int:
    """补齐缺失的内置 prompt；未定制的同步 YAML/目录更新。返回写入条数。"""
    catalog = builtin_catalog()
    existing = {
        r.key: r
        for r in (await db.execute(select(AIPrompt))).scalars().all()
    }
    written = 0
    for item in catalog:
        key = item["key"]
        content = item["content"]
        temp, max_tok = _llm_from_item(item)
        row = existing.get(key)
        if row is None:
            db.add(AIPrompt(
                key=key,
                label=item["label"],
                description=item.get("description") or None,
                category=item["category"],
                task_type=item.get("task_type"),
                content=content,
                builtin_content=content,
                temperature=temp,
                max_tokens=max_tok,
                variables=item.get("variables") or [],
                version=1,
                is_customized=False,
            ))
            written += 1
            continue
        # 元数据与内置底稿始终跟目录走；仅未定制时覆盖 content / LLM 参数
        row.label = item["label"]
        row.description = item.get("description") or None
        row.category = item["category"]
        row.task_type = item.get("task_type")
        row.variables = item.get("variables") or []
        row.builtin_content = content
        if not row.is_customized:
            if row.content != content:
                row.content = content
                written += 1
            if row.temperature != temp or row.max_tokens != max_tok:
                row.temperature = temp
                row.max_tokens = max_tok
                written += 1
        elif row.temperature is None or row.max_tokens is None:
            if row.temperature is None:
                row.temperature = temp
            if row.max_tokens is None:
                row.max_tokens = max_tok
            written += 1
    if written:
        await db.commit()
        clear_cache()
        logger.info(f"AI prompts seeded/updated: {written}")
    return written


async def resolve_prompt_content(
    db: AsyncSession,
    key: str,
    *,
    fallback: str = "",
    variables: Optional[dict[str, Any]] = None,
) -> str:
    """按 key 取 prompt；库无则 YAML/目录；再无则 fallback。"""
    await ensure_prompts_seeded(db)
    row = (await db.execute(select(AIPrompt).where(AIPrompt.key == key))).scalar_one_or_none()
    text = (row.content if row else "") or ""
    if not text.strip():
        builtin = builtin_by_key(key)
        if builtin:
            text = builtin["content"]
        elif key.startswith("task."):
            task_type = key[5:]
            text = get_yaml_system_prompt(task_type, fallback)
        else:
            text = fallback
    if variables:
        try:
            text = text.format(**variables)
        except (KeyError, ValueError):
            # 缺变量时原样返回，避免任务整挂
            pass
    return text


async def resolve_task_system_prompt(
    db: AsyncSession,
    task_type: str,
    fallback: str,
    *,
    variables: Optional[dict[str, Any]] = None,
) -> str:
    return await resolve_prompt_content(
        db, f"task.{task_type}", fallback=fallback, variables=variables,
    )


async def resolve_llm_params(
    db: AsyncSession,
    key: str | None,
    *,
    task_type: str | None = None,
    default_max_tokens: int | None = None,
) -> tuple[float, int]:
    """返回 (temperature, max_tokens)。max_tokens 已钳制；未配置则用 default 或内置。"""
    cat = "task"
    row_key = key or (f"task.{task_type}" if task_type else "")
    row: AIPrompt | None = None
    if row_key:
        row = (await db.execute(select(AIPrompt).where(AIPrompt.key == row_key))).scalar_one_or_none()
    if row is not None:
        cat = row.category
        task_type = row.task_type or task_type
        t_def, m_def = builtin_llm_defaults(cat, task_type, row.key)
        temp = float(row.temperature) if row.temperature is not None else t_def
        mx = row.max_tokens if row.max_tokens is not None else m_def
        return clamp_temperature(temp), clamp_max_tokens(int(mx))

    builtin = builtin_by_key(row_key) if row_key else None
    if builtin:
        t_def, m_def = _llm_from_item(builtin)
        return clamp_temperature(t_def), clamp_max_tokens(int(m_def))

    t_def, m_def = builtin_llm_defaults("task", task_type, row_key)
    return clamp_temperature(t_def), clamp_max_tokens(int(m_def))


def _customized_vs_builtin(row: AIPrompt, builtin: dict[str, Any] | None) -> bool:
    content_b = (builtin["content"] if builtin else row.builtin_content) or ""
    if (row.content or "").strip() != content_b.strip():
        return True
    t_def, m_def = builtin_llm_defaults(row.category, row.task_type, row.key)
    if builtin:
        t_def, m_def = _llm_from_item(builtin)
    rt = float(row.temperature) if row.temperature is not None else t_def
    if abs(rt - float(t_def)) > 1e-6:
        return True
    return (row.max_tokens if row.max_tokens is not None else m_def) != m_def


def prompt_to_dict(row: AIPrompt) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "key": row.key,
        "label": row.label,
        "description": row.description,
        "category": row.category,
        "task_type": row.task_type,
        "content": row.content,
        "builtin_content": row.builtin_content,
        "temperature": row.temperature,
        "max_tokens": row.max_tokens if row.max_tokens is not None else (
            builtin_llm_defaults(row.category, row.task_type, row.key)[1]
        ),
        "variables": row.variables or [],
        "version": row.version,
        "is_customized": row.is_customized,
        "updated_by": str(row.updated_by) if row.updated_by else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


async def update_prompt(
    db: AsyncSession,
    key: str,
    content: str,
    user_id: uuid.UUID | None = None,
    *,
    temperature: float | None = None,
    max_tokens: int | None = None,
    fields_set: set[str] | None = None,
) -> AIPrompt:
    row = (await db.execute(select(AIPrompt).where(AIPrompt.key == key))).scalar_one_or_none()
    if row is None:
        raise KeyError(key)
    row.content = content
    changed = fields_set or {"temperature", "max_tokens"}
    if "temperature" in changed:
        row.temperature = clamp_temperature(temperature) if temperature is not None else None
    if "max_tokens" in changed:
        row.max_tokens = clamp_max_tokens(max_tokens) if max_tokens is not None else None
    row.is_customized = _customized_vs_builtin(row, builtin_by_key(key))
    row.version = int(row.version or 1) + 1
    row.updated_by = user_id
    await db.commit()
    await db.refresh(row)
    clear_cache()
    return row


async def reset_prompt(db: AsyncSession, key: str, user_id: uuid.UUID | None = None) -> AIPrompt:
    row = (await db.execute(select(AIPrompt).where(AIPrompt.key == key))).scalar_one_or_none()
    if row is None:
        raise KeyError(key)
    # 优先用目录最新 builtin
    builtin = builtin_by_key(key)
    if builtin:
        row.builtin_content = builtin["content"]
        t, m = _llm_from_item(builtin)
        row.temperature = t
        row.max_tokens = m
    row.content = row.builtin_content
    row.is_customized = False
    row.version = int(row.version or 1) + 1
    row.updated_by = user_id
    await db.commit()
    await db.refresh(row)
    clear_cache()
    return row


async def export_prompts(db: AsyncSession) -> dict[str, Any]:
    await ensure_prompts_seeded(db)
    rows = (await db.execute(select(AIPrompt).order_by(AIPrompt.category, AIPrompt.key))).scalars().all()
    return {
        "format": "ai-cms-prompts",
        "version": 1,
        "items": [
            {
                "key": r.key,
                "label": r.label,
                "description": r.description,
                "category": r.category,
                "task_type": r.task_type,
                "content": r.content,
                "temperature": r.temperature,
                "max_tokens": r.max_tokens,
                "variables": r.variables or [],
                "is_customized": r.is_customized,
                "version": r.version,
            }
            for r in rows
        ],
    }


async def import_prompts(
    db: AsyncSession,
    items: list[dict[str, Any]],
    *,
    user_id: uuid.UUID | None = None,
    overwrite: bool = True,
) -> dict[str, int]:
    await ensure_prompts_seeded(db)
    existing = {
        r.key: r
        for r in (await db.execute(select(AIPrompt))).scalars().all()
    }
    updated = 0
    created = 0
    skipped = 0
    for raw in items:
        key = (raw.get("key") or "").strip()
        content = raw.get("content")
        if not key or not isinstance(content, str):
            skipped += 1
            continue
        row = existing.get(key)
        if row is None:
            builtin = builtin_by_key(key)
            t_in = raw.get("temperature")
            m_in = raw.get("max_tokens")
            db.add(AIPrompt(
                key=key,
                label=str(raw.get("label") or key),
                description=raw.get("description"),
                category=str(raw.get("category") or "task"),
                task_type=raw.get("task_type"),
                content=content,
                builtin_content=(builtin["content"] if builtin else content),
                temperature=clamp_temperature(float(t_in)) if t_in is not None else None,
                max_tokens=clamp_max_tokens(int(m_in)) if m_in is not None else None,
                variables=raw.get("variables") or [],
                version=1,
                is_customized=True,
                updated_by=user_id,
            ))
            created += 1
            continue
        if not overwrite and row.is_customized:
            skipped += 1
            continue
        row.content = content
        if "temperature" in raw:
            t_in = raw.get("temperature")
            row.temperature = clamp_temperature(float(t_in)) if t_in is not None else None
        if "max_tokens" in raw:
            m_in = raw.get("max_tokens")
            row.max_tokens = clamp_max_tokens(int(m_in)) if m_in is not None else None
        row.is_customized = _customized_vs_builtin(row, builtin_by_key(key))
        row.version = int(row.version or 1) + 1
        row.updated_by = user_id
        if raw.get("label"):
            row.label = str(raw["label"])
        if "description" in raw:
            row.description = raw.get("description")
        updated += 1
    await db.commit()
    clear_cache()
    return {"created": created, "updated": updated, "skipped": skipped}
