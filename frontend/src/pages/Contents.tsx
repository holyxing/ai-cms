/**
 * @deprecated P2.9 D1 - 路由已重定向到 /
 * 新位置: ContentLayout (左树状导航) + 栏目内容页 /c/:id
 * 此文件保留作为备份, 不再 import
 */
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  FileText,
  Plus,
  Trash2,
  Eye,
  Pencil,
  Search,
  X as XIcon,
} from 'lucide-react';

import { sitesApi } from '@/api/sites';
import { contentsApi, type ContentListItem, type ContentStatus } from '@/api/contents';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth';
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label, Badge, Skeleton, EmptyState, ConfirmDialog, FastLoading } from '@/components/ui';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: '草稿',
  pending: '待审',
  published: '已发布',
  scheduled: '已计划',
  archived: '已归档',
};
const STATUS_VARIANT: Record<ContentStatus, 'default' | 'secondary' | 'muted' | 'warning' | 'success'> = {
  draft: 'muted',
  pending: 'warning',
  published: 'success',
  scheduled: 'secondary',
  archived: 'muted',
};

// === 创建对话框 ===
function CreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { id: siteId } = useParams<{ id: string }>();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [error, setError] = useState('');

  const createMut = useMutation({
    mutationFn: () => contentsApi.create(siteId!, {
      title: title.trim(),
      slug: slug.trim().toLowerCase(),
      excerpt: excerpt.trim() || undefined,
    }),
    onSuccess: (c) => { onCreated(c.id); onClose(); },
    onError: (e: any) => setError(e.message || '创建失败'),
  });

  if (!open) return null;
  const validSlug = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold">新建内容</h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <XIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); if (validSlug) createMut.mutate(); }}
          className="space-y-3 p-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="ct-title" className="text-xs font-medium">标题 *</Label>
            <Input
              id="ct-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="我的第一篇博客"
              required
              autoFocus
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-slug" className="text-xs font-medium">
              Slug * <span className="text-[10px] text-muted-foreground">(URL)</span>
            </Label>
            <Input
              id="ct-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="my-first-post"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              className="h-9 text-sm font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-excerpt" className="text-xs font-medium">摘要</Label>
            <Input
              id="ct-excerpt"
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              placeholder="可选"
              className="h-9 text-sm"
            />
          </div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <p className="text-[10px] text-muted-foreground">
            创建后可进入编辑器填写正文与元数据
          </p>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="h-8 text-xs">取消</Button>
            <Button
              type="submit"
              disabled={!validSlug || !title.trim() || createMut.isPending}
              className="h-8 text-xs"
            >
              {createMut.isPending ? '创建中...' : '创建'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// === 列表行 ===
function ContentRow({
  c,
  canDelete,
  onDelete,
  onEdit,
}: {
  c: ContentListItem;
  canDelete: boolean;
  onDelete: (id: string, title: string) => void;
  onEdit: (id: string) => void;
}) {
  return (
    <li className="group flex items-start gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
        <FileText className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link to={`/sites/${c.site_id}/contents/${c.id}`} className="truncate text-sm font-medium hover:underline">
            {c.title}
          </Link>
          <Badge variant={STATUS_VARIANT[c.status]} className="text-[10px]">
            {STATUS_LABEL[c.status]}
          </Badge>
        </div>
        {c.excerpt && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{c.excerpt}</p>
        )}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <code className="rounded bg-secondary px-1 py-0.5">/{c.slug}</code>
          <span>·</span>
          <span>{c.author_name || '匿名'}</span>
          <span>·</span>
          <span>更新 {new Date(c.updated_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          {c.view_count > 0 && (<><span>·</span><span>{c.view_count} 浏览</span></>)}
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => onEdit(c.id)}
          title="编辑"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {canDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
            onClick={() => onDelete(c.id, c.title)}
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}

// === 页面 ===
export function ContentsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ContentStatus | ''>('');
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);

  const { data: site } = useQuery({
    queryKey: ['site', id],
    queryFn: () => sitesApi.get(id!),
    enabled: !!id,
  });

  const { data: page, isLoading } = useQuery({
    queryKey: ['contents', id, statusFilter, search],
    queryFn: () => contentsApi.list(id!, {
      status: statusFilter || undefined,
      q: search || undefined,
    }),
    enabled: !!id,
  });

  const restoreMut = useMutation({
    mutationFn: (contentId: string) => contentsApi.restore(id!, contentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contents', id] });
      toast.success('已恢复');
    },
    onError: (e: any) => toast.error(e?.message || '恢复失败'),
  });

  const removeMut = useMutation({
    mutationFn: (contentId: string) => contentsApi.remove(id!, contentId),
    onSuccess: (_, contentId) => {
      queryClient.invalidateQueries({ queryKey: ['contents', id] });
      setConfirmDelete(null);
      // P6.3 #18 撤销: toast 带 undo 按钮 (5 秒)
      const deletedTitle = confirmDelete?.title ?? '内容';
      toast.success(`已删除 “${deletedTitle}”`, {
        duration: 5000,
        action: {
          label: '撤销',
          onClick: () => restoreMut.mutate(contentId),
        },
      });
    },
  });

  if (!site) {
    return (
      <div className="px-6 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const isOwner = !!currentUser && (currentUser.is_super_admin || currentUser.id === site.owner_id);
  const items = page?.items || [];
  const total = page?.total || 0;

  return (
    <div className="px-6 py-6 lg:px-8 lg:py-8 max-w-5xl">
      {/* 头部 */}
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/sites/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">内容</h1>
            <p className="text-[11px] text-muted-foreground">
              <Link to={`/sites/${id}`} className="hover:underline">{site.name}</Link>
              <span className="mx-1.5">·</span>
              共 {total} 篇
            </p>
          </div>
        </div>
        <div className="ml-auto">
          <Button onClick={() => setCreateOpen(true)} className="h-8 text-xs">
            <Plus className="h-3.5 w-3.5" />
            新建
          </Button>
        </div>
      </div>

      {/* 过滤 */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="全文搜索 (标题/摘要/slug)..."
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex rounded-md border bg-background p-0.5">
          {(['', 'draft', 'pending', 'published', 'archived'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s as ContentStatus | '')}
              className={cn(
                'h-7 rounded px-2.5 text-[11px] font-medium transition-colors',
                statusFilter === s
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s === '' ? '全部' : STATUS_LABEL[s as ContentStatus]}
            </button>
          ))}
        </div>
      </div>

      {/* 列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">所有内容</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <FastLoading
            loading={isLoading}
            fallback={<div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}
          >
            {items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={FileText}
                title={search || statusFilter ? '没有匹配的内容' : '还没有内容'}
                description={search || statusFilter ? '尝试调整搜索条件' : '创建第一篇内容来开始'}
              />
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((c) => (
                <ContentRow
                  key={c.id}
                  c={c}
                  canDelete={isOwner}
                  onEdit={(cid) => navigate(`/sites/${id}/contents/${cid}`)}
                  onDelete={(cid, title) => setConfirmDelete({ id: cid, title })}
                />
              ))}
            </ul>
          )}
          </FastLoading>
        </CardContent>
      </Card>

      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(cid) => navigate(`/sites/${id}/contents/${cid}`)}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && removeMut.mutate(confirmDelete.id)}
        title="删除内容"
        description={confirmDelete && `确认删除 “${confirmDelete.title}”？相关版本会保留在历史中。`}
        confirmText="删除"
        loading={removeMut.isPending}
      />
    </div>
  );
}
