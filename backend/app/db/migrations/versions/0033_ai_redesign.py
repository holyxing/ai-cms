"""0033_ai_redesign: AI 重设计任务 (P3.9 「AI 设计」tab)

holy 反馈 2026-06-10 23:05 (#10859):
- LayoutEditPage 「富文本」改名为「AI 设计」
- 加 4 个 AI 动作: optimize_design / responsive / a11y / seo
- 4 套设计语言预设: github / linear / notion / transwarp
- AI 输出新 HTML, 走 diff 对比, 用户接受/拒绝

迁移:
- ai_runs.task_type CheckConstraint 扩 4 个新值
- ai_runs 加 layout_id (FK layouts, NULL OK — 跟 content_id 并列)
- ai_runs 加 design_lang (String 32, NULL OK)
- ai_runs 加 diff_html (Text, NULL OK) — LLM 输出的新 HTML
- ai_runs 加 diff_stats (JSONB, NULL OK) — 改动量统计 (added/removed/changed_lines)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) 改 CheckConstraint — 删旧的, 加新的
    op.drop_constraint("ck_ai_runs_task_type", "ai_runs", type_="check")
    op.create_check_constraint(
        "ck_ai_runs_task_type",
        "ai_runs",
        "task_type IN ('rewrite','expand','shorten','polish','translate','draft',"
        "'audit','theme','image','optimize_design','responsive','a11y','seo')",
    )

    # 2) 加 layout_id (P3.9: AI 重设计是 layout 级别, 不是 content)
    op.add_column(
        "ai_runs",
        sa.Column(
            "layout_id",
            UUID(as_uuid=True),
            sa.ForeignKey("layouts.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_ai_runs_layout_id", "ai_runs", ["layout_id"])

    # 3) 加 design_lang (String 32) — "github" / "linear" / "notion" / "transwarp" / "custom"
    op.add_column(
        "ai_runs",
        sa.Column("design_lang", sa.String(32), nullable=True),
    )

    # 4) 加 diff_html (Text) — LLM 输出的新 HTML (跟 content_id 的 text_out 平行)
    op.add_column(
        "ai_runs",
        sa.Column("diff_html", sa.Text, nullable=True),
    )

    # 5) 加 diff_stats (JSONB) — 改动量统计 {added, removed, changed}
    op.add_column(
        "ai_runs",
        sa.Column("diff_stats", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ai_runs", "diff_stats")
    op.drop_column("ai_runs", "diff_html")
    op.drop_column("ai_runs", "design_lang")
    op.drop_index("ix_ai_runs_layout_id", table_name="ai_runs")
    op.drop_column("ai_runs", "layout_id")

    op.drop_constraint("ck_ai_runs_task_type", "ai_runs", type_="check")
    op.create_check_constraint(
        "ck_ai_runs_task_type",
        "ai_runs",
        "task_type IN ('rewrite','expand','shorten','polish','translate','draft',"
        "'audit','theme','image')",
    )
