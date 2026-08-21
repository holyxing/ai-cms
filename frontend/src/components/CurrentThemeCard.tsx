// CurrentThemeCard.tsx - Dashboard 当前激活主题卡 (P6.6 dashboard 增强)
// 数据源: GET /sites/{siteId}/themes/current
//
// 设计意图: 主题是 CMS 核心卖点之一, 用户每天打开 dashboard 应该一眼看到
// "当前站用哪个主题" — 既体现 CMS 特色, 也让 "编辑主题" 入口可见

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Palette, ArrowUpRight, Sparkles, User } from 'lucide-react';
import { themesApi } from '@/api/themes';
import { Card } from '@/components/ui';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryLoading } from '@/components/ui/QueryLoading';
import { cn } from '@/lib/utils';

interface Props {
  siteId: string | null;
}

export function CurrentThemeCard({ siteId }: Props) {
  const q = useQuery({
    queryKey: ['dashboard-theme-current', siteId],
    queryFn: () => themesApi.getCurrent(siteId!),
    enabled: !!siteId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">当前主题</h2>
        </div>
        <Link
          to="/themes"
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
        >
          主题库 <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Body */}
      {!siteId ? (
        <EmptyState
          icon={Palette}
          title="选择一个站点查看主题"
          description="从顶部站点切换器选一个"
          size="sm"
          className="rounded-none border-0"
        />
      ) : q.isLoading ? (
        <div className="px-5 py-3">
          <QueryLoading variant="rows" count={2} />
        </div>
      ) : q.isError || !q.data ? (
        // 404 "尚未应用主题" 或 未加载 — 都走 EmptyState
        <EmptyState
          icon={Palette}
          title="尚未应用主题"
          description="去主题库选一个, 一键应用到当前站点"
          size="sm"
          className="rounded-none border-0"
          action={
            <Link
              to="/themes"
              className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              去主题库
            </Link>
          }
        />
      ) : (
        <div className="p-5">
          <div className="flex items-start gap-4">
            {/* 主题图标 */}
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-sky-100 to-blue-50 dark:from-sky-950/40 dark:to-blue-900/30">
              <Palette className="h-5 w-5 text-primary" strokeWidth={1.75} />
            </div>
            {/* 主题信息 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium truncate">
                  {q.data.theme.display_name}
                </div>
                {q.data.version.is_ai_generated && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                    <Sparkles className="h-2.5 w-2.5" />
                    AI
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {q.data.theme.code} · v{q.data.version.version}
                {q.data.version.author_name && (
                  <>
                    {' · '}
                    <User className="inline h-2.5 w-2.5" /> {q.data.version.author_name}
                  </>
                )}
              </div>
              {q.data.version.change_note && (
                <div className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">
                  {q.data.version.change_note}
                </div>
              )}
            </div>
          </div>
          {/* 底部操作行 */}
          <div className="mt-4 flex items-center justify-between gap-2">
            <Link
              to="/themes"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary/60"
            >
              <Palette className="h-3 w-3" />
              主题库
            </Link>
            <Link
              to="/layouts"
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              模板 / 布局
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}