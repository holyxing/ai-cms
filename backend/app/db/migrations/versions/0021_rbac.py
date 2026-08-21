"""RBAC: 角色 + 权限 + 全局角色绑定

依据: docs/10-权限矩阵.md (P0 需求, 2026-06-06)

变更:
1) roles 表 - 全局角色 (super_admin 也在内)
   - code 唯一: super_admin / owner / editor / viewer + 后续自定义
   - is_system 标识内置角色, 不可删除/改 code
   - description 描述
2) role_permissions - 角色-权限多对多
3) user_roles - 用户-角色绑定 (一个用户可有多个角色, super_admin 不绑 site)
4) seed: 50 条 permission + 4 个系统角色 + 把现有 super_admin 用户绑 super_admin role

注: 站点级角色 (owner/editor/viewer) 走现有 site_members 表 (P1.2b 已实现),
    本次新增的是「全局角色」用于 user management / role management 模块 UI 显示.
    系统默认用户的 site-scoped role 优先, super_admin 旁路.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


# === 权限定义 (50 条, 6 大类) ===
# code 格式: "<resource>:<action>[:<scope>]"
PERMISSIONS_SEED = [
    # 1. 站点管理 (9)
    ("site:list", "site", "查看站点列表"),
    ("site:create", "site", "创建新站点"),
    ("site:read", "site", "查看站点详情"),
    ("site:update", "site", "编辑站点基本信息"),
    ("site:settings", "site", "编辑站点设置 (SEO/域名)"),
    ("site:domain:add", "site", "添加/删除域名"),
    ("site:archive", "site", "归档/恢复站点"),
    ("site:delete", "site", "删除站点"),
    ("site:transfer", "site", "转移站点所有权"),
    # 2. 成员管理 (4)
    ("member:list", "member", "查看成员列表"),
    ("member:invite", "member", "邀请新成员"),
    ("member:update", "member", "修改成员角色"),
    ("member:remove", "member", "移除成员"),
    # 3. 栏目管理 (6)
    ("category:list", "category", "查看栏目树"),
    ("category:create", "category", "创建栏目"),
    ("category:read", "category", "查看栏目详情"),
    ("category:update", "category", "编辑栏目"),
    ("category:delete", "category", "删除栏目"),
    ("category:reorder", "category", "拖拽排序"),
    # 4. 内容管理 (10)
    ("content:list", "content", "查看内容列表"),
    ("content:create", "content", "创建内容"),
    ("content:read", "content", "查看内容"),
    ("content:update:own", "content", "编辑自己的内容"),
    ("content:update:any", "content", "编辑他人的内容"),
    ("content:delete:own", "content", "删除自己的内容"),
    ("content:delete:any", "content", "删除他人的内容"),
    ("content:publish", "content", "发布内容"),
    ("content:unpublish", "content", "取消发布"),
    ("content:schedule", "content", "计划发布"),
    # 5. 媒体管理 (6)
    ("media:list", "media", "查看媒体库"),
    ("media:upload", "media", "上传媒体"),
    ("media:delete:own", "media", "删除自己上传的媒体"),
    ("media:delete:any", "media", "删除他人上传的媒体"),
    ("media:folder:manage", "media", "创建/删除文件夹"),
    ("media:update:any", "media", "编辑媒体元数据"),
    # 6. 主题/布局 (6)
    ("theme:list", "theme", "查看主题列表"),
    ("theme:apply", "theme", "切换主题"),
    ("theme:edit", "theme", "编辑主题 tokens"),
    ("theme:ai", "theme", "AI 改主题"),
    ("theme:rollback", "theme", "回滚主题版本"),
    ("layout:edit", "layout", "编辑布局模板 HTML"),
    # 7. 发布管理 (3)
    ("deployment:list", "deployment", "查看发布历史"),
    ("deployment:trigger", "deployment", "触发手动发布"),
    ("deployment:cdn", "deployment", "触发 CDN 刷新"),
    # 8. AI 功能 (5)
    ("ai:key:manage", "ai", "配置 AI Key"),
    ("ai:draft", "ai", "AI 起稿/改写"),
    ("ai:image", "ai", "AI 配图"),
    ("ai:audit", "ai", "AI 审计"),
    ("ai:rag", "ai", "AI 智能问答 (RAG)"),
    # 9. 系统管理 (5)
    ("user:list", "user", "查看用户列表"),
    ("user:create", "user", "创建用户"),
    ("user:update", "user", "编辑用户"),
    ("user:delete", "user", "删除用户"),
    ("user:role:assign", "user", "分配全局角色"),
    ("role:list", "role", "查看角色列表"),
    ("role:create", "role", "创建角色"),
    ("role:update", "role", "编辑角色"),
    ("role:delete", "role", "删除角色"),
    ("system:audit", "system", "查看系统日志"),
    ("system:backup", "system", "备份/恢复"),
]


# === 系统角色 + 权限集 (4 个内置) ===
SYSTEM_ROLES_SEED = [
    {
        "code": "super_admin",
        "name": "超级管理员",
        "description": "全平台, 跨站, 最高权限 (系统内置, 不可删除)",
        "permissions": "*",  # 全部权限
    },
    {
        "code": "site_owner",
        "name": "站点所有者",
        "description": "单站所有者, 站点内全部操作权限",
        "permissions": [
            "site:list", "site:read", "site:update", "site:settings",
            "site:domain:add", "site:archive", "site:delete", "site:transfer",
            "member:list", "member:invite", "member:update", "member:remove",
            "category:list", "category:create", "category:read", "category:update",
            "category:delete", "category:reorder",
            "content:list", "content:create", "content:read",
            "content:update:own", "content:update:any",
            "content:delete:own", "content:delete:any",
            "content:publish", "content:unpublish", "content:schedule",
            "media:list", "media:upload",
            "media:delete:own", "media:delete:any",
            "media:folder:manage", "media:update:any",
            "theme:list", "theme:apply", "theme:edit", "theme:ai", "theme:rollback",
            "layout:edit",
            "deployment:list", "deployment:trigger", "deployment:cdn",
            "ai:key:manage", "ai:draft", "ai:image", "ai:audit", "ai:rag",
        ],
    },
    {
        "code": "site_editor",
        "name": "站点编辑",
        "description": "单站编辑, 可创建/编辑内容, 不能删除他人内容或发布",
        "permissions": [
            "site:list", "site:read",
            "member:list",
            "category:list", "category:create", "category:read", "category:update", "category:reorder",
            "content:list", "content:create", "content:read",
            "content:update:own", "content:delete:own",
            "content:schedule",
            "media:list", "media:upload",
            "media:delete:own", "media:folder:manage",
            "theme:list", "theme:edit",
            "ai:key:manage", "ai:draft", "ai:image", "ai:audit", "ai:rag",
            "deployment:list",
        ],
    },
    {
        "code": "site_viewer",
        "name": "站点查看者",
        "description": "单站只读, 仅查看已发布内容",
        "permissions": [
            "site:list", "site:read",
            "member:list",
            "category:list", "category:read",
            "content:list", "content:read",
            "media:list",
            "theme:list",
            "ai:rag",
            "deployment:list",
        ],
    },
]


def upgrade() -> None:
    # 1) roles 表
    op.create_table(
        "roles",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("code", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_roles_code", "roles", ["code"], unique=True)

    # 2) permissions 表
    op.create_table(
        "permissions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("code", sa.String(128), nullable=False, unique=True),
        sa.Column("resource", sa.String(64), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_permissions_code", "permissions", ["code"], unique=True)
    op.create_index("ix_permissions_resource", "permissions", ["resource"])

    # 3) role_permissions 多对多
    op.create_table(
        "role_permissions",
        sa.Column(
            "role_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("roles.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "permission_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("permissions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "granted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # 4) user_roles 用户-角色绑定
    op.create_table(
        "user_roles",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "role_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("roles.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "assigned_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "assigned_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # === Seed: 50 权限 ===
    permissions_table = sa.table(
        "permissions",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("code", sa.String),
        sa.column("resource", sa.String),
        sa.column("description", sa.Text),
    )
    op.bulk_insert(
        permissions_table,
        [
            {
                "code": code,
                "resource": resource,
                "description": desc,
            }
            for (code, resource, desc) in PERMISSIONS_SEED
        ],
    )

    # === Seed: 4 系统角色 ===
    roles_table = sa.table(
        "roles",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("code", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.Text),
        sa.column("is_system", sa.Boolean),
    )

    # 生成固定 ID 便于后续 seed role_permissions
    import uuid as _uuid
    role_ids = {
        r["code"]: _uuid.uuid5(_uuid.NAMESPACE_DNS, f"ai-cms.role.{r['code']}")
        for r in SYSTEM_ROLES_SEED
    }

    op.bulk_insert(
        roles_table,
        [
            {
                "id": role_ids[r["code"]],
                "code": r["code"],
                "name": r["name"],
                "description": r["description"],
                "is_system": True,
            }
            for r in SYSTEM_ROLES_SEED
        ],
    )

    # === Seed: role_permissions 绑定 ===
    rp_table = sa.table(
        "role_permissions",
        sa.column("role_id", postgresql.UUID(as_uuid=True)),
        sa.column("permission_id", postgresql.UUID(as_uuid=True)),
    )

    # 拉所有 permissions 一次性建 code → id 映射
    conn = op.get_bind()
    perms = conn.execute(
        sa.text("SELECT id, code FROM permissions")
    ).fetchall()
    perm_id_by_code = {p.code: p.id for p in perms}

    rp_rows = []
    for r in SYSTEM_ROLES_SEED:
        role_id = role_ids[r["code"]]
        if r["permissions"] == "*":
            codes = list(perm_id_by_code.keys())
        else:
            codes = r["permissions"]
        for code in codes:
            if code not in perm_id_by_code:
                continue
            rp_rows.append({
                "role_id": role_id,
                "permission_id": perm_id_by_code[code],
            })
    if rp_rows:
        op.bulk_insert(rp_table, rp_rows)

    # === 数据迁移: 把现有 is_super_admin=true 的用户绑 super_admin role ===
    ur_table = sa.table(
        "user_roles",
        sa.column("user_id", postgresql.UUID(as_uuid=True)),
        sa.column("role_id", postgresql.UUID(as_uuid=True)),
    )

    super_users = conn.execute(
        sa.text("SELECT id FROM users WHERE is_super_admin = true")
    ).fetchall()
    if super_users:
        op.bulk_insert(
            ur_table,
            [
                {
                    "user_id": u.id,
                    "role_id": role_ids["super_admin"],
                }
                for u in super_users
            ],
        )


def downgrade() -> None:
    op.drop_table("user_roles")
    op.drop_table("role_permissions")
    op.drop_table("permissions")
    op.drop_table("roles")
