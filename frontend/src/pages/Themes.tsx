// Themes.tsx - 主题管理 (P2)
// 依据: docs/12-P2-决策.md §A2 (全局库) + §B1 (新站自动 apply) +
//      §B2 (切换不自动发布) + §B3 (改即存新 version) + §C2 (实时预览) +
//      §C3 (本地撤销) + §C8 (预设按钮) + §F2 (token sanitize)
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Palette,
  Save,
  Undo2,
  Redo2,
  Sparkles,
  Check,
  History,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { themesApi, type ThemeListItem, type ThemeVersion, type ThemeVersionListItem } from '@/api/themes';
import { sitesApi } from '@/api/sites';
import { contentsApi } from '@/api/contents';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Skeleton, EmptyState, Input, Label, Separator, Textarea } from '@/components/ui';
import { cn } from '@/lib/utils';

// === 工具: 深度合并 (与后端 _deep_merge 对应) ===
function deepMerge(base: any, overlay: any): any {
  if (Array.isArray(base) || Array.isArray(overlay)) return overlay;
  if (typeof base !== 'object' || base === null) return overlay;
  if (typeof overlay !== 'object' || overlay === null) return overlay;
  const out = { ...base };
  for (const k of Object.keys(overlay)) {
    if (k in base && typeof base[k] === 'object' && typeof overlay[k] === 'object' &&
        !Array.isArray(base[k]) && !Array.isArray(overlay[k])) {
      out[k] = deepMerge(base[k], overlay[k]);
    } else {
      out[k] = overlay[k];
    }
  }
  return out;
}

// === 颜色块 (用于主题库) ===
function ColorSwatch({ color, size = 32 }: { color: string | null; size?: number }) {
  return (
    <div
      className="rounded-md border"
      style={{ width: size, height: size, background: color || '#f3f4f6' }}
    />
  );
}

// === 主页面 ===
export function ThemesPage() {
  const qc = useQueryClient();
  // 1. 取当前 user 的第一个站 (P2 简化: 选站)
  const sitesQ = useQuery({
    queryKey: ['sites', 'active'] as const,
    queryFn: () => sitesApi.list({ page: 1, page_size: 50, status: 'active' }).catch(() => ({ items: [], total: 0, page: 1, page_size: 0 })),
  });
  const siteId = sitesQ.data?.items?.[0]?.id;

  // 2. 主题库
  const themesQ = useQuery({
    queryKey: ['themes'],
    queryFn: () => themesApi.list({ page: 1, page_size: 50 }),
    enabled: !!siteId,
  });

  // 3. 当前激活主题
  const currentQ = useQuery({
    queryKey: ['theme-current', siteId],
    queryFn: () => themesApi.getCurrent(siteId!),
    enabled: !!siteId,
    retry: false,  // 站点未应用主题时 404, 不重试
  });

  // 4. 版本历史
  const historyQ = useQuery({
    queryKey: ['theme-history', siteId],
    queryFn: () => themesApi.history(siteId!, { page: 1, page_size: 20 }),
    enabled: !!siteId,
  });

  // === Apply 主题 ===
  const applyMut = useMutation({
    mutationFn: (vars: { themeId: string; note?: string }) =>
      themesApi.apply(siteId!, vars.themeId, vars.note),
    onSuccess: (res) => {
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['theme-current', siteId] });
      qc.invalidateQueries({ queryKey: ['theme-history', siteId] });
    },
    onError: (e: any) => toast.error(e?.message || '应用主题失败'),
  });

  // === 回滚到指定 version ===
  const revertMut = useMutation({
    mutationFn: (versionId: string) => themesApi.revert(siteId!, versionId),
    onSuccess: (res) => {
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['theme-current', siteId] });
      qc.invalidateQueries({ queryKey: ['theme-history', siteId] });
    },
    onError: (e: any) => toast.error(e?.message || '回滚失败'),
  });

  // === 编辑器本地 state (C2: 实时预览) ===
  const [draftTokens, setDraftTokens] = useState<Record<string, any> | null>(null);
  // B4: 预览 iframe 开关 (默认开, 右侧可关)
  const [showPreview, setShowPreview] = useState(true);
  // B4: 取站点 published contents 供预览
  const contentsQ = useQuery({
    queryKey: ['site-contents', siteId],
    queryFn: () => contentsApi.list(siteId!, { page: 1, page_size: 6, status: 'published' }),
    enabled: !!siteId,
  });
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<Record<string, any>[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const draftRef = useRef(draftTokens);

  // 初始化 draft = 当前 active tokens
  useEffect(() => {
    if (currentQ.data && !draftTokens) {
      const t = currentQ.data.version.tokens;
      setDraftTokens(t);
      setHistory([t]);
      setHIdx(0);
      draftRef.current = t;
    }
  }, [currentQ.data, draftTokens]);

  // 编辑 token -> 入 history (C3)
  function setToken(path: string, value: string) {
    if (!draftRef.current) return;
    const keys = path.split('.');
    const overlay: any = {};
    let cursor: any = overlay;
    for (let i = 0; i < keys.length - 1; i++) {
      cursor[keys[i]] = {};
      cursor = cursor[keys[i]];
    }
    cursor[keys[keys.length - 1]] = value;
    const next = deepMerge(draftRef.current, overlay);
    draftRef.current = next;
    setDraftTokens(next);
    // 截断 redo
    const newHist = history.slice(0, hIdx + 1);
    newHist.push(next);
    setHistory(newHist);
    setHIdx(newHist.length - 1);
  }

  function undo() {
    if (hIdx > 0) {
      setHIdx(hIdx - 1);
      const prev = history[hIdx - 1];
      draftRef.current = prev;
      setDraftTokens(prev);
    }
  }
  function redo() {
    if (hIdx < history.length - 1) {
      setHIdx(hIdx + 1);
      const next = history[hIdx + 1];
      draftRef.current = next;
      setDraftTokens(next);
    }
  }

  // === 保存 = 调 PUT /themes/current (B3) ===
  const saveMut = useMutation({
    mutationFn: () => themesApi.updateTokens(siteId!, draftRef.current!, note || '手动调整'),
    onSuccess: (res) => {
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['theme-current', siteId] });
      qc.invalidateQueries({ queryKey: ['theme-history', siteId] });
      setNote('');
    },
    onError: (e: any) => toast.error(e?.message || '保存失败'),
  });

  // === 预设按钮 (C8) ===
  function presetDark() {
    if (!draftRef.current) return;
    const cur = draftRef.current.color?.primary || '#3b82f6';
    const darker = shiftColor(cur, -0.2);
    setToken('color.primary', darker);
  }
  function presetLight() {
    if (!draftRef.current) return;
    const cur = draftRef.current.color?.primary || '#3b82f6';
    const lighter = shiftColor(cur, 0.2);
    setToken('color.primary', lighter);
  }
  function presetBigger() {
    if (!draftRef.current) return;
    const fs = draftRef.current.typography?.fontSize || {};
    const next: any = {};
    for (const k of Object.keys(fs)) {
      const m = fs[k].match(/^(\d+(?:\.\d+)?)rem$/);
      if (m) next[k] = `${(parseFloat(m[1]) * 1.2).toFixed(3)}rem`;
    }
    // 一次性合并
    const overlay: any = { typography: { fontSize: next } };
    const merged = deepMerge(draftRef.current, overlay);
    draftRef.current = merged;
    setDraftTokens(merged);
    const newHist = history.slice(0, hIdx + 1);
    newHist.push(merged);
    setHistory(newHist);
    setHIdx(newHist.length - 1);
  }

  // === 加载中 ===
  if (sitesQ.isLoading || themesQ.isLoading || currentQ.isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!siteId) {
    return <EmptyState title="暂无可管理的站点" description="请先创建一个站点" />;
  }
  const themes = themesQ.data?.items || [];
  const current = currentQ.data;
  const historyItems = historyQ.data?.items || [];

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Palette className="h-5 w-5" />
            主题
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            选择主题库, 调整 design tokens, 管理版本历史
          </p>
        </div>
        {current && (
          <Badge variant="outline" className="text-xs">
            当前: {current.theme.code} v{current.version.version}
          </Badge>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* === 左: 主题库 === */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">主题库</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {themes.map(t => (
              <ThemeCard
                key={t.id}
                theme={t}
                isActive={current?.theme.id === t.id}
                applying={applyMut.isPending && applyMut.variables?.themeId === t.id}
                onApply={() => applyMut.mutate({ themeId: t.id })}
              />
            ))}
          </CardContent>
        </Card>

        {/* === 中: Token 编辑器 === */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Token 编辑器</CardTitle>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={undo} disabled={hIdx <= 0} className="h-7 text-xs">
                  <Undo2 className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" onClick={redo} disabled={hIdx >= history.length - 1} className="h-7 text-xs">
                  <Redo2 className="h-3 w-3" />
                </Button>
                <Separator orientation="vertical" className="h-4" />
                <Button size="sm" variant="outline" onClick={presetDark} className="h-7 text-xs">
                  <Sparkles className="h-3 w-3" /> 更暗
                </Button>
                <Button size="sm" variant="outline" onClick={presetLight} className="h-7 text-xs">
                  <Sparkles className="h-3 w-3" /> 更亮
                </Button>
                <Button size="sm" variant="outline" onClick={presetBigger} className="h-7 text-xs">
                  <Sparkles className="h-3 w-3" /> 更大字
                </Button>
                {/* P3.10 整合: AI 调样式入口移到全局 AIAssistant 浮窗 (template mode 调 design 任务) */}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!draftTokens ? (
              <EmptyState
                title="请先应用主题"
                description="在左侧选择一个主题"
                icon={AlertCircle}
              />
            ) : (
              <>
                <TokenEditor tokens={draftTokens} onChange={setToken} />
                {showPreview && (
                  <PreviewFrame
                    tokens={draftTokens}
                    siteName={sitesQ.data?.items?.[0]?.name || 'Site'}
                    siteDescription={sitesQ.data?.items?.[0]?.description || null}
                    contents={contentsQ.data?.items || []}
                  />
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowPreview(!showPreview)}
                  className="h-6 text-[10px] text-muted-foreground w-full"
                >
                  {showPreview ? '隐藏实时预览' : '显示实时预览'}
                </Button>
              </>
            )}

            {draftTokens && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">修改备注 (可选)</Label>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="如: 调深主色以提高对比度"
                    rows={2}
                    className="text-sm"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    onClick={() => saveMut.mutate()}
                    disabled={saveMut.isPending}
                    className="h-8 text-xs"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {saveMut.isPending ? '保存中...' : '保存为新版本'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* === 底: 版本历史 === */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4" />
            版本历史 ({historyQ.data?.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historyItems.length === 0 ? (
            <EmptyState
              icon={History}
              title="暂无历史"
              description="修改保存后会自动产生历史版本, 可一键回滚"
              size="sm"
              className="border-0 bg-transparent py-4"
            />
          ) : (
            <div className="divide-y">
              {historyItems.map(v => (
                <VersionRow
                  key={v.id}
                  v={v}
                  reverting={revertMut.isPending && revertMut.variables === v.id}
                  onRevert={() => revertMut.mutate(v.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

// === 主题卡片 ===
function ThemeCard({
  theme, isActive, applying, onApply,
}: {
  theme: ThemeListItem;
  isActive: boolean;
  applying: boolean;
  onApply: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border p-2.5',
        isActive && 'border-primary bg-primary/5',
      )}
    >
      {theme.preview_image ? (
        <img
          src={theme.preview_image}
          alt={theme.display_name}
          className="h-12 w-20 rounded border object-cover"
        />
      ) : (
        <ColorSwatch color={theme.primary_color} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{theme.display_name}</span>
          {theme.is_default && <Badge variant="muted" className="text-[10px]">默认</Badge>}
          {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
        </div>
        <div className="text-xs text-muted-foreground">{theme.code} · {theme.color_count} 颜色</div>
      </div>
      <Button
        size="sm"
        variant={isActive ? 'outline' : 'default'}
        disabled={isActive || applying}
        onClick={onApply}
        className="h-7 text-xs"
      >
        {isActive ? '当前' : applying ? '...' : '应用'}
      </Button>
    </div>
  );
}

// === Token 编辑器 (按 4 个 tab) ===
function TokenEditor({
  tokens, onChange,
}: {
  tokens: Record<string, any>;
  onChange: (path: string, value: string) => void;
}) {
  const [tab, setTab] = useState<'color' | 'typography' | 'spacing' | 'radius'>('color');
  const colors = (tokens.color || {}) as Record<string, string>;
  const fontSizes = (tokens.typography?.fontSize || {}) as Record<string, string>;
  const fontFamilies = (tokens.typography?.fontFamily || {}) as Record<string, string>;
  const spacing = (tokens.spacing || {}) as Record<string, string>;
  const radius = (tokens.radius || {}) as Record<string, string>;

  return (
    <div>
      <div className="flex items-center gap-1 mb-3 border-b">
        {(['color', 'typography', 'spacing', 'radius'] as const).map(k => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium transition-colors',
              tab === k ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {({ color: '颜色', typography: '字体', spacing: '间距', radius: '圆角' } as any)[k]}
          </button>
        ))}
      </div>

      {tab === 'color' && (
        <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
          {Object.entries(colors).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(v) ? v : '#000000'}
                onChange={(e) => onChange(`color.${k}`, e.target.value)}
                className="h-7 w-7 rounded border cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-muted-foreground">{k}</div>
                <Input
                  value={v}
                  onChange={(e) => onChange(`color.${k}`, e.target.value)}
                  className="h-6 text-xs font-mono"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'typography' && (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">字体家族</Label>
            {Object.entries(fontFamilies).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 mt-1">
                <span className="w-16 text-xs text-muted-foreground">{k}</span>
                <Input
                  value={v}
                  onChange={(e) => onChange(`typography.fontFamily.${k}`, e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
            ))}
          </div>
          <div>
            <Label className="text-xs">字号 (rem)</Label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {Object.entries(fontSizes).map(([k, v]) => (
                <div key={k} className="flex items-center gap-1">
                  <span className="w-8 text-[10px] text-muted-foreground">{k}</span>
                  <Input
                    value={v}
                    onChange={(e) => onChange(`typography.fontSize.${k}`, e.target.value)}
                    className="h-6 text-xs"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'spacing' && (
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(spacing).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1">
              <span className="w-8 text-[10px] text-muted-foreground">{k}</span>
              <Input
                value={v}
                onChange={(e) => onChange(`spacing.${k}`, e.target.value)}
                className="h-6 text-xs"
              />
            </div>
          ))}
        </div>
      )}

      {tab === 'radius' && (
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(radius).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1">
              <span className="w-8 text-[10px] text-muted-foreground">{k}</span>
              <Input
                value={v}
                onChange={(e) => onChange(`radius.${k}`, e.target.value)}
                className="h-6 text-xs"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// === 版本历史行 ===
// === B4: 实时预览 iframe (srcDoc 模式, 避免跨域) ===
function PreviewFrame({
  tokens, siteName, siteDescription, contents,
}: {
  tokens: Record<string, any>;
  siteName: string;
  siteDescription: string | null;
  contents: { title: string; slug: string; excerpt: string | null; published_at: string | null }[];
}) {
  // 构造 :root CSS 变量
  const vars: string[] = [];
  for (const [k, v] of Object.entries(tokens.color || {})) {
    vars.push(`--color-${k}: ${v};`);
  }
  for (const [k, v] of Object.entries(tokens.typography?.fontFamily || {})) {
    vars.push(`--font-${k}: ${v};`);
  }
  for (const [k, v] of Object.entries(tokens.typography?.fontSize || {})) {
    vars.push(`--text-${k}: ${v};`);
  }
  for (const [k, v] of Object.entries(tokens.spacing || {})) {
    vars.push(`--space-${k}: ${v};`);
  }
  for (const [k, v] of Object.entries(tokens.radius || {})) {
    vars.push(`--radius-${k}: ${v};`);
  }
  // 渲染内容列表
  const cards = contents.length === 0
    ? '<p style="color:var(--color-text-muted);text-align:center;padding:2rem;">该站点暂无已发布内容</p>'
    : contents.map(c => `
        <article class="card">
          <h2><a href="#${escapeHtml(c.slug)}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a></h2>
          <p class="meta">${c.published_at ? new Date(c.published_at).toLocaleDateString('zh-CN') : ''}</p>
          ${c.excerpt ? `<p class="excerpt">${escapeHtml(c.excerpt)}</p>` : ''}
        </article>
      `).join('');
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>
:root { ${vars.join(' ')} }
* { box-sizing: border-box; }
body { font-family: var(--font-sans); background: var(--color-background, #fff); color: var(--color-text, #111); margin: 0; line-height: 1.6; }
header { border-bottom: 1px solid var(--color-border); padding: var(--space-md, 1rem) 0; }
header .inner, main, footer .inner { max-width: 720px; margin: 0 auto; padding: 0 var(--space-md, 1rem); }
header h1 { font-size: var(--text-xl, 1.25rem); margin: 0; }
header h1 a { color: var(--color-text); text-decoration: none; }
main { padding: var(--space-xl, 2rem) 0; min-height: 50vh; }
.card { background: var(--color-surface, #f9fafb); border: 1px solid var(--color-border); border-radius: var(--radius-lg, .75rem); padding: var(--space-md, 1rem); margin-bottom: var(--space-md, 1rem); }
.card h2 { margin: 0 0 var(--space-xs, .25rem); font-size: var(--text-2xl, 1.5rem); }
.card h2 a { color: var(--color-text); text-decoration: none; }
.card h2 a:hover { color: var(--color-primary); }
.card .meta { color: var(--color-text-muted); font-size: var(--text-sm, .875rem); margin: 0 0 var(--space-sm, .5rem); }
.card .excerpt { color: var(--color-text); margin: 0; }
footer { border-top: 1px solid var(--color-border); padding: var(--space-md, 1rem) 0; color: var(--color-text-muted); font-size: var(--text-sm, .875rem); text-align: center; }
.hero { padding: var(--space-xl, 2rem) 0; text-align: center; }
.hero h1 { font-size: var(--text-4xl, 2.25rem); margin: 0 0 var(--space-sm, .5rem); }
.hero p { color: var(--color-text-muted); font-size: var(--text-lg, 1.125rem); margin: 0; }
</style></head><body>
  <header><div class="inner"><h1><a href="#" target="_blank" rel="noopener">${escapeHtml(siteName)}</a></h1></div></header>
  <main>
    <section class="hero">
      <h1>${escapeHtml(siteName)}</h1>
      ${siteDescription ? `<p>${escapeHtml(siteDescription)}</p>` : ''}
    </section>
    ${cards}
  </main>
  <footer><div class="inner">Last built: ${new Date().toLocaleString('zh-CN')}</div></footer>
</body></html>`;
  return (
    <div className="rounded-md border overflow-hidden bg-card">
      <div className="px-2 py-1 text-[10px] text-muted-foreground bg-muted/30 border-b flex items-center justify-between">
        <span>实时预览</span>
        <span className="font-mono text-[9px]">srcDoc · 改 token 立即变</span>
      </div>
      <iframe
        srcDoc={srcDoc}
        title="theme-preview"
        className="w-full h-[480px] bg-card"
        sandbox="allow-same-origin allow-popups allow-top-navigation-by-user-activation"
      />
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
}

function VersionRow({
  v, reverting, onRevert,
}: {
  v: ThemeVersionListItem;
  reverting: boolean;
  onRevert: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Badge variant={v.is_active ? 'default' : 'outline'} className="w-12 justify-center text-[10px]">
        v{v.version}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">
          {v.change_note || '(无备注)'}
          {v.is_ai_generated && <Badge variant="muted" className="ml-2 text-[10px]">AI</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          {v.author_name || '系统'} · {new Date(v.created_at).toLocaleString('zh-CN')} · {v.theme_code}
        </div>
      </div>
      {v.is_active ? (
        <Badge variant="default" className="text-[10px]">当前激活</Badge>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={onRevert}
          disabled={reverting}
          className="h-7 text-xs"
        >
          <RotateCcw className="h-3 w-3" />
          {reverting ? '...' : '回滚'}
        </Button>
      )}
    </div>
  );
}

// === 工具: 颜色明暗调整 (简单 HSL 思路) ===
function shiftColor(hex: string, percent: number): string {
  // hex -> rgb
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const shift = Math.round(255 * percent);
  r = Math.max(0, Math.min(255, r + shift));
  g = Math.max(0, Math.min(255, g + shift));
  b = Math.max(0, Math.min(255, b + shift));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
