// StatusActions.tsx - 内容状态机动作按钮 (2026-06-08 重建, 补回 565 行大改里丢的组件)
//
// 状态机 7 个动作 (跟 runPendingAction switch 配套):
//   - publish  : draft/pending → published
//   - submit   : draft → pending (送审)
//   - schedule : draft → scheduled (定时发布, 弹 datetime 输入)
//   - archive  : published → archived
//   - restore  : archived → draft
//   - recall   : pending → draft (撤回送审)
//   - unpublish: published → draft
//
// 按当前 status + isOwner 决定哪些按钮可见 + 哪个 disabled
import { useState } from 'react';
import { Send, Clock, Archive, RotateCcw, XCircle, FileX2, CheckCircle, CalendarClock } from 'lucide-react';
import { Button, Input, Label } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui';
import type { ContentStatus } from '@/api/contents';

export type StatusActionKind = 'publish' | 'submit' | 'schedule' | 'archive' | 'restore' | 'recall' | 'unpublish';

export interface StatusAction {
  kind: StatusActionKind;
  /** schedule 需要 at; 其他不需要 */
  at?: string;
}

export interface StatusActionsProps {
  current: ContentStatus;
  isOwner: boolean;
  scheduledAt?: string | null;
  onAction: (a: StatusAction) => void;
  /** 父组件正在跑某个 mut 时置 true, 按钮统一禁用 */
  disabled?: boolean;
}

interface BtnSpec {
  kind: StatusActionKind;
  label: string;
  icon: React.ReactNode;
  className?: string;
}

// 单个按钮定义 (无 schedule, schedule 特殊处理)
const BUTTONS: Record<Exclude<StatusActionKind, 'schedule'>, BtnSpec> = {
  publish:   { kind: 'publish',   label: '发布',     icon: <Send className="h-3.5 w-3.5" /> },
  submit:    { kind: 'submit',    label: '送审',     icon: <CheckCircle className="h-3.5 w-3.5" /> },
  archive:   { kind: 'archive',   label: '归档',     icon: <Archive className="h-3.5 w-3.5" /> },
  restore:   { kind: 'restore',   label: '还原',     icon: <RotateCcw className="h-3.5 w-3.5" /> },
  recall:    { kind: 'recall',    label: '撤回',     icon: <XCircle className="h-3.5 w-3.5" /> },
  unpublish: { kind: 'unpublish', label: '取消发布', icon: <FileX2 className="h-3.5 w-3.5" />, className: 'text-amber-700 hover:bg-amber-50' },
};

// 按当前 status 决定显示哪些动作
function actionsFor(current: ContentStatus, isOwner: boolean): StatusActionKind[] {
  if (!isOwner) return [];  // 非 owner 不显示状态机操作
  switch (current) {
    case 'draft':     return ['publish', 'submit', 'schedule'];
    case 'pending':   return ['recall', 'publish'];  // 审核中: 可撤回或直接通过发布
    case 'scheduled': return ['publish', 'archive'];  // 已计划: 可直接发布或归档
    case 'published': return ['unpublish', 'archive'];
    case 'archived':  return ['restore'];
    default:          return [];
  }
}

export function StatusActions({ current, isOwner, scheduledAt, onAction, disabled }: StatusActionsProps) {
  const [confirmKind, setConfirmKind] = useState<StatusActionKind | null>(null);
  const [scheduleAt, setScheduleAt] = useState<string>(() => {
    // 默认值: 当前时间 + 1h
    const d = new Date(Date.now() + 60 * 60 * 1000);
    // datetime-local 需要 YYYY-MM-DDTHH:mm
    return d.toISOString().slice(0, 16);
  });
  const [showScheduleInput, setShowScheduleInput] = useState(false);

  const visible = actionsFor(current, isOwner);

  if (visible.length === 0 && !scheduledAt) return null;

  const handleClick = (k: StatusActionKind) => {
    if (k === 'schedule') {
      setShowScheduleInput(true);
      return;
    }
    setConfirmKind(k);
  };

  const handleConfirm = () => {
    if (!confirmKind) return;
    onAction({ kind: confirmKind });
    setConfirmKind(null);
  };

  const handleScheduleConfirm = () => {
    if (!scheduleAt) return;
    // datetime-local 没时区, 当作本地时间, 转 ISO 字符串
    const at = new Date(scheduleAt).toISOString();
    onAction({ kind: 'schedule', at });
    setShowScheduleInput(false);
  };

  return (
    <div className="space-y-1.5 pt-1">
      {scheduledAt && current === 'scheduled' && (
        <div className="flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700">
          <CalendarClock className="h-3.5 w-3.5" />
          计划于 {new Date(scheduledAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        {visible
          .filter((k): k is Exclude<StatusActionKind, 'schedule'> => k !== 'schedule')
          .map((k) => {
            const b = BUTTONS[k];
            return (
              <Button
                key={k}
                variant="outline"
                size="sm"
                className={`h-7 text-xs ${b.className || ''}`}
                onClick={() => handleClick(k)}
                disabled={disabled}
              >
                {b.icon}
                {b.label}
              </Button>
            );
          })}
        {/* schedule 单独按钮 (draft 状态才有) */}
        {current === 'draft' && isOwner && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => handleClick('schedule')}
            disabled={disabled}
          >
            <Clock className="h-3.5 w-3.5" />
            定时
          </Button>
        )}
      </div>

      {/* schedule datetime-local 输入 */}
      {showScheduleInput && (
        <div className="space-y-1.5 rounded-md border bg-secondary/40 p-2">
          <Label className="text-xs">计划发布时间</Label>
          <Input
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
            className="h-7 text-xs"
          />
          <div className="flex items-center gap-1.5">
            <Button size="sm" className="h-7 text-xs" onClick={handleScheduleConfirm} disabled={disabled}>
              <Clock className="h-3.5 w-3.5" />
              确认定时
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowScheduleInput(false)}>
              取消
            </Button>
          </div>
        </div>
      )}

      {/* 其他动作的 ConfirmDialog */}
      <ConfirmDialog
        open={confirmKind !== null}
        onOpenChange={(o) => { if (!o) setConfirmKind(null); }}
        title={confirmKind ? `${BUTTONS[confirmKind as Exclude<StatusActionKind, 'schedule'>]?.label || '操作'}确认` : '操作确认'}
        description={confirmKind === 'unpublish'
          ? '取消发布后, 公开站点会立刻 404. 确认?'
          : confirmKind === 'archive'
          ? '归档后内容从公开站点消失, 但仍在回收站可恢复. 确认?'
          : confirmKind === 'recall'
          ? '撤回送审后回到草稿状态. 确认?'
          : '确认执行此操作?'}
        onConfirm={handleConfirm}
        confirmText={confirmKind ? BUTTONS[confirmKind as Exclude<StatusActionKind, 'schedule'>]?.label : '确认'}
        destructive={confirmKind === 'unpublish' || confirmKind === 'archive'}
      />
    </div>
  );
}
