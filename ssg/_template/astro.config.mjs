// @ts-check
import { defineConfig } from 'astro/config';

// 静态站点生成配置
// 产物输出: dist/ (worker 会复制到 /data/sites/{site_id}/public/)
export default defineConfig({
  output: 'static',
  site: process.env.SITE_URL || 'http://localhost',
  build: {
    format: 'directory',
  },
  // 注入 token CSS 变量到每页 <head>
  vite: {
    css: {
      preprocessorOptions: {},
    },
  },
  // SSG 注入 last_build 时间
  compressHTML: true,
});
