/**
 * AI Providers 管理页
 * - 列表 (默认高亮)
 * - 新建 (modal)
 * - 删除 (确认)
 */
import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Star, Trash2, Cpu, CheckCircle2, CircleDashed } from 'lucide-react';
import { Card, Button, Input, Label, Badge, EmptyState, Skeleton } from '@/components/ui';
import { Drawer } from '@/components/ui/Drawer';
import { aiApi, type AIProvider } from '@/api/ai';
import { cn } from '@/lib/utils';

export default function AIProviders() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => aiApi.listProviders(),
  });
  const [creating, setCreating] = React.useState(false);

  const del = useMutation({
    mutationFn: (id: string) => aiApi.deleteProvider(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-providers'] }),
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">AI Providers</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">管理 AI 模型接入。一个默认 provider 即可。</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> 新建
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : error ? (
        <Card className="p-4 text-sm text-red-600">加载失败: {String(error)}</Card>
      ) : !data?.length ? (
        <EmptyState
          icon={Cpu}
          title="还没有 Provider"
          description="接入一个 AI 模型才能开始用 AI 协作"
          action={<Button size="sm" onClick={() => setCreating(true)}>新建第一个</Button>}
        />
      ) : (
        <div className="space-y-2">
          {data.map((p) => (
            <ProviderRow key={p.id} provider={p} onDelete={() => del.mutate(p.id)} deleting={del.isPending} />
          ))}
        </div>
      )}

      <CreateProviderDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

const ProviderRow: React.FC<{ provider: AIProvider; onDelete: () => void; deleting: boolean }> = ({ provider, onDelete, deleting }) => (
  <Card className="flex items-center gap-3 p-3">
    <div className={cn(
      'flex h-9 w-9 items-center justify-center rounded-md',
      provider.is_default ? 'bg-blue-100 text-blue-700' : 'bg-secondary text-muted-foreground',
    )}>
      <Cpu className="h-4 w-4" />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium">{provider.name}</span>
        {provider.is_default && (
          <Badge variant="muted" className="text-[10px]">
            <Star className="mr-0.5 h-2.5 w-2.5 fill-current" /> 默认
          </Badge>
        )}
        {provider.is_configured ? (
          <Badge variant="muted" className="text-[10px] text-green-700">
            <CheckCircle2 className="mr-0.5 h-2.5 w-2.5" /> 已配置
          </Badge>
        ) : (
          <Badge variant="muted" className="text-[10px] text-amber-700">
            <CircleDashed className="mr-0.5 h-2.5 w-2.5" /> 未配置 Key
          </Badge>
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {provider.provider} · {provider.model}
        {provider.base_url ? ` · ${provider.base_url}` : ''}
      </p>
    </div>
    <Button size="sm" variant="ghost" onClick={onDelete} disabled={deleting}>
      <Trash2 className="h-3.5 w-3.5 text-red-600" />
    </Button>
  </Card>
);

const CreateProviderDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [provider, setProvider] = React.useState<'openai' | 'anthropic' | 'ollama' | 'minimax' | 'custom'>('openai');
  const [model, setModel] = React.useState('gpt-4o-mini');
  const [apiKey, setApiKey] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [isDefault, setIsDefault] = React.useState(true);

  React.useEffect(() => {
    if (!open) {
      setName(''); setModel('gpt-4o-mini'); setApiKey(''); setBaseUrl(''); setIsDefault(true);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () => aiApi.createProvider({
      name, provider, model,
      api_key: apiKey || undefined,
      base_url: baseUrl || undefined,
      is_default: isDefault,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-providers'] });
      onClose();
    },
  });

  return (
    <Drawer open={open} onClose={onClose} title="新建 Provider" width="w-[420px]">
      <form
        onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
        className="space-y-3 p-4"
      >
        <div>
          <Label className="mb-1 text-xs">名称</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="我的 OpenAI" />
        </div>
        <div>
          <Label className="mb-1 text-xs">类型</Label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as 'openai' | 'anthropic' | 'ollama' | 'minimax' | 'custom')}
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="openai">OpenAI 兼容 (含 minimax)</option>
            <option value="anthropic">Anthropic Claude</option>
            <option value="ollama">Ollama 本地</option>
            <option value="minimax">minimax 专用</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <div>
          <Label className="mb-1 text-xs">模型</Label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} required placeholder="gpt-4o-mini / llama3 / mock" />
        </div>
        {provider === 'openai' && (
          <>
            <div>
              <Label className="mb-1 text-xs">API Key (Fernet 加密存储)</Label>
              <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
            </div>
            <div>
              <Label className="mb-1 text-xs">Base URL (可选, 默认 OpenAI)</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.minimaxi.chat/v1" />
            </div>
          </>
        )}
        {provider === 'ollama' && (
          <div>
            <Label className="mb-1 text-xs">Base URL</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" />
          </div>
        )}
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          设为默认
        </label>
        {create.error && <p className="text-xs text-red-600">创建失败: {String(create.error)}</p>}
        <div className="flex gap-2 pt-2">
          <Button type="submit" size="sm" disabled={create.isPending} className="flex-1">
            {create.isPending ? '创建中...' : '创建'}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>取消</Button>
        </div>
      </form>
    </Drawer>
  );
};
