/**
 * 资源依赖检测卡 (P3.6.4)
 *
 * 扫描模板 HTML 中的资源引用, 跟站点已上传的 site_assets 交叉对比, 列出:
 *   - ✓ 已绑定: 可点击跳到 SiteAssets 编辑
 *   - ⚠ 缺失: 警告用户该资源不存在, 发布后会 404
 *
 * 检测 3 种引用形式:
 *   1. <link rel="stylesheet" href="site.css">
 *   2. <script src="main.js"></script>
 *   3. <HY_ASSET_URL _name="x" /> (或 name="x", 或假装 attr)
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, Badge } from '@/components/ui';
import { Boxes, Link2, AlertTriangle, CheckCircle2, FileCode2, Loader2 } from 'lucide-react';
import { siteAssetsApi, type SiteAsset } from '@/api/siteAssets';

// 资源引用类型
interface RefItem {
  name: string;          // 文件名 (e.g. "site.css")
  source: 'link' | 'script' | 'hy';  // 来源
  attr: string;          // 原始 attr 字符串
  start: number;         // html 里的位置 (用于 highlighting)
}

// === 提取 ===

// 匹配 <link ... href="..."> 里的 href 值, 但排除嵌套的 <HY_ASSET_URL>
// 嵌套场景: <link href="<HY_ASSET_URL _name='x' />" /> — 顶层 link 的 href 其实是 "<HY_ASSET_URL _name='x' />"
// 这种顶层 link 我们不检测, 让下面独立的 HY_ASSET_RE 识别
const LINK_HREF_RE = /<link\b[^>]*?href=["']([^"']*?)["'][^>]*>/gi;
const SCRIPT_SRC_RE = /<script\b[^>]*?src=["']([^"']*?)["'][^>]*>/gi;
// HY_ASSET_URL 三种形式: _name="x" / name="x" / 假装 attr <HY_ASSET_URL x />
const HY_ASSET_RE = /<HY_ASSET_URL\b([^>]*?)\s*\/?>/gi;
const HY_NAME_RE = /(?:\b_name|\bname)\s*=\s*["']([^"']+)["']/i;
// P3.6.5+: <HY_SITE_CSS /> / <HY_SITE_JS /> 一键全目录标签
// 扫 _include="a,b,c" 里的具体名字 (跟后端 precheck 一致)
// _exclude="x" 也报 (告诉用户这个被排除, 别误以为丢了)
const HY_SITE_TAG_RE = /<HY_SITE_(CSS|JS)\b([^>]*?)\s*\/?>/gi;
const HY_INCLUDE_RE = /\b_include\s*=\s*["']([^"']*)["']/i;
const HY_EXCLUDE_RE = /\b_exclude\s*=\s*["']([^"']*)["']/i;
// 假装 attr 提取: 接受 attrs 字符串 (去前导空格)
const HY_PSEUDO_RE = /^\s*([A-Za-z0-9._-]+)\s*$/;

// 从一个 ref 字符串里提取 "有效资源名"
// 支持: "site.css"  /  "<HY_ASSET_URL _name='x' />"  /  "/foo/site.css?v=1"
function extractAssetName(ref: string): string | null {
  let s = ref.trim();
  // 嵌套 HY_ASSET_URL (在 href="..." 内部)
  // 先尝试 _name="x" 或 name='x' 形式 (跟 HY_NAME_RE 一致)
  const hyMatch = s.match(HY_NAME_RE);
  if (hyMatch) {
    const name = hyMatch[1];
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) ? name : null;
  }
  // 假装 attr: <HY_ASSET_URL x /> (裸 token, 不能是 _name= 这种)
  const topMatch = s.match(/^<HY_ASSET_URL\s+([A-Za-z0-9._-]+)/i);
  if (topMatch) {
    const name = topMatch[1];
    // 不能是 _name / name 这种属性名伪装的
    if (name !== '_name' && name !== 'name') {
      return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) ? name : null;
    }
  }
  // 去掉 query/hash
  s = s.split('?')[0].split('#')[0];
  // 绝对路径 / cdn / data: → 跳过
  if (/^(\/|https?:|data:)/i.test(s)) return null;
  // 只允许文件名 (无路径分隔符)
  if (s.includes('/')) return null;
  // 必须是合法资源名
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(s)) return null;
  return s;
}

function extractReferences(html: string): RefItem[] {
  const out: RefItem[] = [];
  const seen = new Set<string>();

  const push = (item: RefItem) => {
    const key = `${item.source}:${item.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  };

  let m: RegExpExecArray | null;

  // 1. <link href="...">
  LINK_HREF_RE.lastIndex = 0;
  while ((m = LINK_HREF_RE.exec(html))) {
    // 跳过 href 是 HY_ASSET_URL 嵌套的情况 (会被 #3 抓到, 避免重复)
    if (m[1].includes('<HY_ASSET_URL')) continue;
    // P3.7.5++: 跳过 HY_ 开头的占位符 (例: href="HY_PAGE_URL"), 不是真资源名
    if (/^HY_[A-Z_]+$/.test(m[1].trim())) continue;
    const name = extractAssetName(m[1]);
    if (name) push({ name, source: 'link', attr: m[0].slice(0, 60), start: m.index });
  }

  // 2. <script src="...">
  SCRIPT_SRC_RE.lastIndex = 0;
  while ((m = SCRIPT_SRC_RE.exec(html))) {
    if (m[1].includes('<HY_ASSET_URL')) continue;
    if (/^HY_[A-Z_]+$/.test(m[1].trim())) continue;
    const name = extractAssetName(m[1]);
    if (name) push({ name, source: 'script', attr: m[0].slice(0, 60), start: m.index });
  }

  // 3. <HY_ASSET_URL ...> (顶层或嵌套在 href/src 内, 都识别)
  HY_ASSET_RE.lastIndex = 0;
  while ((m = HY_ASSET_RE.exec(html))) {
    const attrs = m[1];
    const namedMatch = attrs.match(HY_NAME_RE);
    const pseudoMatch = attrs.match(HY_PSEUDO_RE);
    const name = namedMatch?.[1] || pseudoMatch?.[1];
    if (name && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
      push({ name, source: 'hy', attr: m[0].slice(0, 60), start: m.index });
    }
  }

  // 4. P3.6.5+: <HY_SITE_CSS _include="a,b" /> / <HY_SITE_JS _exclude="x" />
  // 跟后端 publish_precheck 一致, 只扫白名单/黑名单里**点名的具体名字**
  HY_SITE_TAG_RE.lastIndex = 0;
  while ((m = HY_SITE_TAG_RE.exec(html))) {
    const attrs = m[2];
    const which = m[1].toUpperCase(); // CSS / JS
    const inc = attrs.match(HY_INCLUDE_RE);
    const exc = attrs.match(HY_EXCLUDE_RE);
    if (inc) {
      for (const raw of inc[1].split(',')) {
        const name = raw.trim();
        if (name && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
          push({ name, source: 'hy', attr: `HY_SITE_${which} _include="${inc[1]}"`, start: m.index });
        }
      }
    }
    if (exc) {
      for (const raw of exc[1].split(',')) {
        const name = raw.trim();
        if (name && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
          push({ name, source: 'hy', attr: `HY_SITE_${which} _exclude="${exc[1]}"`, start: m.index });
        }
      }
    }
  }

  return out;
}

// 导出以便单测
export { extractReferences, extractAssetName };

// === 组件 ===

export interface AssetDependencyCardProps {
  siteId: string;
  html: string;                  // 当前编辑的模板 HTML
  compact?: boolean;            // 紧凑模式 (LayoutEditPage 右侧栏用)
}

export function AssetDependencyCard({ siteId, html, compact }: AssetDependencyCardProps) {
  const refs = useMemo(() => extractReferences(html || ''), [html]);
  const assetsQ = useQuery({
    queryKey: ['site-assets', siteId],
    queryFn: () => siteAssetsApi.list(siteId).catch(() => ({ items: [], total: 0, page: 1, page_size: 0 })),
  });

  if (assetsQ.isLoading) {
    return (
      <div className="p-3.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          加载资源列表…
        </div>
      </div>
    );
  }

  const assetNames = new Set((assetsQ.data?.items || []).map((a: SiteAsset) => a.name));
  const missing = refs.filter((r) => !assetNames.has(r.name));
  const bound = refs.filter((r) => assetNames.has(r.name));
  const total = refs.length;

  return (
    <div className={compact ? "p-3.5 space-y-2" : "p-4 space-y-2.5"}>
        <div className="flex items-center justify-between">
          <p className={compact ? "text-[11px] font-medium flex items-center gap-1.5" : "text-xs font-medium flex items-center gap-1.5"}>
            <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
            资源依赖
            {total > 0 && (
              <Badge variant="outline" className="text-[10px] ml-1" data-testid="dep-badge">
                {bound.length}/{total}
              </Badge>
            )}
          </p>
          <Link
            to={`/sites/${siteId}/assets`}
            className="text-[10px] text-primary hover:underline"
          >
            管理资源 →
          </Link>
        </div>

        {total === 0 ? (
          <p className="text-[10.5px] text-muted-foreground italic">
            模板中未引用任何资源 (无 &lt;link&gt; / &lt;script&gt; / &lt;HY_ASSET_URL&gt;)。
          </p>
        ) : (
          <div className="space-y-1">
            {bound.length > 0 && (
              <ul className="space-y-0.5">
                {bound.map((r) => (
                  <DependencyRow key={`b-${r.source}-${r.name}`} item={r} siteId={siteId} />
                ))}
              </ul>
            )}
            {missing.length > 0 && (
              <>
                <p className="text-[10px] text-amber-700 font-medium flex items-center gap-1 pt-1">
                  <AlertTriangle className="h-3 w-3" />
                  缺失 {missing.length} 个
                </p>
                <ul className="space-y-0.5">
                  {missing.map((r) => (
                    <DependencyRow key={`m-${r.source}-${r.name}`} item={r} missing />
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
    </div>
  );
}

function DependencyRow({ item, siteId, missing }: {
  item: RefItem;
  siteId?: string;
  missing?: boolean;
}) {
  const Icon = item.source === 'link' ? Link2 : item.source === 'script' ? FileCode2 : Boxes;
  const sourceLabel = item.source === 'link' ? 'CSS' : item.source === 'script' ? 'JS' : 'HY';
  const inner = (
    <div className={`
      flex items-center gap-1.5 px-1.5 py-1 rounded text-[10.5px] font-mono
      ${missing
        ? 'bg-amber-50 text-amber-900 border border-amber-200'
        : 'hover:bg-muted/50 text-foreground'
      }
    `}>
      {missing ? (
        <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
      ) : (
        <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
      )}
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate flex-1" title={item.name}>{item.name}</span>
      <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">
        {sourceLabel}
      </span>
    </div>
  );

  if (missing || !siteId) return inner;
  return (
    <Link to={`/sites/${siteId}/assets`} className="block" title="跳到资源管理">
      {inner}
    </Link>
  );
}
