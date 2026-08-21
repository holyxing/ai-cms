// DeleteSiteDialog.tsx - 删除站点确认 dialog (P3.6+ 软删, 可恢复)
// 跟项目 ConfirmDialog 风格一致, 加危险警告
import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2, AlertTriangle, Info } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui';
import { sitesApi, type SiteListItem } from '@/api/sites';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  site: SiteListItem | null;
  onClose: () => void;
  onDeleted?: (siteId: string) => void;
}

export function DeleteSiteDialog({ open, site, onClose, onDeleted }: Props) {
  const qc = useQueryClient();
  const [confirmText, setConfirmText] = useState('');
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');

  // 关闭时重置
  const handleClose = () => {
    setConfirmText('');
    setError('');
    onClose();
  };

  const handleDelete = async () => {
    if (!site) return;
    if (confirmText !== site.name) {
      setError(`请输入完整站点名 "${site.name}" 以确认删除`);
      return;
    }
    setRemoving(true);
    setError('');
    try {
      await sitesApi.delete(site.id);
      qc.invalidateQueries({ queryKey: ['sites'] });
      toast.success(`站点 "${site.name}" 已移入回收站`);
      onDeleted?.(site.id);
      handleClose();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || '删除失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setRemoving(false);
    }
  };

  if (!site) return null;

  // 显示指标 (帮用户理解"删的是什么")
  const stats = [
    { label: '文章', value: site.content_count ?? 0 },
    { label: '栏目', value: site.category_count ?? 0 },
    { label: '模板', value: site.layout_count ?? 0 },
    { label: '媒体', value: site.media_count ?? 0 },
    { label: '部署', value: site.deployment_count ?? 0 },
  ];
  const hasData = stats.some((s) => s.value > 0);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="删除站点"
      maxWidth="max-w-md"
    >
      <div className="space-y-3.5">
        {/* 警告 */}
        <div className="flex items-start gap-2.5 rounded-md bg-red-50 border border-red-200 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="flex-1 text-[13px]">
            <p className="font-medium text-red-900">
              将站点 "{site.name}" 移入回收站
            </p>
            <p className="mt-0.5 text-red-700/80 text-[12px]">
              站点会从工作区消失, 但所有数据保留, 可在回收站恢复。
            </p>
          </div>
        </div>

        {/* 站点内容摘要 (有数据时显示) */}
        {hasData && (
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-1.5">
              即将删除的内容
            </p>
            <div className="grid grid-cols-5 gap-2">
              {stats.map((s) => (
                <div key={s.label} className="text-center">
                  <div className={cn('text-[15px] font-semibold tabular-nums leading-none', s.value > 0 ? 'text-foreground' : 'text-muted-foreground/50')}>
                    {s.value}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 提示 */}
        <div className="flex items-start gap-1.5 rounded-md bg-blue-50 border border-blue-200 px-2.5 py-1.5 text-[12px] text-blue-700">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            可在 <code className="rounded bg-blue-100 px-1 font-mono text-[11px]">/admin/sites/recycle-bin</code> 恢复或永久删除
          </span>
        </div>

        {/* 确认输入 */}
        <div className="space-y-1.5">
          <label htmlFor="ds-confirm" className="text-xs font-medium">
            请输入站点名 <code className="rounded bg-secondary px-1 font-mono text-[11px]">{site.name}</code> 以确认
          </label>
          <input
            id="ds-confirm"
            value={confirmText}
            onChange={(e) => { setConfirmText(e.target.value); setError(''); }}
            placeholder={site.name}
            disabled={removing}
            className="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-start gap-1.5 rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5 text-[12px] text-red-700">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 底部操作 */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={removing}>
            取消
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={removing || confirmText !== site.name}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {removing ? '删除中...' : '确认删除'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
