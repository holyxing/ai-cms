// DomainManagerDialog.tsx - 站点域名管理 (P3.6.5)
// 依据: docs/06-设计系统.md (modal + 紧凑信息密度)
//
// 后端 API 早就有 (P5, sites.py: POST/DELETE /sites/{id}/domains, GET detail 内含 domains[]),
// 之前前端没暴露入口, 列表里"1 个域名"只是装饰. 现在打通.
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Globe, ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, ExternalLink, AlertCircle, CheckCircle2, Pencil, X, Check } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button, Input, Label, Skeleton, EmptyState } from '@/components/ui';
import { sitesApi, type SiteListItem, type SiteDomain } from '@/api/sites';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  site: SiteListItem | null;
  onClose: () => void;
}

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

const TYPE_LABELS: Record<SiteDomain['type'], string> = {
  primary: '主域名',
  alias: '别名',
  preview: '预览',
};

function SslIcon({ status }: { status: SiteDomain['ssl_status'] }) {
  if (status === 'active') return <ShieldCheck className="h-3 w-3 text-emerald-600" strokeWidth={2} />;
  if (status === 'failed') return <ShieldAlert className="h-3 w-3 text-red-600" strokeWidth={2} />;
  return <ShieldQuestion className="h-3 w-3 text-amber-600" strokeWidth={2} />;
}

export function DomainManagerDialog({ open, site, onClose }: Props) {
  const qc = useQueryClient();
  const [newDomain, setNewDomain] = useState('');
  const [newType, setNewType] = useState<SiteDomain['type']>('alias');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDomain, setEditDomain] = useState('');
  const [editType, setEditType] = useState<SiteDomain['type']>('alias');

  // 打开时清空
  useEffect(() => {
    if (open) {
      setNewDomain('');
      setError('');
      setEditingId(null);
    }
  }, [open]);

  // 拉详情拿完整 domains
  const detailQ = useQuery({
    queryKey: ['site', site?.id, 'domains'],
    queryFn: () => sitesApi.get(site!.id),
    enabled: open && !!site,
  });

  const domains: SiteDomain[] = (detailQ.data?.domains ?? []) as SiteDomain[];

  const addMut = useMutation({
    mutationFn: () => sitesApi.addDomain(site!.id, newDomain.trim(), newType),
    onSuccess: (d) => {
      toast.success(`已添加域名 ${d.domain}`);
      setNewDomain('');
      setError('');
      qc.invalidateQueries({ queryKey: ['site', site!.id, 'domains'] });
      qc.invalidateQueries({ queryKey: ['sites'] });  // 刷新列表的 domain_count
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || '添加失败';
      setError(msg);
      toast.error(msg);
    },
  });

  const removeMut = useMutation({
    mutationFn: (domainId: string) => sitesApi.removeDomain(site!.id, domainId),
    onSuccess: () => {
      toast.success('已删除');
      qc.invalidateQueries({ queryKey: ['site', site!.id, 'domains'] });
      qc.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || '删除失败';
      toast.error(msg);
    },
  });

  const updateMut = useMutation({
    mutationFn: (payload: { id: string; domain: string; type: SiteDomain['type'] }) =>
      sitesApi.updateDomain(site!.id, payload.id, { domain: payload.domain, type: payload.type }),
    onSuccess: (d, vars) => {
      toast.success(`已更新为 ${d.domain}`);
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['site', site!.id, 'domains'] });
      qc.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || '更新失败';
      toast.error(msg);
    },
  });

  const beginEdit = (d: SiteDomain) => {
    setEditingId(d.id);
    setEditDomain(d.domain);
    setEditType(d.type);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const commitEdit = () => {
    const v = editDomain.trim().toLowerCase();
    if (!v) {
      toast.error('域名不能为空');
      return;
    }
    if (!DOMAIN_RE.test(v)) {
      toast.error('域名格式: example.com / sub.example.com');
      return;
    }
    if (!editingId) return;
    updateMut.mutate({ id: editingId, domain: v, type: editType });
  };

  const handleAdd = () => {
    const v = newDomain.trim().toLowerCase();
    if (!v) {
      setError('域名不能为空');
      return;
    }
    if (!DOMAIN_RE.test(v)) {
      setError('域名格式: example.com / sub.example.com');
      return;
    }
    setError('');
    addMut.mutate();
  };

  if (!site) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50 text-blue-600">
            <Globe className="h-4 w-4" strokeWidth={2} />
          </div>
          <div>
            <div className="text-sm font-semibold">域名管理 · {site.name}</div>
            <div className="text-[11px] font-normal text-muted-foreground mt-0.5">
              {domains.length > 0
                ? `已绑定 ${domains.length} 个域名`
                : '还未绑定任何域名'}
            </div>
          </div>
        </div>
      }
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        {/* 添加域名 */}
        <div className="rounded-lg border bg-secondary/30 p-3">
          <div className="mb-2 text-xs font-medium">添加新域名</div>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="dm-domain" className="text-[11px] text-muted-foreground">
                域名
              </Label>
              <Input
                id="dm-domain"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value.toLowerCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !addMut.isPending) handleAdd();
                }}
                placeholder="example.com"
                className="h-8 text-[13px] font-mono"
                disabled={addMut.isPending}
              />
            </div>
            <div className="w-28 space-y-1">
              <Label htmlFor="dm-type" className="text-[11px] text-muted-foreground">
                类型
              </Label>
              <select
                id="dm-type"
                value={newType}
                onChange={(e) => setNewType(e.target.value as SiteDomain['type'])}
                disabled={addMut.isPending}
                className="h-8 w-full appearance-none rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="primary">主域名</option>
                <option value="alias">别名</option>
                <option value="preview">预览</option>
              </select>
            </div>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={handleAdd}
              disabled={addMut.isPending || !newDomain.trim()}
            >
              {addMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              添加
            </Button>
          </div>
          {error && (
            <div className="mt-2 flex items-start gap-1.5 rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5 text-[11px] text-red-700">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* 域名列表 */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium">已绑定域名</div>
            {detailQ.isFetching && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>
          {detailQ.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : domains.length === 0 ? (
            <div className="rounded-lg border border-dashed py-6 text-center">
              <Globe className="mx-auto h-6 w-6 text-muted-foreground/40" strokeWidth={1.5} />
              <p className="mt-2 text-[12px] text-muted-foreground">还未绑定任何域名</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">添加后会写入 nginx 站点映射</p>
            </div>
          ) : (
            <ul className="divide-y rounded-lg border bg-background">
              {domains.map((d) => {
                const isEditing = editingId === d.id;
                return (
                  <li
                    key={d.id}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 transition-colors',
                      isEditing ? 'bg-blue-50/40' : 'hover:bg-secondary/30',
                    )}
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary/60">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editDomain}
                            onChange={(e) => setEditDomain(e.target.value.toLowerCase())}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !updateMut.isPending) commitEdit();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            className="h-7 max-w-xs text-[13px] font-mono"
                            autoFocus
                            disabled={updateMut.isPending}
                          />
                          <select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value as SiteDomain['type'])}
                            disabled={updateMut.isPending}
                            className="h-7 appearance-none rounded-md border border-input bg-background px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            <option value="primary">主域名</option>
                            <option value="alias">别名</option>
                            <option value="preview">预览</option>
                          </select>
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <kbd className="rounded border bg-background px-1 font-mono">Enter</kbd> 保存
                            <span>·</span>
                            <kbd className="rounded border bg-background px-1 font-mono">Esc</kbd> 取消
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <code className="truncate text-[13px] font-medium">{d.domain}</code>
                            <span
                              className={cn(
                                'shrink-0 rounded px-1.5 py-px text-[10px] font-medium',
                                d.type === 'primary'
                                  ? 'bg-blue-50 text-blue-700'
                                  : d.type === 'alias'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-amber-50 text-amber-700',
                              )}
                            >
                              {TYPE_LABELS[d.type]}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <SslIcon status={d.ssl_status} />
                              SSL: {d.ssl_status === 'active' ? '已签发' : d.ssl_status === 'failed' ? '失败' : '待验证'}
                            </span>
                            <span>·</span>
                            <span>{new Date(d.created_at).toLocaleDateString('zh-CN')}</span>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={commitEdit}
                            disabled={updateMut.isPending}
                            className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                            title="保存"
                          >
                            {updateMut.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={updateMut.isPending}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                            title="取消"
                          >
                            <X className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                        </>
                      ) : (
                        <>
                          <a
                            href={`http://${d.domain}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            title="新窗口打开"
                          >
                            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
                          </a>
                          <button
                            type="button"
                            onClick={() => beginEdit(d)}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            title="编辑"
                          >
                            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`确认删除域名 ${d.domain} ?`)) {
                                removeMut.mutate(d.id);
                              }
                            }}
                            disabled={removeMut.isPending}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-destructive disabled:opacity-50"
                            title="删除"
                          >
                            {removeMut.isPending && removeMut.variables === d.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 提示 */}
        <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-100 px-2.5 py-1.5 text-[11px] text-blue-800">
          <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
          <div>
            添加 / 删除后, nginx 站点映射会自动重建 (通过 inotify reload).
            DNS 需要指向服务器 IP, SSL 状态由 certbot 定时检测.
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>
    </Modal>
  );
}
