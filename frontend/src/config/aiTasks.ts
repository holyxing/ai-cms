/**
 * aiTasks.ts - AI 任务配置 (P3.10 从 AIChatPanel.QUICK_ACTIONS 抽出)
 *
 * 19 个 AI 任务按 mode 分组:
 * - article (10): 改写/扩写/缩写/润色/翻译/起稿/审计/配图/import_docx/import_pdf/import_paste_html
 * - template (6): theme/optimize_design/responsive/a11y/seo/extract_assets
 * - general (3): 创建站点 / 改站点名 / 触发发布 (走 site_agent 任务, 预填 user_prompt)
 *
 * UI 任务卡片只显示 getActionsForMode(mode) 过滤后的
 */
import type { LucideIcon } from 'lucide-react';
import {
  Wand2, AlignLeft, FileText, List, Languages, FileUp, ClipboardPaste,
  Paintbrush, FileCode2, LayoutTemplate, Smartphone, Eye, Search, Image as ImageIcon,
  Building2, Edit3, Rocket,
} from 'lucide-react';
import type { AITaskType } from '@/api/ai';
import type { AIMode } from '@/stores/aiAssistant';

export interface QuickAction {
  type: AITaskType;
  label: string;
  desc: string;
  icon: LucideIcon;
  /** 渐变配色 (icon 背景) */
  gradient: string;
  /** 模式分组 (article / template / general) */
  mode: 'article' | 'template' | 'general';
  /** 是否在卡片网格里隐藏 (site_agent 隐藏, 走输入框) */
  hidden?: boolean;
  /** 透传给 startTask 的 extraInput */
  extraInput?: Record<string, unknown>;
  /** P3.10.3 修复: 站点快捷操作走 modal 不走 AI, 标记哪种 modal */
  siteAction?: 'create_site' | 'edit_site' | 'publish_site';
  /** P3.10.4 修复: 点卡不立即 send, 只 setPendingTask (用户填输入才发) */
  requiresInput?: boolean;
  /** P3.10.5 修复: 弹文件选择器, 上传后 send (import_docx / import_pdf 走) */
  fileAccept?: string;  // 例: '.docx' 或 '.pdf'
}

export const AI_QUICK_ACTIONS: QuickAction[] = [
  // ===== 文章 AI (10) =====
  {
    type: 'polish',
    label: '润色这段文字',
    desc: '改病句、通顺、表达自然',
    icon: Wand2,
    gradient: 'blue',
    mode: 'article',
  },
  {
    type: 'format_html',
    label: '排版粘贴的文本',
    desc: '已有 HTML 秒排；纯文本才走 AI',
    icon: AlignLeft,
    gradient: 'blue',
    mode: 'article',
  },
  {
    type: 'polish',
    label: '起个标题',
    desc: '根据正文生成 3 个候选标题',
    icon: FileText,
    gradient: 'blue',
    mode: 'article',
    extraInput: { prompt_key: 'quick.title_candidates' },
  },
  {
    type: 'polish',
    label: '写摘要',
    desc: '100 字以内的文章导读',
    icon: List,
    gradient: 'blue',
    mode: 'article',
    extraInput: { prompt_key: 'quick.summary' },
  },
  {
    type: 'translate',
    label: '翻译成英文',
    desc: '保留 HTML 结构',
    icon: Languages,
    gradient: 'blue',
    mode: 'article',
    extraInput: { target_language: 'English' },
  },
  {
    type: 'audit',
    label: 'SEO 审计',
    desc: '关键词 / 拼写 / 可读性',
    icon: Search,
    gradient: 'blue',
    mode: 'article',
  },
  {
    type: 'image',
    label: 'AI 配图',
    desc: '描述图片内容 → 生成占位配图 (mock)',
    icon: ImageIcon,
    gradient: 'blue',
    mode: 'article',
    // P3.10.6 (holy 反馈 #13416): 需 user 填 prompt → pendingTask + auto-focus
    requiresInput: true,
    inputPrompt: '描述图片内容 (例: 科技蓝渐变背景的笔记本电脑)',
  },
  {
    type: 'import_docx',
    label: '导入 Word 文档',
    desc: '.docx → 结构化 HTML, 图片自动入库',
    icon: FileUp,
    gradient: 'blue',
    mode: 'article',
    // P3.10.5 (holy 反馈 #13287): 点卡弹文件选择器, 上传后 send
    fileAccept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  {
    type: 'import_pdf',
    label: '导入 PDF',
    desc: '提取文本 + 图片 → HTML, AI 排版',
    icon: FileText,
    gradient: 'blue',
    mode: 'article',
    // P3.10.5 (holy 反馈 #13291): 点卡弹文件选择器, 上传后 send
    fileAccept: '.pdf,application/pdf',
  },
  {
    type: 'import_paste_html',
    label: '粘贴富文本',
    desc: 'Word 粘贴 / 网页复制 → HTML, 图片上传',
    icon: ClipboardPaste,
    gradient: 'blue',
    mode: 'article',
    // P3.10.6 (holy 反馈 #13416): 需 user 粘贴 HTML/文本 → pendingTask + auto-focus
    requiresInput: true,
    inputPrompt: '粘贴 HTML 源码或纯文本 (Ctrl/Cmd+V)',
  },

  // ===== 模板 AI (6) =====
  {
    type: 'theme',
    label: '改样式',
    desc: '自然语言调整 design tokens (如: 主色换深蓝)',
    icon: Paintbrush,
    gradient: 'blue',
    mode: 'template',
    // P3.10.4: theme 任务需要 user 填 instruction (主色/字号/...具体要求)
    // 点卡不立即 send, 设 pendingTask + auto-focus 输入框, 用户填完按发送才跑
    requiresInput: true,
  },
  {
    type: 'optimize_design',
    label: '优化这块样式',
    desc: '重设计视觉/版式 (linear/github/notion)',
    icon: Paintbrush,
    gradient: 'purple',
    mode: 'template',
  },
  {
    type: 'extract_assets',
    label: '提取 CSS/JS 文件',
    desc: '抽出样式和脚本 → 独立资源',
    icon: FileCode2,
    gradient: 'purple',
    mode: 'template',
  },
  {
    type: 'optimize_design',
    label: '改为卡片布局',
    desc: '列表 → 卡片墙, 适合图文展示',
    icon: LayoutTemplate,
    gradient: 'purple',
    mode: 'template',
    extraInput: { prompt_key: 'quick.card_layout' },
  },
  {
    type: 'responsive',
    label: '适配移动端',
    desc: '加 @media 断点, 网格改单列',
    icon: Smartphone,
    gradient: 'purple',
    mode: 'template',
  },
  {
    type: 'a11y',
    label: '提升可访问性',
    desc: '补 alt / aria / role / 焦点可见',
    icon: Eye,
    gradient: 'purple',
    mode: 'template',
  },

  // ===== General (3, 站点操作 - 弹 modal 不走 AI 多轮) =====
  // P3.10.3 修复 (holy 反馈 #13169): 之前走 site_agent 多轮反问体验很啰嗦
  // 修法: 这 3 个卡走 formModal, 一次点完事, 不调 AI
  // 站点操作 = 'create_site' | 'edit_site' | 'publish_site' (3 种 modal)
  {
    type: 'site_agent',
    label: '创建新站点',
    desc: '表单填写, 一次创建 (name/slug/描述)',
    icon: Building2,
    gradient: 'purple',
    mode: 'general',
    siteAction: 'create_site',
  },
  {
    type: 'site_agent',
    label: '重命名当前站点',
    desc: '表单修改名称/描述/logo',
    icon: Edit3,
    gradient: 'purple',
    mode: 'general',
    siteAction: 'edit_site',
  },
  {
    type: 'site_agent',
    label: '全量发布当前站点',
    desc: '确认后走 publish 生成静态',
    icon: Rocket,
    gradient: 'purple',
    mode: 'general',
    siteAction: 'publish_site',
  },
];

/** 按 mode 过滤 + 排除 hidden (用于卡片网格) */
export function getActionsForMode(mode: AIMode): QuickAction[] {
  return AI_QUICK_ACTIONS.filter((a) => a.mode === mode && !a.hidden);
}
