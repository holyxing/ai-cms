/**
 * AI API 模块
 * 封装: providers / tasks / runs / 流式 / accept+reject
 */
import { api, API_BASE } from './client';
import { useAuthStore } from '@/stores/auth';

// ===== 类型 =====
export type AITaskType = 'rewrite' | 'expand' | 'shorten' | 'polish' | 'translate' | 'draft' | 'format_html' | 'audit' | 'theme' | 'image' | 'optimize_design' | 'responsive' | 'a11y' | 'seo' | 'extract_assets'
  // P3.9.4+ (holy 反馈 #12096): 文档导入
  | 'import_docx' | 'import_pdf' | 'import_paste_html'
  // P3.9.6+ (holy 反馈 #12444): 站点 AI 智能体
  | 'site_agent';

export interface AIProvider {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'ollama' | 'minimax' | 'custom';
  model: string;
  base_url?: string | null;
  is_default: boolean;
  is_configured: boolean; // 是否有 api_key
  created_at: string;
}

export interface AITaskInfo {
  type: AITaskType;
  label: string;
  description: string;
  requires_selection?: boolean;
}

export interface AIRun {
  id: string;
  task_type: AITaskType;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  current_step: string | null;
  steps_done: number;
  steps_total: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  start_at: string | null;
  finish_at: string | null;
  // P4.1 fix: 跟后端 AIRunOut schema 对齐 (prompt_tokens + completion_tokens 独立字段, 不是嵌套 tokens)
  // 之前 tokens.prompt 在响应里是 undefined, 导致 AIRuns 列表 + 详情崩
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: string | number | null;  // 后端返 Decimal as string, 留 string union 兼容
  content_id: string | null;
  // P3.9 redesign 专用
  layout_id?: string | null;
  design_lang?: string | null;
  diff_html?: string | null;
  diff_stats?: { added?: number; removed?: number; changed?: number; old_lines?: number; new_lines?: number } | null;
  created_at: string;
}

export interface AIRunStartResponse {
  run_id: string;
  stream_url: string;
}

export interface AIStreamEvent {
  event: 'status' | 'delta' | 'step' | 'output' | 'error' | 'done' | string;
  data: unknown;
}

// ===== 任务列表 (前端常量, 与后端 agent/router 同步) =====
export const AI_TASKS: AITaskInfo[] = [
  { type: 'rewrite',   label: '改写',   description: '保持原意, 换种说法' },
  { type: 'expand',    label: '扩写',   description: '增加细节, 拉长篇幅' },
  { type: 'shorten',   label: '缩写',   description: '压缩字数, 保留要点' },
  { type: 'polish',    label: '润色',   description: '改善语气, 更自然' },
  { type: 'translate', label: '翻译',   description: '翻译成英文 (默认目标语)' },
  { type: 'draft',     label: '起稿',   description: '根据标题/大纲起完整文章' },
  // P3.3-P3.5
  { type: 'audit',     label: '审计',   description: '拼写 / SEO / 可读性审计' },
  { type: 'theme',     label: '改样式', description: '自然语言改 design tokens' },
  { type: 'image',     label: '配图',   description: '生成占位配图 (mock)' },
  // P3.9 「AI 设计」 (LayoutEditPage 用)
  { type: 'optimize_design', label: 'AI 优化设计', description: '重设计视觉/版式, 按 design_lang (linear/github/notion/transwarp)' },
  { type: 'responsive',      label: '响应式补全',  description: '加移动端 @media 768px 样式' },
  { type: 'a11y',            label: 'a11y 增强',   description: '补 alt/aria/role/semantic tag' },
  { type: 'seo',             label: 'SEO 增强',    description: '补 canonical/og/Twitter/JSON-LD' },
];

// ===== Providers =====
export const aiApi = {
  listProviders: () =>
    api.get<{ data: AIProvider[] }>('/ai/providers').then((r) => r.data.data),

  createProvider: (payload: {
    name: string;
    provider: 'openai' | 'anthropic' | 'ollama' | 'minimax' | 'custom';
    model: string;
    api_key?: string;
    base_url?: string;
    is_default?: boolean;
  }) =>
    api
      .post<{ data: AIProvider }>('/ai/providers', payload)
      .then((r) => r.data.data),

  deleteProvider: (id: string) =>
    api.delete<null>(`/ai/providers/${id}`).then(() => undefined),

  updateProvider: (id: string, body: {
    name?: string;
    model?: string;
    api_key?: string;
    base_url?: string;
    is_default?: boolean;
  }) =>
    api
      .patch<{ data: AIProvider }>(`/ai/providers/${id}`, body)
      .then((r) => r.data.data),

  listTasks: () =>
    api.get<{ data: { tasks: AITaskType[] } | AITaskType[] }>('/ai/tasks').then((r) => {
      const d = r.data.data;
      if (Array.isArray(d)) return d as AITaskType[];
      if (d && Array.isArray((d as { tasks: AITaskType[] }).tasks)) return (d as { tasks: AITaskType[] }).tasks;
      return [];
    }),

  startTask: (taskType: AITaskType, payload: Record<string, unknown>) => {
    // P3.5: input 直接透传, 不再 wrapper (各任务自己负责 input schema)
    //   rewrite/expand/shorten/polish/translate: { original_text: string }
    //   draft:                                  { word_count: number, [大纲文本] }
    //   audit:                                  { content_id: string } 或 { text: string }
    //   theme:                                  { current_tokens: dict, instruction: string }
    //   image:                                  { prompt: string, width?, height? }
    return api
      .post<{ data: AIRunStartResponse }>(`/ai/tasks/${taskType}/start`, payload)
      .then((r) => r.data.data);
  },

  listRuns: (params?: { site_id?: string; status?: string; page?: number; size?: number }) =>
    api
      .get<{ data: { items: AIRun[]; total: number } }>('/ai/runs', { params })
      .then((r) => r.data.data),

  getRun: (id: string) =>
    api.get<{ data: AIRun }>(`/ai/runs/${id}`).then((r) => r.data.data),

  acceptRun: (id: string, body: Record<string, unknown> = {}) =>
    api.post<{ data: { version_num: number; content_id: string } }>(`/ai/runs/${id}/accept`, body).then((r) => r.data.data),

  rejectRun: (id: string) =>
    api.post<{ data: { run_id: string; status: string } }>(`/ai/runs/${id}/reject`).then((r) => r.data.data),

  // P3.9: 接受 AI 重设计结果 (写 layout 新版本)
  acceptRedesign: (id: string, body: { content_id?: string } = {}) =>
    api
      .post<{
        data: {
          run_id: string;
          layout_id: string;
          version: number;
          html_length: number;
          task_type: string;
          design_lang: string;
        };
      }>(`/ai/runs/${id}/accept-redesign`, body)
      .then((r) => r.data.data),

  // Prompt 统一管理（工具可对接 export/import）
  listPrompts: (category?: string) =>
    api
      .get<{ data: { items: AIPromptItem[]; total: number } }>('/ai/prompts', {
        params: category ? { category } : undefined,
      })
      .then((r) => r.data.data),

  getPrompt: (key: string) =>
    api.get<{ data: AIPromptItem }>(`/ai/prompts/${encodeURIComponent(key)}`).then((r) => r.data.data),

  updatePrompt: (key: string, content: string) =>
    api
      .patch<{ data: AIPromptItem }>(`/ai/prompts/${encodeURIComponent(key)}`, { content })
      .then((r) => r.data.data),

  resetPrompt: (key: string) =>
    api
      .post<{ data: AIPromptItem }>(`/ai/prompts/${encodeURIComponent(key)}/reset`)
      .then((r) => r.data.data),

  exportPrompts: () =>
    api.get<{ data: AIPromptExportBundle }>('/ai/prompts/export').then((r) => r.data.data),

  importPrompts: (items: Record<string, unknown>[], overwrite = true) =>
    api
      .post<{ data: { created: number; updated: number; skipped: number } }>('/ai/prompts/import', {
        items,
        overwrite,
      })
      .then((r) => r.data.data),
};

export interface AIPromptItem {
  id: string;
  key: string;
  label: string;
  description: string | null;
  category: 'task' | 'quick' | 'enhance' | 'import' | string;
  task_type: string | null;
  content: string;
  builtin_content: string;
  variables: string[];
  version: number;
  is_customized: boolean;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AIPromptExportBundle {
  format: string;
  version: number;
  items: Array<{
    key: string;
    label: string;
    description?: string | null;
    category: string;
    task_type?: string | null;
    content: string;
    variables?: string[];
    is_customized?: boolean;
    version?: number;
  }>;
}

// ===== SSE 流式 (fetch + ReadableStream, 不用 EventSource 因为要 Bearer) =====
export interface StreamHandlers {
  onEvent?: (e: AIStreamEvent) => void;
  onDelta?: (delta: string) => void;  // P3.9 redesign 简化: 只拿 delta 文本
  onDone?: () => void;
  onError?: (err: string | Error) => void;  // P3.9 兼容字符串
  onAbort?: () => void;  // P3.10 (AI 整合重构): AbortError 时调, store 用来 set state=cancelled
  signal?: AbortSignal;
}

export async function streamRun(runId: string, h: StreamHandlers): Promise<() => void> {
  const token = useAuthStore.getState().accessToken;
  const url = `${API_BASE}/ai/runs/${runId}/stream`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token ?? ''}` },
      signal: h.signal,
    });
  } catch (e) {
    h.onError?.(e instanceof Error ? e : String(e));
    return () => {};
  }
  if (!resp.ok || !resp.body) {
    h.onError?.(new Error(`SSE HTTP ${resp.status}`));
    return () => {};
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const cancel = () => { try { reader.cancel(); } catch {} };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // 按 \n\n 拆 SSE 事件
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = parseSSEBlock(raw);
        if (ev) {
          h.onEvent?.(ev);
          // P3.9 简化: 抽 delta
          if (ev.event === 'delta' && typeof ev.data === 'string') {
            h.onDelta?.(ev.data);
          } else if (ev.event === 'output' && ev.data && typeof ev.data === 'object' && 'delta' in (ev.data as any)) {
            h.onDelta?.(String((ev.data as any).delta || ''));
          } else if (ev.event === 'error') {
            h.onError?.(typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data));
          } else if (ev.event === 'done') {
            h.onDone?.();
          }
        }
      }
    }
    // 收尾残留
    if (buf.trim()) {
      const ev = parseSSEBlock(buf);
      if (ev) h.onEvent?.(ev);
    }
    // P3.10 (AI 整合重构): 检查 signal 是否被 abort, 是的话不调 onDone, 调 onAbort
    if (h.signal?.aborted) {
      h.onAbort?.();
    } else {
      h.onDone?.();
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      // P3.10 (AI 整合重构): abort 后还是调 onError, 让 store 能 set state=cancelled
      // (store 内部靠 onError 里的 ev.event === 'error' 处理; abort 走另一路调 onAbort)
      h.onAbort?.();
      return cancel;
    }
    h.onError?.(e instanceof Error ? e : String(e));
  }
  return cancel;
}

function parseSSEBlock(block: string): AIStreamEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  const dataStr = dataLines.join('\n');
  if (!dataStr || dataStr === '[DONE]') {
    if (dataStr === '[DONE]') return { event: 'done', data: null };
    return null;
  }
  try {
    return { event, data: JSON.parse(dataStr) };
  } catch {
    return { event, data: dataStr };
  }
}
