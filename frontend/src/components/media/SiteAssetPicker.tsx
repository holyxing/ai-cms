/**
 * SiteAssetPicker - 从站点资源（assets 目录）选择图片
 * 支持单选 / 多选、搜索、上传到 assets
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Upload, Loader2, Image as ImageIcon, Check, Boxes } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { siteAssetsApi, previewUrl, type SiteAsset } from '@/api/siteAssets';
import { useAuthStore } from '@/stores/auth';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];

function isImageAsset(asset: SiteAsset): boolean {
  return (
    asset.category === 'assets'
    && (asset.content_type.startsWith('image/')
      || IMAGE_EXTS.some((e) => asset.name.toLowerCase().endsWith(e)))
  );
}

function SiteAssetThumb({ siteId, asset }: { siteId: string; asset: SiteAsset }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    (async () => {
      try {
        const r = await fetch(previewUrl(siteId, asset.category, asset.name), {
          headers: { Authorization: `Bearer ${useAuthStore.getState().accessToken || ''}` },
        });
        if (!r.ok) {
          if (active) setFailed(true);
          return;
        }
        const blob = await r.blob();
        if (!active) return;
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [siteId, asset.category, asset.name]);

  if (failed || !blobUrl) {
    return (
      <span className="flex h-full w-full items-center justify-center text-[10px] font-medium text-muted-foreground">
        {asset.name.split('.').pop()?.toUpperCase().slice(0, 4) || 'IMG'}
      </span>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={asset.name}
      className="h-full w-full object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

interface Props {
  open: boolean;
  siteId: string;
  /** 单选：点选即确认；多选：勾选后点确定 */
  multiple?: boolean;
  onClose: () => void;
  onPick: (assets: SiteAsset[]) => void;
}

export function SiteAssetPicker({ open, siteId, multiple = false, onClose, onPick }: Props) {
  const [items, setItems] = useState<SiteAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await siteAssetsApi.list(siteId, 'assets');
      setItems((r.items ?? []).filter(isImageAsset));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '未知';
      toast.error(`加载站点资源失败: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, siteId]);

  useEffect(() => {
    if (!open) {
      setItems([]);
      setQ('');
      setSelected(new Set());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (a) =>
        a.name.toLowerCase().includes(query)
        || (a.original_filename || '').toLowerCase().includes(query)
        || (a.description || '').toLowerCase().includes(query),
    );
  }, [items, q]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmPick = (assets: SiteAsset[]) => {
    if (!assets.length) {
      toast.error('请至少选择一张图片');
      return;
    }
    onPick(assets);
    onClose();
  };

  const onItemClick = (asset: SiteAsset) => {
    if (multiple) {
      toggleSelect(asset.id);
      return;
    }
    confirmPick([asset]);
  };

  const onConfirmMulti = () => {
    const picked = items.filter((a) => selected.has(a.id));
    confirmPick(picked);
  };

  const onUploadClick = () => fileInputRef.current?.click();

  const onUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    setUploading((n) => n + files.length);
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        toast.error(`跳过非图片: ${file.name}`);
        setUploading((n) => n - 1);
        continue;
      }
      try {
        await siteAssetsApi.upload(siteId, {
          category: 'assets',
          name: file.name,
          file,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '未知';
        toast.error(`${file.name} 上传失败: ${msg}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    await load();
  };

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
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Boxes className="h-3.5 w-3.5 text-blue-600" />
            <h3 className="text-sm font-semibold">选择站点资源</h3>
            {multiple && (
              <span className="text-[10px] text-muted-foreground">可多选</span>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-2 border-b px-4 py-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setQ(q)}
            placeholder="搜索文件名…"
            className="h-8 max-w-xs text-xs"
          />
          <div className="ml-auto flex items-center gap-2">
            {uploading > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-blue-700">
                <Loader2 className="h-3 w-3 animate-spin" />
                上传中 {uploading}
              </span>
            )}
            <Button size="sm" className="h-8 text-xs" onClick={onUploadClick}>
              <Upload className="h-3 w-3" />
              上传到 assets
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onUploadFiles}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && items.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <ImageIcon className="h-8 w-8 opacity-30" />
              <p className="text-xs">
                {items.length === 0
                  ? 'assets 目录还没有图片，点击右上角上传'
                  : '没有匹配的图片'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {filtered.map((asset) => {
                const isSelected = selected.has(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => onItemClick(asset)}
                    className={cn(
                      'group relative aspect-square overflow-hidden rounded-md border bg-secondary/30 text-left',
                      isSelected
                        ? 'border-blue-500 ring-2 ring-blue-200'
                        : 'hover:border-blue-500 hover:ring-2 hover:ring-blue-200',
                    )}
                    title={asset.name}
                  >
                    <SiteAssetThumb siteId={siteId} asset={asset} />
                    <div className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
                      {asset.name}
                    </div>
                    {multiple && isSelected && (
                      <div className="absolute right-1 top-1 rounded-full bg-blue-600 p-0.5 text-white">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                    {!multiple && (
                      <div className="absolute right-1 top-1 hidden rounded-full bg-blue-600 p-0.5 text-white group-hover:block">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {multiple && (
          <div className="flex items-center justify-between border-t px-4 py-2">
            <span className="text-[11px] text-muted-foreground">
              已选 {selected.size} 张
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onClose}>
                取消
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={selected.size === 0}
                onClick={onConfirmMulti}
              >
                确定
              </Button>
            </div>
          </div>
        )}

        {!multiple && filtered.length > 0 && (
          <div className="border-t px-4 py-2 text-[10px] text-muted-foreground">
            点击一张图片即可填入；URL 形如 /sites/站点/assets/文件名
          </div>
        )}
      </div>
    </div>
  );
}
