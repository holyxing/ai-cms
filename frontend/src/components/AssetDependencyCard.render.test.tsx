// 真实组件渲染测试 (P3.6.4 验收)
// 用 @testing-library/react 验证组件交互和状态
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// mock siteAssetsApi.list 返预设数据
const mockList = vi.fn();
vi.mock('@/api/siteAssets', () => ({
  siteAssetsApi: {
    list: (...args: any[]) => mockList(...args),
  },
}));

import { AssetDependencyCard } from './AssetDependencyCard';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const SITE_ID = 'site-1';

describe('<AssetDependencyCard />', () => {
  beforeEach(() => {
    mockList.mockReset();
    // 默认返 site.css + main.js 两个已存在资源
    mockList.mockResolvedValue({
      items: [
        { id: '1', site_id: SITE_ID, name: 'site.css', content_type: 'text/css', byte_size: 100, created_at: '', updated_at: '' },
        { id: '2', site_id: SITE_ID, name: 'main.js', content_type: 'application/javascript', byte_size: 200, created_at: '', updated_at: '' },
      ],
    });
  });

  it('demo 模板: 渲染 site.css + main.js 已绑, 0 缺失', async () => {
    render(
      <AssetDependencyCard siteId={SITE_ID} html={`<link rel="stylesheet" href="<HY_ASSET_URL _name="site.css" />" />
<script src="<HY_ASSET_URL _name="main.js" />"></script>`} />,
      { wrapper: makeWrapper() }
    );

    expect(await screen.findByText('资源依赖')).toBeInTheDocument();
    expect(screen.getByText('site.css')).toBeInTheDocument();
    expect(screen.getByText('main.js')).toBeInTheDocument();
    // 2 个已绑, 0 缺失
    const badge = await screen.findByTestId('dep-badge');
    expect(badge.textContent).toBe('2/2');
    expect(screen.queryByText(/缺失 \d+/)).not.toBeInTheDocument();
  });

  it('空模板: 渲染空态文案', async () => {
    render(<AssetDependencyCard siteId={SITE_ID} html="<html><body>hi</body></html>" />, { wrapper: makeWrapper() });
    expect(await screen.findByText(/未引用任何资源/)).toBeInTheDocument();
  });

  it('缺失资源: 渲染 ⚠ 警告 + 缺失 N 个 + 黄底', async () => {
    render(<AssetDependencyCard siteId={SITE_ID} html='<link href="missing.css">' />, { wrapper: makeWrapper() });
    expect(await screen.findByText('missing.css')).toBeInTheDocument();
    expect(screen.getByText('缺失 1 个')).toBeInTheDocument();
    // 黄底样式 (amber-50 是缺失的标记)
    const row = screen.getByText('missing.css').closest('div');
    expect(row?.className).toMatch(/amber/);
  });

  it('已绑 + 缺失 混合', async () => {
    render(
      <AssetDependencyCard siteId={SITE_ID} html={`<link rel="stylesheet" href="<HY_ASSET_URL _name="site.css" />">
<link href="missing.css">`} />,
      { wrapper: makeWrapper() }
    );
    expect(await screen.findByText('site.css')).toBeInTheDocument();
    expect(screen.getByText('missing.css')).toBeInTheDocument();
    const badge = screen.getByTestId('dep-badge');
    expect(badge.textContent).toBe('1/2');
    expect(screen.getByText('缺失 1 个')).toBeInTheDocument();
  });

  it('管理资源 链接存在', async () => {
    render(<AssetDependencyCard siteId={SITE_ID} html="<html></html>" />, { wrapper: makeWrapper() });
    const link = await screen.findByText(/管理资源/);
    expect(link.closest('a')).toHaveAttribute('href', `/sites/${SITE_ID}/assets`);
  });
});
