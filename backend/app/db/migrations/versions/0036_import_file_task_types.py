"""import file task types (P3.9.4+)

Revision ID: 0036
Revises: 0035
Create Date: 2026-06-12 02:10:00

Add import_docx, import_pdf, import_paste_html to ai_runs.task_type check constraint.
holy 反馈 #12096: 文档导入功能
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision: str = '0036'
down_revision: Union[str, None] = '0035'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_ai_runs_task_type", "ai_runs", type_="check")
    op.create_check_constraint(
        "ck_ai_runs_task_type",
        "ai_runs",
        "task_type IN ('rewrite','expand','shorten','polish','translate','draft',"
        "'audit','theme','image','optimize_design','responsive','a11y','seo',"
        "'format_html','extract_assets',"
        "'import_docx','import_pdf','import_paste_html')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_ai_runs_task_type", "ai_runs", type_="check")
    op.create_check_constraint(
        "ck_ai_runs_task_type",
        "ai_runs",
        "task_type IN ('rewrite','expand','shorten','polish','translate','draft',"
        "'audit','theme','image','optimize_design','responsive','a11y','seo',"
        "'format_html','extract_assets')",
    )
