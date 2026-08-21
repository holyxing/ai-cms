/**
 * Media.tsx - 站点媒体库 (P3.6.1 完善版)
 *
 * 功能:
 * - 拖放 / 点击上传 (MinIO presigned)
 * - 文件夹管理 (CRUD, 一级平铺)
 * - 搜索 (filename 模糊) + 文件类型 tab (全部/图片/视频/文档)
 * - 预览弹窗 (查看元数据 + 编辑 alt_text + 复制 URL + 删除)
 * - 草稿页: 卡片 (缩略图/文件名/大小/mime 标签/上传者)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  Upload, Image as ImageIcon, FileText, Folder, Trash2, X, Loader2,
  Search, Copy, Check, FileVideo, FileArchive, Film, Music, Tag, Plus,
  ExternalLink, ClipboardCopy, ImageDown,
} from 'lucide-react';
import { Button, Card, Input, Label, Badge, EmptyState, ConfirmDialog } from '@/components/ui';
import { mediaApi, type MediaItem, type MediaFolder, type MediaTag, type MediaTagRef } from '@/api/media';
import { sitesApi } from '@/api/sites';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth';

function formatSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function isImage(mime: string) {
  return mime.startsWith('image/');
}

/** P3.9.6+ (holy 反馈 #12693): MIME → 友好名 (避免 vnd.openxmlformats... 这种长串)
 * - image/png → PNG
 * - application/pdf → PDF
 * - long mime → 从 filename 后缀推断 (DOCX/XLSX/PPTX/MD/...)
 * - fallback: 截取 / 后一段
 */
function friendlyMime(mime: string, filename?: string): string {
  const short: Record<string, string> = {
    'image/png': 'PNG',
    'image/jpeg': 'JPG',
    'image/jpg': 'JPG',
    'image/gif': 'GIF',
    'image/webp': 'WebP',
    'image/svg+xml': 'SVG',
    'application/pdf': 'PDF',
    'application/zip': 'ZIP',
    'text/plain': 'TXT',
    'text/html': 'HTML',
    'text/markdown': 'MD',
    'text/css': 'CSS',
    'application/javascript': 'JS',
    'application/json': 'JSON',
  };
  if (short[mime]) return short[mime];
  // 从 filename 推断
  if (filename) {
    const ext = filename.toLowerCase().split('.').pop() || '';
    const commonExts: Record<string, string> = {
      'docx': 'DOCX', 'doc': 'DOC', 'xlsx': 'XLSX', 'xls': 'XLS',
      'pptx': 'PPTX', 'ppt': 'PPT', 'csv': 'CSV',
      'mp4': 'MP4', 'mov': 'MOV', 'avi': 'AVI', 'webm': 'WebM',
      'mp3': 'MP3', 'wav': 'WAV', 'ogg': 'OGG', 'flac': 'FLAC',
      'rar': 'RAR', '7z': '7Z', 'tar': 'TAR', 'gz': 'GZ',
    };
    if (commonExts[ext]) return commonExts[ext];
  }
  // 未知 MIME: 取 / 后一段并截断
  const part = mime.split('/')[1] || mime;
  return part.length > 10 ? part.slice(0, 10) + '…' : part;
}

interface UploadItem {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress?: number;
  error?: string;
}

export default function Media() {
  return <MediaView />;
}

export { MediaView };

export interface MediaViewProps {
  /** 站点 ID (不传则从 URL params 拿) */
  siteId?: string;
  /** 是否为内嵌模式 (为 true 时去掉外层 padding/标题, 适配 tab 嵌入) */
  embedded?: boolean;
}

/**
 * MediaView - 媒体库可复用视图
 * - 默认导出 Media() 走 useParams 拿 siteId, 保留独立路由
 * - 也可被其他页面以 <MediaView siteId={...} embedded /> 形式内嵌
 */
function MediaView({ siteId: propSiteId, embedded = false }: MediaViewProps = {}) {
  const { siteId: paramSiteId = '' } = useParams<{ siteId: string }>();
  const siteId = propSiteId ?? paramSiteId;
  const user = useAuthStore((s) => s.user);
  const canWrite = user?.is_super_admin;  // 简化为 super_admin 才能上传 (P1.5 UX)
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [folderId, setFolderId] = useState<string | undefined>();
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  // P3.6.2 F: 标签
  const [tags, setTags] = useState<MediaTag[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]); // 选中按名 AND 过滤
  const [editingTags, setEditingTags] = useState(false);
  const [tagDraftIds, setTagDraftIds] = useState<string[]>([]);
  // P3.9.1+ in-app dialog (holy 反馈 #11266)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  // P3.6.1: 批量 (B) + 拖拽 (D) + 引用检查弹窗 (A)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<{ count: number; references: Array<{ type: string; id: string; title: string; context: string }> } | null>(null);
  const [usageTarget, setUsageTarget] = useState<MediaItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MediaItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  // P3.6.1 完善: 搜索 + 类型筛选 + 复制反馈 + alt 编辑
  const [q, setQ] = useState('');
  const [mimePrefix, setMimePrefix] = useState<string | undefined>(undefined);
  // P3.9.7+ (holy 反馈 #12808): 侧栏媒体库目录项点击 → URL 带 ?mime= → 这里同步到 state
  // URL → state 单向同步: 用户从侧栏带 filter 跳过来时, 直接命中对应类型
  // (state → URL 不写回, 避免在 tab 内点类型 tab 时反复 push history)
  const [searchParams] = useSearchParams();
  const mimeFromUrl = searchParams.get('mime') ?? undefined;
  useEffect(() => {
    setMimePrefix(mimeFromUrl);
  }, [mimeFromUrl]);
  const [urlCopied, setUrlCopied] = useState(false);
  const [editingAlt, setEditingAlt] = useState(false);
  const [altDraft, setAltDraft] = useState('');
  // P3.6.2 G: 全局素材库开关
  const [onlyShared, setOnlyShared] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const r = await mediaApi.list(siteId, {
        page,
        page_size: 24,
        folder_id: folderId,
        mime_prefix: mimePrefix,
        q: q.trim() || undefined,
        tags: tagFilter.length ? tagFilter.join(',') : undefined,
        only_shared: onlyShared,
      });
      setItems(r.data.data!.items);
      setTotal(r.data.data!.total);
    } catch {
      toast.error('加载媒体失败');
    } finally {
      setLoading(false);
    }
  }, [siteId, page, folderId, mimePrefix, q, tagFilter, onlyShared]);

  const loadFolders = useCallback(async () => {
    try {
      const r = await mediaApi.listFolders(siteId);
      setFolders(r.data.data!.items);
    } catch { /* ignore */ }
  }, [siteId]);

  const loadTags = useCallback(async () => {
    try {
      const r = await mediaApi.listTags(siteId);
      setTags(r.data.data!);
    } catch { /* ignore */ }
  }, [siteId]);

  useEffect(() => { loadItems(); }, [loadItems]);
  useEffect(() => { loadFolders(); }, [loadFolders]);
  useEffect(() => { loadTags(); }, [loadTags]);

  // P3.6.1: 搜索 debounce (300ms)
  const [qDebounced, setQDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  // qDebounced 变化 -> 重置 page=1 -> 重新加载
  useEffect(() => {
    setPage(1);
  }, [qDebounced, mimePrefix, folderId, tagFilter, onlyShared]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!canWrite) { toast.error('无权上传'); return; }
    const list: UploadItem[] = Array.from(files).map((f) => ({
      id: `${Date.now()}-${Math.random()}`,
      file: f,
      status: 'pending' as const,
    }));
    setUploads((u) => [...u, ...list]);

    for (const u of list) {
      setUploads((prev) => prev.map((p) => p.id === u.id ? { ...p, status: 'uploading' } : p));
      try {
        await mediaApi.upload(siteId, u.file, { folder_id: folderId }).then((r) => r.data.data!);
        setUploads((prev) => prev.map((p) => p.id === u.id ? { ...p, status: 'done' } : p));
      } catch (e: any) {
        setUploads((prev) => prev.map((p) => p.id === u.id ? { ...p, status: 'error', error: e.message } : p));
      }
    }
    await loadItems();
  };

  // P3.6.1: 删除带引用检查 (A)
  // - 点 “删除” 按钮: 先查 usage, 0 引用 直接确认; >0 弹引用明细 (二次确认 force)
  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      // 试删 (无 force)
      await mediaApi.remove(siteId, confirmDelete.id, false);
      toast.success('已删除');
      setConfirmDelete(null);
      loadItems();
    } catch (e: any) {
      // 409 = 有引用, 弹引用明细弹窗
      if (e?.response?.status === 409) {
        const detail = e.response.data?.detail;
        setUsageTarget(confirmDelete);
        setUsageData({ count: detail?.count ?? 0, references: [] });
        setConfirmDelete(null);
        // 异步加载明细列表
        try {
          const u = await mediaApi.getUsage(siteId, confirmDelete.id);
          setUsageData({ count: u.count, references: u.references });
        } catch { /* ignore */ }
      } else {
        toast.error(e?.response?.data?.message || e?.message || '删除失败');
      }
    } finally {
      setDeleting(false);
    }
  };

  // 强制删除 (跳过引用检查)
  const handleForceDelete = async () => {
    if (!usageTarget) return;
    setDeleting(true);
    try {
      await mediaApi.remove(siteId, usageTarget.id, true);
      toast.success('已删除');
      setUsageTarget(null);
      setUsageData(null);
      loadItems();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await mediaApi.createFolder(siteId, { name: newFolderName.trim(), parent_id: folderId });
      setNewFolderName('');
      setShowNewFolder(false);
      loadFolders();
      toast.success('文件夹已创建');
    } catch {
      toast.error('创建失败');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  // P3.6.1: 复制 URL (点击预览弹窗“复制 URL” 按钮)
  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setUrlCopied(true);
      toast.success('URL 已复制');
      setTimeout(() => setUrlCopied(false), 1500);
    } catch {
      toast.error('复制失败, 请手动选择');
    }
  };

  // P3.9.4 (holy 反馈 #12044): 复制图片到剪贴板 (不是 URL) - 可贴到微信/语雀/Notion
  // navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]) 是唯一能写图片的 API
  // 跨域图片 fetch 需要 CORS (MinIO 已设 MINIO_API_CORS_ALLOW_ORIGIN=*)
  const [imgCopied, setImgCopied] = useState(false);
  const handleCopyImage = async (item: MediaItem) => {
    if (!isImage(item.mime_type)) {
      toast.error('只有图片可以复制到剪贴板');
      return;
    }
    try {
      const r = await fetch(item.url, { mode: 'cors', credentials: 'omit' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      if (!blob.type.startsWith('image/')) throw new Error('响应不是图片');
      // ClipboardItem 只接受主流 mime (image/png, image/jpeg, image/gif, image/webp)
      // 其他 (如 svg) 不能复制 - 告警
      const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
      const writeType = allowed.includes(blob.type) ? blob.type : 'image/png';
      // svg 等不能直接复制, 转为 png (通过 canvas) 后再复制
      let finalBlob = blob;
      if (!allowed.includes(blob.type)) {
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        finalBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob 失败'))), 'image/png');
        });
      }
      // Safari 需异步 promise, 其他浏览器接 ClipboardItem
      const item2 = new ClipboardItem({ [writeType]: finalBlob });
      await navigator.clipboard.write([item2]);
      setImgCopied(true);
      toast.success(`图片已复制 (${(finalBlob.size / 1024).toFixed(1)} KB) - 可在微信/语雀/Notion 直接 Ctrl+V`);
      setTimeout(() => setImgCopied(false), 2000);
    } catch (e: any) {
      console.error('Copy image failed:', e);
      toast.error(`复制图片失败: ${e?.message || '未知错误'} - 请检查浏览器权限或 HTTPS`);
    }
  };

  // P3.6.1: 保存 alt_text
  const handleSaveAlt = async () => {
    if (!previewItem) return;
    try {
      const r = await mediaApi.update(siteId, previewItem.id, { alt_text: altDraft });
      setPreviewItem(r.data.data!);
      setItems((prev) => prev.map((it) => (it.id === previewItem.id ? r.data.data! : it)));
      setEditingAlt(false);
      toast.success('已保存');
    } catch (e: any) {
      toast.error(e?.message || '保存失败');
    }
  };

  // 打开预览时同步初始化 alt 草稿
  const openPreview = (item: MediaItem) => {
    setPreviewItem(item);
    setAltDraft(item.alt_text ?? '');
    setEditingAlt(false);
  };

  // === P3.6.1 批量 (B) ===
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const handleBatchDelete = async () => {
    if (selected.size === 0) return;
    // P3.9.1+ in-app dialog (holy 反馈 #11266)
    setBatchDeleteOpen(true);
  };

  const confirmBatchDelete = async () => {
    setBatchDeleteOpen(false);
    if (selected.size === 0) return;
    let okCount = 0;
    const failed: Array<{ id: string; filename: string; refs: number }> = [];
    for (const id of Array.from(selected)) {
      const item = items.find((i) => i.id === id);
      try {
        await mediaApi.remove(siteId, id, false);
        okCount++;
      } catch (e: any) {
        if (e?.response?.status === 409) {
          failed.push({ id, filename: item?.filename ?? '?', refs: e.response.data?.detail?.count ?? 0 });
        }
      }
    }
    if (failed.length > 0) {
      toast.error(`已删 ${okCount} 个, ${failed.length} 个被引用: ${failed.map(f => `${f.filename}(${f.refs})`).join(', ')}`);
    } else {
      toast.success(`已删 ${okCount} 个`);
    }
    clearSelection();
    loadItems();
  };

  const handleBatchMove = async (targetFolderId: string | null) => {
    if (selected.size === 0) return;
    let okCount = 0;
    for (const id of Array.from(selected)) {
      try {
        await mediaApi.update(siteId, id, { folder_id: targetFolderId });
        okCount++;
      } catch { /* ignore */ }
    }
    toast.success(`已移 ${okCount} 个到 ${targetFolderId ? '文件夹' : '根目录'}`);
    clearSelection();
    loadItems();
    loadFolders();
  };

  const handleBatchCopyUrls = async () => {
    const urls = items.filter((i) => selected.has(i.id)).map((i) => i.url).join('\n');
    if (!urls) return;
    try {
      await navigator.clipboard.writeText(urls);
      toast.success(`已复制 ${selected.size} 个 URL`);
    } catch {
      toast.error('复制失败');
    }
  };

  // === P3.6.1 拖拽 (D): 拖卡片到文件夹 chip ===
  const handleDropOnFolder = async (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/media-id');
    if (!id) return;
    try {
      await mediaApi.update(siteId, id, { folder_id: targetFolderId });
      toast.success(targetFolderId ? '已移入文件夹' : '已移到根目录');
      loadItems();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '移动失败');
    }
  };

  return (
    <div className={embedded ? "h-full space-y-2 overflow-y-auto" : "space-y-2"}>
      {embedded ? (
        /* 嵌入模式: 标题 + 计数 单行 (省垂直空间) */
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-medium">文件列表</span>
          <span className="text-muted-foreground tabular-nums">共 {total}</span>
        </div>
      ) : null}
      {/* === 顶栏 (P3.9.6+ holy 反馈 #12711: 参考 LayoutEditPage 风格 - 细 1px border-b 分隔) === */}
      <div className="flex items-center gap-2 mb-3 border-b pb-3">
        {!embedded && (
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-lg font-semibold leading-none">媒体库</h1>
            <span className="text-[12px] text-muted-foreground/80 tabular-nums leading-none">
              共 {total} 个
            </span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {/* P3.6.1: 搜索框 (filename 模糊) */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索文件名…"
              className={embedded ? "h-7 w-20 pl-7 text-[11.5px]" : "h-8 w-56 pl-7 text-[12.5px]"}
            />
          </div>
          {!embedded && (
            <Button variant="outline" size="sm" onClick={() => setShowNewFolder(true)}>
              <Folder className="w-4 h-4 mr-1" /> 新建文件夹
            </Button>
          )}
          {canWrite && (
            <Button
              size={embedded ? "sm" : "sm"}
              onClick={() => fileInput.current?.click()}
              className={embedded ? "h-7 px-2" : undefined}
            >
              <Upload className="w-3.5 h-3.5" />
              {!embedded && <span className="ml-1">上传</span>}
            </Button>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>

      {/* === 工具条 (P3.9.6+ #12693: 标签 + 共享池 + 文件类型 Tab 合并为 1 行) === */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* 文件类型 Tab (靠左, 用得最多) */}
        <div className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5">
          {[
            { key: undefined, label: '全部', icon: FileText },
            { key: 'image/', label: '图片', icon: ImageIcon },
            { key: 'video/', label: '视频', icon: Film },
            { key: 'audio/', label: '音频', icon: Music },
            { key: 'application/pdf', label: 'PDF', icon: FileText },
            { key: 'application/zip', label: '压缩包', icon: FileArchive },
          ].map((t) => {
            const active = mimePrefix === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.label}
                onClick={() => setMimePrefix(t.key)}
                title={t.label}
                className={
                  'inline-flex h-6 items-center gap-0.5 rounded px-1.5 text-[11.5px] font-medium transition-colors ' +
                  (active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground')
                }
              >
                <Icon className="h-3 w-3" />
                <span className="hidden md:inline">{t.label}</span>
              </button>
            );
          })}
        </div>
        {/* 标签筛选 (可滚动 chip 条) */}
        {tags.length > 0 && (
          <div className="flex flex-1 min-w-0 items-center gap-1 overflow-x-auto">
            <Tag className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
            {tags.map((t) => {
              const active = tagFilter.includes(t.name);
              return (
                <button
                  key={t.id}
                  onClick={() => setTagFilter((prev) => active ? prev.filter((x) => x !== t.name) : [...prev, t.name])}
                  className={`inline-flex h-6 flex-shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] border transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent'}`}
                  style={!active && t.color ? { borderColor: t.color, color: t.color } : undefined}
                >
                  {t.name}
                  <span className={`text-[10px] ${active ? 'opacity-80' : 'text-muted-foreground'}`}>{t.media_count}</span>
                </button>
              );
            })}
            {tagFilter.length > 0 && (
              <button onClick={() => setTagFilter([])} className="flex-shrink-0 text-[10.5px] text-muted-foreground hover:text-foreground underline">清除</button>
            )}
          </div>
        )}
        {/* 共享池 toggle (P3.9.6+ #12693: 去掉括号变量名 is_shared=true) */}
        {user?.is_super_admin && (
          <label className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={onlyShared}
              onChange={(e) => setOnlyShared(e.target.checked)}
              className="h-3 w-3 rounded border-gray-300"
            />
            <span>仅看共享池</span>
          </label>
        )}
      </div>

      {/* 文件夹选择 (D: 拖拽目标) */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant={folderId === undefined ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFolderId(undefined)}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
          onDrop={(e) => handleDropOnFolder(e, null)}
          title="拖文件到这里=移到根目录"
        >
          <Folder className="w-4 h-4 mr-1" /> 全部
        </Button>
        {folders.map((f) => (
          <Button
            key={f.id}
            variant={folderId === f.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFolderId(f.id)}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
            onDrop={(e) => handleDropOnFolder(e, f.id)}
            title="拖文件到这里"
          >
            <Folder className="w-4 h-4 mr-1" /> {f.name}
          </Button>
        ))}
      </div>

      {/* B: 批量操作 toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50/40 px-3 py-1.5">
          <span className="text-[12.5px] font-medium text-blue-700">已选 {selected.size} 个</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={handleBatchCopyUrls}>
              <Copy className="mr-1 h-3 w-3" /> 复制 URL
            </Button>
            {canWrite && folders.length > 0 && (
              <select
                onChange={(e) => { if (e.target.value) { handleBatchMove(e.target.value); e.target.value = ''; } }}
                className="h-7 rounded border bg-background px-2 text-[12px]"
                defaultValue=""
              >
                <option value="" disabled>移到文件夹…</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-[12px] text-red-600 hover:bg-red-50" onClick={handleBatchDelete}>
              <Trash2 className="mr-1 h-3 w-3" /> 删除
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={clearSelection}>
              <X className="mr-1 h-3 w-3" /> 取消
            </Button>
          </div>
        </div>
      )}

      {/* 上传队列 */}
      {uploads.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">上传队列 ({uploads.length})</span>
            <Button variant="ghost" size="sm" onClick={() => setUploads([])}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="space-y-1">
            {uploads.map((u) => (
              <div key={u.id} className="flex items-center gap-2 text-sm">
                {u.status === 'uploading' && <Loader2 className="w-3 h-3 animate-spin" />}
                {u.status === 'done' && <span className="text-green-600">✓</span>}
                {u.status === 'error' && <span className="text-red-600">✗</span>}
                <span className="flex-1 truncate">{u.file.name}</span>
                <span className="text-xs text-muted-foreground">{formatSize(u.file.size)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 拖放区 / 列表 */}
      <div
        ref={dropRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="min-h-[200px]"
      >
        {loading ? (
          <Card className="p-8 text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto" />
          </Card>
        ) : items.length === 0 ? (
          <EmptyState
            icon={ImageIcon}
            title="还没有媒体文件"
            description={canWrite ? '点击上传按钮或拖放文件到此处' : '联系站点管理员上传文件'}
            action={canWrite ? (
              <Button onClick={() => fileInput.current?.click()}>
                <Upload className="w-4 h-4 mr-1" /> 上传
              </Button>
            ) : undefined}
          />
        ) : (
          <div className={embedded ? "grid grid-cols-2 gap-1.5" : "grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3"}>
            {items.map((item) => {
              const checked = selected.has(item.id);
              return (
                <Card
                  key={item.id}
                  className={
                    (embedded ? 'group relative cursor-pointer p-1.5 transition ' : 'group relative cursor-pointer p-2 transition ') +
                    (checked ? 'ring-2 ring-blue-500 ' : 'hover:ring-2 hover:ring-primary/50')
                  }
                  onClick={() => openPreview(item)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/media-id', item.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingId(item.id);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                >
                  {/* P3.9.4 (holy 反馈 #12044): hover 浮出"复制图片"快速操作 (仅图片) */}
                  {isImage(item.mime_type) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCopyImage(item); }}
                      className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded bg-card/95 text-primary opacity-0 shadow-sm transition-all hover:bg-accent hover:scale-110 group-hover:opacity-100"
                      title="复制图片到剪贴板 (可在微信/语雀/Notion Ctrl+V)"
                    >
                      <ImageDown className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {/* B: 多选 checkbox */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}
                    className={
                      'absolute left-1.5 top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded border transition ' +
                      (checked
                        ? 'border-blue-500 bg-blue-500 text-white'
                        : 'border-border bg-card opacity-0 group-hover:opacity-100 ' + (checked ? '' : ''))
                    }
                    title={checked ? '取消选中' : '选中'}
                  >
                    {checked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  </button>
                  <div className="bg-muted rounded mb-1.5 flex items-center justify-center overflow-hidden" style={{ aspectRatio: '4/3' }}>
                    {isImage(item.mime_type) ? (
                      <img src={item.thumb_small_url || item.url} alt={item.alt_text ?? ''} className="w-full h-full object-cover" />
                    ) : (
                      <FileText className={embedded ? "w-5 h-5 text-muted-foreground" : "w-7 h-7 text-muted-foreground"} />
                    )}
                  </div>
                  <div className="text-xs truncate" title={item.filename}>{item.filename}</div>
                  {/* P3.6.2 F: 标签 chip (最多 2 个, 多了 +N) */}
                  {item.tags && item.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {item.tags.slice(0, 2).map((t) => (
                        <span key={t.id} className="inline-flex items-center rounded-full px-1.5 py-0 text-[9.5px] border" style={t.color ? { borderColor: t.color, color: t.color } : undefined}>{t.name}</span>
                      ))}
                      {item.tags.length > 2 && <span className="text-[9.5px] text-muted-foreground">+{item.tags.length - 2}</span>}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground flex justify-between mt-0.5">
                    <span>{formatSize(item.size_bytes)}</span>
                    <Badge variant="secondary" className="text-[10px] py-0">{friendlyMime(item.mime_type, item.filename)}</Badge>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* 分页 */}
      {total > 24 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <span className="text-sm self-center">
            第 {page} / {Math.ceil(total / 24)} 页
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= Math.ceil(total / 24)}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}

      {/* 预览弹窗 (P3.6.1 完善: URL 复制 + alt_text 编辑 + 类型区分) */}
      {previewItem && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setPreviewItem(null)}>
          <div className="bg-card rounded-lg max-w-3xl w-full max-h-[90vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold truncate pr-2">{previewItem.filename}</h3>
              <Button variant="ghost" size="sm" onClick={() => setPreviewItem(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="bg-muted rounded mb-4 flex items-center justify-center max-h-96 overflow-hidden">
              {isImage(previewItem.mime_type) ? (
                <img src={previewItem.url} alt={previewItem.alt_text ?? ''} className="max-w-full max-h-96" />
              ) : previewItem.mime_type.startsWith('video/') ? (
                <video src={previewItem.url} controls className="max-w-full max-h-96" />
              ) : (
                <FileText className="w-16 h-16 text-muted-foreground" />
              )}
            </div>

            {/* URL 复制行 + P3.9.4: 复制图片按钮 (holy 反馈 #12044) */}
            <div className="mb-4 flex items-center gap-2 rounded border bg-secondary/30 px-2 py-1.5">
              <code className="flex-1 truncate text-[11.5px] text-muted-foreground" title={previewItem.url}>{previewItem.url}</code>
              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => handleCopyUrl(previewItem.url)} title="复制 URL 到剪贴板 (文本)">
                {urlCopied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="ml-1 text-[11.5px]">{urlCopied ? '已复制' : '复制 URL'}</span>
              </Button>
              {isImage(previewItem.mime_type) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-blue-600 hover:bg-blue-50"
                  onClick={() => handleCopyImage(previewItem)}
                  title="复制图片本身到剪贴板 (可贴到微信/语雀/Notion, Ctrl+V)"
                >
                  {imgCopied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <ImageDown className="h-3.5 w-3.5" />}
                  <span className="ml-1 text-[11.5px]">{imgCopied ? '已复制图片' : '复制图片'}</span>
                </Button>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">类型</dt><dd>{previewItem.mime_type}</dd>
              <dt className="text-muted-foreground">大小</dt><dd>{formatSize(previewItem.size_bytes)}</dd>
              {previewItem.width && previewItem.height && (
                <>
                  <dt className="text-muted-foreground">尺寸</dt>
                  <dd>{previewItem.width} × {previewItem.height}</dd>
                </>
              )}
              <dt className="text-muted-foreground">上传者</dt>
              <dd>{previewItem.uploader_name ?? previewItem.uploader_id}</dd>
              <dt className="text-muted-foreground">上传时间</dt>
              <dd>{new Date(previewItem.created_at).toLocaleString('zh-CN')}</dd>
            </dl>

            {/* P3.6.2 G: 共享状态 (super_admin 可切换) */}
            <div className="mt-3 rounded border p-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] font-medium text-muted-foreground">共享状态</span>
                {previewItem.is_shared ? (
                  <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11.5px]">已跨站共享</span>
                ) : (
                  <span className="text-[11.5px] text-muted-foreground">仅本站可见</span>
                )}
              </div>
              {user?.is_super_admin && (
                <Button
                  variant="outline" size="sm" className="h-6 px-2 text-[11.5px]"
                  onClick={async () => {
                    try {
                      if (previewItem.is_shared) {
                        await mediaApi.unshare(siteId, previewItem.id);
                      } else {
                        await mediaApi.share(siteId, previewItem.id);
                      }
                      const r = await mediaApi.get(siteId, previewItem.id);
                      const fresh = r.data.data!;
                      setPreviewItem(fresh);
                      setItems((prev) => prev.map((it) => it.id === fresh.id ? fresh : it));
                      toast.success(previewItem.is_shared ? '已取消共享' : '已共享到全局素材库');
                    } catch (e: any) {
                      toast.error(e?.response?.data?.message || '操作失败');
                    }
                  }}
                >
                  {previewItem.is_shared ? '取消共享' : '共享到全局'}
                </Button>
              )}
            </div>

            {/* P3.6.2 F: 标签 (可点选 + 新建) */}
            <div className="mt-3 rounded border p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11.5px] font-medium text-muted-foreground flex items-center gap-1"><Tag className="w-3 h-3" />标签</span>
                {!editingTags ? (
                  canWrite && <Button variant="ghost" size="sm" className="h-6 px-2 text-[11.5px]" onClick={() => {
                    setTagDraftIds((previewItem.tags || []).map((t) => t.id));
                    setEditingTags(true);
                  }}>编辑</Button>
                ) : (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[11.5px]" onClick={() => setEditingTags(false)}>取消</Button>
                    <Button size="sm" className="h-6 px-2 text-[11.5px]" onClick={async () => {
                      try {
                        await mediaApi.setMediaTags(siteId, previewItem.id, tagDraftIds);
                        // 重新拉详情更新
                        const r = await mediaApi.get(siteId, previewItem.id);
                        const fresh = r.data.data!;
                        setPreviewItem(fresh);
                        setItems((prev) => prev.map((it) => it.id === fresh.id ? fresh : it));
                        setEditingTags(false);
                        loadTags();
                        toast.success('已保存标签');
                      } catch (e: any) {
                        toast.error(e?.response?.data?.message || '保存失败');
                      }
                    }}>保存</Button>
                  </div>
                )}
              </div>
              {editingTags ? (
                <div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {tags.map((t) => {
                      const on = tagDraftIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => setTagDraftIds((prev) => on ? prev.filter((x) => x !== t.id) : [...prev, t.id])}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] border ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent'}`}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                    {tags.length === 0 && <span className="text-[11.5px] text-muted-foreground">该站还没有标签, 可在下方新建</span>}
                  </div>
                  {canWrite && (
                    <div className="flex items-center gap-1">
                      <Input
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        placeholder="新标签名"
                        className="h-7 text-[12px] flex-1"
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter' && newTagName.trim()) {
                            setCreatingTag(true);
                            try {
                              const r = await mediaApi.createTag(siteId, { name: newTagName.trim() });
                              const newTag = r.data.data!;
                              setTags((prev) => [...prev, newTag].sort((a, b) => a.name.localeCompare(b.name)));
                              setTagDraftIds((prev) => [...prev, newTag.id]);
                              setNewTagName('');
                              toast.success('标签已创建');
                            } catch (e: any) {
                              toast.error(e?.response?.data?.message || '创建失败');
                            } finally {
                              setCreatingTag(false);
                            }
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11.5px]"
                        disabled={!newTagName.trim() || creatingTag}
                        onClick={async () => {
                          setCreatingTag(true);
                          try {
                            const r = await mediaApi.createTag(siteId, { name: newTagName.trim() });
                            const newTag = r.data.data!;
                            setTags((prev) => [...prev, newTag].sort((a, b) => a.name.localeCompare(b.name)));
                            setTagDraftIds((prev) => [...prev, newTag.id]);
                            setNewTagName('');
                            toast.success('标签已创建');
                          } catch (e: any) {
                            toast.error(e?.response?.data?.message || '创建失败');
                          } finally {
                            setCreatingTag(false);
                          }
                        }}
                      >
                        <Plus className="w-3 h-3 mr-0.5" /> 新建
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(previewItem.tags || []).length === 0 ? (
                    <span className="text-[12.5px] italic text-muted-foreground">未打标签</span>
                  ) : (
                    previewItem.tags!.map((t) => (
                      <span
                        key={t.id}
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] border"
                        style={t.color ? { borderColor: t.color, color: t.color } : undefined}
                      >
                        {t.name}
                      </span>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* alt_text (P3.6.1 完善: SEO 文本) */}
            {isImage(previewItem.mime_type) && canWrite && (
              <div className="mt-3 rounded border p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11.5px] font-medium text-muted-foreground">替代文本 (SEO/无障碍)</span>
                  {!editingAlt ? (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[11.5px]" onClick={() => { setEditingAlt(true); setAltDraft(previewItem.alt_text ?? ''); }}>
                      {previewItem.alt_text ? '编辑' : '添加'}
                    </Button>
                  ) : (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[11.5px]" onClick={() => { setEditingAlt(false); setAltDraft(previewItem.alt_text ?? ''); }}>取消</Button>
                      <Button size="sm" className="h-6 px-2 text-[11.5px]" onClick={handleSaveAlt}>保存</Button>
                    </div>
                  )}
                </div>
                {editingAlt ? (
                  <Input
                    autoFocus
                    value={altDraft}
                    onChange={(e) => setAltDraft(e.target.value)}
                    placeholder="描述图片内容 (屏幕阅读器/搜索引擎使用)"
                    className="h-7 text-[12px]"
                  />
                ) : (
                  <div className={'text-[12.5px] ' + (previewItem.alt_text ? '' : 'italic text-muted-foreground')}>
                    {previewItem.alt_text || '未设置'}
                  </div>
                )}
              </div>
            )}

            {canWrite && (
              <div className="flex justify-end mt-4">
                <Button variant="outline" size="sm" onClick={() => { setConfirmDelete(previewItem); setPreviewItem(null); }}>
                  <Trash2 className="w-4 h-4 mr-1" /> 删除
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 新建文件夹弹窗 */}
      {showNewFolder && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowNewFolder(false)}>
          <div className="bg-card rounded-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-4">新建文件夹</h3>
            <Label>名称</Label>
            <Input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              placeholder="images"
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setShowNewFolder(false)}>取消</Button>
              <Button size="sm" onClick={handleCreateFolder}>创建</Button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="删除媒体"
        description={confirmDelete && `确认删除 “${confirmDelete.filename}”？该文件将被永久删除, 不可恢复。`}
        confirmText="删除"
        loading={deleting}
      />

      {/* A: 引用明细弹窗 (删除遇 409 时弹出) */}
      {usageTarget && usageData && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => { setUsageTarget(null); setUsageData(null); }}>
          <div className="bg-card max-w-2xl w-full max-h-[80vh] overflow-auto rounded-lg p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="font-semibold">“{usageTarget.filename}” 被引用了 {usageData.count} 处</h3>
                <p className="mt-1 text-[12px] text-muted-foreground">删除后, 引用该资源的内容会出现破图/失效链接。是否仍要继续？</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setUsageTarget(null); setUsageData(null); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {usageData.references.length > 0 && (
              <div className="mb-4 max-h-72 space-y-1.5 overflow-y-auto rounded border bg-secondary/20 p-2">
                {usageData.references.map((r, i) => (
                  <div key={i} className="rounded border bg-card p-2 text-[12px]">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {r.type === 'content' ? '文章' : '模板'}
                      </Badge>
                      <span className="font-medium">{r.title}</span>
                    </div>
                    {r.context && (
                      <code className="mt-1 block truncate text-[10.5px] text-muted-foreground" title={r.context}>
                        {r.context}
                      </code>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setUsageTarget(null); setUsageData(null); }}>取消</Button>
              <Button variant="destructive" size="sm" onClick={handleForceDelete} disabled={deleting}>
                {deleting ? '删除中...' : `仍要删除 (${usageData.count} 处引用)`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* P3.9.1+ in-app dialog (holy 反馈 #11266) */}
      <ConfirmDialog
        open={batchDeleteOpen}
        onClose={() => setBatchDeleteOpen(false)}
        onConfirm={confirmBatchDelete}
        title="批量删除文件"
        description={`确认删除 ${selected.size} 个文件？遇到被引用的会跳过并提示。`}
        confirmText="删除"
        variant="danger"
      />
    </div>
  );
}
