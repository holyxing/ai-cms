"""P2.6: sites.publish_status 字段

依据: 用户要求 2026-06-05
目的: 站点维度展示"发布状态", 用于 Publish / Sites 页面 badge

枚举 (5 个):
- never_published   未发布过
- building          有 pending/building 的 deployment
- published         最新 deployment = success
- failed            最新 deployment = failed, 且没有更早的 success
- out_of_sync        已发布过, 但有未发布的草稿/修改 (P2.6 暂不实现, 留 enum)

回写策略:
- worker 在 deployment 状态变 success/failed/cancelled 时调用 site_publish_status.recompute_and_persist()
- 该函数重新查 site 的 latest deployments, 算出权威值并写回
"""
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 加列 (默认 never_published, 历史数据已发过的会被 backfill 改成 published)
    op.execute("""
        ALTER TABLE sites
        ADD COLUMN publish_status VARCHAR(20) NOT NULL DEFAULT 'never_published';
    """)

    # 2. check 约束
    op.execute("""
        ALTER TABLE sites
        ADD CONSTRAINT ck_sites_publish_status
        CHECK (publish_status IN ('never_published', 'building', 'published', 'failed', 'out_of_sync'));
    """)

    # 3. 索引 (Sites 页可能按状态过滤)
    op.create_index("ix_sites_publish_status", "sites", ["publish_status"])

    # 4. backfill: 给历史 success 的 site 标 published
    op.execute("""
        UPDATE sites s
        SET publish_status = 'published'
        WHERE deleted_at IS NULL
          AND EXISTS (
              SELECT 1 FROM deployments d
              WHERE d.site_id = s.id
                AND d.status = 'success'
          )
          AND NOT EXISTS (
              SELECT 1 FROM deployments d
              WHERE d.site_id = s.id
                AND d.status IN ('pending', 'building')
          );
    """)

    # 5. backfill: 有 pending/building 的标 building
    op.execute("""
        UPDATE sites s
        SET publish_status = 'building'
        WHERE deleted_at IS NULL
          AND EXISTS (
              SELECT 1 FROM deployments d
              WHERE d.site_id = s.id
                AND d.status IN ('pending', 'building')
          );
    """)


def downgrade() -> None:
    op.drop_index("ix_sites_publish_status", table_name="sites")
    op.drop_constraint("ck_sites_publish_status", "sites", type_="check")
    op.drop_column("sites", "publish_status")
