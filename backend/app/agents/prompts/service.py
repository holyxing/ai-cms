"""AI Prompt 服务：种子、解析、导出导入"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.prompts.loader import clear_cache, get_system_prompt as get_yaml_system_prompt
from app.agents.prompts.registry import builtin_by_key, builtin_catalog
from app.models.ai_prompt import AIPrompt


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
                variables=item.get("variables") or [],
                version=1,
                is_customized=False,
            ))
            written += 1
            continue
        # 元数据与内置底稿始终跟目录走；仅未定制时覆盖 content
        row.label = item["label"]
        row.description = item.get("description") or None
        row.category = item["category"]
        row.task_type = item.get("task_type")
        row.variables = item.get("variables") or []
        row.builtin_content = content
        if not row.is_customized and row.content != content:
            row.content = content
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
) -> AIPrompt:
    row = (await db.execute(select(AIPrompt).where(AIPrompt.key == key))).scalar_one_or_none()
    if row is None:
        raise KeyError(key)
    row.content = content
    row.is_customized = content.strip() != (row.builtin_content or "").strip()
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
            db.add(AIPrompt(
                key=key,
                label=str(raw.get("label") or key),
                description=raw.get("description"),
                category=str(raw.get("category") or "task"),
                task_type=raw.get("task_type"),
                content=content,
                builtin_content=(builtin["content"] if builtin else content),
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
        row.is_customized = content.strip() != (row.builtin_content or "").strip()
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
