"""AI 改写任务 (P3.0 兼容入口)

依据: docs/09-AI集成方案.md §4.2
依据: docs/13-P3-进度.md

P3.1 重构: 实际逻辑在 _text_transform.py (rewrite/expand/shorten/polish/translate/draft 共用)
本文件保留仅为 P3.0 兼容 (被 router.py 引用 ai_rewrite)
"""
# 触发 _text_transform.py 的 register 注册
from app.agents.tasks._text_transform import ai_rewrite  # noqa: F401
