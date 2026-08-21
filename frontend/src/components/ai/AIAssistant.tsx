/**
 * AIAssistant.tsx - 全局 AI 助手浮动按钮 + Modal 容器 (P3.10)
 *
 * 整合 P3.9.6+ SiteAIFloatButton + AIChatPopup + AIChatPanel
 * 全站共享一个浮动入口 (主色蓝实色, 遵守设计系统 06)
 * 路由订阅: useRouteAIContext 自动同步 mode (Q2A)
 * 跨 tab 共享: store 全局 zustand, tab 关闭不丢消息
 */
import * as React from 'react';
import { Building2, Sparkles, Bot } from 'lucide-react';
import { useAIAssistant, type AIMode } from '@/stores/aiAssistant';
import { useRouteAIContext } from './aiContext';
import { AIAssistantPanel } from './AIAssistantPanel';
import { cn } from '@/lib/utils';

const MODE_ICON: Record<AIMode, React.ComponentType<{ className?: string }>> = {
  article: Bot,
  template: Building2,
  general: Sparkles,
};

export const AIAssistant: React.FC = () => {
  // 路由订阅: 路径变 → 自动推 mode
  useRouteAIContext();

  const open = useAIAssistant((s) => s.open);
  const mode = useAIAssistant((s) => s.mode);

  const handleToggle = () => useAIAssistant.getState().toggle();
  const handleClose = () => useAIAssistant.getState().close();

  // P3.10.11 修正 (holy 反馈 #13577 后续 "修改错了, 是右下角的 X 删除"): 浮球不再 inX mode
  //  - 浮球永远显示 mode icon (Sparkles/Bot/Building2), 保持视觉一致
  //  - 抽屉打开后仍可点浮球 toggle, 但视觉上不重复暗示 "关"
  //  - 关闭路径: Panel header X 按钮 + Esc + backdrop + 浮球 toggle (4 个, 以 X 为视觉主关路径)
  const Icon = MODE_ICON[mode];

  return (
    <>
      {/* 浮动按钮 (主色蓝实色, 遵守设计系统 06: 无渐变/无大阴影/无装饰堆砌) */}
      <button
        onClick={handleToggle}
        title={open ? '关闭 AI 助手' : `打开 AI 助手 (${mode})`}
        aria-label="AI 助手"
        // P3.10.12 (holy 反馈 "右下角蓝色浮球遮挡发送按键了"): 抽屉打开时隐藏浮球
        //  - 抽屉 420px 宽 + bottom-6 right-6 浮球位置 = 正好压在输入框的"发送"按钮上
        //  - 抽屉打开时 3 关闭路径 (Panel X + Esc + backdrop) 足够
        //  - 抽屉关闭时浮球显示 (打开入口)
        className={cn(
          'fixed bottom-6 right-6 z-[60] flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-colors',
          'hover:bg-primary/90 active:scale-95',
          open ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
      >
        <Icon className="h-4 w-4" />
      </button>

      {/* Modal 弹窗 (居中, max-w-3xl) */}
      <AIAssistantPanel />

      {/* 抑制未用变量 warning */}
      <span className="hidden">{String(open)}</span>
    </>
  );
};
