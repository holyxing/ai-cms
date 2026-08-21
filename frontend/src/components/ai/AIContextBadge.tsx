/**
 * AIContextBadge.tsx - AI 助手弹窗顶部"当前上下文"折叠区 (P3.10 D1.3)
 *
 * Q3C 决策: 自动嗅探 + 用户 override
 * - 默认显示从 store.context 读的当前上下文
 * - 用户可点击展开 / 调整 (D2 完善交互)
 *
 * D1 stub: 只显示, 不可编辑. D2 加 override UI.
 */
import * as React from 'react';
import { ChevronDown, ChevronUp, Sparkles, X } from 'lucide-react';
import { useAIAssistant, type AIMode } from '@/stores/aiAssistant';
import { cn } from '@/lib/utils';

const MODE_LABEL: Record<AIMode, string> = {
  article: '文章',
  template: '模板',
  general: '通用',
};

const MODE_BORDER: Record<AIMode, string> = {
  article: 'border-blue-200 bg-blue-50/40',
  template: 'border-purple-200 bg-purple-50/40',
  general: 'border-border bg-secondary/40',
};

export const AIContextBadge: React.FC = () => {
  const context = useAIAssistant((s) => s.context);
  const mode = useAIAssistant((s) => s.mode);
  const [expanded, setExpanded] = React.useState(false);

  if (!context) {
    return (
      <div className="rounded-md border border-dashed bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          <span>通用对话模式 (无具体上下文)</span>
        </div>
      </div>
    );
  }

  const { target, payload } = context;
  const hasPayload = !!(payload.body || payload.html || payload.tokens);
  const payloadPreview = payload.body || payload.html || (payload.tokens ? JSON.stringify(payload.tokens).slice(0, 200) : '');
  // P4.5 Bug Bash: target 可能不完整 (页面 setContext 期间 resourceId/siteId 之一丢失) → slice() crash
  // 兑底: 各字段独立可选
  const targetTitle = target.title || (target.resourceId ? target.resourceId.slice(0, 8) : '未命名');
  const targetSiteId = target.siteId ? target.siteId.slice(0, 8) : '未知';
  const targetResourceId = target.resourceId ? target.resourceId.slice(0, 8) : '未知';

  return (
    <div className={cn('rounded-md border', MODE_BORDER[mode])}>
      {/* 摘要行 (点击展开) */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        <Sparkles className={cn('h-3 w-3 flex-shrink-0', mode === 'template' ? 'text-accent-purple' : 'text-primary')} />
        <span className="text-[11px] font-medium text-foreground">
          {mode === 'article' ? 'HTML 正文' : `${MODE_LABEL[mode]} 上下文`}
        </span>
        <span className="text-[11px] text-muted-foreground truncate">
          · {targetTitle}
        </span>
        {hasPayload && (
          <span className="text-[10px] text-muted-foreground/70">
            ({(payload.body || payload.html || '').length} 字符)
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {expanded ? (
            <ChevronUp className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          )}
        </span>
      </button>

      {/* 展开: 显示 payload 预览 + 元数据 */}
      {expanded && (
        <div className="border-t px-3 py-2 text-[11px] space-y-1.5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>站点: {targetSiteId}</span>
            <span>·</span>
            <span>资源: {targetResourceId}</span>
            {target.designLang && (
              <>
                <span>·</span>
                <span>风格: {target.designLang}</span>
              </>
            )}
          </div>
          {hasPayload && (
            <pre className="max-h-32 overflow-y-auto rounded bg-background/50 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
              {payloadPreview}
            </pre>
          )}
          <div className="flex items-center gap-1.5 pt-1 text-[10px] text-muted-foreground/70">
            <span>💡 D2 将支持: 重新选择文本 / 应用到其他位置</span>
          </div>
        </div>
      )}
    </div>
  );
};
