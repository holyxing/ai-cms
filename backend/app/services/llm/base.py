"""LLM 抽象基类 (P3.0)

依据: docs/09-AI集成方案.md §3.1

所有 provider (OpenAI / Anthropic / Ollama) 都实现同一接口:
- generate() 非流式
- stream() AsyncIterator 增量
- count_tokens() 估算
- get_cost() 算 USD
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import AsyncIterator, Optional


@dataclass
class LLMMessage:
    """统一消息格式"""
    role: str  # system | user | assistant
    content: str


@dataclass
class LLMResponse:
    """非流式响应"""
    content: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    model: str = ""
    finish_reason: str = "stop"


@dataclass
class LLMChunk:
    """流式增量"""
    delta: str = ""
    finish_reason: Optional[str] = None
    prompt_tokens: int = 0
    completion_tokens: int = 0


class LLMProvider(ABC):
    """所有 provider 必须实现这 4 个方法"""

    provider_name: str = "base"

    @abstractmethod
    async def generate(
        self,
        messages: list[LLMMessage],
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> LLMResponse:
        """非流式生成"""

    @abstractmethod
    async def stream(
        self,
        messages: list[LLMMessage],
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> AsyncIterator[LLMChunk]:
        """流式生成: 每次 yield 一个 chunk"""

    @abstractmethod
    def count_tokens(self, text: str, model: str) -> int:
        """估算 token 数 (Ollama 用 len//4 近似)"""

    @abstractmethod
    def get_cost(
        self, prompt_tokens: int, completion_tokens: int, model: str,
    ) -> Decimal:
        """算 USD 成本 (Ollama 永远 0)"""
