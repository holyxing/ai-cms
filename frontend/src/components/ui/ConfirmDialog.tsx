/**
 * 通用确认对话框
 * - 包装 Modal, 提供 title/description/confirm/cancel 按钮
 * - 用于破坏性操作 (发布/删除/归档/恢复等)
 * - 替代浏览器 confirm() 丑弹窗, 保持 UI 一致
 */
import * as React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { cn } from '@/lib/utils';

export type ConfirmVariant = 'danger' | 'warning' | 'info';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: React.ReactNode;
  /** 确认按钮文字, 默认"确认" */
  confirmText?: string;
  /** 取消按钮文字, 默认"取消" */
  cancelText?: string;
  /** 默认 danger 红色 */
  variant?: ConfirmVariant;
  /** loading 状态 (操作进行中禁用按钮) */
  loading?: boolean;
}

const variantConfig: Record<ConfirmVariant, { icon: React.ComponentType<{ className?: string }>; iconClass: string; btnClass: string }> = {
  danger: {
    icon: AlertTriangle,
    iconClass: 'text-red-600 bg-red-50',
    btnClass: 'bg-red-600 hover:bg-red-700 text-white',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'text-amber-600 bg-amber-50',
    btnClass: 'bg-amber-600 hover:bg-amber-700 text-white',
  },
  info: {
    icon: Info,
    iconClass: 'text-blue-600 bg-blue-50',
    btnClass: '',
  },
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'danger',
  loading = false,
}) => {
  const cfg = variantConfig[variant];
  const Icon = cfg.icon;

  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onClose}
      title={
        <span className="flex items-center gap-2">
          <span className={cn('flex h-5 w-5 items-center justify-center rounded-full', cfg.iconClass)}>
            <Icon className="h-3 w-3" />
          </span>
          {title}
        </span>
      }
      maxWidth="max-w-md"
    >
      <div className="px-4 py-3.5">
        {description && (
          <div className="text-[13px] leading-relaxed text-muted-foreground">{description}</div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
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
            onClick={onConfirm}
            disabled={loading}
            className={cn('h-8 text-xs', cfg.btnClass)}
          >
            {loading ? '处理中…' : confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
