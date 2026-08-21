"""0031_layout_is_active: 加 is_active 字段 (启用/禁用)

P3.7+ (holy 反馈 2026-06-10 14:59):
- 模板支持禁用 (disabled), 不删除也能隐藏
- 列表默认只显示启用的 (用 ?include_inactive=true 看全部)
- is_active=false 的模板:
  - 不参与发布渲染 (走默认模板 fallback)
  - 卡片 UI 显示"已禁用"灰徽章
  - 仍能编辑/查看/启用 (不丢数据)
- is_active 是独立维度, 跟 is_default 解耦:
  - 默认模板可以禁用 (但禁用期间实际渲染走其他默认)
  - 业务层: 禁用默认模板前不强制转移 (仅 warn 提示)

迁移:
- 加 is_active BOOLEAN NOT NULL DEFAULT TRUE
- 不加索引 (列表 scope 过滤已够用)
- 历史数据全部为 True (server_default 处理)
"""
from alembic import op
import sqlalchemy as sa

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "layouts",
        sa.Column(
            "is_active",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    # 部分老 DB 不会 backfill (如果列已存在) - 但我们新增, 默认值覆盖所有行
    op.execute("UPDATE layouts SET is_active = TRUE WHERE is_active IS NULL")


def downgrade() -> None:
    op.drop_column("layouts", "is_active")
