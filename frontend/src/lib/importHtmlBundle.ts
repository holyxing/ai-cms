/** 单 HTML 导入：解析页面引用的 CSS / 图片，插入时内联样式 */

import { api } from '@/api/client';
import { contentsApi } from '@/api/contents';
import { previewUrl, siteAssetsApi, type SiteAsset } from '@/api/siteAssets';

const HTML_RE = /\.html?$/i;
const CSS_RE = /\.css$/i;
const JS_RE = /\.js$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/i;
const FONT_RE = /\.(woff2?|ttf|otf|eot)$/i;
const EXT_MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
  bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
};

export interface PreparedPage {
  htmlPath: string;
  label: string;
  srcHtml: string;
  cssTexts: string[];
  blobToFile: Map<string, File>;
  blobUrls: string[];
  cssCount: number;
  imageCount: number;
  missingCss: string[];
  missingJs: string[];
  assetUrlByName: Record<string, string>;
}

interface SiteAssetIndex {
  siteId: string;
  siteSlug: string;
  cssByName: Map<string, SiteAsset>;
  jsByName: Map<string, SiteAsset>;
  assetsByName: Map<string, SiteAsset>;
}

export function fileRelPath(file: File): string {
  return norm((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
}

export function guessMime(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return EXT_MIME[ext] || 'application/octet-stream';
}

function norm(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function isExternal(href: string): boolean {
  return /^(https?:|data:|blob:|\/\/|mailto:|javascript:)/i.test(href.trim());
}

/** 相对路径相对页面基址解析为绝对 URL（网络导入用） */
function absolutize(fromPath: string, href: string): string {
  const cleaned = href.trim();
  if (!cleaned) return cleaned;
  if (/^(data:|blob:|mailto:|javascript:)/i.test(cleaned)) return cleaned;
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  if (cleaned.startsWith('//')) {
    try {
      const proto = /^https?:/i.test(fromPath) ? new URL(fromPath).protocol : 'https:';
      return `${proto}${cleaned}`;
    } catch {
      return `https:${cleaned}`;
    }
  }
  if (/^https?:\/\//i.test(fromPath)) {
    try {
      return new URL(cleaned, fromPath).href;
    } catch {
      return cleaned;
    }
  }
  return cleaned;
}

function stripUrl(href: string): string {
  return href.trim().replace(/['"]/g, '').split('?')[0].split('#')[0];
}

function basename(href: string): string {
  return stripUrl(href).split('/').pop()?.toLowerCase() || '';
}

function indexFiles(files: File[]): Map<string, File> {
  const map = new Map<string, File>();
  for (const f of files) {
    map.set(fileRelPath(f).toLowerCase(), f);
    map.set(f.name.toLowerCase(), f);
  }
  return map;
}

function lookup(map: Map<string, File>, path: string): File | undefined {
  const n = norm(path).toLowerCase();
  if (!n) return undefined;
  return map.get(n) || map.get(n.replace(/^\//, '')) || map.get(basename(n));
}

function resolveLocalFile(fromPath: string, href: string, map: Map<string, File>): File | undefined {
  const cleaned = stripUrl(href);
  if (!cleaned || isExternal(cleaned)) return undefined;
  if (cleaned.startsWith('/')) return lookup(map, cleaned.slice(1));
  const dir = fromPath.split('/').slice(0, -1).join('/');
  return lookup(map, (dir ? `${dir}/` : '') + cleaned);
}

async function buildSiteAssetIndex(siteId: string): Promise<SiteAssetIndex | null> {
  try {
    const resp = await siteAssetsApi.list(siteId);
    const cssByName = new Map<string, SiteAsset>();
    const jsByName = new Map<string, SiteAsset>();
    const assetsByName = new Map<string, SiteAsset>();
    for (const a of resp.items || []) {
      const key = a.name.toLowerCase();
      if (a.category === 'css') cssByName.set(key, a);
      if (a.category === 'js' || key.endsWith('.js')) jsByName.set(key, a);
      if (a.category === 'assets') assetsByName.set(key, a);
    }
    const firstUrl = resp.items?.[0]?.url || '';
    const siteSlug = firstUrl.split('/')[2] || '';
    return { siteId, siteSlug, cssByName, jsByName, assetsByName };
  } catch {
    return null;
  }
}

async function fetchRemoteText(url: string, siteId?: string): Promise<string | null> {
  const abs = url.startsWith('/') ? `${window.location.origin}${url}` : url;
  try {
    if (/^https?:\/\//i.test(abs)) {
      const r = await fetch(abs, { mode: 'cors', credentials: 'omit' });
      if (r.ok) return await r.text();
    }
  } catch {
    /* 忽略，尝试同源或服务端代拉 */
  }
  if (siteId && /^https?:\/\//i.test(abs)) {
    try {
      const data = await contentsApi.fetchRemote(siteId, abs);
      return data.text;
    } catch {
      return null;
    }
  }
  try {
    const r = await api.get<string>(abs, {
      responseType: 'text',
      transformResponse: [(d) => d],
      timeout: 20_000,
    });
    return r.data;
  } catch {
    return null;
  }
}

async function fetchCssText(
  href: string,
  index: SiteAssetIndex | null,
  localMap: Map<string, File>,
  htmlPath: string,
): Promise<string | null> {
  const resolved = absolutize(htmlPath, href);
  const cleaned = stripUrl(resolved);
  if (!cleaned) return null;

  const local = resolveLocalFile(htmlPath, stripUrl(href), localMap);
  if (local && CSS_RE.test(local.name)) return local.text();

  if (isExternal(cleaned) || /^https?:\/\//i.test(cleaned)) {
    return fetchRemoteText(cleaned, index?.siteId);
  }
  if (cleaned.startsWith('/')) return fetchRemoteText(cleaned, index?.siteId);

  const name = basename(cleaned);
  if (index) {
    const asset = index.cssByName.get(name);
    if (asset) {
      try {
        const data = await siteAssetsApi.getContent(index.siteId, 'css', asset.name);
        return data.content;
      } catch {
        /* 继续尝试外链 */
      }
    }
  }
  return null;
}

async function fetchJsText(
  src: string,
  index: SiteAssetIndex | null,
  localMap: Map<string, File>,
  htmlPath: string,
): Promise<string | null> {
  const resolved = absolutize(htmlPath, src);
  const cleaned = stripUrl(resolved);
  if (!cleaned) return null;

  const local = resolveLocalFile(htmlPath, stripUrl(src), localMap);
  if (local && JS_RE.test(local.name)) return local.text();

  const name = basename(cleaned);
    if (index) {
      const asset = index.jsByName.get(name);
      if (asset) {
        const cat = (asset.category === 'css' || asset.category === 'js' || asset.category === 'assets')
          ? asset.category
          : 'js';
        try {
          const data = await siteAssetsApi.getContent(index.siteId, cat, asset.name);
          if (data.content) return data.content;
        } catch {
          /* 兑底 binary */
        }
        try {
          const r = await api.get<string>(previewUrl(index.siteId, cat, asset.name), {
            responseType: 'text',
            transformResponse: [(d) => d],
            timeout: 20_000,
          });
          if (r.data) return r.data;
        } catch {
          /* 忽略 */
        }
      }
    }
  if (isExternal(cleaned) || cleaned.startsWith('/') || /^https?:\/\//i.test(cleaned)) {
    return fetchRemoteText(cleaned.startsWith('//') ? absolutize(htmlPath, cleaned) : cleaned, index?.siteId);
  }
  if (index) {
    const asset = index.jsByName.get(name);
    const slug = index.siteSlug || asset?.url?.split('/')[2] || '';
    const orig = (asset?.original_filename || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const extra = [
      orig && slug ? `/sites/${slug}/${orig}` : '',
      orig && slug ? `/sites/${slug}/public/${orig}` : '',
      slug ? `/sites/${slug}/assets/js/${name}` : '',
      slug ? `/sites/${slug}/js/${name}` : '',
    ].filter(Boolean);
    for (const u of extra) {
      const t = await fetchRemoteText(u, index?.siteId);
      if (t && t.length > 40) return t;
    }
  }
  return null;
}

function resolvePublicUrl(href: string, index: SiteAssetIndex | null, localMap: Map<string, File>, htmlPath: string): string | null {
  const abs = absolutize(htmlPath, href);
  const cleaned = stripUrl(abs);
  if (!cleaned) return null;
  if (isExternal(cleaned) || /^https?:\/\//i.test(cleaned)) return cleaned.startsWith('//') ? absolutize(htmlPath, cleaned) : cleaned;

  const local = resolveLocalFile(htmlPath, stripUrl(href), localMap);
  if (local) return null; // 走 blob

  if (index) {
    const asset = index.assetsByName.get(basename(cleaned));
    if (asset) return publicAssetUrl(index, asset);
  }
  return null;
}

function publicAssetUrl(index: SiteAssetIndex, asset: SiteAsset): string {
  const orig = (asset.original_filename || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (orig.includes('/') && index.siteSlug) return `/sites/${index.siteSlug}/${orig}`;
  return asset.url || previewUrl(index.siteId, 'assets', asset.name);
}

function blobFor(file: File, cache: Map<string, string>, blobToFile: Map<string, File>): string {
  const key = fileRelPath(file).toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const url = URL.createObjectURL(file);
  cache.set(key, url);
  blobToFile.set(url, file);
  return url;
}

async function rewriteCss(
  css: string,
  baseHref: string,
  localMap: Map<string, File>,
  cache: Map<string, string>,
  blobToFile: Map<string, File>,
  seenCss: Set<string>,
  index: SiteAssetIndex | null,
  htmlPath: string,
): Promise<string> {
  let out = css;
  const imports = [...css.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'")]+)\1\s*\)?\s*;?/gi)];
  for (const m of imports) {
    const href = m[2];
    const key = basename(href);
    if (seenCss.has(key)) {
      out = out.replace(m[0], '');
      continue;
    }
    const nested = await fetchCssText(href, index, localMap, baseHref || htmlPath);
    if (!nested) continue;
    seenCss.add(key);
    const inlined = await rewriteCss(nested, href, localMap, cache, blobToFile, seenCss, index, htmlPath);
    out = out.replace(m[0], inlined);
  }

  out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, quote: string, raw: string) => {
    const pub = resolvePublicUrl(raw, index, localMap, baseHref || htmlPath);
    if (pub) {
      const q = quote || '"';
      return `url(${q}${pub}${q})`;
    }
    const file = resolveLocalFile(baseHref || htmlPath, raw, localMap);
    if (!file) return full;
    const q = quote || '"';
    return `url(${q}${blobFor(file, cache, blobToFile)}${q})`;
  });
  return out;
}

function rewriteSrcset(
  value: string,
  fromPath: string,
  localMap: Map<string, File>,
  cache: Map<string, string>,
  blobToFile: Map<string, File>,
  index: SiteAssetIndex | null,
): string {
  return value.split(',').map((part) => {
    const bits = part.trim().split(/\s+/);
    if (!bits[0]) return part;
    const pub = resolvePublicUrl(bits[0], index, localMap, fromPath);
    if (pub) {
      bits[0] = pub;
      return bits.join(' ');
    }
    const file = resolveLocalFile(fromPath, bits[0], localMap);
    if (file) bits[0] = blobFor(file, cache, blobToFile);
    return bits.join(' ');
  }).join(', ');
}

function rewriteAttr(
  el: Element,
  attr: string,
  fromPath: string,
  localMap: Map<string, File>,
  cache: Map<string, string>,
  blobToFile: Map<string, File>,
  index: SiteAssetIndex | null,
) {
  const raw = el.getAttribute(attr);
  if (!raw) return;
  if (attr === 'srcset') {
    el.setAttribute(attr, rewriteSrcset(raw, fromPath, localMap, cache, blobToFile, index));
    return;
  }
  const pub = resolvePublicUrl(raw, index, localMap, fromPath);
  if (pub) {
    el.setAttribute(attr, pub);
    return;
  }
  const file = resolveLocalFile(fromPath, raw, localMap);
  if (file) el.setAttribute(attr, blobFor(file, cache, blobToFile));
}

/** 解析单个 HTML：拉取 link/style 里的 CSS，预览可用；插入时再内联进正文 */
export async function prepareImportedPage(
  htmlFile: File,
  opts: { siteId?: string; extraFiles?: File[] } = {},
): Promise<PreparedPage> {
  const htmlText = await htmlFile.text();
  return prepareImportedHtml(htmlText, {
    siteId: opts.siteId,
    extraFiles: opts.extraFiles?.length ? opts.extraFiles : [htmlFile],
    htmlPath: fileRelPath(htmlFile),
    label: htmlFile.name,
  });
}

/** 从网络 URL 拉取并解析 HTML（服务端代拉，绕过 CORS） */
export async function prepareImportedPageFromUrl(
  pageUrl: string,
  opts: { siteId: string } = { siteId: '' },
): Promise<PreparedPage> {
  const raw = pageUrl.trim();
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error('请输入以 http:// 或 https:// 开头的网址');
  }
  if (!opts.siteId) throw new Error('缺少站点');
  const remote = await contentsApi.fetchRemote(opts.siteId, raw);
  const finalUrl = remote.final_url || raw;
  let label = finalUrl;
  try {
    const u = new URL(finalUrl);
    label = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
    if (!/\.html?$/i.test(label)) label = `${u.hostname}.html`;
  } catch {
    label = 'imported.html';
  }
  return prepareImportedHtml(remote.text, {
    siteId: opts.siteId,
    htmlPath: finalUrl,
    label,
  });
}

async function prepareImportedHtml(
  htmlText: string,
  opts: {
    siteId?: string;
    extraFiles?: File[];
    htmlPath: string;
    label: string;
  },
): Promise<PreparedPage> {
  const localFiles = opts.extraFiles?.length ? opts.extraFiles : [];
  const localMap = indexFiles(localFiles);
  const index = opts.siteId ? await buildSiteAssetIndex(opts.siteId) : null;
  const htmlPath = opts.htmlPath;
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const pageKey = opts.label.replace(/\.html?$/i, '');
  if (doc.body && !doc.body.getAttribute('data-page') && !doc.body.getAttribute('data-content')) {
    doc.body.setAttribute('data-page', pageKey);
  }
  const bodyText = (doc.body?.innerText || '').replace(/\s+/g, ' ').trim();
  if (doc.body && !doc.body.querySelector('[data-published-shell]') && bodyText.length < 80) {
    const shell = doc.createElement('div');
    shell.setAttribute('data-published-shell', '');
    doc.body.insertBefore(shell, doc.body.firstChild);
  }

  const scriptSrcs = Array.from(doc.querySelectorAll('script[src]'))
    .map((s) => s.getAttribute('src') || '')
    .filter(Boolean);
  const inlineScripts = Array.from(doc.querySelectorAll('script:not([src])'))
    .map((s) => s.textContent || '')
    .filter((t) => t.trim() && !/document\.write/i.test(t));

  doc.querySelectorAll('script').forEach((s) => s.remove());
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name);
    }
  }

  const blobToFile = new Map<string, File>();
  const cache = new Map<string, string>();
  const cssTexts: string[] = [];
  const seenCss = new Set<string>();
  const missingCss: string[] = [];

  for (const style of Array.from(doc.querySelectorAll('style'))) {
    if (style.id === 'hy-pick-style') continue;
    const next = await rewriteCss(style.textContent || '', htmlPath, localMap, cache, blobToFile, seenCss, index, htmlPath);
    style.textContent = next;
    if (next.trim()) cssTexts.push(next);
  }

  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"]'))) {
    const href = link.getAttribute('href') || '';
    const css = await fetchCssText(href, index, localMap, htmlPath);
    if (css) {
      const key = basename(href) || href;
      if (!seenCss.has(key)) {
        seenCss.add(key);
        const inlined = await rewriteCss(css, absolutize(htmlPath, href), localMap, cache, blobToFile, seenCss, index, htmlPath);
        const style = doc.createElement('style');
        style.textContent = `/* ${href} */\n${inlined}`;
        cssTexts.push(style.textContent);
        link.replaceWith(style);
      } else {
        link.remove();
      }
    } else if (href.trim()) {
      missingCss.push(href);
      link.remove();
    } else {
      link.remove();
    }
  }

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    rewriteAttr(img, 'src', htmlPath, localMap, cache, blobToFile, index);
    rewriteAttr(img, 'srcset', htmlPath, localMap, cache, blobToFile, index);
  }
  for (const el of Array.from(doc.querySelectorAll('source, video, audio, input[type="image"]'))) {
    rewriteAttr(el, 'src', htmlPath, localMap, cache, blobToFile, index);
    rewriteAttr(el, 'srcset', htmlPath, localMap, cache, blobToFile, index);
    rewriteAttr(el, 'poster', htmlPath, localMap, cache, blobToFile, index);
  }
  for (const el of Array.from(doc.querySelectorAll('image, use'))) {
    rewriteAttr(el, 'href', htmlPath, localMap, cache, blobToFile, index);
    rewriteAttr(el, 'xlink:href', htmlPath, localMap, cache, blobToFile, index);
  }
  for (const el of Array.from(doc.querySelectorAll('[style]'))) {
    const st = el.getAttribute('style');
    if (st && /url\(/i.test(st)) {
      el.setAttribute('style', await rewriteCss(st, htmlPath, localMap, cache, blobToFile, seenCss, index, htmlPath));
    }
  }

  const assetUrlByName: Record<string, string> = {};
  if (index) {
    index.assetsByName.forEach((a, key) => {
      const url = publicAssetUrl(index, a);
      assetUrlByName[key] = url;
      const orig = (a.original_filename || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
      if (orig) assetUrlByName[orig] = url;
    });
  }

  // 原站内页正文常由 JS 注入；预览必须把对应脚本带上，否则是空壳
  const pageScripts: string[] = [];
  const missingJs: string[] = [];
  for (const src of scriptSrcs) {
    const js = await fetchJsText(src, index, localMap, htmlPath);
    if (js) pageScripts.push(`/* ${src} */\n${js}`);
    else missingJs.push(src);
  }
  pageScripts.push(...inlineScripts);
  if (Object.keys(assetUrlByName).length > 0) {
    pageScripts.push(`(function(){
      var map = ${JSON.stringify(assetUrlByName)};
      function fix(u){
        if (!u || /^(https?:|data:|blob:|\\/\\/|\\/sites\\/)/i.test(u)) return u;
        var cleaned = u.split('?')[0].split('#')[0].replace(/^\\.\\//,'').toLowerCase();
        var n = (cleaned.split('/').pop() || '');
        return map[cleaned] || map[n] || u;
      }
      function walk(){
        document.querySelectorAll('img[src],source[src],video[poster]').forEach(function(el){
          var attr = el.hasAttribute('poster') && el.tagName !== 'IMG' ? 'poster' : 'src';
          var next = fix(el.getAttribute(attr) || '');
          if (next) el.setAttribute(attr, next);
        });
      }
      walk();
      new MutationObserver(walk).observe(document.body, { childList: true, subtree: true });
    })();`);
  }
  for (const code of pageScripts) {
    const s = doc.createElement('script');
    s.textContent = code.replace(/<\/script/gi, '<\\/script');
    doc.body.appendChild(s);
  }

  let imageCount = 0;
  blobToFile.forEach((f) => {
    if (IMAGE_RE.test(f.name)) imageCount += 1;
  });

  return {
    htmlPath,
    label: opts.label,
    srcHtml: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    cssTexts,
    blobToFile,
    blobUrls: [...cache.values()],
    cssCount: cssTexts.length,
    imageCount,
    missingCss,
    missingJs,
    assetUrlByName,
  };
}

export function revokePrepared(page: PreparedPage | null) {
  page?.blobUrls.forEach((u) => URL.revokeObjectURL(u));
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('读取失败'));
    r.readAsDataURL(file);
  });
}

/** 插入编辑器：CSS 写入 <style>，图片上传媒体库 */
export async function materializeImportedHtml(opts: {
  html: string;
  cssTexts: string[];
  blobToFile: Map<string, File>;
  uploadImage: (file: File) => Promise<string | null>;
  assetUrlByName?: Record<string, string>;
}): Promise<{ html: string; uploaded: number }> {
  const { html, cssTexts, blobToFile, uploadImage } = opts;
  const cache = new Map<string, string>();
  let uploaded = 0;

  const resolveBlob = async (blobUrl: string): Promise<string> => {
    if (cache.has(blobUrl)) return cache.get(blobUrl)!;
    if (!blobUrl.startsWith('blob:')) return blobUrl;
    const file = blobToFile.get(blobUrl);
    if (!file) return blobUrl;
    const mime = guessMime(file);
    if (mime.startsWith('image/') || IMAGE_RE.test(file.name)) {
      const wrapped = new File([file], file.name, { type: mime.startsWith('image/') ? mime : guessMime(file) });
      try {
        const url = await uploadImage(wrapped);
        if (url) {
          uploaded += 1;
          cache.set(blobUrl, url);
          return url;
        }
      } catch {
        /* 兑底 data URI */
      }
      if (file.size <= 700 * 1024) {
        const data = await fileToDataUrl(file);
        cache.set(blobUrl, data);
        return data;
      }
    }
    if (FONT_RE.test(file.name) && file.size <= 80 * 1024) {
      const data = await fileToDataUrl(file);
      cache.set(blobUrl, data);
      return data;
    }
    cache.set(blobUrl, blobUrl);
    return blobUrl;
  };

  const rewriteBlobs = async (text: string): Promise<string> => {
    const found = [...text.matchAll(/blob:[^\s"'()\\]+/g)].map((m) => m[0]);
    const uniq = [...new Set(found)];
    let out = text;
    for (const b of uniq) {
      const next = await resolveBlob(b);
      if (next !== b) out = out.split(b).join(next);
    }
    return out;
  };

  const css = (await Promise.all(cssTexts.map((t) => rewriteBlobs(t))))
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n\n');
  let body = await rewriteBlobs(html);
  if (opts.assetUrlByName) {
    body = rewriteNamesToAssetUrls(body, opts.assetUrlByName);
  }
  // 站点资源已有 CSS（模板用 HY_SITE_CSS 引入），不再内联写进正文
  return { html: body, uploaded };
}

function rewriteNamesToAssetUrls(html: string, map: Record<string, string>): string {
  return html.replace(/\b(src|href|poster)=["']([^"']+)["']/gi, (full, attr, url) => {
    if (/^(https?:|data:|blob:|\/\/|\/media\/|\/sites\/)/i.test(url)) return full;
    const cleaned = url.split('?')[0].split('#')[0].replace(/^\.\//, '').toLowerCase();
    const name = cleaned.split('/').pop() || '';
    const next = map[cleaned] || map[name];
    if (!next) return full;
    return `${attr}="${next}"`;
  });
}

export function readHtmlFile(file: File): Promise<string> {
  if (!HTML_RE.test(file.name) && file.type !== 'text/html') {
    return Promise.reject(new Error('请选择 .html 文件'));
  }
  return file.text();
}
