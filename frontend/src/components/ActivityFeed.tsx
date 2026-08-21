// ActivityFeed.tsx - 活动时间线 (P6.4-A #3)
//
// 合并展示: 内容发布 + 部署成功/失败 + AI 任务完成
// 按时间倒序, 限 8 条 (dashboard 卡片用)

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Globe,
  Rocket,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Pencil,
  Loader2,
  ArrowUpRight,
} from 'lucide-react';
import { statsApi, type ActivityItem as Item } from '@/api/stats';
import { Card } from '@/components/ui';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryLoading } from '@/components/ui/QueryLoading';
import { cn } from '@/lib/utils';

const TYPE_META: Record<
  Item['type'],
  { icon: any; color: string; bg: string; verb: (p: Item['payload']) => string }
> = {
  content_published: {
    icon: Pencil,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    verb: (p) => `发布了 ${p.title ?? '一篇文章'}`,
  },
  deployment_success: {
    icon: CheckCircle2,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    verb: (p) => `发布站点 ${p.content_count ?? 0} 页成功`,
  },
  deployment_failed: {
    icon: AlertCircle,
    color: 'text-red-600',
    bg: 'bg-red-50',
    verb: () => '站点发布失败',
  },
  ai_run_success: {
    icon: Sparkles,
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    verb: (p) => `AI ${p.task_type ?? ''} 完成`,
  },
  ai_run_failed: {
    icon: AlertCircle,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    verb: (p) => `AI ${p.task_type ?? ''} 失败`,
  },
};

const TASK_LABEL: Record<string, string> = {
  rewrite: '改写',
  expand: '扩写',
  shorten: '缩写',
  polish: '润色',
  translate: '翻译',
  draft: '起稿',
  audit: '审查',
  theme: '主题',
  image: '图片',
  optimize_design: '设计优化',
  responsive: '响应式',
  a11y: '无障碍',
  seo: 'SEO',
  format_html: 'HTML 整理',
  site_agent: '站点助手',
  import_docx: 'DOCX 导入',
  import_pdf: 'PDF 导入',
  import_paste_html: '粘贴导入',
  extract_assets: '资产提取',
};

function relTime(at: string | null): string {
  if (!at) return '';
  const now = Date.now();
  const t = new Date(at).getTime();
  const diff = Math.floor((now - t) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function itemHref(item: Item): string | null {
  if (item.type === 'content_published' && item.payload.content_id && item.site_id) {
    return `/sites/${item.site_id}/contents/${item.payload.content_id}`;
  }
  if (item.site_id) {
    return `/c/${item.site_id}`;
  }
  return '/sites';
}

export function ActivityFeed({ limit = 8 }: { limit?: number }) {
  const q = useQuery({
    queryKey: ['stats-activity', limit],
    queryFn: () => statsApi.getActivity(limit),
    refetchInterval: 60_000,
  });

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold">最近活动</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            内容发布 · 部署 · AI 任务 · 跨站合并时间线
          </p>
        </div>
        {q.data && q.data.count > 0 && (
          <span className="text-[10px] text-muted-foreground">最近 7 天</span>
        )}
      </div>
      <div>
        {q.isLoading ? (
          <div className="px-5 py-3">
            <QueryLoading variant="rows" count={4} />
          </div>
        ) : (q.data?.items?.length ?? 0) === 0 ? (
          <EmptyState
            icon={Globe}
            title="还没有活动"
            description="发布站点、运行 AI 任务或发布文章后, 这里会出现时间线"
            size="sm"
            className="rounded-none border-0"
          />
        ) : (
          <ul className="divide-y">
            {q.data!.items.map((item, idx) => {
              const meta = TYPE_META[item.type];
              const href = itemHref(item);
              const taskLabel = item.payload.task_type
                ? TASK_LABEL[item.payload.task_type] ?? item.payload.task_type
                : '';
              const verb = taskLabel && item.type.startsWith('ai_run')
                ? `AI「${taskLabel}」${item.type === 'ai_run_success' ? '完成' : '失败'}`
                : meta.verb(item.payload);
              return (
                <li key={`${item.type}-${item.at}-${idx}`}>
                  <Link
                    to={href ?? '#'}
                    className="group flex items-start gap-3 px-5 py-2.5 hover:bg-secondary/40 transition-colors"
                  >
                    <div className={cn(
                      'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md',
                      meta.bg,
                    )}>
                      <meta.icon className={cn('h-3.5 w-3.5', meta.color)} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] leading-tight">
                        <span className="font-medium text-foreground">{item.actor_name ?? '系统'}</span>
                        <span className="text-muted-foreground"> · </span>
                        <span className="text-foreground/90">{verb}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground flex items-center gap-1.5">
                        {item.site_name && (
                          <>
                            <span className="truncate max-w-[140px]">{item.site_name}</span>
                            <span>·</span>
                          </>
                        )}
                        {item.payload.tokens !== undefined && (
                          <>
                            <span>{item.payload.tokens.toLocaleString()} tokens</span>
                            <span>·</span>
                          </>
                        )}
                        {item.payload.duration_ms !== undefined && (
                          <>
                            <span>{item.payload.duration_ms}ms</span>
                            <span>·</span>
                          </>
                        )}
                        <span>{relTime(item.at)}</span>
                      </div>
                    </div>
                    {href && (
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {q.isError && (
          <div className="px-5 py-3 text-xs text-red-600 flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" />
            加载失败
          </div>
        )}
      </div>
    </Card>
  );
}