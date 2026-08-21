"""P3.5 内容状态机 (State Machine)

依据: docs/12-P2-决策.md §C2 (状态机 - 5 态) + docs/05-开发路线图.md P3.5

5 个状态:
- draft: 草稿 (作者编辑中)
- pending: 待审 (提交给 owner 审核)
- scheduled: 已计划 (到时自动发布)
- published: 已发布
- archived: 已归档 (从主流程下线, 但保留)

转换矩阵 (5×5 = 25 路径):
                   to
from     draft  pending  published  scheduled  archived
draft      ✅      ✅        ✅          ✅        ✅
pending    ✅      ❌        ✅          ❌        ✅
published  ✅      ❌        ❌          ❌        ✅
scheduled  ✅      ❌        ✅(到时)    ❌        ✅
archived   ✅      ❌        ❌          ❌        ❌

权限:
- editor: 可在自己 draft/pending 上做转换 (除 publish → 需 owner)
- owner: 全部
- super_admin: 全部
"""
from __future__ import annotations

from typing import Literal

from app.core.exceptions import BadRequest, Forbidden
from app.models.user import User

ContentStatus = Literal["draft", "pending", "published", "scheduled", "archived"]

# 状态机白名单
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft":     {"draft", "pending", "published", "scheduled", "archived"},
    "pending":   {"draft", "published", "archived"},
    "published": {"draft", "archived"},
    "scheduled": {"draft", "published", "archived"},
    "archived":  {"draft"},
    # P3.6+: 创建阶段 (from_status="none") 可任意起始
    "none":      {"draft", "pending", "published", "scheduled", "archived"},
}

# 状态语义 (中文, 给前端用)
STATUS_LABEL = {
    "draft":     "草稿",
    "pending":   "待审",
    "published": "已发布",
    "scheduled": "已计划",
    "archived":  "已归档",
}

# 各状态下, 哪个角色能"主动发布" (用 publish 端点)
# pending 状态下, 只有 owner 能 approve+publish
PUBLISH_REQUIRED_ROLE = {"owner"}


def check_transition(
    from_status: str,
    to_status: str,
    user: User,
    user_role: str | None,
    *,
    via_endpoint: str = "patch",
) -> None:
    """校验状态转换合法性 + 权限

    Args:
        from_status: 当前状态
        to_status:   目标状态
        user:        当前用户
        user_role:   用户在站点的角色 (owner/editor/viewer/None)
        via_endpoint: 转换走哪个端点 (patch / publish / schedule / archive)
            - patch: 普通字段更新附带的状态变更 (最严格, 不可直接到 published)
            - publish: /publish 端点专用, 允许从任何可达状态到 published
            - schedule: 仅到 scheduled
            - archive: 仅到 archived
            - restore: 仅从 archived 到 draft
    """
    # 1. 同状态 = noop, 跳过校验 (幂等)
    if from_status == to_status:
        return

    # 2. 转换是否在白名单
    allowed = ALLOWED_TRANSITIONS.get(from_status, set())
    if to_status not in allowed:
        raise BadRequest(
            f"状态 '{from_status}' 不能直接跳到 '{to_status}'。"
            f"允许: {sorted(allowed)}"
        )

    # 3. 权限
    is_super = user.is_super_admin
    is_owner = user_role == "owner"
    is_editor = user_role in ("owner", "editor")

    # publish (到 published) 只能 owner / 超管
    if to_status == "published":
        if via_endpoint == "patch":
            raise BadRequest(
                "不可通过普通更新直接发布, 请用 /publish 端点"
            )
        if not (is_super or is_owner):
            raise Forbidden("仅 owner 可发布/审批")

    # archive (从 published / scheduled) 需要 owner (不可逆的归档)
    if to_status == "archived" and from_status in ("published", "scheduled"):
        if not (is_super or is_owner):
            raise Forbidden("归档已发布内容需 owner 权限")

    # schedule (到 scheduled) 需要 editor+
    if to_status == "scheduled" and not is_editor:
        raise Forbidden("无权计划发布")

    # restore (从 archived 到 draft) 任何有写权限的都可
    if to_status == "draft" and from_status == "archived":
        if not is_editor:
            raise Forbidden("无权从归档恢复")
