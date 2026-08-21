// E2E: 用真实 demo-site 模板 HTML 验证组件
// 目的: 模拟 "模板编辑器加载真实模板" 的场景, 确保组件处理真实数据
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockList = vi.fn();
vi.mock('@/api/siteAssets', () => ({
  siteAssetsApi: { list: (...args: any[]) => mockList(...args) },
}));

import { AssetDependencyCard } from './AssetDependencyCard';

const SITE_ID = '2ea67357-ca1d-4da1-b1c8-f65e17fba8f1';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

// 真实 demo-site 模板 (id=3975642d) 的 HTML
const REAL_DEMO_LAYOUT = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title><HY_SITE_NAME /></title>
  <link rel="icon" href="<HY_SITE_FAVICON />" />
  <link rel="stylesheet" href="/assets/theme.css?v=<HY_THEME_VERSION />" />
  <link rel="stylesheet" href="<HY_ASSET_URL _name="site.css" />" />
  <link rel="stylesheet" href="/admin-extra.css" />
</head>
<body>
  <header class="site-header">
    <div class="container site-header-inner">
      <a href="/" class="site-brand"><HY_SITE_NAME /></a>
      <nav class="site-nav" aria-label="主导航">
        <HY_SITE_MENU _location="header" />
      </nav>
    </div>
  </header>
  <main class="container site-main">__LAYOUT_CONTENT__</main>
  <footer class="site-footer">
    <div class="container site-footer-inner">
      <p class="site-footer-meta"><HY_SITE_COPYRIGHT /></p>
    </div>
  </footer>
  <script src="<HY_ASSET_URL _name="main.js" />"></script>
</body>
</html>`;

describe('<AssetDependencyCard /> E2E with real demo layout', () => {
  beforeEach(() => {
    mockList.mockReset();
    // demo-site 真实情况: 只有 site.css 存在, main.js 已删
    mockList.mockResolvedValue({
      items: [
        { id: '1', site_id: SITE_ID, name: 'site.css', content_type: 'text/css', byte_size: 30, created_at: '', updated_at: '' },
      ],
    });
  });

  it('真实 demo 模板: 1 已绑 (site.css) + 1 缺失 (main.js) + 3 跳过 (/favicon, /theme.css, /admin-extra.css)', async () => {
    render(
      <AssetDependencyCard siteId={SITE_ID} html={REAL_DEMO_LAYOUT} />,
      { wrapper: makeWrapper() }
    );

    // 等加载完成
    await screen.findByText('资源依赖');

    // 1 个已绑
    expect(screen.getByText('site.css')).toBeInTheDocument();
    // 1 个缺失
    expect(screen.getByText('main.js')).toBeInTheDocument();
    expect(screen.getByText('缺失 1 个')).toBeInTheDocument();
    // badge 1/2
    const badge = screen.getByTestId('dep-badge');
    expect(badge.textContent).toBe('1/2');

    // 不应出现 HY_SITE_FAVICON / theme.css / admin-extra.css (因为不在 site_assets)
    expect(screen.queryByText('theme.css')).not.toBeInTheDocument();
    expect(screen.queryByText('admin-extra.css')).not.toBeInTheDocument();
    expect(screen.queryByText('HY_SITE_FAVICON')).not.toBeInTheDocument();
  });

  it('all bound: 0 缺失 (all assets exist)', async () => {
    mockList.mockResolvedValue({
      items: [
        { id: '1', site_id: SITE_ID, name: 'site.css', content_type: 'text/css', byte_size: 30, created_at: '', updated_at: '' },
        { id: '2', site_id: SITE_ID, name: 'main.js', content_type: 'application/javascript', byte_size: 100, created_at: '', updated_at: '' },
      ],
    });
    render(
      <AssetDependencyCard siteId={SITE_ID} html={REAL_DEMO_LAYOUT} />,
      { wrapper: makeWrapper() }
    );

    await screen.findByText('资源依赖');
    expect(screen.getByText('site.css')).toBeInTheDocument();
    expect(screen.getByText('main.js')).toBeInTheDocument();
    expect(screen.queryByText(/缺失 \d+/)).not.toBeInTheDocument();
    const badge = screen.getByTestId('dep-badge');
    expect(badge.textContent).toBe('2/2');
  });

  it('all missing: all N 个缺失警告', async () => {
    mockList.mockResolvedValue({ items: [] });  // 站点 0 资源
    render(
      <AssetDependencyCard siteId={SITE_ID} html={REAL_DEMO_LAYOUT} />,
      { wrapper: makeWrapper() }
    );

    await screen.findByText('资源依赖');
    expect(screen.getByText('缺失 2 个')).toBeInTheDocument();
    const badge = screen.getByTestId('dep-badge');
    expect(badge.textContent).toBe('0/2');
  });
});
