"""site_agent task type + conversation_id (P3.9.6+)

Revision ID: 0037
Revises: 0036
Create Date: 2026-06-12 08:40:00

Add site_agent to ai_runs.task_type check constraint.
Add conversation_id (UUID, nullable, indexed) to ai_runs for multi-turn site agent
dialogue grouping (so users can do "create site → add domain → publish" in one chat).

holy 反馈 #12444: dashboard 站点 AI 智能体
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision: str = '0037'
down_revision: Union[str, None] = '0036'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. 扩展 task_type CHECK
    op.drop_constraint("ck_ai_runs_task_type", "ai_runs", type_="check")
    op.create_check_constraint(
        "ck_ai_runs_task_type",
        "ai_runs",
        "task_type IN ('rewrite','expand','shorten','polish','translate','draft',"
        "'audit','theme','image','optimize_design','responsive','a11y','seo',"
        "'format_html','extract_assets',"
        "'import_docx','import_pdf','import_paste_html',"
        "'site_agent')",
    )
    # 2. 加 conversation_id (UUID, nullable, indexed) - 多轮 site_agent 关联
    op.add_column(
        "ai_runs",
        sa.Column(
            "conversation_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_ai_runs_conversation",
        "ai_runs",
        ["conversation_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_ai_runs_conversation", table_name="ai_runs")
    op.drop_column("ai_runs", "conversation_id")
    op.drop_constraint("ck_ai_runs_task_type", "ai_runs", type_="check")
    op.create_check_constraint(
        "ck_ai_runs_task_type",
        "ai_runs",
        "task_type IN ('rewrite','expand','shorten','polish','translate','draft',"
        "'audit','theme','image','optimize_design','responsive','a11y','seo',"
        "'format_html','extract_assets',"
        "'import_docx','import_pdf','import_paste_html')",
    )
