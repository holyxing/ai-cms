/**
 * PromptDialog - 统一输入弹窗 (P3.9.1+ holy 反馈 #11266)
 *
 * 替代浏览器原生 `window.prompt` (丑/非品牌/不响应 Esc 一致性)
 * 走项目统一 Modal + Tailwind 设计 token, 跟 ConfirmDialog 同架构
 *
 * 特点:
 *  - open 受控
 *  - 必填校验: value 为空时确认按钮 disable
 *  - input 自动 focus + 全选
 *  - 接受 children 可在下方加补充说明
 *  - Esc / 点遮罩 = 取消
 *  - Enter (在 input 里) = 确认
 */
import * as React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { Label } from './Label';
import { cn } from '@/lib/utils';

export interface PromptDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
  title: string;
  /** 字段标签, 默认"名称" */
  label?: string;
  /** 字段 placeholder */
  placeholder?: string;
  /** 初始值, 留空则 placeholder 作占位 */
  defaultValue?: string;
  /** 输入类型, 默认 text */
  type?: 'text' | 'url' | 'email' | 'number';
  /** 必填校验提示, 默认"请输入值" */
  requiredHint?: string;
  /** 确认按钮文字, 默认"确认" */
  confirmText?: string;
  /** 取消按钮文字, 默认"取消" */
  cancelText?: string;
  /** 字段下方说明文字 */
  description?: React.ReactNode;
  /** loading 状态 (操作进行中禁用按钮) */
  loading?: boolean;
  /** 验证器 — 返 null 合法, 返 string 错误消息 (按钮 disable + 错误红字) */
  validate?: (value: string) => string | null;
  /** input autocomplete 提示 */
  autoComplete?: string;
}

export const PromptDialog: React.FC<PromptDialogProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  label = '名称',
  placeholder,
  defaultValue = '',
  type = 'text',
  requiredHint = '请输入值',
  confirmText = '确认',
  cancelText = '取消',
  description,
  loading = false,
  validate,
  autoComplete,
}) => {
  const [value, setValue] = React.useState(defaultValue);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // 打开时重置 + 聚焦
  React.useEffect(() => {
    if (open) {
      setValue(defaultValue);
      // 等 dialog mount 后聚焦
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, defaultValue]);

  const err = validate ? validate(value) : null;
  const empty = !value.trim();
  const canSubmit = !empty && !err && !loading;

  const submit = () => {
    if (!canSubmit) return;
    onConfirm(value.trim());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onClose}
      title={title}
      maxWidth="max-w-md"
    >
      <div className="px-4 py-3.5 space-y-2.5">
        <Label className="text-[11px] font-medium text-muted-foreground">{label}</Label>
        <Input
          ref={inputRef}
          type={type}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={cn('h-8 text-[12.5px]', err && 'border-red-400 focus-visible:ring-red-200')}
        />
        {err ? (
          <p className="text-[10.5px] text-red-600">{err}</p>
        ) : empty ? (
          <p className="text-[10.5px] text-muted-foreground">{requiredHint}</p>
        ) : description ? (
          <p className="text-[10.5px] text-muted-foreground">{description}</p>
        ) : null}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={loading}
            className="h-8 text-xs"
          >
            {cancelText}
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={!canSubmit}
            className="h-8 text-xs"
          >
            {loading ? '处理中…' : confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
