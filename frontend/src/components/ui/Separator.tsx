import { cn } from '@/lib/utils';

interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  label?: string;
}

export function Separator({ className, orientation = 'horizontal', label, ...props }: SeparatorProps) {
  if (label) {
    return (
      <div className={cn('flex items-center gap-3 text-xs text-muted-foreground', className)} {...props}>
        <div className="h-px flex-1 bg-border" />
        <span>{label}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    );
  }
  return (
    <div
      className={cn(
        'bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}
