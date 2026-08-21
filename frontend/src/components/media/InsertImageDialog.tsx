/**
 * InsertImageDialog - 插入图片（URL / 上传 / 媒体库 / 站点资源）
 */
import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button, Label } from '@/components/ui';
import { ImageUrlField } from '@/components/media/ImageUrlField';

interface Props {
  open: boolean;
  siteId: string;
  onClose: () => void;
  onConfirm: (url: string) => void;
}

function isValidImageRef(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  // 本站路径 / 站点资源 / 媒体库
  if (s.startsWith('/') || s.startsWith('./') || s.startsWith('../')) return true;
  // 绝对 URL（不强制后缀，CDN 常无扩展名）
  if (/^https?:\/\/\S+/i.test(s)) return true;
  // data URI
  if (/^data:image\//i.test(s)) return true;
  return false;
}

export function InsertImageDialog({ open, siteId, onClose, onConfirm }: Props) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUrl('');
      setErr(null);
    }
  }, [open]);

  const submit = () => {
    const v = url.trim();
    if (!isValidImageRef(v)) {
      setErr('请填写图片 URL，或从站点资源 / 媒体库选择');
      return;
    }
    onConfirm(v);
  };

  return (
    <Modal open={open} onClose={onClose} title="插入图片" maxWidth="max-w-lg">
      <div className="space-y-3 px-1 pb-1 pt-1">
        <div className="space-y-1.5">
          <Label className="text-[12px]">图片</Label>
          <ImageUrlField
            value={url}
            onChange={(v) => {
              setUrl(v);
              setErr(null);
            }}
            siteId={siteId}
            placeholder="粘贴 URL，或点「站点资源」选择"
            previewClassName="h-28"
          />
          {err && <p className="text-[11px] text-destructive">{err}</p>}
          <p className="text-[10px] text-muted-foreground">
            支持手动 URL、上传、媒体库，以及站点资源里的图片。
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" className="h-8 text-[12px]" onClick={onClose}>
            取消
          </Button>
          <Button type="button" size="sm" className="h-8 text-[12px]" onClick={submit}>
            插入
          </Button>
        </div>
      </div>
    </Modal>
  );
}
