// AISummaryCard.tsx - AI 协作摘要 (P6.4-A #7)
//
// 显示本月 AI 任务数 + 节省时间估算 + 任务类型分布
// 取代原 "AI 草稿箱" 占位卡 (P3 提示)

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Sparkles,
  Clock,
  TrendingUp,
  ArrowUpRight,
  Zap,
} from 'lucide-react';
import { statsApi } from '@/api/stats';
import { Card, Badge } from '@/components/ui';
import { QueryLoading } from '@/components/ui/QueryLoading';
import { cn } from '@/lib/utils';
import { TASK_LABEL } from '@/lib/aiLabels';

function formatTime(min: number): string {
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d} 天 ${rh} 小时` : `${d} 天`;
}

export function AISummaryCard() {
  const q = useQuery({
    queryKey: ['stats-ai'],
    queryFn: statsApi.getAISummary,
    refetchInterval: 60_000,
  });

  const m = q.data?.month;
  const total = m?.runs ?? 0;
  const failed = m?.failed ?? 0;
  const minutes = m?.estimated_minutes ?? 0;
  const top = (q.data?.by_task_type ?? []).slice(0, 4);
  const maxCount = Math.max(...top.map((t) => t.count), 1);

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">AI 协作</h2>
          <Badge variant="secondary" className="text-[10px]">
            <Sparkles className="mr-1 h-2.5 w-2.5" />
            本月
          </Badge>
        </div>
        <Link
          to="/ai/runs"
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-0.5"
        >
          查看运行历史
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {q.isLoading ? (
        <div className="px-5 py-3">
          <QueryLoading variant="rows" count={3} />
        </div>
      ) : total === 0 ? (
        <div className="px-5 py-8 text-center">
          <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <p className="text-xs text-muted-foreground">
            本月还没用过 AI,
            <br />
            在文章页点「✨ AI 协助」即可体验
          </p>
        </div>
      ) : (
        <div className="px-5 py-4 space-y-4">
          {/* 主指标: 任务数 + 节省时间 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-baseline gap-1">
                <Zap className="h-3.5 w-3.5 text-violet-600" />
                <span className="text-xl font-semibold tabular-nums">{total}</span>
                <span className="text-[11px] text-muted-foreground">次任务</span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {failed > 0 ? `${failed} 次失败 · 成功率 ${Math.round(((total - failed) / total) * 100)}%` : '全部成功'}
              </div>
            </div>
            <div>
              <div className="flex items-baseline gap-1">
                <Clock className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-xl font-semibold tabular-nums">
                  {formatTime(minutes)}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                估算节省时间
              </div>
            </div>
          </div>

          {/* 任务类型分布 */}
          {top.length > 0 && (
            <div>
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                任务分布
              </div>
              <div className="space-y-1.5">
                {top.map((t) => (
                  <div key={t.task_type} className="flex items-center gap-2">
                    <span className="w-16 text-[11px] text-muted-foreground truncate">
                      {TASK_LABEL[t.task_type] ?? t.task_type}
                    </span>
                    <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full bg-violet-500 transition-all',
                        )}
                        style={{ width: `${(t.count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-[11px] font-medium tabular-nums">
                      {t.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 历史总 */}
          {q.data && q.data.all_time.runs > 0 && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground border-t pt-3">
              <TrendingUp className="h-3 w-3" />
              <span>历史共 {q.data.all_time.runs} 次 AI 任务</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}