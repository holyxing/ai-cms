// ContentLayout.tsx - 内容工作区布局 (P2.8 D1, Q2B + Q4A + Q7A)
// 依据: docs/17-站点树重构.md §5.2
// 结构: 顶栏(60) + 左树(240) + 工作区(flex-1)
import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useParams, useLocation } from 'react-router-dom';
import { TabBar } from '@/components/TabBar';
import { useTabsStore } from '@/stores/tabs';
import { getTabMeta } from '@/lib/tabMeta';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useQuery } from '@tanstack/react-query';
import { SiteSwitcher } from './SiteSwitcher';
import { CategoryTree } from './CategoryTree';
import { UserMenu } from './UserMenu';
import { GlobalSearchBox } from './GlobalSearchBox';
import { ThemeSwitcher } from './ThemeSwitcher';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { useAuthStore } from '@/stores/auth';
import { useRecentSites } from '@/stores/recentSites';
import { useRecentCategories } from '@/stores/recentCategories';
import { sitesApi } from '@/api/sites';
import { categoriesApi } from '@/api/categories';
import { contentsApi } from '@/api/contents';
import { AIAssistant } from '@/components/ai/AIAssistant';
import { useAIAssistant } from '@/stores/aiAssistant';
import { Sparkles } from 'lucide-react';
import { Button, NetworkStatus } from '@/components/ui';
import { toast } from 'sonner';

export function ContentLayout() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ categoryId?: string; siteId?: string; contentId?: string }>();
  const recents = useRecentSites((s) => s.sites);
  const pushRecent = useRecentSites((s) => s.push);

  // 1. 确定当前站点 (URL 优先, localStorage 兜底, 默认第一个)
  const sitesQ = useQuery({
    queryKey: ['sites', 'active'] as const,
    queryFn: () => sitesApi.list({ page: 1, page_size: 100, status: 'active' }).catch(() => ({ items: [], total: 0, page: 1, page_size: 0 })),
    retry: false,
  });

  const sites = sitesQ.data?.items ?? [];
  // P3.6+ 修: URL 是 /c/:categoryId 时, 查真 category 拿真 siteId (之前误用 catId 当 siteId)
  const catId = location.pathname.match(/^\/c\/([^/]+)/)?.[1];
  const catQ = useQuery({
    queryKey: catId ? (['category', catId] as const) : (['category', '_none_'] as const),
    queryFn: () => categoriesApi.get(catId!).catch(() => null),
    enabled: !!catId,
    staleTime: 60_000,
  });

  // P3.9.1+ (holy 反馈 #11266 补): article 路径下查 content 拿真 category_id (用于左侧树选中)
  // 走 cache 复用, staleTime 1 分钟 (内容详情已加载, 这里不重发)
  const articleMatch = location.pathname.match(/^\/sites\/([^/]+)\/contents\/([^/]+)/);
  const articleSiteId = articleMatch?.[1];
  const articleContentId = articleMatch?.[2];
  const contentQ = useQuery({
    queryKey: articleSiteId && articleContentId ? (['content', articleSiteId, articleContentId] as const) : (['content', '_none_'] as const),
    queryFn: () => contentsApi.get(articleSiteId!, articleContentId!).catch(() => null),
    enabled: !!articleSiteId && !!articleContentId && articleContentId !== 'new',
    staleTime: 60_000,
  });

  // 当前站点优先级:
  // 1. /sites/:siteId/contents/:contentId (article 路径, 走 siteId)
  // 2. /c/:categoryId 查 cat 拿真 site_id
  // 3. /sites/:siteId (站详情)
  // 4. recents[0]
  // 5. sites[0]
  const fromArticleSite = location.pathname.match(/^\/sites\/([^/]+)\/(contents|layouts)/)?.[1];
  const fromStandaloneSite = location.pathname.match(/^\/sites\/([^/]+)$/)?.[1];
  const currentSiteId =
    fromArticleSite ||
    catQ.data?.site_id ||  // P3.6+ 修复: 查 cat 拿真 site_id
    fromStandaloneSite ||
    recents[0]?.id ||
    sites[0]?.id ||
    null;

  // 首次加载: 没有站时引导
  useEffect(() => {
    if (!sitesQ.isLoading && sites.length === 0) {
      // 没站 → 跳管理页(或显示"新建第一个站")
      // 暂不强制跳转, 让用户看到空态
    }
  }, [sitesQ.isLoading, sites.length]);

  // 进入工作区时, 把当前站推入 recents
  useEffect(() => {
    if (currentSiteId) {
      const s = sites.find((x) => x.id === currentSiteId);
      if (s) pushRecent({ id: s.id, slug: s.slug, name: s.name });
    }
  }, [currentSiteId, sites, pushRecent]);

  // 2. 路径解析
  // P3.9.1+ (holy 反馈 #11266 补): article 路径下, 从 content.category_id 选栏目
  // 优先顺序: URL params.categoryId > article content.category_id > null
  const articleCategoryId = contentQ.data?.category_id ?? null;
  // pathname 兜底：父布局 useParams 偶发拿不到子路由 categoryId
  const selectedCategoryId = params.categoryId ?? catId ?? articleCategoryId ?? null;
  const currentCategoryId = selectedCategoryId;
  const currentSite = sites.find((s) => s.id === currentSiteId);

  // 访问栏目时推入 recent_categories (OQ5 配套)
  const pushRecentCat = useRecentCategories((s) => s.pushRecent);
  useEffect(() => {
    if (currentCategoryId) {
      pushRecentCat(currentCategoryId);
    }
  }, [currentCategoryId, pushRecentCat]);

  // 站点管理页：全宽工作区，不显示左侧栏目树
  const hideCategorySidebar = location.pathname === '/sites';

  // P3.10 (AI 助手整合重构): 顶 nav AI 按钮调 useAIAssistant.openAssistant() 召浮窗

  // P3.8.1: mount → 确保默认 dashboard tab 存在
  useEffect(() => {
    useTabsStore.getState().ensureDefault();
    // P3.9.1+: 老 tab title (静态"模板编辑" / uuid) 启动时调一次, 拿 layout 真名覆写
    useTabsStore.getState().migrateLayoutTabTitles();
  }, []);

  // P3.8: 路由变 → open/activate tab (ContentLayout 也集成)
  useEffect(() => {
    const pathname = location.pathname;
    if (pathname.startsWith('/login') || pathname.startsWith('/register')) return;
    const meta = getTabMeta(pathname);
    // search 含 ?search=xxx
    const search = location.search.replace(/^\?/, '');
    useTabsStore.getState().syncWithLocation(pathname, search, meta.title, meta.icon);
  }, [location.pathname, location.search]);

  if (sitesQ.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        加载中...
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* P4.4: 网络状态条 */}
      <NetworkStatus />
      {/* === 顶栏 (60px) === */}
      {/* P6.x (holy 反馈 2026-08-14): header 加 relative z-50, 让内部所有 dropdown (SiteSwitcher 等) 自建 stacking context, 避免被 main 区 (后续 sibling, z-auto) 盖住 */}
      <header className="relative z-50 flex h-14 flex-shrink-0 items-center justify-between border-b bg-background px-4">
        <div className="flex items-center gap-3">
          {/* P3.9.6+ (holy 反馈 #12611): 点 logo 跳 dashboard (任一受保护页都生效) */}
          <Link
            to="/dashboard"
            className="flex items-center gap-1.5 rounded-md px-1 py-0.5 -mx-1 transition-colors hover:bg-secondary/60"
            title="返回概览页"
          >
            <div className="flex h-5 w-5 items-center justify-center rounded bg-primary text-primary-foreground">
              <span className="text-[9px] font-bold">A</span>
            </div>
            <span className="text-[13px] font-semibold tracking-tight">AI-CMS</span>
          </Link>

          <div className="h-5 w-px bg-border" />

          {/* 站点切换器 */}
          <SiteSwitcher
            value={currentSiteId}
            onChange={async (id) => {
              // 切站: 必须跳真实栏目 id，禁止 /c/{siteId}（会留下无效「栏目」tab）
              try {
                const data = await categoriesApi.tree(id);
                const first = data?.tree?.[0];
                if (first) {
                  useTabsStore.getState().openTab({
                    pathname: `/c/${first.id}`,
                    search: '',
                    title: first.name,
                    icon: 'FolderTree',
                  });
                  navigate(`/c/${first.id}`);
                } else {
                  navigate('/');
                }
              } catch {
                navigate('/');
              }
            }}
            compact
          />

          {/* 面包屑 (站点 / 栏目) */}
          {currentSite && (
            <div className="flex items-center gap-1 text-[12px] text-muted-foreground">
              <span>/</span>
              <span className="text-foreground">{currentSite.name}</span>
              {currentCategoryId && (
                <>
                  <span>/</span>
                  <span>栏目 {currentCategoryId.slice(0, 8)}</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* P3.9.1+ 增强 (E): 顶 nav AI 触发 - 跨页签共享 AI Chat 抽屉 */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => useAIAssistant.getState().openAssistant()}
            className="h-7 gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
            title="打开 AI 助手 (右下角浮窗)"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI
          </Button>
          <div className="h-5 w-px bg-border" />
          {/* P3.8.3 (holy 反馈 #10490): 顶栏右上加 GlobalSearchBox — 跟 AppLayout 顶栏统一 */}
          <GlobalSearchBox />
          <NotificationCenter />
          <ThemeSwitcher />
          <div className="h-5 w-px bg-border" />
          {/* P3.8.2 (holy 反馈 #10476): 顶栏右侧用户菜单 — 跟 AppLayout 的 UserMenu 一致 */}
          <UserMenu placement="topbar" />
        </div>
      </header>

      {/* === 主体: 左树 + 工作区 === */}
      <div className="flex flex-1 overflow-hidden">
        {!hideCategorySidebar && (
          <aside className="flex w-60 flex-shrink-0 flex-col border-r bg-background">
            <CategoryTree siteId={currentSiteId} selectedId={currentCategoryId} />
          </aside>
        )}

        {/* 工作区 */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* P3.8: 多 tab 栏 (ContentLayout 也集成) */}
          <TabBar />
          {/* 左菜单 → 工作区间距 20px（px-5）；子页勿再叠加水平 padding */}
          <div className="flex-1 overflow-y-auto bg-secondary/20 px-5 py-3">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      {/* P3.10 (AI 助手整合重构): 全局 AI 助手浮动入口 (3 模式) */}
      <AIAssistant />
    </div>
  );
}
