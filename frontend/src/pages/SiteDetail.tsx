/**
 * @deprecated P2.9 D1 - 路由已重定向到 /
 * 新位置: ContentLayout (左树状导航) + 栏目内容页 /c/:id
 * 此文件保留作为备份, 不再 import
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Globe,
  Plus,
  Trash2,
  Save,
  Loader2,
  ExternalLink,
} from 'lucide-react';

import { sitesApi, type Site, type SiteDomain } from '@/api/sites';
import { useAuthStore } from '@/stores/auth';
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label, Badge, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { Users as UsersIcon, FolderTree, FileText, Image as ImageIcon, Code2 } from 'lucide-react';

// === 状态映射 ===
const DOMAIN_TYPE_LABEL: Record<string, string> = {
  primary: '主域名',
  alias: '别名',
  preview: '预览',
};
const SSL_STATUS_COLOR: Record<string, 'success' | 'warning' | 'muted'> = {
  active: 'success',
  pending: 'warning',
  failed: 'muted',
};
const SSL_STATUS_LABEL: Record<string, string> = {
  active: 'SSL 已签发',
  pending: 'SSL 验证中',
  failed: 'SSL 失败',
};

// === 基本信息卡片 (可编辑) ===

function InfoCard({
  site,
  canEdit,
  onChanged,
}: {
  site: Site;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(site.name);
  const [description, setDescription] = useState(site.description || '');
  const [logoUrl, setLogoUrl] = useState(site.logo_url || '');

  // 同步 server → 本地 (仅在 site id 变化时, 避免编辑中输入被 server 刷新覆盖)
  useEffect(() => {
    setName(site.name);
    setDescription(site.description || '');
    setLogoUrl(site.logo_url || '');
  }, [site.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateMut = useMutation({
    mutationFn: () =>
      sitesApi.update(site.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        logo_url: logoUrl.trim() || undefined,
      }),
    onSuccess: () => {
      onChanged();
      setEditing(false);
    },
  });

  if (!canEdit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">基本信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Field label="名称">{site.name}</Field>
          <Field label="Slug">
            <code className="rounded bg-secondary px-1.5 py-0.5 text-[11px]">
              {site.slug}
            </code>
          </Field>
          <Field label="描述">{site.description || '—'}</Field>
          <Field label="Logo URL">{site.logo_url || '—'}</Field>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">基本信息</CardTitle>
        {!editing && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)}>
            编辑
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) updateMut.mutate();
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="site-name" className="text-xs">名称 *</Label>
              <Input
                id="site-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 text-sm"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site-desc" className="text-xs">描述</Label>
              <Input
                id="site-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site-logo" className="text-xs">Logo URL</Label>
              <Input
                id="site-logo"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://..."
                className="h-9 text-sm"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button type="submit" disabled={!name.trim() || updateMut.isPending} className="h-8 text-xs">
                {updateMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                保存
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => {
                  setName(site.name);
                  setDescription(site.description || '');
                  setLogoUrl(site.logo_url || '');
                  setEditing(false);
                }}
              >
                取消
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3 text-sm">
            <Field label="名称">{site.name}</Field>
            <Field label="Slug">
              <code className="rounded bg-secondary px-1.5 py-0.5 text-[11px]">
                {site.slug}
              </code>
            </Field>
            <Field label="描述">{site.description || '—'}</Field>
            <Field label="Logo URL">{site.logo_url || '—'}</Field>
            <Field label="状态">
              {site.status === 'active' ? (
                <Badge variant="success" className="text-[10px]">活跃</Badge>
              ) : (
                <Badge variant="muted" className="text-[10px]">归档</Badge>
              )}
            </Field>
            <Field label="创建时间">
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {new Date(site.created_at).toLocaleString('zh-CN')}
              </span>
            </Field>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-baseline gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="min-w-0 break-all">{children}</div>
    </div>
  );
}

// === 域名卡片 ===

function DomainCard({
  siteId,
  domains,
  canEdit,
  onChanged,
}: {
  siteId: string;
  domains: SiteDomain[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [newType, setNewType] = useState<'primary' | 'alias' | 'preview'>('alias');

  const addMut = useMutation({
    mutationFn: () => sitesApi.addDomain(siteId, newDomain.trim(), newType),
    onSuccess: () => {
      setNewDomain('');
      setAdding(false);
      onChanged();
    },
  });

  const removeMut = useMutation({
    mutationFn: (domainId: string) => sitesApi.removeDomain(siteId, domainId),
    onSuccess: () => onChanged(),
  });

  const isValidDomain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(
    newDomain.trim().toLowerCase()
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">域名</CardTitle>
        {canEdit && !adding && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" />
            添加
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-1">
        {adding && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (isValidDomain) addMut.mutate();
            }}
            className="mb-2 space-y-2 rounded-md border bg-secondary/30 p-2.5"
          >
            <div className="flex items-center gap-2">
              <Input
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value.toLowerCase())}
                placeholder="example.com"
                autoFocus
                className="h-8 text-sm flex-1"
              />
              <div className="flex rounded-md border bg-background p-0.5">
                {(['primary', 'alias', 'preview'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewType(t)}
                    className={cn(
                      'h-7 rounded px-2 text-[10px] font-medium transition-colors',
                      newType === t ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {DOMAIN_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
            {newDomain && !isValidDomain && (
              <p className="text-[11px] text-red-600">域名格式不正确</p>
            )}
            <div className="flex items-center gap-1.5">
              <Button
                type="submit"
                size="sm"
                disabled={!isValidDomain || addMut.isPending}
                className="h-7 text-xs"
              >
                {addMut.isPending ? '添加中...' : '添加'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setNewDomain('');
                  setAdding(false);
                }}
              >
                取消
              </Button>
            </div>
          </form>
        )}

        {domains.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-muted-foreground">还没有绑定域名</p>
        ) : (
          <ul className="divide-y">
            {domains.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{d.domain}</span>
                    <Badge variant="muted" className="text-[10px]">
                      {DOMAIN_TYPE_LABEL[d.type]}
                    </Badge>
                    <Badge variant={SSL_STATUS_COLOR[d.ssl_status]} className="text-[10px]">
                      {SSL_STATUS_LABEL[d.ssl_status]}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {d.verified_at
                      ? `已验证 · ${new Date(d.verified_at).toLocaleDateString('zh-CN')}`
                      : '未验证'}
                  </div>
                </div>
                <div className="flex items-center gap-0.5">
                  <a
                    href={`https://${d.domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-red-600"
                      onClick={() => {
                        if (confirm(`删除域名 ${d.domain}?`)) removeMut.mutate(d.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// === 危险操作 ===

function DangerCard({
  site,
  canEdit,
  onChanged,
}: {
  site: Site;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const archiveMut = useMutation({
    mutationFn: () => sitesApi.update(site.id, { status: 'archived' }),
    onSuccess: () => onChanged(),
  });
  const unarchiveMut = useMutation({
    mutationFn: () => sitesApi.update(site.id, { status: 'active' }),
    onSuccess: () => onChanged(),
  });
  const deleteMut = useMutation({
    mutationFn: () => sitesApi.delete(site.id),
    onSuccess: () => navigate('/sites'),
  });

  if (!canEdit) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-red-600">危险操作</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {site.status === 'active' ? (
          <button
            onClick={() => {
              if (confirm(`归档站点 "${site.name}"? \n归档后内容仍保留, 但不再公开显示`)) {
                archiveMut.mutate();
              }
            }}
            disabled={archiveMut.isPending}
            className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-left text-xs hover:bg-secondary/50"
          >
            <span>归档站点</span>
            <span className="text-[11px] text-muted-foreground">保留数据, 不公开</span>
          </button>
        ) : (
          <button
            onClick={() => unarchiveMut.mutate()}
            disabled={unarchiveMut.isPending}
            className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-left text-xs hover:bg-secondary/50"
          >
            <span>取消归档</span>
            <span className="text-[11px] text-muted-foreground">恢复为活跃</span>
          </button>
        )}
        <button
          onClick={() => {
            if (
              confirm(
                `删除站点 "${site.name}"?\n\n30 天内可在回收站恢复\n超过 30 天将被永久清理`,
              )
            ) {
              deleteMut.mutate();
            }
          }}
          disabled={deleteMut.isPending}
          className="flex w-full items-center justify-between rounded-md border border-red-200 bg-background px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
        >
          <span>删除站点</span>
          <span className="text-[11px] text-red-500">移到回收站</span>
        </button>
      </CardContent>
    </Card>
  );
}

// === 详情页 ===

export function SiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const { data: site, isLoading } = useQuery({
    queryKey: ['site', id],
    queryFn: () => sitesApi.get(id!),
    enabled: !!id,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['site', id] });

  if (isLoading) {
    return (
      <div className="px-6 py-6 lg:px-8 lg:py-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!site) {
    return (
      <div className="px-6 py-6 lg:px-8 lg:py-8">
        <p className="text-sm text-muted-foreground">站点不存在或已被删除</p>
        <Button variant="link" onClick={() => navigate('/sites')}>
          返回列表
        </Button>
      </div>
    );
  }

  const canEdit = !!(
    currentUser &&
    (currentUser.is_super_admin || currentUser.id === site.owner_id)
  );

  return (
    <div className="px-6 py-6 lg:px-8 lg:py-8 max-w-4xl">
      {/* 头部 */}
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate('/sites')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
            <Globe className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{site.name}</h1>
            <p className="text-[11px] text-muted-foreground">
              <code className="rounded bg-secondary px-1 py-0.5">{site.slug}</code>
              <span className="mx-1.5">·</span>
              <Link to="/sites" className="hover:underline">站点管理</Link>
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {canEdit && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => navigate(`/sites/${site.id}/contents`)}
              >
                <FileText className="h-3.5 w-3.5" />
                内容
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => navigate(`/sites/${site.id}/media`)}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                媒体
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => navigate(`/sites/${site.id}/taxonomies`)}
              >
                <FolderTree className="h-3.5 w-3.5" />
                栏目
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => navigate(`/sites/${site.id}/members`)}
              >
                <UsersIcon className="h-3.5 w-3.5" />
                成员
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <InfoCard site={site} canEdit={canEdit} onChanged={refresh} />
        <DangerCard site={site} canEdit={canEdit} onChanged={refresh} />
      </div>
      <div className="mt-4">
        <CustomCodeCard site={site} canEdit={canEdit} onChanged={refresh} />
      </div>
      <div className="mt-4">
        <DomainCard
          siteId={site.id}
          domains={site.domains || []}
          canEdit={canEdit}
          onChanged={refresh}
        />
      </div>
    </div>
  );
}

// === 站点级 CSS/JS (P3.6.1+) ===
function CustomCodeCard({ site, canEdit, onChanged }: {
  site: Site;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const css0 = (site.settings?.custom_css as string) ?? '';
  const js0 = (site.settings?.custom_js as string) ?? '';
  const [css, setCss] = useState(css0);
  const [js, setJs] = useState(js0);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setCss(css0);
    setJs(js0);
  }, [site.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMut = useMutation({
    mutationFn: () => sitesApi.update(site.id, {
      settings: { ...(site.settings || {}), custom_css: css, custom_js: js },
    }),
    onSuccess: () => {
      onChanged();
      setEditing(false);
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Code2 className="h-3.5 w-3.5" />
          站点代码 (CSS / JS)
        </CardTitle>
        {canEdit && !editing && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)}>
            编辑
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {editing ? (
          <form
            onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }}
            className="space-y-3"
          >
            <div>
              <Label className="text-xs">自定义 CSS (注入到 &lt;head&gt;)</Label>
              <textarea
                value={css}
                onChange={(e) => setCss(e.target.value)}
                rows={6}
                placeholder="/* 例: */&#10;.site-header { background: #2563eb; }"
                className="mt-1 w-full rounded border bg-background px-2 py-1.5 font-mono text-[12px]"
                spellCheck={false}
              />
            </div>
            <div>
              <Label className="text-xs">自定义 JS (注入到 &lt;/body&gt; 前)</Label>
              <textarea
                value={js}
                onChange={(e) => setJs(e.target.value)}
                rows={6}
                placeholder="// 例:&#10;console.log('hello from site custom js');"
                className="mt-1 w-full rounded border bg-background px-2 py-1.5 font-mono text-[12px]"
                spellCheck={false}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={saveMut.isPending} className="h-8 text-xs">
                {saveMut.isPending ? '保存中...' : '保存'}
              </Button>
              <Button type="button" variant="ghost" className="h-8 text-xs" onClick={() => { setEditing(false); setCss(css0); setJs(js0); }}>取消</Button>
              <span className="ml-auto text-[11px] text-muted-foreground">需要重新发布才能生效</span>
            </div>
          </form>
        ) : (
          <div className="space-y-2">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">CSS</div>
              {css ? (
                <pre className="mt-1 max-h-32 overflow-auto rounded bg-secondary/50 p-2 font-mono text-[11px]">{css}</pre>
              ) : (
                <div className="mt-1 italic text-muted-foreground">未设置</div>
              )}
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">JS</div>
              {js ? (
                <pre className="mt-1 max-h-32 overflow-auto rounded bg-secondary/50 p-2 font-mono text-[11px]">{js}</pre>
              ) : (
                <div className="mt-1 italic text-muted-foreground">未设置</div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
