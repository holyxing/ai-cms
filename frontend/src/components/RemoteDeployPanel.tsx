/**
 * 远程 SSH 部署配置（发布页）
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Server, Plug, Upload, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { deployApi, type DeployServer, type SiteRemoteDeployConfig } from '@/api/deploy';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@/components/ui';

export function RemoteDeployPanel({ siteId }: { siteId: string }) {
  const qc = useQueryClient();
  const serversQ = useQuery({
    queryKey: ['deploy-servers'],
    queryFn: () => deployApi.listServers(),
  });
  const siteCfgQ = useQuery({
    queryKey: ['site-remote-deploy', siteId],
    queryFn: () => deployApi.getSiteConfig(siteId),
    enabled: !!siteId,
  });

  const [enabled, setEnabled] = useState(false);
  const [serverId, setServerId] = useState('');
  const [remotePath, setRemotePath] = useState('');

  // 新建服务器表单
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '生产服务器',
    host: '172.16.17.61',
    port: '22',
    username: 'root',
    auth_type: 'pem' as 'pem' | 'password',
    private_key_path: '/keys/hy-hf-k8s.pem',
    password: '',
    private_key: '',
    remote_base_path: '/var/www/sites',
    is_default: true,
  });

  useEffect(() => {
    const cfg = siteCfgQ.data?.config;
    if (!cfg) return;
    setEnabled(cfg.enabled);
    setServerId(cfg.server_id || '');
    setRemotePath(cfg.remote_path || '');
  }, [siteCfgQ.data]);

  const saveSiteMut = useMutation({
    mutationFn: () =>
      deployApi.updateSiteConfig(siteId, {
        enabled,
        server_id: serverId || null,
        remote_path: remotePath.trim() || null,
      }),
    onSuccess: () => {
      toast.success('远程发布配置已保存');
      qc.invalidateQueries({ queryKey: ['site-remote-deploy', siteId] });
    },
    onError: (e: any) => toast.error(e?.message || '保存失败'),
  });

  const createServerMut = useMutation({
    mutationFn: () =>
      deployApi.createServer({
        name: form.name.trim(),
        host: form.host.trim(),
        port: Number(form.port) || 22,
        username: form.username.trim(),
        auth_type: form.auth_type,
        private_key_path: form.auth_type === 'pem' && form.private_key_path ? form.private_key_path.trim() : undefined,
        private_key: form.auth_type === 'pem' && form.private_key.trim() ? form.private_key.trim() : undefined,
        password: form.auth_type === 'password' ? form.password : undefined,
        remote_base_path: form.remote_base_path.trim() || '/var/www/sites',
        is_default: form.is_default,
      }),
    onSuccess: (s) => {
      toast.success('部署服务器已创建');
      setServerId(s.id);
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['deploy-servers'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || '创建失败'),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => deployApi.testServer(id),
    onSuccess: (r) => (r.ok ? toast.success('SSH 连接成功') : toast.error(r.log || '连接失败')),
    onError: (e: any) => toast.error(e?.message || '测试失败'),
  });

  const syncMut = useMutation({
    mutationFn: () => deployApi.syncNow(siteId, false),
    onSuccess: (r) => {
      if (r.data?.ok) toast.success('远程同步完成');
      else toast.error(r.data?.log?.split('\n').slice(-2).join(' ') || r.message || '同步失败');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || '同步失败'),
  });

  const servers = serversQ.data ?? [];
  const preview = siteCfgQ.data?.remote_path_preview;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Server className="h-4 w-4 text-blue-600" />
          远程发布 (SSH/rsync)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <p className="text-muted-foreground">
          本地构建完成后，通过 rsync 增量同步到远程服务器。支持 PEM 密钥或用户名口令。
        </p>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>发布成功后自动同步到远程</span>
        </label>

        <div className="space-y-1.5">
          <Label className="text-xs">部署服务器</Label>
          <select
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">使用默认服务器</option>
            {servers.map((s: DeployServer) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.username}@{s.host}:{s.port}){s.is_default ? ' [默认]' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">远程目录覆盖（可选）</Label>
          <Input
            value={remotePath}
            onChange={(e) => setRemotePath(e.target.value)}
            placeholder="留空 → {remote_base_path}/{站点slug}/public/"
            className="h-9 text-sm font-mono"
          />
          {preview && <p className="text-[10px] text-muted-foreground">预览: <code>{preview}</code></p>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="h-8 text-xs" onClick={() => saveSiteMut.mutate()} disabled={saveSiteMut.isPending}>
            保存站点配置
          </Button>
          {serverId && (
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => testMut.mutate(serverId)} disabled={testMut.isPending}>
              <Plug className="mr-1 h-3 w-3" /> 测试连接
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => syncMut.mutate()} disabled={syncMut.isPending || !enabled}>
            <RefreshCw className="mr-1 h-3 w-3" /> 立即同步
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setShowForm((v) => !v)}>
            <Upload className="mr-1 h-3 w-3" /> {showForm ? '收起' : '添加服务器'}
          </Button>
        </div>

        {showForm && (
          <div className="rounded-md border bg-secondary/20 p-3 space-y-2">
            <p className="font-medium text-[11px] text-blue-700">新建部署服务器（超级管理员）</p>
            <div className="grid grid-cols-2 gap-2">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="名称" className="h-8 text-xs" />
              <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="主机 IP" className="h-8 text-xs" />
              <Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="端口" className="h-8 text-xs" />
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="用户名" className="h-8 text-xs" />
            </div>
            <select
              value={form.auth_type}
              onChange={(e) => setForm({ ...form, auth_type: e.target.value as 'pem' | 'password' })}
              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
            >
              <option value="pem">PEM 私钥</option>
              <option value="password">用户名 + 口令</option>
            </select>
            {form.auth_type === 'pem' ? (
              <>
                <Input
                  value={form.private_key_path}
                  onChange={(e) => setForm({ ...form, private_key_path: e.target.value })}
                  placeholder="容器内 PEM 路径，如 /keys/hy-hf-k8s.pem"
                  className="h-8 text-xs font-mono"
                />
                <textarea
                  value={form.private_key}
                  onChange={(e) => setForm({ ...form, private_key: e.target.value })}
                  placeholder="或直接粘贴 PEM 内容（优先于路径）"
                  className="min-h-[72px] w-full rounded-md border bg-background p-2 text-[10px] font-mono"
                />
              </>
            ) : (
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="SSH 密码"
                className="h-8 text-xs"
              />
            )}
            <Input
              value={form.remote_base_path}
              onChange={(e) => setForm({ ...form, remote_base_path: e.target.value })}
              placeholder="远程根目录"
              className="h-8 text-xs font-mono"
            />
            <label className="flex items-center gap-2 text-[11px]">
              <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
              设为默认服务器
            </label>
            <Button type="button" size="sm" className="h-8 text-xs" onClick={() => createServerMut.mutate()} disabled={createServerMut.isPending}>
              创建服务器
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
