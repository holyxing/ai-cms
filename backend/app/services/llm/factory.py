"""LLM Provider 工厂 (P3.0)

依据: docs/09-AI集成方案.md §3.2

根据 AIProvider 配置 (provider + model + base_url + api_key) 创建对应实例
P3.0 范围: ollama
P3.1+ TODO: openai / anthropic (走 litellm)
"""
from typing import Optional

from app.core.config import get_settings
from app.models.ai_provider import AIProvider as AIProviderModel
from app.core.crypto import decrypt_api_key
from app.services.llm.base import LLMProvider
from app.services.llm.ollama import OllamaProvider
from app.services.llm.openai import OpenAIProvider
from app.services.llm.mock import MockProvider


_provider_cache: dict[int, LLMProvider] = {}


def _probe_ollama(base_url: str) -> bool:
    """健康检查 ollama: 返 200 + 至少有一个模型可用 (避免 /api/tags OK 但 /api/chat 404)
    P3.0 决策 #1: 不可达降级 mock
    """
    import httpx as _httpx
    try:
        with _httpx.Client(timeout=2.0) as c:
            r = c.get(f"{base_url}/api/tags")
            if r.status_code != 200:
                return False
            data = r.json()
            models = data.get("models") or []
            return len(models) > 0
    except Exception:
        return False


def get_provider_for_user(
    user_id, provider_config: Optional[AIProviderModel] = None,
) -> LLMProvider:
    """根据用户配置获取 provider 实例

    Args:
        user_id: 用户 ID (用于缓存)
        provider_config: AIProvider 模型实例, None 时用 settings.OLLAMA_BASE_URL 默认

    P3.0: Ollama (不可达降级 mock)
    P3.1: OpenAI 兼容 (需有效 api_key, 否则降级 mock)
    """
    settings = get_settings()

    # 优先用传入的 provider 配置
    if provider_config:
        provider_name = provider_config.provider
        # P3-minimax: 按 provider 选默认 base_url
        if provider_config.base_url:
            base_url = provider_config.base_url
        elif provider_name == "minimax":
            base_url = settings.MINIMAX_BASE_URL
        elif provider_name == "openai":
            base_url = settings.OPENAI_BASE_URL
        else:
            base_url = settings.OLLAMA_BASE_URL
    else:
        # 没传 provider_config → 强制 ollama (P3.0 唯一默认)
        provider_name = "ollama"
        base_url = settings.OLLAMA_BASE_URL

    # P3.0 简化: 不缓存 (P3.1+ 性能优化再加 LRU)

    if provider_name == "ollama":
        if _probe_ollama(base_url):
            provider = OllamaProvider(base_url=base_url)
        else:
            from loguru import logger
            logger.warning(f"Ollama 不可达 ({base_url}), 降级到 MockProvider")
            provider = MockProvider()
    elif provider_name in ("openai", "minimax", "custom"):
        # OpenAI 兼容协议: OpenAI / minimax / custom (DeepSeek/Moonshot/通义...)
        # decrypt_api_key (Fernet)
        # P3-minimax: 优先用 provider_config 里的 key (per-user), 否则 settings 全局兑底
        if provider_config and provider_config.api_key_encrypted:
            api_key = decrypt_api_key(provider_config.api_key_encrypted)
        elif provider_name == "minimax":
            api_key = settings.MINIMAX_API_KEY
        elif provider_name == "openai":
            api_key = settings.OPENAI_API_KEY
        else:
            api_key = ""
        if not api_key:
            from loguru import logger
            logger.warning(f"{provider_name} 无 api_key, 降级到 MockProvider")
            provider = MockProvider()
        else:
            provider = OpenAIProvider(api_key=api_key, base_url=base_url)
    elif provider_name == "anthropic":
        # P3.2 TODO
        raise NotImplementedError("Anthropic P3.2 实现")
    else:
        raise NotImplementedError(f"Provider '{provider_name}' 未知")

    return provider


def clear_cache():
    """清缓存 (测试用)"""
    _provider_cache.clear()
