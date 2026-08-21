import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Rocket,
  FileText,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useState } from 'react';
import { publishApi, type DeploymentListItem } from '@/api/publish';

const STATUS_MAP: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  success: { label: '成功', color: 'text-green-600 bg-green-50', icon: CheckCircle2 },
  failed: { label: '失败', color: 'text-red-600 bg-red-50', icon: XCircle },
  building: { label: '构建中', color: 'text-blue-600 bg-blue-50', icon: Loader2 },
  pending: { label: '排队中', color: 'text-amber-600 bg-amber-50', icon: Clock },
  cancelled: { label: '已取消', color: 'text-gray-500 bg-gray-50', icon: XCircle },
};

const SCOPE_MAP: Record<string, string> = {
  site: '整站发布',
  category: '栏目发布',
  content: '文章发布',
};

function formatDuration(ms: number | null) {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatSize(bytes: number | null) {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatTime(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function DeployRow({ item }: { item: DeploymentListItem }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_MAP[item.status] || STATUS_MAP.pending;
  const Icon = cfg.icon;
  const detailQ = useQuery({
    queryKey: ['deployment-detail', item.id],
    queryFn: () => publishApi.get(item.id),
    enabled: expanded,
  });

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg.color}`}>
          <Icon className={`h-3 w-3 ${item.status === 'building' ? 'animate-spin' : ''}`} />
          {cfg.label}
        </span>
        <span className="text-[12px] font-medium text-slate-700">
          {SCOPE_MAP[item.scope] || item.scope}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {formatTime(item.created_at)}
        </span>
        <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          {item.content_count != null && (
            <span title="页面数">{item.content_count} 页</span>
          )}
          <span title="耗时">{formatDuration(item.duration_ms)}</span>
          <span title="产物大小">{formatSize(item.artifact_size)}</span>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>
      {expanded && (
        <div className="border-t bg-slate-50/50 px-4 py-3 text-[11px]">
          {detailQ.isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> 加载中...
            </div>
          )}
          {detailQ.data && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-muted-foreground">
                <div>触发方式: <span className="text-slate-700">{detailQ.data.triggered_by}</span></div>
                <div>开始时间: <span className="text-slate-700">{formatTime(detailQ.data.started_at)}</span></div>
                <div>完成时间: <span className="text-slate-700">{formatTime(detailQ.data.finished_at)}</span></div>
                <div>重试次数: <span className="text-slate-700">{detailQ.data.retry_count}</span></div>
              </div>
              {detailQ.data.error_message && (
                <div className="rounded border border-red-200 bg-red-50 p-2 text-red-700">
                  {detailQ.data.error_message}
                </div>
              )}
              {detailQ.data.build_log && (
                <details className="group">
                  <summary className="cursor-pointer text-blue-600 hover:underline">
                    <FileText className="inline h-3 w-3 mr-1" />
                    构建日志
                  </summary>
                  <pre className="mt-1 max-h-[200px] overflow-auto rounded border bg-white p-2 text-[10px] leading-relaxed text-slate-600">
                    {detailQ.data.build_log}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DeployLog() {
  const { siteId } = useParams<{ siteId: string }>();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const pageSize = 20;

  const q = useQuery({
    queryKey: ['deploy-log', siteId, page, statusFilter],
    queryFn: () =>
      publishApi.list(siteId!, {
        page,
        page_size: pageSize,
        ...(statusFilter ? { status: statusFilter } : {}),
      }),
    enabled: !!siteId,
  });

  const items: DeploymentListItem[] = (q.data as any)?.data?.items ?? [];
  const total: number = (q.data as any)?.data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="mx-auto max-w-[960px] px-6 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Rocket className="h-5 w-5 text-blue-600" />
        <h1 className="text-[16px] font-semibold text-slate-800">发布日志</h1>
        <span className="text-[12px] text-muted-foreground">共 {total} 条记录</span>
      </div>

      {/* 筛选栏 */}
      <div className="mb-3 flex items-center gap-2">
        {['', 'success', 'failed', 'building', 'pending'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
              statusFilter === s
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {s === '' ? '全部' : STATUS_MAP[s]?.label || s}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="rounded-lg border bg-white">
        {q.isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> 加载中...
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-muted-foreground">
            暂无发布记录
          </div>
        ) : (
          items.map((item) => <DeployRow key={item.id} item={item} />)
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="rounded border px-3 py-1 text-[11px] disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-[11px] text-muted-foreground">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="rounded border px-3 py-1 text-[11px] disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
