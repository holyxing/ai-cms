/**
 * AISiteModals.tsx - 站点操作 Modal 集 (P3.10.3)
 *
 * holy xing 反馈: 之前 dashboard "创建新站点" 走 site_agent 多轮反问体验很啰嗦.
 * 修法: 点站点快捷卡后直接弹表单/确认, 不走 AI 流程, 一次点完事.
 * - 创建新站点 → CreateSiteModal (表单 name+slug+可选 desc+logo, 直接调 sitesApi.create)
 * - 重命名当前站点 → EditSiteModal (表单 name+desc+logo 预填, 调 sitesApi.update)
 * - 全量发布当前站点 → ConfirmPublishModal (一行确认, 调 publishApi.publish)
 *
 * 多轮 site_agent 路径保留为"AI 优化"按钮, 备选入口.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Save, Rocket, AlertTriangle, Loader2, X } from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import { Button, Input, Textarea, Modal } from '@/components/ui';
import { cn } from '@/lib/utils';
import { sitesApi, type Site, type SiteCreatePayload, type SiteUpdatePayload } from '@/api/sites';
import { publishApi } from '@/api/publish';
import { toast } from 'sonner';

// ============================================================
// 创建新站点 Modal
// ============================================================

export interface CreateSiteModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (site: Site) => void;
}

function slugifyName(name: string): string {
  if (!name.trim()) return '';
  // P3.6.2 决策: pinyin-pro 配 toneType:'none', v:true (保留数字/字母)
  const arr = pinyin(name, { toneType: 'none', type: 'array', v: true, nonZh: 'consecutive' });
  return arr
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export const CreateSiteModal: React.FC<CreateSiteModalProps> = ({ open, onClose, onCreated }) => {
  const navigate = useNavigate();
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [description, setDescription] = React.useState('');
  const [logoUrl, setLogoUrl] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  // 名字变 → 自动推 slug (没手动改过时)
  React.useEffect(() => {
    if (!slugTouched) setSlug(slugifyName(name));
  }, [name, slugTouched]);

  // 关闭重置
  React.useEffect(() => {
    if (!open) {
      setName(''); setSlug(''); setSlugTouched(false);
      setDescription(''); setLogoUrl(''); setSubmitting(false);
    }
  }, [open]);

  const slugValid = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug);
  const canSubmit = !!name.trim() && !!slug && slugValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const payload: SiteCreatePayload = {
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || undefined,
      logo_url: logoUrl.trim() || undefined,
    };
    try {
      const site = await sitesApi.create(payload);
      toast.success(`已创建站点「${site.name}」`);
      onCreated?.(site);
      onClose();
      // 跳到新站点的栏目管理
      navigate(`/c/${site.id}`);
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || '创建失败';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="max-w-lg"
      title={
        <div className="flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 text-primary" />
          <span>创建新站点</span>
        </div>
      }
      description="必填名称和 slug, 其他可后续在站点设置里补充"
    >
      <div className="flex flex-col gap-3 p-4">
        <Field label="名称" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如: 公司官网"
            maxLength={128}
            autoFocus
          />
        </Field>
        <Field label="URL Slug" required hint={slugValid ? '' : '只能小写字母、数字、连字符'}>
          <Input
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
            placeholder="如: company-site"
            maxLength={64}
            className={cn(!slugValid && slug && 'border-rose-500')}
          />
          {slug && (
            <div className="mt-1 text-[10.5px] text-muted-foreground">
              站点 URL: <span className="font-mono">/c/{slug}</span>
            </div>
          )}
        </Field>
        <Field label="描述" hint="可选, 一句话说明站点用途">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="如: 公司对外展示与产品介绍"
            rows={2}
            maxLength={1000}
            className="text-[12px]"
          />
        </Field>
        <Field label="Logo URL" hint="可选, 留空可后补">
          <Input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://..."
          />
        </Field>
        <div className="flex items-center justify-end gap-2 border-t pt-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-primary hover:bg-primary/90"
          >
            {submitting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
            创建
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// ============================================================
// 编辑当前站点 Modal (重命名 + 改描述/logo)
// ============================================================

export interface EditSiteModalProps {
  open: boolean;
  onClose: () => void;
  site: Site | null;        // 当前站点 (从 dashboard 传进来)
  onUpdated?: (site: Site) => void;
}

export const EditSiteModal: React.FC<EditSiteModalProps> = ({ open, onClose, site, onUpdated }) => {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [logoUrl, setLogoUrl] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  // 打开时同步当前站点
  React.useEffect(() => {
    if (open && site) {
      setName(site.name);
      setDescription(site.description ?? '');
      setLogoUrl(site.logo_url ?? '');
    }
  }, [open, site]);

  React.useEffect(() => {
    if (!open) { setSubmitting(false); }
  }, [open]);

  const canSubmit = !!name.trim() && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !site) return;
    setSubmitting(true);
    const payload: SiteUpdatePayload = {
      name: name.trim(),
      description: description.trim() || null,
      logo_url: logoUrl.trim() || null,
    };
    try {
      const updated = await sitesApi.update(site.id, payload);
      toast.success(`已更新「${updated.name}」`);
      onUpdated?.(updated);
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '更新失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="max-w-lg"
      title={
        <div className="flex items-center gap-1.5">
          <Save className="h-3.5 w-3.5 text-primary" />
          <span>编辑当前站点</span>
        </div>
      }
      description="修改名称、描述、Logo (Slug 改 URL 风险大, 需到站点设置)"
    >
      <div className="flex flex-col gap-3 p-4">
        <Field label="名称" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={128}
            autoFocus
          />
        </Field>
        <Field label="描述" hint="可选">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={1000}
            className="text-[12px]"
          />
        </Field>
        <Field label="Logo URL" hint="可选, 留空可后补">
          <Input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://..."
          />
        </Field>
        <div className="flex items-center justify-end gap-2 border-t pt-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-primary hover:bg-primary/90"
          >
            {submitting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
            保存
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// ============================================================
// 全量发布确认 Modal
// ============================================================

export interface ConfirmPublishModalProps {
  open: boolean;
  onClose: () => void;
  site: Site | null;
}

export const ConfirmPublishModal: React.FC<ConfirmPublishModalProps> = ({ open, onClose, site }) => {
  const [submitting, setSubmitting] = React.useState(false);
  const canSubmit = !!site && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const r = await publishApi.publish(site!.id);
      toast.success(`已触发全量发布, 任务 ${r.id.slice(0, 8)} 正在跑`);
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '发布失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="max-w-md"
      title={
        <div className="flex items-center gap-1.5">
          <Rocket className="h-3.5 w-3.5 text-primary" />
          <span>全量发布</span>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2 text-[11.5px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
          <div>
            将对 <span className="font-medium">{site?.name ?? '当前站点'}</span> 触发全量静态构建,
            耗时通常 30 秒 - 数分钟, 期间站点可能不可用.
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t pt-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-primary hover:bg-primary/90"
          >
            {submitting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1 h-3.5 w-3.5" />}
            确认发布
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// ============================================================
// Field 包装
// ============================================================

const Field: React.FC<{ label: string; required?: boolean; hint?: string; children: React.ReactNode }> = ({ label, required, hint, children }) => (
  <div className="space-y-1">
    <label className="text-[11px] font-medium text-muted-foreground">
      {label}
      {required && <span className="ml-0.5 text-rose-500">*</span>}
    </label>
    {children}
    {hint && <div className="text-[10.5px] text-muted-foreground/80">{hint}</div>}
  </div>
);
