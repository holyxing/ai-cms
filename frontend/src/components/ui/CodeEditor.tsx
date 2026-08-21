// CodeEditor.tsx - 基于 CodeMirror 6 的代码编辑器 (P3.7.5++++++)
//
// 用法:
//   <CodeEditor value={content} onChange={setContent} language="css" />
//   <CodeEditor value={content} onChange={setContent} language="javascript" />
//   <CodeEditor value={content} onChange={setContent} language="html" />
//
// 特点:
// - 自动 syntax highlight (css/javascript/html)
// - 行号
// - bracket 匹配
// - 跟 holy 设计系统一致: 紧凑, 文字主导, 边框/光晕克制
// - 受控组件 (value/onChange)
// - 动态加载 (跟 Tiptap 一样, 避免主包膨胀)

import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate, MatchDecorator } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { tags as t } from '@lezer/highlight';

export type CodeLanguage = 'css' | 'javascript' | 'html';

interface Props {
  value: string;
  onChange: (v: string) => void;
  language: CodeLanguage;
  placeholder?: string;
  /** 编辑器行高 (默认 20) */
  rows?: number;
  /** 类名覆盖 */
  className?: string;
  /** 错误高亮 (e.g. 字符 > 1MB) */
  error?: boolean;
}

// P3.9.4 (holy 反馈 #12038): 自定义语法高亮 - 跟 design system 一致 (蓝/紫/绿 token)
// 之前用 defaultHighlightStyle 是庆阶默认色, 在白底上几乎看不出语法区别
const projectHighlightStyle = HighlightStyle.define([
  // 关键字 (if/function/return/import 等) - 紫
  { tag: t.keyword, color: '#7c3aed', fontWeight: '500' },
  { tag: t.controlKeyword, color: '#7c3aed', fontWeight: '500' },
  { tag: t.operator, color: '#64748b' },
  { tag: t.punctuation, color: '#94a3b8' },
  // 变量名 / 属性名 - 深蓝
  { tag: t.variableName, color: '#0f172a' },
  { tag: t.propertyName, color: '#0ea5e9' }, //  sky-500
  // 字符串 - 绿
  { tag: t.string, color: '#16a34a' }, //  green-600
  { tag: t.special(t.string), color: '#15803d', fontWeight: '500' },
  // 数字 / 常量 - 橙
  { tag: t.number, color: '#ea580c' }, //  orange-600
  { tag: t.bool, color: '#ea580c', fontWeight: '500' },
  { tag: t.null, color: '#ea580c' },
  // 注释 - 灰
  { tag: t.comment, color: '#94a3b8', fontStyle: 'italic' },
  { tag: t.blockComment, color: '#94a3b8', fontStyle: 'italic' },
  { tag: t.docComment, color: '#94a3b8', fontStyle: 'italic' },
  // 函数 - 蓝
  { tag: t.function(t.variableName), color: '#2563eb' }, //  blue-600
  { tag: t.function(t.propertyName), color: '#2563eb' },
  { tag: t.definition(t.variableName), color: '#2563eb' },
  // 类名 / 类型 - 紫
  { tag: t.typeName, color: '#7c3aed' },
  { tag: t.className, color: '#7c3aed' },
  // HTML 标签名 (lang-html 提供) - 青
  { tag: t.tagName, color: '#0891b2' }, //  cyan-600
  { tag: t.attributeName, color: '#0ea5e9' },
  { tag: t.attributeValue, color: '#16a34a' },
  { tag: t.meta, color: '#64748b' },
  { tag: t.invalid, color: '#dc2626', textDecoration: 'underline wavy' },
]);

// 高亮 HY_ 变量标签 (如 <HY_ITEM_TITLE>) - 背景高亮 + 主色
const hyTagMatcher = new MatchDecorator({
  regexp: /HY_[A-Z_]+/g,
  decoration: () => Decoration.mark({ class: 'cm-hy-tag' }),
});
const hyTagPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = hyTagMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = hyTagMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

// HY 标签样式 (注入到主题)
const hyTagTheme = EditorView.theme({
  '.cm-hy-tag': {
    backgroundColor: 'rgba(37, 99, 235, 0.1)',
    color: '#1d4ed8',
    padding: '1px 4px',
    borderRadius: '3px',
    fontWeight: '500',
  },
});

// 极简 light 主题 (跟 design system 一致: 白底, 蓝调, 紧凑)
const baseTheme = EditorView.theme({
  '&': {
    fontSize: '12.5px',
    backgroundColor: 'transparent',
    color: 'hsl(var(--foreground))',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    lineHeight: '1.7',
    maxHeight: '52vh',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '12px 0',
    caretColor: 'hsl(var(--primary))',
  },
  '.cm-line': {
    padding: '0 14px',
  },
  '.cm-gutters': {
    backgroundColor: 'hsl(var(--secondary) / 0.4)',
    color: 'hsl(var(--muted-foreground))',
    border: 'none',
    borderRight: '1px solid hsl(var(--border))',
    minWidth: '40px',
    paddingRight: '8px',
    fontSize: '11px',
  },
  '.cm-activeLine': {
    backgroundColor: 'hsl(var(--primary) / 0.05)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'hsl(var(--primary))',
    fontWeight: '600',
  },
  '.cm-cursor': {
    borderLeftColor: 'hsl(var(--primary))',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'hsl(var(--primary) / 0.18) !important',
  },
  '.cm-focused .cm-selectionBackground': {
    backgroundColor: 'hsl(var(--primary) / 0.25) !important',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'hsl(var(--secondary))',
    border: 'none',
    color: 'hsl(var(--muted-foreground))',
    padding: '0 6px',
    borderRadius: '3px',
    fontSize: '11px',
  },
  '.cm-tooltip': {
    backgroundColor: 'hsl(var(--popover))',
    color: 'hsl(var(--popover-foreground))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '6px',
  },
});

export function CodeEditor({ value, onChange, language, placeholder, rows = 20, className, error }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // 用 ref 记最新的 onChange, 避免每次 onChange 引用变 → 重 mount
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 初始化 + 销毁
  useEffect(() => {
    if (!containerRef.current) return;

    const langExt =
      language === 'css'
        ? css()
        : language === 'javascript'
        ? javascript()
        : html();

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        syntaxHighlighting(projectHighlightStyle, { fallback: true }),
        indentUnit.of('  '), //  2 space indent
        hyTagPlugin,
        hyTagTheme,
        langExt,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        baseTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // 外部 value 变 → 同步 (用户外部 set 后编辑器也要显示)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={[
        'block w-full overflow-hidden rounded-lg border border-border bg-card shadow-sm font-mono text-xs leading-relaxed',
        'transition-shadow focus-within:border-primary focus-within:shadow-md focus-within:shadow-primary/10',
        'hover:border-primary/40',
        error ? 'border-destructive' : 'border-border',
        className ?? '',
      ].join(' ')}
      style={{ minHeight: `${rows * 1.7 * 12.5}px` }}
      data-placeholder={placeholder}
    />
  );
}
