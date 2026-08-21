/**
 * TagAutocompletePopover - 共享的 HY_ 标签补全弹层
 *
 * 用法:
 *   1. <TagAutocompletePopover open={open} tags={...} onSelect={(code, ex) => ...} position={...} onClose={...} />
 *   2. 由父组件 (LayoutEditDialog / BlockEditor) 监听 "输入 {{" 触发 open
 *
 * 设计:
 *   - 浮动层 (fixed 定位, 由父传 position {top, left})
 *   - 列表展示 + 键盘导航 (↑↓ Enter Esc)
 *   - 不引入 tippy.js, 自带简易绝对定位
 */
import { useEffect, useRef, useState } from 'react';
import { Tag, Hash, X } from 'lucide-react';

export interface TagItem {
  code: string;
  scope: 'all' | 'site' | 'home' | 'content' | 'category';
  desc: string;
  example: string;
}

export interface TagAutocompletePopoverProps {
  open: boolean;
  tags: TagItem[];
  filter?: string;  // 触发时的已输入文本 (如 "{{SI" 用来过滤)
  position?: { top: number; left: number };
  onSelect: (tag: TagItem) => void;
  onClose: () => void;
}

export default function TagAutocompletePopover({
  open, tags, filter = '', position, onSelect, onClose,
}: TagAutocompletePopoverProps) {
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = tags.filter((t) => {
    if (!filter) return true;
    const f = filter.toUpperCase();
    return t.code.toUpperCase().includes(f) || t.desc.includes(filter);
  });

  useEffect(() => { setIdx(0); }, [filter]);
  useEffect(() => {
    if (!open) return;
    const list = listRef.current?.querySelector('[data-active]');
    (list as HTMLElement)?.scrollIntoView({ block: 'nearest' });
  }, [idx, open]);

  // 全局键盘
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered[idx]) {
          e.preventDefault();
          onSelect(filtered[idx]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, idx, filtered, onSelect, onClose]);

  if (!open) return null;

  // 兜底定位 (没传 position 时放到视口右下)
  const style: React.CSSProperties = position
    ? { top: position.top, left: position.left }
    : { bottom: 20, right: 20 };

  return (
    <div
      data-tag-autocomplete
      className="fixed z-50 w-[420px] max-h-[360px] rounded-lg border bg-card shadow-md ring-1 ring-border overflow-hidden"
      style={style}
    >
      <div className="flex items-center justify-between border-b bg-secondary/30 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
          <Tag className="h-3.5 w-3.5" />
          插入标签 {filter && <span className="text-muted-foreground">/ 过滤: {filter}</span>}
        </div>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:bg-secondary"
          title="关闭 (Esc)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {filtered.length === 0 ? (
        <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
          没有匹配的标签
        </div>
      ) : (
        <div ref={listRef} className="max-h-[280px] overflow-y-auto">
          {filtered.map((t, i) => (
            <button
              key={t.code}
              data-active={i === idx ? '' : undefined}
              onMouseEnter={() => setIdx(i)}
              onClick={() => onSelect(t)}
              className={
                'w-full text-left px-3 py-1.5 border-b last:border-b-0 transition-colors ' +
                (i === idx ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-secondary/40')
              }
            >
              <div className="flex items-center gap-2">
                <code className="font-mono text-[11.5px] font-semibold text-primary">{t.code}</code>
                <span className="text-[10.5px] text-muted-foreground">[{t.scope}]</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{t.desc}</div>
              <div className="font-mono text-[10px] text-foreground/60 mt-0.5 truncate">{t.example}</div>
            </button>
          ))}
        </div>
      )}
      <div className="border-t bg-secondary/20 px-3 py-1.5 text-[10.5px] text-muted-foreground flex items-center gap-3">
        <span>↑↓ 选择</span>
        <span>Enter 插入</span>
        <span>Esc 关闭</span>
        <span className="ml-auto">{filtered.length} 个</span>
      </div>
    </div>
  );
}
