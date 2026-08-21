"""P3.5.2 静态文件清理

依据: docs/13-P3-进度.md P3.5.2

删除已发布文章时, 同步删除已生成的静态 HTML 文件。
路径: SITES_DATA_DIR/{site_id_or_slug}/public/{slug}/index.html

策略:
- 软删 (DELETE /contents/{id}) - 已发布 → 立即清静态 (回收站可恢复, 但静态需重新发布)
- 永久删 (DELETE /contents/{id}/permanent) - 真删 (清静态)
- 归档 → 不清 (archived 状态文章页仍可能被引用, 取决于站点开关)
- 撤回发布 (published → draft) - 不在 P3.5.2 范围, 留作下个迭代

注意:
- 这是 best-effort: 文件不存在/权限不够 → 不报错, 记日志
- 容器内清理 (API 进程有写权限)
- 实际生产可能用 NFS / 共享卷, 这层抽象对运维透明
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def delete_content_static(site_id: str, site_slug: str, content_slug: str) -> dict:
    """删除一篇文章的静态产物 (best-effort)

    Args:
        site_id: 站点 UUID (主目录可能用这个)
        site_slug: 站点 slug (主目录也可能用这个)
        content_slug: 文章 slug

    Returns:
        {"removed": bool, "tried_paths": list[str], "note": str}
    """
    tried = []
    removed_any = False

    # P2.5 publish 用 site.slug 作为目录 (artifact_dir(slug) 决策)
    # 但 P2 早期可能用 site_id
    candidates = [
        Path(settings.SITES_DATA_DIR) / site_slug / "public" / content_slug,
        Path(settings.SITES_DATA_DIR) / site_id / "public" / content_slug,
    ]
    # 去重
    seen = set()
    candidates = [c for c in candidates if str(c) not in seen and not seen.add(str(c))]

    for path in candidates:
        tried.append(str(path))
        try:
            if path.is_dir():
                shutil.rmtree(path)
                removed_any = True
                logger.info(f"removed static dir: {path}")
            elif path.is_file():
                path.unlink()
                removed_any = True
                logger.info(f"removed static file: {path}")
            else:
                logger.debug(f"static path not found (skip): {path}")
        except PermissionError as e:
            logger.warning(f"permission denied removing {path}: {e}")
        except OSError as e:
            logger.warning(f"OS error removing {path}: {e}")

    return {
        "removed": removed_any,
        "tried_paths": tried,
        "note": "best-effort, 文件不存在/权限不够不报错"
    }


def delete_category_index(site_slug: str, cat_path: str) -> dict:
    """删除栏目首页 index.html 静态文件 (best-effort)

    Args:
        site_slug: 站点 slug
        cat_path: 栏目相对路径，如 "xinwenzixun" 或 "xinwenzixun/zhongbiaozixun"
    """
    tried = []
    removed_any = False
    target = Path(settings.SITES_DATA_DIR) / site_slug / "public" / cat_path / "index.html"
    tried.append(str(target))
    try:
        if target.is_file():
            target.unlink()
            removed_any = True
            logger.info(f"removed category index: {target}")
        else:
            logger.debug(f"category index not found (skip): {target}")
    except (PermissionError, OSError) as e:
        logger.warning(f"error removing {target}: {e}")
    return {"removed": removed_any, "tried_paths": tried}
