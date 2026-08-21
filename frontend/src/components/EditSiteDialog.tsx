// EditSiteDialog.tsx - 编辑站点 dialog (P3.6.5 重设计)
// 依据: docs/06-设计系统.md (左编辑右预览, 实时反映, 紧凑信息密度)
//
// P3.6.5 改版:
// - 上半 Live 预览: 实时反映 name/slug/desc/logo 变化
// - 下半双栏编辑: 左侧"基本信息" (name + desc), 右侧"URL 与封面" (slug + logo)
// - 底部 sticky 操作条 + 改动计数 + 重置
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Save,
  Globe,
  AlertCircle,
  RotateCcw,
  ImageIcon,
  Hash,
  Type,
  AlignLeft,
  Sparkles,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button, Input, Label } from '@/components/ui';
import { sitesApi, type SiteListItem, type SiteUpdatePayload } from '@/api/sites';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  site: SiteListItem | null;
  onClose: () => void;
  onSaved?: (updated: SiteListItem) => void;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const URL_RE = /^https?:\/\/.+/;

const TYPE_LABELS = {
  all: '全部',
  published: '已发布',
  out_sync: '待同步',
  failed: '失败',
  never_published: '未发布',
} as const;

export function EditSiteDialog({ open, site, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // 打开时从 site 加载
  useEffect(() => {
    if (open && site) {
      setName(site.name);
      setSlug(site.slug);
      setDescription(site.description ?? '');
      setLogoUrl(site.logo_url ?? '');
      setError('');
    }
  }, [open, site]);

  const initial = useMemo(
    () => ({
      name: site?.name ?? '',
      slug: site?.slug ?? '',
      description: site?.description ?? '',
      logoUrl: site?.logo_url ?? '',
    }),
    [site],
  );

  // 改动检测
  const changes = useMemo(() => {
    if (!site) return [] as { key: keyof typeof initial; label: string }[];
    const out: { key: keyof typeof initial; label: string }[] = [];
    if (name !== initial.name) out.push({ key: 'name', label: '名称' });
    if (slug !== initial.slug) out.push({ key: 'slug', label: 'Slug' });
    if (description !== initial.description) out.push({ key: 'description', label: '描述' });
    if (logoUrl !== initial.logoUrl) out.push({ key: 'logoUrl', label: '封面' });
    return out;
  }, [site, name, slug, description, logoUrl, initial]);

  const hasChanges = changes.length > 0;

  // 校验
  const validations = useMemo(() => {
    return {
      name: name.trim().length > 0 && name.trim().length <= 128,
      slug: SLUG_RE.test(slug.trim()),
      description: description.length <= 500,
      logoUrl: !logoUrl.trim() || URL_RE.test(logoUrl.trim()),
    };
  }, [name, slug, description, logoUrl]);

  const allValid = validations.name && validations.slug && validations.description && validations.logoUrl;

  const handleSave = async () => {
    if (!site) return;
    if (!allValid) {
      const first = !validations.name
        ? '名称不能为空'
        : !validations.slug
          ? 'slug 格式不正确'
          : !validations.logoUrl
            ? '封面图 URL 必须以 http(s):// 开头'
            : '描述过长';
      setError(first);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload: SiteUpdatePayload = {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || null,
        logo_url: logoUrl.trim() || null,
      };
      const updated = await sitesApi.update(site.id, payload);
      qc.invalidateQueries({ queryKey: ['sites'] });
      toast.success(`站点 "${updated.name}" 已更新`);
      onSaved?.(updated as SiteListItem);
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || '保存失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setName(initial.name);
    setSlug(initial.slug);
    setDescription(initial.description);
    setLogoUrl(initial.logoUrl);
    setError('');
  };

  if (!site) return null;

  // 预览用的"占位数据" (实时反映)
  const previewInitial = (name || site.name || '?').trim()[0]?.toUpperCase() || '?';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-600">
            <Sparkles className="h-4 w-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
              编辑站点
              {hasChanges && (
                <span className="inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                  {changes.length} 项改动
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] font-normal text-muted-foreground">
              修改后实时预览, 满意后点击保存
            </div>
          </div>
        </div>
      }
      maxWidth="max-w-3xl"
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* 左: 编辑区 (3 列) */}
        <div className="space-y-3 lg:col-span-3">
          {/* 基本信息 */}
          <section className="rounded-lg border bg-secondary/30 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Type className="h-3 w-3" strokeWidth={2} />
              基本信息
            </div>
            <div className="space-y-2.5">
              {/* 名称 */}
              <div className="space-y-1">
                <Label htmlFor="es-name" className="text-[11px] font-medium">
                  站点名称
                  <span className="ml-1 text-red-500">*</span>
                </Label>
                <Input
                  id="es-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例: 霍因科技"
                  className="h-8 text-[13px]"
                  maxLength={128}
                  disabled={saving}
                />
              </div>
              {/* 描述 */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="es-desc" className="text-[11px] font-medium">
                    描述
                  </Label>
                  <span
                    className={cn(
                      'text-[10px] tabular-nums',
                      description.length > 450 ? 'text-amber-600' : 'text-muted-foreground',
                    )}
                  >
                    {description.length} / 500
                  </span>
                </div>
                <textarea
                  id="es-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="站点的简要介绍 (可选, 留空不显示)"
                  rows={3}
                  maxLength={500}
                  disabled={saving}
                  className="flex w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px] leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                />
              </div>
            </div>
          </section>

          {/* URL 与封面 */}
          <section className="rounded-lg border bg-secondary/30 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Hash className="h-3 w-3" strokeWidth={2} />
              URL 与封面
            </div>
            <div className="space-y-2.5">
              {/* Slug */}
              <div className="space-y-1">
                <Label htmlFor="es-slug" className="text-[11px] font-medium">
                  Slug (URL 标识)
                  <span className="ml-1 text-red-500">*</span>
                </Label>
                <div className="flex items-stretch overflow-hidden rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
                  <span className="flex shrink-0 items-center bg-secondary/60 px-2 text-[12px] text-muted-foreground font-mono">
                    /{'\u200B'}
                  </span>
                  <input
                    id="es-slug"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                    placeholder="my-site-slug"
                    maxLength={64}
                    disabled={saving}
                    className="h-8 flex-1 bg-transparent px-2 text-[13px] font-mono placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
                  />
                </div>
                {slug && !validations.slug && (
                  <p className="text-[10px] text-red-600">格式: 小写字母/数字/连字符 (例: my-site-2026)</p>
                )}
              </div>
              {/* Logo URL */}
              <div className="space-y-1">
                <Label htmlFor="es-logo" className="text-[11px] font-medium">
                  封面图 URL
                </Label>
                <div className="flex gap-1.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-secondary/40">
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
                    )}
                  </div>
                  <Input
                    id="es-logo"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://... (可选, 留空不显示)"
                    className="h-8 flex-1 text-[13px] font-mono"
                    disabled={saving}
                  />
                </div>
                {logoUrl && !validations.logoUrl && (
                  <p className="text-[10px] text-red-600">需以 http:// 或 https:// 开头</p>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* 右: 实时预览 (2 列) */}
        <div className="space-y-2 lg:col-span-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Globe className="h-3 w-3" strokeWidth={2} />
            实时预览
          </div>
          <div className="rounded-lg border bg-background p-3 shadow-sm">
            {/* 模拟 SiteCard 头 */}
            <div className="rounded-md bg-blue-50 px-3 py-2.5">
              <div className="flex items-center gap-2">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={name}
                    className="h-7 w-7 rounded-md border border-primary/30 bg-card object-cover"
                  />
                ) : (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-card text-xs font-medium text-primary">
                    {previewInitial}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium leading-tight">
                    {name || (
                      <span className="text-muted-foreground/50 italic">站点名称</span>
                    )}
                  </div>
                  <code className="text-[10px] text-muted-foreground">/{slug || 'slug'}</code>
                </div>
              </div>
            </div>
            {/* 描述 */}
            <div className="mt-2 line-clamp-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
              {description || (
                <span className="italic text-muted-foreground/50">暂无描述</span>
              )}
            </div>
            {/* 元信息条 */}
            <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded border bg-border text-center">
              <div className="bg-background py-1.5">
                <div className="text-[10px] text-muted-foreground">文章</div>
                <div className="text-[12px] font-semibold tabular-nums">
                  {site.content_count ?? 0}
                </div>
              </div>
              <div className="bg-background py-1.5">
                <div className="text-[10px] text-muted-foreground">栏目</div>
                <div className="text-[12px] font-semibold tabular-nums">
                  {site.category_count ?? 0}
                </div>
              </div>
            </div>
            <div className="mt-2 px-1 text-[10px] text-muted-foreground">
              预览样式与列表卡片保持一致
            </div>
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mt-3 flex items-start gap-1.5 rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5 text-[12px] text-red-700">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 底部 sticky 操作条 */}
      <div className="sticky bottom-0 -mx-6 mt-4 flex items-center justify-between gap-2 border-t bg-background px-6 py-2.5">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {hasChanges ? (
            <>
              <span>已改: {changes.map((c) => c.label).join('、')}</span>
              <button
                type="button"
                onClick={handleReset}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded text-blue-600 transition-colors hover:bg-blue-50 px-1.5 py-0.5 disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" strokeWidth={2} />
                重置
              </button>
            </>
          ) : (
            <span>未做任何修改</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !allValid || !hasChanges}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? '保存中...' : '保存修改'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
