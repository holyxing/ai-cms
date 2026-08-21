"""P3.1 expand ai_runs task_type check 约束 (加 4 个新任务)

Revision ID: 0013
Revises: 0012
Create Date: 2026-06-05

依据: docs/13-P3-进度.md P3.1 计划
- 0012 漏了 expand/shorten/polish/translate
- 现在 9 个任务: rewrite|expand|shorten|polish|translate|draft|audit|theme|image
"""
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_ai_runs_task_type", "ai_runs", type_="check")
    op.create_check_constraint(
        "ck_ai_runs_task_type", "ai_runs",
        "task_type IN ('rewrite','expand','shorten','polish','translate','draft','audit','theme','image')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_ai_runs_task_type", "ai_runs", type_="check")
    op.create_check_constraint(
        "ck_ai_runs_task_type", "ai_runs",
        "task_type IN ('rewrite','draft','audit','theme','image')",
    )
