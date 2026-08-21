// TabBar.tsx - 顶部 tab 栏 (P3.8.6 holy 反馈 #10544: tab 加 icon + 更好用更好看)
//
// 设计 (跟 design system 一致, 参考 Notion/Linear/Vercel):
// - 高度 38px, 横向滚动
// - 单个 tab: icon (彩色, 按 type) + title + 关闭 X
// - 激活态: 白底 + 2px 蓝条 + icon 蓝 + 文字前景色
// - 普通态: 透明 + 灰 icon + 灰文字
// - hover: 浅灰底 + X 出现
// - pinned: 蓝点 (左) 标识, 不可关
// - 中键关闭, 右键 ContextMenu, 拖拽排序
// - 滚动到视野 (active 时)
// - drop placeholder (虚线蓝条)

import { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Pin, Circle, Plus, type LucideIcon } from 'lucide-react';
import { useTabsStore, type Tab } from '@/stores/tabs';
import { cn } from '@/lib/utils';
import { ContextMenu, type MenuItem } from '@/components/ui/ContextMenu';
import { dynamicIcon } from '@/lib/tabMeta';

/** 不同路由类型 → icon 颜色 (类名, 紧凑小调色板) */
const ICON_COLOR: Record<string, string> = {
  // 静态
  LayoutDashboard: 'text-blue-500',
  FileCode: 'text-violet-500',
  Palette: 'text-pink-500',
  Rocket: 'text-orange-500',
  Cpu: 'text-emerald-500',
  History: 'text-emerald-500',
  Users: 'text-cyan-500',
  Shield: 'text-amber-500',
  Key: 'text-amber-600',
  Trash2: 'text-red-500',
  Settings: 'text-slate-500',
  Search: 'text-slate-400',
  Globe: 'text-blue-500',
  ImageIcon: 'text-fuchsia-500',
  BookOpen: 'text-indigo-500',
  // 动态
  Boxes: 'text-amber-500',
  Edit3: 'text-blue-500',
  FolderTree: 'text-teal-500',
  Building2: 'text-blue-600',
  Home: 'text-slate-400',
  // fallback
  default: 'text-slate-400',
};

function iconColor(name: string): string {
  return ICON_COLOR[name] ?? ICON_COLOR.default;
}

/** 拼出可导航 URL（search 约定不含 '?'，兼容旧数据带 '?'） */
function tabUrl(tab: Tab): string {
  const s = tab.search || '';
  if (!s) return tab.pathname;
  return tab.pathname + (s.startsWith('?') ? s : `?${s}`);
}

interface TabIconProps {
  name: string;
  isActive: boolean;
  size?: number;
}

function TabIcon({ name, isActive, size = 13 }: TabIconProps) {
  const Icon = dynamicIcon(name) as LucideIcon;
  // 激活态: 蓝 (跟品牌色统一), 非激活: 类型色
  return (
    <Icon
      className={cn(
        'flex-shrink-0',
        isActive ? 'text-primary' : iconColor(name),
      )}
      strokeWidth={isActive ? 2.25 : 1.75}
      style={{ width: size, height: size }}
    />
  );
}

export function TabBar() {
  const { tabs, activeId, activate, closeTab, closeOthers, closeAll, closeRight, reorder } = useTabsStore();
  const navigate = useNavigate();
  const [contextMenu, setContextMenu] = useState<{ tab: Tab; x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState<{ id: string; pos: 'left' | 'right' } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // active tab 变 → 滚动到视野
  useEffect(() => {
    if (!barRef.current) return;
    const active = barRef.current.querySelector('[data-active="true"]') as HTMLElement | null;
    if (active) {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, [activeId]);

  // 中键关闭
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) {
        const target = (e.target as HTMLElement).closest('[data-tab-id]');
        if (target) {
          e.preventDefault();
          const id = target.getAttribute('data-tab-id')!;
          const tab = useTabsStore.getState().tabs.find((t) => t.id === id);
          if (tab && tab.closable) {
            const newActiveId = closeTab(id);
            if (newActiveId) {
              const t = useTabsStore.getState().tabs.find((tt) => tt.id === newActiveId);
              if (t) navigate(tabUrl(t));
            }
          }
        }
      }
    };
    el.addEventListener('mousedown', onMouseDown);
    return () => el.removeEventListener('mousedown', onMouseDown);
  }, [closeTab, navigate]);

  if (tabs.length === 0) return null;

  const handleActivate = (tab: Tab) => {
    if (tab.id !== activeId) {
      activate(tab.id);
      navigate(tabUrl(tab));
    }
  };

  const handleClose = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newActiveId = closeTab(id);
    if (newActiveId) {
      const t = useTabsStore.getState().tabs.find((tt) => tt.id === newActiveId);
      if (t) navigate(tabUrl(t));
    } else {
      navigate('/dashboard');
    }
  };

  const contextMenuItems = (tab: Tab): MenuItem[] => [
    { key: 'close', label: '关闭', disabled: !tab.closable, onClick: () => handleClose({ stopPropagation: () => {} } as any, tab.id) },
    { key: 'close-others', label: '关闭其他', onClick: () => closeOthers(tab.id) },
    { key: 'close-right', label: '关闭右侧', onClick: () => closeRight(tab.id) },
    { key: 'close-all', label: '关闭所有可关', onClick: () => closeAll() },
    { key: 'divider', label: '', divider: true, onClick: () => {} },
    { key: 'copy-url', label: '复制 URL', onClick: () => navigator.clipboard.writeText(window.location.origin + tab.pathname + tab.search) },
  ];

  return (
    <>
      <div
        ref={barRef}
        className="flex h-9.5 select-none items-end overflow-x-auto border-b bg-secondary/30 scrollbar-none"
        style={{ scrollbarWidth: 'none', height: '38px' }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const showLeftDrop = dragOver?.id === tab.id && dragOver.pos === 'left';
          const showRightDrop = dragOver?.id === tab.id && dragOver.pos === 'right';
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              data-active={isActive}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', tab.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const midX = rect.left + rect.width / 2;
                setDragOver({ id: tab.id, pos: e.clientX < midX ? 'left' : 'right' });
              }}
              onDragLeave={(e) => {
                // 离开 tab 自身才清 (避免子节点抖动)
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                  setDragOver(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const fromId = e.dataTransfer.getData('text/plain');
                if (fromId && fromId !== tab.id) reorder(fromId, tab.id);
                setDragOver(null);
              }}
              onClick={() => handleActivate(tab)}
              onAuxClick={(e) => {
                // 中键辅助 (mouseup 拦截已在 useEffect)
                e.preventDefault();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ tab, x: e.clientX, y: e.clientY });
              }}
              className={cn(
                'group relative flex h-full cursor-pointer items-center gap-1.5 border-r border-r-transparent px-2.5 text-[12px] transition-all',
                // 所有 tab 等宽，标题过长截断，避免长短不一
                'w-[136px] flex-shrink-0',
                isActive
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
                tab.pinned && !isActive && 'bg-secondary/20',
              )}
            >
              {/* 激活态底部蓝条 (2px) */}
              <span
                className={cn(
                  'absolute inset-x-0 bottom-0 h-[2px] transition-colors',
                  isActive ? 'bg-primary' : 'bg-transparent',
                )}
                aria-hidden
              />

              {/* pinned 蓝点 (左, 只 pinned 显示) */}
              {tab.pinned && (
                <Pin
                  className={cn(
                    'h-2.5 w-2.5 flex-shrink-0 -rotate-45',
                    isActive ? 'text-primary' : 'text-blue-400',
                  )}
                  strokeWidth={3}
                  aria-label="已固定"
                />
              )}

              {/* drop placeholder (左/右) */}
              {showLeftDrop && (
                <span className="absolute -left-px top-0 h-full w-0.5 bg-primary" aria-hidden />
              )}
              {showRightDrop && (
                <span className="absolute -right-px top-0 h-full w-0.5 bg-primary" aria-hidden />
              )}

              {/* icon */}
              <TabIcon name={tab.icon || 'Home'} isActive={isActive} />

              {/* title — title 属性悬停看全名 */}
              <span className="min-w-0 flex-1 truncate font-medium tracking-tight" title={tab.title}>
                {tab.title}
              </span>

              {/* 关闭 X (closable 显示, 非 pinned) */}
              {tab.closable && (
                <button
                  type="button"
                  aria-label="关闭 tab"
                  onClick={(e) => handleClose(e, tab.id)}
                  className={cn(
                    'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition-all',
                    'hover:bg-secondary',
                    isActive
                      ? 'opacity-60 hover:opacity-100'
                      : 'opacity-0 group-hover:opacity-60 hover:!opacity-100',
                  )}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {contextMenu && (
        <ContextMenu
          open
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems(contextMenu.tab)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
