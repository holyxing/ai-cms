import { describe, it, expect } from 'vitest';
import { extractReferences, extractAssetName } from './AssetDependencyCard';

describe('extractAssetName', () => {
  it('接受简单文件名', () => {
    expect(extractAssetName('site.css')).toBe('site.css');
    expect(extractAssetName('main.js')).toBe('main.js');
    expect(extractAssetName('logo.svg')).toBe('logo.svg');
  });

  it('去掉 query / hash', () => {
    expect(extractAssetName('main.css?v=1')).toBe('main.css');
    expect(extractAssetName('app.js#hash')).toBe('app.js');
  });

  it('拒绝绝对路径 / cdn / data:', () => {
    expect(extractAssetName('https://cdn.x.com/style.css')).toBeNull();
    expect(extractAssetName('//cdn.x.com/lib.js')).toBeNull();
    expect(extractAssetName('/static/main.css')).toBeNull();
    expect(extractAssetName('data:image/png;base64,...')).toBeNull();
  });

  it('拒绝含路径分隔符的', () => {
    expect(extractAssetName('css/site.css')).toBeNull();
    expect(extractAssetName('./site.css')).toBeNull();
  });

  it('拒绝非法名字', () => {
    expect(extractAssetName('site css')).toBeNull();  // 空格
    expect(extractAssetName('site.css\'')).toBeNull();
  });

  it('识别嵌套 HY_ASSET_URL', () => {
    expect(extractAssetName('<HY_ASSET_URL _name="x.css" />')).toBe('x.css');
    expect(extractAssetName("<HY_ASSET_URL name='y.js' />")).toBe('y.js');
    expect(extractAssetName('<HY_ASSET_URL z.svg />')).toBe('z.svg');
  });
});

describe('extractReferences', () => {
  it('demo-site 真实模板: 识别 site.css + main.js, 跳过 /admin-extra.css', () => {
    const html = `<link rel="stylesheet" href="<HY_ASSET_URL _name="site.css" />" />
<link rel="stylesheet" href="/admin-extra.css" />
<script src="<HY_ASSET_URL _name="main.js" />"></script>`;
    const refs = extractReferences(html);
    const names = refs.map((r) => `${r.source}:${r.name}`).sort();
    expect(names).toEqual(['hy:main.js', 'hy:site.css']);
  });

  it('空模板 → 0 引用', () => {
    expect(extractReferences('<html><body>hello</body></html>')).toEqual([]);
  });

  it('纯相对名 link/script', () => {
    const html = '<link href="theme.css"><link href="main.css">';
    const refs = extractReferences(html);
    expect(refs.map((r) => r.name)).toEqual(['theme.css', 'main.css']);
    expect(refs.every((r) => r.source === 'link')).toBe(true);
  });

  it('script 走 source=script', () => {
    const html = '<script src="app.js"></script>';
    const refs = extractReferences(html);
    expect(refs[0].source).toBe('script');
  });

  it('HY_ASSET_URL 3 种形式', () => {
    const html = '<HY_ASSET_URL _name="a.css" /><HY_ASSET_URL name=\'b.js\' /><HY_ASSET_URL c.svg />';
    const refs = extractReferences(html);
    expect(refs.map((r) => r.name)).toEqual(['a.css', 'b.js', 'c.svg']);
  });

  it('HY_SITE_FAVICON 不识别 (HY_ 但不是 ASSET_URL)', () => {
    const html = '<link href="<HY_SITE_FAVICON />">';
    expect(extractReferences(html)).toEqual([]);
  });

  it('嵌套 HY_ASSET_URL 不重复 (link 和 hy 各只 1 次)', () => {
    const html = '<link href="<HY_ASSET_URL _name="x.css" />">';
    const refs = extractReferences(html);
    expect(refs).toHaveLength(1);
    expect(refs[0].source).toBe('hy');
  });

  it('混合场景: 嵌套 HY + 纯相对名 + 缺失', () => {
    const html = `
      <link href="<HY_ASSET_URL _name="site.css" />">
      <link href="missing.css">
      <HY_ASSET_URL _name="main.js" />
    `;
    const refs = extractReferences(html);
    const names = refs.map((r) => `${r.source}:${r.name}`).sort();
    expect(names).toEqual(['hy:main.js', 'hy:site.css', 'link:missing.css']);
  });

  it('去重: 同一资源引用多次只出现 1 次', () => {
    const html = '<link href="site.css"><link href="site.css"><link href="site.css">';
    const refs = extractReferences(html);
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe('site.css');
  });

  it('真实 demo 模板 (含 HY_SITE_FAVICON / admin-extra.css / theme.css 不识别)', () => {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <link rel="icon" href="<HY_SITE_FAVICON />" />
  <link rel="stylesheet" href="/assets/theme.css?v=<HY_THEME_VERSION />" />
  <link rel="stylesheet" href="<HY_ASSET_URL _name="site.css" />" />
  <link rel="stylesheet" href="/admin-extra.css" />
</head>
<body>
  <script src="<HY_ASSET_URL _name="main.js" />"></script>
</body>
</html>`;
    const refs = extractReferences(html);
    const names = refs.map((r) => `${r.source}:${r.name}`).sort();
    expect(names).toEqual(['hy:main.js', 'hy:site.css']);
  });

  // P3.6.5+: <HY_SITE_CSS /> / <HY_SITE_JS /> 一键标签
  describe('HY_SITE_CSS / HY_SITE_JS', () => {
    it('HY_SITE_CSS _include 列出白名单具体名字', () => {
      const refs = extractReferences('<HY_SITE_CSS _include="style.css,responsive.css" />');
      const names = refs.map((r) => r.name).sort();
      expect(names).toEqual(['responsive.css', 'style.css']);
    });

    it('HY_SITE_JS _exclude 列出黑名单具体名字', () => {
      const refs = extractReferences('<HY_SITE_JS _exclude="analytics.js" />');
      expect(refs.map((r) => r.name)).toEqual(['analytics.js']);
    });

    it('混合 _include + _exclude 两次出现都列', () => {
      const refs = extractReferences(
        '<HY_SITE_CSS _include="a.css,b.css" _exclude="b.css" />',
      );
      const names = refs.map((r) => r.name).sort();
      expect(names).toEqual(['a.css', 'b.css']);
    });

    it('无 _include/_exclude → 不产生引用 (跟后端 precheck 一致)', () => {
      const refs = extractReferences('<HY_SITE_CSS /><HY_SITE_JS />');
      expect(refs).toEqual([]);
    });

    it('所有引用都标 source=hy', () => {
      const refs = extractReferences('<HY_SITE_CSS _include="style.css" />');
      expect(refs[0].source).toBe('hy');
    });
  });
});
