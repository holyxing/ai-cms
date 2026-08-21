// ThemeSwitcher.tsx - 主题切换按钮 (P4.1 / 设计系统 §15.5)
//
// 3 档: 浅色 / 深色 / 跟系统, 默认跟系统
// 接入 useAppearanceStore.darkMode + 顶栏图标 + 下拉菜单
//
// 设计系统约束:
//   - 弹层: bg-popover token (P4.1 治本, 替换 P3.6.1 治标)
//   - 选中态: bg-accent text-accent-foreground
//   - 图标: lucide-react Sun/Moon/Monitor
import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Monitor, Check, type LucideIcon } from 'lucide-react';
import { useAppearanceStore, type DarkMode } from '@/stores/appearance';

interface Option {
  value: DarkMode;
  label: string;
  icon: LucideIcon;
}

const OPTIONS: Option[] = [
  { value: 'light',  label: '浅色',   icon: Sun },
  { value: 'dark',   label: '深色',   icon: Moon },
  { value: 'system', label: '跟系统', icon: Monitor },
];

export function ThemeSwitcher() {
  const darkMode = useAppearanceStore((s) => s.darkMode);
  const setDarkMode = useAppearanceStore((s) => s.setDarkMode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // outside click 关弹层
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const current = OPTIONS.find((o) => o.value === darkMode) ?? OPTIONS[2];
  const CurrentIcon = current.icon;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label="切换主题"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`当前: ${current.label}`}
      >
        <CurrentIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-50 min-w-[140px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-border"
        >
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            const active = o.value === darkMode;
            return (
              <button
                key={o.value}
                type="button"
                role="menuitem"
                onClick={() => {
                  setDarkMode(o.value);
                  setOpen(false);
                }}
                className={
                  'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-xs transition-colors ' +
                  (active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground')
                }
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5" />
                  {o.label}
                </span>
                {active && <Check className="h-3 w-3" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}