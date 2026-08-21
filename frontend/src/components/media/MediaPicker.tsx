/**
 * MediaPicker.tsx - 媒体选择器弹窗 (P3.5 富文本增强)
 *
 * 用于 BlockEditor 工具栏"插入图片"按钮
 * 简化版: 列表 + 网格预览 + 点选即插入
 * 完整功能 (文件夹/搜索) 在 /admin/media 页面
 */
import { useState, useEffect, useRef } from 'react';
import { X, Upload, Loader2, Image as ImageIcon, Check } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { mediaApi, type MediaItem } from '@/api/media';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  siteId: string;
  onClose: () => void;
  onPick: (item: MediaItem) => void;
}

const PAGE_SIZE = 24;

export function MediaPicker({ open, siteId, onClose, onPick }: Props) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [q, setQ] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  // 加载
  const load = async (p = 1, query = q) => {
    setLoading(true);
    try {
      const r = await mediaApi.list(siteId, {
        page: p,
        page_size: PAGE_SIZE,
        mime_prefix: 'image/',
        q: query || undefined,
      });
      setItems(r.data.data?.items ?? []);
      setTotal(r.data.data?.total ?? 0);
      setPage(p);
    } catch (e: any) {
      toast.error(`加载失败: ${e?.message || '未知'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 关闭时清理
  useEffect(() => {
    if (!open) {
      setItems([]);
      setQ('');
      setPage(1);
    }
  }, [open]);

  // 上传
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 允许重传同名
    setUploading((n) => n + files.length);
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        toast.error(`跳过非图片: ${file.name}`);
        setUploading((n) => n - 1);
        continue;
      }
      try {
        await mediaApi.upload(siteId, file);
      } catch (err: any) {
        toast.error(`${file.name} 上传失败: ${err?.message || '未知'}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    await load(1);
  };

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[80vh] w-full max-w-3xl flex-col rounded-lg border bg-background shadow-md"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h3 className="text-sm font-semibold">选择图片</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* 工具栏 */}
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(1, q)}
            placeholder="搜索文件名…"
            className="h-8 max-w-xs text-xs"
          />
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => load(1, q)}>
            搜索
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {uploading > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-blue-700">
                <Loader2 className="h-3 w-3 animate-spin" />
                上传中 {uploading}
              </span>
            )}
            <Button size="sm" className="h-8 text-xs" onClick={() => fileInput.current?.click()}>
              <Upload className="h-3 w-3" />
              上传图片
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onUpload}
            />
          </div>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading && items.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <ImageIcon className="h-8 w-8 opacity-30" />
              <p className="text-xs">还没有图片, 点击右上角"上传图片"</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {items.map((m) => (
                <button
                  key={m.id}
                  onClick={() => onPick(m)}
                  className={cn(
                    'group relative aspect-square overflow-hidden rounded-md border bg-secondary/30',
                    'hover:border-blue-500 hover:ring-2 hover:ring-blue-200',
                  )}
                  title={m.filename}
                >
                  <img
                    src={m.url}
                    alt={m.alt_text || m.filename}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
                    {m.filename}
                  </div>
                  <div className="absolute right-1 top-1 hidden rounded-full bg-blue-600 p-0.5 text-white group-hover:block">
                    <Check className="h-3 w-3" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 分页 */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t px-4 py-2 text-[11px] text-muted-foreground">
            <span>共 {total} 张</span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={page <= 1 || loading}
                onClick={() => load(page - 1)}
              >
                上一页
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={page * PAGE_SIZE >= total || loading}
                onClick={() => load(page + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
