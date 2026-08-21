/**
 * aiContext.ts - AI 助手 Context 推断 + Provider (P3.10)
 *
 * Q2C 决策: Hybrid 模式
 * - 默认基于 URL 路由推断 mode (article / template / general)
 * - 特殊页面 (ContentDetail / LayoutEditPage) 可显式 setContext 注入
 *
 * 用法:
 *   - 路由订阅: useRouteAIContext() 在 ContentLayout 顶层调, 路由变就 update mode
 *   - 显式注入: useAIContextInjection({type, target, payload}) 在具体页 useEffect 调
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAIAssistant, type AIMode, type AIContext } from '@/stores/aiAssistant';

// ===== URL → Mode 推断 (Q2A) =====

/**
 * 路径 → 推断的 AI mode
 * - /sites/:id/contents/:cid → article
 * - /sites/:id/layouts/:lid  → template
 * - 其他                       → general
 */
export function inferModeFromPath(pathname: string): AIMode {
  // 文章编辑页
  if (/^\/sites\/[^/]+\/contents\/[^/]+$/.test(pathname)) return 'article';
  // 模板编辑页
  if (/^\/sites\/[^/]+\/layouts\/[^/]+$/.test(pathname)) return 'template';
  // 模板新建页
  if (/^\/sites\/[^/]+\/layouts\/new$/.test(pathname)) return 'template';
  // 文章新建页
  if (/^\/sites\/[^/]+\/contents\/new$/.test(pathname)) return 'article';
  return 'general';
}

// ===== 路由订阅 hook =====

/**
 * 订阅路由变化, 自动同步 mode 到 store
 * 应在 ContentLayout / AppLayout 顶层调一次
 */
export function useRouteAIContext(): AIMode {
  const location = useLocation();
  const mode = useAIAssistant((s) => s.mode);
  const setMode = useAIAssistant((s) => s.setMode);

  useEffect(() => {
    const inferred = inferModeFromPath(location.pathname);
    // 只有在 store 没有显式 context 时才覆盖 mode (避免覆盖页面 setContext)
    setMode(inferred);
  }, [location.pathname, setMode]);

  return mode;
}

// ===== 显式 Context 注入 hook =====

/**
 * 页面级 AI context 注入 (Q2C 的 B 部分)
 *
 * 用法 (ContentDetail.tsx):
 *   useAIContextInjection({
 *     type: 'article',
 *     target: { resourceId: contentId, siteId, title, slug },
 *     payload: { body, html, excerpt },
 *   }, [contentId, body, html]);
 *
 * 路由离开时自动 reset
 */
export function useAIContextInjection(
  ctx: AIContext | null,
  deps: React.DependencyList = [],
): void {
  const setContext = useAIAssistant((s) => s.setContext);
  const reset = useAIAssistant((s) => s.reset);

  useEffect(() => {
    if (ctx) setContext(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    return () => {
      // 路由离开清空 (避免老 context 残留到下个页)
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
