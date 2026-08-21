/**
 * UserMenu - 头像下拉菜单 (P3.6.2)
 *
 * 点击用户名区域弹出 3 项:
 *   - 个人资料  -> 打开 SettingsDialog, 切到 profile
 *   - 设置      -> 打开 SettingsDialog, 切到 appearance
 *   - 登出
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Settings, User, ChevronDown, Sparkles, FileText } from 'lucide-react';
import { Avatar, Badge } from '@/components/ui';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { SettingsDialog, type SettingsDialogProps } from '@/components/settings/SettingsDialog';

export function UserMenu({ placement = 'sidebar' }: { placement?: 'sidebar' | 'topbar' } = {}) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<SettingsDialogProps['initialTab']>('profile');
  const wrapRef = useRef<HTMLDivElement>(null);

  const isTopbar = placement === 'topbar';

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleLogout = () => {
    setOpen(false);
    logout();
    navigate('/login');
  };

  const openSettings = (tab: SettingsDialogProps['initialTab'] = 'profile') => {
    setOpen(false);
    setInitialTab(tab);
    setSettingsOpen(true);
  };

  return (
    <>
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex items-center gap-2 rounded-md text-left transition-colors',
            isTopbar ? 'p-1.5 hover:bg-secondary/60' : 'w-full p-1.5 hover:bg-secondary/40',
            open && (isTopbar ? 'bg-secondary/60' : 'bg-secondary/60'),
          )}
        >
          <Avatar name={user?.name || 'User'} size="sm" />
          <div className={cn('overflow-hidden', isTopbar ? '' : 'flex-1')}>
            <div className="flex items-center gap-1 truncate text-[12px] font-medium">
              {user?.name}
              {user?.is_super_admin && (
                <span className="text-[9px] text-blue-600">· Super</span>
              )}
            </div>
            {!isTopbar && (
              <div className="truncate text-[10px] text-muted-foreground">{user?.email}</div>
            )}
          </div>
          <ChevronDown
            className={cn('h-3 w-3 text-muted-foreground transition-transform', open && 'rotate-180')}
            strokeWidth={2.5}
          />
        </button>

        {open && (
          <div
            className={cn(
              // P4.1 治本: 用 bg-popover token + dark:ring-white/10 (替换 P3.8.4 inline style 治标)
              'absolute z-50 w-56 rounded-lg border bg-popover shadow-md ring-1 ring-border overflow-hidden',
              isTopbar
                ? 'top-full right-0 mt-1.5'
                : 'bottom-full left-0 right-0 mb-1.5',
            )}
            data-state="open"
          >
            {/* 头部用户信息 */}
            <div className="px-3 py-2.5 border-b bg-secondary/20">
              <div className="flex items-center gap-2">
                <Avatar name={user?.name || 'User'} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium truncate">{user?.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{user?.email}</div>
                </div>
              </div>
              {user?.is_super_admin && (
                <Badge className="mt-1.5 text-[9.5px] bg-blue-100 text-blue-700 hover:bg-blue-100">
                  Super Admin
                </Badge>
              )}
            </div>

            {/* 菜单项 */}
            <div className="py-1">
              <MenuItem
                icon={User}
                label="个人资料"
                desc="名称、密码"
                onClick={() => openSettings('profile')}
              />
              <MenuItem
                icon={Sparkles}
                label="AI 模型"
                desc="配置大模型接入"
                onClick={() => openSettings('ai')}
              />
              <MenuItem
                icon={FileText}
                label="AI 提示词"
                desc="统一管理 Prompt"
                onClick={() => openSettings('prompts')}
              />
              <MenuItem
                icon={Settings}
                label="设置"
                desc="外观 / 快捷键 / 系统"
                onClick={() => openSettings('appearance')}
              />
            </div>

            {/* 登出 */}
            <div className="border-t py-1">
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>登出</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* === 设置大对话框 === */}
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialTab={initialTab}
      />
    </>
  );
}

function MenuItem({
  icon: Icon, label, desc, onClick,
}: {
  icon: any; label: string; desc: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-secondary/40"
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" strokeWidth={2} />
      <div className="min-w-0">
        <div className="text-[12px] font-medium leading-tight">{label}</div>
        <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{desc}</div>
      </div>
    </button>
  );
}
