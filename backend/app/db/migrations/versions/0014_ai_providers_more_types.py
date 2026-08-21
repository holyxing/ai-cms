"""P3.1.1 扩 ai_providers.provider check 约束 (加 minimax + custom)

Revision ID: 0014
Revises: 0013
Create Date: 2026-06-05

依据: docs/14-AI-Provider-扩展指南.md
依据: 用户需求 (2026-06-05) "接入 minimax 大模型" + "本地 LLM"

provider 取值: openai | anthropic | ollama | minimax | custom
- openai: api.openai.com/v1
- anthropic: api.anthropic.com (P3.2 TODO)
- ollama: localhost:11434 (本地)
- minimax: api.minimaxi.com/v1 (OpenAI 兼容)
- custom: 任何 OpenAI-format API (DeepSeek/Moonshot/通义/...)
"""
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_ai_providers_provider", "ai_providers", type_="check")
    op.create_check_constraint(
        "ck_ai_providers_provider", "ai_providers",
        "provider IN ('openai','anthropic','ollama','minimax','custom')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_ai_providers_provider", "ai_providers", type_="check")
    op.create_check_constraint(
        "ck_ai_providers_provider", "ai_providers",
        "provider IN ('openai','anthropic','ollama')",
    )
