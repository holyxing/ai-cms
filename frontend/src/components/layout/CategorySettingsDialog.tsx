import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { pinyin } from 'pinyin-pro';
import { X as XIcon } from 'lucide-react';

import { categoriesApi, type CategoryNode } from '@/api/categories';
import { Button, Input, Label } from '@/components/ui';

function slugifyCategoryName(name: string): string {
  const asciiSafe = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .trim();

  let pinyinStr = '';
  if (/[\u4e00-\u9fa5]/.test(asciiSafe)) {
    pinyinStr = pinyin(asciiSafe, {
      toneType: 'none',
      type: 'array',
      v: true,
      nonZh: 'consecutive',
    }).join('');
  } else {
    pinyinStr = asciiSafe;
  }

  return pinyinStr.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'cat';
}

export function CategorySettingsDialog({
  open,
  category,
  siteId,
  onClose,
  onSaved,
}: {
  open: boolean;
  category: (CategoryNode & { children?: CategoryNode[] }) | null;
  siteId: string;
  onClose: () => void;
  onSaved: (cat: Partial<CategoryNode>) => void;
}) {
  const [name, setName] = useState(category?.name || '');
  const [slug, setSlug] = useState(category?.slug || '');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState(category?.description || '');
  const [template, setTemplate] = useState(category?.template || 'default');
  const [contentTemplate, setContentTemplate] = useState(category?.content_template || 'default');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && category) {
      setName(category.name);
      setSlug(category.slug);
      setSlugTouched(false);
      setDescription(category.description || '');
      setTemplate(category.template || 'default');
      setContentTemplate(category.content_template || 'default');
      setError('');
    }
  }, [open, category]);

  useEffect(() => {
    if (!slugTouched) setSlug(slugifyCategoryName(name));
  }, [name, slugTouched]);

  const templatesQ = useQuery({
    queryKey: ['category-templates', siteId],
    queryFn: () => categoriesApi.listTemplates(siteId, 'category'),
    enabled: open && !!siteId,
    staleTime: 60_000,
  });

  const contentTemplatesQ = useQuery({
    queryKey: ['content-templates', siteId],
    queryFn: () => categoriesApi.listTemplates(siteId, 'content'),
    enabled: open && !!siteId,
    staleTime: 60_000,
  });

  const saveMut = useMutation({
    mutationFn: () =>
      categoriesApi.update(category!.id, {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        template,
        content_template: contentTemplate,
      }),
    onSuccess: (c) => {
      onSaved(c);
      onClose();
    },
    onError: (e: any) => setError(e?.message || '保存失败'),
  });

  if (!open || !category) return null;
  const validSlug = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim());
  const templates = templatesQ.data ?? [];
  const contentTemplates = contentTemplatesQ.data ?? [];
  const currentTemplate = templates.find((t) => t.code === template);
  const currentContentTemplate = contentTemplates.find((t) => t.code === contentTemplate);
  const isNewsTemplate = template === 'news-list';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold">栏目设置</h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <XIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            if (!name.trim() || !validSlug || !template || !contentTemplate) {
              setError('名称、slug、栏目模板、详情模板均必填');
              return;
            }
            saveMut.mutate();
          }}
          className="space-y-3 p-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="cs-name" className="text-xs font-medium">名称 *</Label>
            <Input id="cs-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cs-slug" className="text-xs font-medium">Slug *</Label>
            <div className="flex items-stretch overflow-hidden rounded-md border focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
              <span className="flex items-center border-r bg-secondary/40 px-2 font-mono text-xs text-muted-foreground select-none">/</span>
              <input
                id="cs-slug"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value.toLowerCase());
                  setSlugTouched(true);
                }}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="公司介绍 → gongsijieshao"
                className="h-9 flex-1 bg-background px-2 text-sm font-mono focus:outline-none placeholder:text-muted-foreground/60"
              />
              {slugTouched && (
                <button
                  type="button"
                  onClick={() => {
                    setSlug(slugifyCategoryName(name));
                    setSlugTouched(false);
                  }}
                  title="从名称重新生成拼音"
                  className="border-l px-2 text-[11px] text-blue-600 transition-colors hover:bg-blue-50"
                >
                  重新生成
                </button>
              )}
            </div>
            {slug.trim() && validSlug ? (
              <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                <span>预览:</span>
                <code className="text-foreground/80">/{slug.trim()}/</code>
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">只能含小写字母、数字、连字符</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cs-desc" className="text-xs font-medium">描述</Label>
            <Input id="cs-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">栏目模板 *</Label>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {templates.length === 0 && (
                <>
                  <option value="default">默认列表</option>
                  <option value="news-list">新闻资讯</option>
                </>
              )}
              {templates.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}{t.is_default ? ' (默认)' : ''}
                </option>
              ))}
            </select>
            {currentTemplate && <p className="text-[10px] text-muted-foreground">代码：<code className="font-mono">{currentTemplate.code}</code></p>}
            {isNewsTemplate && (
              <div className="rounded-md border border-blue-200 bg-blue-50/50 px-3 py-2 text-[11px] text-blue-700">
                新闻资讯模式：该栏目将作为新闻聚合页发布，下属内容需要 <strong>封面图</strong> 才能在卡片上完整展示。
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">详情模板 *</Label>
            <select
              value={contentTemplate}
              onChange={(e) => setContentTemplate(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {contentTemplates.length === 0 && <option value="default">默认详情</option>}
              {contentTemplates.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}{t.is_default ? ' (默认)' : ''}
                </option>
              ))}
            </select>
            {currentContentTemplate && <p className="text-[10px] text-muted-foreground">代码：<code className="font-mono">{currentContentTemplate.code}</code></p>}
          </div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="h-8 text-xs">取消</Button>
            <Button type="submit" disabled={saveMut.isPending} className="h-8 text-xs">
              {saveMut.isPending ? '保存中...' : '保存'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
