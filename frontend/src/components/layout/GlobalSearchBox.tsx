// P4.1 全局搜索框: 输入框 + ⌘K 快捷键
// 提交跳 /search?q=... 走 SearchPage 渲染
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export function GlobalSearchBox() {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // ⌘K / Ctrl+K 快捷聚焦
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = () => {
    const qq = q.trim();
    if (qq) navigate(`/search?q=${encodeURIComponent(qq)}`);
  };

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-md border bg-secondary/30 px-2 py-1.5 transition-colors',
        focused && 'border-primary/40 bg-background ring-1 ring-primary/15'
      )}
    >
      <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') inputRef.current?.blur();
        }}
        placeholder="搜索内容..."
        data-shortcut="global-search"
        className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
        aria-label="全局搜索"
      />
      <kbd className="hidden text-[9px] font-mono text-muted-foreground/70 border rounded px-1 py-0.5 lg:inline">⌘K</kbd>
    </div>
  );
}
