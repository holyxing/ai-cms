// Publish.tsx - 静态发布 (P2)
// 依据: docs/12-P2-决策.md §B6 + §C4 (后台任务) + §C5 (回滚软链) +
//      §E1 (build_log 64KB) + §E2 (10min 超时)
import { useEffect, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Rocket, RotateCcw, RefreshCw, CheckCircle2, XCircle, Loader2, Clock, FileText, AlertCircle, Eye } from 'lucide-react';
import { toast } from 'sonner';

import { publishApi, type Deployment, type DeploymentListItem, type DeploymentStatus } from '@/api/publish';
import { sitesApi, type SiteListItem } from '@/api/sites';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Skeleton, EmptyState, Separator, PublishStatusBadge } from '@/components/ui';
import { MissingAssetsDialog, type MissingAsset } from '@/components/MissingAssetsDialog';
import { cn } from '@/lib/utils';
import { refreshNotifications } from '@/lib/notificationsSync';

// === 状态展示 ===
function StatusBadge({ status }: { status: DeploymentStatus }) {
  const map: Record<DeploymentStatus, { label: string; variant: 'default' | 'outline' | 'warning' | 'info' }> = {
    pending: { label: '排队中', variant: 'outline' },
    building: { label: '构建中', variant: 'info' },
    success: { label: '成功', variant: 'default' },
    failed: { label: '失败', variant: 'warning' },
    cancelled: { label: '已取消', variant: 'outline' },
  };
  const m = map[status] || map.pending;
  return <Badge variant={m.variant} className="text-[10px]">{m.label}</Badge>;
}

function StatusIcon({ status, className }: { status: DeploymentStatus; className?: string }) {
  switch (status) {
    case 'pending': return <Clock className={className} />;
    case 'building': return <Loader2 className={cn(className, 'animate-spin')} />;
    case 'success': return <CheckCircle2 className={className} />;
    case 'failed': return <XCircle className={className} />;
    case 'cancelled': return <AlertCircle className={className} />;
  }
}

// === 单个 deployment 详情 (含轮询) ===
function DeploymentDetail({
  deploymentId, onDone,
}: {
  deploymentId: string;
  onDone?: () => void;
}) {
  const detailQ = useQuery({
    queryKey: ['publish-job', deploymentId],
    queryFn: () => publishApi.get(deploymentId),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      // pending/building 时 2s 轮询, 其他状态停止
      return status === 'pending' || status === 'building' ? 2000 : false;
    },
  });
  const d = detailQ.data;
  const isRunning = d?.status === 'pending' || d?.status === 'building';

  // 完成后回调
  useEffect(() => {
    if (d && (d.status === 'success' || d.status === 'failed' || d.status === 'cancelled')) {
      if (d.status === 'success') toast.success('发布成功');
      else if (d.status === 'failed') toast.error(`发布失败: ${d.error_message}`);
      void refreshNotifications();
      onDone?.();
    }
  }, [d?.status]);

  if (detailQ.isLoading || !d) {
    return <Skeleton className="h-32 w-full" />;
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <StatusIcon status={d.status} className="h-4 w-4" />
            部署 #{d.id.slice(0, 8)}
          </CardTitle>
          <StatusBadge status={d.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="grid grid-cols-2 gap-2 text-muted-foreground">
          <div>触发: {d.triggered_by}</div>
          <div>开始: {d.started_at ? new Date(d.started_at).toLocaleString('zh-CN') : '-'}</div>
          <div>耗时: {d.duration_ms !== null ? `${d.duration_ms} ms` : '-'}</div>
          <div>文章: {d.content_count ?? 0}</div>
          <div>重试: {d.retry_count}</div>
          <div>产物: <code className="text-[10px]">{d.artifact_path || '-'}</code></div>
        </div>
        {d.error_message && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2 text-destructive text-xs">
            {d.error_message}
          </div>
        )}
        {d.build_log && (
          <details className="rounded-md bg-muted/30 p-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">构建日志 ({(d.build_log.length / 1024).toFixed(1)} KB)</summary>
            <pre className="mt-2 max-h-64 overflow-auto text-[10px] font-mono whitespace-pre-wrap break-all">
              {d.build_log}
            </pre>
          </details>
        )}
        {isRunning && (
          <div className="flex items-center gap-2 text-muted-foreground pt-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>轮询中... (每 2s)</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// === 主页面 ===
export function PublishPage() {
  const qc = useQueryClient();
  // 1. 选第一个站
  const sitesQ = useQuery({
    queryKey: ['sites', 'active'] as const,
    queryFn: () => sitesApi.list({ page: 1, page_size: 50, status: 'active' }).catch(() => ({ items: [], total: 0, page: 1, page_size: 0 })),
  });
  const site = sitesQ.data?.items?.[0] as SiteListItem | undefined;
  const siteId = site?.id;
  const siteSlug = site?.slug;

  // 2. 发布历史
  const jobsQ = useQuery({
    queryKey: ['publish-jobs', siteId],
    queryFn: () => publishApi.list(siteId!, { page: 1, page_size: 20 }),
    enabled: !!siteId,
  });

  // 3. 当前正在跑的 deployment (轮询目标)
  const [activeId, setActiveId] = useState<string | null>(null);
  // P3.6.4: 缺失资源检查弹窗
  const [missing, setMissing] = useState<MissingAsset[] | null>(null);
  // 触发新发布
  const triggerMut = useMutation({
    mutationFn: (force: boolean = false) =>
      publishApi.trigger(siteId!, { triggered_by: 'manual', force }),
    onSuccess: (res) => {
      if (!res) {
        toast.error('触发失败');
        return;
      }
      toast.success(res.message);
      setActiveId(res.deployment_id);
      qc.invalidateQueries({ queryKey: ['publish-jobs', siteId] });
    },
    onError: (e: any) => {
      // P3.6.4: 422 资源缺失 → 弹确认框
      const data = e?.response?.data;
      if (e?.response?.status === 422 && data?.data?.missing) {
        setMissing(data.data.missing);
        return;
      }
      toast.error(e?.response?.data?.message || e?.message || '触发失败');
    },
  });

  // 回滚
  const rollbackMut = useMutation({
    mutationFn: (targetId: string) => publishApi.rollback(siteId!, targetId, '手动回滚'),
    onSuccess: (res) => {
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['publish-jobs', siteId] });
    },
    onError: (e: any) => toast.error(e?.message || '回滚失败'),
  });

  // 加载中
  if (sitesQ.isLoading || (siteId && jobsQ.isLoading)) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (!siteId) {
    return <EmptyState title="暂无可管理的站点" />;
  }
  const jobs = jobsQ.data?.items || [];

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              静态发布
            </h1>
            <PublishStatusBadge status={site?.publish_status ?? 'never_published'} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            构建 SSG 静态产物, 部署到公开站
          </p>
        </div>
        <Button
          onClick={() => triggerMut.mutate(false)}
          disabled={triggerMut.isPending}
          className="h-8 text-xs"
        >
          <Rocket className="h-3.5 w-3.5" />
          {triggerMut.isPending ? '触发中...' : '立即发布'}
        </Button>
      </header>

      {/* 当前任务 (轮询) */}
      {activeId && (
        <DeploymentDetail
          deploymentId={activeId}
          onDone={() => qc.invalidateQueries({ queryKey: ['publish-jobs', siteId] })}
        />
      )}

      {/* 历史列表 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">发布历史 ({jobsQ.data?.total ?? 0})</CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => qc.invalidateQueries({ queryKey: ['publish-jobs', siteId] })}
              className="h-7 text-xs"
            >
              <RefreshCw className="h-3 w-3" />
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <EmptyState
              icon={Rocket as any}
              title="暂无发布历史"
              description="点击页面右上角的「发布」按钮可将当前站点静态化部署到生产"
              size="sm"
              className="border-0 bg-transparent py-6"
            />
          ) : (
            <div className="divide-y">
              {jobs.map(j => (
                <DeploymentRow
                  key={j.id}
                  j={j}
                  siteSlug={siteSlug}
                  rolling={rollbackMut.isPending && rollbackMut.variables === j.id}
                  onRollback={() => rollbackMut.mutate(j.id)}
                  onShowDetail={() => setActiveId(j.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* P3.6.4: 资源缺失确认框 (发布 422 时弹出) */}
      <MissingAssetsDialog
        open={!!missing}
        onClose={() => setMissing(null)}
        onForcePublish={() => {
          setMissing(null);
          triggerMut.mutate(true);
        }}
        siteId={siteId!}
        missing={missing || []}
        isForcing={triggerMut.isPending}
      />
    </div>
  );
}

// === 单行 ===
function DeploymentRow({
  j, rolling, onRollback, onShowDetail, siteSlug,
}: {
  j: DeploymentListItem;
  rolling: boolean;
  onRollback: () => void;
  onShowDetail: () => void;
  siteSlug?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <StatusIcon status={j.status} className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <StatusBadge status={j.status} />
          <span className="text-muted-foreground text-xs">
            {new Date(j.created_at).toLocaleString('zh-CN')}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {j.triggered_by} · {j.content_count ?? 0} 文章 · {j.duration_ms !== null ? `${j.duration_ms}ms` : '-'}
          {j.retry_count > 0 && ` · 重试 ${j.retry_count}`}
        </div>
        {j.error_message && (
          <div className="text-xs text-destructive mt-1 line-clamp-1">{j.error_message}</div>
        )}
      </div>
      <div className="flex items-center gap-1">
        {j.status === 'success' && siteSlug && (
          <a
            href={`/sites/${siteSlug}/`}
            target="_blank"
            rel="noreferrer"
            title="预览已发布的站点"
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-emerald-50 hover:text-emerald-600"
          >
            <Eye className="h-3 w-3" />
            预览
          </a>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={onShowDetail}
          className="h-7 text-xs"
        >
          <FileText className="h-3 w-3" />
          详情
        </Button>
        {j.status === 'success' && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRollback}
            disabled={rolling}
            className="h-7 text-xs"
          >
            <RotateCcw className="h-3 w-3" />
            {rolling ? '...' : '回滚'}
          </Button>
        )}
      </div>
    </div>
  );
}
