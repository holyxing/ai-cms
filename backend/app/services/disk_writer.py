"""D5: DiskWriter — PageFile 列表写盘

依据: docs/18-布局系统与标签占位符.md §13 (D5 worker 集成)

设计:
- 纯函数: pages + base_dir → 写文件, 返总字节数
- 安全: 拒绝 path 越界 (../) / 绝对路径
- 目录: 自动创建父目录, mode 0o755
- 文件: 默认 mode 0o644
- 写盘模式: 临时文件 + rename (原子替换, 防 worker crash 半途写入)
"""
from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Iterable

from app.services.page_renderer import PageFile

logger = logging.getLogger(__name__)

# 拒绝的路径模式 (越界 / 绝对 / shell 特殊字符 / NUL 截断)
_BAD_PATH_RE = re.compile(r'(\.\.|//|^[~/]|\\|%00|\x00)', re.IGNORECASE)


def _safe_path(path: str) -> str:
    r"""验证 path 安全

    拒绝:
    - ../ (越界)
    - // (双斜杠, URL 前缀会发 重新拼, 路径不该出现)
    - / 开头 (绝对路径, 应是相对 base_dir)
    - ~ (tilda, shell 展开)
    - \ (反斜杠, Windows 路径)
    - %00 / \x00 (NUL 截断攻击)
    """
    if not path:
        raise ValueError("empty path")
    if _BAD_PATH_RE.search(path):
        raise ValueError(f"unsafe path: {path!r}")
    return path.lstrip("/")


class DiskWriter:
    """写 PageFile 列表到目录"""

    def __init__(self, base_dir: str | Path, file_mode: int = 0o644, dir_mode: int = 0o755) -> None:
        self.base_dir = Path(base_dir)
        self.file_mode = file_mode
        self.dir_mode = dir_mode

    def write_all(self, pages: Iterable[PageFile]) -> int:
        """写所有 pages, 返回总字节数

        P1-补充: 跳过空 path / 不安全 path 的页 (通常足于拼路径不合法)
        全部在 stderr 打 warning, 不 fatal
        """
        total = 0
        skipped = 0
        for p in pages:
            try:
                if not p.path:
                    skipped += 1
                    print(f"[disk_writer] skip page with empty path: page_type={p.page_type} title={p.title!r} warnings={p.warnings}")
                    continue
                rel = _safe_path(p.path)
            except ValueError as e:
                skipped += 1
                print(f"[disk_writer] skip unsafe path: {e} (page: {p.title!r})")
                continue
            total += self.write_one_with_path(p, rel)
        if skipped:
            print(f"[disk_writer] total skipped: {skipped} pages (见上 log)")
        return total

    def write_one_with_path(self, page: PageFile, rel: str) -> int:
        """写单页 (调用方已验证 path) - 原子: 临时文件 → rename"""
        target = self.base_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        # chmod 父目录 (新创建的)
        for parent in [target.parent] + list(target.parents):
            try:
                parent.chmod(self.dir_mode)
            except (FileNotFoundError, PermissionError):
                pass
            if parent == self.base_dir:
                break
        # 写临时文件
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_text(page.html, encoding="utf-8")
        tmp.chmod(self.file_mode)
        # 原子 rename
        tmp.replace(target)
        return len(page.html.encode("utf-8"))

    def write_one(self, page: PageFile) -> int:
        """向后兼容: 老 API, 接受 page, 内部验证 path"""
        rel = _safe_path(page.path)
        return self.write_one_with_path(page, rel)
        logger.info("wrote %s (%d bytes)", target, len(page.html))
        return len(page.html)

    def clean_dir(self) -> int:
        """清空 base_dir (小心: rm -rf), 返删除文件数"""
        if not self.base_dir.exists():
            return 0
        count = 0
        for f in self.base_dir.rglob("*"):
            if f.is_file():
                f.unlink()
                count += 1
        return count


# === build_site + 写盘 顶层函数 (D5 worker 调用) ===

def build_and_write(
    site,
    cats: list,
    contents: list,
    layouts: list,
    base_url: str = "",
    output_dir: str = "",
    build_id: str = "",
    clean_before: bool = True,
    now=None,
    menus_rendered: Optional[dict] = None,
    tags_by_content: Optional[dict] = None,
    asset_urls: Optional[dict] = None,
    assets_by_category: Optional[dict] = None,
    media_urls: Optional[dict] = None,
) -> tuple[list[PageFile], int]:
    """D5 顶层: build_site() + DiskWriter.write_all()

    P3.6.2: asset_urls = 站点静态资源 {name: public_url}, 走 HY_ASSET_URL 标签
    P3.6.5+: assets_by_category = 按 cat 分组的资源 (HY_SITE_CSS / HY_SITE_JS 用)

    Returns:
        (pages, total_bytes)
    """
    from app.services.page_renderer import build_site
    pages = build_site(
        site=site, cats=cats, contents=contents, layouts=layouts,
        base_url=base_url, build_id=build_id, now=now,
        menus_rendered=menus_rendered,
        tags_by_content=tags_by_content,
        asset_urls=asset_urls,
        assets_by_category=assets_by_category,
        media_urls=media_urls,
    )
    if not output_dir:
        return pages, 0
    writer = DiskWriter(output_dir)
    if clean_before:
        writer.clean_dir()
    total = writer.write_all(pages)
    return pages, total
