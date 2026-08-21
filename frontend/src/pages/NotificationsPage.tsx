/**
 * 我的消息 — 发布结果等站内通知管理
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bell,
  Check,
  Info,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, EmptyState, Badge } from '@/components/ui';
import { notificationsApi, type NotificationLevel, type ServerNotification } from '@/api/notifications';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'unread' | 'success' | 'error';

const LEVEL_META: Record<NotificationLevel, { label: string; Icon: typeof Check; cls: string }> = {
  success: { label: '成功', Icon: Check, cls: 'text-emerald-600 bg-emerald-50' },
  info: { label: '信息', Icon: Info, cls: 'text-blue-600 bg-blue-50' },
  warning: { label: '警告', Icon: AlertTriangle, cls: 'text-amber-600 bg-amber-50' },
  error: { label: '失败', Icon: AlertCircle, cls: 'text-red-600 bg-red-50' },
};

function fmtDuration(ms: number | null): string {
  if (ms == null || ms < 0) return '—';
  const sec = ms / 1000;
  return sec < 10 ? `${sec.toFixed(1)} 秒` : `${Math.round(sec)} 秒`;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);

  const q = useQuery({
    queryKey: ['notifications', filter, page],
    queryFn: () =>
      notificationsApi.list({
        unread: filter === 'unread' || undefined,
        level: filter === 'success' || filter === 'error' ? filter : undefined,
        page,
        page_size: 20,
      }),
    refetchInterval: 5_000,
  });

  const items = q.data?.items ?? [];

  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      toast.success('已全部标为已读');
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const clearAll = useMutation({
    mutationFn: () => notificationsApi.clear(),
    onSuccess: () => {
      toast.success('已清空消息');
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const removeOne = useMutation({
    mutationFn: (id: string) => notificationsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const total = q.data?.total ?? 0;
  const unread = q.data?.unread_count ?? 0;
  const pageSize = q.data?.page_size ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">我的消息</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            静态发布结果（成功 / 失败、耗时）会推送到这里 · 未读 {unread}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            全部已读
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs text-destructive"
            disabled={total === 0 || clearAll.isPending}
            onClick={() => {
              if (window.confirm('确定清空全部消息？')) clearAll.mutate();
            }}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            清空
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['all', '全部'],
            ['unread', '未读'],
            ['success', '发布成功'],
            ['error', '发布失败'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => { setFilter(key); setPage(1); }}
            className={cn(
              'h-7 rounded-md border px-2.5 text-[11px] font-medium transition-colors',
              filter === key
                ? 'border-primary/30 bg-blue-50 text-blue-700'
                : 'border-border bg-background text-muted-foreground hover:bg-secondary/60',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          加载中…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="暂无消息"
          description="发布站点、栏目或文章后，结果会出现在这里"
        />
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {items.map((n: ServerNotification) => {
            const level = (n.level || 'info') as NotificationLevel;
            const meta = LEVEL_META[level] || LEVEL_META.info;
            const { Icon } = meta;
            return (
              <li key={n.id} className={cn('flex gap-3 px-4 py-3', !n.read_at && 'bg-blue-50/30')}>
                <div className={cn('mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md', meta.cls)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className={cn('text-sm font-medium', !n.read_at && 'font-semibold')}>{n.title}</h2>
                    <Badge variant="muted" className="text-[10px]">{meta.label}</Badge>
                    {n.duration_ms != null && (
                      <span className="text-[11px] text-muted-foreground">耗时 {fmtDuration(n.duration_ms)}</span>
                    )}
                  </div>
                  {n.body && (
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground">
                      {n.body}
                    </pre>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{fmtTime(n.created_at)}</span>
                    {n.link && (
                      <Link to={n.link} className="inline-flex items-center gap-0.5 text-primary hover:underline">
                        打开相关页
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                    {!n.read_at && (
                      <button
                        type="button"
                        className="hover:text-foreground"
                        onClick={() => markOne.mutate(n.id)}
                      >
                        标为已读
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-destructive/80 hover:text-destructive"
                      onClick={() => removeOne.mutate(n.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            第 {page} / {totalPages} 页 · 共 {total} 条
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
