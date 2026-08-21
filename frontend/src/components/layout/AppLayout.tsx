// AppLayout.tsx - 简化版 (P2.9 D1 砍掉站点/内容/栏目/媒体/成员/设置/回收站 7 个旧 nav tab)
// 依据: docs/17-站点树重构.md §6
// 侧栏保留: 概览 / 模板 / 发布 / AI（主题菜单已移除）
// 站点/栏目/内容/文章/媒体 全部走 ContentLayout (新树状布局)
// P3.8 (holy 反馈 #10440): 集成多 tab 系统 (TabBar 在主内容区上方)
import { NavLink, Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import {
  LayoutDashboard,
  Rocket,
  Cpu,
  History,
  Users,
  ShieldCheck,
  KeyRound,
  FileCode,
  Boxes,
  ImageIcon,
  Search,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { Badge, Separator, NetworkStatus } from '@/components/ui';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { UserMenu } from '@/components/layout/UserMenu';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { useRecentSites } from '@/stores/recentSites';
import { GlobalSearchBox } from '@/components/layout/GlobalSearchBox';
import { ThemeSwitcher } from '@/components/layout/ThemeSwitcher';
import { TabBar } from '@/components/TabBar';
import { useTabsStore } from '@/stores/tabs';
import { AIAssistant } from '@/components/ai/AIAssistant';
import { getTabMeta } from '@/lib/tabMeta';

const navItems = [
  { to: '/dashboard', label: '概览', icon: LayoutDashboard },
  { to: '/layouts', label: '模板', icon: FileCode },
  { to: '/publish', label: '发布', icon: Rocket },
];

const aiNavItems = [
  { to: '/ai/providers', label: 'AI Providers', icon: Cpu },
  { to: '/ai/runs', label: 'AI 运行历史', icon: History },
];

// 权限管理 (仅超管可见)
const rbacNavItems = [
  { to: '/users', label: '用户管理', icon: Users, requireSuper: true },
  { to: '/roles', label: '角色管理', icon: ShieldCheck, requireSuper: true },
  { to: '/permissions', label: '权限管理', icon: KeyRound, requireSuper: true },
];

// 回收站 (仅超管可见)
const sysNavItems = [
  { to: '/recycle-bin', label: '回收站', icon: Trash2, requireSuper: true },
];

// P3.6.1: 媒体库侧栏入口 (跳到最近一站媒体, 选中站点后直接进该站)
function MediaNavRow() {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.openTab);
  const recents = useRecentSites((s) => s.sites);
  const targetSiteId = recents[0]?.id;
  const to = targetSiteId ? `/sites/${targetSiteId}/media` : '/';
  return (
    <NavLink
      to={to}
      onClick={(e) => {
        e.preventDefault();
        if (!targetSiteId) {
          navigate('/');
          return;
        }
        openTab({ pathname: to, search: '', title: '媒体库' });
        navigate(to);
      }}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
          isActive && targetSiteId
            ? 'bg-blue-50 text-blue-700'
            : 'text-foreground/80 hover:bg-secondary hover:text-foreground',
        )
      }
    >
      <ImageIcon className="h-3.5 w-3.5" strokeWidth={2} />
      媒体库
    </NavLink>
  );
}

// P3.7.2 方案 B: 导航菜单功能已删除
// P3.6.2: 站点静态资源 (模板 CSS/JS/字体/Logo)
function SiteAssetsNavRow() {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.openTab);
  const recents = useRecentSites((s) => s.sites);
  const targetSiteId = recents[0]?.id;
  const to = targetSiteId ? `/sites/${targetSiteId}/assets` : '/';
  return (
    <NavLink
      to={to}
      onClick={(e) => {
        e.preventDefault();
        if (!targetSiteId) {
          navigate('/');
          return;
        }
        openTab({ pathname: to, search: '', title: '站点资源' });
        navigate(to);
      }}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
          isActive && targetSiteId
            ? 'bg-blue-50 text-blue-700'
            : 'text-foreground/80 hover:bg-secondary hover:text-foreground',
        )
      }
    >
      <Boxes className="h-3.5 w-3.5" strokeWidth={2} />
      站点资源
    </NavLink>
  );
}

function NavRow({ to, label, icon: Icon }: { to: string; label: string; icon: LucideIcon }) {
  const openTab = useTabsStore((s) => s.openTab);
  const navigate = useNavigate();
  return (
    <NavLink
      to={to}
      onClick={(e) => {
        // P3.8: 菜单点击 → 开/激活 tab + 切路由
        // 修复: 必须 navigate, 否则 Outlet 内容不切 (holy 反馈 #10522, 回收站 tab 显示但内容空白)
        e.preventDefault();
        openTab({ pathname: to, search: '', title: label });
        navigate(to);
      }}
      className={({ isActive }) =>
        cn(
          'group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
          isActive
            ? 'bg-blue-50 font-medium text-blue-700'
            : 'text-muted-foreground hover:bg-secondary/80 hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-blue-600" />
          )}
          <Icon
            className={cn('h-3.5 w-3.5 flex-shrink-0', isActive ? 'text-blue-600' : '')}
            strokeWidth={isActive ? 2 : 1.75}
          />
          {label}
        </>
      )}
    </NavLink>
  );
}

export function AppLayout() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const syncWithLocation = useTabsStore((s) => s.syncWithLocation);
  const ensureDefault = useTabsStore((s) => s.ensureDefault);

  // P3.8.1: mount → 确保默认 dashboard tab 存在
  useEffect(() => {
    ensureDefault();
    // P3.9.1+: 老 tab title (静态"模板编辑" / uuid) 启动时调一次, 拿 layout 真名覆写
    useTabsStore.getState().migrateLayoutTabTitles();
  }, [ensureDefault]);

  // P3.8: 路由变 → open/activate tab
  useEffect(() => {
    const pathname = location.pathname;
    // 跳过 layout 自身路由 (如 /sites/:id/members 已重定向)
    if (pathname.startsWith('/login') || pathname.startsWith('/register')) return;
    const meta = getTabMeta(pathname);
    syncWithLocation(pathname, location.search.replace(/^\?/, ''), meta.title, meta.icon);
  }, [location.pathname, location.search, syncWithLocation]);

  const handleLogout = () => {
    // P3.8.3: 保留以免报错 (UserMenu 自带登出, 这里不再调)
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* P4.4: 网络状态条 (在顶栏之上, 失败时显示) */}
      <NetworkStatus />
      {/* === 顶栏 (P3.8.3 holy 反馈 #10490: 整个 CMS 一个统一框架, UserMenu + 搜索都在右上) === */}
      {/* P6.x (holy 反馈 2026-08-14): header 加 relative z-50, 让内部 dropdown (UserMenu / NotificationCenter / GlobalSearchBox / ThemeSwitcher) 自建 stacking context, 避免被 main 区盖住 */}
      <header className="relative z-50 flex h-14 flex-shrink-0 items-center justify-between border-b bg-background px-4">
        <div className="flex items-center gap-3">
          {/* P3.9.6+ (holy 反馈 #12611): 点 logo 跳 dashboard */}
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
          <Badge variant="muted" className="text-[10px]">v0.1</Badge>
        </div>
        <div className="flex items-center gap-2">
          <GlobalSearchBox />
          <NotificationCenter />
          <ThemeSwitcher />
          <div className="h-5 w-px bg-border" />
          <UserMenu placement="topbar" />
        </div>
      </header>

      {/* === 主体: 侧栏 + 工作区 === */}
      <div className="flex flex-1 overflow-hidden">
        {/* === 侧边栏 === */}
        <aside className="flex w-56 flex-col border-r bg-background">
          <nav className="flex-1 overflow-y-auto p-2">
            <div className="space-y-0.5">
              {navItems.map((item) => (
                <NavRow key={item.to} to={item.to} label={item.label} icon={item.icon} />
              ))}
              <MediaNavRow />
              <SiteAssetsNavRow />
            </div>
            <Separator label="AI 协作" className="my-3" />
            <div className="space-y-0.5">
              {aiNavItems.map((item) => (
                <NavRow key={item.to} to={item.to} label={item.label} icon={item.icon} />
              ))}
            </div>
            {user?.is_super_admin && (
              <>
                <Separator label="权限管理" className="my-3" />
                <div className="space-y-0.5">
                  {rbacNavItems.map((item) => (
                    <NavRow key={item.to} to={item.to} label={item.label} icon={item.icon} />
                  ))}
                </div>
                <Separator label="系统" className="my-3" />
                <div className="space-y-0.5">
                  {sysNavItems.map((item) => (
                    <NavRow key={item.to} to={item.to} label={item.label} icon={item.icon} />
                  ))}
                </div>
              </>
            )}
          </nav>
        </aside>

      {/* === 主内容 === */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* P3.8: 多 tab 栏 */}
        <TabBar />
        <div className="flex-1 overflow-y-auto">
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
