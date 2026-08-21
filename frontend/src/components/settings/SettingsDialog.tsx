/**
 * SettingsDialog - 大对话框式设置中心 (P3.6.2)
 *
 * 布局: 左右两栏
 *   左 240px: 分类导航
 *   右: 对应面板
 *
 * 分类:
 *   - 个人 (个人信息 / 密码)
 *   - 外观 (主题色 / 密度 / 字号)
 *   - AI 模型 (大模型接入, provider + API key + 模型选择 + 测试)
 *   - 系统管理 (用户/角色/权限)  - super admin 可见
 *   - 快捷键
 *   - 关于
 */
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, User, Palette, Cpu, ShieldCheck, Keyboard, Info, Lock,
  Sun, Moon, Monitor, Check, Eye, EyeOff, KeyRound, QrCode,
  Sparkles, Send, Loader2, AlertCircle, CheckCircle2, Users, XCircle, Copy,
  ChevronRight, FileText,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button, Input, Label, Card, CardContent, Badge, ConfirmDialog } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { useAppearanceStore } from '@/stores/appearance';
import { aiApi, type AIProvider } from '@/api/ai';
import { authApi } from '@/api/auth';
import { toast } from 'sonner';
import { rbacApi } from '@/api/rbac';
import { PromptsPanel } from '@/components/settings/PromptsPanel';

type SettingsTab = 'profile' | 'appearance' | 'ai' | 'prompts' | 'security' | 'system' | 'shortcuts' | 'about';

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

export function SettingsDialog({ open, onClose, initialTab = 'profile' }: SettingsDialogProps) {
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const isSuperAdmin = user?.is_super_admin;

  const tabs: { key: SettingsTab; label: string; icon: any; adminOnly?: boolean }[] = [
    { key: 'profile',   label: '个人',     icon: User },
    { key: 'appearance', label: '外观',    icon: Palette },
    { key: 'ai',        label: 'AI 模型', icon: Cpu },
    { key: 'prompts',   label: 'AI 提示词', icon: FileText },
    { key: 'security',  label: '安全',     icon: Lock },
    { key: 'system',    label: '系统管理', icon: ShieldCheck, adminOnly: true },
    { key: 'shortcuts', label: '快捷键',   icon: Keyboard },
    { key: 'about',     label: '关于',     icon: Info },
  ];

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-5xl" className="overflow-hidden p-0">
      <div className="flex h-[80vh] max-h-[720px]">
        {/* === 左侧: 分类导航 240px === */}
        <aside className="w-60 flex-shrink-0 border-r bg-secondary/30 flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3.5 border-b">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-[13px] font-semibold">设置</div>
              <div className="text-[10px] text-muted-foreground">个人偏好 & 系统配置</div>
            </div>
          </div>
          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
            {tabs.filter((t) => !t.adminOnly || isSuperAdmin).map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors text-left',
                    active
                      ? 'bg-card text-primary font-medium shadow-sm ring-1 ring-primary/20'
                      : 'text-foreground/80 hover:bg-accent',
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', active ? 'text-primary' : 'text-muted-foreground')} strokeWidth={2} />
                  <span className="flex-1">{t.label}</span>
                  {active && <ChevronRight className="h-3 w-3 text-primary" />}
                </button>
              );
            })}
          </nav>
          <div className="border-t p-3 text-[10px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>v0.6.2 P3.6.2</span>
              <span>{user?.email}</span>
            </div>
          </div>
        </aside>

        {/* === 右侧: 内容区 === */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* 头部 */}
          <div className="flex items-center justify-between border-b px-5 py-3 flex-shrink-0">
            <div>
              <h2 className="text-[15px] font-semibold">
                {tabs.find((t) => t.key === tab)?.label}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {tab === 'profile'   && '管理你的个人信息、显示名称和密码'}
                {tab === 'appearance' && '界面密度、主题色与排版偏好'}
                {tab === 'ai'        && '配置 AI 大模型接入、API Key 与默认模型'}
                {tab === 'prompts'   && '统一管理快捷操作 / 任务 / 增强 Prompt，支持导出导入'}
                {tab === 'security'  && '两步验证 (2FA) 与账号安全'}
                {tab === 'system'    && '用户、角色与权限管理 (仅 Super Admin 可见)'}
                {tab === 'shortcuts' && '常用操作的键盘快捷键'}
                {tab === 'about'     && '版本信息、技术栈与致谢'}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onClose}
              title="关闭 (Esc)"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* 内容滚动区 */}
          <div className="flex-1 overflow-y-auto p-5">
            {tab === 'profile'   && <ProfilePanel user={user} onClose={onClose} />}
            {tab === 'appearance' && <AppearancePanel />}
            {tab === 'ai'        && <AiPanel />}
            {tab === 'prompts'   && <PromptsPanel />}
            {tab === 'security'  && <SecurityPanel />}
            {tab === 'system'    && isSuperAdmin && <SystemPanel />}
            {tab === 'shortcuts' && <ShortcutsPanel />}
            {tab === 'about'     && <AboutPanel />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// =====================================================================
// 个人
// =====================================================================
function ProfilePanel({ user, onClose }: { user: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(user?.name || '');
  const updateMut = useMutation({
    mutationFn: (body: { name?: string; password?: string }) =>
      rbacApi.updateUser(user.id, body),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      // 同步 auth store
      useAuthStore.setState({ user: { ...user, name: u.name } });
      toast.success('已保存');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '保存失败'),
  });
  const [email] = useState(user?.email || '');
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  return (
    <div className="space-y-5 max-w-2xl">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-[13px] font-medium">基本信息</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[11px] text-muted-foreground">显示名称</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-[12.5px] mt-1"
                placeholder="你的显示名"
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">邮箱 (不可改)</Label>
              <Input
                value={email}
                readOnly
                className="h-8 text-[12.5px] mt-1 bg-secondary/40 cursor-not-allowed"
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">角色</Label>
              <div className="mt-1.5 flex items-center gap-1.5">
                {user?.is_super_admin && (
                  <Badge className="text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-100">Super Admin</Badge>
                )}
                {user?.roles?.map((r: string) => (
                  <Badge key={r} variant="muted" className="text-[10px]">{r}</Badge>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">用户 ID</Label>
              <Input
                value={user?.id || ''}
                readOnly
                className="h-8 text-[12.5px] mt-1 bg-secondary/40 cursor-not-allowed font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => updateMut.mutate({ name })}
              disabled={updateMut.isPending || name === user?.name}
            >
              {updateMut.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />保存中…</>
              ) : (
                <><Check className="h-3.5 w-3.5" />保存</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-[13px] font-medium">修改密码</h3>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">旧密码</Label>
            <div className="relative mt-1">
              <Input
                type={showPwd ? 'text' : 'password'}
                value={oldPwd}
                onChange={(e) => setOldPwd(e.target.value)}
                className="h-8 text-[12.5px] pr-9"
                placeholder="••••••"
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">新密码 (至少 8 位)</Label>
            <Input
              type={showPwd ? 'text' : 'password'}
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              className="h-8 text-[12.5px] mt-1"
              placeholder="••••••"
            />
          </div>
          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!oldPwd || newPwd.length < 8}
              onClick={() => {
                updateMut.mutate({ password: newPwd }, {
                  onSuccess: () => { setOldPwd(''); setNewPwd(''); toast.success('密码已更新'); },
                });
              }}
            >
              更新密码
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// =====================================================================
// 外观
// =====================================================================
function AppearancePanel() {
  const density = useAppearanceStore((s) => s.density);
  const accent = useAppearanceStore((s) => s.accent);
  const fontScale = useAppearanceStore((s) => s.fontScale);
  const darkMode = useAppearanceStore((s) => s.darkMode);
  const setDensity = useAppearanceStore((s) => s.setDensity);
  const setAccent = useAppearanceStore((s) => s.setAccent);
  const setFontScale = useAppearanceStore((s) => s.setFontScale);
  const setDarkMode = useAppearanceStore((s) => s.setDarkMode);
  const reset = useAppearanceStore((s) => s.reset);
  return (
    <div className="space-y-5 max-w-2xl">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-[13px] font-medium">主题模式</h3>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([
              { k: 'light',  label: '浅色',   icon: Sun },
              { k: 'dark',   label: '深色',   icon: Moon },
              { k: 'system', label: '跟随系统', icon: Monitor },
            ] as const).map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.k}
                  onClick={() => setDarkMode(m.k as any)}
                  className={cn(
                    'rounded-md border p-2.5 text-left text-[11.5px] transition-colors',
                    darkMode === m.k
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'hover:border-primary/30',
                  )}
                >
                  <div className="flex items-center gap-1.5 font-medium">
                    <Icon className="h-3 w-3" />
                    {m.label}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Palette className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-[13px] font-medium">界面密度</h3>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(['compact', 'normal', 'comfortable'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDensity(d)}
                className={cn(
                  'rounded-md border p-2.5 text-left text-[11.5px] transition-colors',
                  density === d ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'hover:border-primary/30',
                )}
              >
                <div className="font-medium">
                  {d === 'compact' ? '紧凑' : d === 'normal' ? '标准' : '宽松'}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {d === 'compact' ? '信息密度最大' : d === 'normal' ? '平衡' : '阅读舒适'}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Palette className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-[13px] font-medium">主色</h3>
            <span className="text-[10px] text-muted-foreground ml-1">实时生效</span>
          </div>
          <div className="flex items-center gap-2.5">
            {([
              { k: 'blue',   c: 'bg-blue-500',     label: '科技蓝' },
              { k: 'green',  c: 'bg-emerald-500',  label: '森林绿' },
              { k: 'purple', c: 'bg-violet-500',   label: '紫罗兰' },
              { k: 'orange', c: 'bg-orange-500',   label: '暖橙' },
            ] as const).map((a) => (
              <button
                key={a.k}
                onClick={() => setAccent(a.k)}
                className="group flex flex-col items-center gap-1"
                title={a.label}
              >
                <span className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full ring-2 ring-offset-2 transition-all',
                  a.c,
                  accent === a.k ? 'ring-foreground' : 'ring-transparent group-hover:ring-muted',
                )}>
                  {accent === a.k && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
                </span>
                <span className="text-[10px] text-muted-foreground">{a.label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Palette className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-[13px] font-medium">字号</h3>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([
              { k: 'sm', label: '小',   sub: '14px' },
              { k: 'md', label: '标准', sub: '15px' },
              { k: 'lg', label: '大',   sub: '16.5px' },
            ] as const).map((f) => (
              <button
                key={f.k}
                onClick={() => setFontScale(f.k)}
                className={cn(
                  'rounded-md border py-2 text-center transition-colors',
                  fontScale === f.k ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'hover:border-primary/30',
                )}
              >
                <div className={cn('font-medium', f.k === 'sm' && 'text-[12px]', f.k === 'md' && 'text-[13px]', f.k === 'lg' && 'text-[14.5px]')}>
                  {f.label}
                </div>
                <div className="text-[10px] text-muted-foreground">{f.sub}</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="h-7 text-[11px] text-muted-foreground" onClick={reset}>
          恢复默认外观
        </Button>
      </div>
    </div>
  );
}

// =====================================================================
// AI 模型 (P3.6.2 重点)
// =====================================================================
const PROVIDER_PRESETS = [
  { k: 'minimax',   label: 'MiniMax',   desc: '推荐 · 国内直连',  base: 'https://api.minimax.chat/v1', models: ['minimax-portal/MiniMax-M3', 'minimax-portal/MiniMax-M2.7-highspeed'] },
  { k: 'openai',    label: 'OpenAI',    desc: 'GPT-4o / GPT-5',     base: 'https://api.openai.com/v1',   models: ['gpt-4o', 'gpt-4o-mini', 'o1-preview'] },
  { k: 'anthropic', label: 'Anthropic', desc: 'Claude 3.5 Sonnet',  base: 'https://api.anthropic.com/v1',models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'] },
  { k: 'ollama',    label: 'Ollama',    desc: '本地 LLM',         base: 'http://localhost:11434/v1',   models: ['qwen2.5:7b', 'llama3.1:8b', 'deepseek-r1:7b'] },
] as const;

function AiPanel() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['ai-providers'], queryFn: () => aiApi.listProviders() });
  // P3.9.1+ in-app dialog (holy 反馈 #11266)
  const [permDeleteOpen, setPermDeleteOpen] = useState(false);
  const [permDeleteTarget, setPermDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const delMut = useMutation({
    mutationFn: (id: string) => aiApi.deleteProvider(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-providers'] }); toast.success('已删除'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || '删除失败'),
  });
  const createMut = useMutation({
    mutationFn: aiApi.createProvider,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-providers'] });
      setApiKey('');
      toast.success('已保存到服务端');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '保存失败'),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => aiApi.updateProvider(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-providers'] });
      setApiKey('');
      setEditingId(null);
      toast.success('已更新');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '更新失败'),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>('minimax');
  const [name, setName] = useState('default');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState('https://api.minimax.chat/v1');
  const [model, setModel] = useState('minimax-portal/MiniMax-M3');
  const [isDefault, setIsDefault] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string; latency?: number } | null>(null);

  const cur = PROVIDER_PRESETS.find((p) => p.k === provider)!;

  /** 点已配置卡片 → 加载进表单 */
  const loadToForm = (p: AIProvider) => {
    setEditingId(p.id);
    setProvider(p.provider);
    setName(p.name);
    setBaseUrl(p.base_url || '');
    setModel(p.model);
    setIsDefault(p.is_default);
    setApiKey('');  // 不预填 key (安全 + 留空 = 不动)
    setTestResult(null);
    // 滚到表单
    document.getElementById('ai-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const resetForm = () => {
    setEditingId(null);
    setProvider('minimax');
    setName('default');
    setApiKey('');
    setBaseUrl(PROVIDER_PRESETS[0].base);
    setModel(PROVIDER_PRESETS[0].models[0]);
    setIsDefault(false);
    setTestResult(null);
  };

  useEffect(() => {
    setBaseUrl(cur.base);
    if (!cur.models.includes(model as any)) setModel(cur.models[0]);
  }, [provider]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleTest = async () => {
    if (!apiKey && provider !== 'ollama') {
      setTestResult({ ok: false, msg: '请先填写 API Key' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    const t0 = Date.now();
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 4, temperature: 0 }),
      });
      const latency = Date.now() - t0;
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        let msg = `HTTP ${res.status}`;
        try { const j = JSON.parse(errText); msg = j?.error?.message || j?.message || msg; }
        catch { msg = errText.slice(0, 200) || msg; }
        setTestResult({ ok: false, msg, latency });
      } else {
        const j = await res.json();
        const reply = j?.choices?.[0]?.message?.content || '(空响应, 但连接成功)';
        setTestResult({ ok: true, msg: `模型返回: "${reply}"`, latency });
      }
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.message || '网络错误 (CORS / 代理 / base URL 不对?)' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const body: any = {
      name,
      provider: provider as any,
      model,
      base_url: baseUrl,
      is_default: isDefault,
    };
    if (apiKey) body.api_key = apiKey;  // 留空不更新 key
    if (editingId) {
      updateMut.mutate({ id: editingId, body });
    } else {
      createMut.mutate(body);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      {/* 已配置的 providers */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-[13px] font-medium">已配置的服务商</h3>
              <Badge variant="muted" className="text-[9.5px]">{list.data?.length ?? 0}</Badge>
            </div>
          </div>
          {list.isLoading ? (
            <div className="text-[11.5px] text-muted-foreground py-2">加载中…</div>
          ) : (list.data?.length ?? 0) === 0 ? (
            <div className="rounded-md border border-dashed py-4 text-center text-[11.5px] text-muted-foreground">
              还没有配置。在下面表单中填入 API Key 后点保存。
            </div>
          ) : (
            <div className="space-y-1.5">
              {list.data!.map((p: AIProvider) => (
                <div
                  key={p.id}
                  className={cn(
                    'group flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 transition-colors',
                    editingId === p.id ? 'border-primary ring-1 ring-primary/20' : 'hover:border-primary/40',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => loadToForm(p)}
                    className="flex flex-1 items-center gap-2 min-w-0 text-left"
                  >
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary text-[9.5px] font-bold">
                      {p.provider.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-medium truncate">{p.name}</span>
                        {p.is_default && (
                          <Badge className="text-[9.5px] bg-blue-100 text-blue-700 hover:bg-blue-100">默认</Badge>
                        )}
                        {p.is_configured ? (
                          <Badge variant="muted" className="text-[9.5px]">已配 key</Badge>
                        ) : (
                          <Badge className="text-[9.5px] bg-amber-100 text-amber-700 hover:bg-amber-100">未配 key</Badge>
                        )}
                      </div>
                      <div className="text-[10.5px] text-muted-foreground font-mono truncate">{p.model}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPermDeleteTarget({ id: p.id, name: p.name }); setPermDeleteOpen(true); }}
                    className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    title="删除"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 新增 / 覆盖 Provider */}
      <Card id="ai-form-card">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-[13px] font-medium">
                {editingId ? '编辑服务商' : '添加新服务商'}
              </h3>
            </div>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-[10.5px] text-muted-foreground hover:text-foreground"
              >
                取消编辑
              </button>
            )}
          </div>

          {/* Provider 选择 */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PROVIDER_PRESETS.map((p) => (
              <button
                key={p.k}
                onClick={() => setProvider(p.k)}
                className={cn(
                  'rounded-md border p-2.5 text-left transition-colors',
                  provider === p.k
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                    : 'hover:border-primary/30',
                )}
              >
                <div className="text-[12px] font-medium">{p.label}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{p.desc}</div>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[11px] text-muted-foreground">名称 (便于区分多个同名 provider)</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-[12.5px] mt-1"
                placeholder="default"
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">模型</Label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {cur.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">
              API Key {provider === 'ollama' && <span className="text-muted-foreground/60">(本地可留空)</span>}
            </Label>
            <div className="relative mt-1">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="h-8 text-[12.5px] pr-9 font-mono"
                placeholder={provider === 'ollama' ? '(留空)' : 'sk-...'}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Base URL</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="h-8 text-[12.5px] mt-1 font-mono"
              placeholder={cur.base}
            />
          </div>
          <label className="flex items-center gap-2 text-[11.5px] cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded border-slate-300 text-primary focus:ring-primary"
            />
            <span>设为默认服务商 (AI 任务使用)</span>
          </label>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleTest} disabled={testing}>
              {testing ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" />测试中…</>)
                       : (<><Send className="h-3.5 w-3.5" />测试连接</>)}
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={(createMut.isPending || updateMut.isPending) || !name || !model}>
              {(createMut.isPending || updateMut.isPending) ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />保存中…</>
              ) : (
                <><Check className="h-3.5 w-3.5" />{editingId ? '更新' : '保存到服务端'}</>
              )}
            </Button>
          </div>
          {testResult && (
            <div className={cn(
              'flex items-start gap-2 rounded-md px-3 py-2 text-[11.5px]',
              testResult.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900',
            )}>
              {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                             : <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />}
              <div>
                <div className="font-medium">{testResult.ok ? '连接成功' : '连接失败'}{testResult.latency ? ` (${testResult.latency}ms)` : ''}</div>
                <div className="text-[10.5px] mt-0.5 opacity-80">{testResult.msg}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-[13px] font-medium">使用范围</h3>
          </div>
          <ul className="text-[11.5px] text-muted-foreground space-y-1.5">
            <li>• <b>AI 写文章</b>: 用模型根据标题/大纲生成正文</li>
            <li>• <b>AI 改主题</b>: 用模型调整主题色/字体 (改 tokens, 不改 HTML)</li>
            <li>• <b>AI 提纲</b>: 根据主题生成文章大纲</li>
            <li>• <b>AI SEO</b>: 生成 meta description / keywords</li>
          </ul>
          <div className="rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[10.5px] text-amber-900 leading-relaxed mt-2">
            <b>浏览器 CORS 提示</b>: "测试连接" 会从浏览器直接调 provider, 需要 provider 允许 CORS。OpenAI 允许, Anthropic 拒绝 (走服务端 AI 任务不受影响), Ollama 需在启动时设 <code className="rounded bg-amber-100/60 px-0.5 font-mono">OLLAMA_ORIGINS=*</code>。
          </div>
          <p className="text-[10.5px] text-muted-foreground/80 pt-2">
            配置会保存到服务端, 跨设备同步。多个用户可各自配置自己的默认服务商。
          </p>
        </CardContent>
      </Card>

      {/* P3.9.1+ in-app dialog (holy 反馈 #11266) */}
      <ConfirmDialog
        open={permDeleteOpen}
        onClose={() => { setPermDeleteOpen(false); setPermDeleteTarget(null); }}
        onConfirm={() => { if (permDeleteTarget) delMut.mutate(permDeleteTarget.id); setPermDeleteOpen(false); setPermDeleteTarget(null); }}
        title="删除 AI 服务商"
        description={permDeleteTarget ? `确认删除 “${permDeleteTarget.name}”? 此操作不可撤销。` : ''}
        confirmText="删除"
        variant="danger"
        loading={delMut.isPending}
      />
    </div>
  );
}

// =====================================================================
// 系统管理 (super admin)
// =====================================================================
function SystemPanel() {
  return (
    <div className="space-y-3 max-w-2xl">
      <div className="rounded-md border bg-amber-50 px-3.5 py-2.5 text-[11.5px] text-amber-900 flex items-start gap-2">
        <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        <span>仅 <b>Super Admin</b> 可见。系统管理页面是独立路由,这里提供快捷入口。</span>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-3">
        {[
          { to: '/users',        title: '用户管理', desc: '增删改用户 · 站点分配',  icon: Users,        badge: 'Users' },
          { to: '/roles',        title: '角色管理', desc: '自定义角色 · 权限绑定',  icon: ShieldCheck,  badge: 'Roles' },
          { to: '/permissions',  title: '权限管理', desc: '60+ 细粒度权限项',       icon: KeyRound,     badge: 'Perms' },
        ].map((m) => {
          const Icon = m.icon;
          return (
            <Link
              key={m.to}
              to={m.to}
              className="group rounded-lg border bg-card p-3.5 transition-colors hover:border-primary/40 hover:shadow-sm"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary group-hover:bg-primary/15">
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <Badge variant="muted" className="text-[9.5px]">{m.badge}</Badge>
              </div>
              <div className="text-[13px] font-medium">{m.title}</div>
              <div className="text-[10.5px] text-muted-foreground mt-0.5">{m.desc}</div>
              <div className="mt-2 flex items-center text-[10.5px] text-primary group-hover:underline">
                打开页面 <ChevronRight className="h-3 w-3" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// 快捷键
// =====================================================================
// =====================================================================
// 安全 (P5.4 2FA)
// =====================================================================
function SecurityPanel() {
  const queryClient = useQueryClient();
  const [setupStep, setSetupStep] = useState<'idle' | 'scanning' | 'verify' | 'recovery' | 'done'>('idle');
  const [secret, setSecret] = useState('');
  const [provisioningUri, setProvisioningUri] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState('');
  const [disableInput, setDisableInput] = useState('');
  const [disableMode, setDisableMode] = useState<'code' | 'password'>('code');
  const [showDisableDialog, setShowDisableDialog] = useState(false);

  // 查询当前 2FA 状态
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['2fa-status'],
    queryFn: authApi.get2FAStatus,
    staleTime: 30_000,
  });

  // Setup mutation
  const setupMut = useMutation({
    mutationFn: authApi.setup2FA,
    onSuccess: (data) => {
      setSecret(data.secret);
      setProvisioningUri(data.provisioning_uri);
      setRecoveryCodes(data.recovery_codes);
      setSetupStep('verify');
    },
  });

  // Verify setup mutation
  const verifySetupMut = useMutation({
    mutationFn: authApi.verify2FASetup,
    onSuccess: () => {
      setSetupStep('recovery');
      queryClient.invalidateQueries({ queryKey: ['2fa-status'] });
    },
  });

  // Disable mutation
  const disableMut = useMutation({
    mutationFn: authApi.disable2FA,
    onSuccess: () => {
      setShowDisableDialog(false);
      setDisableInput('');
      queryClient.invalidateQueries({ queryKey: ['2fa-status'] });
      toast.success('2FA 已禁用');
    },
  });

  // Regenerate recovery codes
  const regenMut = useMutation({
    mutationFn: authApi.regenerateRecoveryCodes,
    onSuccess: (data) => {
      setRecoveryCodes(data.recovery_codes);
      toast.success('Recovery codes 已重生成');
    },
  });

  const handleStartSetup = () => {
    setSetupStep('scanning');
    setupMut.mutate();
  };

  const handleVerifySetup = () => {
    if (!/^\d{6}$/.test(verifyCode)) {
      toast.error('请输入 6 位数字码');
      return;
    }
    verifySetupMut.mutate(verifyCode);
  };

  const handleDisable = () => {
    disableMut.mutate(disableMode === 'code' ? { code: disableInput } : { password: disableInput });
  };

  // 复制到剪贴板
  const copyRecoveryCodes = () => {
    navigator.clipboard.writeText(recoveryCodes.join('\n'));
    toast.success(`已复制 ${recoveryCodes.length} 个 recovery code`);
  };

  // === 渲染 ===

  if (statusLoading) {
    return (
      <div className="space-y-4 max-w-2xl">
        <Card><CardContent className="p-4"><Loader2 className="h-4 w-4 animate-spin" /></CardContent></Card>
      </div>
    );
  }

  // Setup 流程 (只要 setupStep 不在 idle, 就走 setup 分支 — 即使 status.is_enabled 已是 true)
  if (setupStep !== 'idle') {
    return (
      <div className="space-y-4 max-w-2xl">
        {setupStep === 'scanning' && (
          <Card><CardContent className="p-6 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
            <p className="text-sm text-muted-foreground">正在生成密钥...</p>
          </CardContent></Card>
        )}

        {setupStep === 'verify' && (
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <QrCode className="h-4 w-4 text-primary" />
                <h3 className="text-[13px] font-semibold">步骤 1/2: 扫码并输入 6 位码</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                用 Google Authenticator / 1Password / Microsoft Authenticator 等 app 扫描下方 QR code (或手动输入密钥).
              </p>

              {/* QR Code - 渲染为可扫描的 SVG (使用 API 动态生成或纯客户端 lib) */}
              <div className="flex items-start gap-4 p-3 bg-secondary/30 rounded-md">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(provisioningUri)}`}
                  alt="2FA QR Code"
                  className="h-[140px] w-[140px] rounded border bg-white p-1"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="flex-1 space-y-2 min-w-0">
                  <div className="text-[11px] text-muted-foreground">手动输入密钥 (如果不能扫码):</div>
                  <code className="block break-all rounded bg-background border px-2 py-1.5 text-xs font-mono select-all">
                    {secret}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(secret);
                      toast.success('已复制密钥');
                    }}
                  >
                    <Copy className="mr-1.5 h-3 w-3" />
                    复制密钥
                  </Button>
                </div>
              </div>

              {/* 6 位码输入 */}
              <div className="space-y-1.5">
                <Label className="text-xs">输入 app 显示的 6 位码</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center text-lg tracking-widest font-mono"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={() => setSetupStep('idle')}>取消</Button>
                <Button onClick={handleVerifySetup} disabled={verifySetupMut.isPending}>
                  {verifySetupMut.isPending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                  验证并启用
                </Button>
              </div>

              {verifySetupMut.isError && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  验证码错误, 请重新输入
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {setupStep === 'recovery' && (
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <KeyRound className="h-4 w-4 text-primary" />
                <h3 className="text-[13px] font-semibold">步骤 2/2: 保存 Recovery Codes</h3>
              </div>
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <div>
                    <strong>请立即保存这些 recovery codes.</strong> 丢失手机或 authenticator app 后, 这是唯一登录方式. 每个 code 只能用一次.
                  </div>
                </div>
              </div>

              <div className="rounded-md border bg-secondary/30 p-3 font-mono text-[12px] space-y-1">
                {recoveryCodes.map((c, i) => (
                  <div key={i} className="px-2 py-0.5 hover:bg-background rounded">
                    <span className="text-muted-foreground mr-2">{i + 1}.</span>{c}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={copyRecoveryCodes}>
                  <Copy className="mr-1.5 h-3 w-3" />
                  复制全部
                </Button>
                <Button onClick={() => { setSetupStep('idle'); setVerifyCode(''); toast.success('2FA 已成功启用'); }}>
                  已保存, 完成
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // 主界面 (启用 / 未启用状态)
  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-primary" />
              <div>
                <h3 className="text-[13px] font-medium">两步验证 (2FA)</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  使用 authenticator app (Google / 1Password / Microsoft) 生成动态验证码
                </p>
              </div>
            </div>
            {status?.is_enabled ? (
              <Badge variant="success">已启用</Badge>
            ) : (
              <Badge variant="secondary">未启用</Badge>
            )}
          </div>

          {status?.is_enabled ? (
            <>
              <div className="rounded-md bg-secondary/30 p-2.5 text-[11px] space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  启用时间: {status.enabled_at ? new Date(status.enabled_at).toLocaleString('zh-CN') : '-'}
                </div>
                <div className="flex items-center gap-2">
                  <KeyRound className="h-3 w-3 text-muted-foreground" />
                  剩余 Recovery Codes: <strong>{status.recovery_codes_remaining} / 8</strong>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => regenMut.mutate()}
                  disabled={regenMut.isPending}
                >
                  <KeyRound className="mr-1.5 h-3 w-3" />
                  重生成 Recovery Codes
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDisableDialog(true)}
                  className="text-destructive hover:text-destructive"
                >
                  禁用 2FA
                </Button>
              </div>

              {regenMut.data?.recovery_codes && (
                <div className="mt-2 rounded-md border bg-secondary/30 p-3">
                  <div className="text-[11px] text-muted-foreground mb-1.5">新的 Recovery Codes:</div>
                  <div className="font-mono text-[12px] space-y-0.5">
                    {regenMut.data.recovery_codes.map((c, i) => (
                      <div key={i}>{i + 1}. {c}</div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <Button onClick={handleStartSetup} disabled={setupMut.isPending}>
              {setupMut.isPending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              <Lock className="mr-1.5 h-3 w-3" />
              启用两步验证
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Disable 确认弹窗 */}
      <ConfirmDialog
        open={showDisableDialog}
        onClose={() => setShowDisableDialog(false)}
        onConfirm={handleDisable}
        title="禁用 2FA"
        description={
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              禁用后, 你的账号将不再需要 6 位验证码. 请输入当前 TOTP 码确认.
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  className={cn(
                    'px-2 py-0.5 rounded border',
                    disableMode === 'code' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'
                  )}
                  onClick={() => { setDisableMode('code'); setDisableInput(''); }}
                >TOTP 码</button>
                <button
                  className={cn(
                    'px-2 py-0.5 rounded border',
                    disableMode === 'password' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'
                  )}
                  onClick={() => { setDisableMode('password'); setDisableInput(''); }}
                >密码</button>
              </div>
              <Input
                type={disableMode === 'password' ? 'password' : 'text'}
                inputMode={disableMode === 'code' ? 'numeric' : undefined}
                maxLength={disableMode === 'code' ? 6 : undefined}
                placeholder={disableMode === 'code' ? '000000' : '当前密码'}
                value={disableInput}
                onChange={(e) => setDisableInput(disableMode === 'code' ? e.target.value.replace(/\D/g, '') : e.target.value)}
              />
            </div>
          </div>
        }
        confirmText={disableMut.isPending ? '禁用中...' : '确认禁用'}
        confirmVariant="destructive"
      />
    </div>
  );
}

function ShortcutsPanel() {
  const shortcuts = [
    { keys: ['⌘', 'K'], desc: '命令面板 (规划中)' },
    { keys: ['⌘', 'S'], desc: '保存当前编辑' },
    { keys: ['⌘', '/'], desc: '切换注释 (HTML 模式)' },
    { keys: ['Esc'],    desc: '关闭对话框 / 取消' },
    { keys: ['Tab'],    desc: '缩进 2 空格 (HTML 模式)' },
    { keys: ['Shift', 'Tab'], desc: '反向缩进 (HTML 模式)' },
  ];
  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardContent className="p-4 space-y-1">
          <div className="flex items-center gap-2 mb-2">
            <Keyboard className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-[13px] font-medium">全局快捷键</h3>
          </div>
          {shortcuts.map((s, i) => (
            <div key={i} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent">
              <span className="text-[12px] text-foreground/80">{s.desc}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((k, j) => (
                  <kbd key={j} className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10.5px] text-foreground/70 shadow-sm">
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// =====================================================================
// 关于
// =====================================================================
function AboutPanel() {
  return (
    <div className="space-y-3 max-w-2xl">
      <Card>
        <CardContent className="p-5 space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-blue-600 text-white">
              <Sparkles className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="text-[14px] font-semibold">AI-CMS</div>
              <div className="text-[11px] text-muted-foreground">v0.6.2 · P3.6.2 · 2026-06-07</div>
            </div>
          </div>
          <p className="text-[12px] text-muted-foreground leading-relaxed pt-2">
            前后端分离的多站点内容管理系统。后端 FastAPI + PostgreSQL + Redis + MinIO,前端 React 19 + Vite 5 + Tailwind 3.4 + Tiptap,静态发布走 Astro SSG。
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 text-[11.5px] text-muted-foreground space-y-1">
          <div className="text-foreground/80 font-medium mb-1.5">技术栈</div>
          <div>• 后端: Python 3.12 · FastAPI · SQLAlchemy 2.0 (async) · Alembic</div>
          <div>• 前端: React 19 · TypeScript 5 · Vite 5 · Tailwind 3.4 · Tiptap 2</div>
          <div>• 存储: PostgreSQL 16 · Redis 7 · MinIO (S3 兼容)</div>
          <div>• 任务: Celery 5 + Beat</div>
          <div>• 部署: Docker Compose · Nginx</div>
        </CardContent>
      </Card>
      <p className="text-center text-[10.5px] text-muted-foreground/70 pt-2">
        Made with <span className="text-red-500">♥</span> by holy xing
      </p>
    </div>
  );
}
