"""P3.0 AI core tables (4 tables: ai_providers / ai_runs / ai_run_steps / ai_usage_daily)

Revision ID: 0012
Revises: 0011
Create Date: 2026-06-05

依据: docs/09-AI集成方案.md §2.1-2.3
依据: docs/05-开发路线图.md P3
依据: docs/12-P2-决策.md (本轮决定 P3 拆 P3.0 最小骨架 + P3.1-P3.5 后续)

P3.0 范围 (本轮):
- 4 张表 (provider, run, step, usage)
- 1 个 provider: ollama
- 1 个任务: ai_rewrite
- SSE 流式

P3.1+ TODO:
- OpenAI/Anthropic provider
- ai_draft / ai_expand / ai_translate / ai_audit / ai_theme
- API key Fernet 加密
- 限流 (10/min)
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # === ai_providers: AI 服务商配置 (per user) ===
    op.create_table(
        "ai_providers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),  # 用户起的别名
        sa.Column("provider", sa.String(32), nullable=False),  # openai | ollama | anthropic
        sa.Column("model", sa.String(128), nullable=False),  # gpt-4o-mini | qwen2.5:7b
        sa.Column("api_key_encrypted", sa.Text, nullable=True),  # Fernet 加密 (P3.1 实现)
        sa.Column("base_url", sa.String(512), nullable=True),  # 自定义 base_url (proxy/ollama)
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.text("FALSE")),
        sa.Column("extra_config", postgresql.JSONB, nullable=True),  # 温度/超时等
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "provider IN ('openai','anthropic','ollama','minimax','custom')",
            name="ck_ai_providers_provider",
        ),
        sa.UniqueConstraint("user_id", "name", name="uq_ai_providers_user_name"),
    )
    op.create_index("idx_ai_providers_user", "ai_providers", ["user_id", "deleted_at"])

    # === ai_runs: AI 任务运行记录 ===
    op.create_table(
        "ai_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("sites.id", ondelete="SET NULL"), nullable=True),
        sa.Column("task_type", sa.String(32), nullable=False),  # rewrite | draft | audit | theme | image
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        # pending | running | success | failed | cancelled
        sa.Column("current_step", sa.String(64), nullable=True),
        sa.Column("steps_total", sa.Integer, nullable=True),
        sa.Column("steps_done", sa.Integer, nullable=False, server_default="0"),
        sa.Column("input", postgresql.JSONB, nullable=False),
        sa.Column("output", postgresql.JSONB, nullable=True),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("ai_providers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column("prompt_tokens", sa.Integer, nullable=True),
        sa.Column("completion_tokens", sa.Integer, nullable=True),
        sa.Column("cost_usd", sa.Numeric(10, 6), nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        # 关联
        sa.Column("content_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("contents.id", ondelete="SET NULL"), nullable=True),
        sa.Column("theme_version_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("theme_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.CheckConstraint(
            "status IN ('pending','running','success','failed','cancelled')",
            name="ck_ai_runs_status",
        ),
        sa.CheckConstraint(
            "task_type IN ('rewrite','draft','audit','theme','image')",
            name="ck_ai_runs_task_type",
        ),
    )
    op.create_index("idx_ai_runs_user_created", "ai_runs", ["user_id", sa.text("created_at DESC")])
    op.create_index(
        "idx_ai_runs_status_pending", "ai_runs", ["status"],
        postgresql_where=sa.text("status IN ('pending','running')"),
    )
    op.create_index("idx_ai_runs_site", "ai_runs", ["site_id", sa.text("created_at DESC")])

    # 0010 教训: migration 漏了 ai_runs.updated_at (TimestampMixin 要求), 补上
    op.add_column("ai_runs", sa.Column("updated_at", sa.DateTime(timezone=True),
                                       server_default=sa.text("NOW()"),
                                       nullable=False))
    # ai_run_steps.updated_at 在下方 create_table 里已声明, 不可在建表前 add_column

    # === ai_run_steps: 状态机步骤 (per run) ===
    op.create_table(
        "ai_run_steps",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("run_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("ai_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_name", sa.String(64), nullable=False),  # validate | generate | sanitize | save
        sa.Column("step_order", sa.Integer, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        # pending | running | success | failed
        sa.Column("input", postgresql.JSONB, nullable=True),
        sa.Column("output", postgresql.JSONB, nullable=True),
        sa.Column("delta", sa.Text, nullable=True),  # 流式增量 (rewrite/draft 用)
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("run_id", "step_order", name="uq_ai_run_steps_run_order"),
        sa.CheckConstraint(
            "status IN ('pending','running','success','failed')",
            name="ck_ai_run_steps_status",
        ),
    )
    op.create_index("idx_ai_run_steps_run", "ai_run_steps", ["run_id", "step_order"])

    # === ai_usage_daily: 每日用量汇总 ===
    op.create_table(
        "ai_usage_daily",
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("usage_date", sa.Date, nullable=False),
        sa.Column("task_type", sa.String(32), nullable=False),
        sa.Column("runs_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tokens_used", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(10, 4), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("user_id", "usage_date", "task_type",
                                name="pk_ai_usage_daily"),
    )
    op.create_index("idx_ai_usage_daily_date", "ai_usage_daily", ["usage_date"])


def downgrade() -> None:
    op.drop_index("idx_ai_usage_daily_date", table_name="ai_usage_daily")
    op.drop_table("ai_usage_daily")
    op.drop_index("idx_ai_run_steps_run", table_name="ai_run_steps")
    op.drop_table("ai_run_steps")
    op.drop_index("idx_ai_runs_site", table_name="ai_runs")
    op.drop_index("idx_ai_runs_status_pending", table_name="ai_runs")
    op.drop_index("idx_ai_runs_user_created", table_name="ai_runs")
    op.drop_table("ai_runs")
    op.drop_index("idx_ai_providers_user", table_name="ai_providers")
    op.drop_table("ai_providers")
