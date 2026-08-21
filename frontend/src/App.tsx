// App.tsx - P2.9 D1 砍旧路由
// 依据: docs/17-站点树重构.md §6
//
// 布局策略:
//   AppLayout  (简化版, 只剩 3+2 个页):  概览/主题/发布 + AI providers/runs
//   ContentLayout  (新树状布局, / 为入口):  站点/栏目/内容/文章/媒体 (走树右键菜单)
//
// 旧路由全部重定向到 / (ContentLayout 欢迎页会自动选最近访问的栏目, OQ5)
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppLayout } from '@/components/layout/AppLayout';
import { ContentLayout } from '@/components/layout/ContentLayout';
import { LoginPage } from '@/pages/Login';
import { Login2FAPage } from '@/pages/Login2FAPage';
import { RegisterPage } from '@/pages/Register';
import { ShortcutsProvider } from '@/components/ShortcutsProvider';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { DashboardPage } from '@/pages/Dashboard';
import { AcceptInvitationPage } from '@/pages/AcceptInvitation';
import { ThemesPage } from '@/pages/Themes';
import { PublishPage } from '@/pages/Publish';
import { NotFoundPage } from '@/pages/NotFound';
import AIProvidersPage from '@/pages/AIProviders';
import AIRunsPage from '@/pages/AIRuns';
import { CategoryContentPage } from '@/pages/CategoryContent';
import { ContentDetailPage } from '@/pages/ContentDetail';
import { LayoutEditPage } from '@/pages/LayoutEditPage';
import { UsersPage } from '@/pages/UsersPage';
import { RolesPage } from '@/pages/RolesPage';
import { PermissionsPage } from '@/pages/PermissionsPage';
import { RecycleBinPage } from '@/pages/RecycleBin';
import { SiteRecycleBinPage } from '@/pages/SiteRecycleBin';
import { LayoutsPage } from '@/pages/LayoutsPage';
import MediaPage from '@/pages/Media';
import { SiteAssetsView } from '@/pages/SiteAssets';
import SearchPage from '@/pages/SearchPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import DeployLog from '@/pages/DeployLog';

// === 旧路由 → 重定向到 / (ContentLayout) ===
const RedirectToHome = () => <Navigate to="/" replace />;

export default function App() {
  return (
    <Routes>
      {/* 公开路由 */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/2fa" element={<Login2FAPage />} />
      <Route path="/register" element={<RegisterPage />} />
      {/* P5.2 忘记密码 / 重置密码 (公开) */}
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* 邀请接受 (需登录) */}
      <Route
        path="/invitations/accept"
        element={
          <ProtectedRoute>
            <AcceptInvitationPage />
          </ProtectedRoute>
        }
      />

      {/* === AppLayout 保留页 (3+2) === */}
      <Route
        element={
          <ProtectedRoute>
            <ShortcutsProvider>
              <AppLayout />
            </ShortcutsProvider>
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/themes" element={<ThemesPage />} />
        <Route path="/publish" element={<PublishPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/ai/providers" element={<AIProvidersPage />} />
        <Route path="/ai/runs" element={<AIRunsPage />} />
        {/* RBAC: 仅 super_admin 可见 (AppLayout 侧栏已过滤, 这里再 RequireRole 双保险) */}
        <Route path="/users" element={
          <ProtectedRoute requireSuperAdmin>
            <UsersPage />
          </ProtectedRoute>
        } />
        <Route path="/roles" element={
          <ProtectedRoute requireSuperAdmin>
            <RolesPage />
          </ProtectedRoute>
        } />
        <Route path="/permissions" element={
          <ProtectedRoute requireSuperAdmin>
            <PermissionsPage />
          </ProtectedRoute>
        } />
        <Route path="/recycle-bin" element={
          <ProtectedRoute requireSuperAdmin>
            <RecycleBinPage />
          </ProtectedRoute>
        } />
        <Route path="/layouts" element={
          <ProtectedRoute>
            <LayoutsPage />
          </ProtectedRoute>
        } />
      </Route>

      {/* === ContentLayout 树状布局 (主入口) === */}
      <Route
        element={
          <ProtectedRoute>
            <ContentLayout />
          </ProtectedRoute>
        }
      >
        {/* / 进入工作区(空态或最近栏目) */}
        <Route path="/" element={<ContentWorkspace />} />
        {/* /c/:categoryId 进入栏目内容页 (Q3A 决策) */}
        <Route path="/c/:categoryId" element={<CategoryContentPage />} />
        {/* 内容健康度跳转: 站点级过滤列表 */}
        <Route path="/contents" element={<CategoryContentPage />} />
        {/* 文章详情 (在 ContentLayout 内打开, 仍可访问树) */}
        <Route
          path="/sites/:siteId/contents/:contentId"
          element={<ContentDetailPage />}
        />
        {/* 模板编辑器 (P3.6.2: 模板 tab 点击跳转) */}
        <Route
          path="/sites/:siteId/layouts/:layoutId"
          element={<LayoutEditPage />}
        />
        {/* 站点媒体库 (P3.6.1: Media 页 + ContentLayout 树状, 顶部多了个媒体库入口) */}
        <Route path="/sites/:siteId/media" element={<MediaPage />} />
        {/* P3.6.2: 站点静态资源 (模板 CSS/JS/字体/Logo) */}
        <Route
          path="/sites/:siteId/assets"
          element={<SiteAssetsView />}
        />
        {/* 发布日志 */}
        <Route path="/sites/:siteId/deploy-log" element={<DeployLog />} />
        {/* 站点回收站（文章/栏目/模板/媒体） */}
        <Route path="/sites/:siteId/recycle" element={<SiteRecycleBinPage />} />
        {/* 站点列表 (P3.6+ 修 SiteSwitcher "管理所有站点") */}
        {/* P7: /sites 路由已删除 (所有站点管理功能移到 Dashboard AllSitesSection) */}
      </Route>

      {/* === 旧路由 → 重定向 (回收站已迁到 /recycle-bin) === */}
      <Route path="/sites/recycle-bin" element={<Navigate to="/recycle-bin" replace />} />
      <Route path="/sites/:id" element={<RedirectToHome />} />
      <Route path="/sites/:id/members" element={<RedirectToHome />} />
      <Route path="/sites/:id/taxonomies" element={<RedirectToHome />} />
      <Route path="/sites/:id/contents" element={<RedirectToHome />} />
      <Route path="/taxonomies" element={<RedirectToHome />} />
      <Route path="/media" element={<RedirectToHome />} />
      <Route path="/users" element={<RedirectToHome />} />
      <Route path="/settings" element={<RedirectToHome />} />

      {/* 兜底 */}
      <Route
        path="*"
        element={
          <ProtectedRoute>
            <ErrorBoundary>
              <NotFoundPage />
            </ErrorBoundary>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

// === ContentLayout 工作区入口 ===
// OQ5: 首次进站自动选最近访问的栏目 (localStorage recent_sites 已有, recent_categories 同步加)
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { sitesApi } from '@/api/sites';
import { categoriesApi } from '@/api/categories';
import { useRecentSites } from '@/stores/recentSites';
import { useRecentCategories } from '@/stores/recentCategories';
import { Loader2, MousePointerClick, ChevronRight } from 'lucide-react';
import { Card, CardContent, EmptyState } from '@/components/ui';

export function ContentWorkspace({ tab: _tab }: { tab?: 'media' } = {}) {
  const navigate = useNavigate();
  const recentSites = useRecentSites((s) => s.sites);
  const recents = useRecentCategories((s) => s.categories);

  // 取第一个最近站点 (OQ5 自动选最近)
  const firstRecentId = recentSites[0]?.id;
  const treeQ = useQuery({
    queryKey: ['category-tree', firstRecentId],
    queryFn: () => categoriesApi.tree(firstRecentId!).catch(() => []),
    enabled: !!firstRecentId,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!firstRecentId) return;
    if (treeQ.isLoading) return;
    // 1. 优先最近访问栏目
    if (recents[0]) {
      navigate(`/c/${recents[0]}`, { replace: true });
      return;
    }
    // 2. 否则该站第一个顶级栏目
    const firstRoot = treeQ.data?.tree?.[0];
    if (firstRoot) {
      navigate(`/c/${firstRoot.id}`, { replace: true });
    }
  }, [firstRecentId, recents, treeQ.isLoading, treeQ.data, navigate]);

  if (!firstRecentId) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={MousePointerClick}
          title="还没有站点"
          description="请先在右上角切换器中创建或选择一个站点"
        />
      </div>
    );
  }

  if (recents[0] || (treeQ.data?.tree && treeQ.data.tree.length > 0)) {
    // 跳转中
    return (
      <div className="flex h-full items-center justify-center">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-[12px] text-muted-foreground">正在跳转到最近访问...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 有站, 没栏目, 也没最近栏目 → 引导新建
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        icon={ChevronRight}
        title="该站点还没有栏目"
        description={'在左侧树右键或点击 + 新建第一个顶级栏目'}
      />
    </div>
  );
}
