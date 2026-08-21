// VersionsDialog.tsx - 布局版本历史 + 回滚 (P3.6+ 抽共享组件)
// 原在 LayoutsPage 内, 2026-06-08 抽出来供 LayoutEditPage 复用
// 数据: GET /layouts/{id}/versions
// 操作: POST /layouts/{id}/rollback (target_version + change_note)
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { Modal, Button, Badge, ConfirmDialog } from '@/components/ui';
import { layoutsApi, type Layout } from '@/api/layouts';
import { cn } from '@/lib/utils';

export interface VersionsDialogProps {
  layout: Layout;
  onClose: () => void;
  /**
   * 接收用户选择的 target version, 走 layoutsApi.rollback
   * 返回更新后的 Layout (throw 时弹错)
   */
  onRollback: (targetVersion: number) => Promise<Layout>;
}

export function VersionsDialog({ layout, onClose, onRollback }: VersionsDialogProps) {
  const versionsQ = useQuery({
    queryKey: ['layout-versions', layout.id],
    queryFn: () => layoutsApi.listVersions(layout.id),
  });
  const [confirmVersion, setConfirmVersion] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);

  const items = versionsQ.data?.items ?? [];

  return (
    <>
      <Modal open onClose={onClose} title={`版本历史: ${layout.name}`} maxWidth="max-w-lg">
        <div className="max-h-96 space-y-1.5 overflow-y-auto">
          {versionsQ.isLoading && (
            <div className="py-6 text-center text-[12px] text-muted-foreground">加载版本...</div>
          )}
          {!versionsQ.isLoading && items.length === 0 && (
            <div className="py-6 text-center text-[12px] text-muted-foreground">暂无历史版本</div>
          )}
          {items.map((v) => {
            const isCurrent = v.version === layout.version;
            return (
              <div
                key={v.id}
                className={cn(
                  'flex items-center gap-2 rounded-md border p-2 text-[12px]',
                  isCurrent ? 'border-primary/30 bg-accent' : 'bg-card',
                )}
              >
                <Badge variant={isCurrent ? 'info' : 'muted'} className="text-[10px]">
                  v{v.version}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-foreground">{v.change_note || '(无说明)'}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(v.created_at).toLocaleString('zh-CN')}
                  </div>
                </div>
                {isCurrent ? (
                  <span className="text-[10px] font-medium text-blue-700">当前</span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px]"
                    onClick={() => setConfirmVersion(v.version)}
                    disabled={rolling}
                  >
                    <RotateCcw className="h-3 w-3" />
                    回滚
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between border-t pt-3 text-[11px] text-muted-foreground">
          <span>
            当前 v{layout.version}, 共 {items.length} 个历史版本
          </span>
          <Button size="sm" variant="ghost" onClick={onClose} className="h-6 text-[11px]">
            关闭
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmVersion !== null}
        onClose={() => !rolling && setConfirmVersion(null)}
        onConfirm={async () => {
          if (confirmVersion === null) return;
          setRolling(true);
          try {
            await onRollback(confirmVersion);
            setConfirmVersion(null);
            onClose();
          } finally {
            setRolling(false);
          }
        }}
        title="回滚版本"
        description={
          confirmVersion
            ? `回滚到 v${confirmVersion}? 当前未保存的修改会丢失, 回滚会生成新版本。`
            : ''
        }
        confirmText={rolling ? '回滚中...' : '回滚'}
        variant="warning"
      />
    </>
  );
}
