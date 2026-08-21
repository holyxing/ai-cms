"""models 模块 - 集中 import 以触发 SQLAlchemy 注册"""
from app.models.base import SoftDeleteMixin, TimestampMixin
from app.models.user import User
from app.models.site import Site, SiteDomain
from app.models.membership import SiteMember, Invitation, SITE_ROLES
from app.models.taxonomy import Taxonomy
from app.models.content import Content, ContentVersion, ContentTaxonomy
from app.models.category import Category
from app.models.media import Media, MediaFolder, MediaRelation
from app.models.theme import Theme
from app.models.theme_version import ThemeVersion
from app.models.layout import Layout, LayoutVersion, LAYOUT_SCOPES
from app.models.deployment import Deployment
from app.models.content_snapshot import ContentSnapshot
from app.models.ai_provider import AIProvider
from app.models.ai_run import AIRun, AIRunStep, AIUsageDaily
from app.models.ai_prompt import AIPrompt
from app.models.rbac import Role, Permission, RolePermission, UserRole
from app.models.site_asset import SiteAsset
from app.models.password_reset import PasswordReset
from app.models.user_2fa import User2FA
from app.models.user_notification import UserNotification
# P3.6.1 决策 A: site_menu 模型已下线, 菜单存 site.settings JSON
# from app.models.site_menu import SiteMenu  # removed 2026-06-06

__all__ = [
    "User",
    "Site",
    "SiteDomain",
    "SiteMember",
    "Invitation",
    "SITE_ROLES",
    "Taxonomy",
    "Content",
    "ContentVersion",
    "ContentTaxonomy",
    "Category",
    "Media",
    "MediaFolder",
    "MediaRelation",
    "Theme",
    "ThemeVersion",
    "Layout",
    "LayoutVersion",
    "LAYOUT_SCOPES",
    "Deployment",
    "ContentSnapshot",
    "AIProvider",
    "AIRun",
    "AIRunStep",
    "AIUsageDaily",
    "AIPrompt",
    "Role",
    "Permission",
    "RolePermission",
    "UserRole",
    "SiteMenu",
    "PasswordReset",
    "User2FA",
    "UserNotification",
    "TimestampMixin",
    "SoftDeleteMixin",
]