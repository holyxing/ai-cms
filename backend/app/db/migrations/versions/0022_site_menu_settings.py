"""0022_site_menu_settings: 站点菜单存 site.settings JSON (决策 A)

P3.6.1 决策变更: 菜单数据从「独立表 site_menus」回退到「site.settings JSON 字段」,
   跟站点走, 简单直观.

变更:
1) 删除 site_menus 表 (B 方案残留, 已下线)
2) 给每个站点 seed 默认 menu_header (最新文章下拉) + menu_footer (推荐 + 最近)
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1) 删 site_menus 表 (B 方案残留)
    bind.execute(sa.text("DROP TABLE IF EXISTS site_menus CASCADE;"))

    # 2) seed 默认菜单
    default_header = {
        "items": [
            {
                "id": "h-dyn-recent",
                "label": "最新文章",
                "type": "dynamic",
                "dynamic_source": "recent_contents",
                "limit": 5,
            }
        ],
        "is_active": True,
    }
    default_footer = {
        "items": [
            {
                "id": "f-dyn-recent",
                "label": "最近发布",
                "type": "dynamic",
                "dynamic_source": "recent_contents",
                "limit": 5,
            }
        ],
        "is_active": True,
    }

    # 拿所有 active 站点
    rows = bind.execute(sa.text("SELECT id, settings FROM sites WHERE deleted_at IS NULL")).fetchall()
    for site_id, settings in rows:
        new_settings = dict(settings or {})
        new_settings["menu_header"] = default_header
        new_settings["menu_footer"] = default_footer
        bind.execute(
            sa.text("UPDATE sites SET settings = :s WHERE id = :id"),
            {"s": json.dumps(new_settings), "id": site_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    # 删回 menu_header/footer (settings 其他字段保留)
    bind.execute(sa.text("""
        UPDATE sites
        SET settings = settings - 'menu_header' - 'menu_footer'
        WHERE deleted_at IS NULL;
    """))
