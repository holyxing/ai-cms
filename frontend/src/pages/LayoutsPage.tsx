// LayoutsPage.tsx - 模板管理 (P3.7 重构 2026-06-10)
// 依据: holy 反馈 - 左栏树 (5 个固定 scope 目录) + 右栏模板卡片列表
import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Code, Eye, History, RotateCcw, Save, Trash2,
  AlertCircle, AlertTriangle, Check, FileCode, X, BookOpen, Sparkles, Pencil,
  ChevronRight, Home, ListTree, FileText, Package, FileBox, Power, PowerOff,
  Star, StarOff, Upload, Loader2, LayoutGrid, List, Square, CheckSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Card, CardContent, Button, Input, Badge, Modal, ConfirmDialog, Textarea, Separator,
} from '@/components/ui';
import { BatchActionBar } from '@/components/BatchActionBar';
import TagAutocompletePopover, { type TagItem } from '@/components/editor/TagAutocompletePopover';
import { VersionsDialog } from '@/components/VersionsDialog';
import { sitesApi } from '@/api/sites';
import {
  layoutsApi, HY_TAGS, SCOPE_LABELS, SCOPE_ORDER,
  type Layout, type LayoutListItem, type LayoutScope, type LayoutTemplateKind,
  type LayoutValidateResult, type LayoutPreviewResult, type ZipImportResult,
} from '@/api/layouts';
import { cn } from '@/lib/utils';
import { useTabsStore } from '@/stores/tabs';

// 5 个 scope 目录: 左栏树 (固定 5 个, 不允许新建/删/重命名, 但允许"右键"子操作: 复制 code / 看介绍)
const SCOPE_ICONS: Record<LayoutScope, React.ComponentType<{ className?: string }>> = {
  site: Package,
  home: Home,
  category: ListTree,
  content: FileText,
  partial: FileBox,
};
const SCOPE_DESCS: Record<LayoutScope, string> = {
  site: '整站包裹布局 (header/footer 全在 site 里)',
  home: '首页布局 (Hero/Stats/CTA 三段)',
  category: '栏目页布局 (列表 + 分页)',
  content: '文章详情页布局',
  partial: '子模板 (Header/Footer, 可被 <HY_TEMPLATE code="x" /> 引用)',
};

export function LayoutsPage() {
  const queryClient = useQueryClient();
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [activeScope, setActiveScope] = useState<LayoutScope>('home');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Layout | null>(null);
  const [creating, setCreating] = useState<{ scope: LayoutScope; templateKind: LayoutTemplateKind } | null>(null);
  const [versionsOpen, setVersionsOpen] = useState<Layout | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Layout | null>(null);
  // P3.7.3: 弹窗前预加载的引用信息 (默认/引用数/引用列表)
  const [deleteRefs, setDeleteRefs] = useState<{
    is_default: boolean;
    scope: string;
    reference_count: number;
    references: Array<{ id: string; name: string }>;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  // P3.7+: 是否显示已禁用模板 (默认隐藏, 让用户主动打开)
  const [showInactive, setShowInactive] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'list'>(() => {
    try {
      return localStorage.getItem('ai-cms.layouts.view') === 'list' ? 'list' : 'card';
    } catch {
      return 'card';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('ai-cms.layouts.view', viewMode);
    } catch { /* 忽略无 localStorage 环境 */ }
  }, [viewMode]);

  // P3.9.1+ (holy 反馈 #11646): 当前正在编辑的 layout (从 tabs store 查 path 解析 layoutId)
  // 同步高亮 LayoutCard + CategoryTree 模板行
  // 注意: 不依赖 activeId (跳到 /layouts 时 activeId 被重置为 /layouts), 用 lastAccessed 排序找最近一个
  const tabs = useTabsStore((s) => s.tabs);
  const currentLayoutId = useMemo(() => {
    // 按 createdAt 倒序找最近一个 /sites/.../layouts/{id} tab
    const layoutTabs = tabs
      .filter((t) => /^\/sites\/[^/]+\/layouts\/[^/?]+/.test(t.pathname))
      .sort((a, b) => b.createdAt - a.createdAt);
    const tab = layoutTabs[0];
    if (!tab) return null;
    const m = tab.pathname.match(/^\/sites\/[^/]+\/layouts\/([^/?]+)/);
    return m ? m[1] : null;
  }, [tabs]);

  // 站点列表
  const sitesQ = useQuery({
    queryKey: ['sites', 'active'] as const,
    queryFn: () => sitesApi.list({ page: 1, page_size: 100, status: 'active' }).catch(() => ({ items: [], total: 0, page: 1, page_size: 0 })),
  });
  const sites = sitesQ.data?.items ?? [];
  useEffect(() => {
    if (!selectedSiteId && sites.length > 0) setSelectedSiteId(sites[0].id);
  }, [sites, selectedSiteId]);

  // 列出所有 scope (因为左栏 count 要全知道, 包括禁用)
  // P3.7+: 始终拉 include_inactive=true 算 count, 列表渲染时再按 showInactive 过滤
  const allQ = useQuery({
    queryKey: ['layouts-all', selectedSiteId],
    queryFn: () => layoutsApi.list(selectedSiteId!, { include_inactive: true }),
    enabled: !!selectedSiteId,
  });
  const allItems = allQ.data?.items ?? [];
  const byScope = useMemo(() => {
    const m: Record<string, LayoutListItem[]> = {};
    for (const it of allItems) {
      (m[it.scope] ||= []).push(it);
    }
    return m;
  }, [allItems]);
  // P3.7+: 计数时把"禁用数"也带出来, 用来在徽章上提示
  const inactiveByScope = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of allItems) {
      if (!it.is_active) m[it.scope] = (m[it.scope] ?? 0) + 1;
    }
    return m;
  }, [allItems]);

  // 重命名
  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      layoutsApi.update(id, { name }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['layouts-all'] });
      toast(`已重命名为 "${vars.name}"`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '重命名失败'),
  });

  // P3.7+: 启用/禁用切换
  const toggleActiveMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      layoutsApi.toggleActive(id, isActive),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['layouts-all'] });
      toast(vars.isActive ? '已启用' : '已禁用');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '切换失败'),
  });

  // P3.8.8: 设默认 (holy 反馈 #10550: 哪里改默认, 加 UI 入口)
  const setDefaultMut = useMutation({
    mutationFn: ({ id, isDefault }: { id: string; isDefault: boolean }) =>
      layoutsApi.update(id, { is_default: isDefault }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['layouts-all'] });
      toast(vars.isDefault ? '已设为默认' : '已取消默认');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '设置默认失败'),
  });

  // 当前 scope 的过滤后列表 (含 showInactive 过滤)
  const visibleItems = useMemo(() => {
    let list = byScope[activeScope] ?? [];
    if (!showInactive) list = list.filter((l) => l.is_active);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) => l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q),
      );
    }
    return list;
  }, [byScope, activeScope, search, showInactive]);

  useEffect(() => {
    setSelected(new Set());
  }, [activeScope, selectedSiteId]);

  const allSelected = visibleItems.length > 0 && visibleItems.every((l) => selected.has(l.id));
  const someSelected = visibleItems.some((l) => selected.has(l.id)) && !allSelected;

  const onToggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onToggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        visibleItems.forEach((l) => next.delete(l.id));
      } else {
        visibleItems.forEach((l) => next.add(l.id));
      }
      return next;
    });
  };

  const onBatchDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBatchDeleting(true);
    let okCount = 0;
    let errCount = 0;
    try {
      for (const id of ids) {
        try {
          await layoutsApi.remove(id, true);
          okCount++;
        } catch {
          errCount++;
        }
      }
      queryClient.invalidateQueries({ queryKey: ['layouts-all'] });
      setSelected(new Set());
      setConfirmBatchDelete(false);
      if (okCount) toast(`已删除 ${okCount} 个模板`);
      if (errCount) toast.error(`${errCount} 个模板删除失败`);
    } finally {
      setBatchDeleting(false);
    }
  };

  const selectedDefaultCount = useMemo(
    () => allItems.filter((l) => selected.has(l.id) && l.is_default).length,
    [allItems, selected],
  );

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="border-b bg-background px-6 py-3">
        <div className="mb-2 flex items-end justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">模板管理</h1>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              管理站点模板 (页面模板 + 子模板)。子模板可在页面模板里用 <code className="font-mono">&lt;HY_TEMPLATE code="x" /&gt;</code> 引用。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[12px]"
              disabled={!selectedSiteId}
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-3.5 w-3.5" />
              导入 ZIP
            </Button>
            <SitePicker
              sites={sites}
              value={selectedSiteId}
              onChange={setSelectedSiteId}
            />
          </div>
        </div>
      </div>

      {/* Body: 左树 + 右列表 */}
      <div className="flex flex-1 overflow-hidden">
        {/* === 左栏: 5 个固定 scope 目录 === */}
        <aside className="w-56 flex-shrink-0 border-r bg-secondary/10 flex flex-col">
          <div className="px-3 py-2 border-b">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              模板目录
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {SCOPE_ORDER.map((s) => {
              const Icon = SCOPE_ICONS[s];
              const totalCount = (byScope[s] ?? []).length;
              const inactiveCount = inactiveByScope[s] ?? 0;
              const isActive = s === activeScope;
              return (
                <button
                  key={s}
                  onClick={() => { setActiveScope(s); setSearch(''); }}
                  className={cn(
                    'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
                    isActive
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-foreground hover:bg-secondary/60',
                  )}
                  title={SCOPE_DESCS[s]}
                >
                  <Icon className={cn(
                    'h-3.5 w-3.5 flex-shrink-0',
                    isActive ? 'text-blue-700' : 'text-muted-foreground',
                  )} />
                  <span className="flex-1 truncate">{SCOPE_LABELS[s]}</span>
                  <span className={cn(
                    'flex-shrink-0 rounded px-1 text-[9px] font-mono',
                    isActive ? 'bg-blue-100 text-blue-700' : 'bg-secondary text-muted-foreground',
                  )}>
                    {totalCount - inactiveCount}
                    {inactiveCount > 0 && (
                      <span className="ml-0.5 text-muted-foreground/60">+{inactiveCount}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="border-t p-2 text-[10px] text-muted-foreground leading-relaxed">
            <p className="font-medium text-foreground mb-1">说明</p>
            <p>· 5 个目录是固定的，对应模板的 scope 字段</p>
            <p className="mt-0.5">· 子模板 (partial) 可被页面模板用 <code className="font-mono">HY_TEMPLATE</code> 嵌套</p>
          </div>
        </aside>

        {/* === 右栏: 模板列表 + 顶部操作 === */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b bg-background px-4 py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {visibleItems.length > 0 && (
                <button
                  type="button"
                  onClick={onToggleSelectAll}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                  title={allSelected ? '取消全选' : '全选当前列表'}
                >
                  {allSelected ? (
                    <CheckSquare className="h-3.5 w-3.5 text-primary" />
                  ) : someSelected ? (
                    <CheckSquare className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )}
                  全选
                </button>
              )}
              <h2 className="text-[13px] font-semibold text-foreground">
                {SCOPE_LABELS[activeScope]}
                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                  {SCOPE_DESCS[activeScope]}
                </span>
              </h2>
              <Badge variant="muted" className="text-[9px]">{(byScope[activeScope] ?? []).length}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="h-3 w-3 rounded border-gray-300"
                />
                显示已禁用
                {(inactiveByScope[activeScope] ?? 0) > 0 && (
                  <span className="rounded bg-secondary px-1 text-[9px] font-mono">
                    {inactiveByScope[activeScope]}
                  </span>
                )}
              </label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="按 code / 名称搜索..."
                  className="h-7 w-48 pl-8 text-[12px]"
                />
              </div>
              <div
                className="inline-flex items-center rounded-md border bg-background p-0.5"
                role="group"
                aria-label="视图切换"
              >
                <button
                  type="button"
                  title="卡片视图"
                  aria-pressed={viewMode === 'card'}
                  onClick={() => setViewMode('card')}
                  className={cn(
                    'inline-flex h-6 w-6 items-center justify-center rounded',
                    viewMode === 'card'
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="列表视图"
                  aria-pressed={viewMode === 'list'}
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'inline-flex h-6 w-6 items-center justify-center rounded',
                    viewMode === 'list'
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  <List className="h-3.5 w-3.5" />
                </button>
              </div>
              {selected.size > 0 && (
                <>
                  <Badge variant="info" className="text-[10px] tabular-nums">
                    已选 {selected.size}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[12px]"
                    onClick={() => setSelected(new Set())}
                  >
                    取消选择
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 border-destructive/40 text-[12px] text-destructive hover:bg-red-50"
                    onClick={() => setConfirmBatchDelete(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    批量删除
                  </Button>
                </>
              )}
              <Button
                size="sm"
                onClick={() => setCreating({
                  scope: activeScope,
                  templateKind: activeScope === 'partial' ? 'partial' : 'page',
                })}
                disabled={!selectedSiteId}
              >
                <Plus className="h-3.5 w-3.5" />
                新建{SCOPE_LABELS[activeScope]}
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {!selectedSiteId && (
              <EmptyHint icon={Sparkles} title="请先选择站点" />
            )}
            {selectedSiteId && allQ.isLoading && (
              <div className="py-12 text-center text-[12px] text-muted-foreground">加载模板...</div>
            )}
            {selectedSiteId && !allQ.isLoading && visibleItems.length === 0 && (
              <EmptyHint
                icon={FileCode}
                title={search ? `没有匹配 "${search}" 的模板` : `「${SCOPE_LABELS[activeScope]}」还没有模板`}
                description={search ? '试试其他关键词' : `点击右上「新建${SCOPE_LABELS[activeScope]}」开始`}
              />
            )}
            {visibleItems.length > 0 && (() => {
              const itemProps = (l: LayoutListItem): LayoutItemProps => ({
                layout: l,
                allInScope: byScope[activeScope] ?? [],
                isCurrent: l.id === currentLayoutId,
                onEdit: async () => {
                  const detail = await layoutsApi.get(l.id);
                  setEditing(detail);
                },
                onVersions: () => setVersionsOpen(l as Layout),
                onDelete: async () => {
                  setConfirmDelete(l as Layout);
                  setDeleteLoading(true);
                  try {
                    const refs = await layoutsApi.references((l as Layout).id);
                    setDeleteRefs(refs);
                  } catch {
                    setDeleteRefs(null);
                  } finally {
                    setDeleteLoading(false);
                  }
                },
                onToggleActive: async (next) => {
                  await toggleActiveMut.mutateAsync({ id: l.id, isActive: next });
                },
                onSetDefault: async (next) => {
                  await setDefaultMut.mutateAsync({ id: l.id, isDefault: next });
                },
                onRename: async (next) => {
                  await renameMut.mutateAsync({ id: l.id, name: next });
                },
                renaming: renameMut.isPending && renameMut.variables?.id === l.id,
                toggling: toggleActiveMut.isPending && toggleActiveMut.variables?.id === l.id,
                settingDefault: setDefaultMut.isPending && setDefaultMut.variables?.id === l.id,
                selected: selected.has(l.id),
                onToggleSelect: () => onToggleSelect(l.id),
              });
              if (viewMode === 'list') {
                return (
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b bg-secondary/30">
                          <th className="w-8 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={(el) => {
                                if (el) el.indeterminate = someSelected;
                              }}
                              onChange={onToggleSelectAll}
                              className="h-3.5 w-3.5 rounded border-gray-300"
                              aria-label="全选"
                            />
                          </th>
                          <th className="px-3 py-2 text-[11px] font-medium text-muted-foreground">名称</th>
                          <th className="px-3 py-2 text-[11px] font-medium text-muted-foreground">code</th>
                          <th className="px-3 py-2 text-[11px] font-medium text-muted-foreground">类型</th>
                          <th className="px-3 py-2 text-[11px] font-medium text-muted-foreground">版本</th>
                          <th className="px-3 py-2 text-[11px] font-medium text-muted-foreground">更新</th>
                          <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleItems.map((l) => (
                          <LayoutListRow key={l.id} {...itemProps(l)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }
              return (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleItems.map((l) => (
                    <LayoutCard key={l.id} {...itemProps(l)} />
                  ))}
                </div>
              );
            })()}
          </div>
        </main>
      </div>

      {/* Dialogs */}
      {importOpen && selectedSiteId && (
        <ZipImportDialog
          siteId={selectedSiteId}
          onClose={() => setImportOpen(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['layouts-all', selectedSiteId] });
            queryClient.invalidateQueries({ queryKey: ['layouts'] });
            queryClient.invalidateQueries({ queryKey: ['site-assets', selectedSiteId] });
          }}
        />
      )}
      {creating && selectedSiteId && (
        <LayoutEditDialog
          siteId={selectedSiteId}
          defaultScope={creating.scope}
          defaultTemplateKind={creating.templateKind}
          onClose={() => setCreating(null)}
        />
      )}
      {editing && (
        <LayoutEditDialog
          layout={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {versionsOpen && (
        <VersionsDialog
          layout={versionsOpen}
          onClose={() => setVersionsOpen(null)}
          onRollback={async (v) => {
            const updated = await layoutsApi.rollback(versionsOpen.id, v, `回滚到 v${v}`);
            queryClient.invalidateQueries({ queryKey: ['layouts'] });
            toast.success(`已回滚到 v${v}`);
            return updated;
          }}
        />
      )}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => {
          setConfirmDelete(null);
          setDeleteRefs(null);
        }}
        onConfirm={async () => {
          if (!confirmDelete) return;
          try {
            // P3.7.3: UI 已二次确认, 总是传 force=true 跳过所有后端检查
            await layoutsApi.remove(confirmDelete.id, true);
            queryClient.invalidateQueries({ queryKey: ['layouts-all'] });
            const refCount = deleteRefs?.reference_count ?? 0;
            const tag = confirmDelete.is_default
              ? `已删除默认模板「${confirmDelete.name}」, 该 scope 后续发布将走 fallback`
              : refCount > 0
              ? `已删除「${confirmDelete.name}」, ${refCount} 个引用栏目后续走 fallback`
              : '已删除模板';
            toast(tag);
          } catch (e: any) {
            const msg = e?.response?.data?.message || '删除失败';
            toast.error(msg);
          }
          setConfirmDelete(null);
          setDeleteRefs(null);
          setSelected((prev) => {
            if (!confirmDelete) return prev;
            const next = new Set(prev);
            next.delete(confirmDelete.id);
            return next;
          });
        }}
        title={
          confirmDelete?.is_default ? '删除默认模板'
          : (deleteRefs?.reference_count ?? 0) > 0 ? '删除被引用的模板'
          : '删除模板'
        }
        description={confirmDelete ? (
          deleteLoading ? '正在加载引用信息...'
          : (() => {
              const isDefault = confirmDelete.is_default;
              const refCount = deleteRefs?.reference_count ?? 0;
              const refs = deleteRefs?.references ?? [];
              if (!isDefault && refCount === 0) {
                return `确认删除模板 "${confirmDelete.name}"? 软删, 7 天内可恢复。`;
              }
              const lines: string[] = [];
              if (isDefault) {
                lines.push(`「${confirmDelete.name}」是 ${SCOPE_LABELS[confirmDelete.scope]} 的默认模板。`);
              }
              if (refCount > 0) {
                lines.push(`该模板被 ${refCount} 个栏目引用为 default:`);
                refs.slice(0, 5).forEach(r => lines.push(`  · ${r.name}`));
                if (refCount > 5) lines.push(`  · ... 还有 ${refCount - 5} 个`);
                lines.push(`删后这些栏目会走 fallback (其他启用的 default, 或空)。`);
              }
              lines.push('');
              lines.push(`确认删除? 软删, 7 天内可恢复。`);
              return lines.join('\n');
            })()
        ) : ''}
        confirmText="删除"
        variant="danger"
      />
      <ConfirmDialog
        open={confirmBatchDelete}
        onClose={() => !batchDeleting && setConfirmBatchDelete(false)}
        onConfirm={onBatchDelete}
        title={`批量删除 ${selected.size} 个模板`}
        description={
          selectedDefaultCount > 0
            ? `确认删除已选的 ${selected.size} 个模板？其中 ${selectedDefaultCount} 个是默认模板，删后对应 scope 将走 fallback。软删，7 天内可恢复。`
            : `确认删除已选的 ${selected.size} 个模板？软删，7 天内可恢复。`
        }
        confirmText={batchDeleting ? '删除中…' : '批量删除'}
        variant="danger"
        loading={batchDeleting}
      />
      <BatchActionBar
        className="z-[70]"
        count={selected.size}
        onClear={() => setSelected(new Set())}
        actions={[
          {
            key: 'delete',
            label: '批量删除',
            icon: Trash2,
            tone: 'destructive',
            confirm: true,
            confirmDestructive: true,
            confirmMessage: selectedDefaultCount > 0
              ? `确认删除已选的 ${selected.size} 个模板？其中 ${selectedDefaultCount} 个是默认模板，删后对应 scope 将走 fallback。软删，7 天内可恢复。`
              : `确认删除已选的 ${selected.size} 个模板？软删，7 天内可恢复。`,
            onAction: onBatchDelete,
          },
        ]}
      />
    </div>
  );
}

// === 卡片 / 列表共用 props ===
type LayoutItemProps = {
  layout: LayoutListItem;
  allInScope: LayoutListItem[];
  isCurrent?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onEdit: () => void;
  onVersions: () => void;
  onDelete: () => void;
  onToggleActive: (next: boolean) => Promise<void> | void;
  onSetDefault: (next: boolean) => Promise<void> | void;
  onRename: (next: string) => Promise<void> | void;
  renaming: boolean;
  toggling: boolean;
  settingDefault: boolean;
};

function useInlineRename(
  name: string,
  onRename: (next: string) => Promise<void> | void,
) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editingName) setNameDraft(name);
  }, [name, editingName]);

  useEffect(() => {
    if (editingName) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editingName]);

  const commit = async () => {
    const next = nameDraft.trim();
    if (!next || next === name) {
      setEditingName(false);
      setNameDraft(name);
      return;
    }
    try {
      await onRename(next);
      setEditingName(false);
    } catch {
      setNameDraft(name);
      setEditingName(false);
    }
  };

  return { editingName, setEditingName, nameDraft, setNameDraft, inputRef, commit };
}

function LayoutRowActions({
  layout,
  stretchEdit,
  onEdit,
  onVersions,
  onDelete,
  onToggleActive,
  onSetDefault,
  toggling,
  settingDefault,
}: Pick<
  LayoutItemProps,
  | 'layout'
  | 'onEdit'
  | 'onVersions'
  | 'onDelete'
  | 'onToggleActive'
  | 'onSetDefault'
  | 'toggling'
  | 'settingDefault'
> & { stretchEdit?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        className={cn('h-7 text-[11px]', stretchEdit && 'flex-1')}
        onClick={onEdit}
      >
        <Code className="h-3 w-3" />
        编辑
      </Button>
      <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={onVersions} title="版本历史">
        <History className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'h-7 text-[11px]',
          layout.is_default
            ? 'text-blue-600 hover:bg-blue-50'
            : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={() => onSetDefault(!layout.is_default)}
        disabled={settingDefault}
        title={layout.is_default ? '取消默认 (该 scope 将走 fallback)' : '设为默认 (同 scope 其他取消)'}
        aria-label={layout.is_default ? '取消默认' : '设为默认'}
      >
        {layout.is_default ? <Star className="h-3 w-3 fill-current" /> : <StarOff className="h-3 w-3" />}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-[11px]"
        onClick={() => onToggleActive(!layout.is_active)}
        disabled={toggling}
        title={layout.is_active ? '禁用' : '启用'}
      >
        {layout.is_active ? (
          <PowerOff className="h-3 w-3 text-muted-foreground" />
        ) : (
          <Power className="h-3 w-3 text-emerald-600" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-[11px] text-destructive"
        onClick={onDelete}
        title={layout.is_default ? '删除默认模板 (删后该 scope 走 fallback)' : '删除'}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

// === 卡片 ===
function LayoutCard({
  layout,
  allInScope,
  isCurrent,
  selected,
  onToggleSelect,
  onEdit,
  onVersions,
  onDelete,
  onToggleActive,
  onSetDefault,
  onRename,
  renaming,
  toggling,
  settingDefault,
}: LayoutItemProps) {
  const { editingName, setEditingName, nameDraft, setNameDraft, inputRef, commit } =
    useInlineRename(layout.name, onRename);

  const parent = layout.parent_code
    ? allInScope.find((x) => x.code === layout.parent_code)
    : null;

  return (
    <Card className={cn(
      'group transition-all hover:shadow-md',
      isCurrent
        ? 'border-blue-500 bg-blue-50/40 ring-1 ring-blue-200'
        : selected
          ? 'border-primary/40 bg-blue-50/20'
          : 'border-border',
      !layout.is_active && 'opacity-60 grayscale-[30%]',
    )}>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <input
              type="checkbox"
              checked={!!selected}
              onChange={onToggleSelect}
              onClick={(e) => e.stopPropagation()}
              className="h-3.5 w-3.5 shrink-0 rounded border-gray-300"
              aria-label={`选择 ${layout.name}`}
            />
            <div className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md',
              isCurrent
                ? 'bg-blue-100 text-blue-700'
                : layout.scope === 'site' ? 'bg-purple-100 text-purple-700' :
              layout.scope === 'home' ? 'bg-amber-100 text-amber-700' :
              layout.scope === 'category' ? 'bg-blue-100 text-blue-700' :
              layout.scope === 'content' ? 'bg-emerald-100 text-emerald-700' :
              'bg-pink-100 text-pink-700',
            )}>
              <FileCode className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              {editingName ? (
                <Input
                  ref={inputRef}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                    if (e.key === 'Escape') { setNameDraft(layout.name); setEditingName(false); }
                  }}
                  disabled={renaming}
                  maxLength={128}
                  className="h-6 text-[13px] font-semibold px-1.5 -ml-1.5"
                />
              ) : (
                <div className="flex items-center gap-1 min-w-0">
                  <span className="text-[13px] font-semibold truncate" title={layout.name}>{layout.name}</span>
                  <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    className="flex-shrink-0 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                    title="重命名"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              )}
              <code className="font-mono text-[10px] text-muted-foreground">{layout.code}</code>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {layout.is_default && (
              <Badge variant="info" className="text-[9px]">默认</Badge>
            )}
            {!layout.is_active && (
              <Badge variant="muted" className="text-[9px] bg-secondary text-muted-foreground">已禁用</Badge>
            )}
            <Badge variant="muted" className="text-[9px]">v{layout.version}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant={layout.template_kind === 'partial' ? 'info' : 'muted'} className="text-[9px]">
            {layout.template_kind === 'partial' ? '子模板' : '页面'}
          </Badge>
          {parent && (
            <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground" title={`嵌套自 ${parent.name}`}>
              <ChevronRight className="h-2.5 w-2.5" />
              {parent.name}
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">
          更新 {new Date(layout.updated_at).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })}
        </div>
        <div className="mt-2">
          <LayoutRowActions
            layout={layout}
            stretchEdit
            onEdit={onEdit}
            onVersions={onVersions}
            onDelete={onDelete}
            onToggleActive={onToggleActive}
            onSetDefault={onSetDefault}
            toggling={toggling}
            settingDefault={settingDefault}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function LayoutListRow({
  layout,
  allInScope,
  isCurrent,
  selected,
  onToggleSelect,
  onEdit,
  onVersions,
  onDelete,
  onToggleActive,
  onSetDefault,
  onRename,
  renaming,
  toggling,
  settingDefault,
}: LayoutItemProps) {
  const { editingName, setEditingName, nameDraft, setNameDraft, inputRef, commit } =
    useInlineRename(layout.name, onRename);
  const parent = layout.parent_code
    ? allInScope.find((x) => x.code === layout.parent_code)
    : null;

  return (
    <tr
      className={cn(
        'group h-10 border-b last:border-b-0',
        isCurrent ? 'bg-blue-50/40' : selected ? 'bg-blue-50/20' : 'hover:bg-secondary/40',
        !layout.is_active && 'opacity-60',
      )}
    >
      <td className="px-3 py-1.5">
        <input
          type="checkbox"
          checked={!!selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 rounded border-gray-300"
          aria-label={`选择 ${layout.name}`}
        />
      </td>
      <td className="px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode className={cn(
            'h-3.5 w-3.5 flex-shrink-0',
            isCurrent ? 'text-blue-700' : 'text-muted-foreground',
          )} />
          {editingName ? (
            <Input
              ref={inputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                if (e.key === 'Escape') { setNameDraft(layout.name); setEditingName(false); }
              }}
              disabled={renaming}
              maxLength={128}
              className="h-6 w-40 text-[13px] font-medium px-1.5"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-1">
              <span className="truncate text-[13px] font-medium" title={layout.name}>{layout.name}</span>
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                title="重命名"
              >
                <Pencil className="h-3 w-3" />
              </button>
              {layout.is_default && <Badge variant="info" className="text-[9px]">默认</Badge>}
              {!layout.is_active && <Badge variant="muted" className="text-[9px]">已禁用</Badge>}
            </div>
          )}
        </div>
      </td>
      <td className="px-3 py-1.5">
        <code className="font-mono text-[11px] text-muted-foreground">{layout.code}</code>
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <Badge variant={layout.template_kind === 'partial' ? 'info' : 'muted'} className="text-[9px]">
            {layout.template_kind === 'partial' ? '子模板' : '页面'}
          </Badge>
          {parent && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground" title={`嵌套自 ${parent.name}`}>
              <ChevronRight className="h-2.5 w-2.5" />
              {parent.name}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-1.5 text-[12px] tabular-nums text-muted-foreground">v{layout.version}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-[12px] text-muted-foreground">
        {new Date(layout.updated_at).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })}
      </td>
      <td className="px-3 py-1.5">
        <div className="flex justify-end">
          <LayoutRowActions
            layout={layout}
            onEdit={onEdit}
            onVersions={onVersions}
            onDelete={onDelete}
            onToggleActive={onToggleActive}
            onSetDefault={onSetDefault}
            toggling={toggling}
            settingDefault={settingDefault}
          />
        </div>
      </td>
    </tr>
  );
}

// === 导入网站 ZIP + 站点选择 ===
function ZipImportDialog({
  siteId,
  onClose,
  onSuccess,
}: {
  siteId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [useAi, setUseAi] = useState(true);
  const [result, setResult] = useState<ZipImportResult | null>(null);
  const [askConfirm, setAskConfirm] = useState(false);

  const importMut = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('请选择 ZIP 文件');
      return layoutsApi.importZip(siteId, file, useAi);
    },
    onSuccess: (data) => {
      setResult(data);
      toast.success('ZIP 导入完成');
      onSuccess();
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || e?.message || '导入失败');
    },
  });

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.zip')) {
      toast.error('请选择 .zip 文件');
      return;
    }
    setFile(f);
    setResult(null);
  };

  return (
    <>
    <Modal
      open
      onClose={importMut.isPending ? () => undefined : onClose}
      title="导入网站 ZIP"
      description="把静态站的 HTML / CSS / JS / 图片导入为站点资源，并生成 5 类 HY_ 模板。"
      maxWidth="max-w-lg"
    >
      <div className="space-y-3 p-4">
        <p className="rounded-md bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
          含首页（index.html）的 ZIP 会更新 <code className="font-mono">default / header / footer</code>，并按<strong>栏目分组</strong>各生成 1 份列表模板 + 1 份详情模板（例如「新闻」栏目下所有列表页共用同一份列表模板、所有详情页共用同一份详情模板，不会按每个 HTML 各建一份）。不含首页的二级 ZIP 只新增尚未存在的分组模板、不覆盖已有模板和同名资源。导入的 ZIP 会保存到媒体库「压缩包」。不会自动创建栏目或文章。
        </p>

        {!result && (
          <>
            <label
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-8 transition-colors',
                file ? 'border-primary/40 bg-blue-50' : 'border-border hover:border-primary/30 hover:bg-secondary/30',
              )}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                pickFile(e.dataTransfer.files?.[0] ?? null);
              }}
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-[12px] text-foreground">
                {file ? file.name : '拖入或点击选择 .zip'}
              </span>
              {file && (
                <span className="text-[11px] text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useAi}
                onChange={(e) => setUseAi(e.target.checked)}
                className="h-3 w-3 rounded border-gray-300"
              />
              使用 AI 辅助页面分类（未配置 Provider 时自动退回路规则）
            </label>
          </>
        )}

        {importMut.isPending && (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在分析页面并导入，请稍候…
          </div>
        )}

        {result && (
          <div className="space-y-2 text-[12px]">
            <p>
              资源：新建 {result.assets_created}，覆盖 {result.assets_overwritten}
              {(result.assets_skipped ?? 0) > 0 ? `，跳过 ${result.assets_skipped}` : ''}
              {result.ai_used ? ' · 已用 AI 分类' : ' · 路径规则分类'}
            </p>
            <div className="rounded-md border">
              {result.layouts.map((l) => (
                <div key={`${l.scope}-${l.code}`} className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0">
                  <span className="w-16 text-muted-foreground">{SCOPE_LABELS[l.scope] ?? l.scope}</span>
                  <span className="flex-1 font-mono text-[11px]">{l.code}</span>
                  <Badge
                    variant={l.action === 'created' ? 'success' : l.action === 'reused' ? 'outline' : 'warning'}
                    className="text-[9px]"
                  >
                    {l.action === 'created' ? '新建' : l.action === 'reused' ? '复用' : '覆盖'} v{l.version}
                  </Badge>
                </div>
              ))}
            </div>
            {result.pages_classified.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                识别页面 {result.pages_classified.length} 个：
                {['home', 'category', 'content'].map((s) => {
                  const n = result.pages_classified.filter((p) => p.scope === s).length;
                  return n ? ` ${SCOPE_LABELS[s as LayoutScope] ?? s} ${n}` : '';
                }).join('')}
              </p>
            )}
            {result.warnings.length > 0 && (
              <ul className="max-h-28 overflow-y-auto rounded-md bg-secondary/50 px-3 py-2 text-[11px] text-muted-foreground">
                {result.warnings.map((w, i) => <li key={i}>· {w}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t px-4 py-3">
        <Button variant="ghost" size="sm" className="h-8 text-[12px]" onClick={onClose} disabled={importMut.isPending}>
          {result ? '关闭' : '取消'}
        </Button>
        {!result && (
          <Button
            size="sm"
            className="h-8 text-[12px]"
            disabled={!file || importMut.isPending}
            onClick={() => setAskConfirm(true)}
          >
            {importMut.isPending ? '导入中…' : '开始导入'}
          </Button>
        )}
      </div>
    </Modal>
    <ConfirmDialog
      open={askConfirm}
      onClose={() => setAskConfirm(false)}
      title="确认导入 ZIP"
      variant="warning"
      confirmText="确认导入"
      loading={importMut.isPending}
      description={
        file ? (
          <>
            即将导入 <code className="rounded bg-secondary px-1 font-mono text-[12px]">{file.name}</code>
            （{(file.size / 1024).toFixed(1)} KB）。
            含首页的 ZIP 会更新 default / header / footer，并按栏目分组各建 1 列表 + 1 详情模板；不含首页的只新增、不覆盖已有模板。
            不会自动创建栏目或文章。确定继续？
          </>
        ) : '请先选择 ZIP 文件。'
      }
      onConfirm={() => {
        setAskConfirm(false);
        importMut.mutate();
      }}
    />
    </>
  );
}

function SitePicker({ sites, value, onChange }: {
  sites: { id: string; name: string; slug: string }[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-border bg-background px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {sites.length === 0 && <option value="">暂无站点</option>}
      {sites.map((s) => (
        <option key={s.id} value={s.id}>{s.name} ({s.slug})</option>
      ))}
    </select>
  );
}

function EmptyHint({ icon: Icon, title, description }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-secondary/50">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-[11px] text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

// === 编辑 Dialog (左编辑 + 右预览/标签参考) ===
function LayoutEditDialog({
  layout,
  siteId,
  defaultScope,
  defaultTemplateKind,
  onClose,
}: {
  layout?: Layout;
  siteId?: string;
  defaultScope?: LayoutScope;
  defaultTemplateKind?: LayoutTemplateKind;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!layout;
  const [name, setName] = useState(layout?.name ?? '');
  const [code, setCode] = useState(layout?.code ?? '');
  const [html, setHtml] = useState(layout?.html ?? '');
  const [scope, setScope] = useState<LayoutScope>(layout?.scope ?? defaultScope ?? 'category');
  const [templateKind, setTemplateKind] = useState<LayoutTemplateKind>(layout?.template_kind ?? defaultTemplateKind ?? 'page');
  const [parentCode, setParentCode] = useState<string | null>(layout?.parent_code ?? null);
  const [isDefault, setIsDefault] = useState(layout?.is_default ?? false);
  const [changeNote, setChangeNote] = useState('');
  const [showTags, setShowTags] = useState(false);

  // P3.6.2: {{ 自动补全
  const [acOpen, setAcOpen] = useState(false);
  const [acFilter, setAcFilter] = useState('');
  const [acPos, setAcPos] = useState<{ top: number; left: number } | undefined>();
  const htmlRef = useRef<HTMLTextAreaElement>(null);

  const debouncedHtml = useDebouncedValue(html, 600);

  // 校验 (debounced)
  const validateQ = useQuery({
    queryKey: ['layout-validate', layout?.id, debouncedHtml],
    queryFn: () => isEdit
      ? layoutsApi.validate(layout!.id, debouncedHtml)
      : Promise.resolve({ valid: true, errors: [], warnings: [], tag_stats: {} } as LayoutValidateResult),
    enabled: isEdit && debouncedHtml.length > 0,
    staleTime: 10_000,
  });

  // 预览 (debounced)
  const previewQ = useQuery({
    queryKey: ['layout-preview', layout?.id, debouncedHtml],
    queryFn: () => isEdit
      ? layoutsApi.preview(layout!.id, debouncedHtml)
      : Promise.resolve({ html: '<div style="padding:2rem;color:#999;text-align:center">先保存模板, 然后才能预览</div>', warnings: [], errors: [] } as LayoutPreviewResult),
    enabled: isEdit && debouncedHtml.length > 0,
    staleTime: 10_000,
  });

  // P3.7: 同 scope 所有模板, 用于"父模板"下拉
  const sameScopeQ = useQuery({
    queryKey: ['layouts-same-scope', siteId ?? layout?.site_id, scope],
    queryFn: () => layoutsApi.list(siteId ?? layout!.site_id, { scope }),
    enabled: !!siteId || !!layout?.site_id,
  });
  const parentOptions = useMemo(
    () => (sameScopeQ.data?.items ?? []).filter((l) => l.id !== layout?.id && !l.parent_code),
    [sameScopeQ.data, layout?.id],
  );

  const saveMut = useMutation({
    mutationFn: () => isEdit
      ? layoutsApi.update(layout!.id, {
          name,
          html,
          is_default: isDefault,
          template_kind: templateKind,
          parent_code: parentCode,
          change_note: changeNote || undefined,
        })
      : layoutsApi.create(siteId!, {
          scope,
          code,
          name,
          html,
          is_default: isDefault,
          template_kind: templateKind,
          parent_code: parentCode,
          change_note: changeNote || undefined,
        }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['layouts'] });
      toast(isEdit ? '已保存' : '已创建');
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || '保存失败'),
  });

  // 标签 cheatsheet: partial 范围可用 HY_TEMPLATE + HY_IF + HY_INCLUDE
  const filteredTags = useMemo(() => {
    const base = HY_TAGS.filter((t) => t.scope === 'all' || t.scope === scope);
    if (scope === 'partial') {
      return [
        ...base,
        { code: 'HY_TEMPLATE', scope: 'all' as const, desc: '嵌套其他模板 (code="x")', example: '<HY_TEMPLATE code="header-modern" />' },
        { code: 'HY_IF', scope: 'all' as const, desc: '条件块 (按 _condition 切)', example: '<HY_IF _condition="ctx.featured">...</HY_IF>' },
        { code: 'HY_INCLUDE', scope: 'all' as const, desc: '包含外部文件', example: '<HY_INCLUDE _file="snippet.html" />' },
      ];
    }
    // 页面模板也支持 HY_TEMPLATE
    return [
      ...base,
      { code: 'HY_TEMPLATE', scope: 'all' as const, desc: '嵌套子模板 (在 partial scope 定义)', example: '<HY_TEMPLATE code="header-modern" />' },
    ];
  }, [scope]);

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `编辑模板: ${layout!.name}` : `新建${SCOPE_LABELS[scope]}`}
      maxWidth="max-w-6xl"
    >
      <div className="grid grid-cols-12 gap-3">
        {/* === 左: 元数据 + HTML 编辑 === */}
        <div className="col-span-7 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {!isEdit && (
              <div>
                <label className="mb-1 block text-[11px] font-medium">作用域</label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as LayoutScope)}
                  className="h-8 w-full rounded-md border bg-background px-2 text-[12px]"
                >
                  {SCOPE_ORDER.map((s) => (
                    <option key={s} value={s}>{SCOPE_LABELS[s]} ({s})</option>
                  ))}
                </select>
              </div>
            )}
            {!isEdit && (
              <div>
                <label className="mb-1 block text-[11px] font-medium">代码 (英文小写)</label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="my_layout"
                  className="h-8 font-mono text-[12px]"
                />
              </div>
            )}
            <div className={isEdit ? 'col-span-2' : ''}>
              <label className="mb-1 block text-[11px] font-medium">显示名称</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-[12px]"
              />
            </div>
          </div>

          {/* P3.7: 模板类型 + 父模板 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium">类型</label>
              <div className="flex gap-1">
                {(['page', 'partial'] as LayoutTemplateKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTemplateKind(k)}
                    className={cn(
                      'h-8 flex-1 rounded-md border text-[11px] font-medium transition-colors',
                      templateKind === k
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-border bg-background text-muted-foreground hover:bg-secondary/40',
                    )}
                  >
                    {k === 'page' ? '页面模板' : '子模板 (partial)'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium">
                父模板 (嵌套用, 可选)
              </label>
              <select
                value={parentCode ?? ''}
                onChange={(e) => setParentCode(e.target.value || null)}
                className="h-8 w-full rounded-md border bg-background px-2 text-[12px]"
              >
                <option value="">— 无 —</option>
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.code}>{p.name} ({p.code})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px]">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300"
              />
              设为该 scope 的默认模板
            </label>
            {isEdit && (
              <span className="text-[10px] text-muted-foreground">
                当前 v{layout!.version} · {new Date(layout!.updated_at).toLocaleString('zh-CN')}
              </span>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11px] font-medium">HTML 源码</label>
              <div className="flex items-center gap-1.5">
                {validateQ.data && (
                  <ValidationBadge result={validateQ.data} loading={validateQ.isFetching} />
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px]"
                  onClick={() => setShowTags((v) => !v)}
                >
                  <BookOpen className="h-3 w-3" />
                  {showTags ? '隐藏' : '显示'}标签参考
                </Button>
              </div>
            </div>
            <Textarea
              ref={htmlRef}
              value={html}
              onChange={(e) => {
                const v = e.target.value;
                setHtml(v);
                // P3.6.2: 监听 {{ 触发补全. 检测: 上一字符是 {, 且未到 {{
                const cur = e.target.selectionStart ?? v.length;
                if (v.length >= 2 && v[cur - 1] === '{' && v[cur - 2] === '{') {
                  // 计算弹层位置 (textarea 下方)
                  const ta = htmlRef.current;
                  if (ta) {
                    const rect = ta.getBoundingClientRect();
                    // 粗略: 第几行 = 出现位置之前有多少换行
                    const before = v.slice(0, cur);
                    const lineNum = (before.match(/\n/g) || []).length;
                    const lineHeight = 16; // px
                    setAcPos({ top: rect.top + (lineNum + 1) * lineHeight + 4, left: rect.left + 16 });
                  }
                  setAcFilter('');
                  setAcOpen(true);
                } else if (acOpen) {
                  // 关闭条件: 上一个输入不是 { 时, 关闭
                  const before = v.slice(0, cur);
                  const lastBrace = before.lastIndexOf('{{');
                  if (lastBrace < 0 || cur - lastBrace > 30) {
                    setAcOpen(false);
                  } else {
                    // 还可能处于过滤中, 更新 filter
                    setAcFilter(before.slice(lastBrace + 2, cur));
                  }
                }
              }}
              onKeyDown={(e) => {
                // 补全面板打开时, 吞掉这些键 (不输入到 textarea)
                if (acOpen && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(e.key)) {
                  e.preventDefault();
                }
              }}
              placeholder="<div><HY_SITE_NAME /></div>...  (输入 {{ 弹出补全)"
              className="min-h-[380px] font-mono text-[11px] leading-relaxed"
            />
            <Input
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="本次修改说明 (可选, 留作版本历史)"
              className="mt-2 h-7 text-[11px]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
            <Button
              size="sm"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || !name || (!isEdit && (!code || !siteId))}
            >
              <Save className="h-3 w-3" />
              {saveMut.isPending ? '保存中...' : (isEdit ? '保存' : '创建')}
            </Button>
          </div>
        </div>

        {/* === 右: 预览 + 标签参考 === */}
        <div className="col-span-5 flex flex-col gap-3">
          {/* 预览 pane */}
          <div className="flex min-h-[300px] flex-1 flex-col rounded-md border bg-card">
            <div className="flex items-center justify-between border-b bg-secondary/30 px-3 py-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium">
                <Eye className="h-3 w-3" />
                实时预览
              </div>
              {previewQ.isFetching && <span className="text-[10px] text-muted-foreground">渲染中...</span>}
            </div>
            <div className="flex-1 overflow-auto p-3">
              {previewQ.data?.errors && previewQ.data.errors.length > 0 ? (
                <div className="space-y-1">
                  {previewQ.data.errors.map((e, i) => (
                    <div key={i} className="flex items-start gap-1.5 rounded border border-red-200 bg-red-50 p-2 text-[10px] text-red-700">
                      <AlertCircle className="h-3 w-3 flex-shrink-0" />
                      <span>{e}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="prose prose-sm max-w-none text-[12px]"
                  dangerouslySetInnerHTML={{
                    __html: previewQ.data?.html || '<div style="padding:1rem;color:#aaa">编辑 HTML 后自动预览</div>',
                  }}
                />
              )}
            </div>
            {previewQ.data?.warnings && previewQ.data.warnings.length > 0 && (
              <div className="border-t bg-amber-50 px-3 py-1.5 text-[10px] text-amber-700">
                ⚠ {previewQ.data.warnings.join(' · ')}
              </div>
            )}
          </div>

          {/* 标签参考面板 */}
          {showTags && (
            <div className="rounded-md border bg-secondary/20 p-2">
              <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium">
                <BookOpen className="h-3 w-3" />
                HY_ 标签参考 ({SCOPE_LABELS[scope]})
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {filteredTags.map((t) => (
                  <button
                    key={t.code}
                    onClick={() => {
                      setHtml((h) => h + t.example);
                      toast.success(`已插入 ${t.code}`);
                    }}
                    className="group flex w-full items-start gap-2 rounded border bg-card p-1.5 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                  >
                    <code className="flex-shrink-0 rounded bg-secondary px-1 py-0.5 font-mono text-[10px]">
                      {t.code}
                    </code>
                    <span className="flex-1 text-[10px] text-muted-foreground">{t.desc}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[9px] text-muted-foreground">
                点击标签插入到 HTML 末尾
              </p>
            </div>
          )}

          {/* 校验详情 */}
          {validateQ.data && (
            <div className="rounded-md border bg-secondary/20 p-2 text-[10px]">
              <div className="mb-1 font-medium text-foreground">校验结果</div>
              {Object.keys(validateQ.data.tag_stats).length > 0 && (
                <div className="space-y-0.5 text-muted-foreground">
                  {Object.entries(validateQ.data.tag_stats).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <code className="font-mono">{k}</code>
                      <span className="tabular-nums">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* P3.6.2: HY_ 标签自动补全 (输入 {{ 触发) */}
      <TagAutocompletePopover
        open={acOpen}
        tags={filteredTags as TagItem[]}
        filter={acFilter}
        position={acPos}
        onSelect={(t) => {
          // 插入到 {{ 位置: 删 {{, 插 <tag /> 或完整 example
          const ta = htmlRef.current;
          if (!ta) return;
          const cur = ta.selectionStart ?? 0;
          const before = html.slice(0, cur);
          const lastBrace = before.lastIndexOf('{{');
          if (lastBrace < 0) {
            setAcOpen(false);
            return;
          }
          // 删 {{ + 已输入 filter, 插 code
          const newHtml = html.slice(0, lastBrace) + t.code + html.slice(cur);
          setHtml(newHtml);
          setAcOpen(false);
          // 光标移到 code 之后
          setTimeout(() => {
            const newPos = lastBrace + t.code.length;
            ta.focus();
            ta.setSelectionRange(newPos, newPos);
          }, 0);
        }}
        onClose={() => setAcOpen(false)}
      />
    </Modal>
  );
}

// === 校验状态徽章 ===
function ValidationBadge({ result, loading }: { result: LayoutValidateResult; loading: boolean }) {
  if (loading) return <span className="text-[10px] text-muted-foreground">校验中...</span>;
  if (!result.valid) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
        <AlertCircle className="h-3 w-3" />
        {result.errors.length} 错误
      </span>
    );
  }
  if (result.warnings.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
        <AlertTriangle className="h-3 w-3" />
        {result.warnings.length} 警告
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
      <Check className="h-3 w-3" />
      校验通过
    </span>
  );
}

// === hook: debounce ===
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
