"""Prompt 内置目录：YAML 任务 + 快捷操作 / 增强 / 导入排版

key 约定:
  task.<task_type>     — AI 任务 system prompt
  quick.<name>         — 助手快捷卡覆盖指令
  enhance.<name>       — HTML AI 增强
  import.layout        — 文档导入后排版
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

_PROMPTS_DIR = Path(__file__).parent

# 非 YAML 的内置条目（快捷操作 / 增强 / 导入）
_EXTRA: list[dict[str, Any]] = [
    {
        "key": "quick.title_candidates",
        "label": "起个标题",
        "description": "根据正文生成 3 个候选标题",
        "category": "quick",
        "task_type": "polish",
        "variables": [],
        "content": (
            "根据以下正文生成 3 个候选标题 (每个 ≤ 30 字), 直接输出, 格式:\n"
            "1. 标题1\n2. 标题2\n3. 标题3"
        ),
    },
    {
        "key": "quick.summary",
        "label": "写摘要",
        "description": "100 字以内的文章导读",
        "category": "quick",
        "task_type": "polish",
        "variables": [],
        "content": "为以下正文写一段摘要 (≤ 100 字), 直接输出, 不要前缀。",
    },
    {
        "key": "quick.card_layout",
        "label": "改为卡片布局",
        "description": "列表 → 卡片墙",
        "category": "quick",
        "task_type": "optimize_design",
        "variables": [],
        "content": (
            "把这个模板的列表/表格区改为卡片墙布局: 每项一个卡片, "
            "图片在上文字在下, 卡片之间隙 24-32px, 统一圆角 6-8px"
        ),
    },
    {
        "key": "enhance.style",
        "label": "HTML 样式优化",
        "description": "只优化正文片段的 inline 样式（禁止 html/body）",
        "category": "enhance",
        "task_type": "format_html",
        "variables": ["theme_tokens"],
        "content": (
            "你是站点正文样式优化助手。输入是「正文 HTML 片段」，会被站点模板嵌入，不是完整网页。\n"
            "根据「站点主题 tokens」只优化这段正文的视觉样式与布局。\n"
            "硬性要求：\n"
            "1. 只输出正文片段本身（如 <p>/<section>/<div>/<img> 等业务标签），禁止输出 <!doctype>、<html>、<head>、<body>、<meta>、<title>、<link>、<style>、<script> 等文档级标签\n"
            "2. 禁止包一层新的 <html> 或 <body>；不要生成完整页面骨架\n"
            "3. 只优化样式/布局（清理冗余 inline style、统一字号行高间距），不要改业务文案\n"
            "4. 必须原样保留全部文字，以及全部 <img>/<video>/<audio>/<source>/<picture>/<iframe> 及其 src/srcset/poster/data-src 等属性\n"
            "5. 若出现 @@AICMS_MEDIA_N@@ 占位符，必须原样保留、禁止删除\n"
            "6. 不要做成花哨渐变或大圆角；直接输出片段 HTML，不要 markdown 代码块\n"
            "\n"
            "站点主题 tokens：\n"
            "{theme_tokens}"
        ),
    },
    {
        "key": "enhance.content",
        "label": "HTML 正文优化",
        "description": "错别字 / 润色 / 段落",
        "category": "enhance",
        "task_type": "polish",
        "variables": [],
        "content": (
            "你是中文内容编辑。请优化下面 HTML 正文的文字表达。\n"
            "要求：\n"
            "1. 可修正错别字、病句、标点，润色修饰词，不改变原意与事实\n"
            "2. 必须保留全部业务文字要点，以及全部 <img>/<video>/<audio>/<iframe> 等媒体标签与 URL\n"
            "3. 若出现 @@AICMS_MEDIA_N@@ 占位符，必须原样保留、禁止删除\n"
            "4. 可微调段落划分，但不要删除媒体；直接输出完整 HTML，不要 markdown 代码块"
        ),
    },
    {
        "key": "import.layout",
        "label": "文档导入排版",
        "description": "docx/pdf/粘贴解析后的 HTML 再排版",
        "category": "import",
        "task_type": "format_html",
        "variables": [],
        "content": (
            "你是排版助手。将已解析的文档 HTML 做最小排版修正，输出必须看起来仍是同一篇。\n"
            "硬性要求:\n"
            "1. 禁止重写全文；保留原文内容与媒体标签\n"
            "2. 纯文本可用 <p> 分段，中文段落可加 style=\"text-indent: 2em;\"\n"
            "3. 列表用 <ul>/<ol>，标题用 <h2>/<h3>\n"
            "4. 直接输出 HTML，不要 markdown"
        ),
    },
]

_TASK_LABELS: dict[str, str] = {
    "rewrite": "改写",
    "expand": "扩写",
    "shorten": "缩写",
    "polish": "润色",
    "translate": "翻译",
    "draft": "起稿",
    "format_html": "排版粘贴的文本",
    "audit": "SEO 审计",
    "theme": "改样式 (tokens)",
    "optimize_design": "优化设计",
    "responsive": "适配移动端",
    "a11y": "提升可访问性",
    "seo": "SEO 优化",
    "extract_assets": "提取 CSS/JS",
    "site_agent": "站点智能体",
}


def _load_yaml_tasks() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for path in sorted(_PROMPTS_DIR.glob("*.yaml")):
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception:
            continue
        system = data.get("system")
        if not isinstance(system, str) or not system.strip():
            continue
        task_type = str(data.get("task_type") or path.stem)
        vars_: list[str] = []
        if "{target_lang}" in system:
            vars_.append("target_lang")
        if "{word_count}" in system:
            vars_.append("word_count")
        items.append({
            "key": f"task.{task_type}",
            "label": _TASK_LABELS.get(task_type, task_type),
            "description": str(data.get("description") or ""),
            "category": "task",
            "task_type": task_type,
            "variables": vars_,
            "content": system.strip() + "\n",
        })
    return items


def builtin_catalog() -> list[dict[str, Any]]:
    """全部内置 prompt（YAML 任务 + EXTRA）。"""
    by_key: dict[str, dict[str, Any]] = {}
    for item in _load_yaml_tasks():
        by_key[item["key"]] = item
    for item in _EXTRA:
        by_key[item["key"]] = dict(item)
    return list(by_key.values())


def builtin_by_key(key: str) -> dict[str, Any] | None:
    for item in builtin_catalog():
        if item["key"] == key:
            return item
    return None
