"""0030_layout_template_kind: 加 parent_code + template_kind 字段

P3.7 模板重构 (holy 反馈 2026-06-10 10:18):
- 模板分两类: page (页面模板, 默认) / partial (子模板, 可被 HY_TEMPLATE 引用)
- 加 parent_code 字段 (页面模板可"嵌套"另一模板, 关系自指, 可空)
- scope 暂时不动 (目录 = 5 个固定 scope: site/home/category/content/partial)
  - 等等, 5 个 scope 中 partial 是新增 scope

设计:
- template_kind: VARCHAR(16) NOT NULL DEFAULT 'page'
  - check: IN ('page', 'partial')
- parent_code: VARCHAR(64) NULL
  - 不加 FK, 因为 parent 也是 layouts 表行, 但 FK 同表 SQLAlchemy 不支持
  - 唯一性: (site_id, scope, code) + (site_id, scope, parent_code, code) 允许同 code 不同 parent
    → 决定: parent_code 仅作"嵌套引用关系", 不影响唯一性, 不加新 unique
- scope 扩展: 允许 'partial' 作为子模板 scope (跟 LAYOUT_SCOPES 现有 4 个并列)
  → 把 ck_layouts_scope 改 IN ('site','home','category','content','partial')

降级:
- 改 check constraint 为原 4 个值 (会拒绝 partial scope 行, 但默认都是 page)
- drop parent_code + template_kind
"""
from alembic import op
import sqlalchemy as sa

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 扩 check constraint: 允许 'partial' scope
    op.drop_constraint("ck_layouts_scope", "layouts", type_="check")
    op.create_check_constraint(
        "ck_layouts_scope",
        "layouts",
        "scope IN ('site','home','category','content','partial')",
    )

    # 2. 加 template_kind 列
    op.add_column(
        "layouts",
        sa.Column(
            "template_kind",
            sa.String(16),
            nullable=False,
            server_default="page",
        ),
    )
    op.create_check_constraint(
        "ck_layouts_template_kind",
        "layouts",
        "template_kind IN ('page', 'partial')",
    )

    # 3. 加 parent_code 列
    op.add_column(
        "layouts",
        sa.Column(
            "parent_code",
            sa.String(64),
            nullable=True,
        ),
    )
    # 索引: 找"父模板的所有子模板"用
    op.create_index(
        "ix_layouts_parent_code",
        "layouts",
        ["site_id", "scope", "parent_code"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_layouts_parent_code", table_name="layouts")
    op.drop_constraint("ck_layouts_template_kind", "layouts", type_="check")
    op.drop_column("layouts", "parent_code")
    op.drop_column("layouts", "template_kind")
    op.drop_constraint("ck_layouts_scope", "layouts", type_="check")
    op.create_check_constraint(
        "ck_layouts_scope",
        "layouts",
        "scope IN ('site','home','category','content')",
    )
