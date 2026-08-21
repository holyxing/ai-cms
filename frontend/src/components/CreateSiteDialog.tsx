// CreateSiteDialog.tsx - 新建站点对话框 (P3.6+ 抽出复用)
// 来源: pages/Sites.tsx CreateDialog (P2.9 D1 整页砍了, 但 dialog 组件保留)
// 用法: const [open, setOpen] = useState(false);
//       <CreateSiteDialog open={open} onClose={()=>setOpen(false)} onCreated={(id)=>navigate(`/c/${id}`)} />
//
// P3.6+ 优化: 新站自动建根栏目 + 推 recents + 跳到新栏目页 (避免 "栏目不存在" 红 toast)
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sitesApi, type SiteCreatePayload } from '@/api/sites';
import { categoriesApi } from '@/api/categories';
import { Button, Input, Label } from '@/components/ui';

interface CreateSiteDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (siteId: string, categoryId: string) => void;
}

export function CreateSiteDialog({ open, onClose, onCreated }: CreateSiteDialogProps) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // 串行: 建站 → 建根栏目 → 推 recents → 跳到新栏目页
  const createMut = useMutation({
    mutationFn: async (payload: SiteCreatePayload) => {
      const site = await sitesApi.create(payload);
      try {
        const cat = await categoriesApi.create(site.id, {
          name: '默认栏目',
          slug: 'default',
          parent_id: null,
        });
        return { site, cat };
      } catch (e) {
        // 根栏目建失败不阻塞 — 站已建好, 用户可手动建
        console.warn('[CreateSite] 默认栏目创建失败', e);
        return { site, cat: null };
      }
    },
    onSuccess: ({ site, cat }) => {
      setSlug('');
      setName('');
      setDescription('');
      onCreated(site.id, cat?.id ?? site.id);  // 兜底: 没栏目就跳 site id (老 UX)
      onClose();
    },
  });

  if (!open) return null;

  const canSubmit = slug.trim() && name.trim() && !createMut.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background shadow-lg">
        <div className="border-b px-5 py-3">
          <h2 className="text-sm font-semibold">新建站点</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">一个独立的内容站点</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) {
              createMut.mutate({
                slug: slug.trim(),
                name: name.trim(),
                description: description.trim() || undefined,
              });
            }
          }}
          className="space-y-3 p-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="create-site-slug" className="text-xs font-medium">
              Slug <span className="text-muted-foreground">*</span>
            </Label>
            <Input
              id="create-site-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="my-blog"
              required
              autoFocus
              className="h-9 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">URL 标识, 只能小写字母/数字/连字符</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-site-name" className="text-xs font-medium">
              名称 <span className="text-muted-foreground">*</span>
            </Label>
            <Input
              id="create-site-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="我的博客"
              required
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-site-desc" className="text-xs font-medium">
              描述
            </Label>
            <Input
              id="create-site-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话介绍这个站点"
              className="h-9 text-sm"
            />
          </div>
          {createMut.isError && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {(createMut.error as Error)?.message || '创建失败, 请重试'}
            </p>
          )}
          {createMut.isPending && (
            <p className="text-[11px] text-muted-foreground">
              正在创建站点 + 默认栏目, 请稍候...
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="h-8 text-xs" disabled={createMut.isPending}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit} className="h-8 text-xs">
              {createMut.isPending ? '创建中...' : '创建'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
