// SiteCard.tsx - 站点卡片共享组件 (P7 抽出)
//
// 共享给 Dashboard AllSitesSection 和旧 SitesIndex 用:
// - SiteMark: 字母 / image logo (FullSiteCard 用)
// - useEnterSite: 进入站点 hook (FullSiteCard 跟 AllSitesSection 共享)
// - getPublishBadgeProps: 发布状态 badge (FullSiteCard 用)
// - themeForSite: 站点配色桶 (deterministic by id hash)
// - MetaItem / MiniMetric: FullSiteCard 卡片内部辅助组件
//
// P7 改造: CompactSiteCard 删了 (AllSitesSection 直接用 FullSiteCard — /sites 页面已删除,
// 所有站点管理功能都在 Dashboard 内的 AllSitesSection)

import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Globe, Loader2, XCircle, type LucideIcon } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';

import { cn } from '@/lib/utils';
import { categoriesApi } from '@/api/categories';
import type { DeploymentStatus } from '@/api/publish';
import { useRecentSites } from '@/stores/recentSites';
import { useRecentCategories } from '@/stores/recentCategories';
import type { SiteListItem } from '@/api/sites';

// === 配色桶 (P3.10.8 holy 反馈 #13458: 统一白底, 不用 4 桶色色头) ===
export const SITE_THEMES = [
  {
    header: 'bg-background',
    mark: 'bg-blue-50 text-blue-700 border-blue-100',
    slug: 'bg-secondary/60 text-muted-foreground',
  },
  {
    header: 'bg-background',
    mark: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    slug: 'bg-secondary/60 text-muted-foreground',
  },
  {
    header: 'bg-background',
    mark: 'bg-purple-50 text-purple-700 border-purple-100',
    slug: 'bg-secondary/60 text-muted-foreground',
  },
  {
    header: 'bg-background',
    mark: 'bg-amber-50 text-amber-700 border-amber-100',
    slug: 'bg-secondary/60 text-muted-foreground',
  },
] as const;

export function themeForSite(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return SITE_THEMES[Math.abs(h) % SITE_THEMES.length];
}

// === SiteMark: 字母 logo / image logo ===
export function SiteMark({
  name,
  logoUrl,
  markClass,
}: {
  name: string;
  logoUrl: string | null;
  markClass: string;
}) {
  const initial = name?.[0]?.toUpperCase() || '?';
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className="h-7 w-7 shrink-0 rounded-md border border-border bg-card object-cover"
      />
    );
  }
  return (
    <div
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-medium',
        markClass,
      )}
    >
      {initial}
    </div>
  );
}

// === 发布状态 badge ===
function normalizePublishStatus(status: string | undefined): string {
  if (status === 'out_sync') return 'out_of_sync';
  return status ?? 'never_published';
}

export type BadgeKind =
  | 'pending'
  | 'building'
  | 'success'
  | 'failed'
  | 'published'
  | 'out_of_sync'
  | 'failed_real'
  | 'never_published';

const PUBLISH_BADGE: Record<
  BadgeKind,
  { variant: 'info' | 'warning' | 'success' | 'muted'; label: string; icon: LucideIcon; spin?: boolean }
> = {
  pending: { variant: 'info', label: '发布中', icon: Loader2, spin: true },
  building: { variant: 'info', label: '发布中', icon: Loader2, spin: true },
  success: { variant: 'success', label: '发布成功', icon: CheckCircle2 },
  failed: { variant: 'warning', label: '发布失败', icon: XCircle },
  failed_real: { variant: 'warning', label: '上次失败', icon: XCircle },
  published: { variant: 'success', label: '已发布', icon: CheckCircle2 },
  out_of_sync: { variant: 'warning', label: '待同步', icon: AlertTriangle },
  never_published: { variant: 'muted', label: '未发布', icon: Globe },
};

export function getPublishBadgeProps(
  publishState: DeploymentStatus | null,
  rawStatus?: string,
): { variant: 'info' | 'warning' | 'success' | 'muted'; label: string; icon: LucideIcon; spin?: boolean } {
  // 轮询中状态优先 (本轮是 success/failed/cancelled)
  if (publishState === 'pending' || publishState === 'building') {
    return PUBLISH_BADGE[publishState];
  }
  if (publishState === 'success') {
    return PUBLISH_BADGE.success;
  }
  if (publishState === 'failed' || publishState === 'cancelled') {
    return PUBLISH_BADGE.failed;
  }
  // 轮询未在动, 用数据库 raw status
  const norm = normalizePublishStatus(rawStatus);
  if (norm in PUBLISH_BADGE) {
    return PUBLISH_BADGE[norm as BadgeKind];
  }
  return PUBLISH_BADGE.never_published;
}

// === useEnterSite: 进入站点 hook ===
//
// FullSiteCard 跟 AllSitesSection 都需要"点站点 → 推到 recents → 跳到第一个栏目"
// 抽出来避免重复, 业务逻辑一致
export function useEnterSite() {
  const navigate = useNavigate();
  const pushRecentSite = useRecentSites((s) => s.push);
  const pushRecentCategory = useRecentCategories((s) => s.pushRecent);

  return async (site: SiteListItem) => {
    pushRecentSite({ id: site.id, slug: site.slug, name: site.name });
    if ((site.category_count ?? 0) === 0) {
      sonnerToast.warning(`站点「${site.name}」还没有栏目, 请先创建`);
      return;
    }
    try {
      const data = await categoriesApi.tree(site.id);
      const first = data?.tree?.[0];
      if (first) {
        pushRecentCategory(first.id);
        navigate(`/c/${first.id}`);
      } else {
        sonnerToast.warning('栏目加载为空, 请刷新重试');
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || '加载栏目失败';
      sonnerToast.error(`进入站点失败: ${msg}`);
    }
  };
}

// === MetaItem: 卡片底部的 meta 行项 (点击 / 不可点击) ===
export function MetaItem({
  icon: Icon,
  label,
  onClick,
  highlight,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  highlight?: boolean;
}) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1 rounded px-1 py-px -mx-1 text-[11px] transition-colors',
          highlight
            ? 'text-blue-700 bg-blue-50 hover:bg-blue-100'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        )}
        title={`管理${label}`}
      >
        <Icon className="h-3 w-3 shrink-0" strokeWidth={2} />
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <Icon className="h-3 w-3 shrink-0" strokeWidth={2} />
      {label}
    </span>
  );
}

// === MiniMetric: 卡片内的迷你数字 (可点击 / 不可点击) ===
export function MiniMetric({
  icon: Icon,
  value,
  label,
  onClick,
}: {
  icon: LucideIcon;
  value: number;
  label: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <Icon className="h-3 w-3 text-muted-foreground" strokeWidth={2} />
      <div className="mt-1 text-sm font-semibold tabular-nums leading-none">{value}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{label}</div>
    </>
  );

  const cls = cn(
    'flex flex-col items-center justify-center bg-background py-2 transition-colors',
    onClick && 'cursor-pointer hover:bg-secondary/60',
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls} title={`打开${label}`}>
        {inner}
      </button>
    );
  }

  return <div className={cls}>{inner}</div>;
}