/**
 * @deprecated P2.9 D1 - 路由已重定向到 /
 * 新位置: ContentLayout (左树状导航) + 栏目内容页 /c/:id
 * 此文件保留作为备份, 不再 import
 */
import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  FolderTree,
  Plus,
  ChevronRight,
  ChevronDown,
  Edit3,
  Trash2,
  X as XIcon,
  GripVertical,
  FileText,
} from 'lucide-react';

import { sitesApi } from '@/api/sites';
import { taxonomiesApi, type Taxonomy, type TaxonomyTreeNode } from '@/api/taxonomies';
import { useAuthStore } from '@/stores/auth';
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label, Badge, Skeleton, EmptyState } from '@/components/ui';
import { cn } from '@/lib/utils';

// === 树节点 ===
function TaxonomyNode({
  node,
  canWrite,
  canDelete,
  onEdit,
  onAddChild,
  onDelete,
  defaultOpen,
}: {
  node: TaxonomyTreeNode;
  canWrite: boolean;
  canDelete: boolean;
  onEdit: (t: Taxonomy) => void;
  onAddChild: (parent: Taxonomy) => void;
  onDelete: (t: Taxonomy) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? node.depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-secondary/60',
          'transition-colors',
        )}
        style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}
        <FolderTree className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
        <span className="ml-1.5 flex-1 truncate font-medium">{node.name}</span>
        <code className="hidden text-[10px] text-muted-foreground sm:inline">/{node.slug}</code>
        {typeof node.children_count === 'number' && node.children_count > 0 && (
          <Badge variant="muted" className="text-[10px]">{node.children_count}</Badge>
        )}
        <div className="ml-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {canWrite && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onAddChild(node)}
                title="添加子栏目"
              >
                <Plus className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onEdit(node)}
                title="编辑"
              >
                <Edit3 className="h-3 w-3" />
              </Button>
            </>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-red-600"
              onClick={() => onDelete(node)}
              title="删除"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map((c) => (
            <TaxonomyNode
              key={c.id}
              node={c}
              canWrite={canWrite}
              canDelete={canDelete}
              onEdit={onEdit}
              onAddChild={onAddChild}
              onDelete={onDelete}
              defaultOpen={defaultOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// === 编辑/创建对话框 ===
function TaxonomyDialog({
  open,
  onClose,
  siteId,
  editing,
  parent,
  flatList,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  siteId: string;
  editing: Taxonomy | null;
  parent: Taxonomy | null;
  flatList: Taxonomy[];
  onSaved: (t: Taxonomy) => void;
}) {
  const [name, setName] = useState(editing?.name || '');
  const [slug, setSlug] = useState(editing?.slug || '');
  const [description, setDescription] = useState(editing?.description || '');
  const [parentId, setParentId] = useState<string>(parent?.id || editing?.parent_id || '');
  const [error, setError] = useState('');

  // P5 bug 修: open/editing/parent 变化时重置表单 (useState 初值只在挂载时生效)
  useEffect(() => {
    if (open) {
      setName(editing?.name || '');
      setSlug(editing?.slug || '');
      setDescription(editing?.description || '');
      setParentId(parent?.id || editing?.parent_id || '');
      setError('');
    }
  }, [open, editing, parent]);

  const isEdit = !!editing;

  const createMut = useMutation({
    mutationFn: () =>
      taxonomiesApi.create(siteId, {
        name: name.trim(),
        slug: slug.trim(),
        type: 'category',
        parent_id: parentId || null,
        description: description.trim() || undefined,
      }),
    onSuccess: (data) => { onSaved(data); onClose(); },
    onError: (e: any) => setError(e.message || '创建失败'),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      taxonomiesApi.update(siteId, editing!.id, {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        parent_id: parentId || undefined,
      }),
    onSuccess: (data) => { onSaved(data); onClose(); },
    onError: (e: any) => setError(e.message || '更新失败'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !slug.trim()) {
      setError('名称和 slug 必填');
      return;
    }
    if (isEdit) updateMut.mutate();
    else createMut.mutate();
  };

  const isPending = createMut.isPending || updateMut.isPending;
  // 可选的父 (排除自己 + 自己的后代)
  const validParents = useMemo(() => {
    if (!editing) return flatList;
    // 简化: 排除自己
    return flatList.filter((t) => t.id !== editing.id);
  }, [flatList, editing]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold">
            {isEdit ? '编辑栏目' : parent ? `添加子栏目: ${parent.name}` : '新建根栏目'}
          </h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <XIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
        <form onSubmit={submit} className="space-y-3 p-5">
          <div className="space-y-1.5">
            <Label htmlFor="tax-name" className="text-xs font-medium">名称 *</Label>
            <Input
              id="tax-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="科技"
              required
              autoFocus
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tax-slug" className="text-xs font-medium">
              Slug * <span className="text-[10px] text-muted-foreground">(URL 用, 小写字母/数字/连字符)</span>
            </Label>
            <Input
              id="tax-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="tech"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              className="h-9 text-sm font-mono"
            />
          </div>
          {!parent && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">父栏目</Label>
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">(根栏目)</option>
                {validParents.map((t) => (
                  <option key={t.id} value={t.id}>
                    {'· '.repeat(t.path.split('/').length - 2) + t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="tax-desc" className="text-xs font-medium">描述</Label>
            <Input
              id="tax-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选"
              className="h-9 text-sm"
            />
          </div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="h-8 text-xs">取消</Button>
            <Button type="submit" disabled={isPending} className="h-8 text-xs">
              {isPending ? '保存中...' : isEdit ? '更新' : '创建'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// === 页面 ===
export function TaxonomiesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Taxonomy | null>(null);
  const [parent, setParent] = useState<Taxonomy | null>(null);

  const { data: site } = useQuery({
    queryKey: ['site', id],
    queryFn: () => sitesApi.get(id!),
    enabled: !!id,
  });

  const { data: tree, isLoading } = useQuery({
    queryKey: ['taxonomies-tree', id],
    queryFn: () => taxonomiesApi.list(id!, { tree: true }),
    enabled: !!id,
  });

  const { data: flat } = useQuery({
    queryKey: ['taxonomies-flat', id],
    queryFn: () => taxonomiesApi.list(id!),
    enabled: !!id,
  });

  const removeMut = useMutation({
    mutationFn: (taxId: string) => taxonomiesApi.remove(id!, taxId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taxonomies-tree', id] });
      queryClient.invalidateQueries({ queryKey: ['taxonomies-flat', id] });
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

  // 权限: 后端 403 兜底, 前端仅 super_admin OR site owner 给写权
  const isOwner = !!currentUser && (currentUser.is_super_admin || currentUser.id === site.owner_id);
  const canWrite = isOwner; // 注: editor 角色需要 site_member 查询, 此页未取, 统一后端 403 兜底

  const treeCount = (tree || []).length;
  const flatCount = (flat || []).length;

  return (
    <div className="px-6 py-6 lg:px-8 lg:py-8 max-w-4xl">
      {/* 头部 */}
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/sites/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
            <FolderTree className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">栏目</h1>
            <p className="text-[11px] text-muted-foreground">
              <Link to={`/sites/${id}`} className="hover:underline">{site.name}</Link>
              <span className="mx-1.5">·</span>
              {flatCount} 个栏目 · {treeCount} 个根
            </p>
          </div>
        </div>
        <div className="ml-auto">
          {isOwner && (
            <Button
              onClick={() => { setEditing(null); setParent(null); setDialogOpen(true); }}
              className="h-8 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              新建根栏目
            </Button>
          )}
        </div>
      </div>

      {/* 树 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">栏目树</CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          {isLoading ? (
            <div className="p-4"><Skeleton className="h-24 w-full" /></div>
          ) : treeCount === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={FolderTree}
                title="还没有栏目"
                description="新建第一个栏目来组织内容"
              />
            </div>
          ) : (
            <div className="space-y-0.5">
              {tree?.map((node) => (
                <TaxonomyNode
                  key={node.id}
                  node={node as unknown as TaxonomyTreeNode}
                  canWrite={isOwner}
                  canDelete={isOwner}
                  onEdit={(t) => { setEditing(t); setParent(null); setDialogOpen(true); }}
                  onAddChild={(p) => { setEditing(null); setParent(p); setDialogOpen(true); }}
                  onDelete={(t) => {
                    if (confirm(`删除栏目 "${t.name}" ?  所有子栏目也会被删除`)) {
                      removeMut.mutate(t.id);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 占位: 内容尚未开发 */}
      <Card className="mt-4">
        <CardContent className="p-5 text-center text-xs text-muted-foreground">
          <FileText className="mx-auto mb-2 h-5 w-5 opacity-30" />
          内容管理正在开发中, 栏目建好后可在 P1.4 中创建内容
        </CardContent>
      </Card>

      <TaxonomyDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); setParent(null); }}
        siteId={id!}
        editing={editing}
        parent={parent}
        flatList={flat || []}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['taxonomies-tree', id] });
          queryClient.invalidateQueries({ queryKey: ['taxonomies-flat', id] });
        }}
      />
    </div>
  );
}
