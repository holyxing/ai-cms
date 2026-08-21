// P5.1 搜索结果页: 跨站全文搜索 (走 /api/v1/search 单端点, ts_headline 高亮 + ts_rank 排序)
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, FileText, ArrowLeft, Loader2 } from 'lucide-react';
import { searchApi, type SearchHit } from '@/api/search';
import { Card, CardContent, Badge, Button, QueryLoading, QueryError, EmptyState } from '@/components/ui';
import { useDebounce } from '@/lib/hooks';

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [input, setInput] = useState(q);
  const debounced = useDebounce(input.trim(), 250);
  const navigate = useNavigate();

  // 同步 URL q → input (URL change from outside, e.g. ⌘K)
  useEffect(() => setInput(q), [q]);

  // debounced input → URL
  useEffect(() => {
    if (debounced === q) return;
    if (debounced) setParams({ q: debounced });
    else setParams({});
  }, [debounced]);  // 故意省略 q/setParams 避免循环

  // 拉搜索结果 (debounced input 直接进 query, URL 仅作回填)
  const searchQ = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => searchApi.global({ q: debounced, page_size: 50 }),
    enabled: !!debounced,
    retry: 1,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const qq = input.trim();
    if (qq) setParams({ q: qq });
    else setParams({});
  };

  // 按 site_id 分组渲染
  const grouped = useMemo(() => {
    const items = searchQ.data?.items || [];
    const map = new Map<string, { site_name: string; site_slug: string; items: SearchHit[] }>();
    for (const it of items) {
      const key = it.site_id;
      if (!map.has(key)) {
        map.set(key, { site_name: it.site_name || '?', site_slug: it.site_slug || '?', items: [] });
      }
      map.get(key)!.items.push(it);
    }
    return Array.from(map.entries()).map(([id, v]) => ({ site_id: id, ...v }));
  }, [searchQ.data]);

  const grandTotal = searchQ.data?.total ?? 0;

  return (
    <div className="px-6 py-6 lg:px-8 lg:py-8 max-w-[1100px] mx-auto">
      {/* 头部 */}
      <div className="mb-5 flex items-center gap-3 border-b pb-4">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Search className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-xl font-semibold tracking-tight">搜索</h1>
      </div>

      {/* 搜索框 */}
      <form onSubmit={submit} className="mb-6">
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-primary/15 focus-within:border-primary/40">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入关键词 (支持中英文, 标题/正文/摘要/slug)"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
          {input && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => { setInput(''); setParams({}); }}
            >
              清空
            </Button>
          )}
        </div>
      </form>

      {/* 状态: 没输入 */}
      {!debounced && (
        <EmptyState
          icon={Search}
          title="请输入关键词"
          description="支持搜索文章标题/正文/摘要/slug, 中英文都可"
        />
      )}

      {/* 状态: 加载中 */}
      {debounced && searchQ.isLoading && (
        <QueryLoading variant="list" count={6} />
      )}

      {/* 状态: 错误 */}
      {debounced && searchQ.isError && (
        <QueryError
          error={searchQ.error as any}
          onRetry={() => searchQ.refetch()}
        />
      )}

      {/* 状态: 0 结果 */}
      {debounced && !searchQ.isLoading && !searchQ.isError && grandTotal === 0 && (
        <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
          <p>没有找到匹配 "<span className="font-mono text-foreground">{debounced}</span>" 的内容</p>
          <p className="mt-1 text-xs">试试其他关键词, 或检查拼写</p>
        </div>
      )}

      {/* 结果按站点分组 */}
      {debounced && !searchQ.isLoading && !searchQ.isError && grouped.length > 0 && (
        <div className="space-y-5">
          <div className="text-sm text-muted-foreground">
            找到 <span className="font-semibold text-foreground">{grandTotal}</span> 条结果,
            分布在 <span className="font-semibold text-foreground">{grouped.length}</span> 个站点
          </div>

          {grouped.map((g) => (
            <Card key={g.site_id} className="shadow-sm">
              <CardContent className="p-0">
                <div className="flex items-center justify-between border-b px-4 py-2.5 bg-secondary/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-5 w-5 items-center justify-center rounded bg-blue-100 text-blue-600 text-[10px] font-bold flex-shrink-0">
                      {g.site_name?.[0] || '?'}
                    </div>
                    <span className="text-sm font-medium truncate">{g.site_name}</span>
                    <code className="text-[10px] text-muted-foreground truncate">/{g.site_slug}</code>
                  </div>
                  <Badge variant="muted" className="text-[10px]">
                    {g.items.length} 条
                  </Badge>
                </div>
                <ul className="divide-y">
                  {g.items.map((c) => (
                    <li
                      key={c.id}
                      className="px-4 py-2.5 hover:bg-secondary/30 cursor-pointer transition-colors"
                      onClick={() => navigate(`/sites/${c.site_id}/contents/${c.id}`)}
                    >
                      <div className="flex items-start gap-2.5">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          {/* ts_headline 直接返回带 <mark> 标签的 HTML */}
                          <div
                            className="text-sm font-medium truncate"
                            dangerouslySetInnerHTML={{ __html: c.title_highlight || c.title }}
                          />
                          {c.excerpt && (
                            <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {c.excerpt}
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                            <span>/{c.slug}</span>
                            <span>·</span>
                            <StatusBadge status={c.status} />
                            <span>·</span>
                            <span>{new Date(c.updated_at).toLocaleDateString('zh-CN')}</span>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: SearchHit['status'] }) {
  const map: Record<SearchHit['status'], { label: string; variant: 'default' | 'outline' | 'muted' | 'warning' | 'info' }> = {
    draft:     { label: '草稿',     variant: 'outline' },
    pending:   { label: '待审',     variant: 'warning' },
    published: { label: '已发布',   variant: 'default' },
    scheduled: { label: '定时发布', variant: 'info' },
    archived:  { label: '已归档',   variant: 'muted' },
  };
  const m = map[status] || map.draft;
  return <Badge variant={m.variant} className="text-[10px]">{m.label}</Badge>;
}
