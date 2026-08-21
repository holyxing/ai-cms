// CategoryTree.tsx - 栏目树 (P2.8 D2 完整版 + P3.6.2 侧栏三 tab)
// 依据: docs/17-站点树重构.md §5.3 §5.4
//
// 功能:
// - 树渲染 + 折叠 + 选中
// - 三种右键菜单 (Q5C: 空白/栏目节点/站点根)
// - dnd-kit 拖拽改 parent (OQ3 拖到根)
// - 节点"+"按钮
// - P3.6.2: 侧栏 3 tab [栏目 / 模板 / 媒体库] 一栏多视图
import { useState, useRef, useMemo } from 'react';
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
  Image as ImageIcon,
  FileCode,
  FolderTree as FolderTreeIcon,
  Film,
  Music,
  FolderArchive,
  X,
  FileText,
  Loader2,
} from 'lucide-react';
import { categoriesApi, type CategoryNode } from '@/api/categories';
import { mediaApi } from '@/api/media';
import { ContextMenu, type MenuItem } from '@/components/ui/ContextMenu';
import { CreateCategoryDialog } from './CreateCategoryDialog';
import { cn } from '@/lib/utils';
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
  // P3.6.2 栏目树 / 模板 / 媒体库 三 tab 切换 (一栏多视图)
  const [sideTab, setSideTab] = useState<'tree' | 'templates' | 'media'>('tree');
  // P3.6.2: 媒体库 tab 选中的 mime 类型 (全部/图片/视频/音频/PDF/压缩包)
  const [mediaMime, setMediaMime] = useState<string | undefined>(undefined);
  // P3.6.2: 新建栏目 dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [createParentName, setCreateParentName] = useState<string | undefined>();
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
    mutationFn: (params: { id: string; parentId: string | null }) =>
      categoriesApi.move(params.id, params.parentId, 0),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
    },
    onError: (e: any) => toast.error(e?.message || '移动失败'),
  });

  // === 推导型数据 (不是 hook, 仅为组织代码) ===
  const tree = treeQ.data?.tree ?? [];
  // P3.6.2: 栏目总数 (含子) - 给侧边 tab badge
  const treeCount = useMemo(() => {
    let n = 0;
    const walk = (nodes: CategoryNode[]) => {
      for (const x of nodes) { n++; if (x.children?.length) walk(x.children); }
    };
    walk(tree);
    return n;
  }, [tree]);
  const draggingNode = draggingId ? findNode(tree, draggingId) : null;

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
    const newParentId = over.id === '__root__' ? null : (over.id as string);
    moveMut.mutate({ id: active.id as string, parentId: newParentId });
  };

  // 右键菜单项构造
  const buildMenuItems = (): MenuItem[] => {
    if (menu.target.type === 'root') {
      return [
        {
          key: 'new-root',
          label: '新建顶级栏目',
          icon: FolderPlus,
          onClick: () => {
            if (!siteId) return;
            setCreateParentId(null);
            setCreateParentName(undefined);
            setCreateOpen(true);
          },
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
        label: '重命名',
        icon: Pencil,
        onClick: () => {
          const name = window.prompt('新名称', t.name);
          if (name?.trim() && name !== t.name) {
            renameMut.mutate({ id: t.id, name: name.trim() });
          }
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
        <div className="flex items-center gap-0.5 border-b px-2 py-1.5">
          <SideTab
            active={sideTab === 'tree'}
            onClick={() => setSideTab('tree')}
            icon={<FolderTreeIcon className="h-3.5 w-3.5" strokeWidth={2} />}
            label="栏目"
            count={treeCount}
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
            icon={<ImageIcon className="h-3.5 w-3.5" strokeWidth={2} />}
            label="媒体库"
          />
        </div>

        {/* 内容区 (根据 sideTab 切换) */}
        {sideTab === 'tree' ? (
          <div className="flex-1 flex flex-col min-h-0">
            {/* 工具条: 新建顶级栏目 + 展开/折叠全部 */}
            <div className="flex items-center gap-1 border-b bg-secondary/15 px-2 py-1.5 flex-shrink-0">
              <button
                onClick={() => {
                  if (!siteId) return;
                  setCreateParentId(null);
                  setCreateParentName(undefined);
                  setCreateOpen(true);
                }}
                disabled={createMut.isPending}
                className="inline-flex h-6 items-center gap-1 rounded-md bg-blue-600 px-2 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
                title="新建顶级栏目"
              >
                <Plus className="h-3 w-3" strokeWidth={2.5} />
                新建顶级栏目
              </button>
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  onClick={() => setExpanded(collectAllIds(new Set(), tree))}
                  className="inline-flex h-6 items-center gap-0.5 rounded px-1.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="展开全部"
                  disabled={treeCount === 0}
                >
                  <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
                  展开
                </button>
                <button
                  onClick={() => setExpanded(new Set())}
                  className="inline-flex h-6 items-center gap-0.5 rounded px-1.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="折叠全部"
                  disabled={treeCount === 0}
                >
                  <ChevronRight className="h-3 w-3 rotate-90 strokeWidth={2.5} />
                  折叠
                </button>
              </div>
            </div>
            {/* 树区 (可滚动) */}
            <div className={cn("flex-1 overflow-y-auto px-1.5 py-1 min-h-0")}>
</div>
        </>
      ) : sideTab === "templates" ? (
        <span>else</span>
      ) : (
        <span>media</span>
      )}
    </DndContext>
  );
}
