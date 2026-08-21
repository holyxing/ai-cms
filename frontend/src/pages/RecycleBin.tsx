/**
 * @deprecated P2.9 D1 - 路由已重定向到 /
 * 新位置: ContentLayout (左树状导航) + 栏目内容页 /c/:id
 * 此文件保留作为备份, 不再 import
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Globe, RotateCcw, Trash2, Search, AlertTriangle } from 'lucide-react';

import { sitesApi, type SiteListItem } from '@/api/sites';
import { useAuthStore } from '@/stores/auth';
import { Card, Button, Input, Skeleton, EmptyState, ConfirmDialog } from '@/components/ui';

export function RecycleBinPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [q, setQ] = useState('');
  const [confirmRestore, setConfirmRestore] = useState<SiteListItem | null>(null);
  const [confirmPermDel, setConfirmPermDel] = useState<SiteListItem | null>(null);

  // 守卫: 仅 super_admin
  if (currentUser && !currentUser.is_super_admin) {
    return (
      <div className="px-6 py-6 lg:px-8 lg:py-8 max-w-4xl">
        <p className="text-sm text-muted-foreground">需要超管权限</p>
        <Button variant="link" onClick={() => navigate('/sites')}>返回站点</Button>
      </div>
    );
  }

  const { data, isLoading } = useQuery({
    queryKey: ['recycle-bin'],
    queryFn: () => sitesApi.listRecycleBin({ page_size: 50 }),
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => sitesApi.restore(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recycle-bin'] });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      setConfirmRestore(null);
    },
  });

  const permDelMut = useMutation({
    mutationFn: (id: string) => sitesApi.permanentDelete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recycle-bin'] });
      setConfirmPermDel(null);
    },
  });

  const items = (data?.items || []).filter(
    (s) => !q || s.name.includes(q) || s.slug.includes(q),
  );

  return (
    <div className="px-6 py-6 lg:px-8 lg:py-8 max-w-4xl">
      {/* 头部 */}
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate('/sites')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">回收站</h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            30 天内的软删除站点 · 永久删除前可恢复
          </p>
        </div>
      </div>

      {/* 搜索 */}
      <div className="relative mb-4 max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索名称或 slug"
          className="h-8 pl-8 text-sm"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <div className="p-6">
            <EmptyState
              icon={Globe}
              title="回收站是空的"
              description="删除的站点会在 30 天内保留, 之后会被自动清理"
            />
          </div>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y">
            {items.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                    <Globe className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      <code className="rounded bg-secondary px-1 py-0.5">{s.slug}</code>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setConfirmRestore(s)}
                    disabled={restoreMut.isPending}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    恢复
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-600"
                    onClick={() => setConfirmPermDel(s)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 提示 */}
      {items.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/50 p-2.5 text-[11px] text-amber-900">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>
            回收站中的站点 30 天后会被自动清理, 永久删除前请确认数据已备份
          </span>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmRestore}
        onClose={() => setConfirmRestore(null)}
        onConfirm={() => confirmRestore && restoreMut.mutate(confirmRestore.id)}
        title="恢复站点"
        description={confirmRestore && `确认恢复站点 “${confirmRestore.name}”？恢复后该站点将重新可用。`}
        confirmText="恢复"
        variant="info"
        loading={restoreMut.isPending}
      />
      <ConfirmDialog
        open={!!confirmPermDel}
        onClose={() => setConfirmPermDel(null)}
        onConfirm={() => confirmPermDel && permDelMut.mutate(confirmPermDel.id)}
        title="永久删除"
        description={
          <div className="space-y-1.5">
            <p>确认永久删除 “{confirmPermDel?.name}”？</p>
            <p className="text-red-600 font-medium">⚠️ 不可恢复, 站点关联的域名/内容/发布历史均会被彻底删除</p>
          </div>
        }
        confirmText="永久删除"
        loading={permDelMut.isPending}
      />
    </div>
  );
}
