"""OpenAI Provider (P3.1)

依据: docs/09-AI集成方案.md §3.2

走原生 httpx (不引 litellm, 保持可控)
- OpenAI 兼容 DeepSeek / Moonshot / 通义千问 / 任何 OpenAI-format API
- 走 /v1/chat/completions
- 支持 stream=true (SSE)
"""
import json
from decimal import Decimal
from typing import AsyncIterator, Optional

import httpx
from loguru import logger

from app.services.llm.base import LLMChunk, LLMMessage, LLMProvider, LLMResponse


class OpenAIProvider(LLMProvider):
    """OpenAI 兼容 provider (OpenAI / DeepSeek / Moonshot / 通义千问)"""

    provider_name = "openai"

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        timeout: float = 60.0,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.timeout,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
            )
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
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        try:
            resp = await client.post(
                f"{self.base_url}/chat/completions", json=payload,
            )
            resp.raise_for_status()
        except httpx.HTTPError as e:
            logger.error(f"OpenAI generate 失败: {e}")
            raise RuntimeError(f"OpenAI 调用失败: {e}") from e

        data = resp.json()
        # P3.1.1 修正: minimax API 可能返 choices=[] (如被限流/空响应)
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError(
                f"OpenAI 返回空 choices: model={model}, "
                f"data={json.dumps(data, ensure_ascii=False)[:200]}"
            )
        choice = choices[0]
        content = choice.get("message", {}).get("content", "")
        usage = data.get("usage", {})
        return LLMResponse(
            content=content,
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            model=model,
            finish_reason=choice.get("finish_reason", "stop"),
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
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},  # 拿 token 统计
        }
        prompt_tokens = 0
        completion_tokens = 0
        try:
            async with client.stream(
                "POST", f"{self.base_url}/chat/completions", json=payload,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    # OpenAI SSE: "data: {...}" 或 "data: [DONE]"
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    if not line:
                        continue
                    if line == "[DONE]":
                        # OpenAI 传统 sentinel, minimax 不发 (P3.1.2 修复)
                        yield LLMChunk(
                            delta="", finish_reason="stop",
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                        )
                        return
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    # OpenAI stream: choices[].delta.content
                    # P3.1.1 修正: minimax API 最后帧 choices=[] 只返 usage, 不能 [0] 访问
                    choices = data.get("choices") or []
                    if choices:
                        delta = choices[0].get("delta", {}).get("content", "")
                        finish = choices[0].get("finish_reason")
                        if delta:
                            yield LLMChunk(delta=delta, finish_reason=finish)
                    # OpenAI / minimax 在最后一个 chunk 给 usage (但 minimax 可能在 [DONE] 之前)
                    if data.get("usage"):
                        prompt_tokens = data["usage"].get("prompt_tokens", 0)
                        completion_tokens = data["usage"].get("completion_tokens", 0)
                        # P3.1.2 修复: minimax 不发 [DONE], usage 帧直接 yield 终结
                        yield LLMChunk(
                            delta="",
                            finish_reason=choices[0].get("finish_reason", "stop") if choices else "stop",
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                        )
                        return
        except httpx.HTTPError as e:
            logger.error(f"OpenAI stream 失败: {e}")
            raise RuntimeError(f"OpenAI stream 失败: {e}") from e

    def count_tokens(self, text: str, model: str) -> int:
        """OpenAI 没有本地 tokenizer, 用近似公式"""
        # 英文: 4 字符 ≈ 1 token; 中文: 1.5 字符 ≈ 1 token
        # 简化: 都按 3 字符/token 估 (偏保守, 留余量)
        return max(1, len(text) // 3)

    def get_cost(
        self, prompt_tokens: int, completion_tokens: int, model: str,
    ) -> Decimal:
        """按模型单价表算 USD

        价格 (2024 数据, 实际用时按需更新)
        """
        from app.services.llm.pricing import PRICING
        rate = PRICING.get(model, PRICING.get("default", {"input": 0, "output": 0}))
        cost = (
            Decimal(str(rate["input"])) * prompt_tokens
            + Decimal(str(rate["output"])) * completion_tokens
        )
        return cost.quantize(Decimal("0.000001"))
