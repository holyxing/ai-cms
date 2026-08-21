"""Mock LLM Provider (P3.0 临时, 用于无 ollama 时演示)

依据: docs/09-AI集成方案.md §3.2

当 OLLAMA 不可达时, 走 mock:
- 把原文本稍作"改写"演示 (加前后缀 + 字符数)
- 流式返回 (yield 一次 64 字符)
- token 0, cost 0
"""
import asyncio
from decimal import Decimal
from typing import AsyncIterator, Optional

from app.services.llm.base import LLMChunk, LLMMessage, LLMProvider, LLMResponse


class MockProvider(LLMProvider):
    """演示用 mock provider, 不发任何 HTTP"""

    provider_name = "mock"

    def __init__(self, delay: float = 0.05):
        self.delay = delay

    async def generate(
        self, messages, model, temperature=0.7, max_tokens=2048, **kwargs,
    ) -> LLMResponse:
        # 找最后一条 user 消息
        user_msg = next((m for m in reversed(messages) if m.role == "user"), None)
        sys_msg = next((m for m in messages if m.role == "system"), None)
        text = user_msg.content if user_msg else ""
        # P3.3: 审计任务返伪 JSON, 其他任务照改写
        # P3.4: theme 任务返 diff JSON
        if sys_msg and "审计" in sys_msg.content:
            rewritten = self._fake_audit(text)
        elif sys_msg and "design tokens" in sys_msg.content:
            rewritten = self._fake_theme(text)
        else:
            rewritten = self._rewrite(text)
        await asyncio.sleep(0.1)
        return LLMResponse(
            content=rewritten,
            prompt_tokens=len(text) // 4,
            completion_tokens=len(rewritten) // 4,
            model=model,
            finish_reason="stop",
        )

    async def stream(
        self, messages, model, temperature=0.7, max_tokens=2048, **kwargs,
    ) -> AsyncIterator[LLMChunk]:
        user_msg = next((m for m in reversed(messages) if m.role == "user"), None)
        sys_msg = next((m for m in messages if m.role == "system"), None)
        text = user_msg.content if user_msg else ""
        # P3.3: 审计任务返伪 JSON, 其他任务照改写
        # P3.4: theme 任务返 diff JSON
        if sys_msg and "审计" in sys_msg.content:
            rewritten = self._fake_audit(text)
        elif sys_msg and "design tokens" in sys_msg.content:
            rewritten = self._fake_theme(text)
        else:
            rewritten = self._rewrite(text)
        # 切成 16 字符一段流式返回
        chunk_size = 16
        for i in range(0, len(rewritten), chunk_size):
            yield LLMChunk(delta=rewritten[i:i + chunk_size], finish_reason=None)
            await asyncio.sleep(self.delay)
        yield LLMChunk(
            delta="", finish_reason="stop",
            prompt_tokens=len(text) // 4,
            completion_tokens=len(rewritten) // 4,
        )

    def count_tokens(self, text: str, model: str) -> int:
        return max(1, len(text) // 4)

    def get_cost(self, prompt_tokens, completion_tokens, model) -> Decimal:
        return Decimal("0")

    @staticmethod
    def _rewrite(text: str) -> str:
        """演示用改写: 加前缀 + 字数标记"""
        n = len(text)
        return f"【AI改写】{text} (原文 {n} 字符, 已优化表达)"

    @staticmethod
    def _fake_audit(text: str) -> str:
        """P3.3: mock 返一份"审计 JSON", 演示任务流不挂.

        不抽真实 typo, 返 1-2 个 stub issues 证明链路通.
        真实审计需要 ollama + 结构化输出 (P3.5 后才上线).
        """
        import json as _json
        n = len(text)
        issues = []
        if n > 20:
            issues.append({
                "span": [0, min(20, n)],
                "type": "readability",
                "severity": "low",
                "message": "首句较长, 建议拆为 2 句",
                "suggestion": "在逗号处断句",
            })
        if n > 50:
            issues.append({
                "span": [0, 0],
                "type": "seo",
                "severity": "medium",
                "message": "未明确核心关键词",
                "suggestion": "在首段嵌入 1-2 个关键词",
            })
        score = 78 if n > 0 else 0
        return _json.dumps({
            "score": score,
            "summary": f"内容共 {n} 字符, 总体良好 (mock 审计)",
            "issues": issues,
        }, ensure_ascii=False)

    @staticmethod
    def _fake_theme(user_text: str) -> str:
        """P3.4: mock 返一份 theme diff JSON.

        简单关键词匹配, 让无 ollama 时也能演示.
        """
        import json as _json
        ins = user_text.lower()
        diff: dict = {}
        if any(k in ins for k in ["蓝", "blue", "深蓝"]):
            diff.setdefault("color", {})["primary"] = "#1e40af" if "深" in ins else "#3b82f6"
        elif any(k in ins for k in ["红", "red"]):
            diff.setdefault("color", {})["primary"] = "#dc2626"
        elif any(k in ins for k in ["绿", "green"]):
            diff.setdefault("color", {})["primary"] = "#16a34a"
        elif any(k in ins for k in ["紫", "purple"]):
            diff.setdefault("color", {})["primary"] = "#9333ea"
        if any(k in ins for k in ["大", "字大", "bigger", "larger"]):
            diff.setdefault("typography", {}).setdefault("fontSize", {})["base"] = "1.125rem"
        if any(k in ins for k in ["圆", "圆角", "rounded"]):
            diff.setdefault("radius", {})["md"] = "12px"
        if "暗" in ins or "dark" in ins:
            diff.setdefault("color", {})["background"] = "#0f172a"
        return _json.dumps({
            "description": "已根据描述调整主色和字号 (mock)",
            "diff": diff,
        }, ensure_ascii=False)
