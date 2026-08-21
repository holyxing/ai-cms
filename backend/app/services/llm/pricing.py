"""LLM 模型价格表 (USD / token)

依据: docs/09-AI集成方案.md §3.3

价格随时变化, 此表作为初始基线, 实际用时按需更新
数字格式: 0.000005 = $0.005 / 1k tokens (OpenAI 官方价)
"""
# 真实价格 (USD / token)
PRICING: dict[str, dict[str, float]] = {
    # OpenAI
    "gpt-4o": {"input": 0.000005, "output": 0.000015},
    "gpt-4o-mini": {"input": 0.00000015, "output": 0.0000006},
    "gpt-4-turbo": {"input": 0.00001, "output": 0.00003},
    "gpt-3.5-turbo": {"input": 0.0000005, "output": 0.0000015},
    # DeepSeek
    "deepseek-chat": {"input": 0.0000001, "output": 0.0000002},
    "deepseek-reasoner": {"input": 0.0000001, "output": 0.0000002},
    # Moonshot
    "moonshot-v1-8k": {"input": 0.000001, "output": 0.000001},
    "moonshot-v1-32k": {"input": 0.000002, "output": 0.000002},
    # 通义千问
    "qwen-turbo": {"input": 0.0000003, "output": 0.0000003},
    "qwen-plus": {"input": 0.0000008, "output": 0.000002},
    # Anthropic
    "claude-3-5-sonnet": {"input": 0.000003, "output": 0.000015},
    "claude-3-haiku": {"input": 0.00000025, "output": 0.00000125},
    # minimax (MiniMax M3) - 参考价, 按官方价表更新
    "MiniMax-M3": {"input": 0.000001, "output": 0.000008},
    "MiniMax-M2.7": {"input": 0.0000008, "output": 0.000006},
    "MiniMax-M2.5": {"input": 0.0000005, "output": 0.000004},
    "MiniMax-M2.7-highspeed": {"input": 0.0000012, "output": 0.000009},
    "MiniMax-M2.5-highspeed": {"input": 0.0000008, "output": 0.000006},
    # minimax 官方 model 名称 (OpenAI 兼容接口)
    "abab6.5s-chat": {"input": 0.000001, "output": 0.000008},
    "abab6.5-chat": {"input": 0.000001, "output": 0.000008},
    "abab7-chat": {"input": 0.000001, "output": 0.000008},
    # 默认 (未知模型 = 0 成本, 不阻塞演示)
    "default": {"input": 0.0, "output": 0.0},
}
