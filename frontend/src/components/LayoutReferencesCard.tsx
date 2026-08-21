// LayoutReferencesCard.tsx - 模板引用关系面板 (P3.7.4)
// 显示: 该模板被哪些栏目引用 (Category.template == layout.code)
//       + 这些栏目下使用了该模板的文章 (content_count + top 3 + more)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, FileText, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { layoutsApi } from '@/api/layouts';

interface Props {
  layoutId: string;
  siteId: string;
}

export function LayoutReferencesCard({ layoutId, siteId }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const refsQ = useQuery({
    queryKey: ['layout-references', layoutId],
    queryFn: () => layoutsApi.references(layoutId).catch(() => []),
    enabled: !!layoutId,
    staleTime: 30_000,
  });

  if (refsQ.isLoading) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-block h-3 w-3 animate-pulse rounded bg-muted" />
          加载引用信息…
        </div>
      </div>
    );
  }

  const data = refsQ.data;
  if (!data) return null;

  const { reference_count, references, content_uses, total_content_count } = data;
  const hasRefs = reference_count > 0;

  return (
    <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <FolderOpen className="h-3.5 w-3.5 text-blue-600" />
            <p className="text-xs font-medium">引用关系</p>
          </div>
          <div className="flex items-center gap-1">
            {hasRefs ? (
              <Badge variant="info" className="text-[9px]">
                {reference_count} 栏目
              </Badge>
            ) : null}
            {total_content_count > 0 ? (
              <Badge variant="info" className="text-[9px] bg-emerald-50 text-emerald-700">
                {total_content_count} 文章
              </Badge>
            ) : null}
            {!hasRefs && total_content_count === 0 ? (
              <Badge variant="muted" className="text-[9px]">未被引用</Badge>
            ) : null}
          </div>
        </div>

        {/* 空态 */}
        {!hasRefs && (
          <p className="text-[10.5px] text-muted-foreground leading-relaxed">
            该模板暂未被任何栏目引用, 改动不会影响现有页面。
          </p>
        )}

        {/* 栏目 + 文章列表 */}
        {hasRefs && (
          <ul className="space-y-1">
            {references.map((ref) => {
              const cu = content_uses.find((c) => c.category_id === ref.id);
              const isOpen = expanded[ref.id] ?? true; // 默认展开
              return (
                <li key={ref.id} className="border-l-2 border-blue-100 pl-2.5">
                  {/* 栏目行 */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setExpanded({ ...expanded, [ref.id]: !isOpen })}
                      className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
                    >
                      {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </button>
                    <Link
                      to={`/c/${ref.id}`}
                      className="flex flex-1 items-center gap-1 rounded px-1 py-0.5 text-[11.5px] font-medium hover:bg-blue-50/50"
                    >
                      <FolderOpen className="h-3 w-3 text-blue-500 flex-shrink-0" />
                      <span className="truncate flex-1" title={ref.name}>{ref.name}</span>
                      {cu && cu.content_count > 0 ? (
                        <span className="text-[9.5px] text-muted-foreground font-normal">
                          {cu.content_count} 篇
                        </span>
                      ) : null}
                    </Link>
                  </div>

                  {/* 文章列表 (折叠/展开) */}
                  {isOpen && cu && cu.recent_contents.length > 0 && (
                    <ul className="ml-5 mt-0.5 space-y-0.5 border-l border-slate-100 pl-2">
                      {cu.recent_contents.map((c) => (
                        <li key={c.id} className="flex items-center gap-1 py-0.5">
                          <FileText className="h-2.5 w-2.5 text-muted-foreground/60 flex-shrink-0" />
                          <Link
                            to={`/sites/${siteId}/contents/${c.id}`}
                            className="flex-1 truncate text-[10.5px] text-muted-foreground hover:text-blue-600"
                            title={c.title}
                          >
                            {c.title}
                          </Link>
                        </li>
                      ))}
                      {cu.more_count > 0 && (
                        <li className="py-0.5 text-[10px] text-muted-foreground/70">
                          … 还有 {cu.more_count} 篇
                        </li>
                      )}
                    </ul>
                  )}

                  {isOpen && cu && cu.recent_contents.length === 0 && (
                    <p className="ml-5 mt-0.5 text-[10px] text-muted-foreground/70">
                      该栏目下暂无 published 文章
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* 风险提示 */}
        {hasRefs && (
          <div className={cn(
            'mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[10.5px] leading-relaxed',
            'bg-amber-50 text-amber-700',
          )}>
            <span className="mt-px">⚠️</span>
            <p>
              删除该模板后, 这些栏目 / 文章会走 fallback 路径 (其他启用的 default, 或空模板)。
            </p>
          </div>
        )}

        {refsQ.isError ? (
          <p className="text-[10.5px] text-destructive">引用信息加载失败</p>
        ) : null}
    </div>
  );
}
