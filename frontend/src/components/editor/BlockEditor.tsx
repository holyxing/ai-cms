/**
 * Tiptap 块编辑器 (P3.5 富文本增强)
 *
 * 依据: docs/04a-主题与Block-规范.md §2.2
 *
 * 功能:
 * - 标题 H1/H2/H3 + 段落
 * - 粗体/斜体/删除线/行内代码
 * - 链接(自动新窗口)
 * - 无序/有序列表 + 引用 + 代码块
 * - 撤销/重做
 * - **图片** (P3.5 新增):
 *   - 工具栏"插入图片"按钮 → 弹 MediaPicker
 *   - **粘贴图片自动上传** (paste handler, A 方案)
 *   - **拖拽图片到编辑器自动上传** (drop handler)
 */
import * as React from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import {
  Bold, Italic, Code, List, ListOrdered, Quote, Heading1, Heading2, Heading3,
  Link as LinkIcon, Strikethrough, Undo, Redo, Image as ImageIcon, Loader2,
  Tag,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { mediaApi } from '@/api/media';
import { MediaPicker } from '@/components/media/MediaPicker';
import TagAutocompletePopover, { type TagItem } from '@/components/editor/TagAutocompletePopover';
import { toast } from 'sonner';

export interface BlockEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
  /** 当前站点 ID (粘贴/拖拽上传需要) */
  siteId?: string;
  /** 内部 useRef, 把 editor 暴露给父组件 (可选) */
  editorRef?: React.MutableRefObject<Editor | null>;
  /** 弹 URL 输入 (链接按钮), host 用 in-app PromptDialog */
  onRequestLink?: () => Promise<string | null>;
}

/** plain text → HTML 包装 (兼容旧 data) */
function plainToHtml(text: string): string {
  if (!text) return '';
  if (/<[a-z][\s\S]*>/i.test(text.trim())) {
    return text;
  }
  return text
    .split(/\n\n+/)
    .map((para) => {
      const lines = para.split('\n').map((l) => escapeHtml(l)).join('<br>');
      return `<p>${lines}</p>`;
    })
    .join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const Toolbar: React.FC<{
  editor: Editor | null;
  onPickImage: () => void;
  onUploadStart: () => void;
  onUploadEnd: () => void;
  onInsertVariable: () => void;
  onRequestLink?: () => Promise<string | null>;
}> = ({ editor, onPickImage, onUploadStart, onUploadEnd, onInsertVariable, onRequestLink }) => {
  if (!editor) return null;

  const btn = (active: boolean) =>
    cn(
      'h-7 w-7 rounded-md p-0 transition-all',
      'hover:bg-blue-50 hover:text-blue-700',
      active && 'bg-blue-100 text-blue-700 shadow-sm',
    );

  const onLink = async () => {
    const url = onRequestLink ? await onRequestLink() : null;
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white px-2 py-1.5 sticky top-0 z-10">
      <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive('heading', { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="H1">
        <Heading1 className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="H2">
        <Heading2 className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive('heading', { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="H3">
        <Heading3 className="h-3.5 w-3.5" />
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="粗体">
        <Bold className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜体">
        <Italic className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive('strike'))} onClick={() => editor.chain().focus().toggleStrike().run()} title="删除线">
        <Strikethrough className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive('code'))} onClick={() => editor.chain().focus().toggleCode().run()} title="行内代码">
        <Code className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive('link'))} onClick={onLink} title="链接">
        <LinkIcon className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onInsertVariable} title="插入变量 (HY_ 标签 / 站点标签)" className="text-primary">
        <Tag className="h-3.5 w-3.5" />
        <span className="ml-1 text-[11.5px]">变量</span>
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="无序列表">
        <List className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="有序列表">
        <ListOrdered className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" size="sm" variant="ghost" className={btn(editor.isActive('blockquote'))} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="引用">
        <Quote className="h-3.5 w-3.5" />
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button type="button" size="sm" variant="ghost" className={btn(false)} onClick={onPickImage} title="插入/上传图片 (或直接粘贴)">
        <ImageIcon className="h-3.5 w-3.5" />
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="撤销">
        <Undo className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="重做">
        <Redo className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};

export const BlockEditor: React.FC<BlockEditorProps> = ({
  value,
  onChange,
  placeholder = '开始写正文…',
  editable = true,
  className,
  siteId,
  editorRef,
  onRequestLink,
}) => {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [uploading, setUploading] = React.useState(0);
  // P3.6.2: 变量补全 (HY_ 标签 + 媒体可选)
  const [varOpen, setVarOpen] = React.useState(false);
  const [varFilter, setVarFilter] = React.useState('');
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({ placeholder }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: 'rounded-md max-w-full h-auto my-2' },
      }),
    ],
    content: plainToHtml(value),
    editable,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
  });

  // 暴露 editor 给父组件
  React.useEffect(() => {
    if (editorRef) editorRef.current = editor;
    return () => {
      if (editorRef) editorRef.current = null;
    };
  }, [editor, editorRef]);

  // 外部 value 变 → 重设
  const lastValueRef = React.useRef(value);
  React.useEffect(() => {
    if (!editor) return;
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    queueMicrotask(() => {
      const cur = editor.getHTML();
      if (plainToHtml(value) !== cur) {
        editor.commands.setContent(plainToHtml(value), false);
      }
    });
  }, [value, editor]);

  React.useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  // === 图片上传核心函数 ===
  const uploadImage = React.useCallback(
    async (file: File): Promise<string | null> => {
      if (!siteId) {
        toast.error('缺少 siteId,无法上传图片');
        return null;
      }
      if (!file.type.startsWith('image/')) {
        toast.error('只支持图片文件');
        return null;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error('图片不能超过 10MB');
        return null;
      }
      setUploading((n) => n + 1);
      try {
        const r = await mediaApi.upload(siteId, file);
        const url = r.data.data?.url;
        if (!url) throw new Error('上传未返回 url');
        toast.success('图片已插入');
        return url;
      } catch (e: any) {
        toast.error(`上传失败: ${e?.message || '未知错误'}`);
        return null;
      } finally {
        setUploading((n) => n - 1);
      }
    },
    [siteId],
  );

  // === 粘贴图片自动上传 (A 方案: 粘贴即传) ===
  React.useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onPaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items);
      const images = items.filter((i) => i.type.startsWith('image/'));
      if (images.length === 0) return;
      e.preventDefault();
      for (const item of images) {
        const file = item.getAsFile();
        if (!file) continue;
        const url = await uploadImage(file);
        if (url) {
          editor.chain().focus().setImage({ src: url, alt: file.name }).run();
        }
      }
    };
    dom.addEventListener('paste', onPaste);
    return () => dom.removeEventListener('paste', onPaste);
  }, [editor, uploadImage]);

  // === 拖拽图片自动上传 ===
  React.useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onDrop = async (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files);
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return;
      e.preventDefault();
      for (const file of images) {
        const url = await uploadImage(file);
        if (url) {
          editor.chain().focus().setImage({ src: url, alt: file.name }).run();
        }
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
      }
    };
    dom.addEventListener('drop', onDrop);
    dom.addEventListener('dragover', onDragOver);
    return () => {
      dom.removeEventListener('drop', onDrop);
      dom.removeEventListener('dragover', onDragOver);
    };
  }, [editor, uploadImage]);

  return (
    <div className={cn('overflow-hidden rounded-md border bg-card', className)}>
      {editable && (
        <div className="relative">
          <Toolbar
            editor={editor}
            onPickImage={() => setPickerOpen(true)}
            onUploadStart={() => setUploading((n) => n + 1)}
            onUploadEnd={() => setUploading((n) => n - 1)}
            onInsertVariable={() => { setVarOpen(true); setVarFilter(''); }}
            onRequestLink={onRequestLink}
          />
          {uploading > 0 && (
            <div className="absolute right-2 top-1.5 flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              上传中 {uploading}
            </div>
          )}
        </div>
      )}
      <EditorContent
        editor={editor}
        className={cn(
          // P3.9.4 (holy 反馈 #12038): 编辑器美化 - 中文首行缩进 2em + H1/H2/H3 更精致
          'prose prose-base max-w-none px-6 py-5 focus:outline-none',
          // 标题: 深色、紧凑、靠下加底线
          '[&_h1]:text-[1.875rem] [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-slate-900 [&_h1]:tracking-tight',
          '[&_h2]:text-[1.5rem] [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-slate-900 [&_h2]:tracking-tight',
          '[&_h3]:text-[1.25rem] [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-slate-800',
          // 正文: 中文段落首行缩进 2em + 行高宽松 + 深色
          '[&_p]:my-3 [&_p]:leading-[1.85] [&_p]:text-slate-800',
          '[&_p]:indent-[2em]', //  P3.9.4: 中文段落首行缩进 2em
          // 列表: 中文习惯、宽松间距
          '[&_ul]:list-disc [&_ul]:ml-6 [&_ul]:my-3 [&_ul]:space-y-1',
          '[&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:my-3 [&_ol]:space-y-1',
          '[&_li]:leading-[1.85] [&_li]:text-slate-800',
          // 引用: 左边线深蓝 + 浅底
          '[&_blockquote]:border-l-4 [&_blockquote]:border-blue-500 [&_blockquote]:bg-blue-50 [&_blockquote]:pl-4 [&_blockquote]:pr-3 [&_blockquote]:py-2 [&_blockquote]:my-4 [&_blockquote]:text-slate-700 [&_blockquote]:not-italic [&_blockquote]:rounded-r-md',
          // 代码块: 深色 + 圆角 + 内边距
          '[&_pre]:bg-foreground [&_pre]:p-3 [&_pre]:rounded-lg [&&_pre]:text-xs [&_pre]:overflow-x-auto [&_pre]:text-background [&_pre]:shadow-sm',
          '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-background',
          '[&_code]:bg-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.85em] [&_code]:text-pink-600 [&_code]:font-mono',
          // 链接: 主色 + hover 下划线
          '[&_a]:text-blue-600 [&_a]:font-medium [&_a]:transition-colors hover:[&_a]:text-blue-800 hover:[&_a]:underline',
          // 图片: 圆角 + 阴影
          '[&_img]:rounded-lg [&_img]:max-w-full [&_img]:h-auto [&_img]:my-3 [&_img]:shadow-sm',
          // HR
          '[&_hr]:my-6 [&_hr]:border-slate-200',
          'min-h-[260px]',
        )}
      />
      {siteId && (
        <MediaPicker
          open={pickerOpen}
          siteId={siteId}
          onClose={() => setPickerOpen(false)}
          onPick={(item) => {
            editor?.chain().focus().setImage({ src: item.url, alt: item.alt_text || item.filename }).run();
            setPickerOpen(false);
          }}
        />
      )}

      {/* P3.6.2: 变量补全 (toolbar 变量按钮 / 选在光标位插) */}
      <TagAutocompletePopover
        open={varOpen}
        tags={ARTICLE_VARIABLE_TAGS as TagItem[]}
        filter={varFilter}
        position={{ top: 80, right: 16 } as any}
        onSelect={(t) => {
          // 插入代码到光标位置 (作为 code mark, 动态渲染时以一段占位代替)
          editor?.chain().focus().insertContent(`<code data-hy="${t.code}">${t.code}</code>&nbsp;`).run();
          setVarOpen(false);
        }}
        onClose={() => setVarOpen(false)}
      />
    </div>
  );
};

// P3.6.2: 文章可用的变量标签 (运行时由发布引擎替换, 编辑器只作占位)
const ARTICLE_VARIABLE_TAGS = [
  { code: 'HY_SITE_NAME', scope: 'all', desc: '站点名称', example: '<HY_SITE_NAME />' },
  { code: 'HY_SITE_URL', scope: 'all', desc: '站点主域名', example: '<HY_SITE_URL />' },
  { code: 'HY_SITE_LOGO', scope: 'all', desc: '站点 logo', example: '<HY_SITE_LOGO />' },
  { code: 'HY_PAGE_TITLE', scope: 'all', desc: '当前页 title', example: '<HY_PAGE_TITLE />' },
  { code: 'HY_BREADCRUMB', scope: 'all', desc: '面包屑 (发布时按 context 自动展开)', example: '<HY_BREADCRUMB _separator=" / " />' },
  { code: 'HY_CAT_NAME', scope: 'category', desc: '所在栏目名', example: '<HY_CAT_NAME />' },
  { code: 'HY_CAT_URL', scope: 'category', desc: '所在栏目链接', example: '<HY_CAT_URL />' },
  { code: 'HY_RELATED_LIST', scope: 'content', desc: '相关文章列表 (同栏目最新 5 篇)', example: '<HY_RELATED_LIST _limit="5" />' },
  { code: 'HY_ITEM_PUBLISH_DATE', scope: 'content', desc: '本文发布日期 (格式 _format)', example: '<HY_ITEM_PUBLISH_DATE _format="YYYY-MM-DD" />' },
  { code: 'HY_ITEM_AUTHOR', scope: 'content', desc: '作者名', example: '<HY_ITEM_AUTHOR />' },
];
