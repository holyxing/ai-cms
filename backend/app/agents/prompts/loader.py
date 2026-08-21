"""Prompts 文件化加载器 (P3.4)

依据: docs/09-AI集成方案.md §5 (提示词文件化)

每个任务对应一个 .yaml 文件:
  backend/app/agents/prompts/<task_type>.yaml

格式:
  task_type: rewrite
  version: 1
  system: |
    ...
  defaults:
    max_chars: 8000

加载失败兜底: 用任务模块内硬编码 prompt (向后兼容).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

import yaml

_PROMPTS_DIR = Path(__file__).parent
_cache: dict[str, dict] = {}


def load_prompt(task_type: str) -> Optional[dict[str, Any]]:
    """加载单个任务的 prompt 配置, None 表示无文件."""
    if task_type in _cache:
        return _cache[task_type]
    path = _PROMPTS_DIR / f"{task_type}.yaml"
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    except Exception as e:
        # 加载失败不能挂任务, 返 None 让调用方用硬编码兜底
        from loguru import logger
        logger.warning(f"加载 prompt 文件失败 {path}: {e}")
        return None
    _cache[task_type] = data
    return data


def get_system_prompt(task_type: str, fallback: str) -> str:
    """取 system prompt, 无文件则用 fallback."""
    data = load_prompt(task_type)
    if data and isinstance(data.get("system"), str):
        return data["system"]
    return fallback


def clear_cache() -> None:
    """清缓存 (测试用)."""
    _cache.clear()
