/**
 * CreateCategoryDialog - 新建栏目 (P3.6.2)
 *
 * 字段 (用户要求):
 * - 名称 (name)        必填
 * - 发布目录名 (slug)  必填, 默认从 name 自动转拼音 (公司动态→gongsidongtai), 可手动改
 * - 栏目模板 (template)        必填
 * - 详情模板 (contentTemplate) 必填
 *
 * 父栏目: 用 props.parentId 控制 (根/子两种调用方式)
 *
 * 样式对齐: 与 CategoryContent.tsx 的 CategorySettingsDialog 保持完全一致
 * - 同样的 dialog 容器 (fixed inset-0 + 自定义 panel)
 * - 同样的 header 风格 (border-b px-5 py-3, title text-sm)
 * - 同样的表单间距 (space-y-3 p-5)
 * - 同样的 label/input 字号 (text-xs / h-9 text-sm)
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X as XIcon, FolderTree } from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import { Button, Input, Label } from '@/components/ui';
import { categoriesApi } from '@/api/categories';
import { toast } from 'sonner';

export interface CreateCategoryDialogProps {
  open: boolean;
  onClose: () => void;
  siteId: string;
  parentId: string | null;
  parentName?: string;
  onCreated?: (cat: { id: string; name: string }) => void;
}

function slugify(name: string): string {
  // 中文 → 拼音 (无声调, 小写, 不分段)
  // 例: "公司动态" → "gongsidongtai", "Hello World" → "hello-world"
  const asciiSafe = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .trim();

  // 先把中文转拼音
  let pinyinStr = '';
  if (/[\u4e00-\u9fa5]/.test(asciiSafe)) {
    pinyinStr = pinyin(asciiSafe, {
      toneType: 'none',     // 不要声调数字
      type: 'array',         // 返回单词数组而非整串
      v: true,               // 使用 v 代替 ü
      nonZh: 'consecutive',  // 非中文连续保留 (英文/数字原样)
    }).join('');
  } else {
    pinyinStr = asciiSafe;
  }

  // 清理: 只留小写字母数字, 中间空白转连字符
  return pinyinStr
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || `cat-${Date.now()}`;
}

export function CreateCategoryDialog({
  open, onClose, siteId, parentId, parentName, onCreated,
}: CreateCategoryDialogProps) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [template, setTemplate] = useState('default');
  const [contentTemplate, setContentTemplate] = useState('default');
  const [err, setErr] = useState('');

  // 拉可选模板 (scope=category)
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

  // 重置
  useEffect(() => {
    if (open) {
      setName('');
      setSlug('');
      setSlugTouched(false);
      setTemplate('default');
      setContentTemplate('default');
      setErr('');
    }
  }, [open]);

  // name 改 → 自动推 slug (除非用户已改)
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  const createMut = useMutation({
    mutationFn: () =>
      categoriesApi.create(siteId, {
        name: name.trim(),
        slug: slug.trim(),
        parent_id: parentId,
        template,
        content_template: contentTemplate,
      }),
    onSuccess: (c) => {
      toast.success(`栏目 "${c.name}" 已创建`);
      qc.invalidateQueries({ queryKey: ['category-tree', siteId] });
      onCreated?.({ id: c.id, name: c.name });
      onClose();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || '创建失败';
      setErr(msg);
      toast.error(msg);
    },
  });

  if (!open) return null;

  const trimmedSlug = slug.trim();
  const trimmedName = name.trim();
  const slugEmpty = trimmedSlug.length === 0;
  const slugFormatOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(trimmedSlug);
  const slugInvalid = !slugEmpty && !slugFormatOk;
  const templates = templatesQ.data ?? [];
  const contentTemplates = contentTemplatesQ.data ?? [];
  const currentTemplate = templates.find((t) => t.code === template);
  const currentContentTemplate = contentTemplates.find((t) => t.code === contentTemplate);
  const canSubmit = trimmedName.length > 0
    && !slugEmpty
    && slugFormatOk
    && !!template
    && !!contentTemplate
    && !createMut.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background shadow-lg">
        {/* Header — 与栏目设置完全一致 */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold">新建栏目</h2>
            {parentName ? (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10.5px] font-medium text-blue-700">
                子栏目 · {parentName}
              </span>
            ) : (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                顶级栏目
              </span>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <XIcon className="h-3.5 w-3.5" />
          </Button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setErr('');
            if (!canSubmit) {
              setErr('名称和发布目录名必填 (slug 只能含小写字母/数字/连字符)');
              return;
            }
            createMut.mutate();
          }}
          className="space-y-3 p-5"
        >
          {/* 名称 */}
          <div className="space-y-1.5">
            <Label htmlFor="cat-name" className="text-xs font-medium">
              名称 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              maxLength={128}
              placeholder="例: 公司动态"
              className="h-9 text-sm"
            />
          </div>

          {/* 发布目录名 (slug) */}
          <div className="space-y-1.5">
            <Label htmlFor="cat-slug" className="text-xs font-medium">
              发布目录名 (Slug) <span className="text-red-500">*</span>
            </Label>
            <div className="flex items-stretch rounded-md border focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500 overflow-hidden">
              <span className="flex items-center px-2 text-xs text-muted-foreground bg-secondary/40 border-r select-none font-mono">
                /
              </span>
              <input
                id="cat-slug"
                value={slug}
                onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
                placeholder="公司动态 → gongsidongtai"
                maxLength={64}
                className="flex-1 h-9 px-2 text-sm font-mono bg-background focus:outline-none placeholder:text-muted-foreground/60"
              />
              {slugTouched && (
                <button
                  type="button"
                  onClick={() => { setSlug(slugify(name)); setSlugTouched(false); }}
                  title="从名称重新生成拼音"
                  className="px-2 border-l text-[11px] text-blue-600 hover:bg-blue-50 transition-colors"
                >
                  重新生成
                </button>
              )}
            </div>
            {slugEmpty ? (
              <p className="text-[11px] text-red-600">必填, 用于静态发布时的 URL 路径</p>
            ) : slugInvalid ? (
              <p className="text-[11px] text-red-600">格式不对: 只能含小写字母、数字、连字符 (不能以连字符开头/结尾)</p>
            ) : (
              <p className="text-[11px] text-muted-foreground flex items-center flex-wrap gap-x-1.5">
                <span>预览:</span>
                <code className="font-mono text-foreground/80">/{trimmedSlug}/</code>
                {!slugTouched && /[\u4e00-\u9fa5]/.test(name) && (
                  <span className="text-blue-600">· 已从名称自动转拼音</span>
                )}
                {slugTouched && (
                  <span className="text-amber-600">· 手动改过, 不再随名称变化</span>
                )}
              </p>
            )}
          </div>

          {/* 栏目模板 */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              栏目模板 <span className="text-red-500">*</span>
            </Label>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {templatesQ.isLoading && <option value="default">加载中…</option>}
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
              {templates.length > 0 && !templates.find((t) => t.code === 'default') && (
                <option value="default">默认列表</option>
              )}
            </select>
            {currentTemplate ? (
              <p className="text-[10px] text-muted-foreground">
                代码: <code className="font-mono">{currentTemplate.code}</code>
                {currentTemplate.is_default && <span className="ml-1.5 text-blue-600">· 当前站点的默认模板</span>}
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                决定栏目页的布局, 在「模板」管理可新建更多
              </p>
            )}
            {template === 'news-list' && (
              <div className="rounded-md border border-blue-200 bg-blue-50/50 px-3 py-2 text-[11px] text-blue-700">
                新闻资讯模式: 该栏目将作为新闻聚合页发布, 下属内容需要 <strong>封面图</strong> 才能在卡片上完整展示。
              </div>
            )}
          </div>

          {/* 详情模板 */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              详情模板 <span className="text-red-500">*</span>
            </Label>
            <select
              value={contentTemplate}
              onChange={(e) => setContentTemplate(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {contentTemplatesQ.isLoading && <option value="default">加载中…</option>}
              {contentTemplates.length === 0 && <option value="default">默认详情</option>}
              {contentTemplates.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}{t.is_default ? ' (默认)' : ''}
                </option>
              ))}
              {contentTemplates.length > 0 && !contentTemplates.find((t) => t.code === 'default') && (
                <option value="default">默认详情</option>
              )}
            </select>
            {currentContentTemplate ? (
              <p className="text-[10px] text-muted-foreground">
                代码: <code className="font-mono">{currentContentTemplate.code}</code>
                {currentContentTemplate.is_default && <span className="ml-1.5 text-blue-600">· 当前站点的默认模板</span>}
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                决定该栏目下文章详情页的布局
              </p>
            )}
          </div>

          {err && <p className="text-[11px] text-red-600">{err}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="h-8 text-xs">
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
