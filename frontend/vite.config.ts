import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { PluginOption } from 'vite';
import path from 'path';
import http from 'node:http';

/**
 * 彻底清除 vite dev 模式下的 HMR 注入。
 *
 * 背景: 在 docker + nginx 反代下,vite 的 HMR WebSocket
 * 端点（ws://localhost:5173/）几乎不可能走通,会报一堆 console 错。
 * 现阶段以 "页面能跑" 为优先, 不要 HMR, 保存后手动刷新。
 *
 * 两件事:
 * 1) /@vite/client 路径返 noop ESM, 只提供 _vite_createHotContext / updateStyle / removeStyle
 *    这些 noop 函数, 不建 WebSocket
 * 2) transform 钩子在 vite 内置 transform 之后, 抠掉任何:
 *    `import { createHotContext as __vite__createHotContext } from "/@vite/client";`
 *    `import.meta.hot = __vite__createHotContext("...");`
 *    `import { updateStyle as __vite__updateStyle, removeStyle as __vite__removeStyle } from "/@vite/client";`
 *    以及 import.meta.hot.accept() / .prune() / .acceptExports() 等
 */
const disableHmrPlugin: PluginOption = {
  name: 'disable-hmr',
  configureServer(server) {
    // P3.9.1+: 显式加 /api/ proxy middleware, 修 P3.7.2+ 留的 vite proxy 不生效 bug
    // 现象: 之前 server.proxy = { '/api/': ... } 配了但 SPA fallback 抢先把 /api/* 返 index.html
    // 修: 在最早 middleware 拦截 /api/ 用 http-proxy-middleware (或手写) 走 api:8000
    server.middlewares.use((req, res, next) => {
      if (!req.url || !req.url.startsWith('/api/')) return next();
      const opts = {
        hostname: 'api',
        port: 8000,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: 'api:8000' },
      };
      const proxyReq = http.request(opts, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', (e) => {
        console.error('[api-proxy] error:', e.message);
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 50200, message: 'API proxy error: ' + e.message, data: null }));
      });
      req.pipe(proxyReq);
    });

    // P3.9.4 (holy 反馈 #12044): 代理 /media/ 到 MinIO (跟 nginx 行为一致)
    // 原因: vite dev 不代理 /media/, 浏览器 fetch MinIO url (相对路径) 会返 SPA index.html
    // (application/octet-stream MIME 探测失败) → 复制图片 fetch blob().type 变 text/html
    // 修: 跟 nginx 一样, 代理 /media/ 到 minio:9000, 改 Host 匹配 presigned 签名
    server.middlewares.use((req, res, next) => {
      if (!req.url || !req.url.startsWith('/media/')) return next();
      const opts = {
        hostname: 'minio',
        port: 9000,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: 'minio:9000' },
      };
      const proxyReq = http.request(opts, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', (e) => {
        console.error('[media-proxy] error:', e.message);
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'media proxy error: ' + e.message }));
      });
      req.pipe(proxyReq);
    });

    server.middlewares.use((req, res, next) => {
      if (req.url !== '/@vite/client') return next();
      // 返回一个 noop ESM 模块, 提供 vite 在 css/js 里用到的所有函数
      const body = `// @vite/client noop (HMR disabled, docker/nginx setup)
const ctxCache = new Map();
function createHotContext(ownerPath) {
  let ctx = ctxCache.get(ownerPath);
  if (ctx) return ctx;
  ctx = {
    accept: () => {},
    acceptDeps: () => {},
    acceptEager: () => {},
    acceptExports: () => {},
    decline: () => {},
    dispose: () => {},
    prune: () => {},
    invalidate: () => {},
    on: () => {},
    off: () => {},
    send: () => {},
    data: new Map(),
  };
  ctxCache.set(ownerPath, ctx);
  return ctx;
}
function updateStyle(id, css) {
  let el = document.querySelector('style[data-vite-dev-id="' + id + '"]');
  if (!el) {
    el = document.createElement('style');
    el.setAttribute('data-vite-dev-id', id);
    document.head.appendChild(el);
  }
  el.textContent = css;
}
function removeStyle(id) {
  const el = document.querySelector('style[data-vite-dev-id="' + id + '"]');
  if (el) el.remove();
}
function injectQuery(url, queryToInject) {
  return url + (url.includes('?') ? '&' : '?') + String(queryToInject).replace(/^&/, '');
}
class ErrorOverlay extends HTMLElement {
  constructor(err) { super(); }
  connectedCallback() {}
}
export { createHotContext, updateStyle, removeStyle, injectQuery, ErrorOverlay };
`;
      res.setHeader('content-type', 'application/javascript');
      res.setHeader('cache-control', 'no-store, must-revalidate');
      res.setHeader('content-length', Buffer.byteLength(body));
      res.end(body);
    });
  },
  // 在 vite 内置 transform 之后跑, 抠掉 HMR 注入
  // 关键: 要保留 __vite__updateStyle() (这是把 CSS 注入页面的调用)
  //      保留 createHotContext / updateStyle / removeStyle 的 import
  // 只抠掉: import.meta.hot.xxx(...) / WebSocket 相关的副作用
  transform: {
    order: 'post',
    handler(code, id) {
      if (!code.includes('import.meta.hot')) return null;
      let out = code;
      // 1) import.meta.hot = __vite__createHotContext("...");  (热更心跳)
      out = out.replace(
        /import\.meta\.hot\s*=\s*__vite__createHotContext\([^)]*\)\s*;?/g,
        '',
      );
      // 2) import.meta.hot.accept(...) / .prune(...) / .acceptExports(...) / .acceptDeps(...) / .decline(...)
      //    用平衡括号手工扫描, 避免被 .prune(() => ...) 里嵌套的 () 干扰
      out = stripBalancedCalls(out, /import\.meta\.hot\.[a-zA-Z]+/g);
      return out;
    },
  },
};

/**
 * 从字符串里删掉所有 `pattern.exec(...)` 调用 (括号平衡).
 * 例如 pattern = /import\.meta\.hot\.[a-zA-Z]+/g
 * 会删掉  import.meta.hot.prune(() => x.y(z))  (整个调用, 含内层括号)
 */
function stripBalancedCalls(src: string, pattern: RegExp): string {
  let out = '';
  let last = 0;
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(src)) !== null) {
    const start = m.index;
    out += src.slice(last, start);
    // 从 m.index + m[0].length 往后扫, 跳过空白
    let i = start + m[0].length;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '(') {
      // 不是函数调用, 不处理
      out += m[0];
      last = start + m[0].length;
      continue;
    }
    // 平衡括号扫描
    let depth = 0;
    let inStr: string | null = null;
    let j = i;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (inStr) {
        if (ch === '\\') { j++; continue; }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) { j++; break; }
      }
    }
    // 跳过尾部空白和分号
    while (j < src.length && (src[j] === ';' || /\s/.test(src[j]))) j++;
    last = j;
  }
  out += src.slice(last);
  return out;
}

export default defineConfig({
  plugins: [react(), disableHmrPlugin],
  // base 留空:HTML 资源路径为 /src/main.tsx, /favicon.svg
  // nginx /admin/ location 用 rewrite 去掉 /admin 前缀转发给 vite
  // P3.6.5 注: base 不能设成 /admin/ (会让 vite 给所有 .tsx 路径加 /admin/ 前缀
  //             但 nginx 那边 /src/ 路径不代理到 vite, 出错). 改用 <base href="/admin/">
  //             + 相对路径 + nginx 额外代理裸 /src/ 路径.
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // nginx 反代时 vite 会检查 Host header,允许任意 host
    allowedHosts: true,
    // P3.9.1+: vite 5 SPA fallback 会抢在 server.proxy 之前, 改用 plugin middleware
    // (在 disableHmrPlugin.configureServer 里) 拦截 /api/ → http://api:8000
    // P3.7.2+ 留的 bug: server.proxy = { '/api/': ... } 配了但返 SPA index.html
    // P3.9.1+ 改: 注释掉 server.proxy, 走 plugin middleware
    // proxy: {
    //   '/api/': {
    //     target: 'http://api:8000',
    //     changeOrigin: true,
    //   },
    // },
    // 临时禁用 HMR,避免 ws://localhost:5173 连不通的问题
    // (Docker 容器 + nginx 反代 场景下 HMR 路由复杂,MVP 阶段可以手动刷新)
    hmr: false,
    // 保留 watch 能力,文件改了保存后手动刷新页面即可
    watch: {
      // 不监听 node_modules 等
      ignored: ['**/node_modules/**', '**/dist/**'],
    },
    // 允许任意 host (dev 环境)
    cors: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
