/**
 * aiAssistant.ts - 统一 AI 助手全局 store (P3.10)
 *
 * 整合原 3 套 AI 入口 (article AI / site AI / template AI) 状态:
 * - 替换 stores/editor.ts: popupOpen/triggerPos/popupPos
 * - 替换 stores/siteAIDrawer.ts: open/openDrawer/closeDrawer
 * - 替换 AIChatPanel / SiteAIPanel / AIThemeDialog 的本地 useState
 *
 * 数据流:
 *   页面 mount -> setContext({type, target, payload}) 注入上下文
 *   路由变 -> 路由订阅 (ContentLayout) 调 inferModeFromPath 自动算 mode
 *   顶 nav / Dashboard / 任意位置 -> openAssistant() 弹窗
 *   用户输入或点任务 -> send() 走 aiApi.startTask + streamRun
 *   accept/reject -> 调 context.onApply 或 context.onReject
 *
 * 设计:
 * - 跨 tab 共享 (跟 tabs store 一致): 通过 ContentLayout/AppLayout 顶层挂载
 * - 不持久化: 关闭弹窗或刷新 = 清空 (避免老 context 污染)
 * - mode 推断默认从 URL, 页面可 setMode override
 */
import { create } from 'zustand';
import { aiApi, streamRun, type AITaskType, type AIStreamEvent } from '@/api/ai';
import { toast } from 'sonner';

// ===== 类型 =====
export type AIMode = 'article' | 'template' | 'general';

export interface AIContext {
  /** 上下文类型 (article/template/general) — 同时也是 mode 推断的 hint */
  type: AIMode;
  /** 目标对象 ID + 元数据 (用于 diff apply 跟 conversation) */
  target: {
    resourceId: string;          // content_id / layout_id / 站点 id / null
    siteId: string;
    title: string;
    slug?: string;
    /** 模板 design language (template 模式) */
    designLang?: 'github' | 'linear' | 'notion' | 'transwarp';
  };
  /** 上下文 payload (文章 body / 模板 HTML / sites 列表 ...) */
  payload: {
    /** 文章 body (article) */
    body?: string;
    /** 模板 HTML 源码 (template) */
    html?: string;
    /** 模板 design tokens (template/theme) */
    tokens?: Record<string, unknown>;
    /** 文章 excerpt (article) */
    excerpt?: string;
    /** 站点列表快照 (general/site_agent) */
    sitesContext?: Array<{
      id: string; slug: string; name: string; status: string;
      publish_status: string; domains: string[];
    }>;
    /** 接受 AI 改写后的回调 (各页面注册 setOnApply) */
    onApply?: (newText: string) => void;
    /** 拒绝/重置后回调 */
    onReject?: () => void;
  };
}

/** 统一消息结构 (article/template/general 共用) */
export type ChatMessage =
  | { kind: 'user-prompt'; id: string; prompt: string; ts: number }
  | { kind: 'user-task';   id: string; task: AITaskType; label: string; extraInput?: Record<string, unknown>; ts: number }
  | {
      kind: 'ai-run';
      id: string;
      task: AITaskType;
      label: string;
      runId: string;
      text: string;
      state: 'starting' | 'running' | 'success' | 'failed' | 'cancelled' | 'accepted' | 'rejected';
      error?: string;
      stepsDone: number;
      stepsTotal: number;
      tokens: { prompt: number; completion: number };
      cost: number;
      /** 文章改写后的完整结果 (apply 用) */
      resultText?: string;
      /** 模板改写后的 HTML (apply 用) */
      resultHtml?: string;
      /** theme 任务: tokens diff */
      resultTokens?: Record<string, unknown>;
      ts: number;
    };

// ===== State =====

interface AIAssistantState {
  /** 弹窗开关 */
  open: boolean;
  /** 当前模式 (auto from URL, 可手动切) */
  mode: AIMode;
  /** 注入的上下文 (Q2C) */
  context: AIContext | null;
  /** site_agent 多轮对话 ID */
  conversationId: string | null;
  /** 消息列表 (3 模式共用) */
  messages: ChatMessage[];
  /** 是否正在跑 (流式中) */
  isRunning: boolean;
  /** abort 控制器 (ref 用) */
  abortRef: AbortController | null;
  /** P3.10.4: 点任务卡后, 但需要用户填输入的"预选任务" (如 theme) */
  pendingTask: AITaskType | null;
}

interface AIAssistantActions {
  // ===== actions =====
  openAssistant: (mode?: AIMode) => void;
  close: () => void;
  toggle: () => void;
  setMode: (mode: AIMode) => void;
  setContext: (ctx: AIContext | null) => void;
  setOnApply: (fn: ((newText: string) => void) | null) => void;
  setOnReject: (fn: (() => void) | null) => void;
  setPendingTask: (task: AITaskType | null) => void;

  /** 发送 prompt (走 site_agent 或自然语言对话) */
  send: (text: string, task?: AITaskType, extraInput?: Record<string, unknown>) => Promise<void>;
  /** 中止当前 run */
  abort: () => void;
  /** 接受 AI 结果 */
  accept: (msgId: string) => Promise<void>;
  /** 拒绝 AI 结果 */
  reject: (msgId: string) => Promise<void>;
  /** 清空消息 (新会话) */
  clearMessages: () => void;
  /** 重置全部 (路由离开时) */
  reset: () => void;
}

const newId = () => `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

// ===== Store =====

type AIAssistantStore = AIAssistantState & AIAssistantActions;

export const useAIAssistant = create<AIAssistantStore>()((set, get) => ({
  // ===== state =====
  open: false,
  mode: 'general',
  context: null,
  conversationId: null,
  messages: [],
  isRunning: false,
  abortRef: null,
  pendingTask: null,

  // ===== actions =====
  openAssistant: (mode) => {
    if (mode) set({ mode, open: true });
    else set({ open: true });
  },
  close: () => {
    // 关闭时 abort 正在跑的 run
    const { abortRef } = get();
    if (abortRef) abortRef.abort();
    set({ open: false });
  },
  toggle: () => set((s) => ({ open: !s.open })),
  setMode: (mode) => set({ mode }),
  setContext: (ctx) => set({ context: ctx, mode: ctx?.type ?? 'general' }),
  setOnApply: (fn) => {
    const ctx = get().context;
    if (!ctx) return;
    set({ context: { ...ctx, payload: { ...ctx.payload, onApply: fn } } });
  },
  setOnReject: (fn) => {
    const ctx = get().context;
    if (!ctx) return;
    set({ context: { ...ctx, payload: { ...ctx.payload, onReject: fn } } });
  },
  setPendingTask: (task) => {
    set({ pendingTask: task });
  },

  // ===== 发送 (核心: 启动 AI run + SSE 流式订阅) =====
  send: async (text, task, extraInput) => {
    const state = get();
    if (state.isRunning) {
      toast.error('AI 正在跑, 请先等待或取消');
      return;
    }
    const userText = text.trim() || (typeof extraInput?.user_prompt === 'string' ? (extraInput.user_prompt as string).trim() : '');
    if (!userText && !task && !state.pendingTask) return;

    const mode = state.mode;
    const ctx = state.context;
    // P3.10.4: pendingTask 优先 — AIQuickActions 点卡只设 pendingTask, 用户输入后才真送
    // 文章自由输入默认 polish（支持长 HTML + 自然语言指令），不再走 rewrite(8k)
    const effectiveTask: AITaskType =
      task ??
      state.pendingTask ??
      (mode === 'general' ? 'site_agent' : mode === 'article' ? 'polish' : 'rewrite');
    // 跨调用后清 pendingTask (只一次)
    if (state.pendingTask) set({ pendingTask: null });

    // 1) 拼 user 消息
    const userMsg: ChatMessage = task
      ? { kind: 'user-task', id: newId(), task, label: task, extraInput, ts: Date.now() }
      : { kind: 'user-prompt', id: newId(), prompt: userText, ts: Date.now() };

    // 2) 拼 ai-run placeholder
    const aiMsgId = newId();
    const aiMsg: ChatMessage = {
      kind: 'ai-run',
      id: aiMsgId,
      task: effectiveTask,
      label: task ?? (mode === 'general' ? '站点智能体' : userText.slice(0, 30)),
      runId: '',
      text: '',
      state: 'starting',
      stepsDone: 0,
      stepsTotal: 0,
      tokens: { prompt: 0, completion: 0 },
      cost: 0,
      ts: Date.now(),
    };
    set({ messages: [...state.messages, userMsg, aiMsg], isRunning: true });

    // 3) 拼 start payload (按 mode 适配)
    // 后端 schema: { site_id, content_id, layout_id, provider_id, model, input, design_lang, conversation_id }
    // input 是嵌套 dict, 各 task_type 自己读需要的字段
    // ⚠️ Pydantic Optional[UUID] 收到空串会校验失败, 空串要转 None
    const siteIdOrEmpty = ctx?.target.siteId || '';
    const startPayload: Record<string, unknown> = {
      site_id: siteIdOrEmpty || undefined,
      // article 模式: content_id = ctx.target.resourceId
      // template 模式: layout_id = ctx.target.resourceId
      ...(mode === 'article'
        ? { content_id: ctx?.target.resourceId || undefined }
        : mode === 'template'
        ? {
            layout_id: ctx?.target.resourceId || undefined,
            design_lang: ctx?.target.designLang,
          }
        : {}),
      // P3.9.6+ (holy 反馈 #12444): site_agent 多轮 - 复用上次 convId
      ...(state.conversationId && effectiveTask === 'site_agent'
        ? { conversation_id: state.conversationId }
        : {}),
      input: { ...(extraInput ?? {}) },
    };
    if (mode === 'article' && ctx?.payload.body) {
      // 与后端 text_transform max_input=48000 对齐
      const maxChars = 48000;
      const truncatedBody = ctx.payload.body.length > maxChars
        ? ctx.payload.body.slice(0, maxChars) + '\n<!-- ... (源文本截断，请缩短后再试) -->'
        : ctx.payload.body;
      startPayload.input = {
        ...(startPayload.input as Record<string, unknown>),
        // text_transform 7 任务 (rewrite/expand/shorten/polish/translate/draft/format_html) 用 original_text
        // audit 任务用 text
        // 两个都传避免漏
        original_text: truncatedBody,
        text: truncatedBody,
      };
    }
    // 文章自由输入 / 待确认任务：把用户话当作指令（如「去掉黑色背景」）
    if (
      mode === 'article' &&
      userText &&
      ['rewrite', 'expand', 'shorten', 'polish', 'translate', 'format_html'].includes(effectiveTask)
    ) {
      const input = startPayload.input as Record<string, unknown>;
      if (input.user_prompt == null || input.user_prompt === '') {
        input.user_prompt = userText;
        startPayload.input = input;
      }
    }
    // P3.10.6 (holy 反馈 #13416): image 任务要 prompt, import_paste_html 要 content
    if (effectiveTask === 'image' && userText) {
      startPayload.input = {
        ...(startPayload.input as Record<string, unknown>),
        prompt: userText,
      };
    }
    if (effectiveTask === 'import_paste_html' && userText) {
      startPayload.input = {
        ...(startPayload.input as Record<string, unknown>),
        content: userText,
        apply_layout: true,
      };
    }
    if (mode === 'template' && ctx?.payload.html && effectiveTask !== 'theme') {
      // redesign 4 任务 (optimize_design/responsive/a11y/seo) + extract_assets 用 html
      startPayload.input = {
        ...(startPayload.input as Record<string, unknown>),
        html: ctx.payload.html,
        design_lang: ctx?.target.designLang,
      };
    }
    if (mode === 'template' && effectiveTask === 'theme') {
      startPayload.input = {
        ...(startPayload.input as Record<string, unknown>),
        // P3.10.4 (holy 反馈 #13214): site_id 让后端兑底拉 current_tokens
        site_id: ctx?.target?.siteId,
        current_tokens: ctx?.payload?.tokens ?? {},
        instruction: userText,
      };
    }
    if (mode === 'general' || effectiveTask === 'site_agent') {
      startPayload.input = {
        ...(startPayload.input as Record<string, unknown>),
        user_input: userText,
        sites_context: ctx?.payload.sitesContext ?? [],
      };
    }

    // 4) start task
    let runId: string;
    try {
      const r = await aiApi.startTask(effectiveTask, startPayload);
      runId = r.run_id;
      // 同步 runId 到消息 (让 accept 按钮能找到 run)
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === aiMsgId && m.kind === 'ai-run' ? { ...m, runId } : m,
        ),
      }));
    } catch (e) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === aiMsgId && m.kind === 'ai-run'
            ? { ...m, state: 'failed', error: e instanceof Error ? e.message : String(e) }
            : m,
        ),
        isRunning: false,
      }));
      return;
    }

    // 5) SSE 流式订阅
    const abortController = new AbortController();
    set({ abortRef: abortController });

    let accumulated = '';
    await streamRun(runId, {
      signal: abortController.signal,
      onAbort: () => {
        // P3.10 (AI 整合重构): AbortError 时 set state=cancelled
        // 避免 abort 后 store 还显示 running
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === aiMsgId && m.kind === 'ai-run' && (m.state === 'starting' || m.state === 'running')
              ? { ...m, state: 'cancelled', error: '已取消' }
              : m,
          ),
          isRunning: false,
          abortRef: null,
        }));
      },
      onEvent: (ev: AIStreamEvent) => {
        const d = ev.data as Record<string, unknown> | null;
        if (!d) return;
        if (typeof d.delta === 'string') {
          accumulated += d.delta;
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === aiMsgId && m.kind === 'ai-run'
                ? { ...m, text: accumulated, state: 'running' }
                : m,
            ),
          }));
        }
        if (ev.event === 'step' && typeof d.step === 'string') {
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === aiMsgId && m.kind === 'ai-run'
                ? {
                    ...m,
                    state: 'running',
                    stepsDone: typeof d.steps_done === 'number' ? d.steps_done : m.stepsDone,
                    stepsTotal: typeof d.steps_total === 'number' ? d.steps_total : m.stepsTotal,
                  }
                : m,
            ),
          }));
        }
        // 终态检测: 后端 SSE 用默认 event='message' 发送 status/output/error, 也在 [DONE] 之前
        if (d.status === 'success' || d.status === 'failed' || d.status === 'cancelled') {
          const finalStatus = d.status as 'success' | 'failed' | 'cancelled';
          const output = (d.output as Record<string, unknown> | undefined) ?? null;
          const tokens = (d.tokens as { prompt: number; completion: number } | undefined)
            ?? (output?.tokens_used != null ? { prompt: 0, completion: Number(output.tokens_used) } : null)
            ?? { prompt: 0, completion: 0 };
          const cost = typeof d.cost_usd === 'number' ? d.cost_usd : 0;
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === aiMsgId && m.kind === 'ai-run'
                ? {
                    ...m,
                    state: finalStatus,
                    runId,
                    error: finalStatus !== 'success' ? (d.error as string) ?? m.error : m.error,
                    tokens,
                    cost,
                    resultText: (output?.result_text as string) ?? (output?.rewritten_text as string) ?? (output?.text as string) ?? m.text,
                    resultHtml: (output?.result_html as string) ?? (output?.html as string) ?? undefined,
                    resultTokens: (output?.diff_tokens as Record<string, unknown>) ?? (output?.tokens as Record<string, unknown>),
                    stepsDone: m.stepsTotal || m.stepsDone,
                  }
                : m,
            ),
            isRunning: false,
            abortRef: null,
            // site_agent 多轮: 复用上次 conversationId (后端拿这个查历史 run)
            // 上次已 set, 这次就保持不变; 首次才用当前 runId
            conversationId: s.conversationId ?? (effectiveTask === 'site_agent' ? runId : null),
          }));
        }
        if (ev.event === 'error') {
          const errorMsg = (d.message as string) ?? 'AI run 失败';
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === aiMsgId && m.kind === 'ai-run'
                ? { ...m, state: 'failed', error: errorMsg }
                : m,
            ),
            isRunning: false,
            abortRef: null,
          }));
        }
      },
    });
  },

  abort: () => {
    const { abortRef } = get();
    if (abortRef) abortRef.abort();
    set((s) => ({
      messages: s.messages.map((m) =>
        m.kind === 'ai-run' && (m.state === 'starting' || m.state === 'running')
          ? { ...m, state: 'cancelled', error: '已取消' }
          : m,
      ),
      isRunning: false,
      abortRef: null,
    }));
  },

  accept: async (msgId) => {
    const { messages, context } = get();
    const msg = messages.find((m) => m.id === msgId && m.kind === 'ai-run');
    if (!msg || msg.state !== 'success') return;

    // 1) 调后端 accept (持久化到 content_versions / theme_version)
    try {
      await aiApi.acceptRun(msg.runId);
    } catch (e) {
      // 后端 accept 失败不阻塞前端 apply (前端已有结果)
      console.warn('ai accept run failed (非阻塞):', e);
    }

    // 2) 调 page 的 onApply (把结果写回编辑器)
    if (msg.task === 'theme' && msg.resultTokens) {
      // theme: 调专门的 theme accept handler
      const themeEvent = new CustomEvent('ai:theme:accept', {
        detail: { tokens: msg.resultTokens, description: msg.text },
      });
      window.dispatchEvent(themeEvent);
    } else if (msg.resultHtml) {
      context?.payload.onApply?.(msg.resultHtml);
    } else if (msg.resultText) {
      context?.payload.onApply?.(msg.resultText);
    }

    toast.success('已应用 AI 结果');

    // P3.10.5 (holy 反馈 #13316): 接受后消息隐藏接受/拒绝按钮 (状态改 accepted)
    // 不删消息 - 保留为"已应用"记录
    set((s) => ({
      messages: s.messages.map((m) => (m.id === msgId && m.kind === 'ai-run'
        ? { ...m, state: 'accepted' as const }
        : m)),
    }));
  },

  reject: async (msgId) => {
    const { messages, context } = get();
    const msg = messages.find((m) => m.id === msgId && m.kind === 'ai-run');
    if (!msg) return;

    try {
      await aiApi.rejectRun(msg.runId);
    } catch (e) {
      console.warn('ai reject run failed (非阻塞):', e);
    }

    context?.payload.onReject?.();
    toast('已拒绝 AI 结果');

    // P3.10.5: 拒绝后状态改 rejected
    set((s) => ({
      messages: s.messages.map((m) => (m.id === msgId && m.kind === 'ai-run'
        ? { ...m, state: 'rejected' as const }
        : m)),
    }));
  },

  clearMessages: () => set({ messages: [], conversationId: null }),
  reset: () => {
    const { abortRef } = get();
    if (abortRef) abortRef.abort();
    set({
      open: false,
      mode: 'general',
      context: null,
      conversationId: null,
      messages: [],
      isRunning: false,
      abortRef: null,
      pendingTask: null,
    });
  },
}));

// dev 暴露 (调试用)
if (typeof window !== 'undefined') {
  (window as unknown as { __aiAssistant: typeof useAIAssistant }).__aiAssistant = useAIAssistant;
}
