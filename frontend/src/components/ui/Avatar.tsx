import { cn } from '@/lib/utils';

interface AvatarProps {
  name?: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-7 w-7 text-xs',
  lg: 'h-9 w-9 text-sm',
};

function hashToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function Avatar({ name = '?', src, size = 'md', className }: AvatarProps) {
  const initial = name?.[0]?.toUpperCase() || '?';
  const hue = hashToHue(name || '');
  if (src) {
    return (
      <img src={src} alt={name} className={cn('rounded-full object-cover', sizeMap[size], className)} />
    );
  }
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium text-white',
        sizeMap[size],
        className,
      )}
      style={{ background: `hsl(${hue} 35% 45%)` }}
    >
      {initial}
    </div>
  );
}
