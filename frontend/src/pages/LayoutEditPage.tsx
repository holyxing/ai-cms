// LayoutEditPage.tsx - 模板编辑器 (P3.6.2 + P3.9 AI 设计)
// P3.9: 「富文本」tab 改为「AI 设计」+ LLM 提升模板设计质量
// 路由: /sites/:siteId/layouts/:layoutId
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Save, Loader2, Code, Eye, Sparkles,
  FileCode, CheckCircle2, History,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { Button, Input, Label, Card, CardContent, Badge, QueryLoading, QueryError } from '@/components/ui';
import { cn } from '@/lib/utils';
import { layoutsApi, type Layout, SCOPE_LABELS, layoutCodeHint } from '@/api/layouts';
import { themesApi } from '@/api/themes';
import { toast } from 'sonner';
import { HtmlEditor } from '@/components/HtmlEditor';
// popup 由 ContentLayout 跨页提供 (P3.9.2+ holy 反馈 #11686)
import { VersionsDialog } from '@/components/VersionsDialog';
import { AssetDependencyCard } from '@/components/AssetDependencyCard';
import { SiteBlocksPanel } from '@/components/SiteBlocksPanel';
import { LayoutReferencesCard } from '@/components/LayoutReferencesCard';
import { PartialsPanel } from '@/components/PartialsPanel';
import { StyleScriptExtractorCard } from '@/components/StyleScriptExtractorCard';
import { useSaveShortcut } from '@/hooks/useSaveShortcut';
import { useTabsStore } from '@/stores/tabs';
import { useAIAssistant } from '@/stores/aiAssistant';

type EditMode = 'html' | 'preview';

export function LayoutEditPage() {
  const { siteId, layoutId } = useParams<{ siteId: string; layoutId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const renameTab = useTabsStore((s) => s.renameTab);
  const qc = useQueryClient();

  const layoutQ = useQuery({
    queryKey: ['layout', layoutId],
    // P4.5 Bug Bash: axios 拦截器把 4xx 转成 {code, message, data:null} 不抛错, useQuery.isError = false
    // 改: 使用 _skipToast 让 caller 自己处理 (不走 toast), 并在 queryFn 里手动检查
    queryFn: async () => {
      const data = await layoutsApi.get(layoutId!);
      // 跟 APIResponse 包装 shape 对齐: 数字 code >=400 是错误
      if (data && typeof (data as any).code === 'number' && (data as any).code >= 400) {
        throw { response: { status: (data as any).code, data } };
      }
      return data;
    },
    enabled: !!layoutId,
    retry: 1,
  });

  // 本地状态
  const [name, setName] = useState('');
  const [html, setHtml] = useState('');
  const [editMode, setEditMode] = useState<EditMode>('html');
  const [dirty, setDirty] = useState(false);
  const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(null);
  // P3.9.1: 侧栏 5 个 Card 折叠状态 (跟 PartialsPanel 一致)
  const [infoOpen, setInfoOpen] = useState(true);
  const [depsOpen, setDepsOpen] = useState(true);
  const [refsOpen, setRefsOpen] = useState(true);
  const [partialsOpen, setPartialsOpen] = useState(true);
  const [cssOpen, setCssOpen] = useState(true);
  // P3.6+ 版本历史 dialog
  const [versionsOpen, setVersionsOpen] = useState(false);

  const skipNextSyncRef = useRef(false);

  // 同步远端数据 → 本地（换模板 / 回滚时刷新；自己保存后不要盖掉编辑区）
  useEffect(() => {
    if (layoutQ.data) {
      if (skipNextSyncRef.current) {
        skipNextSyncRef.current = false;
        return;
      }
      setName(layoutQ.data.name);
      setHtml(layoutQ.data.html);
      setDirty(false);
      setAutoSavedAt(null);
    }
  }, [layoutQ.data?.id, layoutQ.data?.version]);  // eslint-disable-line react-hooks/exhaustive-deps

  // P3.9.1+ fix (holy 反馈 #11182): tab 用模板名，等宽栏内截断
  useEffect(() => {
    if (layoutQ.data) {
      const lay = layoutQ.data;
      const tabTitle = lay.name?.trim() || lay.code || '模板';
      renameTab(location.pathname, tabTitle);
    }
  }, [layoutQ.data?.id, layoutQ.data?.version, layoutQ.data?.name, layoutQ.data?.code, location.pathname, renameTab]);

  // 自动保存 (debounce 2s)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateMut = useMutation({
    mutationFn: async (next: { html: string; name?: string; silent?: boolean }) => {
      const data = await layoutsApi.update(layoutId!, { html: next.html, name: next.name });
      return { data, silent: !!next.silent };
    },
    onSuccess: ({ data, silent }) => {
      skipNextSyncRef.current = true;
      setDirty(false);
      setAutoSavedAt(new Date());
      qc.setQueryData(['layout', layoutId], data);
      qc.invalidateQueries({ queryKey: ['layouts'] });
      if (!silent) toast.success('已保存');
    },
    onError: (e: any) => toast.error(e?.message || e?.response?.data?.message || '保存失败'),
  });
  const saveMut = useCallback(() => {
    if (!dirty || updateMut.isPending) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    updateMut.mutate({ html, name });
  }, [html, name, dirty, updateMut]);
  useSaveShortcut({ onSave: saveMut, enabled: dirty && !updateMut.isPending });

  // P3.10 (AI 助手整合重构): mount 时注册 AI 上下文 + onApply (template 模式)
  // P3.10.4 (holy 反馈 #13214): "改样式" 任务需要 site 当前 theme tokens
  // layout 模型本身无 tokens, 必须在 template 模式下从 site current theme 拉取注入 payload
  const themeQ = useQuery({
    queryKey: ['site-theme-current', siteId],
    queryFn: () => themesApi.getCurrent(siteId!),
    enabled: !!siteId,
    retry: false,  // 站点未应用主题时 404, 不重试
    staleTime: 30_000,
  });
  // P3.10.4: 兑底 = 默认主题的 default_tokens (themeQ 404 时用)
  // P3.10.4 fix: queryKey 必须含 siteId, 避免跟 Themes 页 queryKey 冲 cache
  const themesListQ = useQuery({
    queryKey: ['themes-lib', siteId],
    queryFn: () => themesApi.list({ page: 1, page_size: 50 }),
    staleTime: 0,  // 不缓存, 保证拿到 fresh default_tokens
    refetchOnMount: true,
  });
  const defaultThemeTokens = useMemo(() => {
    const list = themesListQ.data?.items || [];
    const def = list.find((t) => t.is_default) || list[0];
    return def?.default_tokens;
  }, [themesListQ.data]);
  useEffect(() => {
    if (!layoutQ.data) return;
    // P3.10.4: 等 themesListQ 拿到 default tokens 后再 setContext (避免兑底失败)
    if (themesListQ.isPending) return;
    const lay = layoutQ.data;
    useAIAssistant.getState().setContext({
      type: 'template',
      target: {
        resourceId: lay.id,
        siteId: siteId!,
        title: lay.name,
        slug: lay.slug,
        designLang: (lay as any).design_lang || 'linear',
      },
      payload: {
        html: lay.html,
        // P3.10.4: 优先用 site 当前 theme version 的 tokens (theme 任务依赖)
        // layout 模型自己无 tokens 字段, 这是个一直存在的接口断层
        // site 未应用主题时兑底 = 全局默认主题的 default_tokens
        tokens: (themeQ.data?.version as any)?.tokens ?? (lay as any).tokens ?? defaultThemeTokens,
        onApply: (newText: string) => {
          setHtml(newText);
          setDirty(true);
          toast.success('已应用 AI 重设计, 请点保存');
        },
        onReject: () => {
          // 拒接 = 不动 html
        },
      },
    });
    return () => {
      // 路由离开 reset (避免老 context 残留)
      useAIAssistant.getState().reset();
    };
    // P3.10.4: deps 包含 themeQ.data + themesListQ.data + defaultThemeTokens + themesListQ.isPending
    // 这样 token 兑底能保证就绪后才 setContext (否则 "改样式" 会拿到空 tokens)
  }, [layoutQ.data?.id, siteId, themeQ.data, themesListQ.data, themesListQ.isPending, defaultThemeTokens]);
  useEffect(() => {
    if (!dirty || updateMut.isPending) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      if (updateMut.isPending) return;
      updateMut.mutate({ html, name, silent: true });
    }, 2000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [html, name, dirty]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (layoutQ.isLoading) {
    return <QueryLoading variant="detail" className="p-10" />;
  }
  if (layoutQ.isError || !layoutQ.data) {
    return (
      <QueryError
        error={layoutQ.isError ? layoutQ.error : { response: { status: 404 } }}
        onRetry={() => layoutQ.refetch()}
        context="加载模板"
        className="p-10"
      />
    );
  }

  const layout = layoutQ.data;

  return (
    <div className="px-6 py-6 lg:px-8 lg:py-8 max-w-[1400px] mx-auto">
      {/* 头部 */}
      <div className="mb-5 flex items-start gap-3 border-b pb-4">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
            <FileCode className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); setDirty(true); }}
              className="h-8 text-[15px] font-semibold border-transparent bg-transparent hover:border-input focus:border-input px-1.5 -ml-1.5"
              placeholder="模板名称"
            />
            <p className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <Badge variant="muted" className="text-[10px]">{SCOPE_LABELS[layout.scope]}</Badge>
              <span>·</span>
              <code className="rounded bg-secondary px-1 py-0.5 font-mono" title={layoutCodeHint(layout.code, layout.scope)}>
                {layout.code}
              </code>
              {layout.code !== 'default' && (
                <>
                  <span>·</span>
                  <span className="text-muted-foreground/90">栏目分组</span>
                </>
              )}
              {layout.is_default && (
                <Badge className="text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-100">scope 默认</Badge>
              )}
              <span>·</span>
              <span>v{layout.version}</span>
              {dirty ? (
                <span className="text-amber-600">· 未保存</span>
              ) : autoSavedAt ? (
                <span className="text-muted-foreground/80">· 已自动保存 {autoSavedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              ) : null}
            </p>
            <p className="text-[10px] text-muted-foreground/80 mt-1 leading-relaxed">
              {layoutCodeHint(layout.code, layout.scope)}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {updateMut.isPending && (
            <span className="flex items-center gap-1 text-[10px] text-blue-600">
              <Loader2 className="h-3 w-3 animate-spin" />
              保存中…
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setVersionsOpen(true)}
            title="查看 / 回滚历史版本"
          >
            <History className="h-3.5 w-3.5" />
            历史
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => navigate(`/layouts?edit=${layoutId}`)}
            title="在模板管理 dialog 中打开"
          >
            高级编辑
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={saveMut}
            disabled={!dirty || updateMut.isPending}
          >
            <Save className="h-3.5 w-3.5" />
            保存
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* 主编辑区 */}
        <div className="space-y-4">
          <Card className="shadow-sm">
            <CardContent className="space-y-3 p-6">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">HTML 模板源码</Label>
                {/* 2 档 tab (P3.9.2+: AI 设计改为右下角 popup, 只剩 HTML / 预览) */}
                <div className="inline-flex items-center gap-0.5 rounded-md border bg-secondary/40 p-0.5">
                  {([
                    { key: 'html',    label: 'HTML',    icon: Code },
                    { key: 'preview', label: '预览',    icon: Eye },
                  ] as const).map((m) => {
                    const Icon = m.icon;
                    const active = editMode === m.key;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setEditMode(m.key)}
                        className={cn(
                          'inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors',
                          active
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Icon className="h-3 w-3" strokeWidth={2} />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {editMode === 'html' && (
                <HtmlEditor
                  value={html}
                  onChange={(v) => { setHtml(v); setDirty(true); }}
                  scope={layout.scope as any}
                  placeholder="<!-- 模板 HTML -->&#10;<h1>{{ title }}</h1>"
                />
              )}

              {editMode === 'preview' && (
                <div className="min-h-[400px] rounded-md border bg-card p-6 prose prose-base max-w-none prose-headings:font-semibold prose-p:leading-relaxed">
                  {html?.trim() ? (
                    <div dangerouslySetInnerHTML={{ __html: html }} />
                  ) : (
                    <p className="text-sm italic text-muted-foreground">预览区为空, 请在「AI 设计」或「HTML」标签里写点内容。</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 侧栏: 模板信息 + HY_ 标签帮助 */}
        <div className="space-y-4">
          <Card className="shadow-sm">
            <CardContent className="p-0">
              {/* P3.9.1: 模板信息 Card 可折叠 (跟 PartialsPanel 一致) */}
              <button
                type="button"
                onClick={() => setInfoOpen((o) => !o)}
                aria-expanded={infoOpen}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-secondary/30"
              >
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
                  模板信息
                </span>
                {infoOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
              {infoOpen && (
                <div className="space-y-2 border-t px-4 py-3">
                  <dl className="space-y-1 text-[10.5px]">
                    <Row label="代码" value={layout.code} />
                    <Row label="作用域" value={layout.scope} />
                    <Row label="版本" value={`v${layout.version}`} />
                    <Row label="默认" value={layout.is_default ? '是' : '否'} />
                    <Row label="大小" value={`${(new Blob([html || '']).size / 1024).toFixed(2)} KB`} />
                  </dl>
                </div>
              )}
            </CardContent>
          </Card>

          {/* P3.6.4: 资源依赖检测 (扫描 <link>/<script>/<HY_ASSET_URL>, 列出已绑/缺失) */}
          <Card className="shadow-sm">
            <CardContent className="p-0">
              <button type="button" onClick={() => setDepsOpen((o) => !o)} aria-expanded={depsOpen}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-secondary/30">
                <span className="flex items-center gap-1.5 text-[11px] font-medium">资源依赖</span>
                {depsOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              {depsOpen && (<div className="border-t"><AssetDependencyCard siteId={siteId!} html={html} compact /></div>)}
            </CardContent>
          </Card>

          {/* P3.7.4: 引用关系面板 (哪些栏目/文章用了此模板) */}
          <Card className="shadow-sm">
            <CardContent className="p-0">
              <button type="button" onClick={() => setRefsOpen((o) => !o)} aria-expanded={refsOpen}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-secondary/30">
                <span className="flex items-center gap-1.5 text-[11px] font-medium">引用关系</span>
                {refsOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              {refsOpen && (<div className="border-t"><LayoutReferencesCard layoutId={layoutId!} siteId={siteId!} /></div>)}
            </CardContent>
          </Card>

          {/* P3.9.1+: 可引用的子模板速查 (顺向: 本站 partial 列表, 点击复制 <HY_TEMPLATE _code="..." />) */}
          <PartialsPanel siteId={siteId!} compact open={partialsOpen} onToggle={() => setPartialsOpen((o) => !o)} />

          {/* P3.7.5: CSS/JS 抽取 (template 内嵌的 <style>/<script> 块 → site_assets 资源 + HY_ 标签) */}
          <Card className="shadow-sm">
            <CardContent className="p-0">
              <button type="button" onClick={() => setCssOpen((o) => !o)} aria-expanded={cssOpen}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-secondary/30">
                <span className="flex items-center gap-1.5 text-[11px] font-medium">CSS/JS 抽取</span>
                {cssOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              {cssOpen && (<div className="border-t"><StyleScriptExtractorCard
                siteId={siteId!}
                html={html}
                onApplyNewHtml={(next) => { setHtml(next); setDirty(true); }}
              /></div>)}
            </CardContent>
          </Card>

          {/* P3.6.5+: 首页块配置面板 (只在 home scope 显示, 改 Hero/Stats/CTA 等不动 HTML) */}
          {layout.scope === 'home' && layout.code === 'home' && (
            <SiteBlocksPanel siteId={siteId!} />
          )}

          <Card className="shadow-sm">
            <CardContent className="p-4 space-y-2">
              <p className="text-xs font-medium">可用 HY_ 标签</p>
              <ul className="text-[10.5px] text-muted-foreground space-y-0.5 font-mono">
                <li>HY_SITE_NAME / HY_SITE_LOGO</li>
                <li>HY_PAGE_TITLE / HY_PAGE_DESC</li>
                <li>HY_CAT_NAME / HY_CAT_URL</li>
                <li>HY_ITEM_TITLE / HY_ITEM_COVER</li>
                <li>HY_ITEM_AUTHOR / HY_ITEM_DATE</li>
                <li>HY_ITEM_BODY / HY_RELATED_LIST</li>
                <li>HY_BREADCRUMB / HY_PAGINATION</li>
              </ul>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                在 HTML 中可插入, 静态发布时被引擎替换。
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-amber-100 bg-amber-50/40">
            <CardContent className="p-3.5 text-[11px] text-amber-900 flex items-start gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <span className="font-medium">自动保存</span>已开启(2 秒防抖), 切换 tab 不丢改动。
                需要立即保存可点右上「保存」。
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {versionsOpen && (
        <VersionsDialog
          layout={layout}
          onClose={() => setVersionsOpen(false)}
          onRollback={async (targetVersion) => {
            const updated = await layoutsApi.rollback(layout.id, targetVersion, `回滚到 v${targetVersion}`);
            // 刷新当前 layout 数据
            qc.setQueryData(['layout', layoutId], updated);
            // 如果当前有未保存改动, 弹出警告: 回滚会覆盖但 dirty 状态不会自动变
            if (dirty) {
              toast.warning(`已回滚到 v${updated.version}, 你有未保存的修改, 保存会再生成 v${updated.version + 1}`);
            } else {
              toast.success(`已回滚到 v${updated.version}`);
            }
            // 刷新版本列表
            qc.invalidateQueries({ queryKey: ['layout-versions', layout.id] });
            return updated;
          }}
        />
      )}
    </div>
  );
}

// === 侧栏标签-值行 ===
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-muted-foreground">
      <dt className="flex-shrink-0">{label}</dt>
      <dd className="truncate text-right text-foreground/80 font-mono" title={value}>{value}</dd>
    </div>
  );
}
