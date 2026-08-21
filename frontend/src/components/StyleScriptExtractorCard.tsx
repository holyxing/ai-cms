// StyleScriptExtractorCard.tsx - 模板 HTML 里 <style>/<script> 块合并抽取到 site_assets (P3.7.5+ holy 反馈 #10279+#10342+#10354)
//
// 合并模式 (P3.7.5+): holy 反馈 "有很多 <style> 块, 需要合并成一个 css 文件, 引用到此模板上"
// - 扫描模板 HTML 里的 <style>...</style> 块
// - 扫描 inline <script>...</script> 块 (无 src)
// - 所有 style 块 → 拼成 1 个 css 文件 (style-merged.css, 用 /* === block N === */ 注释分隔)
// - 所有 inline script 块 → 拼成 1 个 js 文件 (script-merged.js, 用 // === block N === 注释分隔)
// - 替换: 删除所有块, 在最早 style 块位置插 <HY_SITE_CSS _include="..." />, 在最后 script 块位置插 <HY_SITE_JS _include="..." />
//
// 在线管理 (P3.7.5++ holy 反馈 #10354): css/js 可以更名 + 在线编辑内容
// - 抽完后, 资源行显示 [重命名] [编辑内容] [复制 HY 标签引用]
// - 重命名: inline input → siteAssetsApi.update
// - 编辑内容: Modal + <textarea> → siteAssetsApi.getContent + updateContent
// - 模板里 _include 引用旧名字 → holy 改名字后, 模板里要手动同步 (跟用户提示)
//
// 不处理:
// - 外部 <link> / <script src> 引用 (AssetDependencyCard 已管)
// - 重名 → pickName 递增, 避免 409 Conflict
import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Code2, FileCode, Sparkles, Loader2, CheckCircle2, AlertCircle,
  Pencil, Save, X as XIcon, Copy, Check,
} from 'lucide-react';
import { Card, CardContent, Button, Badge, Input, Modal, CodeEditor } from '@/components/ui';
import { toast } from 'sonner';
import { siteAssetsApi, type AssetCategory } from '@/api/siteAssets';

interface Props {
  siteId: string;
  html: string;
  onApplyNewHtml: (nextHtml: string) => void;
}

interface DetectedBlock {
  id: string;          // 稳定 id (start-end-kind-N)
  kind: 'style' | 'script';
  start: number;
  end: number;         // 包含闭合标签
  body: string;
  size: number;        // 块字符数
}

const STYLE_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const SCRIPT_RE = /<script\b((?:(?!src=)[^>])*)>([\s\S]*?)<\/script>/gi;

function detectBlocks(html: string): DetectedBlock[] {
  const blocks: DetectedBlock[] = [];
  STYLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STYLE_RE.exec(html))) {
    const body = m[1];
    blocks.push({
      id: `style-${m.index}-${m.index + m[0].length}`,
      kind: 'style',
      start: m.index,
      end: m.index + m[0].length,
      body,
      size: body.length,
    });
  }
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(html))) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    const body = m[2];
    blocks.push({
      id: `script-${m.index}-${m.index + m[0].length}`,
      kind: 'script',
      start: m.index,
      end: m.index + m[0].length,
      body,
      size: body.length,
    });
  }
  blocks.sort((a, b) => a.start - b.start);
  return blocks;
}

function mergeBlocks(blocks: DetectedBlock[]): { content: string; count: number; totalSize: number } {
  const sep = (idx: number, kind: 'style' | 'script', n: number) => {
    if (kind === 'style') return `\n/* === block ${idx}/${n} === */\n`;
    return `\n// === block ${idx}/${n} ===\n`;
  };
  const totalSize = blocks.reduce((s, b) => s + b.size, 0);
  const content = blocks
    .map((b, i) => sep(i + 1, b.kind, blocks.length) + b.body)
    .join('\n');
  return { content, count: blocks.length, totalSize };
}

export function StyleScriptExtractorCard({ siteId, html, onApplyNewHtml }: Props) {
  const qc = useQueryClient();
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<{ css: 'ok' | 'skip' | 'error' | null; js: 'ok' | 'skip' | 'error' | null }>({ css: null, js: null });

  // 现有 site_assets name 集合
  const assetsQ = useQuery({
    queryKey: ['site-assets', siteId],
    queryFn: () => siteAssetsApi.list(siteId).catch(() => ({ items: [], total: 0, page: 1, page_size: 0 })),
    enabled: !!siteId,
  });
  const existingNames = useMemo(
    () => new Set((assetsQ.data?.items ?? []).map((a) => a.name)),
    [assetsQ.data],
  );

  // 找 css/js 资源 (已抽过 / 新抽)
  const cssAsset = useMemo(
    () => assetsQ.data?.items.find((a) => a.category === 'css' && /^style-merged(-\d+)?\.css$/.test(a.name)),
    [assetsQ.data],
  );
  const jsAsset = useMemo(
    () => assetsQ.data?.items.find((a) => a.category === 'js' && /^script-merged(-\d+)?\.js$/.test(a.name)),
    [assetsQ.data],
  );

  // 检测模板里未抽的块
  const blocks = useMemo(() => detectBlocks(html), [html]);
  const styleBlocks = useMemo(() => blocks.filter((b) => b.kind === 'style'), [blocks]);
  const scriptBlocks = useMemo(() => blocks.filter((b) => b.kind === 'script'), [blocks]);
  const hasUnextractedCss = styleBlocks.length > 0;
  const hasUnextractedJs = scriptBlocks.length > 0;
  const hasAny = hasUnextractedCss || hasUnextractedJs;

  // 合并后名字 (重名检测 + 自动递增)
  const pickName = (base: string, ext: 'css' | 'js', taken: Set<string>): string => {
    if (!taken.has(base)) return base;
    const stem = base.replace(/\.[a-z]+$/, '');
    let i = 2;
    while (taken.has(`${stem}-${i}.${ext}`)) i += 1;
    return `${stem}-${i}.${ext}`;
  };
  const CSS_NAME = pickName('style-merged.css', 'css', existingNames);
  const JS_NAME = pickName('script-merged.js', 'js', existingNames);

  const handleExtract = async () => {
    if (!hasAny) return;
    setExtracting(true);
    setResult({ css: null, js: null });
    const newResult: typeof result = { css: null, js: null };

    if (hasUnextractedCss) {
      try {
        const { content } = mergeBlocks(styleBlocks);
        const file = new File([content], CSS_NAME, { type: 'text/css' });
        await siteAssetsApi.upload(siteId, {
          category: 'css',
          name: CSS_NAME,
          file,
          description: `P3.7.5 合并 ${styleBlocks.length} 个 <style> 块 → 1 个 css`,
        });
        newResult.css = 'ok';
        existingNames.add(CSS_NAME);
      } catch (e: any) {
        newResult.css = 'error';
        toast.error(`上传 ${CSS_NAME} 失败: ${e?.response?.data?.message || '未知错误'}`);
      }
    }

    if (hasUnextractedJs) {
      try {
        const { content } = mergeBlocks(scriptBlocks);
        const file = new File([content], JS_NAME, { type: 'application/javascript' });
        await siteAssetsApi.upload(siteId, {
          category: 'js',
          name: JS_NAME,
          file,
          description: `P3.7.5 合并 ${scriptBlocks.length} 个 inline <script> 块 → 1 个 js`,
        });
        newResult.js = 'ok';
        existingNames.add(JS_NAME);
      } catch (e: any) {
        newResult.js = 'error';
        toast.error(`上传 ${JS_NAME} 失败: ${e?.response?.data?.message || '未知错误'}`);
      }
    }
    setResult(newResult);

    if (newResult.css !== 'error' && newResult.js !== 'error') {
      let nextHtml = html;
      type Op = { pos: number; len: number; text: string; kind: 'cut' | 'insert' };
      const ops: Op[] = [];
      const cuts = blocks.map((b) => ({ start: b.start, end: b.end })).sort((a, b) => b.start - a.start);
      const inserts: { pos: number; text: string }[] = [];
      if (hasUnextractedCss && styleBlocks.length > 0) {
        inserts.push({ pos: styleBlocks[0].start, text: `<HY_SITE_CSS _include="${CSS_NAME}" />` });
      }
      if (hasUnextractedJs && scriptBlocks.length > 0) {
        inserts.push({ pos: scriptBlocks[scriptBlocks.length - 1].start, text: `<HY_SITE_JS _include="${JS_NAME}" />` });
      }
      inserts.sort((a, b) => b.pos - a.pos);
      cuts.forEach((c) => ops.push({ pos: c.start, len: c.end - c.start, text: '', kind: 'cut' }));
      inserts.forEach((i) => ops.push({ pos: i.pos, len: 0, text: i.text, kind: 'insert' }));
      ops.sort((a, b) => b.pos - a.pos);
      for (const op of ops) {
        if (op.kind === 'insert') {
          nextHtml = nextHtml.slice(0, op.pos) + op.text + nextHtml.slice(op.pos);
        } else {
          nextHtml = nextHtml.slice(0, op.pos) + nextHtml.slice(op.pos + op.len);
        }
      }
      onApplyNewHtml(nextHtml);
    }

    // 刷资源列表 (让 cssAsset/jsAsset 重新查)
    qc.invalidateQueries({ queryKey: ['site-assets', siteId] });

    setExtracting(false);
    const okCount = [newResult.css, newResult.js].filter((v) => v === 'ok').length;
    const skipCount = [newResult.css, newResult.js].filter((v) => v === 'skip').length;
    const errCount = [newResult.css, newResult.js].filter((v) => v === 'error').length;
    if (errCount === 0) {
      toast.success(`合并: ${okCount} 个新资源, ${skipCount} 个已存在, 模板已替换`);
    } else {
      toast.warning(`合并: ${okCount} 成功, ${skipCount} 跳过, ${errCount} 失败 (失败时不替换模板)`);
    }
  };

  // 状态图标
  const StatusIcon = ({ s }: { s: 'ok' | 'skip' | 'error' | null }) => {
    if (s === 'ok') return <CheckCircle2 className="h-3 w-3 text-emerald-600 flex-shrink-0" />;
    if (s === 'skip') return <span className="text-[9px] text-muted-foreground">exists</span>;
    if (s === 'error') return <AlertCircle className="h-3 w-3 text-destructive flex-shrink-0" />;
    return null;
  };

  return (
    <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-purple-600" />
            <p className="text-xs font-medium">CSS/JS 合并抽取</p>
          </div>
          {hasAny ? (
            <Badge variant="info" className="text-[9px]">
              {styleBlocks.length} CSS / {scriptBlocks.length} JS 未抽
            </Badge>
          ) : (cssAsset || jsAsset) ? (
            <Badge variant="outline" className="text-[9px] text-emerald-700">
              已抽
            </Badge>
          ) : null}
        </div>

        {/* 资源管理 (抽过 / 现有) */}
        {(cssAsset || jsAsset) && (
          <div className="space-y-1">
            {cssAsset && (
              <AssetRow
                siteId={siteId}
                category="css"
                asset={cssAsset}
                onChanged={() => qc.invalidateQueries({ queryKey: ['site-assets', siteId] })}
                onDeleted={() => qc.invalidateQueries({ queryKey: ['site-assets', siteId] })}
              />
            )}
            {jsAsset && (
              <AssetRow
                siteId={siteId}
                category="js"
                asset={jsAsset}
                onChanged={() => qc.invalidateQueries({ queryKey: ['site-assets', siteId] })}
                onDeleted={() => qc.invalidateQueries({ queryKey: ['site-assets', siteId] })}
              />
            )}
          </div>
        )}

        {/* 未抽的块 (合并模式) */}
        {hasAny && (
          <>
            <div className="text-[10px] text-muted-foreground font-medium pt-1">
              ↓ 待合并 ↓
            </div>
            <ul className="space-y-1">
              {hasUnextractedCss && (
                <li className="flex items-center gap-1.5 border-l-2 border-blue-200 pl-2 py-0.5">
                  <Code2 className="h-3 w-3 text-blue-600 flex-shrink-0" />
                  <code className="flex-1 truncate text-[10.5px] font-mono" title={CSS_NAME}>
                    {CSS_NAME}
                  </code>
                  <span className="text-[9.5px] text-muted-foreground flex-shrink-0">
                    {styleBlocks.length} 块 / {(styleBlocks.reduce((s, b) => s + b.size, 0) / 1024).toFixed(1)} KB
                  </span>
                  <StatusIcon s={result.css} />
                </li>
              )}
              {hasUnextractedJs && (
                <li className="flex items-center gap-1.5 border-l-2 border-amber-200 pl-2 py-0.5">
                  <FileCode className="h-3 w-3 text-amber-600 flex-shrink-0" />
                  <code className="flex-1 truncate text-[10.5px] font-mono" title={JS_NAME}>
                    {JS_NAME}
                  </code>
                  <span className="text-[9.5px] text-muted-foreground flex-shrink-0">
                    {scriptBlocks.length} 块 / {(scriptBlocks.reduce((s, b) => s + b.size, 0) / 1024).toFixed(1)} KB
                  </span>
                  <StatusIcon s={result.js} />
                </li>
              )}
            </ul>
            <div className="flex items-center gap-1.5 pt-1">
              <Button
                variant="default"
                size="sm"
                className="h-7 flex-1 text-[11px]"
                onClick={handleExtract}
                disabled={extracting}
              >
                {extracting ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    合并中…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3" />
                    合并为 1 个 css / 1 个 js
                  </>
                )}
              </Button>
            </div>
          </>
        )}

        {/* 空态 */}
        {!hasAny && !cssAsset && !jsAsset && (
          <p className="text-[10.5px] text-muted-foreground leading-relaxed">
            模板 HTML 中没有可抽取的 &lt;style&gt; 或 inline &lt;script&gt; 块。
            <br />
            外部 &lt;link&gt; / &lt;script src&gt; 引用由「资源依赖」面板管理。
          </p>
        )}

        {/* 提示 */}
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {hasAny ? (
            <>
              将 <b>{styleBlocks.length + scriptBlocks.length}</b> 个块合并为 <b>1 个</b> {hasUnextractedCss ? 'css' : ''}{hasUnextractedCss && hasUnextractedJs ? ' + ' : ''}{hasUnextractedJs ? 'js' : ''} 文件, 用 <code className="px-0.5 bg-secondary/50 rounded">/* block N/M */</code> 注释分隔。
              <br />
              模板里替换为 <code className="px-0.5 bg-secondary/50 rounded">&lt;HY_SITE_CSS/JS _include="..." /&gt;</code>。
            </>
          ) : (cssAsset || jsAsset) ? (
            <>点击行右侧图标可 <b>重命名</b> / <b>编辑内容</b> / <b>复制 HY 标签引用</b>。</>
          ) : null}
        </p>
    </div>
  );
}

// === AssetRow: 单个 css/js 资源的行内管理 (重命名 + 编辑内容) ===

interface AssetRowProps {
  siteId: string;
  category: AssetCategory;
  asset: { id: string; name: string; byte_size: number; content_type: string; description: string | null };
  onChanged: () => void;
  onDeleted: () => void;
}

function AssetRow({ siteId, category, asset, onChanged, onDeleted }: AssetRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  // P3.7.5++ fix: 同步 asset.name → newName (PATCH 更名后, 父组件 cssAsset 引用变, newName 要跟上)
  useEffect(() => {
    setNewName(asset.name);
  }, [asset.name]);
  const [renameSaving, setRenameSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleRename = async () => {
    const trimmed = newName.trim();
    if (trimmed === asset.name) {
      setRenaming(false);
      return;
    }
    if (!trimmed) {
      toast.error('名字不能为空');
      return;
    }
    setRenameSaving(true);
    try {
      await siteAssetsApi.update(siteId, category, asset.name, { name: trimmed });
      toast.success(`已更名为 ${trimmed} (同步改模板里 <HY_... _include="${asset.name}"> → "${trimmed}")`);
      onChanged();
      setRenaming(false);
    } catch (e: any) {
      toast.error(`更名失败: ${e?.response?.data?.message || '未知错误'}`);
    } finally {
      setRenameSaving(false);
    }
  };

  const handleCopyHyTag = async () => {
    const tag = category === 'css'
      ? `<HY_SITE_CSS _include="${asset.name}" />`
      : `<HY_SITE_JS _include="${asset.name}" />`;
    try {
      await navigator.clipboard.writeText(tag);
      setCopied(true);
      toast.success(`已复制 ${tag}`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <>
      <div className="flex items-center gap-1.5 border-l-2 border-purple-200 pl-2 py-0.5">
        {category === 'css' ? (
          <Code2 className="h-3 w-3 text-blue-600 flex-shrink-0" />
        ) : (
          <FileCode className="h-3 w-3 text-amber-600 flex-shrink-0" />
        )}
        {renaming ? (
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') { setRenaming(false); setNewName(asset.name); }
            }}
            onBlur={() => { if (newName.trim() === asset.name) setRenaming(false); }}
            className="h-5 text-[10.5px] font-mono px-1 py-0 flex-1 min-w-0"
            autoFocus
            disabled={renameSaving}
          />
        ) : (
          <code
            className="flex-1 truncate text-[10.5px] font-mono cursor-pointer hover:bg-secondary/40 rounded px-0.5 -ml-0.5"
            title={`${asset.name} · 点击编辑名`}
            onClick={() => { setNewName(asset.name); setRenaming(true); }}
          >
            {asset.name}
          </code>
        )}
        <span className="text-[9.5px] text-muted-foreground flex-shrink-0">
          {(asset.byte_size / 1024).toFixed(1)} KB
        </span>
        {/* 操作图标 */}
        {renaming ? (
          <>
            <button
              type="button"
              onClick={handleRename}
              disabled={renameSaving}
              className="text-emerald-600 hover:bg-emerald-50 rounded p-0.5"
              title="保存新名"
            >
              {renameSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={() => { setRenaming(false); setNewName(asset.name); }}
              className="text-muted-foreground hover:bg-secondary rounded p-0.5"
              title="取消"
            >
              <XIcon className="h-3 w-3" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => { setNewName(asset.name); setRenaming(true); }}
              className="text-blue-600 hover:bg-blue-50 rounded p-0.5"
              title="重命名"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-amber-600 hover:bg-amber-50 rounded p-0.5"
              title="在线编辑内容"
            >
              <Code2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={handleCopyHyTag}
              className="text-purple-600 hover:bg-purple-50 rounded p-0.5"
              title="复制 <HY_...> 引用标签"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
          </>
        )}
      </div>
      {editing && (
        <ContentEditorDialog
          key={asset.name}        // P3.7.5+++++ fix: 更名后重开 dialog 加载新内容
          siteId={siteId}
          category={category}
          asset={asset}
          onClose={() => setEditing(false)}
          onSaved={onChanged}
        />
      )}
    </>
  );
}

// === ContentEditorDialog: css/js 内容在线编辑 (复制自 SiteAssets 简化版) ===

interface ContentEditorDialogProps {
  siteId: string;
  category: AssetCategory;
  asset: { name: string; content_type: string; byte_size: number };
  onClose: () => void;
  onSaved: () => void;
}

function ContentEditorDialog({ siteId, category, asset, onClose, onSaved }: ContentEditorDialogProps) {
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    siteAssetsApi
      .getContent(siteId, category, asset.name)
      .then((r) => {
        setContent(r.content);
        setOriginal(r.content);
      })
      .catch((e: any) => setError(e?.response?.data?.message || e?.message))
      .finally(() => setLoading(false));
  }, [siteId, category, asset.name]);

  const dirty = content !== original;
  const lang = category === 'css' ? 'css' : 'javascript';
  const newSize = new Blob([content]).size;
  const sizeOverLimit = newSize > 1024 * 1024;

  const onSave = async () => {
    if (!dirty || saving || sizeOverLimit) return;
    setSaving(true);
    setError(null);
    try {
      await siteAssetsApi.updateContent(siteId, category, asset.name, content);
      setOriginal(content);
      toast.success(`${asset.name} 已保存 (需重新发布才能在静态产物中生效)`);
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [content, dirty, sizeOverLimit, saving]);

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-muted-foreground" />
          <code className="text-sm font-semibold">{asset.name}</code>
          <Badge variant="outline" className="text-[10px] font-normal">{asset.content_type}</Badge>
          {dirty && <Badge className="bg-amber-500 text-[10px] hover:bg-amber-500">未保存</Badge>}
        </div>
      }
      description={`⌘S 保存 · Esc 关闭 · 改后需重新发布才能在静态产物中生效`}
      maxWidth="max-w-4xl"
    >
      <div className="space-y-2">
        {loading ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
            加载中…
          </div>
        ) : (
          <>
            <CodeEditor
              value={content}
              onChange={setContent}
              language={category === 'css' ? 'css' : 'javascript'}
              rows={26}
              error={sizeOverLimit}
            />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {(newSize / 1024).toFixed(1)} KB
                {sizeOverLimit && <span className="ml-2 text-destructive">超过 1MB 限制</span>}
              </span>
              {error && <span className="text-destructive">{error}</span>}
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={onSave} disabled={!dirty || saving || sizeOverLimit || loading}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? '保存中' : '保存'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
