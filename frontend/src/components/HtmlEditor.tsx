/**
 * HtmlEditor - 共享的 HTML 源码编辑器 (P3.6.2 + P3.9.1+ toolbar)
 *
 * 功能:
 *  - IDE 风格 (深色 + 行号 + 等宽)
 *  - 顶栏: HTML chip + 行/字符统计 + 格式化/复制/清空
 *  - 工具栏 (P3.9.1+ holy 反馈 #11251, showToolbar=true):
 *      B I S | H1 H2 H3 | UL OL | ❝ Code | Link Img HR
 *      快捷键: Ctrl+B / I / K, Tab=2 空格
 *  - 底栏: Ln/Col + 大小 + 实时 HY_ 校验 (✗ 错误 / ⚠ 警告)
 *  - 输入 HY_ 触发自动补全 (TagAutocompletePopover)
 *
 * Props:
 *  - value, onChange: 受控
 *  - scope: 'all' | 'site' | 'home' | 'category' | 'content' (用于过滤 HY_ 提示)
 *  - placeholder: textarea 占位
 *  - minHeight: 编辑区最小高度
 *  - showToolbar: 是否显示插入快捷 toolbar (默认 false, 给 layout 设计者; ContentDetail true)
 *  - onRequestLink: 点 链接 按钮时调, host 返回 URL 字符串 (null=取消)
 *  - onRequestImage: 点 图片 按钮时调, host 返回 URL 字符串 (null=取消)
 *  - onConfirmClear: 点 清空 按钮时调, host 返回 true=确认
 */
import { useEffect, useRef, useState } from 'react';
import { Code, Wand2, Copy, XCircle, AlertCircle, AlertTriangle, ChevronDown, ChevronUp, Bold, Italic, Strikethrough, Heading1, Heading2, Heading3, List, ListOrdered, Quote, Code2, Link as LinkIcon, Image as ImageIcon, Minus, ImageDown, Maximize2, Minimize2 } from 'lucide-react';
import { toast } from 'sonner';
import { HY_TAGS, validateHyTags, CONTAINER_HY_CODES, type HyValidationIssue } from '@/api/layouts';
import TagAutocompletePopover, { type TagItem } from './editor/TagAutocompletePopover';
import { HtmlAiEnhanceMenu } from './editor/HtmlAiEnhanceMenu';
import { cn } from '@/lib/utils';

export interface HtmlEditorProps {
  value: string;
  onChange: (v: string) => void;
  scope?: 'all' | 'site' | 'home' | 'category' | 'content';
  placeholder?: string;
  minHeight?: number;
  showToolbar?: boolean;
  /** 弹 URL 输入 (链接按钮), host 应当用 in-app PromptDialog 而非 window.prompt (P3.9.1+ #11266) */
  onRequestLink?: () => Promise<string | null>;
  /** 弹 URL 输入 (图片按钮), host 应当用 in-app PromptDialog */
  onRequestImage?: () => Promise<string | null>;
  /** 弹确认 (清空按钮), host 应当用 in-app ConfirmDialog */
  onConfirmClear?: () => Promise<boolean>;
  /** P3.9.4+ (holy 反馈 #12096): 粘贴时, host 接管 HTML 处理 (例如从 Word 粘贴, 提取 <img> 上传到 MinIO)
   *  返处理后的 HTML (可能已替换 src), 同步处理后插入光标位置
   *  不传则默认行为 (raw paste) */
  onPaste?: (html: string) => Promise<string>;
  /** AI 增强：站点上下文（文章编辑页传入） */
  aiEnhance?: {
    siteId: string;
    contentId?: string;
    siteSlug?: string;
  };
}

export function HtmlEditor({
  value,
  onChange,
  scope = 'all',
  placeholder = '<!-- 直接编辑 HTML 源码 -->\n<h2>标题</h2>\n<p>段落...</p>',
  minHeight = 400,
  showToolbar = false,
  onRequestLink,
  onRequestImage,
  onConfirmClear,
  onPaste,
  aiEnhance,
}: HtmlEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  // 高亮层必须与 textarea 同滚：自身不能 overflow:hidden + inset-0，否则后半段被裁掉（能选中复制但看不见）
  const backdropRef = useRef<HTMLPreElement>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [showIssues, setShowIssues] = useState(false);
  // P6.x (holy 反馈 2026-08-14): 最大化操作 — wrap 变 fixed 全屏, ESC 退出
  const [isMaximized, setIsMaximized] = useState(false);

  // === HY_ 补全弹窗状态 ===
  const [acOpen, setAcOpen] = useState(false);
  const [acFilter, setAcFilter] = useState('');
  const [acPos, setAcPos] = useState<{ top: number; left: number } | null>(null);

  // 行数 / 字符数
  const lineCount = Math.max(1, (value || '').split('\n').length);
  const charCount = (value || '').length;
  const byteKB = (new Blob([value || '']).size / 1024).toFixed(2);

  // 实时校验
  const issues: HyValidationIssue[] = value ? validateHyTags(value) : [];
  const errorCount = issues.filter((i) => i.level === 'error').length;
  const warnCount = issues.filter((i) => i.level === 'warning').length;

  // === 同步光标位置 ===
  const handleSelect = () => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = (value || '').slice(0, pos);
    const line = before.split('\n').length;
    const lastNl = before.lastIndexOf('\n');
    const col = pos - (lastNl + 1) + 1;
    setCursor({ line, col });
  };

  // === 触发 HY_ 补全检测 ===
  // 监听 value 变化, 在 cursor 处找最近的 HY_ token
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = (value || '').slice(0, pos);
    // 找最近的 HY_ token (光标必须在 <HY_xxx 之后, </HY_xxx 之前都不触发)
    const m = before.match(/<HY_([A-Z_]*)$/i);
    if (m) {
      setAcFilter(m[1].toUpperCase());
      // 定位到 textarea 右下角 (相对于容器)
      const wrap = wrapRef.current;
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        // 用 textarea scrollTop 算行数, 简单按 19px 一行估
        const lineInText = before.split('\n').length;
        const taCS = window.getComputedStyle(ta);
        const lh = parseFloat(taCS.lineHeight) || 19;
        const offsetTop = Math.min(lineInText * lh, ta.clientHeight - 20);
        setAcPos({ top: rect.top + 30 + offsetTop, left: rect.left + 40 });
      }
      setAcOpen(true);
    } else {
      setAcOpen(false);
    }
  }, [value, cursor.line, cursor.col]);

  // === 补全选中 → 插入到光标位置 ===
  const handleAcSelect = (tag: TagItem) => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = (value || '').slice(0, pos);
    // 找最近的 <HY_...$
    const m = before.match(/<HY_([A-Z_]*)$/i);
    if (!m) { setAcOpen(false); return; }
    const insertAt = m.index!;
    // 模板完整插入 (含 _ 属性的样子)
    const code = tag.code;
    let insertion = code;
    if (CONTAINER_HY_CODES.has(code)) {
      // 容器标签插入示例
      insertion = `${code}>...</${code}>`;
    } else {
      insertion = `${code} />`;
    }
    const next = (value || '').slice(0, insertAt) + insertion + (value || '').slice(pos);
    onChange(next);
    setAcOpen(false);
    // 恢复光标
    requestAnimationFrame(() => {
      const newPos = insertAt + insertion.length;
      ta.selectionStart = ta.selectionEnd = newPos;
      ta.focus();
    });
  };

  // === 格式化 ===
  const handleFormat = () => {
    const src = value || '';
    let fmt = src
      .replace(/>\s*</g, '><')
      .replace(/(<\/?(?:h[1-6]|p|div|ul|ol|li|blockquote|pre|table|tr|td|th|section|article|header|footer|nav|main|figure)\b[^>]*>)/g, '\n$1')
      .replace(/^\n+/, '');
    fmt = fmt.replace(/\n{3,}/g, '\n\n');
    onChange(fmt);
    toast.success('已格式化');
  }

  // === P3.9.1+ 插入块 (toolbar + 快捷键都走这里) ===
  // 用 textarea 的 selectionStart/End 包裹 (或插入占位)
  const insert = (openTag: string, closeTag = '', placeholderText = '') => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const before = (value || '').slice(0, start);
    const sel = (value || '').slice(start, end);
    const after = (value || '').slice(end);
    const inner = sel || placeholderText;
    const inserted = openTag + inner + closeTag;
    const next = before + inserted + after;
    onChange(next);
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      // 选中 placeholder 文本, 让用户可以直接覆盖
      ta.selectionStart = before.length + openTag.length;
      ta.selectionEnd = pos - closeTag.length;
      ta.focus();
      handleSelect();
    });
  };

  const insertSelfClose = (snippet: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const before = (value || '').slice(0, start);
    const after = (value || '').slice(start);
    const next = before + snippet + after;
    onChange(next);
    requestAnimationFrame(() => {
      const pos = start + snippet.length;
      ta.selectionStart = ta.selectionEnd = pos;
      ta.focus();
      handleSelect();
    });
  };

  const insertLink = async () => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = (value || '').slice(start, end);
    // P3.9.1+ holy 反馈 #11266: host 用 in-app PromptDialog 取代 window.prompt
    const url = onRequestLink ? await onRequestLink() : null;
    if (!url) return;
    insert(`<a href="${url}" target="_blank" rel="noopener noreferrer">`, '</a>', sel || '链接文字');
  };

  const insertImage = async () => {
    // P3.9.1+ holy 反馈 #11266: host 用 in-app PromptDialog
    const url = onRequestImage ? await onRequestImage() : null;
    if (!url) return;
    insertSelfClose(`\n<img src="${url}" alt="" />\n`);
  };

  const handleClear = async () => {
    if (onConfirmClear) {
      const ok = await onConfirmClear();
      if (ok) onChange('');
    } else {
      onChange('');
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = e.currentTarget;
    if (gutterRef.current) gutterRef.current.scrollTop = scrollTop;
    if (backdropRef.current) {
      backdropRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
    }
  };

  // P6.x (holy 反馈 2026-08-14): 最大化 ESC 退出
  useEffect(() => {
    if (!isMaximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMaximized(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isMaximized]);

  const toolbarActions = {
    bold: () => insert('<strong>', '</strong>', '粗体'),
    italic: () => insert('<em>', '</em>', '斜体'),
    strike: () => insert('<s>', '</s>', '删除线'),
    h1: () => insert('\n<h1>', '</h1>\n', '一级标题'),
    h2: () => insert('\n<h2>', '</h2>\n', '二级标题'),
    h3: () => insert('\n<h3>', '</h3>\n', '三级标题'),
    ul: () => insert('\n<ul>\n  <li>', '</li>\n</ul>\n', '列表项'),
    ol: () => insert('\n<ol>\n  <li>', '</li>\n</ol>\n', '列表项'),
    quote: () => insert('\n<blockquote>', '</blockquote>\n', '引用文字'),
    code: () => insert('\n<pre><code>', '</code></pre>\n', 'code'),
    link: insertLink,
    image: insertImage,
    hr: () => insertSelfClose('\n<hr />\n'),
  } as const;;

  // P3.9.4 (holy 反馈 #12044): 复制当前光标处/第一个 <img> 图片到剪贴板
  // 需 cursor 处的 <img>  - 简单策略: 在光标位置前后 500 字符内找最近的 <img src=...>
  // 找不到就取 value 里的第一个 <img>
  const handleCopyImage = async () => {
    const src = value || '';
    const pos = taRef.current?.selectionStart ?? src.length;
    const window = src.slice(Math.max(0, pos - 500), pos + 500);
    // 优先在光标附近找
    let m = window.match(/<img[^>]*\ssrc=["']([^"']+)["']/i);
    if (!m) {
      // fallback: 全局第一个
      m = src.match(/<img[^>]*\ssrc=["']([^"']+)["']/i);
    }
    if (!m) {
      toast.error('当前内容中没有 <img> 标签');
      return;
    }
    const url = m[1];
    try {
      const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      if (!blob.type.startsWith('image/')) throw new Error('响应不是图片');
      const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
      let finalBlob = blob;
      let writeType = blob.type;
      if (!allowed.includes(blob.type)) {
        // svg 等转 png
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        finalBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob 失败'))), 'image/png');
        });
        writeType = 'image/png';
      }
      await navigator.clipboard.write([new ClipboardItem({ [writeType]: finalBlob })]);
      toast.success(`图片已复制 (${(finalBlob.size / 1024).toFixed(1)} KB) - Ctrl+V 粘到任意地方`);
    } catch (e: any) {
      console.error('Copy image failed:', e);
      toast.error(`复制失败: ${e?.message || '未知错误'}`);
    }
  };

  // === Tab 键 + Ctrl 快捷键 (P3.9.1+ toolbar) ===
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = taRef.current!;
      const start = ta.selectionStart, end = ta.selectionEnd;
      const next = (value || '').slice(0, start) + '  ' + (value || '').slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
      return;
    }
    if (e.key === 'Escape' && acOpen) {
      e.preventDefault();
      setAcOpen(false);
      return;
    }
    // Ctrl+B / I / K
    if (showToolbar && (e.ctrlKey || e.metaKey)) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); toolbarActions.bold(); return; }
      if (k === 'i') { e.preventDefault(); toolbarActions.italic(); return; }
      if (k === 'k') { e.preventDefault(); toolbarActions.link(); return; }
    }
  };

  // P3.9.4+ (holy 反馈 #12096): 粘贴 HTML 处理 - host 接管 (提取 <img> base64 → 上传 MinIO → 返新 HTML)
  // 不传 onPaste 则默认行为 (raw paste)
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onPaste) return;  // host 不接管, 默认行为
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (!html && !text) return;
    e.preventDefault();
    const payload = html || text;
    try {
      const processed = await onPaste(payload);
      // 插入到光标位置
      const ta = taRef.current!;
      const start = ta.selectionStart, end = ta.selectionEnd;
      const next = (value || '').slice(0, start) + processed + (value || '').slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + processed.length;
        ta.focus();
      });
      // 不走 toast - host 负责反馈 (host 可能已 toast "上传 N 张图片")
    } catch (err: any) {
      console.error('Paste handler error:', err);
      toast.error(`粘贴处理失败: ${err?.message || '未知错误'}`);
    }
  };

  // 过滤补全标签
  const acTags: TagItem[] = HY_TAGS
    .filter((t) => t.scope === 'all' || t.scope === scope)
    .map((t) => ({ code: t.code, scope: t.scope as any, desc: t.desc, example: t.example }));

  // P3.9.4 (holy 反馈 #12038): HTML 源码高亮
  // 颜色跟 design system 一致:
  //  - 标签名 (h1/p/div) - 紫色 cyan-400
  //  - 属性名 (class/href) - 黄色 amber-300
  //  - 属性值 (引号内) - 绿色 emerald-300
  //  - 文本内容 - 灰色 slate-300
  //  - 注释 <!--  --> - 庆色斜体 slate-500
  //  - HY_ 标签 - 橙色带背景 (主操作提示)
  // 为避免 backdrop 与 textarea 不对齐, 必须保证输出的空白/换行 100% 与输入一致
  function highlightHtml(src: string): string {
    if (!src) return '';
    // 1. HTML 转义
    const esc = (s: string) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // 2. 将 HY_ 标签先提取保护 (避免后面正则破坏)
    const HY_RE = /<HY_[A-Z_]+(\s+[^>]*)?(\/?)>|<\/HY_[A-Z_]+>/g;
    const parts: string[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = HY_RE.exec(src)) !== null) {
      parts.push(esc(src.slice(lastIdx, m.index)));
      parts.push(
        `<span class="hy-tag" style="background-color: rgba(251, 146, 60, 0.18); color: #fb923c; padding: 0 3px; border-radius: 3px; font-weight: 500;">${esc(m[0])}</span>`,
      );
      lastIdx = HY_RE.lastIndex;
    }
    parts.push(esc(src.slice(lastIdx)));
    let out = parts.join('');
    // 3. HTML 注释
    out = out.replace(
      /(&lt;!--[\s\S]*?--&gt;)/g,
      '<span style="color: #64748b; font-style: italic;">$1</span>',
    );
    // 4. 普通 HTML 标签 - 分三段: &lt;tagName attrs/&gt;
    out = out.replace(
      /(&lt;\/?)([a-zA-Z][a-zA-Z0-9-]*)([^&]*?)(&gt;)/g,
      (_m, lt, tag, attrs, gt) => {
        // 标记标签名 + 高亮属性
        const attrHtml = attrs.replace(
          /(\s)([a-zA-Z][\w:-]*)(=)("[^"]*"|'[^']*')/g,
          '$1<span style="color: #fcd34d;">$2</span>$3<span style="color: #6ee7b7;">$4</span>',
        );
        return `${lt}<span style="color: #22d3ee;">${tag}</span>${attrHtml}${gt}`;
      },
    );
    return out;
  }

  return (
    <div
      ref={wrapRef}
      className={cn(
        'relative flex flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-950 text-slate-200 shadow-sm transition-shadow',
        isMaximized && 'fixed inset-x-0 top-14 bottom-0 z-40 shadow-md',
      )}
    >
      {/* === 顶部工具栏 === */}
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5">
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="inline-flex h-5 items-center gap-1 rounded bg-orange-500/15 px-1.5 text-[10.5px] font-semibold tracking-wide text-orange-400">
            <Code className="h-3 w-3" strokeWidth={2.5} />
            HTML
          </span>
          <span className="text-[10.5px] text-slate-500">{lineCount} 行 · {charCount} 字符</span>
          {/* 校验状态徽标 */}
          {errorCount > 0 && (
            <span className="inline-flex h-5 items-center gap-1 rounded bg-red-500/15 px-1.5 text-[10.5px] font-medium text-red-400">
              <AlertCircle className="h-3 w-3" />
              {errorCount} 错误
            </span>
          )}
          {warnCount > 0 && (
            <span className="inline-flex h-5 items-center gap-1 rounded bg-amber-500/15 px-1.5 text-[10.5px] font-medium text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              {warnCount} 警告
            </span>
          )}
          {errorCount === 0 && warnCount === 0 && value && (
            <span className="inline-flex h-5 items-center gap-1 rounded bg-emerald-500/15 px-1.5 text-[10.5px] font-medium text-emerald-400">
              ✓ HY_ 合法
            </span>
          )}
        </div>

        {/* AI 增强：勿放 flex-1/min-w-0，否则会被挤成「增/强」竖排 */}
        <div className="flex flex-shrink-0 items-center px-1">
          {aiEnhance?.siteId && (
            <HtmlAiEnhanceMenu
              html={value || ''}
              siteId={aiEnhance.siteId}
              contentId={aiEnhance.contentId}
              siteSlug={aiEnhance.siteSlug}
              onApply={onChange}
            />
          )}
        </div>

        <div className="ml-auto flex flex-shrink-0 items-center gap-1">
          {/* P3.9.1+ 快捷插入 toolbar (holy 反馈 #11251) - LayoutEditPage 不传 showToolbar, 仅 ContentDetail 用 */}
          {showToolbar && (
            <div className="mr-1 flex items-center gap-0.5 rounded-md bg-slate-800/60 px-1 py-0.5">
              <ToolbarBtn title="粗体 (⌘B)" onClick={toolbarActions.bold}><Bold className="h-3 w-3" /></ToolbarBtn>
              <ToolbarBtn title="斜体 (⌘I)" onClick={toolbarActions.italic}><Italic className="h-3 w-3" /></ToolbarBtn>
              <ToolbarBtn title="删除线" onClick={toolbarActions.strike}><Strikethrough className="h-3 w-3" /></ToolbarBtn>
              <ToolbarSep />
              <ToolbarBtn title="一级标题" onClick={toolbarActions.h1}><Heading1 className="h-3 w-3" /></ToolbarBtn>
              <ToolbarBtn title="二级标题" onClick={toolbarActions.h2}><Heading2 className="h-3 w-3" /></ToolbarBtn>
              <ToolbarBtn title="三级标题" onClick={toolbarActions.h3}><Heading3 className="h-3 w-3" /></ToolbarBtn>
              <ToolbarSep />
              <ToolbarBtn title="无序列表" onClick={toolbarActions.ul}><List className="h-3 w-3" /></ToolbarBtn>
              <ToolbarBtn title="有序列表" onClick={toolbarActions.ol}><ListOrdered className="h-3 w-3" /></ToolbarBtn>
              <ToolbarBtn title="引用" onClick={toolbarActions.quote}><Quote className="h-3 w-3" /></ToolbarBtn>
              <ToolbarBtn title="代码块" onClick={toolbarActions.code}><Code2 className="h-3 w-3" /></ToolbarBtn>
              <ToolbarSep />
              <ToolbarBtn title="链接 (⌘K)" onClick={toolbarActions.link}><LinkIcon className="h-3 w-3" /></ToolbarBtn>
              <ToolbarBtn title="图片" onClick={toolbarActions.image}><ImageIcon className="h-3 w-3" /></ToolbarBtn>
              <ToolbarSep />
              <ToolbarBtn title="复制图片到剪贴板 (Ctrl+V 可粘到微信/语雀)" onClick={handleCopyImage} className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/20"><ImageDown className="h-3 w-3" /></ToolbarBtn>
              <ToolbarSep />
              <ToolbarBtn title="分隔线" onClick={toolbarActions.hr}><Minus className="h-3 w-3" /></ToolbarBtn>
            </div>
          )}
          {/* P6.x (holy 反馈 2026-08-14): 最大化按钮 — 跟 格式化 同一排, 警示徽标和操作按钮之间 */}
          <button
            type="button"
            onClick={() => setIsMaximized((v) => !v)}
            title={isMaximized ? '退出最大化 (Esc)' : '最大化编辑器'}
            className="inline-flex h-6 items-center gap-1 rounded px-2 text-[10.5px] text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
          >
            {isMaximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            {isMaximized ? '退出' : '最大化'}
          </button>
          <button
            type="button"
            onClick={handleFormat}
            title="重新格式化"
            className="inline-flex h-6 items-center gap-1 rounded px-2 text-[10.5px] text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
          >
            <Wand2 className="h-3 w-3" />
            格式化
          </button>
          <button
            type="button"
            onClick={() => { navigator.clipboard.writeText(value || ''); toast.success('已复制 HTML'); }}
            className="inline-flex h-6 items-center gap-1 rounded px-2 text-[10.5px] text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
          >
            <Copy className="h-3 w-3" />
            复制
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex h-6 items-center gap-1 rounded px-2 text-[10.5px] text-slate-400 transition-colors hover:bg-red-950/60 hover:text-red-300"
          >
            <XCircle className="h-3 w-3" />
            清空
          </button>
        </div>
      </div>

      {/* === 主体: 行号 + 编辑区 (P3.9.4 #12038: backdrop syntax highlight) === */}
      {/* P6.x (holy 反馈 2026-08-14): flex-1 min-h-0 让 body 在 wrap 受限时正确收缩 (不强制 minHeight), overflow-hidden 防 line numbers 溢出底部留白; line numbers flex-shrink-0 防止被压窄; textarea 容器 min-w-0 overflow-hidden 让 textarea 拿到精确的盒子 */}
      <div className="flex min-h-0 flex-1 overflow-hidden" style={{ minHeight: `${minHeight}px` }}>
        <div
          ref={gutterRef}
          aria-hidden
          className="select-none flex-shrink-0 overflow-y-auto overflow-x-hidden border-r border-slate-800 bg-slate-900/60 px-2 py-2 text-right font-mono text-[12.5px] leading-[1.65] text-slate-600 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ minWidth: `${String(lineCount).length * 8 + 16}px` }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <pre
            ref={backdropRef}
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 m-0 min-w-full whitespace-pre px-3 py-2 font-mono text-[12.5px] leading-[1.65] will-change-transform"
            style={{ tabSize: 2 }}
            dangerouslySetInnerHTML={{ __html: highlightHtml(value || '') + '\n' }}
          />
          <textarea
            ref={taRef}
            value={value}
            wrap="off"
            onChange={(e) => { onChange(e.target.value); handleSelect(); }}
            onKeyUp={handleSelect}
            onClick={handleSelect}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onScroll={handleScroll}
            spellCheck={false}
            className="relative z-10 block h-full w-full resize-none overflow-scroll bg-transparent px-3 py-2 font-mono text-[12.5px] leading-[1.65] text-transparent caret-blue-400 selection:bg-blue-500/30 placeholder:text-slate-600 focus:outline-none [scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:#64748b_#0f172a] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-corner]:bg-slate-900 [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-slate-500 hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-track]:bg-slate-900"
            placeholder={placeholder}
            style={{ WebkitTextFillColor: 'transparent', tabSize: 2 }}
          />
        </div>
      </div>

      {/* === 底部状态栏 === */}
      <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-3 py-1 text-[10.5px] text-slate-500">
        <div className="flex items-center gap-3">
          <span>Ln {cursor.line}, Col {cursor.col}</span>
          <span>·</span>
          <span>{byteKB} KB</span>
          <span>·</span>
          <span>UTF-8</span>
          {issues.length > 0 && (
            <>
              <span>·</span>
              <button
                type="button"
                onClick={() => setShowIssues((v) => !v)}
                className="inline-flex items-center gap-1 hover:text-slate-200"
              >
                {errorCount + warnCount} 个问题
                {showIssues ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <kbd className="rounded border border-slate-700 bg-slate-800 px-1 py-px font-mono text-[9.5px] text-slate-400">Tab</kbd>
          <span>缩进 2 空格</span>
          <span>·</span>
          <span>输入 <code className="rounded bg-slate-800 px-1 font-mono text-orange-400">HY_</code> 弹补全</span>
        </div>
      </div>

      {/* === 校验问题列表 === */}
      {showIssues && issues.length > 0 && (
        <div className="border-t border-slate-800 bg-slate-900/80 px-3 py-2 max-h-32 overflow-y-auto">
          {issues.map((iss, i) => (
            <div
              key={i}
              className={
                'flex items-start gap-2 py-0.5 text-[10.5px] ' +
                (iss.level === 'error' ? 'text-red-300' : 'text-amber-300')
              }
            >
              {iss.level === 'error' ? (
                <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
              )}
              <span className="flex-shrink-0 font-mono">{iss.match}</span>
              <span className="text-slate-400">— {iss.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* === HY_ 自动补全弹窗 === */}
      <TagAutocompletePopover
        open={acOpen}
        tags={acTags}
        filter={acFilter}
        position={acPos || undefined}
        onSelect={handleAcSelect}
        onClose={() => setAcOpen(false)}
      />
    </div>
  );
}

// === P3.9.1+ toolbar 子组件 (holy 反馈 #11251) ===
function ToolbarBtn({ title, onClick, children, className }: { title: string; onClick: () => void | Promise<void>; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex h-5 w-5 items-center justify-center rounded text-slate-300 transition-colors hover:bg-slate-700 hover:text-white',
        className,
      )}
    >
      {children}
    </button>
  );
}

function ToolbarSep() {
  return <div className="mx-0.5 h-3 w-px bg-slate-700" />;
}

export default HtmlEditor;
