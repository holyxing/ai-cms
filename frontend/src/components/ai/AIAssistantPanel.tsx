/**
 * AIAssistantPanel.tsx - AI 助手抽屉主区 (P3.10.7)
 *
 * 右侧 Drawer (从右滑入, w-[420px] h-screen, holy 反馈 #13445):
 * - 改自 Modal 居中 → Drawer 居右
 * - Header: 标题 + 关闭 X + Mode 切换器 (segmented)
 * - AIContextBadge (上下文折叠区, D1 已建)
 * - AIQuickActions (任务卡片网格)
 * - AIChatMessages (消息列表)
 * - 底部输入框 + 发送按钮
 *
 * 容器: 普通 div (P3.10.9 改, 不用 native dialog 避免 showModal/close 同步问题)
 * 样式: fixed right-0 top-0 z-50 h-screen w-[420px] + border-l + shadow-md
 * 动效: drawer-in 220ms ease-out (从右滑入)
 * 关闭: Esc 键 / 点 backdrop (bg-black/30) / 右上 X 按钮 / 浮球 toggle
 *
 * P3.10.8 (holy 反馈 #13473): 输入区贴底
 *  - 对话 section 改 flex-1 min-h-0 (撑满中间剩余, 内部滚动)
 *  - 头部 / mode / context / 任务卡 / 输入区都加 shrink-0 (不被压缩)
 *  - AIChatMessages 0 消息 h-32 → h-full (也撑满 section)
 *
 * P3.10.9 (holy 反馈 #13494 "AI 助手无法关闭"):
 *  - 不用 native dialog (showModal + onClose 同步有问题: 浮球 toggle 二次点击失效)
 *  - 改用普通 div 容器 + open 控制 display + backdrop 独立 div
 *  - 浮球点 → toggle 走 React state 同步, 100% 可靠
 *
 * P3.10.11 修正 (holy 反馈 #13577 后续 "修改错了, AI 助手右上角的X 关闭不要删除, 是右下角的 X 删除, 不要搞反"):
 *  - **AIAssistant.tsx 浮球不再 inX mode**: 浮球永远显示 mode icon (Sparkles/Bot/Building2), 不在 open=true 时变 X
 *  - **AIAssistantPanel.tsx 恢复 header 右上 X 关闭按钮**: 保留作为视觉主关路径
 *  - 4 关闭路径: Panel header X 按钮 + Esc (全局 keydown) + backdrop (bg-black/30) + 浮球 toggle (永远 mode icon)
 */
import * as React from 'react';
import { Send, Loader2, Sparkles, Bot, Wand2, Trash2, X } from 'lucide-react';
import { Button, Textarea } from '@/components/ui';
import { useAIAssistant, type AIMode } from '@/stores/aiAssistant';
import { AIContextBadge } from './AIContextBadge';
import { AIQuickActions } from './AIQuickActions';
import { AIChatMessages } from './AIChatMessages';
import { cn } from '@/lib/utils';

const MODE_LABEL: Record<AIMode, string> = {
  article: '文章',
  template: '模板',
  general: '通用',
};

const MODE_ICON: Record<AIMode, React.ComponentType<{ className?: string }>> = {
  article: Bot,
  template: Wand2,
  general: Sparkles,
};

export const AIAssistantPanel: React.FC = () => {
  const open = useAIAssistant((s) => s.open);
  const close = useAIAssistant((s) => s.close);
  const mode = useAIAssistant((s) => s.mode);
  const setMode = useAIAssistant((s) => s.setMode);
  const isRunning = useAIAssistant((s) => s.isRunning);
  const messages = useAIAssistant((s) => s.messages);
  const send = useAIAssistant((s) => s.send);
  const clearMessages = useAIAssistant((s) => s.clearMessages);

  const [prompt, setPrompt] = React.useState('');
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const pendingTask = useAIAssistant((s) => s.pendingTask);

  // P3.10.9: 全局监听 Esc 关闭 (不依赖抽屉聚焦, 任意焦点都能关)
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);
  const ModeIcon = MODE_ICON[mode];
  const accent = mode === 'template' ? 'purple' : mode === 'article' ? 'blue' : 'slate';

  // P3.10.4: pendingTask 变化时 auto-focus textarea (theme 卡点后提示用户填)
  React.useEffect(() => {
    if (pendingTask && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [pendingTask]);

  const handleSend = React.useCallback(async () => {
    const text = prompt.trim();
    if (!text || isRunning) return;
    setPrompt('');
    await send(text);
  }, [prompt, isRunning, send]);

  return (
    <>
      {/* P3.10.9: backdrop (点击关闭). 用半透明遮罩, 不挡浮动按钮 */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={close}
          aria-hidden="true"
        />
      )}
      <div
        className={cn(
        // P3.10.9: 不用 native dialog, 用普通 div 容器.  open 控制显隐 + 动效
        'fixed inset-y-0 right-0 z-50 h-screen max-h-screen w-[420px] max-w-[90vw]',
        'flex flex-col border-l bg-background shadow-md',
        open && 'animate-[drawer-in_220ms_ease-out]',
      )}
      role="dialog"
      aria-modal="true"
      aria-label="AI 助手"
      style={{ display: open ? 'flex' : 'none' }}
    >
      <div className="flex h-full flex-col gap-3 p-4">
        {/* Header: 标题 + 关闭按钮 */}
        <div className="flex shrink-0 items-center justify-between border-b pb-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-blue-600" />
            <span className="text-[14px] font-semibold">AI 助手</span>
            <span className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-secondary/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <ModeIcon className="h-2.5 w-2.5" />
              {MODE_LABEL[mode]}
            </span>
            <span className="ml-1 text-[10px] text-muted-foreground">基于当前页面的内容给你建议</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={close}
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            title="关闭 (Esc)"
            aria-label="关闭 AI 助手"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        {/* Mode 切换器 + 清空按钮 */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5">
            {(['article', 'template', 'general'] as AIMode[]).map((m) => {
              const Icon = MODE_ICON[m];
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {MODE_LABEL[m]}
                </button>
              );
            })}
          </div>
          {messages.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={clearMessages}
              className="ml-auto h-6 text-[11px] text-muted-foreground"
              title="清空对话历史"
            >
              <Trash2 className="mr-1 h-3 w-3" /> 清空
            </Button>
          )}
        </div>

        {/* 上下文 */}
        <div className="shrink-0">
          <AIContextBadge />
        </div>

        {/* 任务卡片 (按 mode 过滤) */}
        <section className="shrink-0">
          <h3 className="mb-1.5 text-[11px] font-medium text-muted-foreground">快速操作</h3>
          <AIQuickActions />
        </section>

        {/* 对话消息 (撑满中间剩余空间, 内部滚动) */}
        <section className="flex min-h-0 flex-1 flex-col">
          <h3 className="mb-1.5 shrink-0 text-[11px] font-medium text-muted-foreground">对话</h3>
          <AIChatMessages accent={accent} className="min-h-0 flex-1" />
        </section>

        {/* 输入区 (底部固定, P3.10.8 holy 反馈 #13473) */}
        <div className="flex shrink-0 items-end gap-1.5 border-t pt-3">
          <Textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              pendingTask
                ? pendingTask === 'theme'
                  ? '描述要改的样式 (如: 主色换深蓝, 字体大一号) ⌘/Ctrl+Enter 发送'
                  : pendingTask === 'image'
                  ? '描述图片内容 (例: 科技蓝渐变背景的笔记本电脑) ⌘/Ctrl+Enter 发送'
                  : pendingTask === 'import_paste_html'
                  ? '粘贴 HTML 源码或纯文本 (Ctrl/Cmd+V) ⌘/Ctrl+Enter 发送'
                  : '补充信息后发送 (⌘/Ctrl+Enter)'
                : mode === 'article'
                ? '输入提示词 (⌘/Ctrl+Enter 发送)'
                : mode === 'template'
                ? '描述样式调整 (⌘/Ctrl+Enter 发送)'
                : '跟 AI 助手对话 (⌘/Ctrl+Enter 发送)'
            }
            className="min-h-[60px] flex-1 resize-none text-[12px]"
            rows={2}
            disabled={isRunning}
          />
          <Button
            onClick={handleSend}
            disabled={isRunning || !prompt.trim()}
            size="sm"
            className="h-[60px] w-12 bg-primary hover:bg-primary/90"
            title="发送 (⌘/Ctrl+Enter)"
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin text-primary-foreground" /> : <Send className="h-4 w-4 text-primary-foreground" />}
          </Button>
        </div>
      </div>
      </div>
    </>
  );
};
