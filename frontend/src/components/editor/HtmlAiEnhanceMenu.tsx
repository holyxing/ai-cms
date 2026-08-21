/**
 * HtmlAiEnhanceMenu - HTML 编辑器工具栏「AI 增强」快捷菜单
 * 三项：样式优化 / 正文优化 / 图片本地化（+ 一键全增强）
 */
import { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Palette,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  enhanceHtmlStyle,
  enhanceHtmlContent,
  localizeExternalImages,
  enhanceHtmlAll,
  type HtmlEnhanceKind,
} from '@/lib/htmlAiEnhance';
import { useAIAssistant } from '@/stores/aiAssistant';

interface Props {
  html: string;
  siteId: string;
  contentId?: string;
  siteSlug?: string;
  disabled?: boolean;
  onApply: (nextHtml: string) => void;
}

const ACTIONS: {
  kind: HtmlEnhanceKind;
  label: string;
  desc: string;
  icon: typeof Sparkles;
}[] = [
  { kind: 'style', label: '样式优化', desc: '去壳去样式，只留 p/图文', icon: Palette },
  { kind: 'content', label: '正文优化', desc: '错别字 / 润色 / 段落', icon: FileText },
  { kind: 'images', label: '图片本地化', desc: '外链图入库站点资源', icon: ImageIcon },
  { kind: 'all', label: '一键全增强', desc: '样式 → 正文 → 图片', icon: Layers },
];

export function HtmlAiEnhanceMenu({
  html,
  siteId,
  contentId,
  siteSlug,
  disabled,
  onApply,
}: Props) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<HtmlEnhanceKind | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const run = async (kind: HtmlEnhanceKind) => {
    if (!html?.trim()) {
      toast.error('正文为空，无法增强');
      return;
    }
    if (running) {
      toast.error('AI 增强进行中，请稍候');
      return;
    }
    setOpen(false);
    setRunning(kind);
    abortRef.current = new AbortController();
    // 样式优化为本地规则，不必打开 AI 助手
    if (kind !== 'style' && kind !== 'images') {
      useAIAssistant.getState().openAssistant();
    }

    const toastId = toast.loading(
      kind === 'style'
        ? '正在清理样式…'
        : kind === 'content'
          ? 'AI 正在优化正文…'
          : kind === 'images'
            ? '正在将外链图片写入站点资源…'
            : '一键增强进行中…',
    );

    try {
      let next = html;
      if (kind === 'style') {
        next = await enhanceHtmlStyle({
          siteId,
          contentId,
          html,
          signal: abortRef.current.signal,
        });
        onApply(next);
        toast.success('已清理无用样式与空标签', { id: toastId });
        return;
      } else if (kind === 'content') {
        next = await enhanceHtmlContent({
          siteId,
          contentId,
          html,
          signal: abortRef.current.signal,
        });
      } else if (kind === 'images') {
        const r = await localizeExternalImages({ siteId, html, siteSlug });
        next = r.html;
        if (r.imported === 0 && r.reused === 0 && r.failed === 0) {
          toast.success('未发现需要本地化的外链图片', { id: toastId });
          return;
        }
        if (r.imported === 0 && r.reused === 0 && r.failed > 0) {
          toast.error(r.firstError || `全部失败（${r.failed}）`, { id: toastId });
          return;
        }
        const parts: string[] = [];
        if (r.imported) parts.push(`新建 ${r.imported}`);
        if (r.reused) parts.push(`复用 ${r.reused}`);
        if (r.failed) parts.push(`失败 ${r.failed}`);
        toast.success(parts.join('，') || '完成', { id: toastId });
        onApply(next);
        return;
      } else {
        next = await enhanceHtmlAll({
          siteId,
          contentId,
          html,
          siteSlug,
          signal: abortRef.current.signal,
          onStep: (s) => toast.loading(`AI 增强：${s}…`, { id: toastId }),
        });
      }
      onApply(next);
      toast.success('已应用到正文，请检查后保存', { id: toastId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI 增强失败', { id: toastId });
    } finally {
      setRunning(null);
      abortRef.current = null;
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled || !!running}
        onClick={() => setOpen((v) => !v)}
        title="AI 增强：样式 / 正文 / 图片"
        className={cn(
          'inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 text-[10.5px] font-medium transition-colors',
          running
            ? 'bg-violet-500/20 text-violet-300'
            : 'bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 hover:text-violet-200',
          (disabled || running) && 'cursor-not-allowed opacity-60',
        )}
      >
        {running ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <Sparkles className="h-3 w-3 shrink-0" strokeWidth={2.25} />
        )}
        <span className="whitespace-nowrap">AI 增强</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
      </button>

      {open && !running && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-slate-700 bg-slate-900 py-1 shadow-md"
          role="menu"
        >
          {ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.kind}
                type="button"
                role="menuitem"
                onClick={() => run(a.kind)}
                className="flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-slate-800"
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-violet-400" strokeWidth={2} />
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-medium text-slate-100">{a.label}</span>
                  <span className="block text-[10px] text-slate-500">{a.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
