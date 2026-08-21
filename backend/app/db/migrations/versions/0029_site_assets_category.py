"""0029_site_assets_category: 内置 3 目录 (css/js/assets) + 按扩展名归类

P3.6.5 改造:
- 加 category 字段 (VARCHAR(16), NOT NULL, default 'assets')
- 改 unique: (site_id, category, name) 替代 (site_id, name), 跨目录允许同名
- check: category IN ('css', 'js', 'assets')
- 一次性 backfill: 按 name 扩展名归类
  - .css → 'css'
  - .js  → 'js'
  - 其他 → 'assets'

降级: NOT NULL 字段不能直接 drop, 改 default + drop 重做
"""
from alembic import op
import sqlalchemy as sa

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 加 column (NOT NULL DEFAULT 'assets', 但 SQLAlchemy 加列时现有行会用 default)
    op.add_column(
        "site_assets",
        sa.Column(
            "category",
            sa.String(16),
            nullable=False,
            server_default="assets",
        ),
    )

    # 2. 一次性 backfill: 按 name 扩展名归类
    op.execute(
        "UPDATE site_assets SET category = 'css' WHERE name ILIKE '%.css'"
    )
    op.execute(
        "UPDATE site_assets SET category = 'js' WHERE name ILIKE '%.js'"
    )
    # 剩余的 (其他扩展名) 已经是 default 'assets'

    # 3. check constraint
    op.create_check_constraint(
        "ck_site_assets_category",
        "site_assets",
        "category IN ('css', 'js', 'assets')",
    )

    # 4. 改 unique: 先 drop 旧的, 加新的
    op.drop_constraint("uq_site_assets_site_name", "site_assets", type_="unique")
    op.create_unique_constraint(
        "uq_site_assets_site_cat_name",
        "site_assets",
        ["site_id", "category", "name"],
    )

    # 5. 加 index 加速按 category 查询
    op.create_index(
        "ix_site_assets_site_category",
        "site_assets",
        ["site_id", "category"],
    )


def downgrade() -> None:
    op.drop_index("ix_site_assets_site_category", table_name="site_assets")
    op.drop_constraint("uq_site_assets_site_cat_name", "site_assets", type_="unique")
    op.drop_constraint("ck_site_assets_category", "site_assets", type_="check")
    op.drop_column("site_assets", "category")
    # 还原旧 unique
    op.create_unique_constraint(
        "uq_site_assets_site_name", "site_assets", ["site_id", "name"],
    )
