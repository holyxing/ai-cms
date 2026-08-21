"""extend ai task types (P3.9.4)

Revision ID: 0035
Revises: 0034
Create Date: 2026-06-11 22:30:00

Add format_html and extract_assets to ai_runs.task_type check constraint.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision: str = '0035'
down_revision: Union[str, None] = '0034'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_ai_runs_task_type", "ai_runs", type_="check")
    op.create_check_constraint(
        "ck_ai_runs_task_type",
        "ai_runs",
        "task_type IN ('rewrite','expand','shorten','polish','translate','draft',"
        "'audit','theme','image','optimize_design','responsive','a11y','seo',"
        "'format_html','extract_assets')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_ai_runs_task_type", "ai_runs", type_="check")
    op.create_check_constraint(
        "ck_ai_runs_task_type",
        "ai_runs",
        "task_type IN ('rewrite','expand','shorten','polish','translate','draft',"
        "'audit','theme','image','optimize_design','responsive','a11y','seo')",
    )
