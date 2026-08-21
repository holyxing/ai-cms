// PartialsPanel.tsx - 本子模板速查面板 (P3.9.1+)
// 列出当前站所有 partial scope 模板 (template_kind='partial'),
// 点击行 → 在底部 toast 提示"已复制 code", 模板内可直接粘贴 <HY_TEMPLATE _code="..." /> 引用.
//
// 设计:
// - 跟 LayoutReferencesCard (P3.7.4) 风格一致: Card + 折叠行 + 紧凑列表
// - 不走 setHtml 强制插入, 因为用户在编辑 HTML 框里, 复制 code 更稳 (避免光标错位)
// - 数据源: layoutsApi.list(siteId, { scope: 'partial' }), 缓存 5 min
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileCode, ChevronDown, ChevronRight, Copy, Check, FilePlus2 } from 'lucide-react';
import { Card, CardContent, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { layoutsApi } from '@/api/layouts';
import { toast } from 'sonner';

interface Props {
  siteId: string;
  compact?: boolean; // P3.9.1: 跟 AssetDependencyCard 一致, 紧凑模式给侧栏用
  // P3.9.1+: 受控模式 (跟其他 4 个侧栏 Card 折叠态同步)
  open?: boolean;
  onToggle?: () => void;
}

export function PartialsPanel({ siteId, compact = true, open, onToggle }: Props) {
  const [internalOpen, setInternalOpen] = useState(true);
  const expanded = open ?? internalOpen;
  const handleToggle = () => {
    if (onToggle) onToggle();
    else setInternalOpen((o) => !o);
  };
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const partialsQ = useQuery({
    queryKey: ['layouts-partials', siteId],
    queryFn: () => layoutsApi.list(siteId, { scope: 'partial' }).catch(() => ({ items: [], total: 0, page: 1, page_size: 0 } as any)),
    enabled: !!siteId,
    staleTime: 300_000, // 5 分钟
  });

  const items = partialsQ.data?.items ?? [];

  if (partialsQ.isLoading) {
    return (
      <Card className="shadow-sm">
        <CardContent className={compact ? 'p-4' : 'p-6'}>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-block h-3 w-3 animate-pulse rounded bg-muted" />
            加载子模板…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <button
            onClick={handleToggle}
            className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-secondary/30"
            aria-expanded={expanded}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-medium">
              <FilePlus2 className="h-3.5 w-3.5 text-muted-foreground" />
              可引用的子模板
            </span>
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
          {expanded && (
            <div className={cn('border-t px-4 py-3 text-[10px] text-muted-foreground', compact ? '' : 'px-6 py-5')}>
              该站点还没有子模板 (scope=partial).
              <br />
              在「<a className="text-blue-600 hover:underline" href={`/sites/${siteId}/layouts`} target="_blank" rel="noreferrer">模板管理</a>」新建一个,
              <br />
              之后这里会列出可用的 <code className="font-mono">HY_TEMPLATE _code</code>.
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const handleCopy = async (code: string) => {
    const text = `<HY_TEMPLATE _code="${code}" />`;
    // P3.9.1 fix (holy 反馈 #11147): 不用 prompt 兜底, 任何环境都静默复制.
    // 主路径: navigator.clipboard.writeText (https / secure context)
    // 兑底: 隐藏 textarea + execCommand('copy') (http / 旧浏览器 / 蒲浏览器)
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopiedCode(code);
      toast.success(`已复制 ${text}`);
      setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1500);
    } else {
      // 走到这说明两种都失败 (极罕见) — 还是不弹 dialog, 只 toast 错误
      toast.error('复制失败, 请手动选中代码');
    }
  };

  return (
    <Card className="shadow-sm">
      <CardContent className="p-0">
        <button
          onClick={handleToggle}
          className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-secondary/30"
          aria-expanded={expanded}
        >
          <span className="flex items-center gap-1.5 text-[11px] font-medium">
            <FileCode className="h-3.5 w-3.5 text-blue-600" />
            可引用的子模板
            <span className="rounded bg-blue-100 px-1 py-px text-[9.5px] font-medium text-blue-700">
              {items.length}
            </span>
          </span>
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <div className={cn('space-y-1 border-t', compact ? 'px-4 py-3' : 'px-6 py-5')}>
            {items.map((t) => {
              const isCopied = copiedCode === t.code;
              return (
                <button
                  key={t.id}
                  onClick={() => handleCopy(t.code)}
                  className={cn(
                    'group flex w-full items-center gap-1.5 rounded border px-1.5 py-1 text-left transition-colors',
                    isCopied
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-transparent bg-secondary/30 hover:border-blue-300 hover:bg-blue-50/40',
                  )}
                  title={`点击复制 <HY_TEMPLATE _code="${t.code}" /> 到剪贴板`}
                >
                  <FileCode className="h-3 w-3 flex-shrink-0 text-blue-600" strokeWidth={2} />
                  <span className="flex-1 truncate text-[11px] font-medium">{t.name}</span>
                  <code className="rounded bg-secondary px-1 py-px text-[9.5px] font-mono text-muted-foreground">
                    {t.code}
                  </code>
                  <span className="text-[9px] text-muted-foreground">v{t.version}</span>
                  {isCopied ? (
                    <Check className="h-3 w-3 flex-shrink-0 text-blue-600" />
                  ) : (
                    <Copy className="h-3 w-3 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </button>
              );
            })}
            <p className="mt-1.5 text-[9.5px] text-muted-foreground">
              点击行 → 复制 <code className="font-mono">&lt;HY_TEMPLATE _code="..." /&gt;</code> 到剪贴板,
              粘贴到 HTML 即可引用.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
