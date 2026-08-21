/**
 * @deprecated P2.9 D1 - 路由已重定向到 /
 * 新位置: ContentLayout (左树状导航) + 栏目内容页 /c/:id
 * 此文件保留作为备份, 不再 import
 */
import { useState, useEffect } from 'react';
import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Globe,
  Archive,
  ArchiveRestore,
  Trash2,
  Pencil,
  X,
  Loader2,
  Eye,
  Rocket,
} from 'lucide-react';
import { toast } from 'sonner';

import { sitesApi, type SiteListItem, type SiteCreatePayload, type SiteUpdatePayload } from '@/api/sites';
import { publishApi } from '@/api/publish';
import { Card, CardContent, Button, Input, Label, Badge, EmptyState, Skeleton, ConfirmDialog, PublishStatusBadge } from '@/components/ui';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { watchDeploymentForNotifications } from '@/lib/notificationsSync';

// === 顶部 ===
function Header({ onNew }: { onNew: () => void }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">站点</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理多站点的基本信息与域名</p>
      </div>
      <Button
        onClick={onNew}
        className="h-8 text-xs"
      >
        <Plus className="h-3.5 w-3.5" />
        新建站点
      </Button>
    </header>
  );
}

// === 过滤栏 ===
function FilterBar({
  q,
  status,
  onChange,
}: {
  q: string;
  status: '' | 'active' | 'archived';
  onChange: (next: { q: string; status: '' | 'active' | 'archived' }) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px] max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => onChange({ q: e.target.value, status })}
          placeholder="搜索名称或 slug"
          className="h-8 pl-8 text-sm"
        />
      </div>
      <div className="flex items-center gap-0 rounded-md border bg-background p-0.5">
        {(['', 'active', 'archived'] as const).map((s) => (
          <button
            key={s || 'all'}
            onClick={() => onChange({ q, status: s })}
            className={cn(
              'h-7 rounded px-2.5 text-[11px] font-medium transition-colors',
              status === s
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {s === '' ? '全部' : s === 'active' ? '活跃' : '归档'}
          </button>
        ))}
      </div>
    </div>
  );
}

// === 表格行 ===
function SiteRow({
  site,
  onDelete,
  onEdit,
  onPublish,
  isPublishing,
}: {
  site: SiteListItem;
  onDelete: (id: string, name: string) => void;
  onEdit: (id: string) => void;
  onPublish: (s: { id: string; name: string; slug: string }) => void;
  isPublishing: boolean;
}) {
  const queryClient = useQueryClient();

  // P5: 查最新一次 success 部署, 判断是否可预览
  const { data: latestSuccess } = useQuery({
    queryKey: ['site-latest-publish', site.id],
    queryFn: () => publishApi.list(site.id, { status: 'success', page_size: 1 }),
    enabled: site.status === 'active',
    staleTime: 30_000,
  });
  const canPreview = !!latestSuccess?.items?.length;

  // P5: 整站发布 — 在父组件统一处理轮询, SiteRow 只触发 onPublish

  const archiveMut = useMutation({
    mutationFn: () => sitesApi.update(site.id, { status: 'archived' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sites'] }),
  });
  const unarchiveMut = useMutation({
    mutationFn: () => sitesApi.update(site.id, { status: 'active' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sites'] }),
  });

  return (
    <tr className="row-hover border-b last:border-b-0">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
            <Globe className="h-4 w-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{site.name}</span>
              {site.status === 'archived' && (
                <Badge variant="muted" className="text-[10px]">归档</Badge>
              )}
              <PublishStatusBadge status={site.publish_status ?? 'never_published'} />
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {site.description || '—'}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <code className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {site.slug}
        </code>
      </td>
      <td className="px-4 py-3 text-[11px] text-muted-foreground">
        {typeof site.domain_count === 'number' ? (
          <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5">
            <Globe className="h-3 w-3" />
            {site.domain_count}
          </span>
        ) : '—'}
      </td>
      <td className="px-4 py-3 text-[11px] text-muted-foreground tabular-nums">
        {new Date(site.created_at).toLocaleDateString('zh-CN')}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          {site.status === 'active' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-blue-600"
              onClick={() => onPublish({ id: site.id, name: site.name, slug: site.slug })}
              disabled={isPublishing}
              title={isPublishing ? '发布中...' : '发布整站'}
            >
              {isPublishing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Rocket className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          {canPreview ? (
            <a
              href={`/sites/${site.slug}/`}
              target="_blank"
              rel="noreferrer"
              title="预览已发布的站点"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-emerald-50 hover:text-emerald-600"
            >
              <Eye className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span
              title="尚未发布或发布中"
              className="inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-md text-muted-foreground/40"
            >
              <Eye className="h-3.5 w-3.5" />
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-blue-600"
            onClick={() => onEdit(site.id)}
            title="修改站点 / 域名"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {site.status === 'active' ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => archiveMut.mutate()}
              disabled={archiveMut.isPending}
              title="归档"
            >
              <Archive className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => unarchiveMut.mutate()}
              disabled={unarchiveMut.isPending}
              title="取消归档"
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-red-600"
            onClick={() => onDelete(site.id, site.name)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

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
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const createMut = useMutation({
    mutationFn: (payload: SiteCreatePayload) => sitesApi.create(payload),
    onSuccess: (site) => {
      setSlug('');
      setName('');
      setDescription('');
      onCreated(site.id);
      onClose();
    },
  });

  if (!open) return null;

  const canSubmit = slug.trim() && name.trim() && !createMut.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background shadow-lg">
        <div className="border-b px-5 py-3">
          <h2 className="text-sm font-semibold">新建站点</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">一个独立的内容站点</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) {
              createMut.mutate({
                slug: slug.trim(),
                name: name.trim(),
                description: description.trim() || undefined,
              });
            }
          }}
          className="space-y-3 p-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="site-slug" className="text-xs font-medium">
              Slug <span className="text-muted-foreground">*</span>
            </Label>
            <Input
              id="site-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="my-blog"
              required
              autoFocus
              className="h-9 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">URL 标识,只能小写字母/数字/连字符</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site-name" className="text-xs font-medium">
              名称 <span className="text-muted-foreground">*</span>
            </Label>
            <Input
              id="site-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="我的博客"
              required
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site-desc" className="text-xs font-medium">
              描述
            </Label>
            <Input
              id="site-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话介绍这个站点"
              className="h-9 text-sm"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="h-8 text-xs">
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit} className="h-8 text-xs">
              {createMut.isPending ? '创建中...' : '创建'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// === 修改对话框 (P5: 改 name/description/logo_url + 管理域名) ===
function EditDialog({
  siteId,
  onClose,
}: {
  siteId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [slug, setSlug] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newDomainType, setNewDomainType] = useState<'primary' | 'alias' | 'preview'>('alias');

  // 加载详情
  const { data: site, isLoading } = useQuery({
    queryKey: ['site', siteId],
    queryFn: () => sitesApi.get(siteId!),
    enabled: !!siteId,
  });

  // 同步表单初值 (详情加载完后)
  React.useEffect(() => {
    if (site) {
      setName(site.name);
      setDescription(site.description ?? '');
      setLogoUrl(site.logo_url ?? '');
      setSlug(site.slug);
    }
  }, [site?.id]);

  const updateMut = useMutation({
    mutationFn: (payload: SiteUpdatePayload) => sitesApi.update(siteId!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      queryClient.invalidateQueries({ queryKey: ['site', siteId] });
      toast.success('已保存');
      onClose();  // P5 bug 修: 保存成功后关闭弹窗
    },
    onError: (e: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message || e.message || '保存失败');
    },
  });

  const addDomainMut = useMutation({
    mutationFn: () => sitesApi.addDomain(siteId!, newDomain.trim(), newDomainType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site', siteId] });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      setNewDomain('');
      toast.success('域名已添加');
    },
    onError: (e: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message || e.message || '添加失败');
    },
  });

  const removeDomainMut = useMutation({
    mutationFn: (domainId: string) => sitesApi.removeDomain(siteId!, domainId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site', siteId] });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      toast.success('域名已删除');
    },
  });

  if (!siteId) return null;

  // P5: slug 客户端预校验 — 同步后端 SLUG_PATTERN
  const isValidSlug = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug.trim());
  const canSave = name.trim() && isValidSlug && !updateMut.isPending;
  const canAddDomain = newDomain.trim() && !addDomainMut.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const payload: SiteUpdatePayload = {
      name: name.trim(),
      description: description.trim() || '',
      logo_url: logoUrl.trim() || null,
    };
    // P5: slug 变化才传 (与原值不同)
    if (site && slug.trim() && slug.trim() !== site.slug) {
      payload.slug = slug.trim();
    }
    updateMut.mutate(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border bg-background shadow-lg">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold">修改站点</h2>
            {site && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                <code className="rounded bg-secondary px-1">{site.slug}</code> · {site.id.slice(0, 8)}…
              </p>
            )}
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {isLoading || !site ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 p-5">
            {/* 基本信息 */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground">基本信息</h3>
              <div className="space-y-1.5">
                <Label htmlFor="edit-site-slug" className="text-xs font-medium">
                  Slug (URL 标识) <span className="text-muted-foreground">*</span>
                </Label>
                <Input
                  id="edit-site-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  required
                  className={`h-9 text-sm font-mono ${slug && !isValidSlug ? 'border-red-400' : ''}`}
                />
                {slug && !isValidSlug ? (
                  <p className="text-[11px] text-red-600">格式错: 只能小写字母/数字/连字符, 首尾必须是字母或数字</p>
                ) : (
                  <p className="text-[11px] text-amber-700">⚠ 改 slug 会重建 nginx 路由, 请确认无引用</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-site-name" className="text-xs font-medium">
                  名称 <span className="text-muted-foreground">*</span>
                </Label>
                <Input
                  id="edit-site-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-site-desc" className="text-xs font-medium">描述</Label>
                <Input
                  id="edit-site-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="一句话介绍"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-site-logo" className="text-xs font-medium">Logo URL</Label>
                <Input
                  id="edit-site-logo"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://…"
                  className="h-9 text-sm"
                />
              </div>
            </section>

            {/* 域名管理 */}
            <section className="space-y-2 border-t pt-4">
              <h3 className="text-xs font-semibold text-muted-foreground">域名 ({site.domains?.length ?? 0})</h3>

              {site.domains && site.domains.length > 0 ? (
                <ul className="space-y-1.5">
                  {site.domains.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded-md border bg-secondary/20 px-2.5 py-1.5 text-[12px]"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Globe className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                        <span className="truncate font-mono">{d.domain}</span>
                        <span className="rounded bg-secondary px-1 text-[10px] text-muted-foreground">
                          {d.type}
                        </span>
                        <span className={`rounded px-1 text-[10px] ${
                          d.ssl_status === 'active'
                            ? 'bg-green-100 text-green-800'
                            : d.ssl_status === 'failed'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {d.ssl_status}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-red-600"
                        onClick={() => removeDomainMut.mutate(d.id)}
                        disabled={removeDomainMut.isPending}
                        title="删除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-md border border-dashed py-3 text-center text-[11px] text-muted-foreground">
                  还没有域名
                </p>
              )}

              {/* 添加域名 */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Input
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value.toLowerCase())}
                  placeholder="example.com"
                  className="h-8 flex-1 min-w-[160px] text-xs"
                />
                <select
                  value={newDomainType}
                  onChange={(e) => setNewDomainType(e.target.value as 'primary' | 'alias' | 'preview')}
                  className="h-8 rounded-md border bg-background px-2 text-xs"
                >
                  <option value="primary">主</option>
                  <option value="alias">别名</option>
                  <option value="preview">预览</option>
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => addDomainMut.mutate()}
                  disabled={!canAddDomain}
                  className="h-8 text-xs"
                >
                  {addDomainMut.isPending ? '添加中…' : '添加'}
                </Button>
              </div>
            </section>

            <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center justify-end gap-2 border-t bg-background px-5 py-3">
              <Button type="button" variant="ghost" onClick={onClose} className="h-8 text-xs">
                关闭
              </Button>
              <Button type="submit" disabled={!canSave} className="h-8 text-xs">
                {updateMut.isPending ? '保存中…' : '保存修改'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// === 列表 ===
export function SitesPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<{ q: string; status: '' | 'active' | 'archived' }>({
    q: '',
    status: '',
  });
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sites', filter, page],
    queryFn: () =>
      sitesApi.list({
        page,
        page_size: 20,
        q: filter.q || undefined,
        status: filter.status || undefined,
      }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => sitesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      setConfirmDelete(null);
    },
  });

  // P5: 整站发布 (含轮询)
  const [publishing, setPublishing] = useState<string | null>(null);  // 正在发布的 site id
  const [confirmPublish, setConfirmPublish] = useState<{ id: string; name: string; slug: string } | null>(null);

  const doPublish = async (siteId: string) => {
    setPublishing(siteId);
    try {
      const accepted = await publishApi.trigger(siteId, { triggered_by: 'manual' });
      const depId = accepted.deployment_id;
      if (!depId) throw new Error('发布任务提交失败');
      watchDeploymentForNotifications(depId);
      for (let i = 0; i < 40; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        const dep = await publishApi.get(depId);
        if (dep.status === 'success') {
          toast.success(`发布成功 · 包含 ${dep.content_count ?? 0} 个内容`);
          break;
        }
        if (dep.status === 'failed' || dep.status === 'cancelled') {
          throw new Error(dep.error_message || `发布${dep.status === 'failed' ? '失败' : '已取消'}`);
        }
        if (i === 39) throw new Error('发布超时, 请在“AI 运行历史”查看详情');
      }
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      // P5 bug 修: 刷新每行 SiteRow 的 'site-latest-publish' query, 让预览按钮变绿
      queryClient.invalidateQueries({ queryKey: ['site-latest-publish', siteId] });
    } catch (e) {
      toast.error((e as Error).message || '发布失败');
    } finally {
      setPublishing(null);
      setConfirmPublish(null);
    }
  };

  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  const isSuperAdmin = user?.is_super_admin;

  return (
    <div className="px-6 py-6 lg:px-8 lg:py-8">
      <Header onNew={() => setCreateOpen(true)} />

      {!isSuperAdmin && (
        <div className="mb-4 rounded-md border border-blue-100 bg-blue-50/50 p-2.5 text-[11px] text-blue-900">
          提示: 只有超级管理员可以创建新站点
        </div>
      )}

      <FilterBar
        q={filter.q}
        status={filter.status}
        onChange={(next) => {
          setFilter(next);
          setPage(1);
        }}
      />

      <Card>
        {isLoading ? (
          <div className="p-5 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Globe}
              title="还没有站点"
              description={isSuperAdmin ? '创建第一个站点开始管理内容' : '请联系超级管理员创建站点'}
              action={
                isSuperAdmin ? (
                  <Button onClick={() => setCreateOpen(true)} className="h-8 text-xs">
                    <Plus className="h-3.5 w-3.5" />
                    新建站点
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">名称</th>
                <th className="px-4 py-2 text-left font-medium">Slug</th>
                <th className="px-4 py-2 text-left font-medium">域名</th>
                <th className="px-4 py-2 text-left font-medium">创建时间</th>
                <th className="px-4 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((site) => (
                <SiteRow
                  key={site.id}
                  site={site}
                  onDelete={(id, name) => setConfirmDelete({ id, name })}
                  onEdit={(id) => setEditId(id)}
                  onPublish={(s) => setConfirmPublish(s)}
                  isPublishing={publishing === site.id}
                />
              ))}
            </tbody>
          </table>
        )}

        {/* 分页 */}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-[11px] text-muted-foreground">
            <span>共 {data.total} 个</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ‹
              </Button>
              <span className="tabular-nums">
                {page} / {Math.max(1, Math.ceil(data.total / data.page_size))}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={page * data.page_size >= data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                ›
              </Button>
            </div>
          </div>
        )}
      </Card>

      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => navigate(`/sites/${id}`)}
      />
      <EditDialog
        siteId={editId}
        onClose={() => setEditId(null)}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteMut.mutate(confirmDelete.id)}
        title="删除站点"
        description={confirmDelete && `站点 “${confirmDelete.name}” 将被移入回收站, 30 天后自动清理。删除后站点不可访问, 可在「回收站」恢复。`}
        confirmText="删除"
        loading={deleteMut.isPending}
      />
      <ConfirmDialog
        open={!!confirmPublish}
        onClose={() => setConfirmPublish(null)}
        onConfirm={() => confirmPublish && doPublish(confirmPublish.id)}
        title="发布整站"
        description={
          <div className="space-y-1.5">
            <p>确认发布站点 “{confirmPublish?.name}”？</p>
            <p className="text-muted-foreground">将拉取所有 status=published 的内容生成静态站点, 并覆盖 <code className="rounded bg-secondary px-1 py-0.5 text-[11px]">/sites/{confirmPublish?.slug}/</code> 下的现有产物。</p>
            <p className="text-[11px] text-muted-foreground">耗时通常 1–3 秒, 请勿重复点击。</p>
          </div>
        }
        confirmText="发布"
        variant="info"
        loading={!!publishing}
      />
    </div>
  );
}
