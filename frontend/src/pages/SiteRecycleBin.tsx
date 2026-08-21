// SiteRecycleBin.tsx - 站点级回收站（文章/栏目/模板/媒体）
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RotateCcw, Trash2, Search, FileText, FolderTree, FileCode,
  Image as ImageIcon, CheckSquare, Square,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input, Badge, EmptyState, ConfirmDialog, QueryLoading, QueryError } from '@/components/ui';
import { BatchActionBar } from '@/components/BatchActionBar';
import { cn } from '@/lib/utils';
import { siteTrashApi, type TrashItem, type TrashItemType } from '@/api/siteTrash';

const TABS: { key: TrashItemType | ''; label: string; icon: typeof FileText }[] = [
  { key: '', label: '全部', icon: Trash2 },
  { key: 'content', label: '文章', icon: FileText },
  { key: 'category', label: '栏目', icon: FolderTree },
  { key: 'layout', label: '模板', icon: FileCode },
  { key: 'media', label: '媒体资源', icon: ImageIcon },
];

function itemKey(item: Pick<TrashItem, 'type' | 'id'>) {
  return `${item.type}:${item.id}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function SiteRecycleBinPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<TrashItemType | ''>('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmRestore, setConfirmRestore] = useState<TrashItem | null>(null);
  const [confirmPerm, setConfirmPerm] = useState<TrashItem | null>(null);

  const listQ = useQuery({
    queryKey: ['site-trash', siteId, typeFilter, q],
    queryFn: () => siteTrashApi.list(siteId!, {
      type: typeFilter || undefined,
      page_size: 100,
      q: q.trim() || undefined,
    }),
    enabled: !!siteId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['site-trash', siteId] });
    qc.invalidateQueries({ queryKey: ['site-trash-counts', siteId] });
    qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
    qc.invalidateQueries({ queryKey: ['contents'] });
    qc.invalidateQueries({ queryKey: ['layouts', siteId] });
  };

  const restoreMut = useMutation({
    mutationFn: (item: TrashItem) => siteTrashApi.restore(siteId!, item.type, item.id),
    onSuccess: () => {
      toast.success('已还原');
      setConfirmRestore(null);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message || '还原失败'),
  });

  const permMut = useMutation({
    mutationFn: (item: TrashItem) => siteTrashApi.permanentDelete(siteId!, item.type, item.id),
    onSuccess: () => {
      toast.success('已永久删除');
      setConfirmPerm(null);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message || '永久删除失败'),
  });

  const batchMut = useMutation({
    mutationFn: async (params: { action: 'restore' | 'permanent'; keys: string[] }) => {
      const items = params.keys.map((k) => {
        const [type, ...rest] = k.split(':');
        return { type: type as TrashItemType, id: rest.join(':') };
      });
      return siteTrashApi.batch(siteId!, params.action, items);
    },
    onSuccess: (data, vars) => {
      const label = vars.action === 'restore' ? '还原' : '永久删除';
      if (data.failed > 0) {
        toast.warning(`批量${label}：成功 ${data.succeeded}，失败 ${data.failed}`);
      } else {
        toast.success(`已批量${label} ${data.succeeded} 项`);
      }
      setSelected(new Set());
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message || '批量操作失败'),
  });

  const counts = listQ.data?.counts;
  const items = listQ.data?.items ?? [];
  const totalAll = useMemo(() => {
    if (!counts) return 0;
    return Object.values(counts).reduce((a, b) => a + b, 0);
  }, [counts]);

  const allSelected = items.length > 0 && items.every((it) => selected.has(itemKey(it)));
  const someSelected = items.some((it) => selected.has(itemKey(it))) && !allSelected;

  const toggleOne = (key: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map(itemKey)));
  };

  if (!siteId) {
    return <div className="p-6 text-sm text-muted-foreground">请先选择站点</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-2 py-4 pb-20 lg:px-4">
      <div className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">回收站</h1>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          软删除的文章、栏目、模板、媒体资源 · 可还原或永久删除
          （站点静态资源 CSS/JS 等为硬删，不进回收站）
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-md border bg-background p-0.5">
          {TABS.map((t) => {
            const count = t.key === '' ? totalAll : (counts?.[t.key] ?? 0);
            const Icon = t.icon;
            return (
              <button
                key={t.key || 'all'}
                type="button"
                onClick={() => {
                  setTypeFilter(t.key);
                  setSelected(new Set());
                }}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded px-2.5 text-[11.5px] font-medium transition-colors',
                  typeFilter === t.key
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <Icon className="h-3 w-3" />
                {t.label}
                {count > 0 && (
                  <span className="tabular-nums text-[10px] opacity-70">({count})</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="relative ml-auto w-full max-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题 / slug"
            className="h-7 pl-8 text-[12px]"
          />
        </div>
      </div>

      {listQ.isLoading && <QueryLoading />}
      {listQ.isError && <QueryError error={listQ.error} onRetry={() => listQ.refetch()} />}

      {!listQ.isLoading && !listQ.isError && items.length === 0 && (
        <EmptyState
          icon={Trash2}
          title="回收站是空的"
          description="删除的文章、栏目、模板、媒体会出现在这里"
        />
      )}

      {items.length > 0 && (
        <div className="overflow-hidden rounded-md border bg-background">
          <div className="flex items-center gap-2 border-b px-3 py-1.5">
            <button
              type="button"
              onClick={toggleAll}
              className="flex h-5 w-5 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
              title={allSelected ? '取消全选' : '全选当前页'}
            >
              {allSelected ? (
                <CheckSquare className="h-3.5 w-3.5 text-blue-600" />
              ) : someSelected ? (
                <CheckSquare className="h-3.5 w-3.5 text-blue-500" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
            </button>
            <span className="text-[12px] font-medium">列表 ({items.length})</span>
          </div>
          <ul className="divide-y">
            {items.map((item) => {
              const key = itemKey(item);
              const checked = selected.has(key);
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/40"
                >
                  <button
                    type="button"
                    onClick={() => toggleOne(key, !checked)}
                    className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    {checked ? (
                      <CheckSquare className="h-3.5 w-3.5 text-blue-600" />
                    ) : (
                      <Square className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="muted" className="text-[10px]">{item.type_label}</Badge>
                      <span className="truncate text-[13px] font-medium text-slate-800">
                        {item.title}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {item.slug && <code className="mr-2 rounded bg-secondary px-1 py-0.5">{item.slug}</code>}
                      删除于 {formatTime(item.deleted_at)}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-[11.5px] text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                      onClick={() => setConfirmRestore(item)}
                    >
                      <RotateCcw className="h-3 w-3" />
                      还原
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-[11.5px] text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={() => setConfirmPerm(item)}
                    >
                      <Trash2 className="h-3 w-3" />
                      永久删除
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <BatchActionBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        actions={[
          {
            key: 'restore',
            label: '批量还原',
            icon: RotateCcw,
            tone: 'primary',
            confirm: true,
            confirmMessage: `将选中的 ${selected.size} 项从回收站还原？`,
            onAction: () => batchMut.mutateAsync({ action: 'restore', keys: [...selected] }),
          },
          {
            key: 'permanent',
            label: '批量永久删除',
            icon: Trash2,
            tone: 'destructive',
            confirm: true,
            confirmDestructive: true,
            confirmMessage: `将选中的 ${selected.size} 项永久删除？此操作不可恢复。`,
            onAction: () => batchMut.mutateAsync({ action: 'permanent', keys: [...selected] }),
          },
        ]}
      />

      <ConfirmDialog
        open={!!confirmRestore}
        onClose={() => setConfirmRestore(null)}
        title="还原"
        description={
          confirmRestore
            ? `确认还原「${confirmRestore.title}」？（${confirmRestore.type_label}）`
            : ''
        }
        confirmText="还原"
        onConfirm={() => confirmRestore && restoreMut.mutate(confirmRestore)}
        loading={restoreMut.isPending}
      />
      <ConfirmDialog
        open={!!confirmPerm}
        onClose={() => setConfirmPerm(null)}
        title="永久删除"
        description={
          confirmPerm
            ? `确认永久删除「${confirmPerm.title}」？此操作不可恢复。`
            : ''
        }
        confirmText="永久删除"
        variant="danger"
        onConfirm={() => confirmPerm && permMut.mutate(confirmPerm)}
        loading={permMut.isPending}
      />
    </div>
  );
}
