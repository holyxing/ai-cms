"""0032_remove_menu_settings: 删 site.settings.menu_header/footer (P3.7.2 方案 B)

Holy 决策: MenusPage 没渲染价值, 走方案 B 删整个菜单功能.
数据迁移:
- 清空所有 sites.settings 里 menu_header / menu_footer 字段
- 不删表 (本来就没表, 数据存在 settings JSONB 里)

回滚 (downgrade) 不重做菜单数据 — 删了就是删了.
"""
from alembic import op
import sqlalchemy as sa

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # 删 site.settings.menu_header / menu_footer 字段
    bind.execute(sa.text("""
        UPDATE sites
        SET settings = settings - 'menu_header' - 'menu_footer'
        WHERE deleted_at IS NULL
          AND (settings ? 'menu_header' OR settings ? 'menu_footer');
    """))


def downgrade() -> None:
    # 不还原 — 删了就是删了. 想要菜单得走 MenusPage (已删).
    pass
