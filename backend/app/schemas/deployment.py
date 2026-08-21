"""部署 (Deployment) Pydantic schemas

依据: docs/04b-数据模型.md §4.3
      docs/12-P2-决策.md §B5 (nginx 域名→产物) + §C4 (后台任务) + §C5 (回滚软链) + §E1 (build_log 64KB)
"""
import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# 触发方式
TriggeredBy = Literal["manual", "scheduled", "api", "rollback"]
DeploymentStatus = Literal["pending", "building", "success", "failed", "cancelled"]
DeploymentScope = Literal["site", "category", "content"]


class DeploymentCreate(BaseModel):
    """触发发布 (整站级)"""

    triggered_by: TriggeredBy = "manual"
    # 可选: 指定某个 theme_version, 默认用当前激活的
    theme_version_id: Optional[uuid.UUID] = None
    # P3.6.4: 强制发布, 跳过资源缺失检查 (默认 422 阻断)
    force: bool = False


class CategoryPublishCreate(BaseModel):
    """触发栏目级发布"""

    triggered_by: TriggeredBy = "manual"
    theme_version_id: Optional[uuid.UUID] = None
    force: bool = False


class ContentPublishCreate(BaseModel):
    """触发文章级发布"""

    triggered_by: TriggeredBy = "manual"
    theme_version_id: Optional[uuid.UUID] = None
    force: bool = False


class DeploymentRollback(BaseModel):
    """回滚到某个旧 deployment"""

    target_deployment_id: uuid.UUID
    change_note: str | None = Field(default=None, max_length=500)


class DeploymentRead(BaseModel):
    """部署详情"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    theme_version_id: Optional[uuid.UUID]
    status: str
    triggered_by: str
    trigger_user_id: Optional[uuid.UUID]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    duration_ms: Optional[int]
    content_count: Optional[int]
    artifact_path: Optional[str]
    artifact_size: Optional[int]
    build_log: Optional[str]
    retry_count: int
    error_message: Optional[str]
    created_at: datetime
    # P3.6.1+: 发布粒度
    scope: str = "site"
    scope_id: Optional[uuid.UUID] = None


class DeploymentListItem(BaseModel):
    """部署列表项 (历史页)"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    triggered_by: str
    duration_ms: Optional[int]
    content_count: Optional[int]
    artifact_size: Optional[int]
    retry_count: int
    error_message: Optional[str]
    created_at: datetime
    finished_at: Optional[datetime]
    scope: str = "site"
    scope_id: Optional[uuid.UUID] = None


class RecentDeployment(BaseModel):
    """P3.9.5+ (holy 反馈): Dashboard 最新发布卡片 (跨站)

    跟 DeploymentListItem 区别: 加 site_id + site_slug + site_name, 让 dashboard 不用二次拉站点详情
    P3.9.6+ (holy 反馈 #12565): 加 root_category_id, 让 Dashboard 点击卡片能直接跳该站首个根栏目
                            (免前端二次拉 categories 树)
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    site_slug: str
    site_name: str
    status: str
    triggered_by: str
    duration_ms: Optional[int]
    content_count: Optional[int]
    artifact_size: Optional[int]
    # P3.9.6+: 该站首个根栏目 (parent_id IS NULL, 按 created_at ASC), None = 该站还没栏目
    root_category_id: Optional[uuid.UUID] = None
    created_at: datetime
    finished_at: Optional[datetime]


class DeploymentJobAccepted(BaseModel):
    """POST /publish 返回 202"""

    deployment_id: uuid.UUID
    status: str = "pending"
    message: str = "发布任务已入队"
