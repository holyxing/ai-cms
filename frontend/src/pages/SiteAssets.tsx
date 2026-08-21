/**
 * SiteAssets.tsx - 站点级静态资源管理 (P3.6.5 重设计)
 *
 * P3.6.5 改版亮点:
 * - 顶部数字行 (总数 / 总大小 / 引用数) + 拖拽上传区
 * - 资源按 MIME 大类分组 (CSS / JS / Image / Font / Other)
 * - 每行: 缩略图 / icon · 名称 · 大小 · 公开 URL · 模板引用数 · 操作
 * - 反向引用: 跳 LayoutEditPage 看到底哪个 layout 用了这个资源
 * - 拖拽上传: 全页 dropzone + 进度环
 * - FAB 上传按钮: 滚到底也随时可点
 * - URL 复制: 公开 URL 单独一行 + 复制按钮
 * - 紧凑模式: 侧栏内嵌时按钮更小, 头部隐藏
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Upload, Trash2, X, Loader2, Copy, Check, FileCode2, FileText,
  Edit3, Save, File as FileIcon, Code2,
  Search, Plus, Boxes, Hash,
  AlertTriangle, ExternalLink, ChevronRight,
  Square, CheckSquare,
} from 'lucide-react';
import {
  Button, Card, Input, Label, EmptyState, ConfirmDialog, Badge, CodeEditor,
} from '@/components/ui';
import { BatchActionBar } from '@/components/BatchActionBar';
import { siteAssetsApi, type SiteAsset, type AssetCategory, CATEGORY_META, ASSET_CATEGORIES, validateCategoryForExt, previewUrl } from '@/api/siteAssets';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';

// === 工具 ===
function formatSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function originalPathDir(originalFilename: string): string {
  const clean = (originalFilename || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const idx = clean.lastIndexOf('/');
  return idx >= 0 ? clean.slice(0, idx) : '';
}

function originalPathLabel(originalFilename: string): string {
  return (originalFilename || '').replace(/\\/g, '/').replace(/^\/+/, '') || '(空)';
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function isValidName(n: string) { return NAME_RE.test(n); }

const EDITABLE_MIME_PREFIXES = [
  'text/',
  'application/javascript',
  'application/json',
  'application/xml',
  'image/svg+xml',
];
function isEditable(mime: string): boolean {
  return EDITABLE_MIME_PREFIXES.some((p) => mime.startsWith(p));
}
function langForMime(mime: string): string {
  if (mime === 'text/css') return 'css';
  if (mime === 'application/javascript' || mime === 'text/javascript') return 'javascript';
  if (mime === 'application/json' || mime === 'text/json') return 'json';
  if (mime === 'image/svg+xml' || mime === 'application/xml' || mime === 'text/xml') return 'xml';
  if (mime === 'text/html') return 'html';
  return 'text';
}

export default function SiteAssets() {
  return <SiteAssetsView />;
}

export { SiteAssetsView };

export interface SiteAssetsViewProps {
  siteId?: string;
  embedded?: boolean;
}

function SiteAssetsView({ siteId: propSiteId, embedded = false }: SiteAssetsViewProps = {}) {
  const { siteId: paramSiteId = '' } = useParams<{ siteId: string }>();
  const siteId = propSiteId ?? paramSiteId;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const canWrite = user?.is_super_admin;

  // P3.6.5: 当前 category tab (默认 'css', 3 个内置目录之一)
  const catFromUrl = searchParams.get('cat');
  const [activeCat, setActiveCat] = useState<AssetCategory>(
    catFromUrl && (ASSET_CATEGORIES as readonly string[]).includes(catFromUrl)
      ? (catFromUrl as AssetCategory)
      : 'css',
  );
  const [items, setItems] = useState<SiteAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [pathFilter, setPathFilter] = useState('');

  // 上传 (P3.6.5+: 多文件队列 + 单个进度 + 批量上传 + 智能 cat)
  const [queue, setQueue] = useState<Array<{ id: string; file: File; cat: AssetCategory; status: 'pending' | 'uploading' | 'done' | 'error'; error?: string; }>>([]);
  const [bulkDesc, setBulkDesc] = useState('');
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // 行内
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SiteAsset | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  // 内容编辑器
  const [contentEditor, setContentEditor] = useState<SiteAsset | null>(null);

  const load = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      // P3.6.5: 一次拿全部 3 个 category (前端按 tab 过滤, 避免切 tab 抖动)
      const all = await Promise.all(
        ASSET_CATEGORIES.map((c) => siteAssetsApi.list(siteId, c).then((r) => r.items)),
      );
      setItems(all.flat());
    } catch (e: any) {
      toast.error('加载资源失败: ' + (e?.response?.data?.message || e?.message));
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (catFromUrl && (ASSET_CATEGORIES as readonly string[]).includes(catFromUrl)) {
      setActiveCat(catFromUrl as AssetCategory);
    }
  }, [catFromUrl]);

  useEffect(() => {
    setPathFilter('');
  }, [activeCat]);

  // 当前 tab 的资源
  const catItems = useMemo(() => items.filter((a) => a.category === activeCat), [items, activeCat]);
  const pathOptions = useMemo(
    () => Array.from(new Set(catItems.map((a) => originalPathDir(a.original_filename)))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [catItems],
  );
  const catStats = useMemo(() => {
    const byCat = items.reduce((m, a) => { m[a.category] = (m[a.category] || 0) + 1; return m; }, {} as Record<string, number>);
    return byCat;
  }, [items]);

  // 过滤 (按 name/desc/original path + 路径目录)
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return catItems.filter((a) => {
      const dir = originalPathDir(a.original_filename);
      if (pathFilter && dir !== pathFilter) return false;
      if (!ql) return true;
      return (
        a.name.toLowerCase().includes(ql) ||
        (a.description || '').toLowerCase().includes(ql) ||
        a.original_filename.toLowerCase().includes(ql)
      );
    });
  }, [catItems, pathFilter, q]);

  const stats = useMemo(() => {
    const totalSize = items.reduce((s, a) => s + a.byte_size, 0);
    return { total: items.length, totalSize };
  }, [items]);

  const allSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.id));
  const someSelected = filtered.some((a) => selected.has(a.id)) && !allSelected;

  const onToggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onToggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        filtered.forEach((a) => next.delete(a.id));
      } else {
        filtered.forEach((a) => next.add(a.id));
      }
      return next;
    });
  };

  // === 多文件上传队列 ===
  // 接入新文件 (拖拽 / 点选 / 都支持)
  // P3.6.5+: 智能识别 — 如果拖入的扩展名匹配另一个 category, 自动分配到正确 tab, 不用用户手动切
  const onAddFiles = (files: FileList | File[] | null) => {
    if (!files || (files instanceof FileList && files.length === 0)) return;
    const arr = Array.from(files);

    // 推到文件实际属哪一 cat
    const detectCat = (name: string): AssetCategory | null => {
      for (const c of ASSET_CATEGORIES) {
        if (!validateCategoryForExt(c, name)) return c;
      }
      return null;
    };

    const queueByCat: Record<AssetCategory, typeof queue> = { css: [], js: [], assets: [] };
    const unknown: string[] = [];
    arr.forEach((f) => {
      const detected = detectCat(f.name);
      if (detected) {
        queueByCat[detected].push({ id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}-${detected}`, file: f, cat: detected, status: 'pending' });
      } else {
        unknown.push(f.name);
      }
    });

    // 累加 + 切 tab
    const total = Object.values(queueByCat).reduce((s, q) => s + q.length, 0);
    if (total === 0 && unknown.length) {
      toast.error(`拒绝 ${unknown.length} 个文件 (扩展名不识别): ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? '...' : ''}`);
      return;
    }
    setQueue((q) => [...q, ...queueByCat.css, ...queueByCat.js, ...queueByCat.assets]);

    // 切到第一个有文件的 tab (避免队列里出现其他 cat 但 user 看不到)
    const firstCat = (Object.keys(queueByCat) as AssetCategory[]).find((c) => queueByCat[c].length > 0);
    if (firstCat && firstCat !== activeCat) {
      setActiveCat(firstCat);
    }

    // 反馈
    if (queueByCat.css.length) toast.success(`已添加 ${queueByCat.css.length} 个 CSS 文件`);
    if (queueByCat.js.length) toast.success(`已添加 ${queueByCat.js.length} 个 JS 文件`);
    if (queueByCat.assets.length) toast.success(`已添加 ${queueByCat.assets.length} 个资源文件`);
    if (unknown.length) {
      toast.warning(`忽略 ${unknown.length} 个不识别扩展名: ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? '...' : ''}`);
    }
  };

  // 移除队列中某项
  const onRemoveQueued = (id: string) => {
    setQueue((q) => q.filter((it) => it.id !== id));
  };

  // 清空队列
  const onClearQueue = () => {
    setQueue([]);
    if (fileInput.current) fileInput.current.value = '';
  };

  // 批量上传队列
  const onUploadAll = async () => {
    if (queue.length === 0) return;
    const pending = queue.filter((it) => it.status === 'pending' || it.status === 'error');
    if (pending.length === 0) {
      toast.info('队列中没有待上传文件');
      return;
    }
    setUploading(true);
    let okCount = 0, errCount = 0;
    for (const item of pending) {
      // P3.6.5+: 用 item.cat (智能分类时记录) 不用 activeCat, 避免用户在 JS tab 但队里有 css 文件
      const itemCat = item.cat ?? activeCat;
      setQueue((q) => q.map((it) => it.id === item.id ? { ...it, status: 'uploading', error: undefined } : it));
      try {
        await siteAssetsApi.upload(siteId, {
          category: itemCat,
          name: item.file.name,
          file: item.file,
          description: bulkDesc.trim() || undefined,
        });
        setQueue((q) => q.map((it) => it.id === item.id ? { ...it, status: 'done' } : it));
        okCount++;
      } catch (e: any) {
        const msg = e?.response?.data?.detail || e?.response?.data?.message || e?.message;
        setQueue((q) => q.map((it) => it.id === item.id ? { ...it, status: 'error', error: msg } : it));
        errCount++;
      }
    }
    setUploading(false);
    if (okCount) toast.success(`已上传 ${okCount} 个文件到 ${CATEGORY_META[activeCat].label}/`);
    if (errCount) toast.error(`${errCount} 个文件上传失败`);
    setBulkDesc('');
    load();
  };

  // 拖拽上传
  useEffect(() => {
    if (!canWrite) return;
    const el = dropRef.current;
    if (!el) return;
    const onEnter = (e: DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const onOver = (e: DragEvent) => { e.preventDefault(); };
    const onLeave = (e: DragEvent) => {
      if (e.target === el) setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) onAddFiles(files);
    };
    el.addEventListener('dragenter', onEnter);
    el.addEventListener('dragover', onOver);
    el.addEventListener('dragleave', onLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragenter', onEnter);
      el.removeEventListener('dragover', onOver);
      el.removeEventListener('dragleave', onLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, [canWrite]);

  // === 复制 URL ===
  const onCopyUrl = async (asset: SiteAsset) => {
    const full = `${window.location.origin}${asset.url}`;
    try {
      await navigator.clipboard.writeText(full);
      setCopied(asset.id);
      toast.success('已复制: ' + full);
      setTimeout(() => setCopied((c) => (c === asset.id ? null : c)), 1500);
    } catch {
      toast.error('复制失败');
    }
  };

  // === 复制 HY_ASSET_URL 标签 ===
  const onCopyHyTag = async (name: string) => {
    const tag = `<HY_ASSET_URL _name="${name}" />`;
    try {
      await navigator.clipboard.writeText(tag);
      toast.success(`已复制: ${tag}`);
    } catch {
      toast.error('复制失败');
    }
  };

  // === 删 / 编辑 ===
  const onDelete = async (asset: SiteAsset) => {
    try {
      await siteAssetsApi.remove(siteId, asset.category, asset.name);
      toast.success(`已删除 ${asset.category}/${asset.name}`);
      setConfirmDelete(null);
      setSelected((s) => {
        const next = new Set(s);
        next.delete(asset.id);
        return next;
      });
      load();
    } catch (e: any) {
      toast.error('删除失败: ' + (e?.response?.data?.message || e?.message));
    }
  };

  const onBatchDelete = async () => {
    const targets = items.filter((a) => selected.has(a.id));
    if (targets.length === 0) return;
    let okCount = 0;
    let errCount = 0;
    for (const a of targets) {
      try {
        await siteAssetsApi.remove(siteId, a.category, a.name);
        okCount++;
      } catch {
        errCount++;
      }
    }
    if (okCount) toast.success(`已删除 ${okCount} 个资源`);
    if (errCount) toast.error(`${errCount} 个资源删除失败`);
    setSelected(new Set());
    load();
  };

  const onStartEdit = (asset: SiteAsset) => {
    setEditing(asset.id);
    setEditName(asset.name);
    setEditDesc(asset.description || '');
  };

  const onSaveEdit = async (asset: SiteAsset) => {
    if (editName && editName !== asset.name && !isValidName(editName)) {
      toast.error('资源名格式不合法');
      return;
    }
    if (editName && editName !== asset.name) {
      // P3.6.5: 客户端按 category 校验新名扩展名
      const extErr = validateCategoryForExt(asset.category, editName);
      if (extErr) {
        toast.error(extErr);
        return;
      }
    }
    try {
      await siteAssetsApi.update(siteId, asset.category, asset.name, {
        name: editName !== asset.name ? editName.trim() : undefined,
        description: editDesc.trim() || undefined,
      });
      toast.success('已保存');
      setEditing(null);
      load();
    } catch (e: any) {
      toast.error('保存失败: ' + (e?.response?.data?.message || e?.message));
    }
  };

  if (!siteId) {
    return <div className="p-6 text-muted-foreground">请先选择站点</div>;
  }

  // === 渲染 ===
  return (
    <div
      ref={dropRef}
      className={cn(
        'relative space-y-4',
        embedded ? 'p-2' : 'py-5',
        isDragging && 'ring-2 ring-blue-400 ring-offset-2 ring-offset-background',
      )}
    >
      {/* 拖拽提示全屏遮罩 */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-blue-50/80 backdrop-blur-sm">
          <div className="rounded-lg border-2 border-dashed border-primary bg-card px-6 py-4 text-center">
            <Upload className="mx-auto h-8 w-8 text-blue-500" />
            <p className="mt-2 text-sm font-medium">松开上传</p>
          </div>
        </div>
      )}

      {/* 头部 */}
      {!embedded && (
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">站点资源</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              CSS/JS/字体/Logo · 模板里用 <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">&lt;HY_ASSET_URL _name="site.css" /&gt;</code> 引用
            </p>
          </div>
          {canWrite && (
            <Button
              size="sm"
              className={cn('h-8 text-xs', CATEGORY_META[activeCat].color.replace('text-', 'bg-'), 'hover:opacity-90')}
              onClick={() => fileInput.current?.click()}
            >
              <Plus className="h-3.5 w-3.5" />
              上传到 {CATEGORY_META[activeCat].label} (可多选)
            </Button>
          )}
        </div>
      )}

      {/* 数字行 4 列: 总数 / 总大小 / 当前 cat 数量 / 当前 cat 描述 */}
      <section className={cn(
        'grid gap-px overflow-hidden rounded-lg border bg-border',
        embedded ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4',
      )}>
        <div className="bg-background p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">资源总数</span>
            <Boxes className="h-3.5 w-3.5 text-blue-600" strokeWidth={2} />
          </div>
          <div className="mt-1.5 text-xl font-semibold tabular-nums">{stats.total}</div>
        </div>
        <div className="bg-background p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">总大小</span>
            <FileText className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2} />
          </div>
          <div className="mt-1.5 text-xl font-semibold tabular-nums">{formatSize(stats.totalSize)}</div>
        </div>
        {!embedded && (
          <>
            <div className="bg-background p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">当前分类</span>
                <span className={cn('flex h-5 w-5 items-center justify-center rounded text-[10px]', CATEGORY_META[activeCat].bg, CATEGORY_META[activeCat].color)}>
                  {activeCat === 'css' ? 'CSS' : activeCat === 'js' ? 'JS' : 'ASSETS'}
                </span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-xl font-semibold tabular-nums">{catStats[activeCat] || 0}</span>
                <span className="text-[10px] text-muted-foreground">/ {stats.total}</span>
              </div>
            </div>
            <div className="bg-background p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">分类描述</span>
              </div>
              <div className="mt-1.5 text-[11px] text-muted-foreground leading-snug">
                {CATEGORY_META[activeCat].description}
              </div>
            </div>
          </>
        )}
      </section>

      {/* 3 个内置目录 tab (CSS / JS / 图片) */}
      <div className="flex items-center gap-1 border-b">
        {ASSET_CATEGORIES.map((c) => {
          const meta = CATEGORY_META[c];
          const isActive = activeCat === c;
          const count = catStats[c] || 0;
          return (
            <button
              key={c}
              type="button"
              onClick={() => { setActiveCat(c); setQ(''); setSelected(new Set()); }}
              className={cn(
                'relative inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors',
                isActive
                  ? cn('border-b-2 -mb-px', meta.color, 'border-current')
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className={cn('h-2 w-2 rounded-sm', meta.bg.replace('-50', '-500'))} aria-hidden="true" />
              {meta.label}
              <span className={cn(
                'rounded px-1 text-[10px] tabular-nums',
                isActive ? 'bg-secondary' : 'bg-muted text-muted-foreground',
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 搜索 + 全选 */}
      <Card className="flex flex-wrap items-center gap-2 p-2.5">
        {canWrite && filtered.length > 0 && (
          <button
            type="button"
            onClick={onToggleSelectAll}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            title={allSelected ? '取消全选' : '全选当前列表'}
          >
            {allSelected ? (
              <CheckSquare className="h-3.5 w-3.5 text-primary" />
            ) : someSelected ? (
              <CheckSquare className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            全选
          </button>
        )}
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索资源名/描述/原始路径..."
            className="h-8 pl-8 text-xs"
          />
        </div>
        <select
          value={pathFilter}
          onChange={(e) => setPathFilter(e.target.value)}
          className="h-8 min-w-[220px] rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          title="按导入前目录筛选"
        >
          <option value="">全部路径</option>
          {pathOptions.map((dir) => (
            <option key={dir || '(root)'} value={dir}>
              {dir || '根目录'}
            </option>
          ))}
        </select>
      </Card>

      {/* 多文件上传队列区 */}
      {queue.length > 0 && canWrite && (
        <Card className={cn('p-3', CATEGORY_META[activeCat].bg, 'border-2', CATEGORY_META[activeCat].color.replace('text-', 'border-'))}>
          {/* 顶部: 描述输入 + 批量操作 */}
          <div className="mb-2 flex items-center gap-2">
            <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium', CATEGORY_META[activeCat].color, 'bg-card')}>
              {CATEGORY_META[activeCat].label}/
            </span>
            <span className="text-[12px] text-foreground">
              待上传 <span className="font-semibold tabular-nums">{queue.length}</span> 个
              {queue.some(i => i.status === 'uploading') && <span className="ml-2 text-amber-600">上传中…</span>}
              {queue.some(i => i.status === 'done') && <span className="ml-2 text-emerald-600">已成功 {queue.filter(i => i.status === 'done').length}</span>}
              {queue.some(i => i.status === 'error') && <span className="ml-2 text-rose-600">失败 {queue.filter(i => i.status === 'error').length}</span>}
            </span>
            <div className="flex-1" />
            <Input
              value={bulkDesc}
              onChange={(e) => setBulkDesc(e.target.value)}
              placeholder="给这批文件统一加个描述 (可选)"
              className="h-7 max-w-xs text-[12px]"
              disabled={uploading}
            />
            <Button size="sm" variant="ghost" onClick={onClearQueue} disabled={uploading} className="h-7 text-[12px]">
              清空队列
            </Button>
            <Button
              size="sm"
              onClick={onUploadAll}
              disabled={uploading || !queue.some((i) => i.status === 'pending' || i.status === 'error')}
              className="h-7 text-[12px]"
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              {uploading ? '上传中' : '全部上传'}
            </Button>
          </div>

          {/* 队列列表 */}
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {queue.map((it) => (
              <li
                key={it.id}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5"
              >
                <FilePreview file={it.file} compact />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <code className="truncate font-mono font-medium">{it.file.name}</code>
                    <span className="text-[10px] text-muted-foreground">{formatSize(it.file.size)}</span>
                  </div>
                  {it.error && <p className="mt-0.5 truncate text-[10px] text-rose-600" title={it.error}>错误: {it.error}</p>}
                </div>
                <QueuedItemStatus item={it} />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => onRemoveQueued(it.id)}
                  disabled={uploading && it.status === 'uploading'}
                  title="从队列移除"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 隐藏 file input (多选) */}
      <input
        ref={fileInput}
        type="file"
        multiple
        onChange={(e) => onAddFiles(e.target.files)}
        className="hidden"
        disabled={!canWrite}
      />

      {/* 列表 */}
      {loading ? (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin inline" />
        </div>
      ) : catItems.length === 0 ? (
        <Card className="border-dashed py-12">
          <div className="flex flex-col items-center gap-3 text-center">
            {canWrite ? (
              <>
                <div className={cn('flex h-12 w-12 items-center justify-center rounded-full text-2xl', CATEGORY_META[activeCat].bg)}>
                  {CATEGORY_META[activeCat].icon}
                </div>
                <p className="text-sm font-medium">
                  还没有 <span className={cn('font-semibold', CATEGORY_META[activeCat].color)}>{CATEGORY_META[activeCat].label}</span> 资源
                </p>
                <p className="text-xs text-muted-foreground">
                  拖拽文件到此处, 或
                  <button
                    onClick={() => fileInput.current?.click()}
                    className="ml-1 text-blue-600 hover:underline"
                  >
                    点此选择文件
                  </button>
                </p>
                <p className="text-[11px] text-muted-foreground/70">
                  本目录仅接受: {CATEGORY_META[activeCat].description}
                </p>
              </>
            ) : (
              <EmptyState
                icon={FileCode2}
                title={`${CATEGORY_META[activeCat].label} 目录为空`}
                description="联系 super_admin 上传"
              />
            )}
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="没有匹配的资源"
          description={`搜索 "${q}" 没结果`}
          action={
            <Button variant="outline" size="sm" onClick={() => setQ('')}>
              清除筛选
            </Button>
          }
        />
      ) : (
        <ul
          className={cn(
            activeCat === 'assets'
              ? embedded
                ? 'grid grid-cols-2 gap-3'
                : 'grid grid-cols-4 gap-4'
              : 'space-y-1.5',
          )}
        >
          {filtered.map((a) => (
            <AssetRow
              key={a.id}
              asset={a}
              siteId={siteId}
              variant={activeCat === 'assets' ? 'card' : 'row'}
              isEditing={editing === a.id}
              editName={editName}
              editDesc={editDesc}
              setEditName={setEditName}
              setEditDesc={setEditDesc}
              onStartEdit={() => onStartEdit(a)}
              onCancelEdit={() => setEditing(null)}
              onSaveEdit={() => onSaveEdit(a)}
              onCopyUrl={() => onCopyUrl(a)}
              onCopyHyTag={() => onCopyHyTag(a.name)}
              onEditContent={() => setContentEditor(a)}
              onDelete={() => setConfirmDelete(a)}
              onOpenLayouts={() => navigate(`/layouts?site=${siteId}&asset=${a.name}`)}
              copied={copied === a.id}
              canWrite={!!canWrite}
              selected={selected.has(a.id)}
              onToggleSelect={() => onToggleSelect(a.id)}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="删除资源"
        description={
          confirmDelete
            ? `确认删除 ${confirmDelete.name}? 此操作会从文件系统删除, 发布时会从 public/assets/ 移除, 引用此资源的模板也会断链。`
            : ''
        }
        confirmText="删除"
        onConfirm={() => confirmDelete && onDelete(confirmDelete)}
        variant="danger"
      />

      {canWrite && (
        <BatchActionBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          actions={[
            {
              key: 'delete',
              label: '批量删除',
              icon: Trash2,
              tone: 'destructive',
              confirm: true,
              confirmDestructive: true,
              confirmMessage: `确认删除已选的 ${selected.size} 个资源？会从文件系统删除，发布时从 public/assets/ 移除，引用它们的模板也会断链。`,
              onAction: onBatchDelete,
            },
          ]}
        />
      )}

      <ContentEditorDialog
        key={contentEditor?.id ?? 'none'}        // P3.7.5+++++ fix: 关闭 → 重开同 item 时强制重 mount, 重加载 content
        asset={contentEditor}
        onClose={() => setContentEditor(null)}
        onSaved={() => {
          setContentEditor(null);
          load();
        }}
        siteId={siteId}
      />
    </div>
  );
}

// === 小组件 ===

function FilePreview({ file, compact = false }: { file: File; compact?: boolean }) {
  const isImage = file.type.startsWith('image/');
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  const sizeClass = compact ? 'h-8 w-8' : 'h-16 w-16';
  const iconClass = compact ? 'h-3.5 w-3.5' : 'h-5 w-5';

  return (
    <div className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-card', sizeClass)}>
      {isImage && preview ? (
        <img src={preview} alt="" className="h-full w-full object-cover" />
      ) : isImage ? (
        <Loader2 className={cn('animate-spin text-muted-foreground', compact ? 'h-3 w-3' : 'h-4 w-4')} />
      ) : (
        <FileIcon className={cn('text-muted-foreground', iconClass)} />
      )}
    </div>
  );
}

function QueuedItemStatus({ item }: { item: { status: 'pending' | 'uploading' | 'done' | 'error' } }) {
  if (item.status === 'pending') return <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">等待</span>;
  if (item.status === 'uploading') return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> 上传中
    </span>
  );
  if (item.status === 'done') return (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
      <Check className="h-2.5 w-2.5" /> 成功
    </span>
  );
  return <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">失败</span>;
}

function AssetRow({
  asset, siteId, variant = 'row', isEditing, editName, editDesc, setEditName, setEditDesc,
  onStartEdit, onCancelEdit, onSaveEdit,
  onCopyUrl, onCopyHyTag, onEditContent, onDelete, onOpenLayouts,
  copied, canWrite, selected = false, onToggleSelect,
}: {
  asset: SiteAsset;
  siteId: string;
  variant?: 'row' | 'card';
  isEditing: boolean;
  editName: string;
  editDesc: string;
  setEditName: (v: string) => void;
  setEditDesc: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onCopyUrl: () => void;
  onCopyHyTag: () => void;
  onEditContent: () => void;
  onDelete: () => void;
  onOpenLayouts: () => void;
  copied: boolean;
  canWrite: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const catMeta = CATEGORY_META[asset.category];
  const isImage = asset.content_type.startsWith('image/');
  const [thumbErr, setThumbErr] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const fullUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}${asset.url}`;

  // P3.6.5+: fetch blob + 拿 auth token + 生成 blob URL (img src 不会自动带 Authorization)
  useEffect(() => {
    if (!isImage) return;
    let active = true;
    let url: string | null = null;
    (async () => {
      try {
        const r = await fetch(previewUrl(siteId, asset.category, asset.name), {
          headers: { Authorization: `Bearer ${useAuthStore.getState().accessToken || ''}` },
        });
        if (!r.ok) { if (active) setThumbErr(true); return; }
        const blob = await r.blob();
        if (!active) { blob.size; return; } // noop
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch {
        if (active) setThumbErr(true);
      }
    })();
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [isImage, siteId, asset.category, asset.name, asset.id]);
  // 扩展名作为 fallback 文本 (未发布 / 加载失败都走这个)
  const extLabel = asset.name.split('.').pop()?.toUpperCase().slice(0, 4) || '?';
  // 在 isImage 跟 not-error 时才试缩略图
  const showThumb = isImage && !thumbErr;
  const isCard = variant === 'card';

  const thumb = (
    <div
      className={cn(
        'overflow-hidden bg-secondary/60',
        isCard
          ? 'aspect-[16/10] w-full'
          : cn(
              'shrink-0 rounded-md border',
              isImage ? 'h-20 w-32' : cn('flex h-16 w-16 items-center justify-center', catMeta.bg),
            ),
      )}
    >
      {showThumb && blobUrl ? (
        <img
          src={blobUrl}
          alt={asset.name}
          className="h-full w-full object-contain"
          loading="lazy"
          onError={() => setThumbErr(true)}
        />
      ) : (
        <span className={cn('flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase', catMeta.color)}>
          {asset.category === 'css' ? 'CSS' : asset.category === 'js' ? 'JS' : extLabel}
        </span>
      )}
    </div>
  );

  const actions = (
    <div className="flex shrink-0 items-center gap-0.5">
      {isEditing ? (
        <>
          <Button size="icon" variant="default" className="h-6 w-6" onClick={onSaveEdit}>
            <Save className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCancelEdit}>
            <X className="h-3 w-3" />
          </Button>
        </>
      ) : (
        <div className={cn('flex items-center gap-0.5', !isCard && 'opacity-0 transition-opacity group-hover:opacity-100')}>
          {isEditable(asset.content_type) && (
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onEditContent} title="在线编辑内容">
              <Code2 className="h-3 w-3" />
            </Button>
          )}
          {canWrite && (
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onStartEdit} title="编辑名称/描述">
              <Edit3 className="h-3 w-3" />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCopyUrl} title="复制 URL">
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCopyHyTag} title="复制 HY_ASSET_URL">
            <Hash className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={onDelete} title="删除">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );

  const selectBtn = canWrite && onToggleSelect ? (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSelect(); }}
      className={cn(
        'flex h-4 w-4 items-center justify-center rounded border transition-colors',
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card',
        isCard && !selected && 'opacity-0 group-hover:opacity-100',
      )}
      title={selected ? '取消选中' : '选中'}
    >
      {selected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
    </button>
  ) : null;

  if (isCard) {
    return (
      <li
        className={cn(
          'group relative flex flex-col overflow-hidden rounded-lg border bg-background transition-colors',
          selected && 'border-primary ring-1 ring-primary/30',
          isEditing && 'border-blue-300 bg-blue-50/40',
          !isEditing && !selected && 'hover:border-border hover:bg-secondary/20',
        )}
      >
        {selectBtn && (
          <span className="absolute left-1.5 top-1.5 z-10">{selectBtn}</span>
        )}
        {thumb}
        <div className="flex flex-1 flex-col gap-1 p-2">
          {isEditing ? (
            <div className="flex flex-col gap-1.5">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-7 font-mono text-[12px]"
                placeholder="资源名"
              />
              <Input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="h-7 text-[12px]"
                placeholder="描述"
              />
            </div>
          ) : (
            <>
              <code className="truncate text-[12px] font-medium" title={asset.name}>{asset.name}</code>
              <code
                className="truncate rounded bg-secondary/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                title={originalPathLabel(asset.original_filename)}
              >
                {originalPathLabel(asset.original_filename)}
              </code>
              <p className="text-[11px] text-muted-foreground tabular-nums">{formatSize(asset.byte_size)}</p>
            </>
          )}
          <div className="mt-auto flex items-center justify-between">
            {actions}
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="新窗口打开"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li
      className={cn(
        'group rounded-lg border bg-background p-2.5 transition-colors',
        selected && 'border-primary ring-1 ring-primary/30',
        isEditing && 'border-blue-300 bg-blue-50/40',
        !isEditing && !selected && 'hover:border-border hover:bg-secondary/20',
      )}
    >
      <div className="flex items-start gap-3">
        {selectBtn && <span className="mt-2 shrink-0">{selectBtn}</span>}
        {thumb}

        {/* 主体 */}
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex flex-col gap-1.5">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-7 font-mono text-[12px]"
                placeholder="资源名"
              />
              <Input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="h-7 text-[12px]"
                placeholder="描述"
              />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <code className="truncate text-[13px] font-medium">{asset.name}</code>
                <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px] font-normal text-muted-foreground">
                  {asset.content_type}
                </Badge>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {formatSize(asset.byte_size)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">原始路径</span>
                <code
                  className="truncate rounded bg-secondary/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                  title={originalPathLabel(asset.original_filename)}
                >
                  {originalPathLabel(asset.original_filename)}
                </code>
              </div>
              {asset.description && (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{asset.description}</p>
              )}
              {/* 公开 URL 行 */}
              <div className="mt-1 flex items-center gap-1.5">
                <code className="truncate rounded bg-secondary/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {asset.url}
                </code>
                <button
                  type="button"
                  onClick={onCopyUrl}
                  className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="复制完整 URL"
                >
                  {copied ? <Check className="h-2.5 w-2.5 text-emerald-500" /> : <Copy className="h-2.5 w-2.5" />}
                </button>
                <a
                  href={fullUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="新窗口打开"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
                <button
                  type="button"
                  onClick={onCopyHyTag}
                  className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="复制 HY_ASSET_URL 标签"
                >
                  <Hash className="h-2.5 w-2.5" />
                </button>
              </div>
            </>
          )}
        </div>

        {/* 操作 */}
        <div className="flex shrink-0 items-center gap-0.5">
          {isEditing ? (
            <>
              <Button size="icon" variant="default" className="h-6 w-6" onClick={onSaveEdit}>
                <Save className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCancelEdit}>
                <X className="h-3 w-3" />
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {isEditable(asset.content_type) && (
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onEditContent} title="在线编辑内容">
                  <Code2 className="h-3 w-3" />
                </Button>
              )}
              {canWrite && (
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onStartEdit} title="编辑名称/描述">
                  <Edit3 className="h-3 w-3" />
                </Button>
              )}
              <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={onDelete} title="删除">
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// P3.6.3: 资源内容编辑器 (CSS/JS/JSON/XML/SVG)
interface ContentEditorDialogProps {
  asset: SiteAsset | null;
  siteId: string;
  onClose: () => void;
  onSaved: () => void;
}

function ContentEditorDialog({ asset, onClose, onSaved, siteId }: ContentEditorDialogProps) {
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // P3.7.5+++++ fix: 重开 dialog 时重复加载 (holy 反馈 #10409)
  // 问题: 关闭 → 打开 同 item 时 useEffect deps 不变, content 不重加载
  // 修: 加 contentVersion state, 父传新 asset (或手动加) → bump version → useEffect 重跑
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!asset) return;
    setLoading(true);
    setError(null);
    setContent('');
    setOriginal('');
    siteAssetsApi
      .getContent(siteId, asset.category, asset.name)
      .then((r) => {
        setContent(r.content);
        setOriginal(r.content);
      })
      .catch((e: any) => setError(e?.response?.data?.message || e?.message))
      .finally(() => setLoading(false));
  }, [asset?.id, asset?.name, siteId, reloadKey]);

  // P3.7.5++++ fix: hooks 顺序错 (holy 反馈 #10406)
  // 原代码: early return (if (!asset)) 在 2 个 useEffect 之间, asset 从有变无时少调一个 useEffect
  // 修: 把 onSave + 第 2 个 useEffect 提到 early return 之前 (hooks 稳定)
  const dirty = !!asset && content !== original;
  const newSize = new Blob([content]).size;
  const sizeOverLimit = newSize > 1024 * 1024;

  const onSave = async () => {
    if (!asset) return;
    if (!dirty || saving || sizeOverLimit) return;
    setSaving(true);
    setError(null);
    try {
      await siteAssetsApi.updateContent(siteId, asset.category, asset.name, content);
      toast.success(`已保存 ${asset.name}, 下次发布会复制到 public/assets/`);
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!asset) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [asset, content, dirty, sizeOverLimit]);

  if (!asset) return null;

  const lang = langForMime(asset.content_type);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex w-full max-w-4xl max-h-[90vh] flex-col rounded-lg bg-background shadow-md">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-muted-foreground" />
            <code className="text-sm font-semibold">{asset.name}</code>
            <Badge variant="outline" className="text-[10px] font-normal">{asset.content_type}</Badge>
            {dirty && (
              <Badge className="bg-amber-500 text-[10px] hover:bg-amber-500">未保存</Badge>
            )}
          </div>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="px-4 py-3 text-[11px] text-muted-foreground border-b bg-secondary/30">
          ⌘S 保存 · 改后需重新发布才能在静态产物中生效
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin inline" />
            </div>
          ) : (
            <>
              <CodeEditor
                value={content}
                onChange={setContent}
                language={asset.category === 'css' ? 'css' : 'javascript'}
                rows={22}
                error={sizeOverLimit}
              />
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {(newSize / 1024).toFixed(1)} KB
                  {sizeOverLimit && <span className="ml-2 text-destructive">超过 1MB 限制</span>}
                </span>
                {error && <span className="text-destructive">{error}</span>}
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-2.5">
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={onSave} disabled={!dirty || saving || sizeOverLimit || loading}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? '保存中' : '保存'}
          </Button>
        </div>
      </div>
    </div>
  );
}
