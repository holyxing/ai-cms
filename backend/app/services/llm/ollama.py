"""Ollama Provider (P3.0)

依据: docs/09-AI集成方案.md §3.2

Ollama 本地 LLM (qwen2.5 / llama3.1 / gemma 等)
走 /api/chat 端点, 支持 stream=true
"""
import json
from decimal import Decimal
from typing import AsyncIterator, Optional

import httpx
from loguru import logger

from app.services.llm.base import LLMChunk, LLMMessage, LLMProvider, LLMResponse


class OllamaProvider(LLMProvider):
    """Ollama 本地 LLM provider"""

    provider_name = "ollama"

    def __init__(self, base_url: str = "http://localhost:11434", timeout: float = 60.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        # 用 AsyncClient 走长连接
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    def _convert_messages(self, messages: list[LLMMessage]) -> list[dict]:
        return [{"role": m.role, "content": m.content} for m in messages]

    async def generate(
        self,
        messages: list[LLMMessage],
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> LLMResponse:
        client = await self._get_client()
        payload = {
            "model": model,
            "messages": self._convert_messages(messages),
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        try:
            resp = await client.post(f"{self.base_url}/api/chat", json=payload)
            resp.raise_for_status()
        except httpx.HTTPError as e:
            logger.error(f"Ollama generate 失败: {e}")
            raise RuntimeError(f"Ollama 调用失败: {e}") from e

        data = resp.json()
        content = data.get("message", {}).get("content", "")
        # Ollama 原生 eval_count 是 output token, prompt_eval_count 是 input
        prompt_tokens = data.get("prompt_eval_count", 0) or 0
        completion_tokens = data.get("eval_count", 0) or 0

        return LLMResponse(
            content=content,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            model=model,
            finish_reason="stop",
        )

    async def stream(
        self,
        messages: list[LLMMessage],
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> AsyncIterator[LLMChunk]:
        client = await self._get_client()
        payload = {
            "model": model,
            "messages": self._convert_messages(messages),
            "stream": True,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        try:
            async with client.stream(
                "POST", f"{self.base_url}/api/chat", json=payload,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if data.get("done"):
                        # 最后一帧: 包含 token 统计
                        yield LLMChunk(
                            delta="",
                            finish_reason="stop",
                            prompt_tokens=data.get("prompt_eval_count", 0) or 0,
                            completion_tokens=data.get("eval_count", 0) or 0,
                        )
                        return
                    msg = data.get("message", {})
                    delta = msg.get("content", "")
                    if delta:
                        yield LLMChunk(delta=delta, finish_reason=None)
        except httpx.HTTPError as e:
            logger.error(f"Ollama stream 失败: {e}")
            raise RuntimeError(f"Ollama stream 失败: {e}") from e

    def count_tokens(self, text: str, model: str) -> int:
        """Ollama 没有 tokenizer, 用近似公式 (4 字符 ≈ 1 token, 英文)"""
        # 中文比例不同, 但粗估够用
        return max(1, len(text) // 4)

    def get_cost(
        self, prompt_tokens: int, completion_tokens: int, model: str,
    ) -> Decimal:
        """Ollama 本地推理, 成本 0"""
        return Decimal("0")
    # 上面是 P3.0 原版, 保留以免误改
