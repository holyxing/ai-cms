// CategoryContent.tsx - 栏目内容列表 (P2.8 D3 完整版)
// 依据: docs/17-站点树重构.md §5.6, OQ4 批量操作
//
// 功能:
// - 栏目标题 + 面包屑(从 path 反推)
// - 搜索 + 状态过滤
// - 列表(单选/多选)
// - 批量操作 toolbar (OQ4 批量移栏目 + 批量删除)
// - 新建文章(嵌入 category_id)
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { toast as sonnerToast } from 'sonner';
const toast = (msg: string) => sonnerToast.success(msg);
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Plus,
  Trash2,
  Pencil,
  Search,
  ChevronRight,
  X as XIcon,
  CheckSquare,
  Square,
  FolderInput,
  Loader2,
  Trash,
  Send,
  Undo2,
  Rocket,
  Archive,
  Image as ImageIcon,
  ExternalLink,
  FileCode,
  Flag,
} from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import { categoriesApi, type CategoryNode } from '@/api/categories';
import { sitesApi } from '@/api/sites';
import { contentsApi, type ContentListItem, type ContentStatus } from '@/api/contents';
import { watchDeploymentForNotifications } from '@/lib/notificationsSync';
import { MediaView } from '@/pages/Media';
import { useAuthStore } from '@/stores/auth';
import { CategorySettingsDialog as SharedCategorySettingsDialog } from '@/components/layout/CategorySettingsDialog';
import { useRecentSites } from '@/stores/recentSites';
import { useTabsStore } from '@/stores/tabs';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Badge,
  Skeleton,
  EmptyState,
  ConfirmDialog,
} from '@/components/ui';
import { BatchActionBar } from '@/components/BatchActionBar';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: '草稿',
  pending: '待审',
  published: '已发布',
  scheduled: '已计划',
  archived: '已归档',
};
const STATUS_VARIANT: Record<ContentStatus, 'default' | 'secondary' | 'muted' | 'warning' | 'success'> = {
  draft: 'muted',
  pending: 'warning',
  published: 'success',
  scheduled: 'secondary',
  archived: 'muted',
};

function slugifyCategoryName(name: string): string {
  const asciiSafe = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .trim();

  let pinyinStr = '';
  if (/[\u4e00-\u9fa5]/.test(asciiSafe)) {
    pinyinStr = pinyin(asciiSafe, {
      toneType: 'none',
      type: 'array',
      v: true,
      nonZh: 'consecutive',
    }).join('');
  } else {
    pinyinStr = asciiSafe;
  }

  return pinyinStr
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'cat';
}

export function CategoryContentPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const renameTab = useTabsStore((s) => s.renameTab);
  const currentUser = useAuthStore((s) => s.user);
  const recents = useRecentSites((s) => s.sites);

  const healthNoCover = searchParams.get('no_cover') === '1';
  const healthNoTags = searchParams.get('no_tags') === '1';
  const staleRaw = searchParams.get('stale');
  const staleDays = staleRaw && /^\d+$/.test(staleRaw) ? Number(staleRaw) : undefined;
  const siteWide = !categoryId;

  // === 状态 ===
  const urlStatus = searchParams.get('status');
  const [statusFilter, setStatusFilter] = useState<ContentStatus | ''>(
    urlStatus === 'draft' || urlStatus === 'pending' || urlStatus === 'published'
      || urlStatus === 'scheduled' || urlStatus === 'archived'
      ? urlStatus
      : '',
  );
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [indexDeleted, setIndexDeleted] = useState(false);
  // 切换栏目时重置
  useEffect(() => { setIndexDeleted(false); }, [categoryId]);
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; title?: string } | null>(null);
  const [moveMenu, setMoveMenu] = useState<{ x: number; y: number; tree: CategoryNode[] } | null>(null);
  // P3.6.1
  const [settingsOpen, setSettingsOpen] = useState(false);
  // P3.6.1: 发布 / 取消发布 确认
  const [confirmPublish, setConfirmPublish] = useState<{ id: string; title: string } | null>(null);
  const [confirmUnpublish, setConfirmUnpublish] = useState<{ id: string; title: string } | null>(null);
  // P3.6.1 模板 tab
  // P3.6.2 媒体库 tab (内嵌到栏目页)
  const [activeTab, setActiveTab] = useState<'content' | 'template' | 'media'>('content');

  // === 查询 ===
  const catQ = useQuery({
    queryKey: ['category', categoryId],
    queryFn: () => categoriesApi.get(categoryId!, { skipToast: true }),
    enabled: !!categoryId,
  });

  // tab 标题用栏目标题，避免多个「栏目」无法区分
  useEffect(() => {
    if (!catQ.data?.name) return;
    renameTab(location.pathname, catQ.data.name);
  }, [catQ.data?.id, catQ.data?.name, location.pathname, renameTab]);

  const siteId = catQ.data?.site_id ?? recents[0]?.id;

  const siteQ = useQuery({
    queryKey: ['site', siteId],
    queryFn: () => sitesApi.get(siteId!, { skipToast: true }),
    enabled: !!siteId,
  });

  const treeQ = useQuery({
    queryKey: ['category-tree', siteId],
    queryFn: () => categoriesApi.tree(siteId!),
    enabled: !!siteId,
    staleTime: 30_000,
  });

  const contentsQ = useQuery({
    queryKey: ['contents', siteId, categoryId, statusFilter, search, healthNoCover, healthNoTags, staleDays],
    queryFn: () =>
      contentsApi.list(siteId!, {
        category_id: siteWide ? undefined : categoryId!,
        status: statusFilter || undefined,
        q: search || undefined,
        no_cover: healthNoCover || undefined,
        no_tags: healthNoTags || undefined,
        stale_days: staleDays,
      }),
    enabled: !!siteId && (!!categoryId || siteWide),
  });

  // === Mutations ===
  const removeMut = useMutation({
    mutationFn: async (ids: string[]) => {
      // P6.2 #16: 用 batch 端点代替 N 次单个调用
      const res = await contentsApi.batch(siteId!, 'delete', ids);
      if (res.failed > 0) {
        throw new Error(res.results.find((r) => !r.success)?.error || '部分失败');
      }
      return res;
    },
    onSuccess: (data) => {
      sonnerToast.success(`已删除 ${data.succeeded} 篇${data.failed > 0 ? ` (${data.failed} 失败)` : ''}，可在侧栏回收站还原`);
      qc.invalidateQueries({ queryKey: ['contents', siteId] });
      qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
      qc.invalidateQueries({ queryKey: ['site-trash-counts', siteId] });
      setSelected(new Set());
      setConfirmDelete(null);
    },
    onError: (e: Error) => sonnerToast.error(`删除失败: ${e.message}`),
  });

  // P6.2 #16: 批量归档/发布/恢复 (独立 mutation)
  const batchMut = useMutation({
    mutationFn: async (params: { action: 'archive' | 'publish' | 'restore'; ids: string[] }) => {
      const res = await contentsApi.batch(siteId!, params.action, params.ids);
      const successIds = new Set(res.results.filter((r) => r.success).map((r) => r.content_id));
      // 从选择里移除已成功的
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of successIds) next.delete(id);
        return next;
      });
      return res;
    },
    onSuccess: (data, params) => {
      const label = { archive: '归档', publish: '发布', restore: '恢复' }[params.action];
      sonnerToast.success(`批量${label}: 成功 ${data.succeeded}, 失败 ${data.failed}`);
      if (data.failed > 0) {
        const errs = data.results.filter((r) => !r.success).slice(0, 3);
        sonnerToast.error(`失败: ${errs.map((e) => e.error).join('; ')}`, { duration: 8000 });
      }
      qc.invalidateQueries({ queryKey: ['contents', siteId] });
      qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
    },
    onError: (e: Error) => sonnerToast.error(`批量操作失败: ${e.message}`),
  });

  const moveMut = useMutation({
    mutationFn: async (params: { ids: string[]; targetId: string | null }) => {
      await Promise.all(
        params.ids.map((cid) =>
          contentsApi.update(siteId!, cid, { category_id: params.targetId })
        )
      );
    },
    onSuccess: (_, p) => {
      const targetName = p.targetId
        ? findNameInTree(treeQ.data?.tree ?? [], p.targetId) || '目标栏目'
        : '未分类';
      toast(`已移动 ${p.ids.length} 篇到 "${targetName}"`);
      qc.invalidateQueries({ queryKey: ['contents', siteId] });
      qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
      setSelected(new Set());
      setMoveMenu(null);
    },
  });

  // P3.6.1: 列表行内发布 / 取消发布
  const publishMut = useMutation({
    mutationFn: (contentId: string) => contentsApi.publish(siteId!, contentId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['contents', siteId] });
      qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
      qc.invalidateQueries({ queryKey: ['content', siteId, data.id] });
      toast(data.status === 'published' ? '已发布' : '已提交发布');
      setConfirmPublish(null);
    },
    onError: (e: any) => sonnerToast.error(e?.message || '发布失败'),
  });

  const unpublishMut = useMutation({
    mutationFn: (contentId: string) => contentsApi.unpublish(siteId!, contentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contents', siteId] });
      qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
      toast('已取消发布, 转为草稿');
      setConfirmUnpublish(null);
    },
    onError: (e: any) => sonnerToast.error(e?.message || '取消发布失败'),
  });

  // === 派生 ===
  const items = contentsQ.data?.items ?? [];
  const total = contentsQ.data?.total ?? 0;
  const cat = catQ.data;

  // P3.6.1+: 触发栏目级静态部署
  const publishCategoryMut = useMutation({
    mutationFn: () => categoriesApi.publishStatic(siteId!, cat!.id),
    onSuccess: (job) => {
      sonnerToast.success('栏目发布任务已入队, 几秒后生效');
      watchDeploymentForNotifications(job?.id);
    },
    onError: (e: any) => sonnerToast.error(e?.message || '栏目发布失败'),
  });

  // P3.9.1+ fix (holy 反馈 #11211): 之前 navigate 到 /sites/{siteId}/contents/new?cat=... 是错误路由
  // (那个路由不存在, 'new' 被当 contentId 打后端返 422). 改成调 contentsApi.create 一条占位后 navigate 到详情页
  const newContentMut = useMutation({
    mutationFn: async () => {
      const defaultTitle = '未命名文章';
      // 占位 slug 必须唯一（站点级约束）；untitled-* 在详情页视为自动 slug，改标题会跟着变
      const uniqueSlug = `untitled-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const c = await contentsApi.create(siteId!, {
        title: defaultTitle,
        slug: uniqueSlug,
        category_id: categoryId!,
      });
      return c;
    },
    onSuccess: (c) => {
      sonnerToast.success('文章已创建, 请继续编辑');
      qc.invalidateQueries({ queryKey: ['contents', categoryId] });
      navigate(`/sites/${siteId}/contents/${c.id}`);
    },
    onError: (e: any) => sonnerToast.error(e?.message || '创建失败'),
  });
  const allSelected = items.length > 0 && items.every((c) => selected.has(c.id));
  const someSelected = items.some((c) => selected.has(c.id)) && !allSelected;

  const batchActions = useMemo(() => {
    return [
      {
        key: 'publish',
        label: '批量发布',
        icon: Rocket,
        tone: 'primary' as const,
        confirm: true,
        confirmMessage: `将 ${selected.size} 篇内容标记为已发布？`,
        onAction: () => batchMut.mutateAsync({ action: 'publish', ids: [...selected] }),
      },
      {
        key: 'archive',
        label: '批量归档',
        icon: Archive,
        confirm: true,
        confirmMessage: `将 ${selected.size} 篇内容归档？`,
        onAction: () => batchMut.mutateAsync({ action: 'archive', ids: [...selected] }),
      },
      {
        key: 'move',
        label: '批量移栏目',
        icon: FolderInput,
        onAction: async () => {
          setMoveMenu({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
            tree: treeQ.data?.tree ?? [],
          });
        },
      },
      {
        key: 'delete',
        label: '批量删除',
        icon: Trash2,
        tone: 'destructive' as const,
        confirm: true,
        confirmDestructive: true,
        confirmMessage: `将 ${selected.size} 篇内容删除到回收站？可在侧栏「回收站」还原。`,
        onAction: () => removeMut.mutateAsync([...selected]),
      },
    ];
  }, [selected, batchMut, removeMut, treeQ.data?.tree]);

  // 面包屑(从 path 字段反推)
  const breadcrumbs = useMemo(() => {
    if (!cat) return [];
    // cat.path 形如 "/a/b/c", 显示名字需要 tree 数据
    const tree = treeQ.data?.tree ?? [];
    const ids = (cat.path || '').split('/').filter(Boolean);
    return ids.map((id) => {
      const n = findInTree(tree, id);
      return { id, name: n?.name || '...' };
    });
  }, [cat, treeQ.data]);

  // === 渲染: 加载中 ===
  if (siteWide) {
    if (!siteId) return <EmptyState title="请选择站点" description="内容健康度跳转需要先有一个站点" />;
  } else {
    if (!categoryId) return <EmptyState title="请选择栏目" />;
    if (catQ.isLoading) {
      return (
        <div className="p-6 space-y-3">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      );
    }
    if (catQ.isError || !cat) {
      // P3.6.5: 如果传的 id 拿不到 category, 可能是误传了 siteId —— 跳到该站点第一个栏目
      return <CategoryFallbackRedirect categoryId={categoryId} />;
    }
  }

  // === 渲染: 完整页面 ===
  return (
    <div className="py-6">
      {breadcrumbs.length > 1 && (
        <nav className="mb-1.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
          {breadcrumbs.slice(0, -1).map((b, i) => (
            <span key={b.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-2.5 w-2.5" />}
              <button
                onClick={() => navigate(`/c/${b.id}`)}
                className="hover:text-foreground hover:underline"
              >
                {b.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      {/* === 标题区 (P3.9.1+ 重构: 3 段 flex, 紧凑, 去除重复) === */}
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* 左: 标题 + 描述 + 总数 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-semibold tracking-tight">{cat?.name ?? '全部内容'}</h1>
            <span className="text-[11px] text-muted-foreground">· 共 {total} 篇</span>
          </div>
          {cat?.description && (
            <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{cat.description}</p>
          )}
        </div>

        {/* 中: 模板标签 + 栏目设置 */}
        {cat && (
        <div className="flex items-center gap-1.5">
          {cat.template && (
            <span
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10.5px] font-medium',
                cat.template === 'news-list'
                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-border bg-secondary/50 text-muted-foreground',
              )}
              title={`当前布局模板: ${cat.template}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
              {cat.template === 'news-list' ? '新闻资讯' : '默认列表'}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setSettingsOpen(true)}
            title="栏目设置 (名称/slug/描述/布局模板)"
          >
            <Pencil className="h-3 w-3" />
            栏目设置
          </Button>
        </div>
        )}

        {/* 右: 主操作 (新建文章 + 发布本栏目) */}
        {cat && (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-[12px]"
            onClick={() => publishCategoryMut.mutate()}
            disabled={publishCategoryMut.isPending}
            title="只重新生成这个栏目的静态页面 (其他栏目不受影响)"
          >
            <Rocket className="h-3 w-3" />
            {publishCategoryMut.isPending ? '发布中…' : '发布本栏目'}
          </Button>
          <Button
            size="sm"
            className="h-7 text-[12px]"
            disabled={!siteId || !categoryId || newContentMut.isPending}
            onClick={() => newContentMut.mutate()}
          >
            <Plus className="h-3 w-3" />
            {newContentMut.isPending ? '创建中…' : '新建文章'}
          </Button>
        </div>
        )}
      </header>

      {/* 批量操作 toolbar (OQ4) - P6.2 #16 重构: 统一用 BatchActionBar, 浮在底部, 加 批量发布/归档/恢复 */}
      <BatchActionBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        actions={batchActions}
      />

      {/* P3.9.1+ 紧凑化: tab + 搜索 + 状态过滤 + trash 同一行 (默认隐藏, trashMode/模板/媒体 tab 切换时跟变) */}
      {activeTab === 'content' ? (
      <>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/* Tab (内容列表 / 模板 / 媒体库) */}
          <div className="flex items-center gap-0.5 rounded-md border bg-background p-0.5">
            <button
              onClick={() => setActiveTab('content')}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-[11.5px] font-medium transition-colors',
                activeTab === 'content'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <FileText className="h-3 w-3" strokeWidth={2} />
              内容列表
            </button>
            {!siteWide && (
            <button
              onClick={() => setActiveTab('template')}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-[11.5px] font-medium transition-colors',
                'text-muted-foreground hover:text-foreground',
              )}
            >
              <Pencil className="h-3 w-3" strokeWidth={2} />
              模板
            </button>
            )}
            <button
              onClick={() => setActiveTab('media')}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-[11.5px] font-medium transition-colors',
                'text-muted-foreground hover:text-foreground',
              )}
            >
              <ImageIcon className="h-3 w-3" strokeWidth={2} />
              媒体库
            </button>
          </div>

          <div className="h-4 w-px bg-border" />

          {/* 搜索 */}
          <div className="relative w-40">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索标题/slug…"
              className="h-7 pl-8 text-[11.5px]"
            />
          </div>

          {/* 状态过滤 */}
          <div className="flex rounded-md border bg-background p-0.5">
            {(['', 'draft', 'pending', 'published', 'scheduled', 'archived'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s as ContentStatus | '')}
                className={cn(
                  'h-6 rounded px-2.5 text-[11px] font-medium transition-colors',
                  statusFilter === s
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s === '' ? '全部' : STATUS_LABEL[s as ContentStatus]}
              </button>
            ))}
          </div>
      </div>

      {/* 列表 */}
      {/* P3.9.1+ 去 Card 嵌套, 紧凑行式列表 */}
      <div className="rounded-md border bg-background">
        <div className="flex items-center gap-2 border-b px-3 py-1.5">
          <button
            onClick={() => {
              if (allSelected) setSelected(new Set());
              else setSelected(new Set(items.map((c) => c.id)));
            }}
            className="flex h-5 w-5 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            title={allSelected ? '取消全选' : '全选当前页'}
          >
            {allSelected ? (
              <CheckSquare className="h-3.5 w-3.5" />
            ) : someSelected ? (
              <CheckSquare className="h-3.5 w-3.5 text-blue-500" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
          </button>
          <span className="text-[12px] font-medium">文章列表 ({total})</span>
        </div>

        {/* 栏目首页 index.html 条目 */}
        {cat?.slug && siteQ.data?.slug && !indexDeleted && (
          <div className="flex items-center gap-2 border-b bg-blue-50/50 px-3 py-2">
            <FileCode className="h-4 w-4 text-blue-600 shrink-0" />
            <span className="text-[12px] font-medium text-slate-700">
              {cat.slug}/index.html
            </span>
            <span className="text-[10px] text-muted-foreground">栏目首页</span>
            <a
              href={`/sites/${siteQ.data.slug}/${cat.parent_id ? (() => {
                const tree = treeQ.data?.tree ?? [];
                const parent = findInTree(tree, cat.parent_id!);
                return parent?.slug ? `${parent.slug}/${cat.slug}` : cat.slug;
              })() : cat.slug}/index.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              查看线上页
            </a>
            <button
              type="button"
              className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-700"
              title="删除栏目首页"
              onClick={() => {
                if (!confirm('确定删除该栏目的 index.html？')) return;
                categoriesApi.deleteIndexPage(cat.id).then(() => {
                  sonnerToast.success('栏目首页已删除');
                  setIndexDeleted(true);
                }).catch((e: Error) => {
                  sonnerToast.error(`删除失败: ${e.message}`);
                });
              }}
            >
              <Trash className="h-3 w-3" />
            </button>
          </div>
        )}

        <div>
          {contentsQ.isLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={FileText}
                title={search || statusFilter ? '没有匹配的文章' : '还没有文章'}
                description={
                  search || statusFilter
                    ? '尝试调整搜索条件'
                    : '点击右上角"新建文章"开始'
                }
              />
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((c) => (
                <ContentRow
                  key={c.id}
                  c={c}
                  checked={selected.has(c.id)}
                  onCheck={(id, v) => {
                    setSelected((s) => {
                      const next = new Set(s);
                      if (v) next.add(id);
                      else next.delete(id);
                      return next;
                    });
                  }}
                  onEdit={(cid) =>
                    navigate(`/sites/${siteId}/contents/${cid}`)
                  }
                  onPublish={(cid, title) => setConfirmPublish({ id: cid, title })}
                  onUnpublish={(cid, title) => setConfirmUnpublish({ id: cid, title })}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
      </>
      ) : activeTab === 'template' && cat ? (
        <TemplateTabPanel
          category={cat}
          siteId={siteId!}
          onSwitchToContent={() => setActiveTab('content')}
        />
      ) : activeTab === 'media' ? (
        <div className="-mx-4 -mb-4 rounded-lg border bg-background">
          <MediaView siteId={siteId!} embedded />
        </div>
      ) : null}


      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && removeMut.mutate(confirmDelete.ids)}
        title={confirmDelete?.ids.length === 1 ? '删除文章' : `批量删除 ${confirmDelete?.ids.length} 篇`}
        description={
          confirmDelete?.ids.length === 1 && confirmDelete.title
            ? `确认删除 "${confirmDelete.title}"? 可在侧栏回收站还原。`
            : `确认删除选中的 ${confirmDelete?.ids.length} 篇? 可在侧栏回收站还原。`
        }
        confirmText="删除"
        loading={removeMut.isPending}
      />

      {/* P3.6.1: 发布确认 */}
      <ConfirmDialog
        open={!!confirmPublish}
        onClose={() => setConfirmPublish(null)}
        onConfirm={() => confirmPublish && publishMut.mutate(confirmPublish.id)}
        title="发布文章"
        description={
          confirmPublish
            ? `确认发布 "${confirmPublish.title}"? 发布后, 上次站点发布产物中会包含它。`
            : ''
        }
        confirmText="发布"
        variant="info"
        loading={publishMut.isPending}
      />

      {/* P3.6.1: 取消发布确认 */}
      <ConfirmDialog
        open={!!confirmUnpublish}
        onClose={() => setConfirmUnpublish(null)}
        onConfirm={() => confirmUnpublish && unpublishMut.mutate(confirmUnpublish.id)}
        title="取消发布"
        description={
          confirmUnpublish
            ? `确认取消发布 "${confirmUnpublish.title}"? 文章会变为草稿, 下次站点发布会从静态站中移除。`
            : ''
        }
        confirmText="取消发布"
        variant="danger"
        loading={unpublishMut.isPending}
      />

      {/* 批量移栏目 - 右键风格的弹出位置选择菜单 (简化版) */}
      {moveMenu && (
        <MoveToMenu
          tree={moveMenu.tree}
          excludeId={categoryId}
          onSelect={(targetId) => {
            moveMut.mutate({ ids: Array.from(selected), targetId });
          }}
          onClose={() => setMoveMenu(null)}
        />
      )}

      {/* P3.6.1: 栏目设置 (name/slug/description/template) */}
      {siteId && catQ.data && (
        <SharedCategorySettingsDialog
          open={settingsOpen}
          category={catQ.data}
          siteId={siteId}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            catQ.refetch();
            treeQ.refetch();
            toast('栏目设置已保存');
          }}
        />
      )}
    </div>
  );
}

// === 列表行 ===
function ContentRow({
  c,
  checked,
  onCheck,
  onEdit,
  onPublish,
  onUnpublish,
}: {
  c: ContentListItem;
  checked: boolean;
  onCheck: (id: string, v: boolean) => void;
  onEdit: (id: string) => void;
  onPublish?: (id: string, title: string) => void;
  onUnpublish?: (id: string, title: string) => void;
}) {
  return (
    <li className="flex items-start gap-2.5 px-3 py-2 hover:bg-secondary/40 transition-colors">
      <button
        onClick={() => onCheck(c.id, !checked)}
        className="mt-1.5 flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      >
        {checked ? (
          <CheckSquare className="h-3.5 w-3.5 text-blue-600" />
        ) : (
          <Square className="h-3.5 w-3.5" />
        )}
      </button>
      <FileText className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(c.id)}
            className="truncate text-sm font-medium hover:underline"
          >
            {c.title}
          </button>
          {c.is_featured && (
            <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title="头条文章">
              <Flag className="h-3 w-3" />头条
            </span>
          )}
          <Badge variant={STATUS_VARIANT[c.status]} className="text-[10px]">
            {STATUS_LABEL[c.status]}
          </Badge>
        </div>
        {c.subtitle && (
          <p className="mt-1 truncate text-[11.5px] text-muted-foreground">{c.subtitle}</p>
        )}
        {c.excerpt && (
          <p className="mt-1 truncate text-[11px] text-muted-foreground/80 italic">{c.excerpt}</p>
        )}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <code className="rounded bg-secondary px-1 py-0.5">/{c.slug}</code>
          <span>·</span>
          <span>{c.author_name || '匿名'}</span>
          <span>·</span>
          <span>
            更新{' '}
            {new Date(c.updated_at).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {c.view_count > 0 && (
            <>
              <span>·</span>
              <span>{c.view_count} 浏览</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-0.5">
            {/* P3.6.1: 发布 / 取消发布 (仅特定状态显示) */}
            {c.status !== 'published' && c.status !== 'archived' && onPublish && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-emerald-600 hover:bg-emerald-50"
                onClick={() => onPublish(c.id, c.title)}
                title={c.status === 'draft' ? '发布' : c.status === 'pending' ? '审核通过并发布' : '发布'}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            )}
            {c.status === 'published' && onUnpublish && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-amber-600 hover:bg-amber-50"
                onClick={() => onUnpublish(c.id, c.title)}
                title="取消发布 (变草稿)"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onEdit(c.id)}
              title="编辑"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
      </div>
    </li>
  );
}

// === 批量移栏目 - 树状选择弹层 (位置在点击处附近) ===
function MoveToMenu({
  tree,
  excludeId,
  onSelect,
  onClose,
}: {
  tree: CategoryNode[];
  excludeId: string;
  onSelect: (targetId: string | null) => void;
  onClose: () => void;
}) {
  // 简化: 居中显示
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border bg-background shadow-lg"
      >
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h3 className="text-sm font-medium">移动到栏目</h3>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <XIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {/* 移到根 = 未分类 */}
          <button
            onClick={() => onSelect(null)}
            className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-secondary/80"
          >
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span>未分类</span>
          </button>
          <div className="my-1 h-px bg-border" />
          {tree.map((n) => (
            <CategoryTreeOption
              key={n.id}
              node={n}
              depth={0}
              excludeId={excludeId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoryTreeOption({
  node,
  depth,
  excludeId,
  onSelect,
}: {
  node: CategoryNode;
  depth: number;
  excludeId: string;
  onSelect: (id: string | null) => void;
}) {
  const isExcluded = node.id === excludeId;
  return (
    <>
      <button
        disabled={isExcluded}
        onClick={() => !isExcluded && onSelect(node.id)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-[12px] transition-colors',
          isExcluded
            ? 'cursor-not-allowed text-muted-foreground/50'
            : 'hover:bg-secondary/80'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <FileText className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
        <span className="flex-1 truncate">
          {node.name}
          {isExcluded && (
            <span className="ml-1 text-[10px] text-muted-foreground">(当前)</span>
          )}
        </span>
      </button>
      {(node.children || []).map((c) => (
        <CategoryTreeOption
          key={c.id}
          node={c}
          depth={depth + 1}
          excludeId={excludeId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

// === 工具 ===
function findInTree(tree: CategoryNode[], id: string): CategoryNode | null {
  for (const n of tree) {
    if (n.id === id) return n;
    const f = findInTree(n.children || [], id);
    if (f) return f;
  }
  return null;
}
function findNameInTree(tree: CategoryNode[], id: string): string | null {
  return findInTree(tree, id)?.name ?? null;
}

// === 栏目设置对话框 (P3.6.1: 加 template 字段) ===
function LegacyCategorySettingsDialog({
  open,
  category,
  siteId,
  onClose,
  onSaved,
}: {
  open: boolean;
  category: (CategoryNode & { children?: CategoryNode[] }) | null;
  siteId: string;
  onClose: () => void;
  onSaved: (cat: Partial<CategoryNode>) => void;
}) {
  const [name, setName] = useState(category?.name || '');
  const [slug, setSlug] = useState(category?.slug || '');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState(category?.description || '');
  const [template, setTemplate] = useState(category?.template || 'default');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && category) {
      setName(category.name);
      setSlug(category.slug);
      setSlugTouched(false);
      setDescription(category.description || '');
      setTemplate(category.template || 'default');
      setError('');
    }
  }, [open, category]);

  useEffect(() => {
    if (!slugTouched) setSlug(slugifyCategoryName(name));
  }, [name, slugTouched]);

  // P3.6.1: 拉取可用模板列表 (从 layouts.scope=category)
  const templatesQ = useQuery({
    queryKey: ['category-templates', siteId],
    queryFn: () => categoriesApi.listTemplates(siteId),
    enabled: open && !!siteId,
    staleTime: 60_000,
  });

  const saveMut = useMutation({
    mutationFn: () =>
      categoriesApi.update(category!.id, {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        template,
      }),
    onSuccess: (c) => {
      onSaved(c);
      onClose();
    },
    onError: (e: any) => setError(e?.message || '保存失败'),
  });

  if (!open || !category) return null;
  const validSlug = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim());
  const templates = templatesQ.data ?? [];
  const currentTemplate = templates.find((t) => t.code === template);
  const isNewsTemplate = template === 'news-list';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold">栏目设置</h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <XIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            if (!name.trim() || !validSlug) {
              setError('名称和 slug 必填 (slug 只能含小写字母/数字/连字符)');
              return;
            }
            saveMut.mutate();
          }}
          className="space-y-3 p-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="cs-name" className="text-xs font-medium">名称 *</Label>
            <Input
              id="cs-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cs-slug" className="text-xs font-medium">
              Slug *
            </Label>
            <div className="flex items-stretch overflow-hidden rounded-md border focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
              <span className="flex items-center border-r bg-secondary/40 px-2 font-mono text-xs text-muted-foreground select-none">
                /
              </span>
              <input
                id="cs-slug"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value.toLowerCase());
                  setSlugTouched(true);
                }}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="公司介绍 → gongsijieshao"
                className="h-9 flex-1 bg-background px-2 text-sm font-mono focus:outline-none placeholder:text-muted-foreground/60"
              />
              {slugTouched && (
                <button
                  type="button"
                  onClick={() => {
                    setSlug(slugifyCategoryName(name));
                    setSlugTouched(false);
                  }}
                  title="从名称重新生成拼音"
                  className="border-l px-2 text-[11px] text-blue-600 transition-colors hover:bg-blue-50"
                >
                  重新生成
                </button>
              )}
            </div>
            {slug.trim() && validSlug ? (
              <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                <span>预览:</span>
                <code className="text-foreground/80">/{slug.trim()}/</code>
                {!slugTouched && /[\u4e00-\u9fa5]/.test(name) && (
                  <span className="text-blue-600">· 已从名称自动转全拼</span>
                )}
                {slugTouched && (
                  <span className="text-amber-600">· 手动改过, 不再随名称变化</span>
                )}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                只能含小写字母、数字、连字符
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cs-desc" className="text-xs font-medium">描述</Label>
            <Input
              id="cs-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          {/* P3.6.1: 页面布局 (调用 layouts.code) */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">页面布局</Label>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {templates.length === 0 && (
                <>
                  <option value="default">默认列表</option>
                  <option value="news-list">新闻资讯</option>
                </>
              )}
              {templates.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}{t.is_default ? ' (默认)' : ''}
                </option>
              ))}
            </select>
            {currentTemplate && (
              <p className="text-[10px] text-muted-foreground">
                代码：<code className="font-mono">{currentTemplate.code}</code>
              </p>
            )}
            {isNewsTemplate && (
              <div className="rounded-md border border-blue-200 bg-blue-50/50 px-3 py-2 text-[11px] text-blue-700">
                新闻资讯模式：该栏目将作为新闻聚合页发布，下属内容需要 <strong>封面图</strong> 才能在卡片上完整展示。
              </div>
            )}
          </div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="h-8 text-xs">
              取消
            </Button>
            <Button type="submit" disabled={saveMut.isPending} className="h-8 text-xs">
              {saveMut.isPending ? '保存中...' : '保存'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// === P3.6.1: 模板 Tab 内容 ===
// 列出当前栏目可用的 layout 模板, 当前选中态 + HTML 预览摘要
function TemplateTabPanel({
  category,
  siteId,
  onSwitchToContent,
}: {
  category: { id: string; name: string; template: string; description: string | null };
  siteId: string;
  onSwitchToContent: () => void;
}) {
  const qc = useQueryClient();
  const [previewCode, setPreviewCode] = useState<string | null>(null);

  const templatesQ = useQuery({
    queryKey: ['category-templates', siteId],
    queryFn: () => categoriesApi.listTemplates(siteId),
    enabled: !!siteId,
    staleTime: 60_000,
  });

  const fullLayoutQ = useQuery({
    queryKey: ['category-layout-full', siteId, previewCode],
    queryFn: async () => {
      const all = await categoriesApi.listTemplates(siteId);
      const target = all.find((t) => t.code === previewCode);
      if (!target) return null;
      // 拉完整 layout (含 html) — 需要新 API 或用 listTemplates 间接实现
      // 简化: 拉 layouts 列表 (不返 html) — 这里只显示代码名 + 状态
      return target;
    },
    enabled: !!previewCode && !!siteId,
  });

  const switchMut = useMutation({
    mutationFn: (newCode: string) =>
      categoriesApi.update(category.id, { template: newCode }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['category', category.id] });
      qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
      toast('已切换布局模板 (下次发布生效)');
    },
    onError: (e: any) => sonnerToast.error(e?.message || '切换失败'),
  });

  const templates = templatesQ.data ?? [];
  const currentCode = category.template;

  // 模板描述 + 适用场景 (UI 友好)
  const TEMPLATE_META: Record<string, { icon: string; subtitle: string; best_for: string }> = {
    'default': {
      icon: '📋',
      subtitle: '普通文章列表',
      best_for: '技术博客 / 案例分析 / 单篇内容',
    },
    'news-list': {
      icon: '📰',
      subtitle: '新闻卡片墙',
      best_for: '新闻资讯 / 行业动态 / 公司动态 / 频繁更新的内容',
    },
  };

  return (
    <div className="space-y-4">
      {/* 当前选中 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            当前布局模板
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-5 pt-0">
          <div className="flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50/50 p-3">
            <span className="text-2xl">{TEMPLATE_META[currentCode]?.icon ?? '📄'}</span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {templates.find((t) => t.code === currentCode)?.name ?? currentCode}
                </span>
                <code className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-[10px] text-blue-700">
                  {currentCode}
                </code>
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {TEMPLATE_META[currentCode]?.subtitle ?? '自定义模板'}
              </p>
            </div>
            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white">
              已应用
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            💡 切换模板不会影响已有内容, 也不会立即重新发布。点击「发布」后新模板会应用到生成的静态站。
          </p>
        </CardContent>
      </Card>

      {/* 可用模板列表 */}
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          可用模板 ({templates.length})
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {templatesQ.isLoading && (
            <div className="col-span-2 flex items-center justify-center rounded-md border bg-secondary/30 py-8 text-[12px] text-muted-foreground">
              加载模板列表...
            </div>
          )}
          {templates.map((t) => {
            const meta = TEMPLATE_META[t.code] ?? {
              icon: '📄',
              subtitle: t.name,
              best_for: '自定义模板',
            };
            const isCurrent = t.code === currentCode;
            return (
              <button
                key={t.code}
                onClick={() => !isCurrent && switchMut.mutate(t.code)}
                disabled={isCurrent || switchMut.isPending}
                className={cn(
                  'group flex flex-col items-start gap-2 rounded-lg border bg-card p-4 text-left transition-all',
                  isCurrent
                    ? 'border-blue-500 ring-2 ring-blue-200'
                    : 'border-border hover:border-blue-300 hover:shadow-md',
                  switchMut.isPending && 'opacity-50',
                )}
              >
                <div className="flex w-full items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{meta.icon}</span>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{t.name}</div>
                      <code className="font-mono text-[10px] text-muted-foreground">{t.code}</code>
                    </div>
                  </div>
                  {isCurrent && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                      当前
                    </span>
                  )}
                  {t.is_default && !isCurrent && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                      默认
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-muted-foreground">{meta.subtitle}</p>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/80">
                  <span>适用:</span>
                  <span>{meta.best_for}</span>
                </div>
                {!isCurrent && (
                  <div className="mt-2 flex w-full items-center justify-end text-[11px] font-medium text-blue-600 opacity-0 transition-opacity group-hover:opacity-100">
                    点击切换 →
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 提示 */}
      <div className="flex items-center justify-between rounded-md border border-dashed border-border bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
        <span>想要更复杂的布局? 可在「主题/布局」里编辑 HTML 模板 (HY_ 标签占位符)。</span>
        <button
          onClick={onSwitchToContent}
          className="text-blue-600 hover:underline"
        >
          返回内容 →
        </button>
      </div>
    </div>
  );
}

/**
 * P3.6.5: 传错 id (常是误传 siteId) 的友好 fallback
 * - 尝试用该 id 作为 siteId 拿第一个 category
 * - 成功 → 跳 /c/{first.id}
 * - 失败 (不是站点也不是栏目) → 提示明确错误
 */
function CategoryFallbackRedirect({ categoryId }: { categoryId: string }) {
  const navigate = useNavigate();
  const siteProbe = useQuery({
    queryKey: ["site-probe", categoryId],
    queryFn: () => sitesApi.get(categoryId, { skipToast: true }),
    retry: false,
  });

  useEffect(() => {
    if (siteProbe.isLoading) return;
    if (siteProbe.isError || !siteProbe.data) {
      // 确实不是站点也不是栏目
      return;
    }
    // 是站点 → 拿第一个 category
    const siteId = siteProbe.data.id;
    (async () => {
      try {
        const data = await categoriesApi.tree(siteId);
        const first = data?.tree?.[0];
        if (first) {
          // 关掉误用 siteId 开出的无效「栏目」tab，再跳真实栏目
          const badId = useTabsStore.getState().tabId(`/c/${categoryId}`, '');
          useTabsStore.getState().closeTab(badId);
          useTabsStore.getState().openTab({
            pathname: `/c/${first.id}`,
            search: '',
            title: first.name,
            icon: 'FolderTree',
          });
          navigate(`/c/${first.id}`, { replace: true });
        }
      } catch {
        // 拉不到 category tree, 保持 fallback 页面
      }
    })();
  }, [siteProbe.isLoading, siteProbe.isError, siteProbe.data, categoryId, navigate]);

  if (siteProbe.isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">正在检查 ID 类型...</span>
      </div>
    );
  }

  // 不是站点也不是栏目
  if (siteProbe.isError || !siteProbe.data) {
    return (
      <EmptyState
        title="栏目不存在或已删除"
        description={`ID: ${categoryId} 既不是栏目也不是站点`}
      />
    );
  }

  // 是站点, 但没有栏目
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="max-w-md text-center">
        <p className="text-sm text-muted-foreground">
          已识别为站点「{siteProbe.data.name}」, 但该站点还没有栏目
        </p>
        <button
          onClick={() => navigate(`/sites`)}
          className="mt-3 text-sm text-blue-600 hover:underline"
        >
          返回站点列表 →
        </button>
      </div>
    </div>
  );
}
