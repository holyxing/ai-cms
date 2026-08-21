import { cva, type VariantProps } from 'class-variance-authority';
import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md px-1.5 text-[11px] font-medium leading-5 transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground',
        outline: 'border border-border text-foreground',
        muted: 'bg-transparent text-muted-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        success: 'bg-emerald-50 text-emerald-700',
        warning: 'bg-amber-50 text-amber-700',
        info: 'bg-blue-50 text-blue-700',
        purple: 'bg-purple-50 text-purple-700',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  // 用 span 避免 <div> 嵌进 <p> 的 DOM 嵌套警告
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
