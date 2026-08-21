/**
 * AI Run 历史页
 * - 列表 (按时间倒序, 状态色码)
 * - 详情弹层 (含 steps + output)
 * - 失败/未完成可重试
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Loader2, CheckCircle2, XCircle, Ban, Clock } from 'lucide-react';
import { Card, Badge, Skeleton, EmptyState, Drawer, Button } from '@/components/ui';
import { aiApi, type AIRun } from '@/api/ai';
import { cn } from '@/lib/utils';
import { TASK_LABEL } from '@/lib/aiLabels';

const STATUS_META: Record<AIRun['status'], { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  pending:   { label: '等待中', icon: Clock, cls: 'text-muted-foreground' },
  running:   { label: '运行中', icon: Loader2, cls: 'text-blue-600' },
  success:   { label: '成功', icon: CheckCircle2, cls: 'text-green-700' },
  failed:    { label: '失败', icon: XCircle, cls: 'text-red-600' },
  cancelled: { label: '已取消', icon: Ban, cls: 'text-muted-foreground' },
};

export default function AIRuns() {
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<AIRun | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['ai-runs', page],
    queryFn: () => aiApi.listRuns({ page, size: 20 }),
  });

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold">AI 运行历史</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">所有 AI 任务的执行记录, 包含状态、用量、输出</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : !data?.items.length ? (
        <EmptyState icon={History} title="还没有运行记录" description="在内容编辑器里点 AI 按钮, 或访问 AI Providers 接入模型" />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="border-b bg-secondary/30 text-left text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">任务</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">步骤</th>
                <th className="px-3 py-2 font-medium text-right">Tokens</th>
                <th className="px-3 py-2 font-medium text-right">费用</th>
                <th className="px-3 py-2 font-medium">时间</th>
                <th className="w-8 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => {
                const meta = STATUS_META[r.status];
                const Icon = meta.icon;
                return (
                  <tr key={r.id} className="row-hover border-b last:border-0 cursor-pointer" onClick={() => setOpen(r)}>
                    <td className="px-3 py-2 font-medium">{TASK_LABEL[r.task_type] ?? r.task_type}</td>
                    <td className="px-3 py-2">
                      <span className={cn('flex items-center gap-1', meta.cls)}>
                        <Icon className={cn('h-3 w-3', r.status === 'running' && 'animate-spin')} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.steps_done}/{r.steps_total}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{(r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">${Number(r.cost_usd ?? 0).toFixed(4)}</td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleString('zh-CN')}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {data && data.total > 20 && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
          <span className="text-muted-foreground">{page} / {Math.ceil(data.total / 20)}</span>
          <Button size="sm" variant="outline" disabled={page * 20 >= data.total} onClick={() => setPage((p) => p + 1)}>下一页</Button>
        </div>
      )}

      <RunDetailDrawer run={open} onClose={() => setOpen(null)} />
    </div>
  );
}

const RunDetailDrawer: React.FC<{ run: AIRun | null; onClose: () => void }> = ({ run, onClose }) => {
  if (!run) return null;
  const meta = STATUS_META[run.status];
  const Icon = meta.icon;
  return (
    <Drawer open={!!run} onClose={onClose} title={`Run · ${TASK_LABEL[run.task_type] ?? run.task_type}`} description={run.id} width="w-[520px]">
      <div className="space-y-3 p-4 text-[13px]">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4', meta.cls)} />
          <Badge variant="muted" className={meta.cls}>{meta.label}</Badge>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {run.steps_done}/{run.steps_total} 步
          </span>
        </div>

        <Detail label="输入" value={JSON.stringify(run.input, null, 2)} />
        {run.output && <Detail label="输出" value={JSON.stringify(run.output, null, 2)} />}
        {run.error && <Detail label="错误" value={run.error} danger />}

        <div className="grid grid-cols-3 gap-2 pt-2 text-center">
          <Stat label="Prompt tokens" value={run.prompt_tokens ?? 0} />
          <Stat label="Completion tokens" value={run.completion_tokens ?? 0} />
          <Stat label="费用 (USD)" value={`$${Number(run.cost_usd ?? 0).toFixed(4)}`} />
        </div>
      </div>
    </Drawer>
  );
};

const Detail: React.FC<{ label: string; value: string; danger?: boolean }> = ({ label, value, danger }) => (
  <div>
    <p className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</p>
    <pre className={cn(
      'max-h-60 overflow-auto rounded-md border bg-secondary/30 p-2 text-[11px]',
      danger && 'border-red-200 bg-red-50 text-red-700',
    )}>{value}</pre>
  </div>
);

const Stat: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
  <div className="rounded-md border bg-secondary/30 px-2 py-1.5">
    <p className="text-[10px] text-muted-foreground">{label}</p>
    <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
  </div>
);
