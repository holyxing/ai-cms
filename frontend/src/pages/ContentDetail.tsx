// ContentDetail.tsx - 文章详情/编辑页 (P3.9.1+ 重构, holy 反馈 #11240)
//
// 设计原则 (P3.9.1+ holy 反馈 #11240):
// - 默认进编辑态, 不要"只读 + 点编辑"两段式 (3-tab 切换: HTML / AI / 预览)
// - 满宽工作区 (无 max-w-4xl), 右侧栏 280px 保持
// - 去 Card 嵌套, 简洁分块 (跟 LayoutEditPage 风格统一)
// - "编辑" 按钮删除, "返回" 保留 (回到栏目列表)
//
// 路由: /sites/:siteId/contents/:contentId
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDraftAutosave } from '@/lib/useDraftAutosave';
import { ConfirmDialog } from '@/components/ui';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, FileText, History, Save, Trash2, Send, Sparkles,
  Code2, Eye, Wand2, ExternalLink, FolderTree, ChevronDown, FileCode2,
} from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import { toast } from 'sonner';

import { sitesApi } from '@/api/sites';
import { categoriesApi, type CategoryNode } from '@/api/categories';
import { mediaApi } from '@/api/media';
import { watchDeploymentForNotifications } from '@/lib/notificationsSync';
// popup 由 ContentLayout 跨页提供 (P3.9.2+ holy 反馈 #11686)
import { HtmlEditor } from '@/components/HtmlEditor';
import { ImportHtmlDialog } from '@/components/ImportHtmlDialog';
import { ImageUrlField } from '@/components/media/ImageUrlField';
import { InsertImageDialog } from '@/components/media/InsertImageDialog';
import { contentsApi, type Content, type ContentStatus } from '@/api/contents';
import { useAuthStore } from '@/stores/auth';
import { useAIAssistant } from '@/stores/aiAssistant';
import { useTabsStore } from '@/stores/tabs';
import { Button, Input, Label, Badge, Skeleton, PromptDialog, ConfirmDialog, QueryError, QueryLoading } from '@/components/ui';
import { useSaveShortcut } from '@/hooks/useSaveShortcut';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: '草稿',
  pending: '待审',
  published: '已发布',
  scheduled: '已计划',
  archived: '已归档',
};

type EditMode = 'html' | 'preview';

function findCategoryInTree(tree: CategoryNode[], id: string): CategoryNode | null {
  for (const node of tree) {
    if (node.id === id) return node;
    const found = findCategoryInTree(node.children || [], id);
    if (found) return found;
  }
  return null;
}

/** 正文必须是 HTML 字符串；本地草稿若被污染为 object 则丢弃 */
function asHtmlString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function slugifyContentSlug(title: string): string {
  const asciiSafe = title
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

  return pinyinStr
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || `article-${Date.now().toString(36)}`;
}

/** 新建占位 slug（随标题自动更新，不算用户手改） */
function isAutoPlaceholderSlug(slug: string): boolean {
  return /^untitled-[a-z0-9]+$/.test(slug) || slug === slugifyContentSlug('未命名文章');
}

export function ContentDetailPage() {
  // P3.9.1+ fix (holy 反馈 #11211): 路由参数名是 `siteId` 不是 `id`
  const { siteId, contentId } = useParams<{ siteId: string; contentId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const renameTab = useTabsStore((s) => s.renameTab);
  const currentUser = useAuthStore((s) => s.user);

  // 表单状态 (P3.9.1+ 默认编辑, 无 editing 切换)
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [body, setBody] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [bannerImage, setBannerImage] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);
  const [status, setStatus] = useState<ContentStatus>('draft');
  const [dirty, setDirty] = useState(false);
  // P3.3+ 3-tab 模式: HTML / AI / 预览 (默认 HTML)
  const [editMode, setEditMode] = useState<EditMode>('html');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const saveThenPublishRef = useRef(false);

  // P6.3 #22 草稿自动保存 (仅在有 contentId 时存)
  const draft = useDraftAutosave<{ title: string; body: string; excerpt: string }>({
    scope: 'content',
    id: contentId,
    data: { title, body, excerpt },
    enabled: !!contentId && contentId !== 'new',
  });
  const [restorePromptOpen, setRestorePromptOpen] = useState(false);

  // P3.9.1+ in-app dialog (holy 反馈 #11266: 统一用 in-app dialog 取代 window.prompt/confirm)
  // 用 resolve 模式: HtmlEditor 的 onRequest* callback 返回 Promise<string|null>
  const [linkPromptOpen, setLinkPromptOpen] = useState(false);
  const [imgPromptOpen, setImgPromptOpen] = useState(false);
  const [linkResolver, setLinkResolver] = useState<((v: string | null) => void) | null>(null);
  const [imgResolver, setImgResolver] = useState<((v: string | null) => void) | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearResolver, setClearResolver] = useState<((v: boolean) => void) | null>(null);

  // === Host callbacks (HtmlEditor P3.9.1+ 替代 window.prompt/confirm) ===
  const onRequestLink = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      setLinkResolver(() => resolve);
      setLinkPromptOpen(true);
    });
  }, []);
  const onRequestImage = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      setImgResolver(() => resolve);
      setImgPromptOpen(true);
    });
  }, []);
  const onConfirmClear = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      setClearResolver(() => resolve);
      setClearConfirmOpen(true);
    });
  }, []);

  // P3.9.4+ (holy 反馈 #12096): 粘贴 HTML 处理 - 从 Word 粘贴或网页复制时, <img> 里的 base64 / 远程 URL 上传到本站 MinIO
  const onPaste = useCallback(async (html: string): Promise<string> => {
    if (!siteId) {
      // 没 site_id, 返原文 (避免丢内容)
      return html;
    }
    // 提取所有 <img src="..."> (含 data:image base64 / https:// / /sites/.../ 等)
    const imgRegex = /<img\b[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
    const matches: { full: string; src: string; idx: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = imgRegex.exec(html)) !== null) {
      matches.push({ full: m[0], src: m[1], idx: m.index });
    }
    if (matches.length === 0) return html;

    // 异步上传所有图片
    let processed = html;
    let uploaded = 0;
    for (const { full, src } of matches) {
      // 跳过已经是指向 MinIO (/media/...) 的
      if (src.startsWith('/media/') || src.startsWith('http://localhost') || src.startsWith('http://minio')) continue;
      try {
        let blob: Blob;
        if (src.startsWith('data:')) {
          // base64 → blob
          const [meta, b64] = src.split(',');
          const mimeMatch = meta.match(/data:([^;]+)/);
          const mime = mimeMatch?.[1] || 'image/png';
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          blob = new Blob([bytes], { type: mime });
        } else {
          // 远程 URL fetch
          const r = await fetch(src, { mode: 'cors', credentials: 'omit' });
          if (!r.ok) continue;
          blob = await r.blob();
          if (!blob.type.startsWith('image/')) continue;
        }
        const filename = `pasted-${Date.now()}-${uploaded}.${(blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
        const file = new File([blob], filename, { type: blob.type });
        const r = await mediaApi.upload(siteId, file);
        const newUrl = r.data.data?.url;
        if (newUrl) {
          processed = processed.replace(full, full.replace(src, newUrl));
          uploaded++;
        }
      } catch (e) {
        console.warn('Paste image upload failed:', e);
      }
    }
    if (uploaded > 0) {
      toast.success(`已自动上传 ${uploaded} 张图片到媒体库`);
    }
    return processed;
  }, [siteId]);

  const { data: site } = useQuery({
    queryKey: ['site', siteId],
    queryFn: () => sitesApi.get(siteId!),
    enabled: !!siteId,
  });

  // P3.9.1+ (holy 反馈 #11266 补): 右侧 "发布到哪个栏目" 下拉 - 拉全站栏目树
  const { data: catTreeResp } = useQuery({
    queryKey: ['category-tree', siteId],
    queryFn: () => categoriesApi.tree(siteId!).catch(() => ({ tree: [] as CategoryNode[] })),
    enabled: !!siteId,
    staleTime: 60_000,
  });
  const catTree: CategoryNode[] = catTreeResp?.tree ?? [];

  const { data: content, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['content', siteId, contentId],
    queryFn: () => contentsApi.get(siteId!, contentId!),
    // P3.9.1+ fix (holy 反馈 #11232): contentId === 'new' 占位不调 API
    enabled: !!contentId && contentId !== 'new',
    retry: 1,  // P4.4: 失败重试 1 次 (默认 3 次太慢)
  });

  const { data: versions } = useQuery({
    queryKey: ['content-versions', siteId, contentId],
    queryFn: () => contentsApi.listVersions(siteId!, contentId!),
    enabled: !!contentId && contentId !== 'new',
  });

  // P3.9.1+ (holy 反馈 #11279 续): 主稿拉副本列表 - 拼出完整 category_ids 用于多选 UI
  // 副本是 is_copy_of=content.id 的所有 content, 拿它们的 category_id 拼到 categoryIds
  // （只能主稿看, 副本自身不查, 避免循环）
  const { data: duplicatesData } = useQuery({
    queryKey: ['content-duplicates', siteId, contentId],
    queryFn: () => contentsApi.list(siteId!, { page: 1, page_size: 100 }).catch(() => null),
    enabled: !!siteId && !!contentId && contentId !== 'new' && content?.is_copy_of == null,
    staleTime: 30_000,
  });
  const duplicates = (duplicatesData?.items ?? []).filter((c) => c.is_copy_of === contentId);
  // 同步远端数据 → categoryIds (主稿 category_id + 副本们 category_id)

  // P3.9.1+ (holy 反馈 #11266 补): 右侧 "发布到哪个栏目" 多选 (后端单字段, 暂存第一选)
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const primaryCategoryId = categoryIds[0] ?? null;

  // 同步远端数据 → 本地 (版本变化/外部改动/初次加载)
  useEffect(() => {
    if (content) {
      setTitle(content.title);
      setBody(asHtmlString(content.body));
      setExcerpt(content.excerpt ?? '');
      setCoverImage(content.cover_image ?? '');
      setBannerImage(content.banner_image ?? '');
      setIsFeatured(!!content.is_featured);
      setStatus(content.status);
      const nextSlug = content.slug || '';
      setSlug(nextSlug);
      // 已有文章且 slug 不是占位符 → 锁定发布路径，避免改标题时路径跟着变
      // （旧逻辑：slug===标题拼音时视为未手改，一改标题路径就飘）
      const isPlaceholder = !nextSlug || isAutoPlaceholderSlug(nextSlug);
      setSlugTouched(!isPlaceholder);
      // P6.3 #22 检测本地草稿是否与服务端不一致, 问用户恢复
      const d = draft.getDraft();
      if (d && (d.title || d.body)) {
        const isDirty =
          d.title !== content.title ||
          d.body !== content.body ||
          d.excerpt !== (content.excerpt ?? '');
        if (isDirty && !restorePromptOpen) {
          // delay 一拍, 让 UI 稳定
          setTimeout(() => setRestorePromptOpen(true), 200);
        }
      }
      // content.category_id 是主稿的栏目, 副本的栏目从 duplicatesQ 拿
      // 主稿: categoryIds = [主稿 category_id, ...副本 category_ids]
      // 副本: categoryIds = [副本自身 category_id] (不允许多选, 会被后端拒)
      if (content.is_copy_of) {
        setCategoryIds(content.category_id ? [content.category_id] : []);
      } else {
        // 主稿: 拼所有副本的 category_id
        const all = [content.category_id, ...duplicates.map((d) => d.category_id)].filter((x): x is string => !!x);
        setCategoryIds(all);
      }
      setDirty(false);
    }
  }, [content?.id, content?.updated_at]);  // eslint-disable-line react-hooks/exhaustive-deps

  // AI 助手上下文：必须用编辑器当前 HTML 正文（body），不能只用已保存的 content.body
  useEffect(() => {
    if (!siteId || !contentId || contentId === 'new' || !content) return;
    useAIAssistant.getState().setContext({
      type: 'article',
      target: {
        resourceId: content.id,
        siteId,
        title: (title || content.title || '').trim() || '未命名',
        slug: slug || content.slug,
      },
      payload: {
        body,
        excerpt: excerpt || undefined,
        onApply: (newText: string) => {
          setBody(asHtmlString(newText));
          setDirty(true);
          toast.success('已应用 AI 重写, 请点保存');
        },
        onReject: () => {},
      },
    });
  }, [siteId, contentId, content?.id, body, title, excerpt, slug]);

  // 仅「新建文章」且用户未手改时，slug 才跟标题走。
  // 已有文章禁止自动改写，否则会把手动改的 fenlei2005 打回兜底值 article，
  // 再保存时与站内其它 article 撞唯一约束，保存看似成功实则失败。
  useEffect(() => {
    if (slugTouched) return;
    if (contentId && contentId !== 'new') return;
    setSlug(slugifyContentSlug(title));
  }, [title, slugTouched, contentId]);

  // tab 标题用文章标题，避免多个「文章」无法区分
  useEffect(() => {
    const name = (title || '').trim() || '未命名文章';
    renameTab(location.pathname, name);
  }, [title, location.pathname, renameTab]);

  // 发布
  const publishMut = useMutation({
    mutationFn: () => contentsApi.publish(siteId!, contentId!),
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['content', siteId, contentId] });
      queryClient.invalidateQueries({ queryKey: ['contents', siteId] });
      setStatus('published');
      setDirty(false);
      const ok = data.status === 'published' && data.published_at;
      const fromSaveAndPublish = saveThenPublishRef.current;
      saveThenPublishRef.current = false;
      if (fromSaveAndPublish) {
        toast.success(ok ? '保存并发布成功，正在生成静态页…' : '已保存，文章已是发布状态');
      } else {
        toast.success(ok ? '发布成功，正在生成静态页…' : '已是发布状态');
      }
      if (ok && siteId && contentId) {
        try {
          const job = await contentsApi.publishStatic(siteId, contentId, { force: true });
          watchDeploymentForNotifications(job?.id);
        } catch {
          toast.error('静态页生成入队失败，请稍后在发布页手动触发');
        }
      }
    },
    onError: () => {
      saveThenPublishRef.current = false;
      toast.error('发布失败');
    },
  });

  // 保存
  const saveMut = useMutation({
    mutationFn: () => contentsApi.update(siteId!, contentId!, {
      title: title.trim(),
      slug: slug.trim(),
      body,
      excerpt: excerpt.trim() || undefined,
      cover_image: coverImage.trim() || null,
      banner_image: bannerImage.trim() || null,
      is_featured: isFeatured,
      status,
      category_ids: categoryIds,
    }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['content', siteId, contentId] });
      queryClient.invalidateQueries({ queryKey: ['content-versions', siteId, contentId] });
      queryClient.invalidateQueries({ queryKey: ['contents', siteId] });
      setDirty(false);
      if (!saveThenPublishRef.current) {
        toast.success('已保存');
      }
      draft.clearDraft();
      // 已发布文章保存后自动重生成静态页（含 slug/正文变更）
      if (status === 'published' && siteId && contentId) {
        try {
          const job = await contentsApi.publishStatic(siteId, contentId, { force: true });
          watchDeploymentForNotifications(job?.id);
          if (!saveThenPublishRef.current) {
            toast.info('静态页已重新生成，约 10–30 秒生效');
          }
        } catch {
          toast.error('静态页生成入队失败，请稍后在发布页手动触发');
        }
      }
    },
    onError: (e: any) => {
      saveThenPublishRef.current = false;
      toast.error(e?.message || '保存失败');
    },
  });

  const validateSlug = useCallback(() => {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim())) {
      toast.error('发布路径不合法，只能含小写字母、数字、连字符');
      return false;
    }
    return true;
  }, [slug]);

  const save = useCallback(() => {
    if (!dirty || saveMut.isPending || publishMut.isPending) return;
    if (!validateSlug()) return;
    saveMut.mutate();
  }, [dirty, saveMut, publishMut, validateSlug]);

  const saveAndPublish = useCallback(async () => {
    if (saveMut.isPending || publishMut.isPending) return;
    if (!validateSlug()) return;
    setSaveMenuOpen(false);
    saveThenPublishRef.current = true;
    try {
      if (dirty) {
        await saveMut.mutateAsync();
      }
      await publishMut.mutateAsync();
    } catch {
      saveThenPublishRef.current = false;
    }
  }, [dirty, saveMut, publishMut, validateSlug]);

  useEffect(() => {
    if (!saveMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) {
        setSaveMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [saveMenuOpen]);
  useSaveShortcut({ onSave: save, enabled: dirty && !saveMut.isPending && !publishMut.isPending && editMode !== 'preview' });

  const publishedUrl = useMemo(() => {
    if (status !== 'published' || !site?.slug || !content?.category_id) return null;
    const cat = findCategoryInTree(catTree, content.category_id);
    const realSlug = slug.trim() || content.slug;
    const valid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(realSlug);
    if (!cat?.slug || !valid) return null;
    let dir = cat.slug;
    if (cat.parent_id) {
      const parent = findCategoryInTree(catTree, cat.parent_id);
      if (parent?.slug) dir = `${parent.slug}/${cat.slug}`;
    }
    // 未保存时仍指向旧静态地址；保存后会按新 slug 重新生成
    return dirty ? null : `/sites/${site.slug}/${dir}/${realSlug}.html`;
  }, [status, site?.slug, content?.category_id, content?.slug, slug, dirty, catTree]);

  useEffect(() => {
    if (editMode !== 'preview' || !siteId || !contentId) return;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    contentsApi.previewHtml(siteId, contentId, body)
      .then((html) => {
        if (!cancelled) setPreviewHtml(html);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPreviewHtml('');
          setPreviewError(e instanceof Error ? e.message : '预览加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => { cancelled = true; };
  }, [editMode, siteId, contentId, body]);

  const openPreviewWindow = useCallback(async () => {
    if (!siteId || !contentId) {
      toast.error('请先登录后再预览');
      return;
    }
    try {
      const html = await contentsApi.previewHtml(siteId, contentId, body);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      // 延迟释放，避免新窗尚未加载完就被 revoke
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '预览加载失败');
    }
  }, [siteId, contentId, body]);

  const openPublishedPage = useCallback(() => {
    if (!publishedUrl) return;
    window.open(publishedUrl, '_blank', 'noopener,noreferrer');
    toast.info('若出现 404，请等待静态页生成完成（发布后会自动入队，约 10–30 秒）', { duration: 5000 });
  }, [publishedUrl]);

  const removeMut = useMutation({
    mutationFn: () => contentsApi.remove(siteId!, contentId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contents', siteId] });
      toast.success('已删除');
      navigate(`/c/${content?.category_id ?? ''}`);
    },
  });

  if (isLoading) {
    return (
      <div className="px-6 py-6 space-y-4">
        <QueryLoading variant="detail" />
      </div>
    );
  }

  if (isError || !content) {
    return (
      <QueryError
        error={isError ? error : { response: { status: 404 } }}
        onRetry={() => refetch()}
        context="加载文章详情"
        className="p-10"
      />
    );
  }

  const isOwner = !!currentUser && (currentUser.is_super_admin || currentUser.id === site?.owner_id);
  const canEdit = isOwner || currentUser?.id === content.author_id;
  const category = content.category_id
    ? findCategoryInTree(catTree, content.category_id)
    : null;
  const validSlug = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim());
  // 栏目完整目录（含父栏目前缀）
  const catDir = (() => {
    if (!category?.slug) return category?.slug || '';
    if (category.parent_id) {
      const parent = findCategoryInTree(catTree, category.parent_id);
      if (parent?.slug) return `${parent.slug}/${category.slug}`;
    }
    return category.slug;
  })();
  const publishedPath = (() => {
    const realSlug = slug.trim() || content.slug;
    if (!catDir || !realSlug) return null;
    return `/${catDir}/${realSlug}.html`;
  })();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* P6.3 #22 草稿自动保存提示条 */}
      {draft.hasDraft && draft.lastSavedAt && (
        <div className="flex flex-shrink-0 items-center justify-between border-b border-amber-200 bg-amber-50 px-6 py-1.5 text-[11px] text-amber-700">
          <div className="flex items-center gap-1.5">
            <Save className="h-3 w-3" />
            <span>{dirty ? '已自动保存草稿' : '已保存'} ({timeAgo(draft.lastSavedAt)})</span>
          </div>
          <button
            type="button"
            onClick={() => draft.clearDraft()}
            className="text-amber-700 underline-offset-2 hover:underline"
          >
            清除草稿
          </button>
        </div>
      )}
      {/* === 顶部 thin toolbar (P3.9.1+ 重构: 无 Card, 一行撑开) === */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b bg-background px-6 py-3">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/c/${content.category_id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <Input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
            placeholder="未命名文章"
            disabled={!canEdit}
            className="h-7 border-transparent bg-transparent px-1 text-base font-semibold shadow-none focus-visible:border-input focus-visible:bg-background"
          />
          <div className="mt-0.5 flex items-center gap-1.5 px-1 text-[10.5px] text-muted-foreground">
            <Link to={`/sites/${siteId}/contents`} className="hover:underline">{site?.name}</Link>
            <span>·</span>
            {publishedPath ? (
              <code className="rounded bg-secondary px-1 py-px font-mono text-[10px]">{publishedPath}</code>
            ) : (
              <code className="rounded bg-secondary px-1 py-px font-mono text-[10px]">/{slug || '...'}</code>
            )}
            <span>·</span>
            <Badge variant={status === 'published' ? 'default' : 'muted'} className="text-[9.5px]">
              {STATUS_LABEL[status]}
            </Badge>
            {content.is_copy_of && (
              <Badge variant="muted" className="text-[9.5px] bg-amber-50 text-amber-700 hover:bg-amber-50">
                副本
              </Badge>
            )}
            {dirty && <span className="text-amber-600">· 未保存</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={() => setImportOpen(true)}
              title="选择 HTML 文件，自动解析样式并插入正文"
            >
              <FileCode2 className="h-3 w-3" />
              导入 HTML
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-[11px]"
            onClick={openPreviewWindow}
            title="与下方「预览」Tab 相同，在新窗口打开实时渲染页"
          >
            <ExternalLink className="h-3 w-3" />
            新窗预览
          </Button>
          {publishedUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={openPublishedPage}
              title="打开已生成的静态 HTML（发布后会自动入队生成）"
            >
              <ExternalLink className="h-3 w-3" />
              线上页
            </Button>
          )}
          {canEdit && status !== 'published' && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={() => {
                if (dirty) void saveAndPublish();
                else publishMut.mutate();
              }}
              disabled={publishMut.isPending || saveMut.isPending}
            >
              <Send className="h-3 w-3" />
              {publishMut.isPending || saveMut.isPending ? '发布中...' : '发布'}
            </Button>
          )}
          {canEdit && (
            <div ref={saveMenuRef} className="relative flex items-stretch">
              <Button
                size="sm"
                className="h-7 gap-1 rounded-r-none px-2.5 text-[11px]"
                onClick={save}
                disabled={!dirty || saveMut.isPending || publishMut.isPending}
              >
                <Save className="h-3 w-3" />
                {saveMut.isPending ? '保存中...' : '保存'}
              </Button>
              <Button
                size="sm"
                className="h-7 rounded-l-none border-l border-primary-foreground/20 px-1.5"
                onClick={() => setSaveMenuOpen((v) => !v)}
                disabled={saveMut.isPending || publishMut.isPending}
                aria-label="更多保存选项"
              >
                <ChevronDown className={cn('h-3 w-3 transition-transform', saveMenuOpen && 'rotate-180')} />
              </Button>
              {saveMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-md border bg-popover py-1 shadow-md">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-secondary/40 disabled:opacity-50"
                    onClick={() => void saveAndPublish()}
                    disabled={saveMut.isPending || publishMut.isPending}
                  >
                    <Send className="h-3 w-3 text-muted-foreground" />
                    {saveMut.isPending || publishMut.isPending ? '处理中...' : '保存并发布'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* === 主体: 主区 + 右侧 280px (P3.9.1+ 满宽, 无 max-w-4xl) === */}
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_280px]">
        {/* === 主编辑区 === */}
        <div className="flex min-h-0 flex-col">
          {/* tab 切换条 (P3.9.1+ 新增: HTML / AI / 预览) */}
          {canEdit && (
            <div className="flex flex-shrink-0 items-center gap-1 border-b bg-secondary/15 px-6 py-1.5">
              <TabBtn active={editMode === 'html'} onClick={() => setEditMode('html')} icon={Code2} label="HTML" />
              <TabBtn active={editMode === 'preview'} onClick={() => setEditMode('preview')} icon={Eye} label="实时预览" />
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {editMode === 'html' && canEdit && (
              <div className="space-y-3 px-6 py-4">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium text-muted-foreground">摘要 (可选, 用于列表和 SEO)</Label>
                  <Input
                    value={excerpt}
                    onChange={(e) => { setExcerpt(e.target.value); setDirty(true); }}
                    placeholder="一句话简介..."
                    className="h-8 text-[12.5px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium text-muted-foreground">正文 (HTML 源码)</Label>
                  <HtmlEditor
                    value={body}
                    onChange={(v) => { setBody(v); setDirty(true); }}
                    scope="all"
                    minHeight={500}
                    showToolbar  // P3.9.1+ holy 反馈 #11251: 给运营文章用快捷插入 toolbar
                    onRequestLink={onRequestLink}   // P3.9.1+ holy 反馈 #11266: 取代 window.prompt
                    onRequestImage={onRequestImage}
                    onConfirmClear={onConfirmClear}
                    onPaste={onPaste}  // P3.9.4+ holy 反馈 #12096: 粘贴 HTML → base64/远程图上传 MinIO
                    aiEnhance={siteId ? {
                      siteId,
                      contentId: contentId !== 'new' ? contentId : undefined,
                      siteSlug: site?.slug,
                    } : undefined}
                    placeholder="<h2>标题</h2>\n<p>段落...</p>"
                  />
                </div>
              </div>
            )}

            {editMode === 'preview' && (
              <div className="p-6">
                {previewLoading && (
                  <p className="mb-2 text-[11px] text-muted-foreground">正在加载预览…</p>
                )}
                {previewError && (
                  <p className="mb-2 text-[11px] text-destructive">{previewError}</p>
                )}
                <div className="overflow-hidden rounded-md border bg-card">
                  <iframe
                    srcDoc={previewHtml || '<!doctype html><html><body></body></html>'}
                    className="h-[60vh] w-full"
                    sandbox="allow-same-origin allow-scripts allow-popups allow-top-navigation-by-user-activation"
                    title="内容预览"
                  />
                </div>
              </div>
            )}

            {!canEdit && (
              <div className="p-6">
                <h1 className="mb-2 text-2xl font-semibold tracking-tight">{content.title}</h1>
                {content.excerpt && <p className="text-sm text-muted-foreground">{content.excerpt}</p>}
                <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: content.body || '<p class="text-muted-foreground text-sm italic">正文为空</p>' }} />
              </div>
            )}
          </div>
        </div>

        {/* === 右侧栏 280px (P3.9.1+ 保持原宽) === */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l bg-secondary/15 px-4 py-4">
          {/* P3.9.1+ 发布到哪些栏目 (holy 反馈 #11266 补 + #11279 续: 副本不显示) */}
          {canEdit && !content.is_copy_of && (
            <div className="rounded-md border bg-background p-3">
              <p className="mb-2 text-[11px] font-medium flex items-center gap-1.5">
                <FolderTree className="h-3.5 w-3.5 text-muted-foreground" />
                发布到哪些栏目
              </p>
              <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border bg-secondary/15 p-1">
                {catTree && catTree.length > 0 ? (
                  flattenCatTree(catTree).map((node) => {
                    const checked = categoryIds.includes(node.id);
                    return (
                      <label
                        key={node.id}
                        className={
                          'flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-[11px] hover:bg-secondary/50 ' +
                          (checked ? 'text-blue-700' : 'text-foreground/85')
                        }
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setCategoryIds((prev) => {
                              if (e.target.checked) return prev.includes(node.id) ? prev : [...prev, node.id];
                              return prev.filter((id) => id !== node.id);
                            });
                            setDirty(true);
                          }}
                          className="h-3 w-3 cursor-pointer"
                        />
                        <span className="truncate" title={node.path}>{node.path}</span>
                      </label>
                    );
                  })
                ) : (
                  <p className="p-2 text-[10.5px] text-muted-foreground">暂无栏目</p>
                )}
              </div>
              {categoryIds.length > 1 && (
                <p className="mt-1.5 text-[10px] text-amber-600">
                  每个选中的栏目都会生成独立副本 (独立发布, 独立版本)。改主稿不同步, 删主稿会级联删所有副本。
                </p>
              )}
            </div>
          )}

          {/* 头条 / 缩略图 / Banner */}
          {canEdit && (
            <div className="rounded-md border bg-background p-3">
              <p className="mb-2 text-[11px] font-medium">头条与图片</p>
              <label className="mb-3 flex cursor-pointer items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={isFeatured}
                  onChange={(e) => {
                    setIsFeatured(e.target.checked);
                    setDirty(true);
                  }}
                />
                <span>设为头条（进入栏目 Banner 轮播，需 Banner 图）</span>
              </label>
              <p className="mb-1 text-[10px] text-muted-foreground">缩略图（列表卡片）</p>
              <ImageUrlField
                siteId={siteId!}
                value={coverImage}
                onChange={(url) => {
                  setCoverImage(url);
                  setDirty(true);
                }}
                placeholder="/sites/.../thumb.webp 或媒体库 URL"
                previewClassName="h-16"
              />
              <p className="mb-1 mt-3 text-[10px] text-muted-foreground">Banner 图（头条轮播大图）</p>
              <ImageUrlField
                siteId={siteId!}
                value={bannerImage}
                onChange={(url) => {
                  setBannerImage(url);
                  setDirty(true);
                }}
                placeholder="/sites/.../banner.webp 或媒体库 URL"
                previewClassName="h-20"
              />
            </div>
          )}

          {/* 发布路径 */}
          <div className="rounded-md border bg-background p-3">
            <p className="mb-2 text-[11px] font-medium">发布路径</p>
            {canEdit ? (
              <div className="space-y-1.5">
                <div className="flex items-stretch overflow-hidden rounded-md border focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
                  <span className="flex max-w-[45%] items-center truncate border-r bg-secondary/40 px-2 font-mono text-[10px] text-muted-foreground select-none">
                    /{catDir || '栏目'}/
                  </span>
                  <input
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value.toLowerCase());
                      setSlugTouched(true);
                      setDirty(true);
                    }}
                    placeholder="guanyuwomen"
                    className="h-8 min-w-0 flex-1 bg-background px-2 text-[11px] font-mono focus:outline-none placeholder:text-muted-foreground/60"
                  />
                  <span className="flex items-center border-l bg-secondary/40 px-2 font-mono text-[10px] text-muted-foreground select-none">
                    .html
                  </span>
                </div>
                {slugTouched && (
                  <button
                    type="button"
                    onClick={() => {
                      setSlug(slugifyContentSlug(title));
                      // 生成一次后仍锁定，需要再点才会改；避免继续跟标题飘
                      setSlugTouched(true);
                      setDirty(true);
                    }}
                    className="text-[10px] text-blue-600 hover:underline"
                  >
                    从标题重新生成
                  </button>
                )}
                {slug.trim() && validSlug && site?.slug && category?.slug ? (
                  <p className="text-[10px] text-muted-foreground">
                    预览: <code className="font-mono text-foreground/80">/sites/{site.slug}/{catDir}/{slug.trim()}.html</code>
                  </p>
                ) : (
                  <p className="text-[10px] text-red-600">只能含小写字母、数字、连字符</p>
                )}
              </div>
            ) : (
              <code className="block truncate rounded bg-secondary/50 px-2 py-1 font-mono text-[10px]">
                {publishedPath || `/${slug || content.slug}`}
              </code>
            )}
          </div>

          {/* 状态 */}
          <div className="rounded-md border bg-background p-3">
            <p className="mb-2 text-[11px] font-medium flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              状态
            </p>
            {canEdit ? (
              <select
                value={status}
                onChange={(e) => { setStatus(e.target.value as ContentStatus); setDirty(true); }}
                className="h-7 w-full rounded-md border bg-background px-2 text-[11.5px]"
              >
                {(['draft', 'pending', 'published', 'scheduled', 'archived'] as ContentStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            ) : (
              <Badge variant="muted" className="text-[10px]">{STATUS_LABEL[content.status]}</Badge>
            )}
            <dl className="mt-2.5 space-y-0.5 text-[10.5px] text-muted-foreground">
              <MetaRow label="作者" value={content.author_name || '匿名'} />
              <MetaRow label="创建" value={new Date(content.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} />
              <MetaRow label="更新" value={new Date(content.updated_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} />
              {content.published_at && <MetaRow label="发布" value={new Date(content.published_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} />}
              <MetaRow label="浏览" value={content.view_count} />
            </dl>
          </div>

          {/* 版本 */}
          <div className="rounded-md border bg-background">
            <p className="flex items-center gap-1.5 border-b px-3 py-2 text-[11px] font-medium">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              版本 ({versions?.length || 0})
            </p>
            {versions && versions.length > 0 ? (
              <ul className="max-h-72 divide-y overflow-y-auto">
                {versions.map((v) => (
                  <li key={v.id} className="px-3 py-1.5 text-[10.5px]">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-medium">v{v.version_num}</span>
                      {v.is_auto_save && <Badge variant="muted" className="text-[9px]">自动</Badge>}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {v.author_name || '匿名'} · {new Date(v.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-3 text-[10.5px] text-muted-foreground">暂无版本</p>
            )}
          </div>

          {/* 危险操作 */}
          {isOwner && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`删除 "${content.title}" ?  版本会保留`)) {
                  removeMut.mutate();
                }
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-red-200 bg-background px-3 py-1.5 text-[11px] text-red-600 transition-colors hover:bg-red-50"
            >
              <Trash2 className="h-3 w-3" />
              删除内容
            </button>
          )}
        </aside>
      </div>

      {siteId && (
        <ImportHtmlDialog
          open={importOpen}
          siteId={siteId}
          hasExistingContent={!!body.trim()}
          onClose={() => setImportOpen(false)}
          onInsert={(html) => {
            const snippet = html.trim();
            if (!snippet) {
              toast.error('没有可写入的内容');
              return;
            }
            setBody(snippet);
            setDirty(true);
            setEditMode('html');
            setImportOpen(false);
            toast.success('已写入正文');
          }}
        />
      )}

      {/* === P3.9.1+ in-app dialog (holy 反馈 #11266: 统一用 in-app dialog, 取代 window.prompt/confirm) === */}
      <PromptDialog
        open={linkPromptOpen}
        onClose={() => { linkResolver?.(null); setLinkResolver(null); setLinkPromptOpen(false); }}
        onConfirm={(v: string) => { linkResolver?.(v); setLinkResolver(null); setLinkPromptOpen(false); }}
        title="插入链接"
        label="链接地址"
        type="url"
        placeholder="https://example.com"
        requiredHint="请输入 https:// 开头的 URL"
        confirmText="插入"
        validate={(v) => /^https?:\/\//i.test(v.trim()) ? null : 'URL 必须以 http(s):// 开头'}
      />
      {siteId && (
        <InsertImageDialog
          open={imgPromptOpen}
          siteId={siteId}
          onClose={() => { imgResolver?.(null); setImgResolver(null); setImgPromptOpen(false); }}
          onConfirm={(v: string) => { imgResolver?.(v); setImgResolver(null); setImgPromptOpen(false); }}
        />
      )}
      <ConfirmDialog
        open={clearConfirmOpen}
        onClose={() => { clearResolver?.(false); setClearResolver(null); setClearConfirmOpen(false); }}
        onConfirm={() => { clearResolver?.(true); setClearResolver(null); setClearConfirmOpen(false); }}
        title="清空正文"
        description="确定要清空所有 HTML 内容吗？此操作不可撤销。"
        confirmText="清空"
        variant="warning"
      />

      {/* P6.3 #22 草稿恢复提示 */}
      <ConfirmDialog
        open={restorePromptOpen}
        onClose={() => { setRestorePromptOpen(false); draft.clearDraft(); }}
        onConfirm={() => {
          const d = draft.getDraft();
          if (d) {
            setTitle(d.title);
            setBody(asHtmlString(d.body) || asHtmlString(content?.body));
            setExcerpt(d.excerpt);
            setDirty(true);
          }
          setRestorePromptOpen(false);
        }}
        title="恢复未保存的草稿？"
        description="上次编辑后未保存的内容仍在本地草稿中。是否恢复？"
        confirmText="恢复草稿"
        cancelText="丢弃"
        variant="info"
      />

    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium transition-colors ' +
        (active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-background/60 hover:text-foreground')
      }
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground/80">{value}</span>
    </div>
  );
}

// P3.9.1+ (holy 反馈 #11266 补): 把栏目树拍平并加完整路径前缀, 给右侧多选用
function flattenCatTree(tree: CategoryNode[]): Array<CategoryNode & { path: string; depth: number }> {
  const out: Array<CategoryNode & { path: string; depth: number }> = [];
  const walk = (ns: CategoryNode[], prefix: string, depth: number) => {
    for (const n of ns) {
      const path = prefix ? `${prefix} / ${n.name}` : n.name;
      out.push({ ...n, path, depth });
      if (n.children && n.children.length > 0) walk(n.children, path, depth + 1);
    }
  };
  walk(tree, '', 0);
  return out;
}

// P6.3 #22 helper: 友好的时间描述
function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}
