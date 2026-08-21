// P6.2 #12: 列表筛选 chips (替代 select)
// 用法:
//   <FilterChips value={statusFilter} onChange={setStatusFilter} options={[
//     { value: '', label: '全部' },
//     { value: 'draft', label: '草稿' },
//     { value: 'pending', label: '待审' },
//   ]} />
//
// 也支持带 count:
//   <FilterChips value={statusFilter} onChange={setStatusFilter} options={[
//     { value: '', label: '全部', count: total },
//     { value: 'draft', label: '草稿', count: drafts },
//   ]} />
import { cn } from '@/lib/utils';

export interface FilterChipOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

interface FilterChipsProps<T extends string = string> {
  value: T;
  onChange: (v: T) => void;
  options: FilterChipOption<T>[];
  size?: 'sm' | 'md';
  className?: string;
}

export function FilterChips<T extends string = string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
}: FilterChipsProps<T>) {
  return (
    <div
      className={cn(
        'inline-flex rounded-md border bg-background p-0.5',
        className,
      )}
      role="tablist"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1 rounded font-medium transition-colors',
              size === 'sm' ? 'h-6 px-2 text-[10.5px]' : 'h-7 px-2.5 text-[11px]',
              active
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.icon}
            <span>{o.label}</span>
            {typeof o.count === 'number' && (
              <span
                className={cn(
                  'ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded px-1 text-[9.5px] tabular-nums',
                  active ? 'bg-background/80 text-foreground' : 'bg-secondary/60 text-muted-foreground',
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}