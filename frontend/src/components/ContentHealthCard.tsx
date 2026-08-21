// ContentHealthCard.tsx - 内容健康度 (P6.4-A #8)
//
// 检查内容质量, 一键跳到过滤列表修复
// 取代 dashboard 上的 "AI 草稿箱" 那块占位 (放右侧第二卡)

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  HeartPulse,
  AlertCircle,
  CheckCircle2,
  ArrowUpRight,
} from 'lucide-react';
import { statsApi } from '@/api/stats';
import { Card } from '@/components/ui';
import { QueryLoading } from '@/components/ui/QueryLoading';
import { cn } from '@/lib/utils';

const SEVERITY: Record<'info' | 'warning' | 'error', { color: string; dot: string }> = {
  info: { color: 'text-blue-600', dot: 'bg-blue-500' },
  warning: { color: 'text-amber-600', dot: 'bg-amber-500' },
  error: { color: 'text-red-600', dot: 'bg-red-500' },
};

export function ContentHealthCard() {
  const q = useQuery({
    queryKey: ['stats-content-health'],
    queryFn: statsApi.getContentHealth,
    refetchInterval: 60_000,
  });

  const items = q.data?.items ?? [];
  const total = q.data?.total_issues ?? 0;
  // 只展示 value > 0 的项
  const visible = items.filter((i) => i.value > 0);

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">内容健康度</h2>
          {!q.isLoading && total === 0 && (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          )}
        </div>
        {total > 0 && (
          <span className="text-[11px] text-muted-foreground">
            共 {total} 项待优化
          </span>
        )}
      </div>

      {q.isLoading ? (
        <div className="px-5 py-3">
          <QueryLoading variant="rows" count={3} />
        </div>
      ) : total === 0 ? (
        <div className="px-5 py-8 text-center">
          <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <p className="text-xs text-muted-foreground">
            全部内容都健康,
            <br />
            没有需要修复的项 ✨
          </p>
        </div>
      ) : (
        <div>
          {visible.map((it) => {
            const sev = SEVERITY[it.severity];
            return (
              <Link
                key={it.key}
                to={it.to}
                className="group flex items-center gap-3 px-5 py-2.5 border-b last:border-b-0 hover:bg-secondary/40 transition-colors"
              >
                <div className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', sev.dot)} />
                <div className="flex-1 text-sm text-foreground">{it.label}</div>
                <div className={cn('text-sm font-semibold tabular-nums', sev.color)}>
                  {it.value}
                </div>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}