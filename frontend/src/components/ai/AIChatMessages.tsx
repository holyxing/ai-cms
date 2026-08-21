/**
 * AIChatMessages.tsx - AI 助手弹窗内的消息列表 (P3.10)
 *
 * 从 AIChatPanel 抽出 (去 article/template 双色, 统一用主色)
 * - 3 种消息: user-prompt (用户输入) / user-task (点任务卡) / ai-run (AI 流式)
 * - ai-run 状态: starting/running/success/failed/cancelled
 * - accept/reject/diff 按钮
 */
import * as React from 'react';
import {
  Check, X, Loader2, AlertCircle, StopCircle, Bot, User, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useAIAssistant, type ChatMessage } from '@/stores/aiAssistant';

export interface AIChatMessagesProps {
  /** 弹窗主色 (article=blue, template=purple, general=slate) */
  accent: 'blue' | 'purple' | 'slate';
  className?: string;
}

const ACCENT_BG: Record<AIChatMessagesProps['accent'], string> = {
  blue: 'bg-primary',
  purple: 'bg-accent-purple',
  slate: 'bg-muted-foreground',
};

const ACCENT_RING: Record<AIChatMessagesProps['accent'], string> = {
  blue: 'ring-blue-100',
  purple: 'ring-purple-100',
  slate: 'ring-slate-100',
};

export const AIChatMessages: React.FC<AIChatMessagesProps> = ({ accent, className }) => {
  const messages = useAIAssistant((s) => s.messages);
  const accept = useAIAssistant((s) => s.accept);
  const abort = useAIAssistant((s) => s.abort);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      // P3.10.8 (holy 反馈 #13473): h-full 让 0 消息也撑满 section, 输入区贴底
      <div className="flex h-full items-center justify-center rounded-md border border-dashed bg-secondary/15 text-[11px] text-muted-foreground">
        还没有消息. 点击上方任务卡或在底部输入框开始对话
      </div>
    );
  }

  return (
    <div ref={scrollRef} className={cn('flex flex-col gap-3 overflow-y-auto px-1', className)}>
      {messages.map((m) => (
        <ChatBubble
          key={m.id}
          msg={m}
          accent={accent}
          accentBg={ACCENT_BG[accent]}
          accentRing={ACCENT_RING[accent]}
          onAccept={() => accept(m.id)}
          onCancel={() => abort()}
        />
      ))}
    </div>
  );
};

// ===== 单条气泡 =====

const ChatBubble: React.FC<{
  msg: ChatMessage;
  accent: 'blue' | 'purple' | 'slate';
  accentBg: string;
  accentRing: string;
  onAccept: () => void;
  onCancel: () => void;
}> = ({ msg, accent, accentBg, accentRing, onAccept, onCancel }) => {
  if (msg.kind === 'user-prompt') {
    return (
      <div className="flex items-start justify-end gap-2">
        <div className="max-w-[80%] rounded-md rounded-tr-sm bg-foreground px-3 py-2 text-[12px] text-background">
          {msg.prompt}
        </div>
        <BubbleAvatar className="bg-muted-foreground">
          <User className="h-3 w-3 text-background" />
        </BubbleAvatar>
      </div>
    );
  }

  if (msg.kind === 'user-task') {
    return (
      <div className="flex items-start justify-end gap-2">
        <div className={cn(
          'max-w-[80%] rounded-md rounded-tr-sm px-3 py-2 text-[12px] text-white',
          accentBg,
        )}>
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            <span>{msg.label}</span>
          </div>
        </div>
        <BubbleAvatar className="bg-muted-foreground">
          <User className="h-3 w-3 text-background" />
        </BubbleAvatar>
      </div>
    );
  }

  if (msg.kind === 'ai-run') {
    const isRunning = msg.state === 'starting' || msg.state === 'running';
    const isSuccess = msg.state === 'success';
    const isFailed = msg.state === 'failed' || msg.state === 'cancelled';
    return (
      <div className="flex items-start gap-2">
        <BubbleAvatar className={cn('ring-2', accentBg, accentRing)}>
          <Bot className="h-3.5 w-3.5 text-white" />
        </BubbleAvatar>
        <div className="max-w-[85%] flex-1 space-y-1.5">
          {/* Header: 任务名 + 状态 */}
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <span className="font-medium text-foreground">{msg.label}</span>
            {isRunning && (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                <span>生成中...</span>
              </>
            )}
            {isSuccess && <span className="text-emerald-600">✓ 完成</span>}
            {/* P3.10.5 (holy 反馈 #13316): accepted/rejected 状态补上, 接受按钮隐藏后消息仍可见 */}
            {msg.state === 'accepted' && <span className="text-emerald-600">✓ 已应用</span>}
            {msg.state === 'rejected' && <span className="text-muted-foreground">已拒绝</span>}
            {msg.state === 'failed' && <span className="text-red-600">✗ 失败</span>}
            {msg.state === 'cancelled' && <span className="text-muted-foreground">已取消</span>}
          </div>

          {/* Body: 流式输出 / 错误 */}
          {isFailed ? (
            <div className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
              <AlertCircle className="h-3 w-3 flex-shrink-0" />
              <span>{msg.error || '未知错误'}</span>
            </div>
          ) : (
            <div className={cn(
              'rounded-md rounded-tl-sm bg-secondary/30 px-3 py-2 text-[12px] text-foreground ring-1 ring-border/40',
            )}>
              {msg.text ? (
                <pre className="whitespace-pre-wrap break-words font-sans leading-relaxed">{msg.text}</pre>
              ) : isRunning ? (
                <span className="text-muted-foreground">等待输出...</span>
              ) : (
                <span className="text-muted-foreground">(无输出)</span>
              )}
            </div>
          )}

          {/* Footer: accept/reject/cancel + tokens */}
          {isSuccess && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="tabular-nums">{msg.tokens.prompt + msg.tokens.completion} tokens</span>
              {msg.cost > 0 && <span>· ${msg.cost.toFixed(4)}</span>}
              <Button size="sm" variant="default" onClick={onAccept} className="ml-auto h-6 text-[11px]">
                <Check className="mr-1 h-3 w-3" /> 接受
              </Button>
            </div>
          )}
          {/* P3.10.5: accepted/rejected 后只显示 tokens 统计, 不重复按钮 (holy 反馈 #13316) */}
          {(msg.state === 'accepted' || msg.state === 'rejected') && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="tabular-nums">{msg.tokens.prompt + msg.tokens.completion} tokens</span>
              {msg.cost > 0 && <span>· ${msg.cost.toFixed(4)}</span>}
            </div>
          )}
          {isRunning && (
            <Button size="sm" variant="ghost" onClick={onCancel} className="ml-auto h-6 text-[11px] text-muted-foreground">
              <StopCircle className="mr-1 h-3 w-3" /> 取消
            </Button>
          )}
        </div>
      </div>
    );
  }

  return null;
};

const BubbleAvatar: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <div className={cn('flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full', className)}>
    {children}
  </div>
);
