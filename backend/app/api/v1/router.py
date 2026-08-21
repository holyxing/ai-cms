"""v1 路由聚合"""
from fastapi import APIRouter

from app.api.v1 import auth, sites, members, taxonomies, categories, contents, media, themes, layouts, publish, ai, search
from app.api.v1 import rbac_roles, rbac_users, site_assets, auth_2fa, stats, notifications, site_trash

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(sites.router)
api_router.include_router(members.router)
api_router.include_router(taxonomies.router)
api_router.include_router(categories.router)
api_router.include_router(contents.router)
api_router.include_router(media.router)
api_router.include_router(themes.router)
api_router.include_router(layouts.router)
api_router.include_router(publish.router)
api_router.include_router(ai.router)
api_router.include_router(search.router)
api_router.include_router(rbac_roles.router)
api_router.include_router(rbac_users.router)
api_router.include_router(site_assets.router)
api_router.include_router(auth_2fa.router)
api_router.include_router(stats.router)
api_router.include_router(notifications.router)
api_router.include_router(site_trash.router)
