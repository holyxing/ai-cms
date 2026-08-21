// CategoryTree.tsx - 栏目树 (P2.8 D2 完整版 + P3.6.2 侧栏三 tab)
// 依据: docs/17-站点树重构.md §5.3 §5.4
//
// 功能:
// - 树渲染 + 折叠 + 选中
// - 三种右键菜单 (Q5C: 空白/栏目节点/站点根)
// - dnd-kit 拖拽改 parent (OQ3 拖到根)
// - 节点"+"按钮
// - P3.6.2: 侧栏 3 tab [栏目 / 模板 / 媒体库] 一栏多视图
import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  Plus,
  Loader2,
  FolderPlus,
  Pencil,
  Copy,
  Trash2,
  MoreHorizontal,
  FilePlus,
  FileSpreadsheet,
  Image as ImageIcon,
  FileCode,
  FolderTree as FolderTreeIcon,
  Film,
  Music,
  FolderArchive,
  X,
  Boxes,
  LayoutList,
} from 'lucide-react';
import { categoriesApi, type CategoryNode } from '@/api/categories';
import { layoutsApi } from '@/api/layouts';
import { mediaApi } from '@/api/media';
import { siteAssetsApi, ASSET_CATEGORIES, CATEGORY_META, type AssetCategory } from '@/api/siteAssets';
import { siteTrashApi } from '@/api/siteTrash';
import { ContextMenu, type MenuItem } from '@/components/ui/ContextMenu';
import { CreateCategoryDialog } from './CreateCategoryDialog';
import { ImportCategoriesDialog } from './ImportCategoriesDialog';
import { CategorySettingsDialog } from './CategorySettingsDialog';
import { cn } from '@/lib/utils';
import { useTabsStore } from '@/stores/tabs';
import { toast } from 'sonner';

interface Props {
  siteId: string | null;
  selectedId: string | null;
  onSelect?: (id: string) => void;
}

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  target:
    | { type: 'root' }
    | { type: 'node'; id: string; name: string; parentId: string | null };
}

export function CategoryTree({ siteId, selectedId, onSelect }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // P3.9.1+ (holy 反馈 #11646): 当前正在编辑的 layout (从 tabs store 查 path 解析 layoutId)
  // 同步高亮 CategoryTree 模板行 + LayoutsPage LayoutCard
  // 注意: 不依赖 activeId (跳到 LayoutsPage 时 activeId 被重置), 用 lastAccessed 排序找最近一个
  const tabs = useTabsStore((s) => s.tabs);
  const currentLayoutId = useMemo(() => {
    const layoutTabs = tabs
      .filter((t) => /^\/sites\/[^/]+\/layouts\/[^/?]+/.test(t.pathname))
      .sort((a, b) => b.createdAt - a.createdAt);
    const tab = layoutTabs[0];
    if (!tab) return null;
    const m = tab.pathname.match(/^\/sites\/[^/]+\/layouts\/([^/?]+)/);
    return m ? m[1] : null;
  }, [tabs]);
  // P3.6.2 栏目树 / 模板 / 站点资源 三 tab 切换 (一栏多视图)
  const [sideTab, setSideTab] = useState<'tree' | 'templates' | 'media'>('tree');
  // 主内容路由变 → 左侧三 tab 跟路由同步（可手动切去预览，下次导航再对齐）
  useEffect(() => {
    const p = location.pathname;
    if (/^\/c\//.test(p) || p === '/contents') {
      setSideTab('tree');
    } else if (/\/layouts(\/|$)/.test(p) || p === '/layouts') {
      setSideTab('templates');
    } else if (/\/(assets|media)(\/|$)/.test(p)) {
      setSideTab('media');
    }
  }, [location.pathname]);
  // P3.6.2: 新建栏目 dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [createParentName, setCreateParentName] = useState<string | undefined>();
  // P7+: 从 Excel 导入栏目
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 从节点找父名 (给 dialog description)
  const findName = (id: string | null): string | undefined => {
    if (!id) return undefined;
    const walk = (ns: CategoryNode[]): string | undefined => {
      for (const n of ns) {
        if (n.id === id) return n.name;
        const sub = walk(n.children || []);
        if (sub) return sub;
      }
      return undefined;
    };
    return walk(tree);
  };
  const [menu, setMenu] = useState<MenuState>({
    open: false,
    x: 0,
    y: 0,
    target: { type: 'root' },
  });

  const treeQ = useQuery({
    queryKey: ['category-tree', siteId],
    queryFn: () => categoriesApi.tree(siteId!),
    enabled: !!siteId,
    staleTime: 30_000,
  });

  const trashCountsQ = useQuery({
    queryKey: ['site-trash-counts', siteId],
    queryFn: () => siteTrashApi.counts(siteId!),
    enabled: !!siteId,
    staleTime: 30_000,
  });

  // 通用: 新建栏目(根或子)
  const createMut = useMutation({
    mutationFn: (params: { name: string; parent_id: string | null; site_id: string }) =>
      categoriesApi.create(params.site_id, {
        name: params.name,
        slug: params.name
          .toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 64) || `cat-${Date.now()}`,
        parent_id: params.parent_id,
      }),
    onSuccess: (newCat, vars) => {
      toast.success(`栏目 "${newCat.name}" 已创建`);
      qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
      // 自动展开父
      if (vars.parent_id) {
        setExpanded((s) => new Set([...s, vars.parent_id!]));
      } else {
        setExpanded((s) => new Set([...s, newCat.id]));
      }
    },
    onError: (e: any) => toast.error(e?.message || '创建失败'),
  });

  // 重命名
  const renameMut = useMutation({
    mutationFn: (params: { id: string; name: string }) =>
      categoriesApi.update(params.id, { name: params.name }),
    onSuccess: () => {
      toast.success('已重命名');
      qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
    },
    onError: (e: any) => toast.error(e?.message || '重命名失败'),
  });

  // 删除
  const deleteMut = useMutation({
    mutationFn: (id: string) => categoriesApi.delete(id),
    onSuccess: () => {
      toast.success('已删除');
      qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
      qc.invalidateQueries({ queryKey: ['site-trash-counts', siteId] });
    },
    onError: (e: any) => toast.error(e?.message || '删除失败'),
  });

  // 复制
  const copyMut = useMutation({
    mutationFn: (id: string) => categoriesApi.copy(id, {}),
    onSuccess: (newCat) => {
      toast.success(`已复制为 "${newCat.name}"`);
      qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
    },
    onError: (e: any) => toast.error(e?.message || '复制失败'),
  });

  // 移动
  const moveMut = useMutation({
    mutationFn: (params: { id: string; parentId: string | null; position: number }) =>
      categoriesApi.move(params.id, params.parentId, params.position),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
    },
    onError: (e: any) => toast.error(e?.message || '移动失败'),
  });

  // === 推导型数据 (不是 hook, 仅为组织代码) ===
  const tree = treeQ.data?.tree ?? [];
  const draggingNode = draggingId ? findNode(tree, draggingId) : null;

  // P3.9.1+ (holy 反馈 #11266 补): selectedId 变化时自动展开其所有祖先
  // 场景: ContentDetail 路由下 selectedId 来自 content.category_id (不在 URL 里)
  //       新建文章/进入 article 页时, 左侧栏应当展开树并高亮
  useEffect(() => {
    if (!selectedId || tree.length === 0) return;
    const ancestors: string[] = [];
    const walk = (ns: CategoryNode[], path: string[]): boolean => {
      for (const n of ns) {
        if (n.id === selectedId) {
          ancestors.push(...path);
          return true;
        }
        if (n.children && walk(n.children, [...path, n.id])) return true;
      }
      return false;
    };
    walk(tree, []);
    if (ancestors.length > 0) {
      setExpanded((s) => {
        const next = new Set(s);
        for (const a of ancestors) next.add(a);
        return next;
      });
    }
  }, [selectedId, tree]);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const handleDragStart = (e: DragStartEvent) => {
    setDraggingId(e.active.id as string);
  };
  const handleDragEnd = (e: DragEndEvent) => {
    setDraggingId(null);
    const { active, over } = e;
    if (!over) return;
    if (active.id === over.id) return; // 拖到自己
    const activeNode = findNode(tree, active.id as string);
    if (!activeNode) return;

    if (over.id === '__root__') {
      moveMut.mutate({ id: activeNode.id, parentId: null, position: 0 });
      return;
    }

    const overNode = findNode(tree, over.id as string);
    if (!overNode) return;

    // 同级拖到兄弟节点上：按同级排序处理，而不是改成对方的子栏目
    if (activeNode.parent_id === overNode.parent_id) {
      const siblings = findSiblings(tree, activeNode.parent_id);
      const position = siblings.findIndex((n) => n.id === overNode.id);
      moveMut.mutate({
        id: activeNode.id,
        parentId: activeNode.parent_id,
        position: position < 0 ? 0 : position,
      });
      return;
    }

    // 跨级拖拽：默认拖进目标栏目下，排到最前
    moveMut.mutate({ id: activeNode.id, parentId: overNode.id, position: 0 });
  };

  const handleCreateRoot = () => {
    if (!siteId) return;
    setCreateParentId(null);
    setCreateParentName(undefined);
    setCreateOpen(true);
  };

  // 右键菜单项构造
  const buildMenuItems = (): MenuItem[] => {
    if (menu.target.type === 'root') {
      return [
        {
          key: 'new-root',
          label: '新建顶级栏目',
          icon: FolderPlus,
          onClick: () => handleCreateRoot(),
        },
      ];
    }
    // 节点
    const t = menu.target;
    return [
      {
        key: 'new-child',
        label: '新建子栏目',
        icon: FolderPlus,
        onClick: () => {
          if (!siteId) return;
          setCreateParentId(t.id);
          setCreateParentName(t.name);
          setCreateOpen(true);
        },
      },
      {
        key: 'new-content',
        label: '在栏目下新建文章',
        icon: FilePlus,
        onClick: () => {
          // 跳到栏目内容页, 由用户点"新建文章"按钮
          navigate(`/c/${t.id}`);
          toast('已跳到栏目内容页,点击右上角"新建文章"');
        },
      },
      { key: 'divider-1', label: '', divider: true },
      {
        key: 'rename',
        label: '编辑',
        icon: Pencil,
        onClick: () => {
          setSettingsOpen(true);
        },
      },
      {
        key: 'copy',
        label: '复制栏目结构',
        icon: Copy,
        onClick: () => copyMut.mutate(t.id),
      },
      { key: 'divider-2', label: '', divider: true },
      {
        key: 'delete',
        label: '删除栏目及子栏目',
        icon: Trash2,
        danger: true,
        onClick: () => {
          if (window.confirm(`确认删除 "${t.name}" 及其所有子栏目?`)) {
            deleteMut.mutate(t.id);
          }
        },
      },
    ];
  };

  // 空态
  if (!siteId) {
    return (
      <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
        请先选择一个站点
      </div>
    );
  }
  if (treeQ.isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </div>
    );
  }
  if (treeQ.isError) {
    return (
      <div className="px-3 py-4 text-[11px] text-destructive">栏目树加载失败</div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full flex-col">
        {/* P3.6.2: Tab 栏 — 栏目 / 模板 / 媒体库 (同行) */}
        <div
          className="flex items-center gap-0.5 border-b px-2 py-1.5"
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ open: true, x: e.clientX, y: e.clientY, target: { type: 'root' } });
          }}
        >
          <SideTab
            active={sideTab === 'tree'}
            onClick={() => setSideTab('tree')}
            icon={<FolderTreeIcon className="h-3.5 w-3.5" strokeWidth={2} />}
            label="栏目"
          />
          <SideTab
            active={sideTab === 'templates'}
            onClick={() => setSideTab('templates')}
            icon={<FileCode className="h-3.5 w-3.5" strokeWidth={2} />}
            label="模板"
          />
          <SideTab
            active={sideTab === 'media'}
            onClick={() => setSideTab('media')}
            icon={<Boxes className="h-3.5 w-3.5" strokeWidth={2} />}
            label="站点资源"
          />
        </div>

        {/* 内容区 (根据 sideTab 切换) */}
        {sideTab === 'tree' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* 新建一级栏目 + Excel 导入 */}
            <div className="flex flex-shrink-0 items-center justify-center gap-1 border-b px-2 py-2">
              <button
                type="button"
                onClick={handleCreateRoot}
                className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-blue-100 hover:text-blue-600"
                title="新建栏目"
              >
                <Plus className="h-3 w-3 flex-shrink-0" strokeWidth={2.5} />
                新建栏目
              </button>
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-emerald-50 hover:text-emerald-600"
                title="从 Excel 批量导入栏目"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />
                导入 Excel
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
          {/* 根 droppable (拖到根) */}
          <RootDropZone siteId={siteId} isEmpty={tree.length === 0} />
          {tree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              setExpanded={setExpanded}
              selectedId={selectedId}
              isDragging={draggingId === node.id}
              onSelect={(id) => {
                setSideTab('tree');
                if (onSelect) {
                  onSelect(id);
                  return;
                }
                // 显式激活对应主 tab，避免仍停在旧 tab 高亮
                const title = findName(id) || '栏目';
                useTabsStore.getState().openTab({
                  pathname: `/c/${id}`,
                  search: '',
                  title,
                  icon: 'FolderTree',
                });
                navigate(`/c/${id}`);
              }}
              onContextMenu={(e, n) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({
                  open: true,
                  x: e.clientX,
                  y: e.clientY,
                  target: {
                    type: 'node',
                    id: n.id,
                    name: n.name,
                    parentId: n.parent_id,
                  },
                });
              }}
              onNewChild={(parent) => {
                if (!siteId) return;
                setCreateParentId(parent);
                setCreateParentName(findName(parent));
                setCreateOpen(true);
              }}
            />
          ))}
            </div>
          </div>
        ) : sideTab === 'templates' ? (
          <TemplatesPanel siteId={siteId!} navigate={navigate} currentLayoutId={currentLayoutId} />
        ) : (
          <AssetsDirTree siteId={siteId!} />
        )}

        {/* 侧栏底部：站点回收站 */}
        {siteId && (
          <div className="mt-auto flex-shrink-0 border-t px-2 py-2">
            <Link
              to={`/sites/${siteId}/recycle`}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-[12px] font-medium transition-colors',
                location.pathname === `/sites/${siteId}/recycle`
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <Trash2 className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />
              回收站
              {(trashCountsQ.data?.total ?? 0) > 0 && (
                <span className="ml-auto tabular-nums text-[10px] opacity-70">
                  {trashCountsQ.data!.total}
                </span>
              )}
            </Link>
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      <ContextMenu
        open={menu.open}
        x={menu.x}
        y={menu.y}
        items={buildMenuItems()}
        onClose={() => setMenu((m) => ({ ...m, open: false }))}
      />

      {/* 拖拽时的浮层 */}
      <DragOverlay>
        {draggingNode && (
          <div className="rounded-md border border-blue-500 bg-blue-50 px-2 py-1 text-[12px] font-medium text-blue-700 shadow-lg">
            <Folder className="mr-1 inline h-3.5 w-3.5" />
            {draggingNode.name}
          </div>
        )}
      </DragOverlay>

      {/* P3.6.2: 新建栏目 dialog (slug + template 两字段) */}
      {siteId && (
        <CreateCategoryDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          siteId={siteId}
          parentId={createParentId}
          parentName={createParentName}
          onCreated={(c) => {
            // 自动展开父 + 选中新建项
            if (createParentId) setExpanded((s) => new Set([...s, createParentId]));
            else setExpanded((s) => new Set([...s, c.id]));
          }}
        />
      )}

      {siteId && menu.target.type === 'node' && (
        <CategorySettingsDialog
          open={settingsOpen}
          category={findNode(tree, menu.target.id)}
          siteId={siteId}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            toast.success('栏目设置已保存');
            qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
          }}
        />
      )}

      {/* P7+: 从 Excel 批量导入 */}
      {siteId && (
        <ImportCategoriesDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          siteId={siteId}
        />
      )}
    </DndContext>
  );
}

// === 根 droppable (拖到根) ===

function RootDropZone({ siteId: _siteId, isEmpty }: { siteId: string; isEmpty: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: '__root__' });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'mb-1 rounded-sm border border-dashed border-transparent px-2 py-1 text-xs transition-colors',
        isOver && 'border-blue-500 bg-blue-50/50 text-blue-700',
        !isOver && isEmpty && 'text-muted-foreground'
      )}
    >
      {isOver ? '↓ 拖到这里作为顶级栏目' : isEmpty ? '还没有栏目，点击上方「新建栏目」' : ''}
    </div>
  );
}

// === 节点 ===

interface NodeProps {
  node: CategoryNode;
  depth: number;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedId: string | null;
  isDragging: boolean;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, node: CategoryNode) => void;
  onNewChild: (parentId: string) => void;
}

function TreeNode({
  node,
  depth,
  expanded,
  setExpanded,
  selectedId,
  isDragging,
  onSelect,
  onContextMenu,
  onNewChild,
}: NodeProps) {
  const isExpanded = expanded.has(node.id);
  const isSelected = node.id === selectedId;
  const hasChildren = (node.children?.length ?? 0) > 0;

  // dnd-kit
  const { attributes, listeners, setNodeRef: dragRef, isDragging: dndDragging } = useDraggable({
    id: node.id,
  });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: node.id });

  return (
    <div>
      <div
        ref={(el) => {
          dragRef(el);
          dropRef(el);
        }}
        {...attributes}
        {...listeners}
        className={cn(
          'group flex h-8 cursor-pointer items-center gap-1 rounded-md text-[13px] transition-all',
          isSelected
            ? 'bg-blue-50 font-medium text-blue-700 shadow-sm ring-1 ring-blue-200'
            : isOver
              ? 'bg-blue-50/70 ring-2 ring-blue-400'
              : 'text-foreground hover:bg-secondary/60',
          (isDragging || dndDragging) && 'opacity-30',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px`, paddingRight: '8px' }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node.id);
        }}
        onContextMenu={(e) => onContextMenu(e, node)}
      >
        {/* 折叠箭头 */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((s) => {
                const next = new Set(s);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                return next;
              });
            }}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                isExpanded && 'rotate-90',
              )}
              strokeWidth={2.5}
            />
          </button>
        ) : (
          <span className="w-5 flex-shrink-0" />
        )}

        {/* 有子栏目=文件夹；叶子栏目=列表区块（非文件夹形态） */}
        {hasChildren ? (
          isExpanded ? (
            <FolderOpen className="h-4 w-4 flex-shrink-0 text-amber-500" strokeWidth={2} />
          ) : (
            <Folder className="h-4 w-4 flex-shrink-0 text-amber-500" strokeWidth={2} />
          )
        ) : (
          <LayoutList className="h-4 w-4 flex-shrink-0 text-sky-500" strokeWidth={2} />
        )}

        <span className="flex-1 truncate">{node.name}</span>

        {/* 文章数 */}
        {node.content_count > 0 && (
          <span className="mr-0.5 text-[10px] text-muted-foreground tabular-nums">
            {node.content_count}
          </span>
        )}

        {/* hover 时显示的"+"按钮 (新建子栏目) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNewChild(node.id);
          }}
          className="mr-1 hidden h-4 w-4 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-blue-100 hover:text-blue-600 group-hover:flex"
          title="新建子栏目"
        >
          <Plus className="h-3 w-3" strokeWidth={2.5} />
        </button>

        {/* hover 时显示的"⋯"按钮 (右键菜单的快捷入口) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onContextMenu(
              {
                ...e,
                clientX: rect.right - 180,
                clientY: rect.bottom,
                preventDefault: () => {},
              } as React.MouseEvent,
              node,
            );
          }}
          className="mr-0.5 hidden h-4 w-4 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground group-hover:flex"
          title="更多操作"
        >
          <MoreHorizontal className="h-3 w-3" strokeWidth={2.5} />
        </button>
      </div>

      {hasChildren && isExpanded && (
        <div>
          {(node.children || []).map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              setExpanded={setExpanded}
              selectedId={selectedId}
              isDragging={isDragging}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              onNewChild={onNewChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// === 工具 ===

function findNode(tree: CategoryNode[], id: string): CategoryNode | null {
  for (const n of tree) {
    if (n.id === id) return n;
    const f = findNode(n.children || [], id);
    if (f) return f;
  }
  return null;
}

function findSiblings(tree: CategoryNode[], parentId: string | null): CategoryNode[] {
  if (!parentId) return tree;
  const parent = findNode(tree, parentId);
  return parent?.children || [];
}

// 递归收集所有节点 id (用于「展开全部」)
function collectAllIds(acc: Set<string>, nodes: CategoryNode[]): Set<string> {
  for (const n of nodes) {
    acc.add(n.id);
    if (n.children?.length) collectAllIds(acc, n.children);
  }
  return acc;
}

// === 侧边栏 tab 按钮 (栏目 / 模板 / 媒体库) ===
function SideTab({
  active, onClick, icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium transition-colors',
        active
          ? 'bg-blue-50 text-blue-700'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// === 模板面板: 列出该站点所有 scope 模板 (跟 /admin/layouts 一致) ===
function TemplatesPanel({ siteId, navigate, currentLayoutId }: { siteId: string; navigate: ReturnType<typeof useNavigate>; currentLayoutId: string | null }) {
  const tplQ = useQuery({
    queryKey: ['all-templates', siteId],
    queryFn: () => layoutsApi.list(siteId),
    enabled: !!siteId,
    staleTime: 60_000,
  });

  const tpls = tplQ.data?.items ?? [];

  // P3.9.1+ (holy 反馈 #11619 重需): 侧栏 2 级展开
  // 1. 默认: 5 scope 目录 + count (不显示模板名)
  // 2. 点 scope: 展开下面模板名
  // 3. 点模板名: 跳 LayoutEditPage
  const [expandedScope, setExpandedScope] = useState<string | null>(null);

  const SCOPE_GROUP_ORDER = ['site', 'category', 'content', 'home', 'partial'] as const;
  const SCOPE_LABELS: Record<string, string> = {
    site: '站点布局',
    category: '栏目模板',
    content: '详情模板',
    home: '首页模板',
    partial: '子模板',
  };
  const SCOPE_COLOR: Record<string, string> = {
    site: 'text-blue-700 bg-blue-50',
    category: 'text-violet-700 bg-violet-50',
    content: 'text-emerald-700 bg-emerald-50',
    home: 'text-orange-700 bg-orange-50',
    partial: 'text-purple-700 bg-purple-50',
  };
  const SCOPE_SHORT: Record<string, string> = {
    site: '站',
    category: '栏',
    content: '详',
    home: '首',
    partial: '子',
  };
  // 按 scope 聚合
  const byScope: Record<string, typeof tpls> = {};
  for (const t of tpls) {
    (byScope[t.scope] ||= []).push(t);
  }
  // 5 个 scope (含空), 跟 LayoutsPage 一致
  const allScopes = SCOPE_GROUP_ORDER;

  return (
    <div className="flex h-full flex-col">
      {/* 工具条: 标签说明 + 新建 + 管理 */}
      <div className="flex items-center gap-1 border-b bg-secondary/15 px-2 py-1.5 flex-shrink-0">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          站点模板
        </span>
        <span className="rounded bg-secondary px-1.5 py-px text-[10px] font-medium tabular-nums text-muted-foreground">
          {tpls.length}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Link
            to="/layouts"
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-secondary"
            title="在「模板」管理页新建模板"
          >
            <Plus className="h-3 w-3" strokeWidth={2.5} />
            新建
          </Link>
          <Link
            to="/layouts"
            className="inline-flex h-6 items-center gap-0.5 rounded px-1.5 text-[10.5px] text-blue-600 transition-colors hover:bg-blue-50"
            title="打开模板管理"
          >
            管理
          </Link>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {tplQ.isLoading && (
          <div className="flex items-center gap-1.5 px-2 py-3 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            加载中...
          </div>
        )}
        {!tplQ.isLoading && tpls.length === 0 && (
          <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
            还没有模板
            <div className="mt-1.5">
              <Link
                to="/layouts"
                className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
              >
                去模板管理 →
              </Link>
            </div>
          </div>
        )}
        {/* P3.9.1+ (holy 反馈 #11619): 5 scope 目录 + count, 点展开下面模板名 */}
        {allScopes.map((scope) => {
          const scopeTpls = byScope[scope] ?? [];
          const count = scopeTpls.length;
          const isExpanded = expandedScope === scope;
          // P3.9.1+ (holy 反馈 #11646): 当前 layout 属于该 scope, scope 行也轻微高亮
          const hasCurrent = !!currentLayoutId && scopeTpls.some((t) => t.id === currentLayoutId);
          return (
            <div key={scope} className="mt-0.5">
              {/* 目录行 (可点) */}
              <button
                onClick={() => setExpandedScope(isExpanded ? null : scope)}
                className={cn(
                  'group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors',
                  isExpanded
                    ? 'bg-blue-50/60 text-blue-700'
                    : hasCurrent
                    ? 'bg-blue-50/30 text-blue-700'
                    : 'text-foreground hover:bg-secondary/60',
                )}
                disabled={count === 0}
                title={count === 0 ? '该目录暂无模板' : `点击展开 (${count} 个)`}
              >
                {/* 展开箭头 */}
                {count > 0 ? (
                  isExpanded ? (
                    <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                  )
                ) : (
                  <span className="h-3 w-3 flex-shrink-0" />
                )}
                <span className={cn('rounded px-1.5 py-px text-[9.5px] font-medium', SCOPE_COLOR[scope])}>
                  {SCOPE_SHORT[scope]}
                </span>
                <span className="flex-1 truncate font-medium">{SCOPE_LABELS[scope]}</span>
                <span className={cn(
                  'flex-shrink-0 rounded px-1 text-[9.5px] font-mono',
                  isExpanded ? 'bg-blue-100 text-blue-700' : 'bg-secondary text-muted-foreground',
                )}>
                  {count}
                </span>
              </button>
              {/* 展开的模板名列表 (P3.9.1+ 跟 LayoutsPage 选中态一致: 蓝边/蓝底) */}
              {isExpanded && count > 0 && (
                <div className="ml-3 mt-0.5 space-y-0.5 border-l border-blue-200/60 pl-1.5">
                  {scopeTpls.map((t) => {
                    const isCurrent = t.id === currentLayoutId;
                    return (
                      <button
                        key={t.id}
                        onClick={() => navigate(`/sites/${siteId}/layouts/${t.id}`)}
                        className={cn(
                          'group/tpl flex w-full items-center gap-1.5 rounded-md border bg-card px-1.5 py-1 text-left text-[11.5px] transition-colors',
                          // P3.9.1+ (holy 反馈 #11646): 当前正在编辑的 layout 选中态 (蓝边/蓝底)
                          isCurrent
                            ? 'border-blue-500 bg-blue-50/60 ring-1 ring-blue-200'
                            : 'border-transparent hover:border-blue-300 hover:bg-blue-50/40',
                        )}
                        title={`点击进入「${t.name}」编辑工作区`}
                      >
                        <FileCode className={cn(
                          'h-3 w-3 flex-shrink-0',
                          isCurrent ? 'text-blue-700' : 'text-blue-600',
                        )} strokeWidth={2} />
                        <span className={cn(
                          'flex-1 truncate font-medium',
                          isCurrent ? 'text-blue-700' : 'text-foreground',
                        )}>{t.name}</span>
                        {t.is_default && (
                          <span className="rounded bg-blue-100 px-1 py-px text-[9px] font-medium text-blue-700">默认</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// === 站点资源目录 (侧栏 tab: CSS / JS / 图片) ===
function AssetsDirTree({ siteId }: { siteId: string }) {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.openTab);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!siteId) return;
    let active = true;
    Promise.all(
      ASSET_CATEGORIES.map((c) =>
        siteAssetsApi.list(siteId, c).then((r) => [c, r.total ?? r.items.length] as const),
      ),
    )
      .then((pairs) => {
        if (!active) return;
        setCounts(Object.fromEntries(pairs));
      })
      .catch(() => { /* 侧栏计数失败时静默 */ });
    return () => { active = false; };
  }, [siteId]);

  const openAssets = (cat?: AssetCategory) => {
    // search 不含 '?'，与 tabs.tabId / syncWithLocation 约定一致
    const qs = cat ? `cat=${cat}` : '';
    const pathname = `/sites/${siteId}/assets`;
    openTab({ pathname, search: qs, title: '站点资源', icon: 'Boxes' });
    navigate(qs ? `${pathname}?${qs}` : pathname);
  };

  const dirs: { key: AssetCategory; icon: typeof FileCode }[] = [
    { key: 'css', icon: FileCode },
    { key: 'js', icon: FileCode },
    { key: 'assets', icon: ImageIcon },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center gap-1 border-b bg-secondary/15 px-2 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          站点资源
        </span>
        <button
          type="button"
          onClick={() => openAssets()}
          className="ml-auto inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-secondary"
          title="打开站点资源"
        >
          <Boxes className="h-3 w-3" strokeWidth={2.5} />
          打开
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 py-1">
        {dirs.map((d) => {
          const Icon = d.icon;
          const meta = CATEGORY_META[d.key];
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => openAssets(d.key)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-foreground transition-colors hover:bg-secondary"
            >
              <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" strokeWidth={2} />
              <span className="flex-1 text-left">{meta.label}</span>
              {counts[d.key] !== undefined && (
                <span className="flex-shrink-0 rounded px-1 text-[10px] tabular-nums text-muted-foreground/70">
                  {counts[d.key]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// === 媒体库目录树 (P3.6.2): 全部/图片/视频/音频/PDF/压缩包 ===
function MediaDirTree({
  siteId, selectedMime, onSelectMime,
}: {
  siteId: string;
  selectedMime: string | undefined;
  onSelectMime: (mime: string | undefined) => void;
}) {
  // P3.9.7+ (holy 反馈 #12808): 目录项点击 = 主区打开媒体库 tab (带 ?mime= filter)
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.openTab);
  const openMediaWithFilter = (mime: string | undefined) => {
    const qs = mime ? `?mime=${encodeURIComponent(mime)}` : '';
    openTab({ pathname: `/sites/${siteId}/media`, search: qs, title: '媒体库', icon: 'image' });
    navigate(`/sites/${siteId}/media${qs}`);
    // 侧栏的内嵌视图 state 同步
    onSelectMime(mime);
  };
  // 目录项定义
  const dirs = [
    { key: undefined, label: '全部', icon: Folder },
    { key: 'image/', label: '图片', icon: ImageIcon },
    { key: 'video/', label: '视频', icon: Film },
    { key: 'audio/', label: '音频', icon: Music },
    { key: 'application/pdf', label: 'PDF', icon: FileText },
    { key: 'application/zip', label: '压缩包', icon: FolderArchive },
  ] as const;

  // P3.9.6+ (holy 反馈 #12723): 并发拉各类别 total, 侧栏目录项右边显示 N 个
  // P3.9.6+ 修: useQueries 在 StrictMode 下 fetch 被取消, 改用 useEffect + 并发 fetch + cache
  const countMap = useMediaDirCounts(siteId);

  return (
    <div className="flex h-full flex-col">
      {/* 工具条: 标签 + 去管理媒体库 */}
      <div className="flex items-center gap-1 border-b bg-secondary/15 px-2 py-1.5 flex-shrink-0">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          媒体库
        </span>
        <Link
          to={`/c/${siteId}/media`}
          className="ml-auto inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-secondary"
          title="打开媒体库管理页 (上传/浏览/引用)"
        >
          <ImageIcon className="h-3 w-3" strokeWidth={2.5} />
          打开
        </Link>
      </div>
      {/* 目录树 (可滚动) */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1 space-y-0.5 min-h-0">
        {dirs.map((d) => {
          const Icon = d.icon;
          const active = selectedMime === d.key;
          return (
            <button
              key={d.key ?? 'all'}
              onClick={() => openMediaWithFilter(d.key === selectedMime ? undefined : d.key)}
              className={cn(
                'w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors',
                active
                  ? 'bg-blue-50 font-medium text-blue-700'
                  : 'text-foreground hover:bg-secondary',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', active ? 'text-blue-600' : 'text-muted-foreground')} strokeWidth={2} />
              <span className="flex-1 text-left">{d.label}</span>
              {/* P3.9.6+ (#12723): 各类别文件数 (加载中隐藏) */}
              {countMap[d.key ?? 'all'] !== undefined && (
                <span className={cn(
                  'text-[10px] tabular-nums flex-shrink-0 px-1 rounded',
                  active ? 'text-blue-600' : 'text-muted-foreground/70'
                )}>
                  {countMap[d.key ?? 'all']}
                </span>
              )}
              {active && (
                <X
                  className="h-3 w-3 text-blue-500 hover:text-blue-700"
                  onClick={(e) => { e.stopPropagation(); openMediaWithFilter(undefined); }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* 选中目录后, 在下方展开显示该类型的文件列表 (仍在 sidebar 内) */}{selectedMime !== undefined && (
        <div className="border-t flex-shrink-0">
          <MediaDirFileList siteId={siteId} mimePrefix={selectedMime} />
        </div>
      )}
    </div>
  );
}

// === 媒体库目录内嵌文件列表 (P3.6.2): 仅在 sidebar 240px 内显示, 紧凑 */}
function MediaDirFileList({
  siteId, mimePrefix,
}: {
  siteId: string;
  mimePrefix: string | undefined;
}) {
  // 复用 mediaApi.list(), 仅显示缩略图列表 (无工具栏/搜索)
  const itemsQ = useQuery({
    queryKey: ['media-dir', siteId, mimePrefix],
    queryFn: () => mediaApi.list(siteId, { page: 1, page_size: 30, mime_prefix: mimePrefix }),
    enabled: !!siteId,
    staleTime: 30_000,
  });

  const items: any[] = (itemsQ.data as any)?.items ?? [];

  return (
    <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
      <div className="px-2 py-1.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
            {mimePrefix === 'image/' ? '图片' : mimePrefix === 'video/' ? '视频' : mimePrefix === 'audio/' ? '音频' : mimePrefix === 'application/pdf' ? 'PDF' : mimePrefix === 'application/zip' ? '压缩包' : '全部'} 文件
          </span>
          <span className="text-[10px] text-muted-foreground">{items.length}</span>
        </div>
        {itemsQ.isLoading && (
          <div className="flex items-center justify-center py-4 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin mr-1" />加载中
          </div>
        )}
        {!itemsQ.isLoading && items.length === 0 && (
          <div className="text-center py-3 text-[11px] text-muted-foreground">暂无文件</div>
        )}
        <div className="space-y-1">
          {items.slice(0, 30).map((item: any) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-secondary/60 transition-colors cursor-pointer"
              title={item.filename}
            >
              {/* 缩略图 */}
              <div className="w-7 h-7 rounded bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
                {item.thumb_small_url ? (
                  <img src={item.thumb_small_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </div>
              {/* 文件名 */}
              <span className="flex-1 truncate text-[11px]">{item.filename}</span>
            </div>
          ))}
        </div>
        {items.length > 30 && (
          <div className="text-center pt-1.5 text-[10px] text-muted-foreground">
            还有 {items.length - 30} 个文件…
          </div>
        )}
      </div>
    </div>
  );
}

// === P3.9.6+ (holy 反馈 #12723): useMediaDirCounts — 并发拉各类别 total, 不用 useQueries (StrictMode 下会 abort) ===
const _mediaCountCache: Record<string, Record<string, number>> = {};
const _mediaCountPromises: Record<string, Promise<Record<string, number>>> = {};

function useMediaDirCounts(siteId: string | undefined): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!siteId) return;
    // 命中缓存直接用
    if (_mediaCountCache[siteId]) {
      setCounts(_mediaCountCache[siteId]);
      return;
    }
    // 复用 in-flight promise (StrictMode 双调也只发 1 次)
    let p = _mediaCountPromises[siteId];
    if (!p) {
      const mimeKeys: { key: string; label: string }[] = [
        { key: '', label: '全部' },
        { key: 'image/', label: '图片' },
        { key: 'video/', label: '视频' },
        { key: 'audio/', label: '音频' },
        { key: 'application/pdf', label: 'PDF' },
        { key: 'application/zip', label: '压缩包' },
      ];
      p = Promise.all(
        mimeKeys.map((m) =>
          mediaApi
            .list(siteId, { page: 1, page_size: 1, mime_prefix: m.key || undefined })
            .then((r: any) => {
              // r 是 axios response, body 是 APIResponse<{items, total, page, page_size}>
              // APIResponse = { data: { items, total, ... } }
              // 所以 r.data.data.total 才是真正的 total
              const total = r?.data?.data?.total ?? r?.data?.total ?? 0;
              return [m.key || 'all', total] as const;
            })
            .catch(() => [m.key || 'all', 0] as const),
        ),
      ).then((pairs) => {
        const map: Record<string, number> = {};
        pairs.forEach(([k, v]) => { map[k] = v; });
        _mediaCountCache[siteId] = map;
        delete _mediaCountPromises[siteId];
        return map;
      });
      _mediaCountPromises[siteId] = p;
    }
    let cancelled = false;
    p.then((map) => { if (!cancelled) setCounts(map); });
    return () => { cancelled = true; };
  }, [siteId]);
  return counts;
}
