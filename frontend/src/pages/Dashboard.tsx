// Dashboard.tsx - 概览 (P3.8.5 holy 反馈 #10508: 真实接口接入)
//
// 数据源 (全部走真实 API, 不再写死):
// - 4 个数字 (站点 / 文章 / 待审 / 本月发布): 聚合 sitesQ + 草稿/待审/失败 计数 + 本月 deployments
// - 最近文章: 最近访问 1 站 contents list (updated_at desc, 5 条)
// - 4 个待办 (草稿 / 待审 / 发布失败 / 计划发布): 最近访问 1 站 + 全站聚合

import { useQuery } from '@tanstack/react-query';
import {
  Globe,
  FileText,
  Clock,
  Rocket,
  Edit3,
  Image as ImageIcon,
  Palette,
  Plus,
  AlertCircle,
  Circle,
  FileEdit,
  Loader2,
  CheckCircle2,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  Minus,
  RotateCcw,
  Search,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState, useMemo, useEffect } from 'react';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import { authApi } from '@/api/auth';
import { sitesApi } from '@/api/sites';
import { contentsApi } from '@/api/contents';
import { publishApi, type RecentDeploymentItem } from '@/api/publish';
import { statsApi, type Trends, type DeploymentPoint } from '@/api/stats';
import { Card, CardContent, Badge, EmptyState, QueryLoading } from '@/components/ui';
import { useAuthStore } from '@/stores/auth';
import { useRecentSites } from '@/stores/recentSites';
import { useAIAssistant } from '@/stores/aiAssistant';
import { SiteCombobox } from '@/components/SiteCombobox';
import { ActivityFeed } from '@/components/ActivityFeed';
import { AISummaryCard } from '@/components/AISummaryCard';
import { ContentHealthCard } from '@/components/ContentHealthCard';
import { CurrentThemeCard } from '@/components/CurrentThemeCard';
import { MediaHighlightsCard } from '@/components/MediaHighlightsCard';
import { AllSitesSection } from '@/components/AllSitesSection';
import { SortableCard } from '@/components/SortableCard';
import { useDashboardLayout, type CardId } from '@/hooks/useDashboardLayout';
import { cn } from '@/lib/utils';

interface StatCard {
  label: string;
  icon: any;
  color: string;
  bg: string;
  unit?: string;
  loading: boolean;
  value: number;
  // P6.1.2: 趋势对比 (可选, 只前 4 个数字卡有)
  trend?: 'up' | 'down' | 'flat';
  trendDelta?: number;
  trendLabel?: string;  // 默认 '本周'
  // P6.1.3: sparkline 路径点 (可选, e.g. 本月发布卡)
  sparkline?: number[];
}

const quickActions = [
  // P3.9.1+ fix (holy 反馈 #11212): /contents/new 是死路 (路由不存在, 'new' 被当 contentId → 422)
  // 跳 ContentLayout 欢迎页, 用户从栏目里点"新建文章" 才有意义 (需要 siteId+categoryId)
  { to: '/', icon: Edit3, label: '写文章', desc: '选个栏目开始写', color: 'blue' },
  { to: '/media', icon: ImageIcon, label: '上传媒体', desc: '拖拽或选择文件', color: 'emerald' },
  { to: '/themes', icon: Palette, label: '主题', desc: '调整站点外观', color: 'purple' },
  { to: '/publish', icon: Rocket, label: '发布', desc: '一键生成静态产物', color: 'amber' },
];

const colorMap: Record<string, { bg: string; text: string }> = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-600' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600' },
};

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const recents = useRecentSites((s) => s.sites);

  // === 真实数据 queries ===
  // 1. 站点列表 (聚合 content_count)
  const sitesQ = useQuery({
    queryKey: ['dashboard-sites'],
    queryFn: () => sitesApi.list({ page: 1, page_size: 100, status: 'active' }),
    refetchInterval: 30_000,
  });

  // 当前活跃站: 优先最近访问, 否则第一站
  const activeSiteId = recents[0]?.id ?? sitesQ.data?.items?.[0]?.id;
  const [chosenSiteId, setChosenSiteId] = useState<string | null>(null);
  const currentSiteId = chosenSiteId ?? activeSiteId;
  const currentSite = useMemo(
    () => sitesQ.data?.items?.find((s) => s.id === currentSiteId),
    [sitesQ.data, currentSiteId],
  );

  // 2. 草稿 (current 站)
  const draftsQ = useQuery({
    queryKey: ['dashboard-drafts', currentSiteId],
    queryFn: () => contentsApi.list(currentSiteId!, { status: 'draft', page: 1, page_size: 1 }),
    enabled: !!currentSiteId,
    refetchInterval: 60_000,
  });

  // 3. 待审
  const pendingQ = useQuery({
    queryKey: ['dashboard-pending', currentSiteId],
    queryFn: () => contentsApi.list(currentSiteId!, { status: 'pending', page: 1, page_size: 1 }),
    enabled: !!currentSiteId,
    refetchInterval: 60_000,
  });

  // 4. 计划发布 (scheduled)
  const scheduledQ = useQuery({
    queryKey: ['dashboard-scheduled', currentSiteId],
    queryFn: () => contentsApi.list(currentSiteId!, { status: 'scheduled', page: 1, page_size: 1 }),
    enabled: !!currentSiteId,
    refetchInterval: 60_000,
  });

  // 5. 本月发布 (跨所有站, 取最近访问 1 站即可, 因为发布是单站)
  //    本月起 timestamp → filter client side from first page
  // (P6.6.1 B1 修: 删除 monthStart useMemo — 原本只为翻页查本月部署, 现改用后端 stats/trends 已算好的 deployments_30d)

  // P3.10.1 (holy 反馈 #13108): dashboard 路由不显式注入 context, 会导致 general 模式
  // 站点快捷卡发 site_agent 任务时缺 sitesContext + currentSiteId (LLM 看不到当前站点)
  // 修法: dashboard mount 时注入 general context (含全部 sites 列表 + 当前 siteId)
  const setContext = useAIAssistant((s) => s.setContext);
  const reset = useAIAssistant((s) => s.reset);
  useEffect(() => {
    const sites = sitesQ.data?.items ?? [];
    if (sites.length === 0) return;
    setContext({
      type: 'general',
      target: {
        resourceId: currentSiteId ?? '',
        siteId: currentSiteId ?? '',
        title: currentSite?.name ?? '未选站点',
      },
      payload: {
        sitesContext: sites.map((s) => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
          status: s.status,
          publish_status: s.publish_status,
          domains: (s as any).domains ?? [],
        })),
      },
    });
  }, [currentSiteId, currentSite, sitesQ.data?.items, setContext]);
  useEffect(() => {
    return () => reset();
  }, [reset]);
  // 7. 失败发布 (current 站)
  const failedQ = useQuery({
    queryKey: ['dashboard-failed', currentSiteId],
    queryFn: () => publishApi.list(currentSiteId!, { status: 'failed', page: 1, page_size: 1 }),
    enabled: !!currentSiteId,
    refetchInterval: 60_000,
  });

  // 8. 跨站最新发布 top3 (P3.9.5+ holy 反馈: Dashboard 站点管理卡片)
  const recentDeployQ = useQuery({
    queryKey: ['dashboard-recent-deployments'],
    queryFn: () => publishApi.recent(3),
    refetchInterval: 60_000,
  });

  // P6.6 dashboard 增强: 主题 + 媒体 query 在新组件内部调, 这里不再重复

  // === 聚合 ===
  const sites = sitesQ.data?.items ?? [];
  const totalSites = sitesQ.data?.total ?? 0;
  const totalContents = sites.reduce((sum, s) => sum + (s.content_count ?? 0), 0);

  // P6.1.2: trends + sparkline 数据
  const trendsQ = useQuery({
    queryKey: ['stats-trends'],
    queryFn: statsApi.getTrends,
    staleTime: 60_000,  // 1min
  });
  // 卡 + sparkline + trend 统一 14 天窗口
  const deploySeriesQ = useQuery({
    queryKey: ['stats-deployments', 14],
    queryFn: () => statsApi.getDeploymentSeries(14),
    staleTime: 60_000,
  });
  const trends = trendsQ.data;
  const published14d = trends?.deployments_30d.current ?? 0;

  const stats: StatCard[] = [
    { label: '站点', icon: Globe, color: 'text-blue-600', bg: 'bg-blue-50', loading: sitesQ.isLoading, value: totalSites,
      trend: trends?.sites.trend, trendDelta: trends?.sites.delta },
    { label: '文章', icon: FileText, color: 'text-emerald-600', bg: 'bg-emerald-50', loading: sitesQ.isLoading, value: totalContents,
      trend: trends?.contents.trend, trendDelta: trends?.contents.delta },
    { label: '待审', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', loading: pendingQ.isLoading, value: pendingQ.data?.total ?? 0,
      trend: trends?.pending.trend, trendDelta: trends?.pending.delta },
    { label: '14 天发布', icon: Rocket, color: 'text-purple-600', bg: 'bg-purple-50', unit: '次', loading: trendsQ.isLoading, value: published14d,
      trend: trends?.deployments_30d.trend, trendDelta: trends?.deployments_30d.delta, trendLabel: '较前 14 天',
      sparkline: deploySeriesQ.data?.series.map(p => p.count) },
  ];

  const todos = [
    { type: 'draft', label: '草稿', value: (!currentSiteId || draftsQ.isLoading) ? undefined : (draftsQ.data?.total ?? 0), color: 'text-muted-foreground', icon: FileEdit, to: `/c/${currentSiteId}` },
    { type: 'pending', label: '待审', value: (!currentSiteId || pendingQ.isLoading) ? undefined : (pendingQ.data?.total ?? 0), color: 'text-amber-600', icon: Clock, to: `/c/${currentSiteId}` },
    { type: 'failed', label: '发布失败', value: (!currentSiteId || failedQ.isLoading) ? undefined : (failedQ.data?.total ?? 0), color: 'text-red-600', icon: AlertCircle, to: `/c/${currentSiteId}` },
    { type: 'scheduled', label: '计划发布', value: (!currentSiteId || scheduledQ.isLoading) ? undefined : (scheduledQ.data?.total ?? 0), color: 'text-blue-600', icon: Circle, to: `/c/${currentSiteId}` },
  ];

  // === P6.5 #17: 卡片拖拽重排 ===
  const { layout, reorder, reset: resetLayout } = useDashboardLayout();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromColumn = active.data.current?.column as 'left' | 'right' | undefined;
    const toColumn = over.data.current?.column as 'left' | 'right' | undefined;
    // 跨栏拒收 (P6.5 限定同栏拖)
    if (!fromColumn || !toColumn || fromColumn !== toColumn) return;
    reorder(fromColumn, active.id as CardId, over.id as CardId);
  };

  // 各卡 id → JSX 的映射 (两边一样, 跨栏 id 不会混)
  const renderCard = (id: CardId): JSX.Element | null => {
    switch (id) {
      case 'activity-feed':
        return <ActivityFeed limit={8} />;
      case 'recent-deployments':
        return <RecentDeploymentsCard
          isLoading={recentDeployQ.isLoading}
          items={recentDeployQ.data?.items ?? []}
        />;
      case 'quick-actions':
        return <QuickActionsBlock />;
      case 'todos':
        return <TodosCard todos={todos} siteId={currentSiteId} />;
      case 'ai-summary':
        return <AISummaryCard />;
      case 'content-health':
        return <ContentHealthCard />;
      // P6.6 dashboard 增强: CMS 特色 (主题 + 媒体)
      case 'current-theme':
        return <CurrentThemeCard siteId={currentSiteId ?? null} />;
      case 'media-highlights':
        return <MediaHighlightsCard siteId={currentSiteId ?? null} />;
      default:
        return null;
    }
  };

  return (
    <>
    <div className="px-6 py-6 lg:px-8 lg:py-8">
      {/* === 头部 === */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">概览</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {user?.name} · {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* P6.6: 全局搜索入口 (P5 全文搜索的曝光位) */}
          <Link
            to="/search"
            title="搜索文章 / 媒体 / 布局 (⌘K)"
            aria-label="全局搜索"
            className="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <Search className="h-3 w-3" />
            <span className="hidden sm:inline">搜索</span>
            <kbd className="hidden md:inline-flex h-4 items-center rounded border border-border/60 bg-muted/50 px-1 font-mono text-[10px] text-muted-foreground">
              ⌘K
            </kbd>
          </Link>
          {/* P6.5 #17: 拖拽重排说明 + 恢复默认 */}
          <button
            type="button"
            onClick={resetLayout}
            title="恢复 dashboard 卡片默认顺序"
            aria-label="恢复默认顺序"
            className="flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            恢复默认
          </button>
          {sites.length > 0 && (
            <SiteCombobox
              sites={sites}
              value={currentSiteId ?? null}
              onChange={(id) => setChosenSiteId(id)}
              showAllOption={false}
            />
          )}
          {currentSiteId && (
            <Link
              to={`/c/${currentSiteId}`}
              className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              新建文章
            </Link>
          )}
        </div>
      </header>

      {/* === P6.1.4: 待审提醒 (有待审时顶部条状提示) === */}
      {!pendingQ.isLoading && (pendingQ.data?.total ?? 0) > 0 && currentSiteId && (
        <Link
          to={`/c/${currentSiteId}?status=pending`}
          className="mb-6 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-amber-900 transition-colors hover:bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-200"
        >
          <Clock className="h-4 w-4 flex-shrink-0" />
          <div className="flex-1 text-[13px]">
            <strong>{pendingQ.data!.total}</strong> 篇内容待审，点击查看并处理
          </div>
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      )}

      {/* === P7: 所有站点区块 (把 /sites 核心内容 merge 进工作台) === */}
      <section className="mb-6">
        <AllSitesSection />
      </section>

      {/* === 数字行 === */}
      <section className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-background p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">{s.label}</div>
              <div className={`flex h-7 w-7 items-center justify-center rounded-md ${s.bg}`}>
                <s.icon className={`h-3.5 w-3.5 ${s.color}`} strokeWidth={2} />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-1">
              {s.loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <span className="text-2xl font-semibold tabular-nums">{s.value}</span>
                  {s.unit && <span className="text-sm text-muted-foreground">{s.unit}</span>}
                </>
              )}
            </div>
            {/* P6.1.2: 趋势对比 + P6.1.3: sparkline */}
            {(s.trend || s.sparkline) && (
              <div className="mt-2 flex items-center justify-between gap-2">
                {s.trend && !s.loading && (
                  <div className={cn(
                    'flex items-center gap-0.5 text-[10px] font-medium',
                    s.trend === 'up' && 'text-emerald-600',
                    s.trend === 'down' && 'text-red-600',
                    s.trend === 'flat' && 'text-muted-foreground',
                  )}>
                    {s.trend === 'up' && <TrendingUp className="h-3 w-3" />}
                    {s.trend === 'down' && <TrendingDown className="h-3 w-3" />}
                    {s.trend === 'flat' && <Minus className="h-3 w-3" />}
                    <span className="tabular-nums">
                      {/* P6.6.1 B1 修: 之前硬编码 '本周', 不读 s.trendLabel — 改成读 prop (默认 '本周' 兼容老卡片) */}
                      {s.trend === 'flat' ? '与上周持平' : `${s.trendDelta! > 0 ? '+' : ''}${s.trendDelta} ${s.trendLabel ?? '本周'}`}
                    </span>
                  </div>
                )}
                {s.sparkline && s.sparkline.length > 0 && (
                  <Sparkline data={s.sparkline} color={s.color} />
                )}
              </div>
            )}
          </div>
        ))}
      </section>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* === 左侧: 可拖排序 === */}
          <SortableContext items={layout.left} strategy={verticalListSortingStrategy}>
            <div className="space-y-6 xl:col-span-2">
              {layout.left.map((id) => (
                <SortableCard key={id} id={id} column="left">
                  {renderCard(id)}
                </SortableCard>
              ))}
            </div>
          </SortableContext>

          {/* === 右侧: 可拖排序 === */}
          <SortableContext items={layout.right} strategy={verticalListSortingStrategy}>
            <div className="space-y-6">
              {layout.right.map((id) => (
                <SortableCard key={id} id={id} column="right">
                  {renderCard(id)}
                </SortableCard>
              ))}
            </div>
          </SortableContext>
        </div>
      </DndContext>
    </div>
    </>
  );
}


// P6.5 #17: 拆出 3 个 dashboard 卡片为独立组件, 供 SortableCard 包裹拖拽
function RecentDeploymentsCard({
  isLoading,
  items,
}: {
  isLoading: boolean;
  items: RecentDeploymentItem[];
}) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold">最新发布</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">跨站最近发布的 3 个站点 · 点击进该站首个栏目</p>
        </div>
        <Link to="/sites" className="text-[11px] font-medium text-muted-foreground hover:text-foreground">
          站点管理
        </Link>
      </div>
      <div>
        {isLoading ? (
          <div className="px-5 py-3">
            <QueryLoading variant="rows" count={3} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Rocket}
            title="还没有成功的发布"
            description="点击页面右上角的「发布」按钮可将站点静态化部署"
            size="sm"
            className="rounded-none border-0"
          />
        ) : (
          <ul className="divide-y">
            {items.map((d) => (
              <li key={d.id}>
                <Link
                  to={d.root_category_id ? `/c/${d.root_category_id}` : '/sites'}
                  className="group flex items-center gap-3 px-5 py-3 hover:bg-secondary/40 transition-colors"
                >
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">{d.site_name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-foreground/60">/{d.site_slug}</span>
                      <span>·</span>
                      <span>{d.content_count ?? 0} 页</span>
                      <span>·</span>
                      <span>{d.duration_ms ?? 0}ms</span>
                      {d.finished_at && (
                        <>
                          <span>·</span>
                          <span>{new Date(d.finished_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function QuickActionsBlock() {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">快速入口</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {quickActions.map((a) => {
          const c = colorMap[a.color];
          return (
            <Link
              key={a.to}
              to={a.to}
              className="group flex flex-col rounded-lg border bg-background p-3 transition-colors hover:border-primary/40"
            >
              <div className={`mb-2 flex h-7 w-7 items-center justify-center rounded-md ${c.bg}`}>
                <a.icon className={`h-3.5 w-3.5 ${c.text}`} strokeWidth={2} />
              </div>
              <div className="text-sm font-medium">{a.label}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{a.desc}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

interface TodoItem {
  type: string;
  label: string;
  value: number | undefined;
  color: string;
  icon: any;
  to: string;
}

function TodosCard({ todos, siteId }: { todos: TodoItem[]; siteId?: string }) {
  if (!siteId) {
    return (
      <Card>
        <div className="border-b px-5 py-3">
          <h2 className="text-sm font-semibold">待办</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">需要你处理的事项</p>
        </div>
        <EmptyState
          icon={Circle}
          title="请先选择站点"
          description="选择站点后显示待办"
          size="sm"
          className="rounded-none border-0"
        />
      </Card>
    );
  }
  return (
    <Card>
      <div className="border-b px-5 py-3">
        <h2 className="text-sm font-semibold">待办</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">需要你处理的事项</p>
      </div>
      <div>
        {todos.map((t, i) => (
          <Link
            key={t.type}
            to={t.to}
            className={`flex items-center gap-3 px-5 py-3 hover:bg-secondary/40 transition-colors ${i < todos.length - 1 ? 'border-b' : ''}`}
          >
            <t.icon className={`h-3.5 w-3.5 ${t.color}`} strokeWidth={2} />
            <div className="flex-1 text-sm">{t.label}</div>
            {t.value === undefined ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <div className="text-sm font-semibold tabular-nums">{t.value}</div>
            )}
          </Link>
        ))}
      </div>
    </Card>
  );
}

// P6.1.3: Sparkline (mini line chart) — 纯 SVG, 不引 recharts
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return null;
  const w = 60;
  const h = 20;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = Math.max(max - min, 1);
  const stepX = w / (data.length - 1);
  // 颜色类名 → 实际色值 (Tailwind text-XXX-600 系列)
  const colorMap: Record<string, string> = {
    'text-blue-600': '#2563eb',
    'text-emerald-600': '#059669',
    'text-amber-600': '#d97706',
    'text-purple-600': '#9333ea',
    'text-red-600': '#dc2626',
  };
  const stroke = colorMap[color] || '#6b7280';
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // area path (填充底部半透明)
  const areaPath = `M0,${h} L${points.replace(/ /g, " L")} L${w},${h} Z`;
  return (
    <svg width={w} height={h} className="flex-shrink-0" viewBox={`0 0 ${w} ${h}`}>
      <path d={areaPath} fill={stroke} fillOpacity={0.1} />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 最后一个点 */}
      {data.length > 0 && (() => {
        const lastX = (data.length - 1) * stepX;
        const lastY = h - ((data[data.length - 1] - min) / range) * h;
        return <circle cx={lastX} cy={lastY} r={2} fill={stroke} />;
      })()}
    </svg>
  );
}
