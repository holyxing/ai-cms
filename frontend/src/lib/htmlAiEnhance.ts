/**
 * htmlAiEnhance.ts - HTML 正文 AI 增强（样式 / 正文 / 外链图片本地化）
 * 走系统已接入的 LLM（aiApi.startTask + stream），图片走站点资源 import-from-url
 */
import { aiApi, streamRun, type AITaskType } from '@/api/ai';
import { siteAssetsApi, previewUrl } from '@/api/siteAssets';

export type HtmlEnhanceKind = 'style' | 'content' | 'images' | 'all';

function stripCodeFence(text: string): string {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:html|HTML)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return t.trim();
}

/** 正文片段：剥掉模型误加的 html/head/body 等文档壳 */
export function stripDocumentShell(html: string): string {
  let t = html.trim();
  if (!t) return t;
  t = t.replace(/<!doctype[^>]*>/gi, '');
  // 若整段被 html/body 包裹，只取 body 内；否则删掉这些标签本身
  const bodyInner = t.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyInner) {
    t = bodyInner[1];
  } else {
    t = t
      .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
      .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '');
  }
  t = t.replace(/<(?:meta|title|link)\b[^>]*>/gi, '');
  return t.trim();
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE']);
const MEDIA_TAGS = new Set(['IMG', 'VIDEO', 'AUDIO', 'IFRAME']);
const INLINE_KEEP = new Set(['STRONG', 'EM', 'B', 'I', 'A', 'BR', 'CODE']);

/**
 * 本地样式清理（不用 AI）：
 * - 保留有文字的 p/h1-h6/li/blockquote 与 img/video 等
 * - 去掉全部 style/class/无用 data-*
 * - section/div/span 等外壳只展开子节点
 */
export function cleanupBodyHtmlLocal(html: string): string {
  const raw = stripDocumentShell(html);
  if (!raw.trim()) return '';

  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const root = doc.body;
  if (!root) return raw;

  const serializeMedia = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      const src =
        el.getAttribute('src')?.trim()
        || el.getAttribute('data-src')?.trim()
        || el.getAttribute('data-original')?.trim()
        || el.getAttribute('data-croporisrc')?.trim()
        || '';
      if (!src) return '';
      const alt = el.getAttribute('alt') || '';
      return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />`;
    }
    const src = el.getAttribute('src')?.trim() || '';
    if (!src) return '';
    if (tag === 'video' || tag === 'audio') {
      return `<${tag} src="${escapeAttr(src)}" controls></${tag}>`;
    }
    if (tag === 'iframe') {
      return `<iframe src="${escapeAttr(src)}" loading="lazy"></iframe>`;
    }
    return '';
  };

  const serializeInline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeText(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as Element;
    const name = el.tagName.toUpperCase();
    if (MEDIA_TAGS.has(name)) return serializeMedia(el);
    if (name === 'BR') return '<br />';
    if (INLINE_KEEP.has(name)) {
      const inner = Array.from(el.childNodes).map(serializeInline).join('');
      if (name === 'A') {
        const href = el.getAttribute('href')?.trim() || '';
        if (!href || !inner.trim()) return inner;
        return `<a href="${escapeAttr(href)}">${inner}</a>`;
      }
      const t = name.toLowerCase();
      if (!inner.trim()) return '';
      return `<${t}>${inner}</${t}>`;
    }
    // span/font 等：只保留子内容
    return Array.from(el.childNodes).map(serializeInline).join('');
  };

  const hasMeaningful = (s: string) => {
    const t = s.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    return t.length > 0 || /<img\b/i.test(s) || /<(video|audio|iframe)\b/i.test(s);
  };

  const serializeBlock = (el: Element): string => {
    const name = el.tagName.toUpperCase();
    if (MEDIA_TAGS.has(name)) return serializeMedia(el);

    if (name === 'UL' || name === 'OL') {
      const items = Array.from(el.children)
        .filter((c) => c.tagName === 'LI')
        .map((li) => {
          const inner = Array.from(li.childNodes).map(serializeInline).join('');
          if (!hasMeaningful(inner)) return '';
          return `<li>${inner.trim()}</li>`;
        })
        .filter(Boolean);
      if (!items.length) return '';
      const t = name.toLowerCase();
      return `<${t}>\n${items.join('\n')}\n</${t}>`;
    }

    if (BLOCK_TAGS.has(name)) {
      const inner = Array.from(el.childNodes).map(serializeInline).join('');
      if (!hasMeaningful(inner)) return '';
      // 孤立 li 提成 p
      const t = name === 'LI' ? 'p' : name.toLowerCase();
      return `<${t}>${inner.trim()}</${t}>`;
    }

    // section/div 等外壳：展开子节点
    return Array.from(el.childNodes)
      .map((n) => {
        if (n.nodeType === Node.TEXT_NODE) {
          const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
          return t ? `<p>${escapeText(t)}</p>` : '';
        }
        if (n.nodeType === Node.ELEMENT_NODE) return serializeBlock(n as Element);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  };

  const parts = Array.from(root.childNodes)
    .map((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
        return t ? `<p>${escapeText(t)}</p>` : '';
      }
      if (n.nodeType === Node.ELEMENT_NODE) return serializeBlock(n as Element);
      return '';
    })
    .filter(Boolean);

  return parts.join('\n\n').trim();
}

/**
 * 微信稿等常见外链图属性（懒加载 / 裁剪原图）。
 * 只改 src 而不清 data-croporisrc，预览脚本可能又把图改回微信 CDN。
 */
const IMG_URL_ATTRS = [
  'src',
  'data-src',
  'data-original',
  'data-croporisrc',
  'data-before-cropped-url',
  'data-lazy-src',
  'data-actualsrc',
  'data-backup-src',
  'data-url',
] as const;

/** 本地化成功后应删除的残留属性（避免再指回外链） */
const IMG_REMOTE_ATTRS_TO_STRIP = IMG_URL_ATTRS.filter((a) => a !== 'src');

function isLocalAssetUrl(u: string, siteSlug?: string): boolean {
  if (!u) return false;
  if (u.startsWith('/') || u.startsWith('./') || u.startsWith('../')) return true;
  if (siteSlug && u.includes(`/sites/${siteSlug}/`)) return true;
  if (u.includes('/api/v1/sites/') && u.includes('/assets/')) return true;
  return false;
}

/** 收集 HTML 中的外链图片 URL（跳过 data:、本站相对路径、已入库） */
export function collectExternalImageUrls(html: string, siteSlug?: string): string[] {
  const found = new Set<string>();
  const add = (raw: string) => {
    let u = (raw || '').trim();
    if (!u) return;
    // 若误吞了后续标签，截断到第一个 <
    const lt = u.indexOf('<');
    if (lt >= 0) u = u.slice(0, lt).trim();
    if (!u) return;
    if (u.startsWith('data:')) return;
    if (isLocalAssetUrl(u, siteSlug)) return;
    // 必须是完整 http(s) URL（排除残缺的 "http:"）
    if (!/^https?:\/\/[^/\s"']+/i.test(u)) return;
    // 禁止含 HTML / 空白，避免把后续 <img> 吃进「URL」
    if (/[<>\s]/.test(u)) return;
    if (u.length > 2048) return;
    found.add(u);
  };

  // 只在单个 <img ...> 标签内取 URL 属性 / srcset，避免跨标签误匹配
  const imgTagRe = /<img\b[^>]*>/gi;
  let imgM: RegExpExecArray | null;
  while ((imgM = imgTagRe.exec(html)) !== null) {
    const tag = imgM[0];
    for (const attr of IMG_URL_ATTRS) {
      const m = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i'));
      if (m) add(m[1]);
    }
    const srcset = tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i);
    if (srcset) {
      for (const part of srcset[1].split(',')) {
        const url = part.trim().split(/\s+/)[0];
        if (url) add(url);
      }
    }
  }

  // 其它节点 style 里的背景图
  const cssUrlRe = /url\(\s*['"]?(https?:\/\/[^'")\s]+)['"]?\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = cssUrlRe.exec(html)) !== null) {
    if (/\.(png|jpe?g|gif|webp|svg|ico|bmp)(\?|$)/i.test(m[1]) || /\/(?:mmbiz|image|img)\//i.test(m[1])) {
      add(m[1]);
    }
  }

  return Array.from(found);
}

/** 仅在属性上下文中替换 URL，禁止全局 split（会误伤后续 img 标签） */
function replaceUrlInHtml(html: string, from: string, to: string): string {
  if (!from || from === to) return html;
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attrAlt = IMG_URL_ATTRS.join('|');

  // src / data-src / data-croporisrc 等
  let out = html.replace(
    new RegExp(`(\\b(?:${attrAlt})\\s*=\\s*["'])${esc}(["'])`, 'gi'),
    `$1${to}$2`,
  );

  // srcset 里的独立 URL token
  out = out.replace(/(\bsrcset\s*=\s*["'])([^"']*)(["'])/gi, (_whole, a: string, value: string, b: string) => {
    const next = value
      .split(',')
      .map((part) => {
        const bits = part.trim().split(/\s+/);
        if (bits[0] === from) bits[0] = to;
        return bits.join(' ');
      })
      .join(', ');
    return a + next + b;
  });

  // style / css url(...)
  out = out.replace(
    new RegExp(`(url\\(\\s*['"]?)${esc}(['"]?\\s*\\))`, 'gi'),
    `$1${to}$2`,
  );

  return out;
}

/**
 * 本地化后：把最终 src 定为本地地址，并删掉仍可能指回外链的 data-*，
 * 避免微信懒加载脚本用 data-croporisrc 把图改回 mmbiz。
 */
function finalizeLocalizedImgTags(html: string, mapping: Map<string, string>, siteSlug?: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    let local: string | null = null;
    for (const attr of IMG_URL_ATTRS) {
      const m = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i'));
      if (!m) continue;
      const v = m[1];
      const mapped = mapping.get(v);
      if (mapped) {
        local = mapped;
        break;
      }
      if (isLocalAssetUrl(v, siteSlug)) {
        local = v;
        break;
      }
    }
    if (!local) return tag;

    let out = tag;
    for (const attr of IMG_REMOTE_ATTRS_TO_STRIP) {
      out = out.replace(new RegExp(`\\s*\\b${attr}\\s*=\\s*(["'][^"']*["'])`, 'gi'), '');
    }
    // srcset 若仍含外链则清空，避免浏览器选中外链候选
    out = out.replace(/\s*\bsrcset\s*=\s*(["'][^"']*["'])/gi, (whole, quoted: string) => {
      const val = quoted.slice(1, -1);
      if (/https?:\/\//i.test(val)) return '';
      return whole;
    });

    if (/\bsrc\s*=/i.test(out)) {
      out = out.replace(/\bsrc\s*=\s*(["'])[^"']*\1/i, `src="${local}"`);
    } else {
      out = out.replace(/^<img\b/i, `<img src="${local}"`);
    }
    return out;
  });
}

/** 按 URL 长度降序替换，避免短 URL 是长 URL 前缀时误伤 */
function applyUrlMapping(html: string, mapping: Map<string, string>, siteSlug?: string): string {
  const entries = [...mapping.entries()].sort((a, b) => b[0].length - a[0].length);
  let out = html;
  for (const [from, to] of entries) {
    out = replaceUrlInHtml(out, from, to);
  }
  return finalizeLocalizedImgTags(out, mapping, siteSlug);
}

async function runLlmTransform(opts: {
  siteId: string;
  contentId?: string;
  html: string;
  task: AITaskType;
  /** 托管 prompt key（优先）；无则回退 userPrompt */
  promptKey?: string;
  promptVars?: Record<string, string>;
  userPrompt?: string;
  onDelta?: (t: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const truncated =
    opts.html.length > 47000
      ? opts.html.slice(0, 47000) + '\n<!-- ... truncated for AI -->'
      : opts.html;

  const start = await aiApi.startTask(opts.task, {
    site_id: opts.siteId,
    content_id: opts.contentId || undefined,
    input: {
      original_text: truncated,
      text: truncated,
      ...(opts.promptKey
        ? { prompt_key: opts.promptKey, prompt_vars: opts.promptVars }
        : { user_prompt: opts.userPrompt }),
    },
  });

  let accumulated = '';
  let finalText = '';
  let failed: string | null = null;

  await new Promise<void>((resolve, reject) => {
    streamRun(start.run_id, {
      signal: opts.signal,
      onDelta: (d) => {
        accumulated += d;
        opts.onDelta?.(accumulated);
      },
      onEvent: (ev) => {
        const d = ev.data as Record<string, unknown> | null;
        if (!d) return;
        if (typeof d.delta === 'string' && !accumulated.includes(d.delta)) {
          // onDelta 可能已加过
        }
        if (d.status === 'success') {
          const output = (d.output as Record<string, unknown> | undefined) ?? {};
          finalText = String(
            output.result_text ?? output.rewritten_text ?? accumulated ?? '',
          );
        }
        if (d.status === 'failed' || d.status === 'cancelled') {
          failed = String(d.error || 'AI 任务失败');
        }
      },
      onError: (e) => {
        failed = e instanceof Error ? e.message : String(e);
        reject(new Error(failed));
      },
      onAbort: () => reject(new Error('已取消')),
      onDone: () => resolve(),
    }).catch(reject);
  });

  if (failed) throw new Error(failed);
  const result = stripCodeFence(finalText || accumulated);
  if (!result) throw new Error('AI 未返回内容');
  // 样式优化等正文增强：禁止留下完整页面壳
  if (opts.promptKey === 'enhance.style' || opts.promptKey === 'enhance.content') {
    return stripDocumentShell(result);
  }
  return result;
}

export async function enhanceHtmlStyle(opts: {
  siteId: string;
  contentId?: string;
  html: string;
  onDelta?: (t: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  // 本地规则清理，不调 AI
  void opts.siteId;
  void opts.contentId;
  void opts.signal;
  const next = cleanupBodyHtmlLocal(opts.html || '');
  opts.onDelta?.(next);
  return next;
}

export async function enhanceHtmlContent(opts: {
  siteId: string;
  contentId?: string;
  html: string;
  onDelta?: (t: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  return runLlmTransform({
    ...opts,
    task: 'polish',
    promptKey: 'enhance.content',
  });
}

export async function localizeExternalImages(opts: {
  siteId: string;
  html: string;
  siteSlug?: string;
  onProgress?: (done: number, total: number, url: string) => void;
}): Promise<{ html: string; imported: number; reused: number; failed: number; firstError?: string }> {
  const urls = collectExternalImageUrls(opts.html, opts.siteSlug);
  if (urls.length === 0) {
    return { html: opts.html, imported: 0, reused: 0, failed: 0 };
  }

  // 预读站点资源：按源 URL 索引；并用 id 集合判断后端是否复用已有记录
  const knownByUrl = new Map<string, string>();
  const knownIds = new Set<string>();
  try {
    const listed = await siteAssetsApi.list(opts.siteId, 'assets');
    for (const a of listed.items) {
      knownIds.add(a.id);
      const desc = a.description || '';
      const m = desc.match(/^imported from (\S+)/);
      if (!m) continue;
      const src = m[1];
      // 跳过历史误入库的微信防盗链小 GIF，强制走后端重新拉取
      const looksBadWechatPlaceholder =
        (a.byte_size || 0) < 4096 &&
        (a.content_type || '').toLowerCase().includes('gif') &&
        /qpic\.cn|mmbiz/i.test(src);
      if (looksBadWechatPlaceholder) continue;
      const local = a.url || previewUrl(opts.siteId, a.category, a.name);
      knownByUrl.set(src, local);
      if (src.length >= 200) knownByUrl.set(src.slice(0, 200), local);
    }
  } catch {
    /* 列表失败时仍走后端去重 */
  }

  const mapping = new Map<string, string>();
  let imported = 0;
  let reused = 0;
  let failed = 0;
  let firstError: string | undefined;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    opts.onProgress?.(i, urls.length, url);

    const cached = knownByUrl.get(url) || knownByUrl.get(url.slice(0, 200));
    if (cached) {
      mapping.set(url, cached);
      reused++;
      continue;
    }

    try {
      const asset = await siteAssetsApi.importFromUrl(opts.siteId, {
        url,
        category: 'assets',
      });
      const localUrl = asset.url || previewUrl(opts.siteId, asset.category, asset.name);
      mapping.set(url, localUrl);
      knownByUrl.set(url, localUrl);
      knownByUrl.set(url.slice(0, 200), localUrl);
      if (knownIds.has(asset.id)) {
        reused++;
      } else {
        imported++;
        knownIds.add(asset.id);
      }
    } catch (e: unknown) {
      console.warn('import image failed', url, e);
      failed++;
      if (!firstError) {
        const ax = e as { response?: { data?: { message?: string; detail?: string } }; message?: string };
        firstError =
          ax?.response?.data?.message ||
          (typeof ax?.response?.data?.detail === 'string' ? ax.response.data.detail : undefined) ||
          ax?.message ||
          '导入失败';
      }
    }
  }
  opts.onProgress?.(urls.length, urls.length, '');

  const html = mapping.size > 0
    ? applyUrlMapping(opts.html, mapping, opts.siteSlug)
    : opts.html;
  return { html, imported, reused, failed, firstError };
}

export async function enhanceHtmlAll(opts: {
  siteId: string;
  contentId?: string;
  html: string;
  siteSlug?: string;
  onStep?: (step: string) => void;
  onDelta?: (t: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  opts.onStep?.('样式优化');
  let html = await enhanceHtmlStyle(opts);
  opts.onStep?.('正文优化');
  html = await enhanceHtmlContent({ ...opts, html });
  opts.onStep?.('图片本地化');
  const img = await localizeExternalImages({
    siteId: opts.siteId,
    html,
    siteSlug: opts.siteSlug,
  });
  return img.html;
}
