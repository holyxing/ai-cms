#!/usr/bin/env python3
"""P4 D1: 演示数据种子

用法:
  python3 scripts/seed_demo.py           # 种子演示数据
  python3 scripts/seed_demo.py --reset   # 先清空再种子

内容:
  - 5 用户 (1 super_admin + 4 editor)
  - 1 站点 (with publish_status='published')
  - 3 栏目 (2 顶级 + 1 子级)
  - 10 文章 (3 published + 2 draft + 1 pending + 1 scheduled + 1 archived + 2 with subtitle)
  - 3 媒体占位 (插入数据库记录, 不真上传到 MinIO)
  - 3 标签 (taxonomy type='tag')
"""
import argparse
import asyncio
import sys
import uuid
from datetime import datetime, timezone, timedelta

# 直接走 db session
sys.path.insert(0, ".")

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.site import Site, SiteDomain  # noqa: E402
from app.models.membership import SiteMember  # noqa: E402
from app.models.category import Category  # noqa: E402
from app.models.taxonomy import Taxonomy  # noqa: E402
from app.models.content import Content, ContentVersion, ContentTaxonomy  # noqa: E402
from app.models.media import Media  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from sqlalchemy import select, delete  # noqa: E402


SITE_SLUG = "demo-site"
USERS = [
    {"email": "admin@aicms.io",     "name": "超级管理员",   "role": "owner"},
    {"email": "editor@aicms.io",    "name": "王编辑",       "role": "editor"},
    {"email": "editor2@aicms.io",   "name": "李编辑",       "role": "editor"},
    {"email": "viewer@aicms.io",    "name": "张访客",       "role": "viewer"},
    {"email": "guest@aicms.io",     "name": "陈访客",       "role": "viewer"},
]

# 演示文章: 3 篇已发布, 2 草稿, 1 待审, 1 计划, 1 归档
ARTICLES = [
    {
        "title": "欢迎使用 AI-CMS",
        "subtitle": "一个让多站点内容管理更轻的平台",
        "excerpt": "AI-CMS 是面向独立团队的多站点内容平台, 集成 AI 协作与静态发布。",
        "body": "<h2>什么是 AI-CMS</h2><p>AI-CMS 是面向独立团队的多站点内容平台, 集成 AI 协作与静态发布。</p><h3>核心特性</h3><ul><li>多站点隔离</li><li>富文本编辑 (Tiptap)</li><li>媒体管理 (MinIO)</li><li>静态发布 (Astro SSG)</li><li>全文搜索</li><li>5 态内容工作流</li></ul>",
        "status": "published",
    },
    {
        "title": "快速上手指南",
        "subtitle": "5 分钟创建你的第一个站点",
        "excerpt": "本文带你 5 分钟创建第一个站点, 并发布第一篇文章。",
        "body": "<h2>创建站点</h2><p>在仪表盘点击\"新建站点\"。</p><h2>添加栏目</h2><p>站点创建后, 在左侧栏目树添加分类。</p><h2>写文章</h2><p>点击\"写文章\"开始创作。</p><h2>发布</h2><p>完成后点击\"发布\", 状态会变成已发布。</p>",
        "status": "published",
    },
    {
        "title": "AI 协作改写入门",
        "subtitle": "让 AI 帮你润色/扩写/翻译",
        "excerpt": "AI 改写是 AI-CMS 的核心能力之一, 集成本地 Ollama 模型。",
        "body": "<h2>基本流程</h2><p>在编辑器右侧选择\"AI 改写\", 描述你的需求, AI 会流式返回改写后的内容。</p><h2>支持的指令</h2><ul><li>润色</li><li>扩写</li><li>缩写</li><li>翻译 (英/日)</li><li>风格转换</li></ul><p>所有 AI 交互都基于本地 Ollama, 数据不出本机。</p>",
        "status": "published",
    },
    {
        "title": "理解内容工作流 (5 态)",
        "subtitle": "draft / pending / published / scheduled / archived",
        "excerpt": "AI-CMS 采用 5 态内容工作流, 让协作更清晰。",
        "body": "<h2>5 态介绍</h2><ul><li><strong>draft</strong> 草稿</li><li><strong>pending</strong> 待审核</li><li><strong>published</strong> 已发布</li><li><strong>scheduled</strong> 计划发布</li><li><strong>archived</strong> 已归档</li></ul><h2>状态机</h2><p>所有跳转走状态机白名单, 防止意外。</p>",
        "status": "draft",
    },
    {
        "title": "全文搜索的 N 种玩法",
        "subtitle": "tsvector + ILIKE 兜底",
        "excerpt": "我们用 PG tsvector 做英文搜索, ILIKE 兜底中文。",
        "body": "<h2>架构</h2><p>搜索走 content_versions.body 触发器。</p><h2>fallback</h2><p>ILIKE 在 tsvector 不命中的情况下兜底。</p>",
        "status": "draft",
    },
    {
        "title": "Tiptap 编辑器高级技巧",
        "subtitle": "块编辑 + 图片粘贴 + 拖拽",
        "excerpt": "Tiptap 让富文本像 Notion 一样简单。",
        "body": "<p>本文将介绍 Tiptap 的高级用法。</p>",
        "status": "pending",
    },
    {
        "title": "定时发布上线公告",
        "subtitle": "下次发布: 1 小时后",
        "excerpt": "测试计划发布功能是否按 worker 60s 节奏触发。",
        "body": "<h1>定时发布</h1><p>本文设置 1 小时后自动发布, 用于验证 scheduler。</p>",
        "status": "scheduled",
        "scheduled_delta_minutes": 60,
    },
    {
        "title": "历史归档: 旧版用户手册",
        "subtitle": "v0.5 用户手册",
        "excerpt": "已废弃的用户手册, 归档保留。",
        "body": "<p>旧版手册, 不再维护。</p>",
        "status": "archived",
    },
    {
        "title": "媒体上传最佳实践",
        "subtitle": "MinIO presigned + 客户端直传",
        "excerpt": "大文件走 presigned URL, 减少后端带宽。",
        "body": "<p>大文件 (>= 1MB) 走 MinIO presigned 客户端直传, 小文件走后端中转。</p>",
        "status": "published",
    },
    {
        "title": "权限矩阵: 谁能看到什么",
        "subtitle": "super_admin > owner > editor > viewer",
        "excerpt": "5 角色矩阵控制站点内所有资源访问。",
        "body": "<h2>角色</h2><ul><li>super_admin - 全局</li><li>owner - 站点所有者</li><li>editor - 编辑</li><li>contributor - 投稿</li><li>viewer - 只读</li></ul>",
        "status": "published",
    },
]


async def reset(db):
    """清空演示数据 (按 site_slug)"""
    site = (await db.execute(select(Site).where(Site.slug == SITE_SLUG))).scalar_one_or_none()
    if not site:
        return
    # 清媒体
    await db.execute(delete(Media).where(Media.site_id == site.id))
    # 清 content_version
    contents = (await db.execute(select(Content).where(Content.site_id == site.id))).scalars().all()
    for c in contents:
        await db.execute(delete(ContentVersion).where(ContentVersion.content_id == c.id))
    await db.execute(delete(ContentTaxonomy).where(
        ContentTaxonomy.taxonomy_id.in_(
            select(Taxonomy.id).where(Taxonomy.site_id == site.id)
        )
    ))
    await db.execute(delete(Content).where(Content.site_id == site.id))
    await db.execute(delete(Taxonomy).where(Taxonomy.site_id == site.id))
    await db.execute(delete(Category).where(Category.site_id == site.id))
    await db.execute(delete(SiteMember).where(SiteMember.site_id == site.id))
    await db.execute(delete(SiteDomain).where(SiteDomain.site_id == site.id))
    await db.execute(delete(Site).where(Site.id == site.id))
    # 清 5 个 demo 用户 (保留)
    # 不删用户, 反复种子不破坏登录
    await db.commit()
    print(f"  🗑️  清空站点 {SITE_SLUG} 完成")


async def ensure_users(db):
    """创建 5 个用户 (已存在则跳过)"""
    out = {}
    for u in USERS:
        r = await db.execute(select(User).where(User.email == u["email"]))
        existing = r.scalar_one_or_none()
        if existing:
            out[u["email"]] = existing
            continue
        user = User(
            id=uuid.uuid4(),
            email=u["email"],
            name=u["name"],
            password_hash=hash_password("demo123456"),  # 演示统一密码
            is_active=True,
            is_super_admin=(u["role"] == "owner" and u["email"] == "admin@aicms.io"),
        )
        db.add(user)
        await db.flush()
        out[u["email"]] = user
        print(f"  👤 新建用户 {u['email']} ({u['role']})")
    return out


async def create_site_and_taxonomy(db, users):
    """建站点 + 域名 + 成员 + 栏目 + 标签"""
    # 站点
    site = Site(
        id=uuid.uuid4(),
        slug=SITE_SLUG,
        name="AI-CMS 演示站点",
        description="包含 10 篇文章, 3 个栏目, 5 个成员。",
        owner_id=users["admin@aicms.io"].id,
        status="active",
        publish_status="published",
        settings={
            "theme": "default",
            "language": "zh-CN",
            "timezone": "Asia/Shanghai",
        },
    )
    db.add(site)
    await db.flush()

    # 域名
    db.add(SiteDomain(
        id=uuid.uuid4(),
        site_id=site.id,
        domain=f"{SITE_SLUG}.localhost",
        type="primary",
    ))

    # 成员
    for u in USERS:
        user = users[u["email"]]
        db.add(SiteMember(
            id=uuid.uuid4(),
            user_id=user.id,
            site_id=site.id,
            name=u["role"],
        ))

    # 栏目 (3 个: 教程/AI/归档 + 1 子级)
    cat_tutorial = Category(
        id=uuid.uuid4(), site_id=site.id, name="教程", slug="tutorial",
        path="", parent_id=None, order_num=1,
    )
    cat_ai = Category(
        id=uuid.uuid4(), site_id=site.id, name="AI 协作", slug="ai",
        path="", parent_id=None, order_num=2,
    )
    db.add_all([cat_tutorial, cat_ai])
    await db.flush()
    # 子级
    cat_ai_sub = Category(
        id=uuid.uuid4(), site_id=site.id, name="改写技巧", slug="ai-tips",
        path="", parent_id=cat_ai.id, order_num=1,
    )
    db.add(cat_ai_sub)
    await db.flush()
    # 物化路径
    cat_tutorial.path = f"/{cat_tutorial.id}/"
    cat_ai.path = f"/{cat_ai.id}/"
    cat_ai_sub.path = f"/{cat_ai.id}/{cat_ai_sub.id}/"

    # 标签 (taxonomy)
    tag_python = Taxonomy(
        id=uuid.uuid4(), site_id=site.id, type="tag", name="Python",
        slug="python", path=f"/{uuid.uuid4()}/", parent_id=None,
    )
    tag_ai = Taxonomy(
        id=uuid.uuid4(), site_id=site.id, type="tag", name="AI",
        slug="ai", path=f"/{uuid.uuid4()}/", parent_id=None,
    )
    tag_frontend = Taxonomy(
        id=uuid.uuid4(), site_id=site.id, type="tag", name="前端",
        slug="frontend", path=f"/{uuid.uuid4()}/", parent_id=None,
    )
    db.add_all([tag_python, tag_ai, tag_frontend])
    await db.flush()

    return site, [cat_tutorial, cat_ai, cat_ai_sub], [tag_python, tag_ai, tag_frontend]


async def create_articles(db, site, users, categories, tags):
    """建 10 篇文章 + content_version"""
    admin = users["admin@aicms.io"]
    editor = users["editor@aicms.io"]

    tag_cycle = [tags[0], tags[1], tags[2], None]  # 轮询分配
    cat_cycle = [categories[0], categories[1], categories[2]]  # 教程/AI/AI子

    for i, art in enumerate(ARTICLES):
        now = datetime.now(timezone.utc)
        # 计算 scheduled_at
        sched_at = None
        if art["status"] == "scheduled":
            sched_at = now + timedelta(minutes=art.get("scheduled_delta_minutes", 60))
        # published_at
        pub_at = None
        if art["status"] == "published":
            pub_at = now - timedelta(days=10 - i)
        if art["status"] == "archived":
            pub_at = now - timedelta(days=30)
            sched_at = None

        author = admin if i % 2 == 0 else editor
        slug = f"demo-{i+1:02d}"
        c = Content(
            id=uuid.uuid4(),
            site_id=site.id,
            author_id=author.id,
            title=art["title"],
            subtitle=art.get("subtitle"),
            slug=slug,
            excerpt=art.get("excerpt"),
            status=art["status"],
            category_id=cat_cycle[i % 3].id,
            scheduled_at=sched_at,
            published_at=pub_at,
            view_count=(i + 1) * 17,  # 演示
        )
        db.add(c)
        await db.flush()
        # content_version
        db.add(ContentVersion(
            id=uuid.uuid4(),
            content_id=c.id,
            version_num=1,
            title=c.title,
            body=art["body"],
            author_id=author.id,
        ))
        # content_taxonomy (主标签)
        tag = tag_cycle[i % 4]
        if tag:
            db.add(ContentTaxonomy(
                content_id=c.id,
                taxonomy_id=tag.id,
                is_primary=True,
            ))


async def create_media(db, site, users):
    """建 3 个媒体占位记录 (不真上传 MinIO, 只入库)"""
    editor = users["editor@aicms.io"]
    samples = [
        {"filename": "cover-1.png", "mime": "image/png",  "size": 102400,  "url": "/seed/cover-1.png"},
        {"filename": "diagram.svg", "mime": "image/svg+xml", "size": 5120,   "url": "/seed/diagram.svg"},
        {"filename": "doc.pdf",     "mime": "application/pdf", "size": 524288, "url": "/seed/doc.pdf"},
    ]
    for s in samples:
        m = Media(
            id=uuid.uuid4(),
            site_id=site.id,
            uploader_id=editor.id,
            filename=s["filename"],
            object_key=f"seed/{s['filename']}",
            mime_type=s["mime"],
            size_bytes=s["size"],
        )
        db.add(m)


async def main(reset_first=False):
    async with AsyncSessionLocal() as db:
        if reset_first:
            print("=== 清空旧演示数据 ===")
            await reset(db)
        print("=== 创建/更新用户 ===")
        users = await ensure_users(db)
        print("=== 建站点 + 栏目 + 标签 ===")
        site, categories, tags = await create_site_and_taxonomy(db, users)
        print(f"  🌐 站点: {site.slug} (id={site.id})")
        print(f"  📂 栏目: {[c.name for c in categories]}")
        print(f"  🏷️  标签: {[t.name for t in tags]}")
        print("=== 建文章 + 版本 ===")
        await create_articles(db, site, users, categories, tags)
        print(f"  📝 {len(ARTICLES)} 篇文章")
        print("=== 建媒体占位 ===")
        await create_media(db, site, users)
        print(f"  🖼️  3 个媒体记录 (未上传实际文件)")
        await db.commit()

    print("\n=== 种子完成 ===")
    print("登录账号 (统一密码 demo123456):")
    for u in USERS:
        print(f"  {u['email']:25s}  {u['name']:8s}  ({u['role']})")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--reset", action="store_true", help="先清空演示数据再种子")
    args = p.parse_args()
    asyncio.run(main(reset_first=args.reset))
