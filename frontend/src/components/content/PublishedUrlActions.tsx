// PublishedUrlActions.tsx - 发布地址旁的复制+新窗按钮 (P3.6.1, 2026-06-08 重建)
//
// 行为:
//   - "复制" 按钮: 复制当前 slug 路径到剪贴板, 成功后 1.5s 显示对勾反馈
//   - "新窗" 按钮: 在新标签页打开 admin 预览页 (admin 内部走 /sites/:siteId/:slug/)
//   - 真实静态 URL 需要 cat_slug/content_slug 拼接, 当前 Content API 未返 cat_slug
//     (P2.7 + P3.6.1 layout system 决定), 临时用 admin 预览 URL 兜底
import { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';

export interface PublishedUrlActionsProps {
  slug: string;
  siteId?: string;
  /** 完整 URL, 传了就用这个; 不传就用 /{slug}/ */
  fullUrl?: string;
}

export function PublishedUrlActions({ slug, siteId, fullUrl }: PublishedUrlActionsProps) {
  const [copied, setCopied] = useState(false);
  const displayUrl = fullUrl || `/${slug}/`;
  const previewUrl = siteId
    ? `/sites/${siteId}/${slug}/`
    : displayUrl;

  const handleCopy = async () => {
    try {
      // 优先用 navigator.clipboard (https/localhost 可用)
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(displayUrl);
      } else {
        // 兜底: textarea + execCommand
        const ta = document.createElement('textarea');
        ta.value = displayUrl;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      toast.error('复制失败, 请手动选择文本');
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={handleCopy}
        title={`复制 ${displayUrl}`}
        aria-label="复制链接"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
      <a
        href={previewUrl}
        target="_blank"
        rel="noreferrer"
        title="在新标签页打开"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label="新窗打开"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
