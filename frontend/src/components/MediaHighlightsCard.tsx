// MediaHighlightsCard.tsx - Dashboard 媒体库摘要卡 (P6.6 dashboard 增强)
// 数据源: GET /sites/{siteId}/media?page=1&page_size=8
//
// 设计意图: 媒体库是 CMS 核心资产之一, dashboard 应该一眼看到
// "最近上传了什么 / 一共有多少" — 让用户感知资产规模, 也让"上传"入口可见

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ImageIcon, ArrowUpRight, Upload, FileText, Film, Music } from 'lucide-react';
import { mediaApi } from '@/api/media';
import type { MediaItem } from '@/api/media';
import { Card } from '@/components/ui';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryLoading } from '@/components/ui/QueryLoading';
import { cn } from '@/lib/utils';

interface Props {
  siteId: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function mimeIcon(mime: string) {
  if (mime.startsWith('image/')) return ImageIcon;
  if (mime.startsWith('video/')) return Film;
  if (mime.startsWith('audio/')) return Music;
  return FileText;
}

export function MediaHighlightsCard({ siteId }: Props) {
  const q = useQuery({
    queryKey: ['dashboard-media-highlights', siteId],
    queryFn: async () => {
      // mediaApi.list 返回 AxiosResponse, 需 unwrap
      const r = await mediaApi.list(siteId!, { page: 1, page_size: 8 });
      return r.data.data!;
    },
    enabled: !!siteId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const total = q.data?.total ?? 0;
  const items = q.data?.items ?? [];

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">媒体库</h2>
          {total > 0 && (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {total}
            </span>
          )}
        </div>
        <Link
          to={`/sites/${siteId}/media`}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
        >
          全部 <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {!siteId ? (
        <EmptyState
          icon={ImageIcon}
          title="选择一个站点查看媒体"
          size="sm"
          className="rounded-none border-0"
        />
      ) : q.isLoading ? (
        <div className="px-5 py-3">
          <QueryLoading variant="cards" count={4} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="还没有媒体文件"
          description="上传第一张图片、视频或文档"
          size="sm"
          className="rounded-none border-0"
          action={
            <Link
              to={`/sites/${siteId}/media`}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Upload className="h-3 w-3" />
              上传
            </Link>
          }
        />
      ) : (
        <div className="p-4">
          {/* 4 张缩略图 (2x2 grid) */}
          <div className="grid grid-cols-4 gap-2">
            {items.slice(0, 4).map((m: MediaItem) => {
              const isImage = m.mime_type?.startsWith('image/');
              const Icon = mimeIcon(m.mime_type);
              return (
                <Link
                  key={m.id}
                  to={`/sites/${siteId}/media`}
                  className="group relative aspect-square overflow-hidden rounded-md border bg-muted transition-colors hover:border-primary/40"
                  title={m.filename}
                >
                  {isImage && m.thumb_small_url ? (
                    <img
                      src={m.thumb_small_url}
                      alt={m.alt_text || m.filename}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-muted-foreground">
                      <Icon className="h-5 w-5" strokeWidth={1.5} />
                      <span className="line-clamp-1 text-[9px] text-center">
                        {m.filename}
                      </span>
                    </div>
                  )}
                  {/* 非图片类型: 底部小角标 */}
                  {!isImage && (
                    <div className="absolute bottom-1 right-1 rounded bg-background/90 px-1 py-0.5 text-[9px] font-mono text-muted-foreground">
                      {formatSize(m.size_bytes)}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
          {/* 底部统计 + 上传按钮 */}
          <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
            <span className="text-muted-foreground">
              共 <span className="font-medium tabular-nums text-foreground">{total}</span> 个文件
              {items.length > 0 && (
                <>
                  {' · 最近 '}
                  <span className="text-foreground">
                    {new Date(items[0].created_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                  </span>
                </>
              )}
            </span>
            <Link
              to={`/sites/${siteId}/media`}
              className="inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary/60"
            >
              <Upload className="h-3 w-3" />
              上传
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}