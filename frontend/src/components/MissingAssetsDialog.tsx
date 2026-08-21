/**
 * 资源缺失确认对话框 (P3.6.4)
 *
 * 发布 API 返回 422 缺失资源时弹出, 用户可:
 * 1. 取消, 回去上传资源
 * 2. 强制发布 (跳过检查, 风险自负)
 *
 * 列出每个缺失资源: 名称 / 来源 (CSS/JS/HY) / 引用的 layout (code + scope)
 */
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Link2, FileCode2, Boxes, ShieldAlert } from 'lucide-react';
import { Button, Modal, Badge } from '@/components/ui';

export interface MissingAsset {
  name: string;
  source: 'link' | 'script' | 'hy';
  layout_id: string;
  layout_code: string;
  layout_scope: string;
}

export interface MissingAssetsDialogProps {
  open: boolean;
  onClose: () => void;
  onForcePublish: () => void;
  siteId: string;
  missing: MissingAsset[];
  isForcing?: boolean;
}

const SOURCE_ICON = {
  link: Link2,
  script: FileCode2,
  hy: Boxes,
} as const;
const SOURCE_LABEL = { link: 'CSS', script: 'JS', hy: 'HY' } as const;

export function MissingAssetsDialog({
  open, onClose, onForcePublish, siteId, missing, isForcing,
}: MissingAssetsDialogProps) {
  if (!open || missing.length === 0) return null;

  // 去重 (同 name 可能被多个 layout 引用, 列表展示更友好)
  const byName = new Map<string, { sources: Set<string>; layouts: Array<{ id: string; code: string; scope: string }> }>();
  for (const m of missing) {
    const key = m.name;
    if (!byName.has(key)) byName.set(key, { sources: new Set(), layouts: [] });
    const e = byName.get(key)!;
    e.sources.add(m.source);
    // 去重 layout (同 name+source 跨多段可能被推多个, 但同 layout_id 只需一条)
    if (!e.layouts.some((l) => l.id === m.layout_id)) {
      e.layouts.push({ id: m.layout_id, code: m.layout_code, scope: m.layout_scope });
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <span>发现 {missing.length} 个缺失资源</span>
        </div>
      }
      description={
        <span>
          模板引用了以下资源, 但站点还没上传。发布后这些资源会是 404, 访客看不到样式/脚本。
        </span>
      }
    >
      <div className="space-y-3">
        {/* 缺失资源列表 */}
        <div className="max-h-[280px] overflow-y-auto rounded border border-amber-200 bg-amber-50/40 p-2.5 space-y-1.5">
          {Array.from(byName.entries()).map(([name, info]) => (
            <div key={name} className="flex items-start gap-2 px-1.5 py-1 rounded bg-card">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[12px] text-amber-900 font-semibold truncate">
                    {name}
                  </span>
                  {Array.from(info.sources).map((s) => {
                    const Icon = SOURCE_ICON[s as keyof typeof SOURCE_ICON] ?? Boxes;
                    return (
                      <Badge key={s} variant="outline" className="text-[9px] px-1 py-0">
                        <Icon className="h-2.5 w-2.5" />
                        {SOURCE_LABEL[s as keyof typeof SOURCE_LABEL] ?? s}
                      </Badge>
                    );
                  })}
                </div>
                <p className="text-[10.5px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1">
                  <span>被引用:</span>
                  {info.layouts.map((l) => (
                    <Link
                      key={l.id}
                      to={`/layouts/${l.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 rounded bg-secondary px-1 py-0 font-mono text-[10px] text-primary hover:underline"
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                      {l.code} ({l.scope})
                    </Link>
                  ))}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* 提示 */}
        <div className="text-[11.5px] text-muted-foreground leading-relaxed">
          <p>• <strong>推荐</strong>: 先去 <Link to={`/sites/${siteId}/assets`} className="text-primary hover:underline">资源管理</Link> 上传缺失的文件, 再发布</p>
          <p>• <strong>或</strong>: 强制发布, 接受 404 风险 (适合临时演示 / 资源即将补上的场景)</p>
        </div>

        {/* 按钮区 */}
        <div className="flex justify-between items-center pt-2 border-t">
          <Link
            to={`/sites/${siteId}/assets`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11.5px] text-primary hover:underline flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            打开资源管理
          </Link>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button
              variant="destructive"
              onClick={onForcePublish}
              disabled={isForcing}
            >
              {isForcing ? '发布中…' : '强制发布'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
