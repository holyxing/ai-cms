// SiteSwitcher.tsx - 顶部站点切换器 (P2.8 D1, Q2B + OQ1)
// 依据: docs/17-站点树重构.md §5.5
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Globe, Star, FileCode, Image as ImageIcon, Rocket, Boxes, Eye, ScrollText } from 'lucide-react';
import { publishApi } from '@/api/publish';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { sitesApi, type SiteListItem } from '@/api/sites';
import { useRecentSites } from '@/stores/recentSites';
import { useTabsStore } from '@/stores/tabs';
import { cn } from '@/lib/utils';
import { watchDeploymentForNotifications } from '@/lib/notificationsSync';

interface Props {
  /** 当前选中的 site id */
  value: string | null;
  /** 选中回调 */
  onChange: (siteId: string) => void;
  /** 紧凑模式 (放顶栏) */
  compact?: boolean;
}

export function SiteSwitcher({ value, onChange, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  // P3.7.2+ 发布站点 confirm dialog 状态 (提升到顶层, 避免下拉关闭后 state 丢失)
  const [publishAsk, setPublishAsk] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.openTab);
  const recents = useRecentSites((s) => s.sites);
  const pushRecent = useRecentSites((s) => s.push);

  // 拉可访问站点列表
  const { data } = useQuery({
    queryKey: ['sites', 'active'] as const,
    queryFn: () => sitesApi.list({ page: 1, page_size: 100, status: 'active' }).catch(() => ({ items: [], total: 0, page: 1, page_size: 0 })),
  });

  const sites = data?.items ?? [];
  const current = sites.find((s) => s.id === value);

  // 点外面关闭
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleSelect = (site: SiteListItem) => {
    onChange(site.id);
    pushRecent({ id: site.id, slug: site.slug, name: site.name });
    setOpen(false);
  };

  // 分割: 最近访问 vs 全部 (P3.6+ dedup by name, 同名站只显示一个, 保留最新访问的)
  // 背景: 用户可能同时有 "霍因科技 (生产)" + "霍因科技 (demo)" 同名站, UI 仅显示 1 个避免迷惑
  // 提醒: 完整去重应在后端, 这是前端兑底
  const recentSites: SiteListItem[] = [];
  const recentNames = new Set<string>();  // name 键
  const recentIds = new Set<string>();   // id 键, 供 otherSites 过滤
  for (const r of recents) {
    if (recentNames.has(r.name)) continue;  // 同名只保留首个 (recents 是 visitedAt desc 顺序)
    const s = sites.find((x) => x.id === r.id);
    if (s) {
      recentNames.add(s.name);
      recentIds.add(s.id);
      recentSites.push(s);
    }
  }
  // 全部站点也 dedup by name
  const otherNames = new Set<string>(recentNames);
  const otherIds = new Set<string>(recentIds);
  const otherSites = sites.filter((s) => {
    if (otherIds.has(s.id)) return false;
    if (otherNames.has(s.name)) return false;
    otherNames.add(s.name);
    otherIds.add(s.id);
    return true;
  });

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-border bg-background text-sm transition-colors hover:bg-secondary/50',
          compact ? 'h-7 px-2 text-[12px]' : 'h-8 px-2.5 text-[13px]'
        )}
      >
        <Globe className={cn('text-blue-600', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} strokeWidth={2} />
        <span className="max-w-[160px] truncate font-medium">
          {current?.name ?? '选择站点'}
        </span>
        <ChevronDown className={cn('text-muted-foreground', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} strokeWidth={2} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-popover shadow-md ring-1 ring-border">
          {/* 最近 */}
          {recentSites.length > 0 && (
            <div className="p-1">
              <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                最近访问
              </div>
              {recentSites.map((s) => (
                <SiteOption
                  key={`r-${s.id}`}
                  site={s}
                  selected={s.id === value}
                  star
                  onClick={() => handleSelect(s)}
                />
              ))}
            </div>
          )}

          {/* 全部 */}
          {otherSites.length > 0 && (
            <div className="border-t p-1">
              {recentSites.length > 0 && (
                <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  全部站点
                </div>
              )}
              {otherSites.map((s) => (
                <SiteOption
                  key={s.id}
                  site={s}
                  selected={s.id === value}
                  onClick={() => handleSelect(s)}
                />
              ))}
            </div>
          )}

          {/* 空态 */}
          {sites.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">
              暂无可访问站点
            </div>
          )}

          {/* 分隔 + 当前站点快捷功能 (P3.7.2 方案 B: 导航菜单功能已删除) */}
          {value && (
            <div className="border-t p-1">
              <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                当前站点功能
              </div>
              <button
                onClick={() => {
                  setOpen(false);
                  openTab({ pathname: '/layouts', search: '', title: '模板管理' });
                  navigate('/layouts');
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-secondary/80"
              >
                <FileCode className="h-3.5 w-3.5 text-blue-600" strokeWidth={2} />
                模板管理
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  const to = `/sites/${value}/media`;
                  openTab({ pathname: to, search: '', title: '媒体库' });
                  navigate(to);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-secondary/80"
              >
                <ImageIcon className="h-3.5 w-3.5 text-blue-600" strokeWidth={2} />
                媒体库
              </button>
              {/* P3.7.5++++ 站点资源 (CSS/JS/字体/Logo, holy 反馈 #10394) */}
              <button
                onClick={() => {
                  setOpen(false);
                  const to = `/sites/${value}/assets`;
                  openTab({ pathname: to, search: '', title: '站点资源' });
                  navigate(to);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-secondary/80"
              >
                <Boxes className="h-3.5 w-3.5 text-blue-600" strokeWidth={2} />
                站点资源
              </button>
              {/* P3.7.2+ 发布站点 (holy 反馈 #9892): 站点下拉里直接触发站点发布 */}
              <button
                onClick={() => { setOpen(false); setPublishAsk(true); }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-secondary/80"
              >
                <Rocket className="h-3.5 w-3.5 text-blue-600" strokeWidth={2} />
                发布站点
              </button>
              {current?.slug && (
                <a
                  href={`/sites/${current.slug}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  title="在新窗口打开已发布站点"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-secondary/80"
                >
                  <Eye className="h-3.5 w-3.5 text-blue-600" strokeWidth={2} />
                  预览站点
                </a>
              )}
              <button
                onClick={() => {
                  setOpen(false);
                  const to = `/sites/${value}/deploy-log`;
                  openTab({ pathname: to, search: '', title: '发布日志' });
                  navigate(to);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-secondary/80"
              >
                <ScrollText className="h-3.5 w-3.5 text-blue-600" strokeWidth={2} />
                发布日志
              </button>
            </div>
          )}

          {/* 分隔 + 新建 */}
          <div className="border-t p-1">
            <button
              onClick={() => {
                setOpen(false);
                navigate('/sites');
              }}
              className="w-full rounded-sm px-2 py-1.5 text-left text-[12px] text-blue-600 transition-colors hover:bg-blue-50"
            >
              管理所有站点 →
            </button>
          </div>
        </div>
      )}

      {/* P3.7.2+ 发布站点 confirm dialog (独立于下拉状态, 避免 state 丢失) */}
      {value && (
        <PublishSiteConfirmDialog
          siteId={value}
          siteSlug={current?.slug}
          ask={publishAsk}
          onClose={() => setPublishAsk(false)}
        />
      )}
    </div>
  );
}

function SiteOption({
  site,
  selected,
  star = false,
  onClick,
}: {
  site: SiteListItem;
  selected: boolean;
  star?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] transition-colors',
        selected ? 'bg-blue-50 text-blue-700' : 'hover:bg-secondary/80'
      )}
    >
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-secondary text-[10px] font-medium text-muted-foreground">
        {site.name.charAt(0)}
      </span>
      <span className="flex-1 truncate">{site.name}</span>
      {star && <Star className="h-3 w-3 text-amber-500" fill="currentColor" strokeWidth={0} />}
      {selected && <Check className="h-3.5 w-3.5 text-blue-600" strokeWidth={2.5} />}
    </button>
  );
}

// P3.7.2+: 站点下拉的「发布站点」 confirm dialog
// ask 状态在 SiteSwitcher 顶层, 不受下拉 open 状态影响 (避灮下拉关后 state 丢失)
function PublishSiteConfirmDialog({
  siteId, siteSlug, ask, onClose,
}: {
  siteId: string;
  siteSlug?: string;
  ask: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const previewUrl = siteSlug ? `/sites/${siteSlug}/` : undefined;
  const mut = useMutation({
    mutationFn: () => publishApi.trigger(siteId, { force: true }),
    onSuccess: (r) => {
      toast.success(`发布已入队: ${r.deployment_id.slice(0, 8)}…`, {
        duration: 6000,
        action: previewUrl
          ? {
              label: '预览',
              onClick: () => window.open(previewUrl, '_blank', 'noopener,noreferrer'),
            }
          : undefined,
      });
      watchDeploymentForNotifications(r.deployment_id);
      queryClient.invalidateQueries({ queryKey: ['site-detail', siteId] });
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || '发布失败');
    },
  });
  if (!ask) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => !mut.isPending && onClose()}>
      <div
        className="w-[360px] rounded-lg border border-border bg-card p-4 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <Rocket className="h-4 w-4 text-blue-600" />
          <h3 className="text-[14px] font-semibold">发布站点</h3>
        </div>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          将对当前站点执行增量构建, 生成最新静态产物。构建通常需要 5-30 秒。
          <br />
          <span className="text-[11px]">force=true: 跳过资源缺失等阻断性检查</span>
        </p>
        {previewUrl && (
          <p className="mt-2 truncate text-[11px] text-muted-foreground">
            发布后预览：
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 text-blue-600 hover:underline"
            >
              {previewUrl}
            </a>
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={mut.isPending}
            className="h-7 rounded-md border border-border bg-background px-3 text-[12px] font-medium text-foreground hover:bg-secondary disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={() => {
              mut.mutate();
              onClose();
            }}
            disabled={mut.isPending}
            className="h-7 rounded-md bg-blue-600 px-3 text-[12px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {mut.isPending ? '入队中…' : '确认发布'}
          </button>
        </div>
      </div>
    </div>
  );
}
