// HtmlDiffView.tsx - HTML diff 对比 (P3.9 + P3.9.1 AI 设计)
//
// P3.9.1 新增:
//   1. Hunk-level accept: 把 diffParts 切成 hunk 段, 每个 hunk 一个 checkbox
//   2. Live preview iframe: 弹 diff 时并行调 /preview, 右栏渲染真 HTML
//   3. 接受 = 选中的 hunk 应用 (旧 → 新), 未选 = 保留旧
//
// 兼容: 老 Props.onAccept() 仍能调 (全接受) - 外部不用改

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, X, GitCompare, ArrowLeftRight, Square, CheckSquare,
  Loader2, AlertTriangle, Eye, EyeOff,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { diffLines, type Change } from 'diff';
import { layoutsApi } from '@/api/layouts';

interface Props {
  oldHtml: string;
  newHtml: string;
  description?: string;
  taskType: string;
  designLang?: string;
  // 老 API: 全接受时 (兼容)
  onAccept: (mergedHtml: string) => void;
  onReject: () => void;
  // 新 API: P3.9.1 - 支持 hunk-level
  layoutId?: string;             // 传了才显示「实时预览」面板
}

const TASK_LABEL: Record<string, string> = {
  optimize_design: 'AI 优化设计',
  responsive: '响应式补全',
  a11y: 'a11y 增强',
  seo: 'SEO 增强',
};

// ============== Hunk 切分算法 (P3.9.1) ==============
// 把 jsdiff 的 Change[] 切成 hunk[].
// 每个 hunk 包含: 一段 changed (added/removed) + 前后 ≤3 行 unchanged 上下文.
// 段间的大块 unchanged 折叠成 "skip N 行" 标记 (不显示).
type Hunk = {
  id: number;
  // 引用到原 diffParts 的下标 (按顺序, 实际渲染时按 id 找)
  indices: number[];
  // 旧版占的行 (unchanged 上下文 + removed)
  oldLines: { text: string; kind: 'unchanged' | 'removed' | 'skip' }[];
  // 新版占的行 (unchanged 上下文 + added)
  newLines: { text: string; kind: 'unchanged' | 'added' | 'skip' }[];
  // 实际净改动行数 (added + removed, 不算上下文)
  changes: number;
  // 接受后这段的合并: 上下文 + (accepted ? added : unchanged-context)
  mergeOnAccept: string;
  // 拒绝时这段的合并: 上下文 + unchanged-context (跳过 added 保留 removed)
  mergeOnReject: string;
};

const CONTEXT_LINES = 3;

function buildHunks(diffParts: Change[]): Hunk[] {
  const hunks: Hunk[] = [];
  let i = 0;
  let hunkId = 0;
  const hasChange = (idx: number) => {
    const p = diffParts[idx];
    return p && (p.added || p.removed);
  };

  while (i < diffParts.length) {
    // 找下一段 changed
    if (!hasChange(i)) { i++; continue; }

    // hunk 起点: 往前 CONTEXT_LINES 行 unchanged
    const start = Math.max(0, i - CONTEXT_LINES);
    // hunk 终点: 把连续 changed + 中间 ≤2*CONTEXT_LINES 行的 unchanged 串起来
    let end = i;
    let unchangedGap = 0;
    while (end < diffParts.length) {
      if (hasChange(end)) {
        unchangedGap = 0;
        end++;
      } else {
        unchangedGap++;
        // 连续的 unchanged 行数 = unchangedGap * (上一段行数)
        // 简单策略: 隔 ≤CONTEXT_LINES 段算上下文
        if (unchangedGap > CONTEXT_LINES) break;
        end++;
      }
    }
    // 往后补 CONTEXT_LINES 行
    const endWithCtx = Math.min(diffParts.length, end + CONTEXT_LINES);

    // 构造 hunk
    const indices: number[] = [];
    const oldLines: Hunk['oldLines'] = [];
    const newLines: Hunk['newLines'] = [];
    let changes = 0;

    for (let k = start; k < endWithCtx; k++) {
      const part = diffParts[k];
      indices.push(k);
      const lines = part.value.split('\n').filter((_, idx, arr) => idx < arr.length - 1 || arr[arr.length - 1] !== '' || part.value.endsWith('\n') ? true : true);
      // 实际: jsdiff 会在最后加 \n, 我们按 \n 切但保留内容
      const split = part.value.split('\n');
      // split 末尾是空串 (因 .value 通常以 \n 收尾)
      const contentLines = split[split.length - 1] === '' ? split.slice(0, -1) : split;

      if (part.added) {
        changes += contentLines.length;
        for (const line of contentLines) {
          newLines.push({ text: line, kind: 'added' });
          // 旧版同位置显示 skip 占位
          oldLines.push({ text: '', kind: 'skip' });
        }
      } else if (part.removed) {
        changes += contentLines.length;
        for (const line of contentLines) {
          oldLines.push({ text: line, kind: 'removed' });
          newLines.push({ text: '', kind: 'skip' });
        }
      } else {
        // unchanged context
        for (const line of contentLines) {
          oldLines.push({ text: line, kind: 'unchanged' });
          newLines.push({ text: line, kind: 'unchanged' });
        }
      }
    }

    // 算 merge: 接受 = unchanged + added, 拒绝 = unchanged (skip removed/added)
    const acceptLines: string[] = [];
    const rejectLines: string[] = [];
    for (let k = start; k < endWithCtx; k++) {
      const part = diffParts[k];
      const split = part.value.split('\n');
      const contentLines = split[split.length - 1] === '' ? split.slice(0, -1) : split;
      if (part.added) {
        for (const l of contentLines) acceptLines.push(l);
        // reject: 不加
      } else if (part.removed) {
        // reject: 保留 removed (即保留旧版原文)
        for (const l of contentLines) rejectLines.push(l);
      } else {
        for (const l of contentLines) {
          acceptLines.push(l);
          rejectLines.push(l);
        }
      }
    }

    hunks.push({
      id: hunkId++,
      indices,
      oldLines,
      newLines,
      changes,
      mergeOnAccept: acceptLines.join('\n'),
      mergeOnReject: rejectLines.join('\n'),
    });

    i = endWithCtx;
  }

  return hunks;
}

// ============== 主组件 ==============
export function HtmlDiffView({ oldHtml, newHtml, description, taskType, designLang, onAccept, onReject, layoutId }: Props) {
  const oldRef = useRef<HTMLPreElement>(null);
  const newRef = useRef<HTMLPreElement>(null);
  const [view, setView] = useState<'split' | 'unified'>('split');
  const [showPreview, setShowPreview] = useState(!!layoutId);

  // P3.9.1: hunk-level accept 状态 (按 hunk id)
  const diffParts = useMemo(() => diffLines(oldHtml, newHtml), [oldHtml, newHtml]);
  const hunks = useMemo(() => buildHunks(diffParts), [diffParts]);
  const [acceptedHunks, setAcceptedHunks] = useState<Set<number>>(
    () => new Set(hunks.map(h => h.id)),  // 默认全接受
  );
  // hunk 变化时重置 (防止 stale)
  useEffect(() => {
    setAcceptedHunks(new Set(hunks.map(h => h.id)));
  }, [hunks.length, oldHtml, newHtml]);

  // 统计
  const totalChanges = hunks.reduce((s, h) => s + h.changes, 0);
  const acceptedChanges = hunks.filter(h => acceptedHunks.has(h.id)).reduce((s, h) => s + h.changes, 0);

  // 合成 mergedHtml: 按 diffParts 顺序, 对每个 part 决定输出
  const mergedHtml = useMemo(() => {
    // 构造 hunk-id-by-part-index map
    const partHunkId = new Map<number, number>();
    hunks.forEach(h => h.indices.forEach(idx => partHunkId.set(idx, h.id)));

    const out: string[] = [];
    for (let k = 0; k < diffParts.length; k++) {
      const part = diffParts[k];
      const hunkId = partHunkId.get(k);
      const isAccepted = hunkId === undefined ? true : acceptedHunks.has(hunkId);
      if (isAccepted) {
        // 接受: unchanged + added, 跳过 removed
        if (part.removed) continue;
        out.push(part.value);
      } else {
        // 拒绝: unchanged + removed, 跳过 added
        if (part.added) continue;
        out.push(part.value);
      }
    }
    return out.join('');
  }, [diffParts, hunks, acceptedHunks]);

  // 同步滚动
  useEffect(() => {
    const left = oldRef.current;
    const right = newRef.current;
    if (!left || !right) return;
    const handler = (e: Event) => {
      const src = e.target as HTMLPreElement;
      const dst = src === left ? right : left;
      if (dst) {
        dst.scrollTop = src.scrollTop;
        dst.scrollLeft = src.scrollLeft;
      }
    };
    left.addEventListener('scroll', handler);
    right.addEventListener('scroll', handler);
    return () => {
      left.removeEventListener('scroll', handler);
      right.removeEventListener('scroll', handler);
    };
  }, []);

  function toggleHunk(id: number) {
    setAcceptedHunks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setAcceptedHunks(new Set(hunks.map(h => h.id)));
  }
  function selectNone() {
    setAcceptedHunks(new Set());
  }

  return (
    <div className="space-y-3">
      {/* 顶部信息条 */}
      <div className="flex items-center justify-between rounded-md border bg-blue-50/50 px-3 py-2">
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <GitCompare className="h-4 w-4 text-blue-600" />
          <span className="font-medium text-blue-900">
            {TASK_LABEL[taskType] || taskType}
            {designLang && <span className="ml-1.5 text-blue-700/70">({designLang})</span>}
          </span>
          {description && <span className="text-blue-700/80">— {description}</span>}
          <span className="text-muted-foreground">|</span>
          <span className="text-green-700">+{acceptedChanges}</span>
          <span className="text-red-700">−{Math.max(0, totalChanges - acceptedChanges)}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">{hunks.length} hunk{hunks.length > 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-1">
          {layoutId && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px]"
              onClick={() => setShowPreview(s => !s)}
              title={showPreview ? '隐藏预览' : '显示实时预览'}
            >
              {showPreview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {showPreview ? '隐藏预览' : '实时预览'}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setView(view === 'split' ? 'unified' : 'split')}>
            <ArrowLeftRight className="h-3 w-3" />
            {view === 'split' ? '合并视图' : '分屏视图'}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={selectNone}>全拒</Button>
          <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={selectAll}>全接</Button>
          <Button size="sm" variant="outline" className="h-6 text-[11px] text-red-700 border-red-300 hover:bg-red-50" onClick={onReject}>
            <X className="h-3 w-3" /> 关闭
          </Button>
          <Button
            size="sm"
            className="h-6 text-[11px] bg-green-600 hover:bg-green-700 text-white"
            onClick={() => onAccept(mergedHtml)}
            title={`将合成 HTML 写入新 layout version (${mergedHtml.length} 字符)`}
          >
            <CheckCircle2 className="h-3 w-3" /> 应用选中
          </Button>
        </div>
      </div>

      {/* 主区: 左 diff / 右预览 (P3.9.1) */}
      <div className={cn('grid gap-2', showPreview && layoutId ? 'grid-cols-2' : 'grid-cols-1')}>
        {/* Diff 区 */}
        {view === 'split' ? (
          <SplitDiff
            hunks={hunks}
            acceptedHunks={acceptedHunks}
            onToggleHunk={toggleHunk}
            oldRef={oldRef}
            newRef={newRef}
            oldHtml={oldHtml}
            newHtml={newHtml}
          />
        ) : (
          <UnifiedDiff hunks={hunks} acceptedHunks={acceptedHunks} onToggleHunk={toggleHunk} oldHtml={oldHtml} newHtml={newHtml} />
        )}

        {/* Live preview (P3.9.1) */}
        {showPreview && layoutId && (
          <LivePreview layoutId={layoutId} html={mergedHtml} />
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-between rounded-md border bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground">
        <span>
          <strong>使用提示</strong>:
          勾选 hunk = 接受这段改动, 不勾 = 保留旧版。
          {layoutId && ' 右侧预览会实时反映当前勾选状态。'}
          点「应用选中」会按当前勾选合成新 HTML, 写入新 layout version。
        </span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={onReject}>关闭</Button>
          <Button
            size="sm"
            className="h-6 text-[11px] bg-green-600 hover:bg-green-700 text-white"
            onClick={() => onAccept(mergedHtml)}
          >
            <CheckCircle2 className="h-3 w-3" /> 应用选中 ({mergedHtml.length} 字符)
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============== Split Diff (Hunk-level) ==============
function SplitDiff({
  hunks, acceptedHunks, onToggleHunk, oldRef, newRef, oldHtml, newHtml,
}: {
  hunks: Hunk[];
  acceptedHunks: Set<number>;
  onToggleHunk: (id: number) => void;
  oldRef: React.MutableRefObject<HTMLPreElement | null>;
  newRef: React.MutableRefObject<HTMLPreElement | null>;
  oldHtml: string;
  newHtml: string;
}) {
  // 渲染 hunks (每个 hunk 一段, 中间用分隔条 + 折叠上下文)
  return (
    <div className="grid grid-cols-2 gap-2">
      {/* 旧版 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between rounded-t-md border border-b-0 bg-red-50/50 px-2 py-1 text-[10px] font-medium text-red-900">
          <span>原 HTML (旧版)</span>
          <span className="text-muted-foreground">{oldHtml.length} 字符</span>
        </div>
        <pre
          ref={oldRef}
          className="max-h-[500px] overflow-auto rounded-b-md border bg-white p-3 text-[10.5px] font-mono leading-relaxed"
        >
          {hunks.map((h, i) => (
            <div key={`old-${h.id}`} className="space-y-px">
              {/* hunk header */}
              <HunkHeader hunk={h} accepted={acceptedHunks.has(h.id)} onToggle={() => onToggleHunk(h.id)} side="old" totalHunks={hunks.length} />
              {h.oldLines.map((line, j) => (
                <div
                  key={`old-${h.id}-${j}`}
                  className={cn(
                    'px-1 -mx-1 whitespace-pre-wrap break-all flex items-start gap-1',
                    line.kind === 'removed' && (acceptedHunks.has(h.id) ? 'bg-green-50 text-green-900/60 line-through' : 'bg-red-100 text-red-900'),
                    line.kind === 'skip' && 'text-transparent select-none',
                    line.kind === 'unchanged' && 'text-slate-600',
                  )}
                >
                  {line.kind === 'removed' && <span className="select-none text-red-500">−</span>}
                  {line.kind === 'unchanged' && <span className="select-none text-slate-300"> </span>}
                  {line.kind === 'skip' && <span className="select-none w-3 inline-block">·</span>}
                  <span className="flex-1">{line.text || '\u00A0'}</span>
                </div>
              ))}
              {/* hunk separator */}
              {i < hunks.length - 1 && <div className="my-1 border-t border-dashed border-slate-200" />}
            </div>
          ))}
        </pre>
      </div>
      {/* 新版 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between rounded-t-md border border-b-0 bg-green-50/50 px-2 py-1 text-[10px] font-medium text-green-900">
          <span>AI 输出 (新版)</span>
          <span className="text-muted-foreground">{newHtml.length} 字符 (+{newHtml.length - oldHtml.length})</span>
        </div>
        <pre
          ref={newRef}
          className="max-h-[500px] overflow-auto rounded-b-md border bg-white p-3 text-[10.5px] font-mono leading-relaxed"
        >
          {hunks.map((h, i) => (
            <div key={`new-${h.id}`} className="space-y-px">
              <HunkHeader hunk={h} accepted={acceptedHunks.has(h.id)} onToggle={() => onToggleHunk(h.id)} side="new" totalHunks={hunks.length} />
              {h.newLines.map((line, j) => (
                <div
                  key={`new-${h.id}-${j}`}
                  className={cn(
                    'px-1 -mx-1 whitespace-pre-wrap break-all flex items-start gap-1',
                    line.kind === 'added' && (acceptedHunks.has(h.id) ? 'bg-green-100 text-green-900' : 'bg-slate-50 text-slate-400 line-through'),
                    line.kind === 'skip' && 'text-transparent select-none',
                    line.kind === 'unchanged' && 'text-slate-600',
                  )}
                >
                  {line.kind === 'added' && <span className="select-none text-green-600">+</span>}
                  {line.kind === 'unchanged' && <span className="select-none text-slate-300"> </span>}
                  {line.kind === 'skip' && <span className="select-none w-3 inline-block">·</span>}
                  <span className="flex-1">{line.text || '\u00A0'}</span>
                </div>
              ))}
              {i < hunks.length - 1 && <div className="my-1 border-t border-dashed border-slate-200" />}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

// ============== Unified Diff (Hunk-level) ==============
function UnifiedDiff({ hunks, acceptedHunks, onToggleHunk, oldHtml, newHtml }: {
  hunks: Hunk[]; acceptedHunks: Set<number>; onToggleHunk: (id: number) => void;
  oldHtml: string; newHtml: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between rounded-t-md border border-b-0 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-700">
        <span>合并视图 (Unified)</span>
        <span className="text-muted-foreground">{oldHtml.length} → {newHtml.length} 字符</span>
      </div>
      <pre className="max-h-[500px] overflow-auto rounded-b-md border bg-white p-3 text-[10.5px] font-mono leading-relaxed">
        {hunks.map((h, i) => (
          <div key={`u-${h.id}`} className="space-y-px">
            <HunkHeader hunk={h} accepted={acceptedHunks.has(h.id)} onToggle={() => onToggleHunk(h.id)} side="unified" totalHunks={hunks.length} />
            {h.oldLines.map((line, j) => {
              // oldLines 跟 newLines 等长 (用 skip 占位), 在 unified 里我们按 oldLine 显示
              if (line.kind === 'skip') return null; // 跳过 added-only 行
              return (
                <div
                  key={`u-${h.id}-${j}`}
                  className={cn(
                    'px-1 -mx-1 whitespace-pre-wrap break-all flex items-start gap-1',
                    line.kind === 'removed' && (acceptedHunks.has(h.id) ? 'bg-green-50 text-green-900/60 line-through' : 'bg-red-100 text-red-900'),
                    line.kind === 'unchanged' && 'text-slate-600',
                  )}
                >
                  <span className="select-none w-3 text-center text-slate-400">−</span>
                  <span className="flex-1">{line.text || '\u00A0'}</span>
                </div>
              );
            })}
            {h.newLines.map((line, j) => {
              if (line.kind === 'skip') return null;
              // 跳过 unchanged (在 oldLines 已显示)
              if (line.kind === 'unchanged') return null;
              return (
                <div
                  key={`u-${h.id}-n${j}`}
                  className={cn(
                    'px-1 -mx-1 whitespace-pre-wrap break-all flex items-start gap-1',
                    line.kind === 'added' && (acceptedHunks.has(h.id) ? 'bg-green-100 text-green-900' : 'bg-slate-50 text-slate-400 line-through'),
                  )}
                >
                  <span className="select-none w-3 text-center text-green-600">+</span>
                  <span className="flex-1">{line.text || '\u00A0'}</span>
                </div>
              );
            })}
            {i < hunks.length - 1 && <div className="my-1 border-t border-dashed border-slate-200" />}
          </div>
        ))}
      </pre>
    </div>
  );
}

// ============== Hunk Header (checkbox + label) ==============
function HunkHeader({ hunk, accepted, onToggle, side, totalHunks }: {
  hunk: Hunk; accepted: boolean; onToggle: () => void; side: 'old' | 'new' | 'unified'; totalHunks: number;
}) {
  if (side === 'unified') {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-2 px-1.5 py-0.5 my-0.5 rounded text-left text-[10px] font-medium transition-colors',
          accepted
            ? 'bg-blue-50 text-blue-900 hover:bg-blue-100'
            : 'bg-slate-100 text-slate-500 hover:bg-slate-200 line-through',
        )}
      >
        {accepted ? <CheckSquare className="h-3 w-3 text-blue-600" /> : <Square className="h-3 w-3 text-slate-400" />}
        <span className="font-mono">Hunk #{hunk.id + 1}/{totalHunks}</span>
        <span className="text-muted-foreground">({hunk.changes} 行改动)</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full flex items-center gap-2 px-1.5 py-0.5 my-0.5 rounded text-left text-[10px] font-medium transition-colors',
        accepted
          ? 'bg-blue-50 text-blue-900 hover:bg-blue-100'
          : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
      )}
    >
      {accepted ? <CheckSquare className="h-3 w-3 text-blue-600" /> : <Square className="h-3 w-3 text-slate-400" />}
      <span className="font-mono">#{hunk.id + 1}</span>
      <span className="text-muted-foreground">±{hunk.changes}</span>
    </button>
  );
}

// ============== Live Preview (P3.9.1) ==============
function LivePreview({ layoutId, html }: { layoutId: string; html: string }) {
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [debouncedHtml, setDebouncedHtml] = useState(html);

  // 500ms debounce (避免每个 checkbox 勾选都打 API)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedHtml(html), 500);
    return () => clearTimeout(t);
  }, [html]);

  useEffect(() => {
    if (!debouncedHtml.trim()) {
      setPreviewHtml('<div style="color:#94a3b8;padding:2rem;text-align:center;font-family:sans-serif;font-size:12px">空模板, 无可预览</div>');
      return;
    }
    let cancelled = false;
    setLoading(true);
    layoutsApi.preview(layoutId, debouncedHtml)
      .then((r) => {
        if (cancelled) return;
        setPreviewHtml(r.html);
        setWarnings(r.warnings || []);
        setErrors(r.errors || []);
      })
      .catch((e) => {
        if (cancelled) return;
        setPreviewHtml(`<div style="color:#dc2626;padding:1rem;font-family:sans-serif;font-size:12px">预览失败: ${e?.message || e}</div>`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [layoutId, debouncedHtml]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between rounded-t-md border border-b-0 bg-purple-50/50 px-2 py-1 text-[10px] font-medium text-purple-900">
        <span className="flex items-center gap-1.5">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
          实时预览 (HY_ 标签已渲染)
        </span>
        <span className="text-muted-foreground">/layouts/{layoutId.slice(0, 8)}/preview</span>
      </div>
      <div className="rounded-b-md border bg-white">
        {/* 警告/错误条 */}
        {(warnings.length > 0 || errors.length > 0) && (
          <div className="border-b px-2 py-1.5 space-y-0.5 text-[10px]">
            {errors.map((e, i) => (
              <div key={`e-${i}`} className="flex items-start gap-1 text-red-700">
                <AlertTriangle className="h-3 w-3 mt-px shrink-0" />
                <span className="font-mono">{e}</span>
              </div>
            ))}
            {warnings.slice(0, 3).map((w, i) => (
              <div key={`w-${i}`} className="flex items-start gap-1 text-amber-700">
                <AlertTriangle className="h-3 w-3 mt-px shrink-0" />
                <span className="font-mono">{w}</span>
              </div>
            ))}
            {warnings.length > 3 && <div className="text-muted-foreground">…还有 {warnings.length - 3} 条警告</div>}
          </div>
        )}
        <iframe
          title="Live Preview"
          srcDoc={previewHtml}
          sandbox="allow-same-origin"
          className="w-full h-[500px] bg-white"
        />
      </div>
    </div>
  );
}
