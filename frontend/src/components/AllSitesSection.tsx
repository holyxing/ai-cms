// AllSitesSection.tsx - Dashboard 上的「所有站点」管理区块 (P7)
//
// P7 改造:
// - /sites 路由 + tab 页面删除 (holy 拍板: "所有站点 tab 页 就不需要了")
// - Dashboard 内的 AllSitesSection 接管原 SitesIndexPage 全部功能:
//   搜索 / 排序 / 筛选 / FullSiteCard 网格 / 批量 / 创建 / 编辑 / 删除 / 域名管理 / 发布 / 重名警告
// - 共享 helper (SiteMark / themeForSite / getPublishBadgeProps / useEnterSite / MetaItem / MiniMetric)
//   从 @/components/SiteCard 复用
//
// UE 设计:
// - 区块放 Dashboard 4 数字行之后, 双栏拖拽卡之前 — 是 workbench 的核心焦点
// - 4 数字行已在 Dashboard 顶部存在 (站点 / 文章 / 待审 / 30 天发布), 这里不重复
// - 用 FullSiteCard (不是 compact) 因为批量/编辑/域名等管理操作不能丢
//   "保留功能" 是 P7 铁律之一, 用户没说可以删, 全部保留

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast as sonnerToast } from 'sonner';
import { watchDeploymentForNotifications } from '@/lib/notificationsSync';
import {
  Globe,
  ArrowRight,
  Plus,
  Search,
  FileText,
  FolderTree,
  LayoutTemplate,
  Image as ImageIcon,
  Rocket,
  Link2,
  AlertTriangle,
  Calendar,
  ArrowUpDown,
  Pencil,
  Trash2,
  Loader2,
  Boxes,
  X,
  MoreHorizontal,
  ExternalLink,
  Copy,
  History,
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Skeleton,
  Badge,
  Input,
  EmptyState,
  ContextMenu,
} from '@/components/ui';
import { CreateSiteDialog } from '@/components/CreateSiteDialog';
import { EditSiteDialog } from '@/components/EditSiteDialog';
import { DeleteSiteDialog } from '@/components/DeleteSiteDialog';
import { DomainManagerDialog } from '@/components/DomainManagerDialog';
import { BatchActionBar } from '@/components/BatchActionBar';
import {
  SiteMark,
  MetaItem,
  MiniMetric,
  useEnterSite,
  getPublishBadgeProps,
  themeForSite,
} from '@/components/SiteCard';
import { useRecentSites } from '@/stores/recentSites';
import { useRecentCategories } from '@/stores/recentCategories';
import { sitesApi, type SiteListItem } from '@/api/sites';
import { publishApi, type DeploymentStatus } from '@/api/publish';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'published' | 'out_sync' | 'failed' | 'never_published';
type Sort = 'updated' | 'created' | 'name' | 'contents';

const FILTER_LABELS: Record<Filter, string> = {
  all: '全部',
  published: '已发布',
  out_sync: '待同步',
  failed: '失败',
  never_published: '未发布',
};

const SORT_LABELS: Record<Sort, string> = {
  updated: '最近活跃',
  created: '创建时间',
  name: '名称',
  contents: '文章数',
};

function matchesPublishFilter(site: SiteListItem, filter: Filter): boolean {
  if (filter === 'all') return true;
  const ps: string = site.publish_status ?? 'never_published';
  if (filter === 'out_sync') return ps === 'out_sync' || ps === 'out_of_sync';
  return ps === filter;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function AllSitesSection() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SiteListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SiteListItem | null>(null);
  const [domainTarget, setDomainTarget] = useState<SiteListItem | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('updated');
  const [q, setQ] = useState('');
  const [publishTasks, setPublishTasks] = useState<
    Record<string, { deploymentId: string; status: DeploymentStatus }>
  >({});
  // P6.2 #16: 多选 + 批量
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sitesQ = useQuery({
    queryKey: ['sites', 'all-dashboard'] as const,
    queryFn: () =>
      sitesApi
        .list({ page: 1, page_size: 100 })
        .catch(() => ({ items: [], total: 0, page: 1, page_size: 0 })),
  });

  const pushRecentSite = useRecentSites((s) => s.push);
  const pushRecentCategory = useRecentCategories((s) => s.pushRecent);
  const enterSite = useEnterSite();

  const publishMut = useMutation({
    mutationFn: async (siteId: string) => {
      const res = await publishApi.trigger(siteId, { triggered_by: 'manual' });
      return { siteId, ...res };
    },
    onMutate: (siteId) => {
      setPublishTasks((prev) => ({ ...prev, [siteId]: { deploymentId: '', status: 'pending' } }));
      sonnerToast.loading('发布任务已加入队列…', { id: `pub-${siteId}` });
    },
    onSuccess: ({ siteId, deployment_id, status }) => {
      setPublishTasks((prev) => ({
        ...prev,
        [siteId]: { deploymentId: deployment_id, status: status as DeploymentStatus },
      }));
      sonnerToast.success('发布任务已入队, 正在构建…', { id: `pub-${siteId}` });
      pollPublish(siteId, deployment_id);
      watchDeploymentForNotifications(deployment_id);
    },
    onError: (e: any, siteId) => {
      setPublishTasks((prev) => {
        const next = { ...prev };
        delete next[siteId];
        return next;
      });
      const msg = e?.response?.data?.message || e?.message || '未知错误';
      sonnerToast.error(`发布失败: ${msg}`, { id: `pub-${siteId}` });
    },
  });

  const pollPublish = (siteId: string, deploymentId: string) => {
    let attempts = 0;
    const max = 80;
    const tick = async () => {
      if (attempts >= max) {
        sonnerToast.error('发布超时, 请查看任务历史', { id: `pub-${siteId}` });
        setPublishTasks((prev) => {
          const n = { ...prev };
          delete n[siteId];
          return n;
        });
        return;
      }
      attempts++;
      try {
        const d = await publishApi.get(deploymentId);
        setPublishTasks((prev) => ({ ...prev, [siteId]: { deploymentId, status: d.status } }));
        if (d.status === 'success') {
          sonnerToast.success('发布成功, 静态页面已生成', { id: `pub-${siteId}` });
          qc.invalidateQueries({ queryKey: ['sites'] });
          setTimeout(() => {
            setPublishTasks((prev) => {
              const n = { ...prev };
              delete n[siteId];
              return n;
            });
          }, 3000);
          return;
        }
        if (d.status === 'failed' || d.status === 'cancelled') {
          sonnerToast.error(
            `发布${d.status === 'failed' ? '失败' : '取消'}: ${d.error_message || ''}`,
            { id: `pub-${siteId}` },
          );
          qc.invalidateQueries({ queryKey: ['sites'] });
          setTimeout(() => {
            setPublishTasks((prev) => {
              const n = { ...prev };
              delete n[siteId];
              return n;
            });
          }, 5000);
          return;
        }
        setTimeout(tick, 1500);
      } catch {
        sonnerToast.error('轮询任务状态失败', { id: `pub-${siteId}` });
        setPublishTasks((prev) => {
          const n = { ...prev };
          delete n[siteId];
          return n;
        });
      }
    };
    setTimeout(tick, 1500);
  };

  const duplicateNames = useMemo(() => {
    const map = new Map<string, number>();
    (sitesQ.data?.items ?? []).forEach((s) => map.set(s.name, (map.get(s.name) || 0) + 1));
    return new Set(Array.from(map.entries()).filter(([, n]) => n > 1).map(([k]) => k));
  }, [sitesQ.data]);

  const items = useMemo(() => {
    const all = sitesQ.data?.items ?? [];
    const ql = q.trim().toLowerCase();
    let list = all.filter((s) => {
      if (!matchesPublishFilter(s, filter)) return false;
      if (ql && !s.name.toLowerCase().includes(ql) && !s.slug.toLowerCase().includes(ql)) {
        return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
      if (sort === 'created') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (sort === 'contents') return (b.content_count ?? 0) - (a.content_count ?? 0);
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return list;
  }, [sitesQ.data, filter, sort, q]);

  if (sitesQ.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-24" />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      </div>
    );
  }

  const all = sitesQ.data?.items ?? [];
  const filterCounts: Record<Filter, number> = {
    all: all.length,
    published: all.filter((s) => matchesPublishFilter(s, 'published')).length,
    out_sync: all.filter((s) => matchesPublishFilter(s, 'out_sync')).length,
    failed: all.filter((s) => matchesPublishFilter(s, 'failed')).length,
    never_published: all.filter((s) => matchesPublishFilter(s, 'never_published')).length,
  };

  const hasActiveFilter = filter !== 'all' || q.trim().length > 0;

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">所有站点</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            管理全部站点 · 进入查看内容 · 搜索 / 筛选 / 批量 / 域名 / 编辑 / 删除
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* P6.2 #16: 全选 */}
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const allSelected = items.every((s) => selected.has(s.id));
                setSelected((prev) => {
                  const next = new Set(prev);
                  items.forEach((s) => allSelected ? next.delete(s.id) : next.add(s.id));
                  return next;
                });
              }}
              className="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              title={items.every((s) => selected.has(s.id)) ? '取消全选' : `全选 (${items.length} 个)`}
            >
              {items.every((s) => selected.has(s.id)) ? (
                <CheckSquare className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              全选
            </button>
          )}
          <Button size="sm" className="h-8 text-xs" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            新建站点
          </Button>
        </div>
      </header>

      {/* 重名警告 */}
      {duplicateNames.size > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-3 p-4">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" strokeWidth={2} />
            </div>
            <div className="flex-1 text-xs">
              <p className="font-medium text-amber-900">检测到 {duplicateNames.size} 组同名站点</p>
              <p className="mt-1 text-amber-800/80">
                同名站点可能在切换时混淆, 建议改名其中一个 (例如加上「生产」/「本地」后缀):
                <span className="ml-1 font-mono text-[11px]">
                  {Array.from(duplicateNames).slice(0, 3).join(' / ')}
                  {duplicateNames.size > 3 && ' 等'}
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 搜索 / 排序 / 筛选 */}
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <div className="relative min-w-[220px] flex-1 max-w-lg">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              strokeWidth={2}
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索站点名或 slug..."
              className="h-8 pl-8 pr-8 text-xs"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="清除搜索"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">排序</span>
            <div className="relative">
              <ArrowUpDown className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" strokeWidth={2} />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="h-8 appearance-none rounded-md border border-input bg-background pl-7 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {(Object.keys(SORT_LABELS) as Sort[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            {hasActiveFilter && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground"
                onClick={() => {
                  setFilter('all');
                  setQ('');
                }}
              >
                重置筛选
              </Button>
            )}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
            {(Object.keys(FILTER_LABELS) as Filter[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
                  filter === k
                    ? 'bg-blue-50 text-blue-700 shadow-sm'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                {FILTER_LABELS[k]}
                <span
                  className={cn(
                    'rounded px-1 text-[10px] tabular-nums',
                    filter === k ? 'bg-blue-100/80 text-blue-700' : 'bg-secondary text-muted-foreground',
                  )}
                >
                  {filterCounts[k]}
                </span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* 列表区 */}
      <section id="sites-list-top">
        {items.length === 0 ? (
          <EmptyState
            icon={Globe}
            title={hasActiveFilter ? '没有匹配的站点' : '还没有站点'}
            description={
              hasActiveFilter ? '试试调整搜索或筛选条件' : '创建第一个站点开始管理内容'
            }
            action={
              !hasActiveFilter ? (
                <Button size="sm" className="h-8 text-xs" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                  新建站点
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setFilter('all');
                    setQ('');
                  }}
                >
                  清除筛选
                </Button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {items.map((s) => (
              <FullSiteCard
                key={s.id}
                site={s}
                isDuplicate={duplicateNames.has(s.name)}
                selected={selected.has(s.id)}
                onToggleSelect={(id) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                  })
                }
                onEnter={() => {
                  void enterSite(s);
                }}
                onEdit={() => setEditTarget(s)}
                onDelete={() => setDeleteTarget(s)}
                onPublish={() => publishMut.mutate(s.id)}
                publishState={publishTasks[s.id]?.status ?? null}
                onOpenAssets={() => navigate(`/sites/${s.id}/assets`)}
                onOpenLayouts={() => navigate(`/layouts?site=${s.id}`)}
                onOpenMedia={() => navigate(`/sites/${s.id}/media`)}
                onManageDomains={() => setDomainTarget(s)}
              />
            ))}
          </div>
        )}
      </section>

      <CreateSiteDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(siteId, categoryId) => {
          const site = all.find((x) => x.id === siteId);
          if (site) pushRecentSite({ id: site.id, slug: site.slug, name: site.name });
          pushRecentCategory(categoryId);
          qc.invalidateQueries({ queryKey: ['sites'] });
          qc.invalidateQueries({ queryKey: ['dashboard-sites'] });
          qc.invalidateQueries({ queryKey: ['stats-trends'] });
          navigate(`/c/${categoryId}`);
        }}
      />

      <EditSiteDialog
        open={!!editTarget}
        site={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={(updated) => {
          useRecentSites.getState().replace({ id: updated.id, slug: updated.slug, name: updated.name });
        }}
      />

      <DeleteSiteDialog
        open={!!deleteTarget}
        site={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={(siteId) => {
          useRecentSites.getState().remove(siteId);
        }}
      />

      <DomainManagerDialog
        open={!!domainTarget}
        site={domainTarget}
        onClose={() => setDomainTarget(null)}
      />

      {/* P6.2 #16: 站点批量操作条 */}
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
            confirmMessage: `将 ${selected.size} 个站点删除到回收站？30 天内可从「回收站」恢复。`,
            onAction: async () => {
              const res = await sitesApi.batch('delete', [...selected]);
              const successIds = new Set(res.results.filter((r) => r.success).map((r) => r.site_id));
              setSelected((prev) => {
                const next = new Set(prev);
                for (const id of successIds) next.delete(id);
                return next;
              });
              // 清掉最近访问里已删除的站
              for (const id of successIds) useRecentSites.getState().remove(id);
              sonnerToast.success(`批量删除站点: 成功 ${res.succeeded}, 失败 ${res.failed}`);
              qc.invalidateQueries({ queryKey: ['sites'] });
              if (res.failed > 0) {
                const errs = res.results.filter((r) => !r.success).slice(0, 3);
                sonnerToast.error(`失败: ${errs.map((e) => e.error).join('; ')}`, { duration: 8000 });
              }
            },
          },
        ]}
      />
    </div>
  );
}

// === FullSiteCard: dashboard AllSitesSection 用 ===
//
// 完整版 (对比已删的 CompactSiteCard): 含多选 / 发布 / 编辑 / 删除 / 域名 / ContextMenu
// P7 改造: 之前在 SitesIndex.tsx 里, 现在搬进 AllSitesSection
function FullSiteCard({
  site,
  isDuplicate,
  onEnter,
  onEdit,
  onDelete,
  onPublish,
  publishState,
  onOpenAssets,
  onOpenLayouts,
  onOpenMedia,
  onManageDomains,
  selected,
  onToggleSelect,
}: {
  site: SiteListItem;
  isDuplicate: boolean;
  onEnter: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPublish: () => void;
  publishState: DeploymentStatus | null;
  onOpenAssets: () => void;
  onOpenLayouts: () => void;
  onOpenMedia: () => void;
  onManageDomains: () => void;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const isEmpty = (site.content_count ?? 0) === 0 && (site.category_count ?? 0) === 0;
  const isPublishing = publishState === 'pending' || publishState === 'building';
  const theme = themeForSite(site.id);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <Card className={cn(
      'group flex flex-col overflow-hidden transition-colors hover:border-primary/30 hover:shadow-sm',
      selected && 'border-primary/50 ring-1 ring-primary/30',
    )}>
      <CardHeader className={cn('space-y-0 border-b px-4 py-2', theme.header)}>
        <div className="flex items-center gap-2">
          {/* P6.2 #16: 多选 checkbox */}
          {onToggleSelect && (
            <button
              type="button"
              onClick={() => onToggleSelect(site.id)}
              aria-label={`选择 ${site.name}`}
              className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            >
              {selected ? (
                <CheckSquare className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <SiteMark name={site.name} logoUrl={site.logo_url} markClass={theme.mark} />
          <CardTitle className="min-w-0 shrink truncate text-sm font-medium leading-none">
            {site.name}
          </CardTitle>
          <code
            className={cn(
              'hidden shrink-0 rounded px-1 py-px text-[10px] text-muted-foreground sm:inline',
              theme.slug,
            )}
          >
            /{site.slug}
          </code>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {(() => {
              const bp = getPublishBadgeProps(publishState, site.publish_status);
              const Icon = bp.icon;
              return (
                <Badge variant={bp.variant}>
                  <Icon
                    className={cn('h-3 w-3', bp.spin && 'animate-spin')}
                    strokeWidth={2}
                  />
                  {bp.label}
                </Badge>
              );
            })()}
            {site.status === 'archived' && <Badge variant="muted">归档</Badge>}
            {isDuplicate && (
              <Badge variant="warning">
                <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                重名
              </Badge>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-blue-600"
              onClick={onEdit}
              title="编辑"
            >
              <Pencil className="h-3 w-3" strokeWidth={2} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMoreMenu({ x: r.right, y: r.bottom + 4 });
              }}
              title="更多"
              aria-label="更多操作"
            >
              <MoreHorizontal className="h-3 w-3" strokeWidth={2} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              title="删除"
            >
              <Trash2 className="h-3 w-3" strokeWidth={2} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col px-4 pb-4 pt-3">
        <CardDescription className="line-clamp-2 leading-snug">
          {site.description || (isEmpty ? '空白站点 · 还没有内容' : '暂无站点描述')}
        </CardDescription>

        <div className="mt-3 grid grid-cols-5 gap-px overflow-hidden rounded-md border bg-border">
          <MiniMetric icon={FileText} value={site.content_count ?? 0} label="文章" />
          <MiniMetric icon={FolderTree} value={site.category_count ?? 0} label="栏目" />
          <MiniMetric
            icon={LayoutTemplate}
            value={site.layout_count ?? 0}
            label="模板"
            onClick={onOpenLayouts}
          />
          <MiniMetric
            icon={Boxes}
            value={site.asset_count ?? 0}
            label="资源"
            onClick={onOpenAssets}
          />
          <MiniMetric
            icon={ImageIcon}
            value={site.media_count ?? 0}
            label="媒体"
            onClick={onOpenMedia}
          />
        </div>
      </CardContent>

      <CardFooter className="mt-auto gap-2 border-t bg-background px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          {(site.deployment_count ?? 0) > 0 && (
            <MetaItem icon={Rocket} label={`${site.deployment_count} 次部署`} />
          )}
          <MetaItem
            icon={Link2}
            label={(site.domain_count ?? 0) > 0 ? `${site.domain_count} 个域名` : '绑定域名'}
            onClick={onManageDomains}
            highlight={(site.domain_count ?? 0) > 0}
          />
          <MetaItem icon={Calendar} label={formatDate(site.updated_at)} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={isPublishing || site.status === 'archived'}
            onClick={onPublish}
          >
            {isPublishing ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <Rocket className="h-3 w-3" strokeWidth={2} />
            )}
            发布
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={onEnter}>
            进入
            <ArrowRight className="h-3 w-3" strokeWidth={2} />
          </Button>
        </div>
      </CardFooter>
      {/* 右侧 ⋯ 下拉菜单 */}
      <ContextMenu
        open={!!moreMenu}
        x={moreMenu?.x ?? 0}
        y={moreMenu?.y ?? 0}
        onClose={() => setMoreMenu(null)}
        items={[
          {
            key: 'open',
            label: '打开后台',
            icon: ExternalLink,
            onClick: onEnter,
          },
          {
            key: 'edit',
            label: '编辑站点',
            icon: Pencil,
            onClick: onEdit,
          },
          {
            key: 'layouts',
            label: '模板管理',
            icon: LayoutTemplate,
            onClick: onOpenLayouts,
          },
          {
            key: 'assets',
            label: '静态资源',
            icon: Boxes,
            onClick: onOpenAssets,
          },
          {
            key: 'media',
            label: '媒体库',
            icon: ImageIcon,
            onClick: onOpenMedia,
          },
          {
            key: 'domains',
            label: `域名管理 (${site.domain_count ?? 0})`,
            icon: Link2,
            onClick: onManageDomains,
          },
          { key: 'div1', label: '', divider: true },
          {
            key: 'copy-slug',
            label: '复制 slug',
            icon: Copy,
            shortcut: 'site slug',
            onClick: () => {
              navigator.clipboard.writeText(site.slug).catch(() => {});
              sonnerToast.success(`已复制 slug: ${site.slug}`);
            },
          },
          {
            key: 'deploy-history',
            label: '部署历史',
            icon: History,
            onClick: () => {
              sonnerToast.info('部署历史: 进入站点后查看');
              onEnter();
            },
          },
          { key: 'div2', label: '', divider: true },
          {
            key: 'delete',
            label: '删除站点',
            icon: Trash2,
            danger: true,
            onClick: onDelete,
          },
        ]}
      />
    </Card>
  );
}