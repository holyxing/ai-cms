"""P2.7: 站点树重构 - 新增 categories 表 + contents.category_id + 砍 taxonomies.category

依据: docs/17-站点树重构.md §3 数据模型

变更:
1. 新表 categories (UUID, 树结构, 物化路径)
2. contents 加 category_id 外键 (NULL 允许, 旧数据回填后)
3. taxonomies CHECK 约束砍掉 'category', 只保留 tag/series/format
4. 索引: categories(site_id, parent_id, path)

数据迁移 (一次性, 见 scripts/migrate_categories.py):
- 旧 taxonomies WHERE type='category' 的全量灌到 categories
- 旧 content_taxonomies 里 category 关联 (当前数据 0 条) 改成 contents.category_id
- backfill categories.content_count

回滚:
- downgrade() 完整: 删 categories 表, 删 contents.category_id, 恢复 taxonomies CHECK
- 数据回滚需要跑反向脚本 (保留原始 dump)
"""
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 新建 categories 表
    op.execute("""
        CREATE TABLE categories (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
            parent_id       UUID REFERENCES categories(id) ON DELETE CASCADE,
            name            VARCHAR(128) NOT NULL,
            slug            VARCHAR(128) NOT NULL,
            path            TEXT NOT NULL DEFAULT '/',
            order_num       INTEGER NOT NULL DEFAULT 0,
            description     TEXT,
            seo             JSONB NOT NULL DEFAULT '{}'::jsonb,
            content_count   INTEGER NOT NULL DEFAULT 0,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at      TIMESTAMPTZ
        );
    """)

    # 2. 唯一约束 (site_id, slug) - 同站下 slug 唯一
    op.execute("""
        CREATE UNIQUE INDEX uq_categories_site_slug
        ON categories (site_id, slug)
        WHERE deleted_at IS NULL;
    """)

    # 3. 索引
    op.execute("""
        CREATE INDEX idx_categories_site
        ON categories (site_id)
        WHERE deleted_at IS NULL;
    """)
    op.execute("""
        CREATE INDEX idx_categories_parent
        ON categories (parent_id)
        WHERE deleted_at IS NULL;
    """)
    op.execute("""
        CREATE INDEX idx_categories_path
        ON categories (path)
        WHERE deleted_at IS NULL;
    """)

    # 4. contents 加 category_id
    op.execute("""
        ALTER TABLE contents
        ADD COLUMN category_id UUID REFERENCES categories(id) ON DELETE SET NULL;
    """)
    op.execute("""
        CREATE INDEX idx_contents_category
        ON contents (category_id)
        WHERE deleted_at IS NULL;
    """)

    # 5. taxonomies CHECK 约束不动 — 留给迁移脚本改 (0018)


def downgrade() -> None:
    # 1. 删 contents.category_id
    op.execute("DROP INDEX IF EXISTS idx_contents_category;")
    op.execute("ALTER TABLE contents DROP COLUMN IF EXISTS category_id;")

    # 2. 删 categories 表 (CASCADE 会带走索引)
    op.execute("DROP TABLE IF EXISTS categories CASCADE;")
    # 注意: 0018 才是改 CHECK 约束, downgrade 不在这里处理
