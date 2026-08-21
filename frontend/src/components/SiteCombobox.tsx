// SiteCombobox.tsx - 站点选择器 (P6.4-A #4)
//
// 替代 dashboard 上的 <select>:
// - 显示当前站点 + 下拉箭头
// - 点击展开: pin (置顶) + "全部站点" + 搜索过滤 + 列表
// - 站点多 (>8) 时显示搜索框
// - Pin 状态存 localStorage (不需后端)

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Star, Search, X, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pinnedSitesStore } from '@/api/stats';

interface SiteLike {
  id: string;
  name: string;
  slug: string;
}

interface Props {
  sites: SiteLike[];
  value: string | null;          // null = "全部站点"
  onChange: (siteId: string | null) => void;
  showAllOption?: boolean;       // 是否显示 "全部站点" 选项
  className?: string;
  size?: 'sm' | 'md';
}

export function SiteCombobox({
  sites,
  value,
  onChange,
  showAllOption = true,
  className,
  size = 'sm',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pins, setPins] = useState<string[]>(() => pinnedSitesStore.list());
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 同步 localStorage (其他 tab 也可见)
  useEffect(() => {
    const onStorage = () => setPins(pinnedSitesStore.list());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // click outside 关闭
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // 打开时聚焦搜索框 (有搜索框时)
  useEffect(() => {
    if (open && sites.length > 8 && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open, sites.length]);

  const currentName = useMemo(() => {
    if (!value) return '全部站点';
    return sites.find((s) => s.id === value)?.name ?? '未选站点';
  }, [value, sites]);

  const pinnedSites = useMemo(
    () => sites.filter((s) => pins.includes(s.id)),
    [sites, pins],
  );
  const unpinnedSites = useMemo(
    () => sites.filter((s) => !pins.includes(s.id)),
    [sites, pins],
  );

  const matches = (s: SiteLike) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q);
  };

  const togglePin = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const next = pinnedSitesStore.toggle(id);
    setPins(next);
  };

  const sizeCls = size === 'sm' ? 'h-8 text-xs' : 'h-9 text-sm';

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-md border bg-background px-2.5 text-foreground transition-colors',
          'hover:bg-secondary/60 focus:outline-none focus:ring-1 focus:ring-ring',
          sizeCls,
          open && 'border-ring ring-1 ring-ring',
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="max-w-[140px] truncate font-medium">{currentName}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-72 rounded-md border bg-popover shadow-md ring-1 ring-border">
          {/* 搜索框 (站点多时) */}
          {sites.length > 8 && (
            <div className="flex items-center gap-2 border-b px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索站点名或 slug..."
                className="h-7 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          <div className="max-h-72 overflow-y-auto py-1">
            {/* "全部站点" 选项 */}
            {showAllOption && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                  setQuery('');
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-secondary',
                  value === null && 'bg-secondary/50 font-medium text-primary',
                )}
              >
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                <span>全部站点 (跨站总览)</span>
              </button>
            )}

            {/* Pin 列表 */}
            {pinnedSites.filter(matches).length > 0 && (
              <>
                <div className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  <Star className="mr-1 inline-block h-2.5 w-2.5" />
                  置顶
                </div>
                {pinnedSites.filter(matches).map((s) => (
                  <SiteRow
                    key={s.id}
                    site={s}
                    pinned
                    selected={s.id === value}
                    onSelect={() => {
                      onChange(s.id);
                      setOpen(false);
                      setQuery('');
                    }}
                    onPin={(e) => togglePin(e, s.id)}
                  />
                ))}
              </>
            )}

            {/* 普通列表 */}
            {unpinnedSites.filter(matches).length > 0 && (
              <>
                {pinnedSites.length > 0 && (
                  <div className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    全部
                  </div>
                )}
                {unpinnedSites.filter(matches).map((s) => (
                  <SiteRow
                    key={s.id}
                    site={s}
                    pinned={false}
                    selected={s.id === value}
                    onSelect={() => {
                      onChange(s.id);
                      setOpen(false);
                      setQuery('');
                    }}
                    onPin={(e) => togglePin(e, s.id)}
                  />
                ))}
              </>
            )}

            {/* 搜索无结果 */}
            {query && pinnedSites.filter(matches).length === 0 && unpinnedSites.filter(matches).length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                没找到 “{query}” 相关站点
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SiteRow({
  site,
  pinned,
  selected,
  onSelect,
  onPin,
}: {
  site: SiteLike;
  pinned: boolean;
  selected: boolean;
  onSelect: () => void;
  onPin: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-2.5 py-1.5 text-xs transition-colors hover:bg-secondary',
        selected && 'bg-secondary/50 font-medium text-primary',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-1 items-center gap-2 text-left"
      >
        <span className="flex-1 truncate">{site.name}</span>
        <span className="font-mono text-[10px] text-muted-foreground">/{site.slug}</span>
      </button>
      <button
        type="button"
        onClick={onPin}
        className={cn(
          'rounded p-0.5 transition-colors',
          pinned
            ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
            : 'text-muted-foreground/0 group-hover:text-muted-foreground hover:bg-secondary',
        )}
        title={pinned ? '取消置顶' : '置顶'}
        aria-label={pinned ? `取消置顶 ${site.name}` : `置顶 ${site.name}`}
      >
        <Star
          className="h-3 w-3"
          fill={pinned ? 'currentColor' : 'none'}
          strokeWidth={2}
        />
      </button>
    </div>
  );
}