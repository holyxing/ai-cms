// P3.6.4: 资源缺失确认对话框组件测试
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MissingAssetsDialog, type MissingAsset } from './MissingAssetsDialog';

const SITE_ID = 'site-1';

function makeWrapper() {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter>{children}</MemoryRouter>
  );
}

const MOCK_MISSING: MissingAsset[] = [
  { name: 'main.js', source: 'hy', layout_id: 'L1', layout_code: 'site', layout_scope: 'site' },
  { name: 'main.js', source: 'hy', layout_id: 'L2', layout_code: 'home', layout_scope: 'home' },
  { name: 'logo.svg', source: 'link', layout_id: 'L1', layout_code: 'site', layout_scope: 'site' },
];

describe('<MissingAssetsDialog />', () => {
  it('打开状态: 列出缺失资源 + 强制发布按钮', () => {
    const onClose = vi.fn();
    const onForce = vi.fn();
    render(
      <MissingAssetsDialog
        open={true}
        onClose={onClose}
        onForcePublish={onForce}
        siteId={SITE_ID}
        missing={MOCK_MISSING}
      />,
      { wrapper: makeWrapper() }
    );
    // 标题
    expect(screen.getByText(/发现 3 个缺失资源/)).toBeInTheDocument();
    // 资源名 (去重后 2 个)
    expect(screen.getByText('main.js')).toBeInTheDocument();
    expect(screen.getByText('logo.svg')).toBeInTheDocument();
    // 强制发布按钮
    expect(screen.getByRole('button', { name: '强制发布' })).toBeInTheDocument();
  });

  it('关闭状态: 不渲染', () => {
    const { container } = render(
      <MissingAssetsDialog
        open={false}
        onClose={vi.fn()}
        onForcePublish={vi.fn()}
        siteId={SITE_ID}
        missing={MOCK_MISSING}
      />,
      { wrapper: makeWrapper() }
    );
    expect(container.textContent).toBe('');
  });

  it('同资源被多 layout 引用 → 列表去重 + 显示所有 layout', () => {
    render(
      <MissingAssetsDialog
        open={true}
        onClose={vi.fn()}
        onForcePublish={vi.fn()}
        siteId={SITE_ID}
        missing={MOCK_MISSING}
      />,
      { wrapper: makeWrapper() }
    );
    // main.js 在 2 个 layout 引用 (L1=site, L2=home)
    expect(screen.getAllByText(/site \(site\)|home \(home\)/).length).toBe(2);
  });

  it('点击「强制发布」触发 onForcePublish', () => {
    const onForce = vi.fn();
    render(
      <MissingAssetsDialog
        open={true}
        onClose={vi.fn()}
        onForcePublish={onForce}
        siteId={SITE_ID}
        missing={MOCK_MISSING}
      />,
      { wrapper: makeWrapper() }
    );
    screen.getByRole('button', { name: '强制发布' }).click();
    expect(onForce).toHaveBeenCalledOnce();
  });

  it('点击「取消」触发 onClose', () => {
    const onClose = vi.fn();
    render(
      <MissingAssetsDialog
        open={true}
        onClose={onClose}
        onForcePublish={vi.fn()}
        siteId={SITE_ID}
        missing={MOCK_MISSING}
      />,
      { wrapper: makeWrapper() }
    );
    screen.getByRole('button', { name: '取消' }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('「打开资源管理」链接指向 /sites/{id}/assets', () => {
    render(
      <MissingAssetsDialog
        open={true}
        onClose={vi.fn()}
        onForcePublish={vi.fn()}
        siteId={SITE_ID}
        missing={MOCK_MISSING}
      />,
      { wrapper: makeWrapper() }
    );
    const link = screen.getByText('打开资源管理');
    expect(link.closest('a')).toHaveAttribute('href', `/sites/${SITE_ID}/assets`);
  });

  it('isForcing=true: 按钮变 "发布中…" 且 disabled', () => {
    render(
      <MissingAssetsDialog
        open={true}
        onClose={vi.fn()}
        onForcePublish={vi.fn()}
        siteId={SITE_ID}
        missing={MOCK_MISSING}
        isForcing={true}
      />,
      { wrapper: makeWrapper() }
    );
    const btn = screen.getByRole('button', { name: '发布中…' });
    expect(btn).toBeDisabled();
  });
});
