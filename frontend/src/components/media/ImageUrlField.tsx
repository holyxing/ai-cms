/** 图片 URL 输入：支持手动填写、本地上传、媒体库 / 站点资源选择 */
import { useRef, useState } from 'react';
import { Upload, Image as ImageIcon, Loader2, Boxes } from 'lucide-react';
import { Button } from '@/components/ui';
import { MediaPicker } from '@/components/media/MediaPicker';
import { SiteAssetPicker } from '@/components/media/SiteAssetPicker';
import { mediaApi, type MediaItem } from '@/api/media';
import type { SiteAsset } from '@/api/siteAssets';
import { toast } from 'sonner';

interface Props {
  value: string;
  onChange: (url: string) => void;
  siteId: string;
  placeholder?: string;
  /** 预览区高度 class，默认 h-16 */
  previewClassName?: string;
  /** 站点资源选择器是否允许多选（多选时取第一张填入当前字段） */
  allowMultipleSiteAssets?: boolean;
}

export function ImageUrlField({
  value,
  onChange,
  siteId,
  placeholder = '/sites/.../image.webp 或媒体库 URL',
  previewClassName = 'h-16',
  allowMultipleSiteAssets = false,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);

  const applyUrl = (url: string) => {
    onChange(url.trim());
  };

  const onUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('只支持图片文件');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('图片不能超过 10MB');
      return;
    }
    setUploading(true);
    try {
      const r = await mediaApi.upload(siteId, file);
      const url = r.data.data?.url;
      if (!url) {
        toast.error('上传失败：未返回 URL');
        return;
      }
      applyUrl(url);
      toast.success('图片已上传到媒体库');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误';
      toast.error(`上传失败: ${msg}`);
    } finally {
      setUploading(false);
    }
  };

  const onPickMedia = (item: MediaItem) => {
    applyUrl(item.url);
    setMediaPickerOpen(false);
    toast.success('已从媒体库选择');
  };

  const onPickSiteAssets = (assets: SiteAsset[]) => {
    if (!assets.length) return;
    applyUrl(assets[0].url);
    setAssetPickerOpen(false);
    if (assets.length > 1) {
      toast.success(`已选 ${assets.length} 张，当前字段使用第一张`);
    } else {
      toast.success('已从站点资源选择');
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 min-w-0 flex-1 basis-full rounded-md border bg-background px-2 text-[11px] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:basis-auto"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 px-2 text-[11px]"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Upload className="h-3 w-3" />
          )}
          上传
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 px-2 text-[11px]"
          onClick={() => setMediaPickerOpen(true)}
        >
          <ImageIcon className="h-3 w-3" />
          媒体库
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 px-2 text-[11px]"
          onClick={() => setAssetPickerOpen(true)}
        >
          <Boxes className="h-3 w-3" />
          站点资源
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onUploadFiles}
        />
      </div>
      {value.trim() && (
        <img
          src={value.trim()}
          alt=""
          className={`mt-2 w-full rounded-md border object-cover ${previewClassName}`}
        />
      )}
      <MediaPicker
        open={mediaPickerOpen}
        siteId={siteId}
        onClose={() => setMediaPickerOpen(false)}
        onPick={onPickMedia}
      />
      <SiteAssetPicker
        open={assetPickerOpen}
        siteId={siteId}
        multiple={allowMultipleSiteAssets}
        onClose={() => setAssetPickerOpen(false)}
        onPick={onPickSiteAssets}
      />
    </>
  );
}
