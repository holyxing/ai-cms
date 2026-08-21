/**
 * 选择单个 HTML 文件或网络 URL 导入：解析页面引用的 CSS 并内联写入正文。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileCode2, Globe, Loader2, MousePointer2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input, Modal } from '@/components/ui';
import { mediaApi } from '@/api/media';
import {
  materializeImportedHtml,
  prepareImportedPage,
  prepareImportedPageFromUrl,
  revokePrepared,
  type PreparedPage,
} from '@/lib/importHtmlBundle';

const PICK_SOURCE = 'hy-html-import';
const HOST_SOURCE = 'hy-html-import-host';

const PICKER_CSS = `
[data-hy-hover] {
  outline: 2px solid #2563eb !important;
  outline-offset: 1px;
  cursor: pointer;
}
[data-hy-selected] {
  outline: 2px solid #2563eb !important;
  outline-offset: 1px;
  background-color: rgb(37 99 235 / 0.08) !important;
}
`;

const PICKER_JS = `(function () {
  var BLOCK = {
    ADDRESS:1, ARTICLE:1, ASIDE:1, BLOCKQUOTE:1, DIV:1, DL:1, FIELDSET:1,
    FIGURE:1, FOOTER:1, FORM:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1,
    HEADER:1, HR:1, LI:1, MAIN:1, NAV:1, OL:1, P:1, PRE:1, SECTION:1,
    TABLE:1, UL:1, FIGCAPTION:1
  };
  var seq = 0;
  var selected = {};

  function send(payload) {
    parent.postMessage(Object.assign({ source: '${PICK_SOURCE}' }, payload), '*');
  }
  function ensureId(el) {
    if (!el.getAttribute('data-hy-id')) {
      seq += 1;
      el.setAttribute('data-hy-id', 'b' + seq);
    }
    return el.getAttribute('data-hy-id');
  }
  function cleanClone(root) {
    var all = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
    all.forEach(function (n) {
      n.removeAttribute('data-hy-id');
      n.removeAttribute('data-hy-hover');
      n.removeAttribute('data-hy-selected');
      // 原站滚动入场：未进入视口时 opacity:0。写入正文后不会再观察，必须去掉
      if (n.classList) {
        n.classList.remove('ue-reveal', 'is-in-view', 'ue-enhanced');
        if (!n.getAttribute('class')) n.removeAttribute('class');
      }
    });
    root.querySelectorAll('#hy-pick-script, #hy-pick-style, [data-published-shell]').forEach(function (n) { n.remove(); });
    return root;
  }
  function exportEl(el) {
    var clone = cleanClone(el.cloneNode(true));
    var isMain = clone.tagName === 'MAIN' || clone.getAttribute('data-page-root') != null || clone.getAttribute('role') === 'main';
    return isMain ? clone.innerHTML : clone.outerHTML;
  }
  function isBlock(el) {
    return !!(el && el !== document.body && el !== document.documentElement && BLOCK[el.tagName]);
  }
  function pickBlock(start, toParent) {
    var el = start && start.nodeType === 1 ? start : (start && start.parentElement);
    if (toParent && el) el = el.parentElement;
    while (el && el !== document.body) {
      if (isBlock(el)) return el;
      el = el.parentElement;
    }
    return null;
  }
  function pathOf(el) {
    var parts = [];
    var n = el;
    while (n && n !== document.body) {
      var cls = (typeof n.className === 'string' ? n.className : '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      parts.unshift({
        id: ensureId(n),
        label: n.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : ''),
      });
      n = n.parentElement;
    }
    return parts.slice(-6);
  }
  function previewOf(el) {
    return (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 48);
  }
  function syncSelected() {
    var items = Object.keys(selected).map(function (id) {
      var el = selected[id];
      return { id: id, tag: el.tagName.toLowerCase(), preview: previewOf(el), html: exportEl(el) };
    });
    send({ type: 'selected', items: items });
  }
  function clearHover() {
    document.querySelectorAll('[data-hy-hover]').forEach(function (n) { n.removeAttribute('data-hy-hover'); });
  }
  function deselectId(id) {
    var el = selected[id];
    if (el) el.removeAttribute('data-hy-selected');
    delete selected[id];
  }
  function setSelected(el, on) {
    var id = ensureId(el);
    if (on) {
      Object.keys(selected).forEach(function (otherId) {
        var other = selected[otherId];
        if (!other || other === el) return;
        if (el.contains(other) || other.contains(el)) deselectId(otherId);
      });
      selected[id] = el;
      el.setAttribute('data-hy-selected', '1');
    } else {
      deselectId(id);
    }
    syncSelected();
  }
  function isChrome(el) {
    if (!el || el.nodeType !== 1) return true;
    var tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'NOSCRIPT') return true;
    if (el.id === 'hy-pick-script' || el.id === 'hy-pick-style') return true;
    if (tag === 'HEADER' || tag === 'FOOTER') return true;
    if (el.getAttribute('data-header') != null || el.getAttribute('data-mobile-nav') != null) return true;
    var cls = typeof el.className === 'string' ? el.className : '';
    if (/\\b(site-header|sub-header|site-footer|skip-link)\\b/.test(cls)) return true;
    if (tag === 'NAV' && el.parentElement === document.body) return true;
    return false;
  }
  function defaultMainBlocks() {
    var main = document.querySelector('main, [data-page-root], [role="main"]');
    if (main) return [main];
    return Array.prototype.slice.call(document.body.children).filter(function (el) {
      return !isChrome(el);
    });
  }
  function autoSelectMain() {
    Object.keys(selected).forEach(deselectId);
    var blocks = defaultMainBlocks();
    blocks.forEach(function (el) { setSelected(el, true); });
    if (blocks[0] && blocks[0].scrollIntoView) blocks[0].scrollIntoView({ block: 'start' });
  }
  function mainHasContent() {
    var root = document.querySelector('main, [data-page-root], [role="main"]') || document.body;
    if (root.querySelector('.page-loading, .empty-page') && !root.querySelector('h1, img, section:not(.page-loading):not(.empty-page)')) return false;
    return !!root.querySelector('section:not(.page-loading):not(.empty-page), article, img, h1, h2');
  }
  function startAutoSelect() {
    autoSelectMain();
    if (mainHasContent()) return;
    var obs = new MutationObserver(function () {
      if (!mainHasContent()) return;
      obs.disconnect();
      autoSelectMain();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); autoSelectMain(); }, 2500);
  }
  function onMove(e) {
    var el = pickBlock(e.target, false);
    clearHover();
    if (!el) {
      send({ type: 'hover', path: [] });
      return;
    }
    el.setAttribute('data-hy-hover', '1');
    send({ type: 'hover', path: pathOf(el) });
  }
  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    var el = pickBlock(e.target, !!e.altKey);
    if (!el) return;
    var id = ensureId(el);
    setSelected(el, !selected[id]);
  }
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); }, true);
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== '${HOST_SOURCE}') return;
    if (d.cmd === 'select') {
      var el = document.querySelector('[data-hy-id="' + d.id + '"]');
      if (el) setSelected(el, true);
    }
    if (d.cmd === 'deselect') { deselectId(d.id); syncSelected(); }
    if (d.cmd === 'clear') {
      Object.keys(selected).forEach(deselectId);
      syncSelected();
    }
    if (d.cmd === 'exportBody') {
      var clone = cleanClone(document.body.cloneNode(true));
      send({ type: 'body', html: clone.innerHTML });
    }
    if (d.cmd === 'selectDefault') startAutoSelect();
  });
  startAutoSelect();
  send({ type: 'ready' });
})();`;

export type ImportHtmlMode = 'append' | 'replace';

interface SelectedBlock {
  id: string;
  tag: string;
  preview: string;
  html: string;
}

interface HoverPart {
  id: string;
  label: string;
}

export interface ImportHtmlDialogProps {
  open: boolean;
  siteId: string;
  /** 编辑器已有正文时，写入前确认覆盖，不再追加 */
  hasExistingContent?: boolean;
  onClose: () => void;
  onInsert: (html: string, mode: ImportHtmlMode) => void;
}

function injectPicker(pageHtml: string): string {
  const doc = new DOMParser().parseFromString(pageHtml || '', 'text/html');
  const style = doc.createElement('style');
  style.id = 'hy-pick-style';
  style.textContent = PICKER_CSS;
  doc.head.appendChild(style);
  const script = doc.createElement('script');
  script.id = 'hy-pick-script';
  script.textContent = PICKER_JS;
  doc.body.appendChild(script);
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

export function ImportHtmlDialog({ open, siteId, hasExistingContent = false, onClose, onInsert }: ImportHtmlDialogProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const htmlRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<PreparedPage | null>(null);
  const onInsertRef = useRef(onInsert);
  onInsertRef.current = onInsert;
  const pendingModeRef = useRef<ImportHtmlMode>('replace');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingSnippetRef = useRef('');
  const skipConfirmRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [page, setPage] = useState<PreparedPage | null>(null);
  const [blocks, setBlocks] = useState<SelectedBlock[]>([]);
  const [path, setPath] = useState<HoverPart[]>([]);
  const [urlInput, setUrlInput] = useState('');

  const srcdoc = useMemo(() => (page ? injectPicker(page.srcHtml) : ''), [page]);

  const resetBundle = useCallback(() => {
    revokePrepared(pageRef.current);
    pageRef.current = null;
    setPage(null);
    setBlocks([]);
    setPath([]);
    setConfirmOpen(false);
    skipConfirmRef.current = false;
  }, []);

  useEffect(() => {
    if (!open) {
      resetBundle();
      setLoading(false);
      setInserting(false);
      setUrlInput('');
    }
  }, [open, resetBundle]);

  useEffect(() => () => { revokePrepared(pageRef.current); }, []);

  const applyPrepared = (prepared: PreparedPage) => {
    pageRef.current = prepared;
    setPage(prepared);
    setBlocks([]);
    setPath([]);
    if (prepared.missingCss.length > 0) {
      toast.warning(`有 ${prepared.missingCss.length} 个样式表未能加载（请确认已在站点资源中或外链可访问）`);
    }
    if (prepared.missingJs.length > 0) {
      toast.warning(`有 ${prepared.missingJs.length} 个脚本未能加载，预览可能空白`);
    }
  };

  const loadHtmlFile = async (file: File) => {
    if (!/\.html?$/i.test(file.name) && file.type !== 'text/html') {
      toast.error('请选择 .html 文件');
      return;
    }
    setLoading(true);
    try {
      revokePrepared(pageRef.current);
      const prepared = await prepareImportedPage(file, { siteId });
      applyPrepared(prepared);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '解析 HTML 失败');
    } finally {
      setLoading(false);
    }
  };

  const loadHtmlUrl = async () => {
    const url = urlInput.trim();
    if (!url) {
      toast.error('请输入网页地址');
      return;
    }
    setLoading(true);
    try {
      revokePrepared(pageRef.current);
      const prepared = await prepareImportedPageFromUrl(url, { siteId });
      applyPrepared(prepared);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '拉取网页失败');
    } finally {
      setLoading(false);
    }
  };

  const postToFrame = useCallback((payload: Record<string, string>) => {
    iframeRef.current?.contentWindow?.postMessage({ source: HOST_SOURCE, ...payload }, '*');
  }, []);

  const finishInsert = async (snippet: string, mode: ImportHtmlMode = 'replace') => {
    const prepared = pageRef.current;
    if (!snippet.trim() || !prepared) {
      toast.error('没有可插入的内容');
      return;
    }
    if (hasExistingContent && !skipConfirmRef.current) {
      pendingSnippetRef.current = snippet;
      pendingModeRef.current = 'replace';
      setConfirmOpen(true);
      return;
    }
    skipConfirmRef.current = false;
    setConfirmOpen(false);
    setInserting(true);
    try {
      const { html, uploaded } = await materializeImportedHtml({
        html: snippet,
        cssTexts: prepared.cssTexts,
        blobToFile: prepared.blobToFile,
        assetUrlByName: prepared.assetUrlByName,
        uploadImage: async (file) => {
          const r = await mediaApi.upload(siteId, file);
          return r.data.data?.url ?? null;
        },
      });
      if (uploaded > 0) toast.success(`已上传 ${uploaded} 张图片到媒体库`);
      onInsertRef.current(html, mode);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '写入失败');
    } finally {
      setInserting(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.source !== PICK_SOURCE) return;
      if (d.type === 'selected' && Array.isArray(d.items)) setBlocks(d.items);
      if (d.type === 'hover' && Array.isArray(d.path)) setPath(d.path);
      if (d.type === 'body' && typeof d.html === 'string') {
        void finishInsert(d.html, pendingModeRef.current);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedHtml = blocks.map((b) => b.html).join('\n\n');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="导入 HTML"
      description={page
        ? `${page.label} · 已解析 ${page.cssCount} 份样式 · 默认选中 <main> · 插入时 CSS 会写入正文`
        : '从本地 .html 或网络 URL 导入；页面里引用的 CSS 会从站点资源或外链读取并写入正文'}
      maxWidth="max-w-6xl"
    >
      <input
        ref={htmlRef}
        type="file"
        accept=".html,.htm,text/html"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void loadHtmlFile(file);
        }}
      />

      {!page && (
        <div className="px-6 py-8">
          {loading ? (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              正在读取 HTML 并解析样式…
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Globe className="h-4 w-4 text-primary" />
                  从网络 URL 导入
                </div>
                <div className="flex gap-2">
                  <Input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://example.com/article.html"
                    className="h-9 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void loadHtmlUrl();
                      }
                    }}
                  />
                  <Button size="sm" className="h-9 shrink-0 px-3 text-sm" onClick={() => void loadHtmlUrl()}>
                    拉取
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                或
                <span className="h-px flex-1 bg-border" />
              </div>

              <div className="flex flex-col items-center gap-3">
                <Button variant="outline" size="sm" className="h-9 gap-2 text-sm" onClick={() => htmlRef.current?.click()}>
                  <FileCode2 className="h-4 w-4" />
                  选择 HTML 文件
                </Button>
                <p className="max-w-md text-center text-xs text-muted-foreground">
                  &lt;link&gt; / &lt;style&gt; 引用的样式会自动读取（优先本站资源库，其次 http 外链），插入正文时写成 &lt;style&gt; 块。
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {page && (
        <div className="flex h-[72vh] flex-col">
          <div className="flex flex-shrink-0 items-center gap-2 border-b px-4 py-2">
            <MousePointer2 className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
              {path.length === 0 ? '将指针移到页面区块上' : path.map((p) => p.label).join(' > ')}
            </div>
            {path.length > 0 && (
              <div className="hidden max-w-[40%] flex-wrap items-center gap-1 lg:flex">
                {path.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="rounded-md border bg-secondary/40 px-1.5 py-0.5 text-[11px] text-foreground hover:bg-secondary"
                    onClick={() => postToFrame({ cmd: 'select', id: p.id })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => { resetBundle(); }}
              disabled={inserting}
            >
              重新选择
            </Button>
          </div>

          <div className="relative flex min-h-0 flex-1">
            {(loading || inserting) && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />
                {inserting ? '正在上传图片并整理样式…' : '正在解析…'}
              </div>
            )}
            <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-white">
              <iframe
                ref={iframeRef}
                title="导入 HTML 预览"
                srcDoc={srcdoc}
                sandbox="allow-scripts allow-same-origin"
                className="absolute inset-0 h-full w-full border-0 bg-white"
              />
            </div>
            <aside className="flex w-60 flex-shrink-0 flex-col border-l bg-background">
              <div className="border-b px-3 py-2 text-[11px] font-medium text-muted-foreground">
                已选 {blocks.length} 块
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {blocks.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    已默认选中 &lt;main&gt; 区域内容。插入时会将本页 CSS 写入 &lt;style&gt;，图片上传媒体库。
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {blocks.map((b) => (
                      <li key={b.id}>
                        <div className="flex items-start gap-1 rounded-md border bg-secondary/30 px-2 py-1.5">
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-[11px] text-primary">{b.tag}</div>
                            <div className="truncate text-xs text-muted-foreground">{b.preview || '(空)'}</div>
                          </div>
                          <button
                            type="button"
                            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                            aria-label="取消选中"
                            onClick={() => postToFrame({ cmd: 'deselect', id: b.id })}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {blocks.length > 0 && (
                <div className="border-t px-2 py-2">
                  <Button variant="ghost" size="sm" className="h-7 w-full text-[11px]" onClick={() => postToFrame({ cmd: 'clear' })}>
                    清空选中
                  </Button>
                </div>
              )}
            </aside>
          </div>

          <div className="flex flex-shrink-0 flex-col border-t">
            {confirmOpen && (
              <div className="flex items-center justify-between gap-2 bg-amber-50 px-4 py-3">
                <p className="text-xs text-amber-800">编辑器已有内容，写入将覆盖当前正文。</p>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setConfirmOpen(false)}>
                    取消
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      skipConfirmRef.current = true;
                      void finishInsert(pendingSnippetRef.current, 'replace');
                    }}
                  >
                    覆盖正文
                  </Button>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                disabled={inserting}
                onClick={() => { pendingModeRef.current = 'replace'; postToFrame({ cmd: 'exportBody' }); }}
              >
                写入整个正文
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose} disabled={inserting}>
                  取消
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={blocks.length === 0 || inserting}
                  onClick={() => void finishInsert(selectedHtml, 'replace')}
                >
                  {inserting ? '处理中…' : '写入正文'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
