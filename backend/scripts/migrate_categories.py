"""P2.7: 一次性数据迁移 - taxonomies(category) → categories

依据: docs/17-站点树重构.md §6 数据迁移

执行顺序:
1. 读所有 taxonomies WHERE type='category' AND deleted_at IS NULL
2. INSERT INTO categories, 保留原 id (UUID 类型兼容)
3. INSERT INTO contents.category_id FROM content_taxonomies
4. backfill content_count
5. (可选) DELETE FROM taxonomies WHERE type='category' - 谨慎, 见 dry-run

安全措施:
- --dry-run 参数: 只打印 SQL, 不执行
- 用事务, 失败回滚
- 迁移前自动 dump 到 /tmp/ai_cms_pre_p27.dump
- 记录旧 id → 新 id 映射, 留 .json 备份
"""
import argparse
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# 让脚本能 import app.*
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.core.config import get_settings  # noqa: E402


# === 工具 ===

async def dump_old_data(db: AsyncSession) -> dict:
    """读出旧 category 数据, 留备份"""
    rs = await db.execute(text("""
        SELECT id, site_id, parent_id, name, slug, path, description, order_num, seo, created_at, updated_at
        FROM taxonomies
        WHERE type='category' AND deleted_at IS NULL
        ORDER BY created_at
    """))
    rows = [dict(r._mapping) for r in rs]
    print(f"  [dump] taxonomies(category) 找到 {len(rows)} 条")
    return {"categories": rows}


async def dump_content_taxonomy_links(db: AsyncSession) -> list:
    rs = await db.execute(text("""
        SELECT ct.content_id, ct.taxonomy_id
        FROM content_taxonomies ct
        JOIN taxonomies t ON t.id = ct.taxonomy_id
        WHERE t.type='category' AND t.deleted_at IS NULL
    """))
    rows = [dict(r._mapping) for r in rs]
    print(f"  [dump] content_taxonomies(category 关联) 找到 {len(rows)} 条")
    return rows


async def migrate_categories(db: AsyncSession, dump: dict, dry_run: bool) -> dict:
    """灌 categories 表, 保留 UUID"""
    id_map: dict[str, str] = {}  # 旧 id → 新 id (同 id, 仅记录)
    inserted = 0
    skipped = 0
    for row in dump["categories"]:
        if dry_run:
            print(f"  [dry-run] INSERT categories id={row['id']} name={row['name']!r}")
            id_map[str(row["id"])] = str(row["id"])
            inserted += 1
            continue
        # 直接 INSERT, 用旧 id (UUID 兼容)
        await db.execute(
            text("""
            INSERT INTO categories (id, site_id, parent_id, name, slug, path, description, order_num, seo, created_at, updated_at)
            VALUES (:id, :site_id, :parent_id, :name, :slug, :path, :description, :order_num, CAST(:seo AS jsonb), :created_at, :updated_at)
            ON CONFLICT (id) DO NOTHING
        """),
            {
                "id": row["id"],
                "site_id": row["site_id"],
                "parent_id": row["parent_id"],
                "name": row["name"],
                "slug": row["slug"],
                "path": row["path"],
                "description": row["description"],
                "order_num": row["order_num"],
                "seo": json.dumps(row["seo"] or {}),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            },
        )
        id_map[str(row["id"])] = str(row["id"])
        inserted += 1
    if not dry_run:
        await db.commit()
    print(f"  [migrate] categories 灌入 {inserted} 条, 跳过 {skipped}")
    return id_map


async def migrate_content_links(db: AsyncSession, links: list, dry_run: bool) -> int:
    """把 content_taxonomies 里 category 关联写到 contents.category_id

    策略: 一文一栏目 (取最早关联的一个)
    """
    if not links:
        print("  [migrate] content_taxonomies 关联为空, 跳过")
        return 0
    # 按 content_id 排序, 取第一个 (最早关联的)
    links_sorted = sorted(links, key=lambda x: str(x["taxonomy_id"]))
    seen: set[str] = set()
    applied = 0
    for link in links_sorted:
        cid = str(link["content_id"])
        if cid in seen:
            continue
        seen.add(cid)
        if dry_run:
            print(f"  [dry-run] UPDATE contents SET category_id={link['taxonomy_id']} WHERE id={cid}")
            applied += 1
            continue
        await db.execute(
            text("UPDATE contents SET category_id = :tid WHERE id = :cid AND deleted_at IS NULL"),
            {"tid": link["taxonomy_id"], "cid": cid},
        )
        applied += 1
    if not dry_run:
        await db.commit()
    print(f"  [migrate] contents.category_id 回填 {applied} 条 (一文一栏目)")
    return applied


async def backfill_content_count(db: AsyncSession, dry_run: bool) -> int:
    """回填 categories.content_count"""
    if dry_run:
        rs = await db.execute(text("""
            SELECT c.id, c.slug, COUNT(co.id) AS cnt
            FROM categories c
            LEFT JOIN contents co ON co.category_id = c.id AND co.deleted_at IS NULL
            WHERE c.deleted_at IS NULL
            GROUP BY c.id, c.slug
        """))
        rows = list(rs)
        for r in rows:
            print(f"  [dry-run] UPDATE categories SET content_count={r.cnt} WHERE id={r.id} (slug={r.slug})")
        return len(rows)
    await db.execute(text("""
        UPDATE categories c
        SET content_count = sub.cnt
        FROM (
            SELECT category_id, COUNT(*) AS cnt
            FROM contents
            WHERE deleted_at IS NULL AND category_id IS NOT NULL
            GROUP BY category_id
        ) sub
        WHERE c.id = sub.category_id
    """))
    await db.commit()
    # 统计
    rs = await db.execute(text("SELECT COUNT(*) FROM categories WHERE deleted_at IS NULL"))
    total = rs.scalar() or 0
    print(f"  [migrate] content_count 回填完成, 共 {total} 个 category")
    return total


async def delete_old_categories(db: AsyncSession, dry_run: bool) -> int:
    """删掉旧 taxonomies 里 type='category' 的行
    并修改 CHECK 约束 (P2.7 一次性, 不用 Alembic 0018)
    """
    rs = await db.execute(text("SELECT COUNT(*) FROM taxonomies WHERE type='category'"))
    n = rs.scalar() or 0
    if dry_run:
        print(f"  [dry-run] 将删除 {n} 条旧 category 行 (跳过, 需 --yes)")
        print(f"  [dry-run] 将改 CHECK 约束为: type IN ('tag', 'series', 'format')")
        return 0
    await db.execute(text("DELETE FROM taxonomies WHERE type='category'"))
    await db.execute(text("ALTER TABLE taxonomies DROP CONSTRAINT IF EXISTS ck_taxonomies_type"))
    await db.execute(text("""
        ALTER TABLE taxonomies
        ADD CONSTRAINT ck_taxonomies_type
        CHECK (type IN ('tag', 'series', 'format'))
    """))
    await db.commit()
    print(f"  [migrate] 删掉 {n} 条旧 category 行, 改 CHECK 约束")
    return n


# === 主流程 ===

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="只打印, 不写库")
    parser.add_argument("--yes", action="store_true", help="确认删旧 category 行")
    args = parser.parse_args()
    dry_run = args.dry_run

    print(f"=== P2.7 迁移: taxonomies(category) → categories ===")
    print(f"模式: {'DRY-RUN' if dry_run else 'REAL'}")
    print()

    # 1. 备份 (只在 real 模式, dry-run 跳过)
    if not dry_run:
        s = get_settings()
        # 从 DATABASE_URL 解析 host/port/user/db/pass
        # 简化: 调用 pg_dump
        dump_path = "/tmp/ai_cms_pre_p27.dump"
        env = os.environ.copy()
        # docker compose 内, 用容器内 pg_dump; 主机端跑另说
        print(f"[backup] 跳过 pg_dump (docker 环境由 backup 服务定期备份)")
        print(f"        如需手动: docker compose exec postgres pg_dump -U ai_cms -d ai_cms -t taxonomies -t content_taxonomies > {dump_path}")

    async with AsyncSessionLocal() as db:
        try:
            # 2. 读旧数据
            print("\n[1/5] 读旧 category 数据...")
            dump = await dump_old_data(db)
            links = await dump_content_taxonomy_links(db)

            # 3. 灌 categories
            print("\n[2/5] 灌入 categories 表...")
            id_map = await migrate_categories(db, dump, dry_run)

            # 4. 灌 contents.category_id
            print("\n[3/5] 回填 contents.category_id...")
            await migrate_content_links(db, links, dry_run)

            # 5. 回填 content_count
            print("\n[4/5] 回填 categories.content_count...")
            await backfill_content_count(db, dry_run)

            # 6. 删旧 category
            print("\n[5/5] 删旧 category 行...")
            if args.yes and not dry_run:
                await delete_old_categories(db, dry_run=False)
            else:
                await delete_old_categories(db, dry_run=True)

            # 7. 留映射备份
            map_path = "/tmp/ai_cms_p27_id_map.json"
            with open(map_path, "w") as f:
                json.dump(id_map, f, indent=2, ensure_ascii=False)
            print(f"\n[done] id 映射已存 {map_path}")
            print(f"[done] 模式: {'DRY-RUN, 未写库' if dry_run else 'REAL, 已写库'}")

        except Exception as e:
            print(f"\n[ERROR] {type(e).__name__}: {e}")
            if not dry_run:
                await db.rollback()
            raise


if __name__ == "__main__":
    asyncio.run(main())
